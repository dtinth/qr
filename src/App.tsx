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
  const requested = useRef<boolean>(false)
  const [stopped, setStopped] = useState<boolean>(false)
  const [displayedInfo, setDisplayedInfo] = useState<DisplayedInfo | null>(null)
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
      .decodeFromVideoDevice(undefined, video.current!, (result, err) => {
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
  }, [stopped])
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
        <video
          ref={video}
          className={clsx('fixed top-0 left-0 w-screen h-screen', {
            'object-cover': options.fit === 'cover',
          })}
        />
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
