<template>
  <div
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
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Card      from 'primevue/card'
import InputText from 'primevue/inputtext'
import Button    from 'primevue/button'

const emit = defineEmits<{
  (e: 'join', roomId: string): void
}>()

const roomId = ref('')

function handleJoin() {
  const id = roomId.value.trim()
  if (!id) return
  emit('join', id)
}
</script>
