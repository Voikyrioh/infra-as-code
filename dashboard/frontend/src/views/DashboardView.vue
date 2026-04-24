<template>
  <div class="dashboard">
    <header>
      <h1>VPS Dashboard</h1>
      <button @click="handleLogout">Déconnexion</button>
    </header>

    <main>
      <div class="controls">
        <button @click="loadContainers">↻ Rafraîchir</button>
      </div>

      <div class="containers">
        <ContainerCard
          v-for="c in containers"
          :key="c.id"
          :container="c"
          @logs="openLogs"
          @refresh="loadContainers"
        />
      </div>
    </main>

    <LogViewer
      v-if="activeLogId"
      :container-id="activeLogId"
      @close="activeLogId = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import ContainerCard from '../components/ContainerCard.vue'
import LogViewer from '../components/LogViewer.vue'
import { useWebAuthn } from '../composables/useWebAuthn.js'

const router = useRouter()
const { logout } = useWebAuthn()

const containers = ref<any[]>([])
const activeLogId = ref<string | null>(null)

async function loadContainers() {
  const res = await fetch('/api/containers', { credentials: 'include' })
  if (res.status === 401) { router.push('/'); return }
  containers.value = await res.json()
}

function openLogs(id: string) {
  activeLogId.value = id
}

async function handleLogout() {
  await logout()
  router.push('/')
}

onMounted(loadContainers)
</script>

<style scoped>
.dashboard { font-family: system-ui, sans-serif; background: #0d0d1a; min-height: 100vh; color: white; }
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: #1a1a2e;
  border-bottom: 1px solid #333;
}
main { padding: 2rem; }
.controls { margin-bottom: 1rem; }
.containers { display: flex; flex-direction: column; gap: 0.75rem; }
button {
  padding: 0.4rem 1rem;
  border-radius: 4px;
  border: 1px solid #555;
  background: #2a2a4e;
  color: white;
  cursor: pointer;
}
</style>
