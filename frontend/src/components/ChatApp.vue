<template>
  <!-- ── JOIN SCREEN ──────────────────────────────────────────────────────────── -->
  <div
    v-if="!joinDisabled"
    class="flex align-items-center justify-content-center"
    style="min-height: 100vh"
  >
    <Card style="width: 420px; max-width: 96vw">
      <template #title>
        <div class="flex align-items-center gap-2">
          <i class="pi pi-wifi text-primary" style="font-size: 1.4rem"></i>
          <span>WebRTC P2P Chat</span>
        </div>
      </template>

      <template #content>
        <div class="flex flex-column gap-3">
          <div class="flex flex-column gap-1">
            <label for="room-id" class="font-semibold text-sm">Room ID</label>
            <InputText
              id="room-id"
              v-model="roomId"
              placeholder="Enter room ID"
              class="w-full"
              @keydown.enter="handleJoin"
            />
          </div>

          <Button
            label="Join Room"
            icon="pi pi-sign-in"
            class="w-full"
            @click="handleJoin"
          />
        </div>
      </template>
    </Card>
  </div>

  <!-- ── CHAT SCREEN ──────────────────────────────────────────────────────────── -->
  <div v-else class="chat-screen">

    <!-- ── Header ──────────────────────────────────────────────────────────────── -->
    <header class="chat-header surface-card flex-shrink-0 px-4 flex align-items-center gap-3">
      <!-- Avatar circle -->
      <div class="header-icon-wrap flex align-items-center justify-content-center flex-shrink-0">
        <i class="pi pi-comments"></i>
      </div>

      <!-- Room info -->
      <div class="flex flex-column overflow-hidden">
        <span class="header-room-name font-bold white-space-nowrap overflow-hidden text-overflow-ellipsis">
          {{ roomId }}
        </span>
        <span class="header-room-sub text-color-secondary">P2P · End-to-end encrypted</span>
      </div>

      <!-- Connection badge -->
      <Tag :value="status" :severity="statusSeverity" class="ml-auto flex-shrink-0" />
    </header>

    <!-- ── Incoming file offer — Dialog ────────────────────────────────────────── -->
    <Dialog
      v-model:visible="incomingFileUI.visible"
      header="📥 Incoming File"
      :modal="true"
      :closable="false"
      :close-on-escape="false"
      :style="{ width: '26rem' }"
    >
      <p class="m-0 line-height-3">{{ incomingFileUI.info }}</p>
      <template #footer>
        <div class="flex gap-2 justify-content-end">
          <Button label="Decline"      icon="pi pi-times"    severity="danger"  outlined @click="declineIncomingFile" />
          <Button label="Accept & Save" icon="pi pi-download" severity="success"          @click="acceptIncomingFile" />
        </div>
      </template>
    </Dialog>

    <!-- ── Message log ──────────────────────────────────────────────────────────── -->
    <div ref="messagesEl" class="message-log">
      <template v-for="(msg, i) in messages" :key="i">

        <!-- Self bubble — right-aligned -->
        <div v-if="msg.type === 'self'" class="flex justify-content-end mb-2">
          <div class="bubble bubble-self px-3 py-2 text-sm line-height-3">
            {{ msg.text }}
          </div>
        </div>

        <!-- Peer bubble — left-aligned -->
        <div v-else-if="msg.type === 'peer'" class="flex justify-content-start mb-2">
          <div class="bubble bubble-peer px-3 py-2 text-sm line-height-3">
            {{ msg.text }}
          </div>
        </div>

        <!-- System message — centred pill (date / service notification style) -->
        <div v-else class="flex justify-content-center mb-3 mt-1">
          <span class="system-msg px-3 py-1">
            {{ msg.text }}
          </span>
        </div>

      </template>
    </div>

    <!-- ── Footer ───────────────────────────────────────────────────────────────── -->
    <footer class="chat-footer surface-card flex-shrink-0">

      <!-- Sending indicator — appears above the input bar when active -->
      <div v-if="isSendingFile" class="flex justify-content-center pb-1">
        <Tag value="Sending file…" severity="warn" />
      </div>

      <!-- Transfer progress — compact single-line bar just above the input pill -->
      <div v-if="transferProgress.visible" class="flex align-items-center gap-3 pb-2 px-1">
        <span class="text-sm font-semibold white-space-nowrap transfer-label">
          {{ transferProgress.label }}
        </span>
        <div class="flex-1">
          <ProgressBar :value="progressPercent" style="height: 4px" />
        </div>
        <span class="text-xs text-color-secondary white-space-nowrap">{{ transferProgress.text }}</span>
      </div>

      <!-- Input bar: [attach] [textarea] [send] -->
      <div class="footer-inner flex align-items-end gap-2">

        <!-- Attachment — icon-only transparent button -->
        <input
          ref="fileInputRef"
          type="file"
          style="display: none"
          @change="onFileInputChange"
        />
        <Button
          icon="pi pi-paperclip"
          text
          rounded
          aria-label="Attach file"
          :disabled="!chatEnabled || isSendingFile"
          class="attach-btn flex-shrink-0"
          @click="fileInputRef?.click()"
        />

        <!-- Pill-shaped textarea -->
        <Textarea
          ref="textareaRef"
          v-model="messageText"
          placeholder="Message…"
          :disabled="!chatEnabled"
          :autoResize="true"
          rows="1"
          class="flex-1 chat-textarea"
          @keydown.enter.exact.prevent="handleSendMessage"
        />

        <!-- Send — circular icon button -->
        <Button
          icon="pi pi-send"
          :disabled="!chatEnabled || !messageText.trim()"
          aria-label="Send"
          rounded
          class="send-btn flex-shrink-0"
          @click="handleSendMessage"
        />
      </div>

    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useWebRTC } from '../composables/useWebRTC'

