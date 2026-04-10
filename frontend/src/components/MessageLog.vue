<template>
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
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { Message } from '../composables/useWebRTC'

const props = defineProps<{
  messages: Message[]
}>()

const messagesEl = ref<HTMLDivElement | null>(null)

watch(
  () => props.messages,
  async () => {
    await nextTick()
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  },
  { deep: true },
)
</script>

<style scoped>
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
</style>
