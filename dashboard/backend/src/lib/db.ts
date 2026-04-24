import Database from 'better-sqlite3'
import { randomBytes } from 'crypto'
import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'

const DATA_DIR = process.env.DATA_DIR ?? './data'
if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true })

export const db = new Database(`${DATA_DIR}/dashboard.db`)

db.exec(`
  CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transport TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
`)

export function createSession(): string {
  const id = randomBytes(32).toString('hex')
  const expiresAt = Math.floor(Date.now() / 1000) + 86400 * 7
  db.prepare('INSERT INTO sessions (id, expires_at) VALUES (?, ?)').run(id, expiresAt)
  return id
}

export function validateSession(id: string): boolean {
  const session = db.prepare(
    'SELECT id FROM sessions WHERE id = ? AND expires_at > unixepoch()'
  ).get(id)
  return !!session
}

export function deleteSession(id: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

export const sessionMiddleware = createMiddleware(async (c, next) => {
  const sessionId = getCookie(c, 'session')
  if (!sessionId || !validateSession(sessionId)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})