// ── PrimeVue components ──────────────────────────────────────────────────────
import Card        from 'primevue/card'
import InputText   from 'primevue/inputtext'   // join screen only
import Textarea    from 'primevue/textarea'
import Button      from 'primevue/button'
import Tag         from 'primevue/tag'
import Dialog      from 'primevue/dialog'
import ProgressBar from 'primevue/progressbar'

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
const roomId      = ref('')
const messageText = ref('')
const messagesEl  = ref<HTMLDivElement | null>(null)
const textareaRef = ref<{ $el: HTMLTextAreaElement } | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

// ── Derived: PrimeVue Tag severity from connection status text ───────────────
const statusSeverity = computed(() => {
  const s = status.value.toLowerCase()
  if (s.includes('connected') || s.includes('open') || s.includes('ready') || s.includes('saved') || s.includes('sent')) return 'success'
  if (s.includes('error') || s.includes('full') || s.includes('fail') || s.includes('declined') || s.includes('disconnect')) return 'danger'
  if (s.includes('waiting') || s.includes('sending') || s.includes('receiving') || s.includes('joined')) return 'warn'
  return 'secondary'
})

// ── Derived: 0-100 integer for PrimeVue ProgressBar ─────────────────────────
const progressPercent = computed(() =>
  transferProgress.max > 0
    ? Math.floor((transferProgress.value / transferProgress.max) * 100)
    : 0,
)

// ── Auto-scroll message log to bottom on every new message ───────────────────
watch(messages, async () => {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}, { deep: true })

// ── Handlers ─────────────────────────────────────────────────────────────────
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
  // autoResize doesn't shrink on value clear — manually reset the height
  nextTick(() => {
    if (textareaRef.value?.$el) {
      textareaRef.value.$el.style.height = 'auto'
    }
  })
}

async function onFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await sendFile(file)
  input.value = ''  // reset so the same file can be re-selected if needed
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

/* ════════════════════════════════════════════════════════════════════════════
   Header
   ════════════════════════════════════════════════════════════════════════════ */
