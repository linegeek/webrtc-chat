<template>
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
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Tag from 'primevue/tag'

const props = defineProps<{
  roomId: string
  status: string
}>()

const statusSeverity = computed(() => {
  const s = props.status.toLowerCase()
  if (s.includes('connected') || s.includes('open') || s.includes('ready') || s.includes('saved') || s.includes('sent')) return 'success'
  if (s.includes('error') || s.includes('full') || s.includes('fail') || s.includes('declined') || s.includes('disconnect')) return 'danger'
  if (s.includes('waiting') || s.includes('sending') || s.includes('receiving') || s.includes('joined')) return 'warn'
  return 'secondary'
})
</script>

<style scoped>
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
</style>
