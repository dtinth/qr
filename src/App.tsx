import { Icon } from '@iconify-icon/react'
import checkIcon from '@iconify-icons/codicon/check'
import closeIcon from '@iconify-icons/codicon/close'
import copyIcon from '@iconify-icons/codicon/copy'
import { BrowserMultiFormatReader } from '@zxing/browser'
import {
  ChecksumException,
  FormatException,
  NotFoundException,
} from '@zxing/library'
import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'

const params = new URLSearchParams(window.location.search)
const options = {
  delay: +params.get('delay')! || 500,
  fit: params.get('fit') === 'cover' ? 'cover' : 'contain',
  post: params.get('post'),
}
const action = params.get('action') || 'home'

const reader = new BrowserMultiFormatReader(undefined, {
  delayBetweenScanAttempts: options.delay,
})
const imageReader = new BrowserMultiFormatReader()
const DUPLICATE_WINDOW_MS = 1000

function App() {
  if (action === 'scan') {
    return <Scanner />
  } else {
    return <Home />
  }
}

interface DisplayedInfo {
  text: string
  variant: 'success' | 'error'
  copied?: boolean
}

type TorchSettings = MediaTrackSettings & { torch?: boolean }
type TorchConstraints = MediaTrackConstraints & {
  advanced?: ({ torch?: boolean } & MediaTrackConstraintSet)[]
}
type ZXingResult = { text?: string; getText?: () => string }
type BarcodeDetectorCtor = new () => {
  detect(image: ImageBitmapSource): Promise<{ rawValue: string }[]>
}

