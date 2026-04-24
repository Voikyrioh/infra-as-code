import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser'

export function useWebAuthn() {
  async function register(): Promise<void> {
    const optRes = await fetch('/auth/register/options', { credentials: 'include' })
    const options = await optRes.json()

    const credential = await startRegistration({ optionsJSON: options })

    const verifyRes = await fetch('/auth/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(credential),
    })

    const result = await verifyRes.json()
    if (!result.verified) throw new Error('Registration failed')
  }

  async function login(): Promise<void> {
    const optRes = await fetch('/auth/login/options', { credentials: 'include' })
    const options = await optRes.json()

    const credential = await startAuthentication({ optionsJSON: options })

    const verifyRes = await fetch('/auth/login/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(credential),
    })

    const result = await verifyRes.json()
    if (!result.verified) throw new Error('Login failed')
  }

  async function logout(): Promise<void> {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
  }

  return { register, login, logout }
}