.chat-header {
  height: 3.5rem;
  border-bottom: 1px solid var(--p-surface-border);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.07);
  /* z-index keeps the shadow on top of the message log */
  position: relative;
  z-index: 1;
}

/* Circular avatar */
.header-icon-wrap {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: var(--chat-icon-bg);
  color: var(--chat-icon-color);
  font-size: 1.1rem;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--chat-icon-bg) 60%, transparent);
}

.header-room-name {
  font-size: 0.9375rem;    /* ~15 px — Telegram-ish condensed title       */
  line-height: 1.2;
}

.header-room-sub {
  font-size: 0.72rem;
  line-height: 1.2;
}

/* ════════════════════════════════════════════════════════════════════════════
   Message log — wallpaper background, scrollable
   ════════════════════════════════════════════════════════════════════════════ */
.message-log {
  flex: 1;
  overflow-y: auto;
  background-color: var(--chat-log-bg);
  padding: 1rem 1.25rem;
  border-radius: 16px;
}

/* ════════════════════════════════════════════════════════════════════════════
   Chat bubbles
   ════════════════════════════════════════════════════════════════════════════ */
.bubble {
  max-width: 75%;
  word-break: break-word;
  white-space: pre-wrap;
}

/* Sent — Indigo primary, tail on bottom-right */
.bubble-self {
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color, #fff);
  border-radius: 12px 12px 0 12px;
  box-shadow: 0 1px 3px var(--chat-bubble-self-shadow);
}

/* Received — white / surface-700 dark, tail on bottom-left */
.bubble-peer {
  background: var(--chat-bubble-peer-bg);
  color: var(--chat-bubble-peer-color);
  border-radius: 12px 12px 12px 0;
  box-shadow: 0 1px 3px var(--chat-bubble-peer-shadow);
}

/* ════════════════════════════════════════════════════════════════════════════
   System / service notification pill (centred, semi-transparent)
   ════════════════════════════════════════════════════════════════════════════ */
.system-msg {
  display: inline-block;
  background: var(--chat-system-bg);
  color: var(--chat-system-color);
  border-radius: 10px;
  font-size: 0.72rem;
  letter-spacing: 0.015em;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

/* ════════════════════════════════════════════════════════════════════════════
   Footer — floating input bar
   ════════════════════════════════════════════════════════════════════════════ */
.chat-footer {
  flex-shrink: 0;
  padding: 0.5rem 0.875rem 0.75rem;
  box-shadow: var(--chat-footer-shadow);
  border-top: 1px solid var(--p-surface-border);
}

/* Inner container gives the "pill bar" its shape */
.footer-inner {
  background: var(--chat-footer-inner-bg);
  border: 1px solid var(--chat-footer-inner-border);
  border-radius: 26px;
  padding: 0.3rem 0.4rem 0.3rem 0.5rem;
  align-items: flex-end;
}

/* ── Pill-shaped textarea ──────────────────────────────────────────────── */
.chat-textarea {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
  border-radius: 24px !important;
  resize: none;
  max-height: 8rem;
  overflow-y: auto;
  padding: 0.45rem 0.6rem !important;
  /* match the footer-inner background so it blends in */
  color: inherit;
}

/* Remove the focus ring PrimeVue normally adds */
.chat-textarea:focus {
  box-shadow: none !important;
}

/* ── Transfer progress label — constrained so it never crowds the bar ─── */
.transfer-label {
  max-width: 30%;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Attachment button — icon-only, transparent ───────────────────────── */
/*   Sized to match the send button; PrimeVue `text` prop handles the     */
/*   transparent background/border — no deep overrides needed.            */
.attach-btn {
  width: 2.1rem !important;
  height: 2.1rem !important;
  min-width: 2.1rem !important;
  padding: 0 !important;
}

/* ── Send button — circular filled ───────────────────────────────────── */
.send-btn {
  width: 2.1rem !important;
  height: 2.1rem !important;
  min-width: 2.1rem !important;
  border-radius: 50% !important;
  padding: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}
</style>
