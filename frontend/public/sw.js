// Service worker for native-file-system-adapter streaming downloads.
// Handles both transferable streams (modern) and message-channel (fallback).
// Source: https://github.com/jimmywarting/native-file-system-adapter/blob/master/example/sw.js

const WRITE = 0
const PULL  = 0
const ERROR = 1
const ABORT = 1
const CLOSE = 2

class MessagePortSource {
  constructor (port) {
    this.port = port
    this.port.onmessage = evt => this.onMessage(evt.data)
  }

  start (controller) {
    this.controller = controller
  }

  pull () {
    this.port.postMessage({ type: PULL })
  }

  cancel (reason) {
    this.port.postMessage({ type: ERROR, reason: reason.message })
    this.port.close()
  }

  onMessage (message) {
    if (message.type === WRITE) this.controller.enqueue(message.chunk)
    if (message.type === ABORT) { this.controller.error(message.reason); this.port.close() }
    if (message.type === CLOSE) { this.controller.close(); this.port.close() }
  }
}

self.addEventListener('install',  () => self.skipWaiting())
self.addEventListener('activate', evt => evt.waitUntil(self.clients.claim()))

const map = new Map()

globalThis.addEventListener('message', evt => {
  const data = evt.data
  if (data && data.type === 'native-file-system-adapter/ping') {
    evt.ports[0].postMessage({ type: 'native-file-system-adapter/pong' })
    return
  }
  if (data.url && data.readable) {
    data.rs = data.readable
    map.set(data.url, data)
  } else if (data.url && data.readablePort) {
    data.rs = new ReadableStream(
      new MessagePortSource(evt.data.readablePort),
      new CountQueuingStrategy({ highWaterMark: 4 })
    )
    map.set(data.url, data)
  }
})

globalThis.addEventListener('fetch', evt => {
  const data = map.get(evt.request.url)
  if (!data) return null
  map.delete(evt.request.url)
  evt.respondWith(new Response(data.rs, { headers: data.headers }))
})
