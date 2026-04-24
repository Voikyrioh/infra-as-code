import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { listContainers, restartContainer, stopContainer, streamLogs } from '../lib/docker.js'

export const containersRouter = new Hono()

containersRouter.get('/', async (c) => {
  const containers = await listContainers()
  return c.json(containers)
})

containersRouter.post('/:id/restart', async (c) => {
  const id = c.req.param('id')
  await restartContainer(id)
  return c.json({ success: true })
})

containersRouter.post('/:id/stop', async (c) => {
  const id = c.req.param('id')
  await stopContainer(id)
  return c.json({ success: true })
})

containersRouter.get('/:id/logs', (c) => {
  const id = c.req.param('id')
  return streamSSE(c, async (stream) => {
    await new Promise<void>((resolve) => {
      streamLogs(
        id,
        (line) => stream.writeSSE({ data: line }),
        resolve
      )
    })
  })
})
