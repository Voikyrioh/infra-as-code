import Dockerode from 'dockerode'

export const docker = new Dockerode({ socketPath: '/var/run/docker.sock' })

export interface ContainerInfo {
  id: string
  name: string
  image: string
  status: string
  state: string
}

export async function listContainers(): Promise<ContainerInfo[]> {
  const containers = await docker.listContainers({ all: true })
  return containers.map(c => ({
    id: c.Id.slice(0, 12),
    name: c.Names[0].replace('/', ''),
    image: c.Image,
    status: c.Status,
    state: c.State,
  }))
}

export async function restartContainer(id: string): Promise<void> {
  await docker.getContainer(id).restart()
}

export async function stopContainer(id: string): Promise<void> {
  await docker.getContainer(id).stop()
}

export function streamLogs(
  id: string,
  onData: (line: string) => void,
  onEnd: () => void
): void {
  docker.getContainer(id).logs(
    { follow: true, stdout: true, stderr: true, tail: 100 },
    (err, stream) => {
      if (err || !stream) return onEnd()
      stream.on('data', (chunk: Buffer) => {
        // Docker log format: 8-byte header + message
        const line = chunk.slice(8).toString('utf8').trim()
        if (line) onData(line)
      })
      stream.on('end', onEnd)
    }
  )
}
