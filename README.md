# qr.spacet.me

A popup QR code scanner that can be easily integrated into a web app. Powered by [@zxing/browser](https://www.npmjs.com/package/@zxing/browser) and browser’s built-in [BarcodeDetector API](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector) (if available). Both detectors are used to maximize the chance of successful scanning.

**Try it in your JavaScript console.** Copy the following code and paste it into your browser's console.

```js
await new Promise((resolve) => {
  const w = window.open(
    'https://qr.spacet.me/?action=scan&fit=cover&delay=100&post=opener',
    '_blank',
    'width=320,height=320,toolbar=no',
  )
  const onMessage = (e) => {
    if (e.source === w && e.data.text) {
      resolve(e.data.text)
      w.close()
      removeEventListener('message', onMessage)
    }
  }
  addEventListener('message', onMessage)
})
```