function Scanner() {
  const video = useRef<HTMLVideoElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lastResultRef = useRef<{ time: number; text: string } | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [currentDeviceId, setCurrentDeviceId] = useState<string | undefined>()
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchEnabled, setTorchEnabled] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [stopped, setStopped] = useState<boolean>(false)
  const [displayedInfo, setDisplayedInfo] = useState<DisplayedInfo | null>(null)
  const resetReader = () => {
    const r = reader as BrowserMultiFormatReader & {
      reset?: () => void
      stopContinuousDecode?: () => void
    }
    r.reset?.()
    r.stopContinuousDecode?.()
  }
  const showError = (error: any) => {
    setDisplayedInfo({
      text: String(error),
      variant: 'error',
    })
  }
  const handleResult = (data: { text: string }, source: string) => {
    if (
      lastResultRef.current &&
      lastResultRef.current.text === data.text &&
      lastResultRef.current.time > Date.now() - DUPLICATE_WINDOW_MS
    ) {
      console.warn('[QR scanned] Ignored duplicate scan:', data, 'from', source)
      return
    }
    lastResultRef.current = { time: Date.now(), text: data.text }
    console.log('[QR scanned]', data, 'from', source)
    if (options.post === 'opener') {
      window.opener.postMessage(data, '*')
    } else if (options.post === 'parent') {
      window.parent.postMessage(data, '*')
    } else {
      setDisplayedInfo({
        text: data.text,
        variant: 'success',
      })
    }
  }
  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setTorchAvailable(false)
    setTorchEnabled(false)
  }

  const getBarcodeDetector = (): BarcodeDetectorCtor | undefined => {
    const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
    return w.BarcodeDetector
  }
  useEffect(() => {
    const enumerateCameras = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const videoInputs = devices.filter(
          (device) => device.kind === 'videoinput',
        )
        setCameras(videoInputs)
      } catch (error) {
        console.error('[enumerateDevices]', error)
      }
    }

    const startBarcodeDetector = () => {
      const Detector = getBarcodeDetector()
      if (!Detector) return () => {}
      let cancelled = false
      const barcodeDetectionWorker = async () => {
        const barcodeDetector = new Detector()
        while (!cancelled) {
          try {
            if (video.current && video.current.videoWidth) {
              const barcodes = await barcodeDetector.detect(video.current)
              for (const barcode of barcodes) {
                if (barcode.rawValue)
                  handleResult({ text: barcode.rawValue }, 'native')
              }
            }
          } catch (e) {
            console.error('[BarcodeDetector]', e)
            await new Promise((resolve) => setTimeout(resolve, 1000))
          } finally {
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
        }
      }
      barcodeDetectionWorker()
      return () => {
        cancelled = true
      }
    }

    const startScanner = () => {
      let cancelled = false
      reader
        .decodeFromVideoDevice(currentDeviceId, video.current!, (result, err) => {
          if (cancelled) return
          const stream = video.current?.srcObject as MediaStream | null
          if (stream && streamRef.current !== stream) {
            streamRef.current = stream
            const track = stream.getVideoTracks()[0]
            if (track) {
              const settings = track.getSettings() as TorchSettings
              if ('torch' in settings) {
                setTorchAvailable(true)
                setTorchEnabled(Boolean(settings?.torch))
              } else {
                setTorchAvailable(false)
                setTorchEnabled(false)
              }
            }
            enumerateCameras()
          }
          if (result) {
            const data = JSON.parse(JSON.stringify(result))
            if (data.text) {
              handleResult(data, 'zxing')
            }
          } else if (err instanceof NotFoundException) {
            // expected
          } else if (err instanceof ChecksumException) {
            // expected
          } else if (err instanceof FormatException) {
            // expected
          } else if (err) {
            console.error(err)
            showError(err)
            setStopped(true)
          }
        })
        .catch((err) => {
          console.error(err)
          showError(err)
          setStopped(true)
        })
      return () => {
        cancelled = true
        resetReader()
        stopStream()
      }
    }

    if (stopped) {
      resetReader()
      stopStream()
      return
    }
    const stopBarcode = startBarcodeDetector()
    const stopScanner = startScanner()
    return () => {
      stopBarcode?.()
      stopScanner?.()
    }
  }, [currentDeviceId, stopped])

  const handleTorchToggle = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track || !torchAvailable) return
    const enable = !torchEnabled
    try {
      const constraints: TorchConstraints = {
        advanced: [{ torch: enable }],
      }
      await track.applyConstraints(constraints)
      setTorchEnabled(enable)
    } catch (error) {
      console.error(error)
      setDisplayedInfo({
        text: String(error),
        variant: 'error',
      })
    }
  }

  const processImageFile = async (file: File) => {
    let found = false
    const handleText = (text: string, source: string) => {
      found = true
      handleResult({ text }, source)
    }
    const Detector = getBarcodeDetector()
    if (Detector) {
      try {
        const bitmap = await createImageBitmap(file)
        const barcodeDetector = new Detector()
        const barcodes = await barcodeDetector.detect(bitmap)
        for (const barcode of barcodes) {
          if (barcode.rawValue) handleText(barcode.rawValue, 'native-image')
        }
        bitmap.close()
      } catch (error) {
        console.error('[BarcodeDetector][image]', error)
      }
    }
    if (!found) {
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const objectUrl = URL.createObjectURL(file)
          const element = new Image()
          element.onload = () => {
            URL.revokeObjectURL(objectUrl)
            resolve(element)
          }
          element.onerror = (err) => {
            URL.revokeObjectURL(objectUrl)
            reject(err)
          }
          element.src = objectUrl
        })
        const result = (await imageReader.decodeFromImageElement(
          img,
        )) as unknown as ZXingResult
        const text = result.getText?.() ?? result.text
        if (text && text.trim()) {
          handleText(text, 'zxing-image')
        }
      } catch (error) {
        if (
          !(error instanceof NotFoundException) &&
          !(error instanceof ChecksumException) &&
          !(error instanceof FormatException)
        ) {
          console.error('[ZXing][image]', error)
        }
      }
    }
    if (!found) {
      setDisplayedInfo({
        text: 'No QR code found in image',
        variant: 'error',
      })
    }
  }

  const handleFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        await processImageFile(file)
      }
    }
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length) {
        event.preventDefault()
        handleFiles(files)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])
  return (
    <div>
      {stopped ? (
        <div className="fixed inset-0 flex items-center justify-center">
          <button
            className="py-3 px-4 bg-gray-800 rounded-lg font-bold"
            onClick={() => setStopped(false)}
          >
            Retry
          </button>
        </div>
      ) : (
        <div
          className="fixed inset-0"
          onDragEnter={(event) => {
            if (event.dataTransfer.items.length) {
              event.preventDefault()
              setDragActive(true)
            }
          }}
          onDragOver={(event) => {
            event.preventDefault()
          }}
          onDragLeave={(event) => {
            if (
              event.target === event.currentTarget ||
              !event.currentTarget.contains(event.relatedTarget as Node)
            ) {
              setDragActive(false)
            }
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragActive(false)
            if (event.dataTransfer.files.length) {
              handleFiles(event.dataTransfer.files)
            }
          }}
        >
          <video
            ref={video}
            className={clsx('fixed top-0 left-0 w-screen h-screen', {
              'object-cover': options.fit === 'cover',
              'object-contain': options.fit !== 'cover',
            })}
            aria-label="QR code scanner camera feed"
            role="img"
            playsInline
            autoPlay
            muted
          />
        </div>
      )}

      {!!displayedInfo && (
        <div
          className={clsx('fixed top-0 left-0 right-0 text-white flex', {
            'bg-green-600': displayedInfo.variant === 'success',
            'bg-red-600': displayedInfo.variant === 'error',
          })}
        >
          <button
            className="flex-1 text-left p-4 hover:bg-black/20 break-words overflow-hidden"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(displayedInfo.text)
                setDisplayedInfo({ ...displayedInfo, copied: true })
              } catch (error) {
                alert(String(error))
              }
            }}
          >
            {displayedInfo.text}{' '}
            {displayedInfo.copied ? (
              <Icon inline icon={checkIcon} />
            ) : (
              <Icon inline icon={copyIcon} />
            )}
          </button>
          <button
            className="flex-none flex p-4 items-center hover:bg-black/20"
            onClick={() => setDisplayedInfo(null)}
          >
            <Icon icon={closeIcon} />
          </button>
        </div>
      )}

      {!stopped && (
        <div className="fixed top-4 right-4 flex flex-col gap-2 items-end">
          <div className="flex gap-2">
            {torchAvailable && (
              <button
                className={clsx(
                  'bg-black/60 text-white rounded-full px-3 py-2 backdrop-blur hover:bg-black/80',
                  torchEnabled && 'bg-amber-500 hover:bg-amber-600',
                )}
                onClick={handleTorchToggle}
                title="Toggle flashlight"
              >
                {torchEnabled ? 'Torch on' : 'Torch'}
              </button>
            )}
            <button
              className="bg-black/60 text-white rounded-full px-3 py-2 backdrop-blur hover:bg-black/80"
              onClick={() => fileInput.current?.click()}
              title="Scan from image"
            >
              Upload
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) {
                  handleFiles(event.target.files)
                  event.target.value = ''
                }
              }}
            />
            {cameras.length > 1 && (
              <div className="relative">
                <button
                  className="bg-black/60 text-white rounded-full px-3 py-2 backdrop-blur hover:bg-black/80"
                  onClick={() => setCameraMenuOpen((v) => !v)}
                  title="Switch camera"
                >
                  Camera
                </button>
                {cameraMenuOpen && (
                  <div className="absolute right-0 mt-2 bg-black/80 text-white rounded-lg shadow-lg overflow-hidden min-w-[200px]">
                    {cameras.map((camera) => (
                      <button
                        key={camera.deviceId}
                        className={clsx(
                          'block w-full text-left px-4 py-2 hover:bg-white/10',
                          currentDeviceId === camera.deviceId &&
                            'bg-white/10 font-semibold',
                        )}
                        onClick={() => {
                          setCameraMenuOpen(false)
                          setCurrentDeviceId(camera.deviceId)
                        }}
                      >
                        {camera.label || 'Camera'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="text-xs text-white/80 bg-black/40 rounded-full px-3 py-1 backdrop-blur">
            Tip: drag &amp; drop or paste images to scan
          </div>
        </div>
      )}

      {dragActive && (
        <div className="fixed inset-0 bg-black/60 text-white flex items-center justify-center pointer-events-none">
          <div className="text-lg font-semibold">Drop image to scan</div>
        </div>
      )}
    </div>
  )
}

function Home() {
  return (
    <div className="p-4">
      <h1 className="font-bold">qr.spacet.me</h1>
      <p>
        <a href="/?action=scan">[Scan]</a>
        <a href="/demo.html">[Demo]</a>
        <a href="https://github.com/dtinth/qr">[GitHub]</a>
      </p>
    </div>
  )
}

export default App
