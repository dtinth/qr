import { Icon } from '@iconify-icon/react'
import checkIcon from '@iconify-icons/codicon/check'
import closeIcon from '@iconify-icons/codicon/close'
import copyIcon from '@iconify-icons/codicon/copy'
import deviceCameraVideoIcon from '@iconify-icons/codicon/device-camera-video'
import fileMediaIcon from '@iconify-icons/codicon/file-media'
import lightbulbIcon from '@iconify-icons/codicon/lightbulb'
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

function Scanner() {
  const video = useRef<HTMLVideoElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const requested = useRef<boolean>(false)
  const [stopped, setStopped] = useState<boolean>(false)
  const [displayedInfo, setDisplayedInfo] = useState<DisplayedInfo | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [selectedCamera, setSelectedCamera] = useState<string | undefined>(undefined)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [torchEnabled, setTorchEnabled] = useState<boolean>(false)
  const [torchSupported, setTorchSupported] = useState<boolean>(false)

  // Enumerate cameras after getting media access
  useEffect(() => {
    if (stream) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const videoDevices = devices.filter((d) => d.kind === 'videoinput')
        setCameras(videoDevices)
      })
    }
  }, [stream])

  // Check torch support
  useEffect(() => {
    if (stream) {
      const track = stream.getVideoTracks()[0]
      if (track) {
        const capabilities = track.getCapabilities?.() as any
        if (capabilities?.torch) {
          setTorchSupported(true)
        }
      }
    }
  }, [stream])

  // Handle torch toggle
  const toggleTorch = async () => {
    if (stream) {
      const track = stream.getVideoTracks()[0]
      if (track) {
        try {
          await track.applyConstraints({
            // @ts-ignore - torch is not in the type definition
            advanced: [{ torch: !torchEnabled }],
          })
          setTorchEnabled(!torchEnabled)
        } catch (error) {
          console.error('Failed to toggle torch:', error)
        }
      }
    }
  }

  // Handle camera switch
  const switchCamera = () => {
    if (cameras.length > 1) {
      const currentIndex = cameras.findIndex((c) => c.deviceId === selectedCamera)
      const nextIndex = (currentIndex + 1) % cameras.length
      setSelectedCamera(cameras[nextIndex].deviceId)
      setStopped(false)
      requested.current = false
    }
  }

  // Scan from image
  const scanImage = async (imageSource: ImageBitmapSource) => {
    try {
      // Try native BarcodeDetector first
      if ('BarcodeDetector' in window) {
        const w = window as unknown as {
          BarcodeDetector: {
            new (): {
              detect(image: ImageBitmapSource): Promise<
                {
                  rawValue: string
                }[]
              >
            }
          }
        }
        const barcodeDetector = new w.BarcodeDetector()
        const barcodes = await barcodeDetector.detect(imageSource)
        if (barcodes.length > 0 && barcodes[0].rawValue) {
          handleResult({ text: barcodes[0].rawValue }, 'native-image')
          return
        }
      }

      // Fallback to ZXing
      const result = await reader.decodeFromImageElement(imageSource as HTMLImageElement)
      if (result) {
        const data = JSON.parse(JSON.stringify(result))
        if (data.text) {
          handleResult(data, 'zxing-image')
        }
      }
    } catch (error) {
      console.error('Failed to scan image:', error)
      setDisplayedInfo({
        text: 'No QR code found in image',
        variant: 'error',
      })
    }
  }

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const img = new Image()
      img.onload = () => scanImage(img)
      img.src = URL.createObjectURL(file)
    }
  }

  // Handle drag and drop
  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      const img = new Image()
      img.onload = () => scanImage(img)
      img.src = URL.createObjectURL(file)
    }
  }

  // Handle clipboard paste
  useEffect(() => {
    const handlePaste = async (event: Event) => {
      const clipboardEvent = event as ClipboardEvent
      const items = clipboardEvent.clipboardData?.items
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            const file = items[i].getAsFile()
            if (file) {
              const img = new Image()
              img.onload = () => scanImage(img)
              img.src = URL.createObjectURL(file)
            }
          }
        }
      }
    }
    window.addEventListener('paste', handlePaste as EventListener)
    return () => window.removeEventListener('paste', handlePaste as EventListener)
  }, [])

  let lastResult: { time: number; text: string } | null = null
  const handleResult = (data: { text: string }, source: string) => {
    if (
      lastResult &&
      lastResult.text === data.text &&
      lastResult.time > Date.now() - 1000
    ) {
      console.warn(
        '[QR scanned] Ignored duplicate scan:',
        data,
        'from',
        source,
      )
      return
    }
    lastResult = { time: Date.now(), text: data.text }
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

  useEffect(() => {
    if (stopped) {
      requested.current = false
      return
    }
    if (requested.current) return
    requested.current = true
    const showError = (error: any) => {
      setDisplayedInfo({
        text: String(error),
        variant: 'error',
      })
    }

    if ('BarcodeDetector' in window) {
      const barcodeDetectionWorker = async () => {
        const w = window as unknown as {
          BarcodeDetector: {
            new (): {
              detect(image: ImageBitmapSource): Promise<
                {
                  rawValue: string
                }[]
              >
            }
          }
        }
        const barcodeDetector = new w.BarcodeDetector()
        for (;;) {
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
    }
    reader
      .decodeFromVideoDevice(selectedCamera, video.current!, (result: any, err: any, controls: any) => {
        // Capture the stream
        if (controls) {
          const mediaStream = controls.streamVideoConstraintsApply?.stream
          if (mediaStream) {
            setStream(mediaStream)
          }
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
  }, [stopped, selectedCamera])

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
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
        <video
          ref={video}
          className={clsx('fixed top-0 left-0 w-screen h-screen', {
            'object-cover': options.fit === 'cover',
          })}
        />
      )}

      {/* Floating control buttons */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2">
        {/* Camera switch button */}
        {cameras.length > 1 && (
          <button
            className="p-4 bg-gray-800/80 hover:bg-gray-700 rounded-full text-white backdrop-blur"
            onClick={switchCamera}
            title="Switch camera"
          >
            <Icon icon={deviceCameraVideoIcon} width="24" height="24" />
          </button>
        )}

        {/* Torch/Flashlight toggle */}
        {torchSupported && (
          <button
            className={clsx('p-4 rounded-full text-white backdrop-blur', {
              'bg-yellow-600/80 hover:bg-yellow-500': torchEnabled,
              'bg-gray-800/80 hover:bg-gray-700': !torchEnabled,
            })}
            onClick={toggleTorch}
            title="Toggle flashlight"
          >
            <Icon icon={lightbulbIcon} width="24" height="24" />
          </button>
        )}

        {/* Image upload button */}
        <button
          className="p-4 bg-gray-800/80 hover:bg-gray-700 rounded-full text-white backdrop-blur"
          onClick={() => fileInput.current?.click()}
          title="Upload image"
        >
          <Icon icon={fileMediaIcon} width="24" height="24" />
        </button>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

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
