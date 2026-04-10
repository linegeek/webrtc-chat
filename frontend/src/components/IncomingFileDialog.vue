<template>
  <Dialog
    :visible="visible"
    header="📥 Incoming File"
    :modal="true"
    :closable="false"
    :close-on-escape="false"
    :style="{ width: '26rem' }"
    @update:visible="emit('update:visible', $event)"
  >
    <p class="m-0 line-height-3">{{ info }}</p>
    <template #footer>
      <div class="flex gap-2 justify-content-end">
        <Button label="Decline"       icon="pi pi-times"    severity="danger"  outlined @click="emit('decline')" />
        <Button label="Accept & Save" icon="pi pi-download" severity="success"          @click="emit('accept')"  />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'

defineProps<{
  visible: boolean
  info:    string
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'accept'):  void
  (e: 'decline'): void
}>()
</script>
