<template>
  <div class="app">
    <h1>Simple WebRTC P2P Chat</h1>

    <!-- Room join -->
    <div class="row">
      <input
        v-model="roomId"
        type="text"
        placeholder="Enter room ID"
        :disabled="joinDisabled"
        @keydown.enter="handleJoin"
      />
      <button @click="handleJoin" :disabled="joinDisabled">Join Room</button>
    </div>

    <!-- Connection status -->
    <div class="status">{{ status }}</div>

    <!-- Message log -->
    <div class="messages" ref="messagesEl">
      <div v-for="(msg, i) in messages" :key="i" :class="['msg', msg.type]">
        {{ msg.text }}
      </div>
    </div>

    <!-- Text chat -->
    <div class="row">
      <input
        v-model="messageText"
        type="text"
        placeholder="Type a message"
        :disabled="!chatEnabled"
        @keydown.enter="handleSendMessage"
      />
      <button @click="handleSendMessage" :disabled="!chatEnabled">Send</button>
    </div>

    <!-- File send -->
    <div class="row">
      <input type="file" ref="fileInputEl" :disabled="!chatEnabled || isSendingFile" />
      <button
        @click="handleSendFile"
        :disabled="!chatEnabled || isSendingFile"
        class="send-file-btn"
      >Send File</button>
    </div>

    <!-- Transfer progress bar -->
    <div v-if="transferProgress.visible" class="transfer-progress">
      <div class="transfer-progress-label">{{ transferProgress.label }}</div>
      <progress
        class="transfer-progress-bar"
        :value="transferProgress.value"
        :max="transferProgress.max"
      ></progress>
      <div class="transfer-progress-text">{{ transferProgress.text }}</div>
    </div>

    <!-- Incoming file offer -->
    <div v-if="incomingFileUI.visible" class="incoming-file-ui">
      <p class="incoming-file-info">{{ incomingFileUI.info }}</p>
      <div class="row" style="margin-bottom: 0">
        <button class="btn-accept" @click="acceptIncomingFile">💾 Accept &amp; Save</button>
        <button class="btn-decline" @click="declineIncomingFile">✖ Decline</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { useWebRTC } from '../composables/useWebRTC'

const {
  status,
  messages,
  chatEnabled,
  joinDisabled,
  isSendingFile,
  incomingFileUI,
  transferProgress,
  joinRoom,
  sendMessage,
  sendFile,
  acceptIncomingFile,
  declineIncomingFile,
} = useWebRTC()

const roomId      = ref('')
const messageText = ref('')
const fileInputEl = ref<HTMLInputElement | null>(null)
const messagesEl  = ref<HTMLDivElement | null>(null)

// Auto-scroll message log to bottom whenever a new message is appended.
watch(messages, async () => {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}, { deep: true })

function handleJoin() {
  const id = roomId.value.trim()
  if (!id) return
  joinRoom(id)
}

function handleSendMessage() {
  const text = messageText.value.trim()
  if (!text) return
  sendMessage(text)
  messageText.value = ''
}

async function handleSendFile() {
  const file = fileInputEl.value?.files?.[0]
  if (!file) return
  await sendFile(file)
  if (fileInputEl.value) fileInputEl.value.value = ''
}
</script>

<style scoped>
.app {
  font-family: Arial, sans-serif;
  max-width: 720px;
  margin: 40px auto;
  padding: 0 16px;
}

.status { margin-bottom: 8px; }

.messages {
  border: 1px solid #ccc;
  height: 320px;
  overflow-y: auto;
  padding: 12px;
  margin: 16px 0;
  border-radius: 8px;
}

.row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

input, button { padding: 10px; font-size: 14px; }
input[type='text']  { flex: 1; }
input[type='file']  { flex: 1; padding: 6px 10px; }
.send-file-btn      { white-space: nowrap; }

.msg    { margin: 8px 0; }
.self   { color: blue; }
.peer   { color: green; }
.system { color: #777; font-style: italic; }

/* ── Incoming file offer ─────────────────────────────────────────────────── */
.incoming-file-ui {
  display: block;
  background: #f0f8ff;
  border: 1px solid #4a9eff;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
.incoming-file-info {
  margin: 0 0 10px 0;
  font-weight: bold;
  font-size: 14px;
}
.btn-accept { background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; }
.btn-decline { background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; }

/* ── Transfer progress bar ───────────────────────────────────────────────── */
.transfer-progress {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 12px;
  background: #fafafa;
}
.transfer-progress-label {
  font-weight: bold;
  font-size: 14px;
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.transfer-progress-bar {
  width: 100%;
  height: 14px;
  border-radius: 4px;
  margin-bottom: 4px;
  appearance: none;
  -webkit-appearance: none;
  border: none;
}
.transfer-progress-bar::-webkit-progress-bar   { background: #e0e0e0; border-radius: 4px; }
.transfer-progress-bar::-webkit-progress-value { background: #4a9eff; border-radius: 4px; }
.transfer-progress-bar::-moz-progress-bar      { background: #4a9eff; border-radius: 4px; }
.transfer-progress-text { font-size: 12px; color: #555; }
</style>
