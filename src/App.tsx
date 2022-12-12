import { BrowserQRCodeReader } from '@zxing/browser'
import {
  ChecksumException,
  FormatException,
  NotFoundException,
} from '@zxing/library'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify-icon/react'
import closeIcon from '@iconify-icons/codicon/close'
import copyIcon from '@iconify-icons/codicon/copy'
import checkIcon from '@iconify-icons/codicon/check'
import clsx from 'clsx'

const params = new URLSearchParams(window.location.search)
const options = {
  delay: +params.get('delay')! || 500,
  fit: params.get('fit') === 'cover' ? 'cover' : 'contain',
  post: params.get('post'),
}
const action = params.get('action') || 'home'

const reader = new BrowserQRCodeReader(undefined, {
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
  const [displayedInfo, setDisplayedInfo] = useState<DisplayedInfo | null>(null)
  useEffect(() => {
    if (requested.current) return
    requested.current = true
    reader.decodeFromVideoDevice(undefined, video.current!, (result, err) => {
      if (result) {
        const data = JSON.parse(JSON.stringify(result))
        console.log(data)
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
      } else if (err instanceof NotFoundException) {
        // expected
      } else if (err instanceof ChecksumException) {
        // expected
      } else if (err instanceof FormatException) {
        // expected
      } else if (err) {
        console.error(err)
      }
    })
  }, [])
  return (
    <div>
      <video
        ref={video}
        className={clsx('fixed top-0 left-0 w-screen h-screen', {
          'object-cover': options.fit === 'cover',
        })}
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
