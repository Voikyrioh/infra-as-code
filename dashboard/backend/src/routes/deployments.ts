import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

export const deploymentsRouter = new Hono()

const triggerSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  workflow: z.string(),
  ref: z.string().default('main'),
})

deploymentsRouter.post('/trigger', async (c) => {
  const body = await c.req.json()
  const parsed = triggerSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)

  const { owner, repo, workflow, ref } = parsed.data
  const token = process.env.GITHUB_TOKEN

  if (!token) return c.json({ error: 'GITHUB_TOKEN not configured' }, 500)

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref }),
    }
  )

  if (!response.ok) {
    const error = await response.text()
    return c.json({ error }, response.status as any)
  }

  return c.json({ success: true })
})
