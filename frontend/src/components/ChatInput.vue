<template>
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
        @keydown.enter.exact.prevent="handleSend"
      />

      <!-- Send — circular icon button -->
      <Button
        icon="pi pi-send"
        :disabled="!chatEnabled || !messageText.trim()"
        aria-label="Send"
        rounded
        class="send-btn flex-shrink-0"
        @click="handleSend"
      />
    </div>

  </footer>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import type { TransferProgress } from '../composables/useWebRTC'
import Button      from 'primevue/button'
import Textarea    from 'primevue/textarea'
import Tag         from 'primevue/tag'
import ProgressBar from 'primevue/progressbar'

const props = defineProps<{
  chatEnabled:      boolean
  isSendingFile:    boolean
  transferProgress: TransferProgress
}>()

const emit = defineEmits<{
  (e: 'send',      text: string): void
  (e: 'send-file', file: File):   void
}>()

const messageText  = ref('')
const textareaRef  = ref<{ $el: HTMLTextAreaElement } | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const progressPercent = computed(() =>
  props.transferProgress.max > 0
    ? Math.floor((props.transferProgress.value / props.transferProgress.max) * 100)
    : 0,
)

function handleSend() {
  const text = messageText.value.trim()
  if (!text) return
  emit('send', text)
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
  emit('send-file', file)
  input.value = ''  // reset so the same file can be re-selected if needed
}
</script>

<style scoped>
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
