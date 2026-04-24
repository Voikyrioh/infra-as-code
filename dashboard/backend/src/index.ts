import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRouter } from './routes/auth.js'
import { containersRouter } from './routes/containers.js'
import { deploymentsRouter } from './routes/deployments.js'
import { sessionMiddleware } from './lib/db.js'

const app = new Hono()

app.use('*', cors({ origin: '*', credentials: true }))

app.get('/health', (c) => c.json({ status: 'ok' }))

app.route('/auth', authRouter)
app.use('/api/*', sessionMiddleware)
app.route('/api/containers', containersRouter)
app.route('/api/deployments', deploymentsRouter)

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('Dashboard API running on port 3000')
})
