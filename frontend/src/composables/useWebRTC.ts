import { ref, reactive, onUnmounted } from 'vue'
import { showSaveFilePicker } from 'native-file-system-adapter'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface Message {
  text: string
  type: 'self' | 'peer' | 'system'
}

// ── Constants ─────────────────────────────────────────────────────────────────
const CHUNK_SIZE            = 64  * 1024         // 64 KB — safe for all browsers
const BUFFER_HIGH_THRESHOLD = 4   * 1024 * 1024  // pause sending above 4 MB
const BUFFER_LOW_THRESHOLD  = 1   * 1024 * 1024  // resume sending below 1 MB

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

// Register the service worker once (outside the composable so it only runs once)
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.warn('SW registration failed — streaming fallback may buffer in RAM:', err)
  })
}

export function useWebRTC() {
  // ── Reactive UI state ───────────────────────────────────────────────────────
  const status        = ref('Not connected')
  const messages      = ref<Message[]>([])
  const chatEnabled   = ref(false)
  const joinDisabled  = ref(false)
  const isSendingFile = ref(false)

  const incomingFileUI = reactive({ visible: false, info: '' })
  const transferProgress = reactive({
    visible: false,
    label:   '',
    value:   0,
    max:     100,
    text:    '',
  })

  // ── Internal WebRTC / file-transfer state (plain JS — no Vue reactivity) ────
  let socket:      WebSocket | null         = null
  let pc:          RTCPeerConnection | null = null
  let dataChannel: RTCDataChannel | null   = null
  let isInitiator  = false

  // Sender handshake promise handles
  let pendingFileAcceptResolve: (() => void)        | null = null
  let pendingFileAcceptReject:  ((e: Error) => void)| null = null

  // Receiver accumulation state
  let incomingFileMeta:     Record<string, any> | null = null
  let incomingWritable:     any                        = null // FileSystemWritableFileStream
  let incomingChunks:       ArrayBuffer[]              = []
  let incomingBytesReceived = 0
  let useStreamingSave      = false

  // Progress-bar throttle
  let transferStartTime  = 0
  let lastProgressUpdate = 0

  // ── Utility helpers ──────────────────────────────────────────────────────────
  function formatSize(bytes: number): string {
    if (bytes < 1024)               return `${bytes} B`
    if (bytes < 1024 * 1024)        return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  function logMessage(text: string, type: Message['type'] = 'system') {
    messages.value.push({ text, type })
  }

  function setStatus(text: string) { status.value = text }

  function setChatEnabled(enabled: boolean) { chatEnabled.value = enabled }

  // ── Transfer progress ────────────────────────────────────────────────────────
  function showTransferProgress(direction: 'send' | 'receive', filename: string, total: number) {
    transferProgress.label   = `${direction === 'send' ? '📤 Sending' : '📥 Receiving'} "${filename}"`
    transferProgress.value   = 0
    transferProgress.max     = total
    transferProgress.text    = `0% · 0 B of ${formatSize(total)}`
    transferProgress.visible = true
    transferStartTime  = Date.now()
    lastProgressUpdate = 0
  }

  // Throttled: at most one DOM update every 250 ms; last chunk always updates.
  function updateTransferProgress(loaded: number, total: number) {
    const now = Date.now()
    if (now - lastProgressUpdate < 250 && loaded < total) return
    lastProgressUpdate = now
    const pct     = total > 0 ? Math.floor((loaded / total) * 100) : 0
    const elapsed = (now - transferStartTime) / 1000
    const speed   = elapsed > 0.5 ? loaded / elapsed : 0
    transferProgress.value = loaded
    transferProgress.text  =
      `${pct}% · ${formatSize(loaded)} of ${formatSize(total)}` +
      (speed > 0 ? ` · ${formatSize(Math.round(speed))}/s` : '')
  }

  function hideTransferProgress() { transferProgress.visible = false }

  // ── Incoming file UI ─────────────────────────────────────────────────────────
  function showIncomingFileUI(meta: Record<string, any>) {
    incomingFileUI.info    = `📥 Incoming file: "${meta.filename}" (${formatSize(meta.size)})`
    incomingFileUI.visible = true
  }
  function hideIncomingFileUI() { incomingFileUI.visible = false }

  // ── RTCPeerConnection ────────────────────────────────────────────────────────
  function createPeerConnection() {
    pc = new RTCPeerConnection(rtcConfig)

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket!.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }))
      }
    }

    pc.ondatachannel = (event) => {
      dataChannel = event.channel
      setupDataChannel()
    }

    pc.onconnectionstatechange = () => {
      setStatus(`Connection state: ${pc!.connectionState}`)
      if (pc!.connectionState === 'connected') {
        setChatEnabled(true)
        logMessage('P2P connection established')
      }
    }
  }

  function setupDataChannel() {
    if (!dataChannel) return
    dataChannel.binaryType = 'arraybuffer'

    dataChannel.onopen = () => {
      setStatus('Data channel open')
      setChatEnabled(true)
      logMessage('Chat channel is ready')
    }

    dataChannel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        handleTextMessage(event.data)
      } else if (event.data instanceof ArrayBuffer) {
        handleBinaryChunk(event.data)
      }
    }

    dataChannel.onclose = () => {
      setChatEnabled(false)
      logMessage('Chat channel closed')
    }
  }

  function handleTextMessage(raw: string) {
    let parsed: Record<string, any> | null = null
    try { parsed = JSON.parse(raw) } catch (_) { /* not JSON — plain text */ }

    if (parsed?.type === 'file-meta') {
      incomingFileMeta      = parsed
      incomingBytesReceived = 0
      incomingChunks        = []
      incomingWritable      = null
      useStreamingSave      = false
      showIncomingFileUI(parsed)
    } else if (parsed?.type === 'file-accept') {
      pendingFileAcceptResolve?.()
      pendingFileAcceptResolve = null
      pendingFileAcceptReject  = null
    } else if (parsed?.type === 'file-cancel') {
      if (pendingFileAcceptReject) {
        pendingFileAcceptReject(new Error('Peer declined the file transfer'))
        pendingFileAcceptResolve = null
        pendingFileAcceptReject  = null
      }
    } else {
      logMessage(`Peer: ${raw}`, 'peer')
    }
  }

  function handleBinaryChunk(buffer: ArrayBuffer) {
    if (!incomingFileMeta) return
    incomingBytesReceived += buffer.byteLength

    if (useStreamingSave && incomingWritable) {
      // Always pass Uint8Array: FSAPI accepts it, StreamSaver requires it.
      incomingWritable.write(new Uint8Array(buffer)).catch((err: Error) => {
        logMessage(`❌ Disk write error: ${err.message}`, 'system')
      })
    } else {
      incomingChunks.push(buffer)
    }

    updateTransferProgress(incomingBytesReceived, incomingFileMeta.size)
    if (incomingBytesReceived >= incomingFileMeta.size) receiveFile()
  }

  // ── acceptIncomingFile — "Accept & Save" button ──────────────────────────────
  // Uses showSaveFilePicker ponyfill; preferred methods in priority order:
  //   1. 'native'                 — FSAPI (Chrome/Edge 86+): OS save dialog
  //   2. 'sw-transferable-stream' — SW intercepts fetch, streams to disk
  //      'sw-message-channel'       (Firefox, Safari, older Chrome): no RAM use
  //
  // 'constructing-blob' intentionally excluded — buffers everything in RAM.
  async function acceptIncomingFile() {
    if (!incomingFileMeta) return
    hideIncomingFileUI()

    try {
      const handle = await showSaveFilePicker({
        suggestedName: incomingFileMeta.filename,
        // _preferredMethods is a non-standard extension of the ponyfill
        _preferredMethods: ['native', 'sw-transferable-stream', 'sw-message-channel'],
      } as Parameters<typeof showSaveFilePicker>[0])
      incomingWritable = await handle.createWritable()
      useStreamingSave = true
      logMessage(`💾 Streaming "${incomingFileMeta.filename}" directly to disk...`, 'system')
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // User dismissed the native save dialog — cancel transfer
        dataChannel!.send(JSON.stringify({ type: 'file-cancel' }))
        incomingFileMeta = null
        return
      }
      // All streaming methods unavailable — fall back to in-memory accumulation
      incomingChunks   = []
      useStreamingSave = false
      logMessage(
        `⚠️ Streaming unavailable (${err.message}) — receiving into memory. Very large files may fail.`,
        'system',
      )
    }

    showTransferProgress('receive', incomingFileMeta.filename, incomingFileMeta.size)
    dataChannel!.send(JSON.stringify({ type: 'file-accept' }))
  }

  // ── declineIncomingFile ──────────────────────────────────────────────────────
  function declineIncomingFile() {
    if (!incomingFileMeta) return
    hideIncomingFileUI()
    dataChannel!.send(JSON.stringify({ type: 'file-cancel' }))
    logMessage(`❌ Declined "${incomingFileMeta.filename}"`, 'system')
    incomingFileMeta = null
  }

  // ── receiveFile — called when the last byte arrives ──────────────────────────
  async function receiveFile() {
    const meta        = incomingFileMeta!
    const chunks      = incomingChunks
    const writable    = incomingWritable
    const wasStreaming = useStreamingSave

    // Reset so the next transfer can start immediately
    incomingFileMeta      = null
    incomingChunks        = []
    incomingWritable      = null
    incomingBytesReceived = 0
    useStreamingSave      = false
    hideTransferProgress()

    if (wasStreaming && writable) {
      // Streaming path: data is already on disk — just close the writable.
      try {
        await writable.close()
        logMessage(`✅ "${meta.filename}" (${formatSize(meta.size)}) saved to disk!`, 'system')
      } catch (err: any) {
        logMessage(`❌ Error finalising "${meta.filename}": ${err.message}`, 'system')
        console.error(err)
      }
    } else {
      // In-memory fallback: assemble chunks → Blob → download link.
      try {
        const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0)
        const merged = new Uint8Array(totalLength)
        let off = 0
        for (const chunk of chunks) { merged.set(new Uint8Array(chunk), off); off += chunk.byteLength }

        const blob = new Blob([merged], { type: meta.fileType || 'application/octet-stream' })
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = meta.filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        logMessage(`✅ "${meta.filename}" (${formatSize(meta.size)}) received and downloaded!`, 'system')
      } catch (err: any) {
        logMessage(`❌ Error saving "${meta.filename}": ${err.message}`, 'system')
        console.error(err)
      }
    }
  }

  // ── sendFile — streams in CHUNK_SIZE slices; never loads whole file in RAM ───
  async function sendFile(file: File) {
    if (!dataChannel || dataChannel.readyState !== 'open') return
    isSendingFile.value = true

    try {
      // 1. Advertise the file — receiver shows Accept / Decline prompt
      dataChannel.send(JSON.stringify({ type: 'file-meta', filename: file.name, fileType: file.type, size: file.size }))
      logMessage(`📤 Offering "${file.name}" (${formatSize(file.size)}) — waiting for peer to accept…`, 'system')

      // 2. Wait for receiver to accept (or reject) via handshake message
      await new Promise<void>((resolve, reject) => {
        pendingFileAcceptResolve = resolve
        pendingFileAcceptReject  = reject
      })

      showTransferProgress('send', file.name, file.size)
      logMessage(`Sending "${file.name}" (${formatSize(file.size)})…`, 'self')

      // 3. Event-driven backpressure via bufferedAmountLowThreshold
      dataChannel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD
      let drainResolve: (() => void) | null = null
      dataChannel.onbufferedamountlow = () => { if (drainResolve) { drainResolve(); drainResolve = null } }

      // 4. Stream one slice at a time — only CHUNK_SIZE bytes in RAM at once
      let offset = 0
      while (offset < file.size) {
        if (dataChannel.bufferedAmount > BUFFER_HIGH_THRESHOLD) {
          await new Promise<void>(r => { drainResolve = r })
        }
        const slice  = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size))
        const buffer = await slice.arrayBuffer()
        dataChannel.send(buffer)
        offset += buffer.byteLength
        updateTransferProgress(offset, file.size)
        await new Promise<void>(r => setTimeout(r, 0)) // yield — keeps UI responsive
      }

      dataChannel.onbufferedamountlow = null
      hideTransferProgress()
      logMessage(`✅ "${file.name}" sent successfully!`, 'self')
    } catch (err: any) {
      hideTransferProgress()
      logMessage(`❌ Error sending "${file.name}": ${err.message}`, 'system')
      console.error(err)
      pendingFileAcceptResolve = null
      pendingFileAcceptReject  = null
    }

    isSendingFile.value = false
  }

  // ── Signaling ────────────────────────────────────────────────────────────────
  async function makeOffer() {
    createPeerConnection()
    dataChannel = pc!.createDataChannel('chat')
    setupDataChannel()
    const offer = await pc!.createOffer()
    await pc!.setLocalDescription(offer)
    socket!.send(JSON.stringify({ type: 'offer', offer }))
  }

  async function handleOffer(offer: RTCSessionDescriptionInit) {
    createPeerConnection()
    await pc!.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await pc!.createAnswer()
    await pc!.setLocalDescription(answer)
    socket!.send(JSON.stringify({ type: 'answer', answer }))
  }

  async function handleAnswer(answer: RTCSessionDescriptionInit) {
    await pc!.setRemoteDescription(new RTCSessionDescription(answer))
  }

  async function handleCandidate(candidate: RTCIceCandidateInit) {
    try {
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (err) {
      console.error('Error adding ICE candidate:', err)
    }
  }

  // ── joinRoom — opens WebSocket to signaling server and drives the protocol ───
  function joinRoom(roomId: string) {
    socket = new WebSocket(`ws://${window.location.host}`)

    socket.onopen = () => {
      socket!.send(JSON.stringify({ type: 'join', roomId }))
      setStatus(`Joined room: ${roomId}`)
    }

    socket.onmessage = async (event) => {
      const data = JSON.parse(event.data as string) as Record<string, any>
      switch (data.type) {
        case 'full':
          setStatus('Room is full')
          logMessage('This room already has 2 peers')
          break
        case 'joined':
          isInitiator = data.peerCount === 1
          logMessage(isInitiator ? 'Waiting for another peer...' : 'Joined as second peer')
          break
        case 'ready':
          if (isInitiator && !pc) await makeOffer()
          break
        case 'offer':
          await handleOffer(data.offer as RTCSessionDescriptionInit)
          break
        case 'answer':
          await handleAnswer(data.answer as RTCSessionDescriptionInit)
          break
        case 'candidate':
          await handleCandidate(data.candidate as RTCIceCandidateInit)
          break
        case 'peer-left':
          setStatus('Peer left')
          setChatEnabled(false)
          logMessage('Peer disconnected')
          break
      }
    }

    socket.onclose = () => {
      setStatus('Disconnected from signaling server')
      setChatEnabled(false)
    }

    joinDisabled.value = true
  }

  // ── sendMessage ──────────────────────────────────────────────────────────────
  function sendMessage(text: string) {
    if (!dataChannel || dataChannel.readyState !== 'open') return
    dataChannel.send(text)
    logMessage(`You: ${text}`, 'self')
  }

  // ── Cleanup on component unmount ─────────────────────────────────────────────
  onUnmounted(() => {
    dataChannel?.close()
    pc?.close()
    socket?.close()
  })

  return {
    // State
    status,
    messages,
    chatEnabled,
    joinDisabled,
    isSendingFile,
    incomingFileUI,
    transferProgress,
    // Actions
    joinRoom,
    sendMessage,
    sendFile,
    acceptIncomingFile,
    declineIncomingFile,
  }
}


