<template>
  <div class="log-viewer">
    <div class="header">
      <span>Logs — {{ containerId }}</span>
      <button @click="$emit('close')">✕</button>
    </div>
    <pre ref="logEl" class="logs">{{ logs }}</pre>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps<{ containerId: string }>()
defineEmits<{ close: [] }>()

const logs = ref('')
const logEl = ref<HTMLPreElement>()
let source: EventSource | null = null

onMounted(() => {
  source = new EventSource(`/api/containers/${props.containerId}/logs`, {
    withCredentials: true,
  })
  source.onmessage = async (e) => {
    logs.value += e.data + '\n'
    await nextTick()
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
  }
})

onUnmounted(() => source?.close())
</script>

<style scoped>
.log-viewer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40vh;
  background: #0d0d1a;
  border-top: 2px solid #333;
  display: flex;
  flex-direction: column;
}
.header {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  background: #1a1a2e;
  color: white;
}
.logs {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 1rem;
  color: #00ff88;
  font-size: 0.8rem;
  margin: 0;
}
</style>
