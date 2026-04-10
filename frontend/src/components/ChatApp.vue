<template>
  <!-- ── JOIN SCREEN ──────────────────────────────────────────────────────────── -->
  <JoinScreen v-if="!joinDisabled" @join="handleJoin" />

  <!-- ── CHAT SCREEN ──────────────────────────────────────────────────────────── -->
  <div v-else class="chat-screen">
    <ChatHeader :room-id="roomId" :status="status" />

    <IncomingFileDialog
      v-model:visible="incomingFileUI.visible"
      :info="incomingFileUI.info"
      @accept="acceptIncomingFile"
      @decline="declineIncomingFile"
    />

    <MessageLog :messages="messages" />

    <ChatInput
      :chat-enabled="chatEnabled"
      :is-sending-file="isSendingFile"
      :transfer-progress="transferProgress"
      @send="sendMessage"
      @send-file="sendFile"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useWebRTC } from '../composables/useWebRTC'

// ── Child components ─────────────────────────────────────────────────────────
import JoinScreen         from './JoinScreen.vue'
import ChatHeader         from './ChatHeader.vue'
import MessageLog         from './MessageLog.vue'
import ChatInput          from './ChatInput.vue'
import IncomingFileDialog from './IncomingFileDialog.vue'

// ── Composable ───────────────────────────────────────────────────────────────
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

// ── Local state ──────────────────────────────────────────────────────────────
const roomId = ref('')

// ── Handlers ─────────────────────────────────────────────────────────────────
function handleJoin(id: string) {
  roomId.value = id
  joinRoom(id)
}
</script>

<style scoped>
/* ════════════════════════════════════════════════════════════════════════════
   Chat screen — fills #app (flex column, min-height 100svh)
   ════════════════════════════════════════════════════════════════════════════ */
.chat-screen {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;         /* only .message-log scrolls                    */
  max-width: 1000px;
  width: 100%;
  margin-inline: auto;
  text-align: left;         /* override any #app { text-align: center }     */
  height: 100vh;
}
</style>
