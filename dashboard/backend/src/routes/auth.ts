import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types'
import { db, createSession, deleteSession } from '../lib/db.js'

const RP_NAME = 'VPS Dashboard'
const RP_ID = process.env.RP_ID ?? 'localhost'
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5173'

// Challenge temporaire en mémoire (usage single-user)
let currentChallenge: string | undefined

export const authRouter = new Hono()

// Vérifie si au moins un credential est enregistré
authRouter.get('/status', (c) => {
  const count = (db.prepare('SELECT COUNT(*) as count FROM credentials').get() as any).count
  return c.json({ registered: count > 0 })
})

// === REGISTRATION ===

authRouter.get('/register/options', async (c) => {
  const existing = db.prepare('SELECT id FROM credentials').all() as any[]

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode('admin'),
    userName: 'admin',
    excludeCredentials: existing.map(cred => ({
      id: cred.id,
      type: 'public-key' as const,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  currentChallenge = options.challenge
  return c.json(options)
})

authRouter.post('/register/verify', async (c) => {
  const body = await c.req.json<RegistrationResponseJSON>()

  if (!currentChallenge) return c.json({ error: 'No challenge active' }, 400)

  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge: currentChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  })

  currentChallenge = undefined

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: 'Verification failed' }, 400)
  }

  const { credential } = verification.registrationInfo

  db.prepare(
    'INSERT INTO credentials (id, public_key, counter, transport) VALUES (?, ?, ?, ?)'
  ).run(
    credential.id,
    Buffer.from(credential.publicKey).toString('base64'),
    credential.counter,
    JSON.stringify(credential.transports ?? [])
  )

  return c.json({ verified: true })
})

// === LOGIN ===

authRouter.get('/login/options', async (c) => {
  const credentials = db.prepare('SELECT id, transport FROM credentials').all() as any[]

  if (credentials.length === 0) {
    return c.json({ error: 'No credentials registered' }, 400)
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: credentials.map(cred => ({
      id: cred.id,
      type: 'public-key' as const,
      transports: JSON.parse(cred.transport),
    })),
    userVerification: 'preferred',
  })

  currentChallenge = options.challenge
  return c.json(options)
})

authRouter.post('/login/verify', async (c) => {
  const body = await c.req.json<AuthenticationResponseJSON>()

  if (!currentChallenge) return c.json({ error: 'No challenge active' }, 400)

  const cred = db.prepare('SELECT * FROM credentials WHERE id = ?').get(body.id) as any
  if (!cred) return c.json({ error: 'Credential not found' }, 400)

  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge: currentChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: cred.id,
      publicKey: Buffer.from(cred.public_key, 'base64'),
      counter: cred.counter,
      transports: JSON.parse(cred.transport),
    },
  })

  currentChallenge = undefined

  if (!verification.verified) return c.json({ error: 'Verification failed' }, 400)

  db.prepare('UPDATE credentials SET counter = ? WHERE id = ?').run(
    verification.authenticationInfo.newCounter,
    cred.id
  )

  const sessionId = createSession()
  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: 86400 * 7,
    path: '/',
  })

  return c.json({ verified: true })
})

// === LOGOUT ===

authRouter.post('/logout', (c) => {
  const sessionId = getCookie(c, 'session')
  if (sessionId) deleteSession(sessionId)
  deleteCookie(c, 'session', { path: '/' })
  return c.json({ success: true })
})
