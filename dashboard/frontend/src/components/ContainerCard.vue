<template>
  <div class="card" :class="container.state">
    <div class="info">
      <span class="name">{{ container.name }}</span>
      <span class="image">{{ container.image }}</span>
      <span class="status">{{ container.status }}</span>
    </div>
    <div class="actions">
      <button @click="$emit('logs', container.id)">Logs</button>
      <button @click="restart" :disabled="loading">Restart</button>
      <button @click="stop" :disabled="loading || container.state !== 'running'">Stop</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  container: {
    id: string
    name: string
    image: string
    status: string
    state: string
  }
}>()

const emit = defineEmits<{
  logs: [id: string]
  refresh: []
}>()

const loading = ref(false)

async function restart() {
  loading.value = true
  await fetch(`/api/containers/${props.container.id}/restart`, {
    method: 'POST',
    credentials: 'include',
  })
  emit('refresh')
  loading.value = false
}

async function stop() {
  loading.value = true
  await fetch(`/api/containers/${props.container.id}/stop`, {
    method: 'POST',
    credentials: 'include',
  })
  emit('refresh')
  loading.value = false
}
</script>

<style scoped>
.card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-radius: 8px;
  border: 1px solid #333;
  background: #1a1a2e;
  color: white;
}
.card.running { border-left: 4px solid #4caf50; }
.card.exited  { border-left: 4px solid #f44336; }
.info { display: flex; flex-direction: column; gap: 0.25rem; }
.name  { font-weight: bold; }
.image { font-size: 0.8rem; color: #aaa; }
.status { font-size: 0.75rem; }
.actions { display: flex; gap: 0.5rem; }
button {
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  border: 1px solid #555;
  background: #2a2a4e;
  color: white;
  cursor: pointer;
}
button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
