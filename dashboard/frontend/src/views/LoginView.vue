<template>
  <div class="login">
    <h1>VPS Dashboard</h1>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-if="!isRegistered">
      <p>Aucune passkey enregistrée. Commence par enregistrer ta biométrie.</p>
      <button @click="handleRegister" :disabled="loading">
        {{ loading ? 'Enregistrement...' : 'Enregistrer ma passkey' }}
      </button>
    </div>

    <div v-else>
      <button @click="handleLogin" :disabled="loading">
        {{ loading ? 'Authentification...' : 'Se connecter avec biométrie' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWebAuthn } from '../composables/useWebAuthn.js'

const router = useRouter()
const { register, login } = useWebAuthn()

const isRegistered = ref(false)
const loading = ref(false)
const error = ref('')

onMounted(async () => {
  const res = await fetch('/auth/status')
  const data = await res.json()
  isRegistered.value = data.registered
})

async function handleRegister() {
  loading.value = true
  error.value = ''
  try {
    await register()
    isRegistered.value = true
  } catch (e: any) {
    error.value = e.message ?? "Erreur lors de l'enregistrement"
  } finally {
    loading.value = false
  }
}

async function handleLogin() {
  loading.value = true
  error.value = ''
  try {
    await login()
    router.push('/dashboard')
  } catch (e: any) {
    error.value = e.message ?? 'Erreur lors de la connexion'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 1rem;
  font-family: system-ui, sans-serif;
}
.error { color: red; }
button {
  padding: 0.75rem 2rem;
  font-size: 1rem;
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid #ccc;
  background: #1a1a2e;
  color: white;
}
button:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
