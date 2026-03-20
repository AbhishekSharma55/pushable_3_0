import { NextRequest, NextResponse } from 'next/server'
import http from 'http'

function dockerRequest(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: '/var/run/docker.sock', path, method: 'GET' },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => resolve(data))
      }
    )
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

// Strip Docker log stream header bytes (8-byte prefix per frame)
function stripDockerHeaders(raw: string): string {
  const lines: string[] = []
  let i = 0
  const buf = Buffer.from(raw, 'binary')
  while (i < buf.length) {
    if (i + 8 > buf.length) break
    const size = buf.readUInt32BE(i + 4)
    i += 8
    if (i + size > buf.length) {
      lines.push(buf.subarray(i).toString('utf8'))
      break
    }
    lines.push(buf.subarray(i, i + size).toString('utf8'))
    i += size
  }
  return lines.join('')
}

export async function GET(request: NextRequest) {
  const containerId = request.nextUrl.searchParams.get('id')
  const tail = request.nextUrl.searchParams.get('tail') || '200'

  if (!containerId) {
    return NextResponse.json({ error: 'Missing container id' }, { status: 400 })
  }

  try {
    const raw = await dockerRequest(
      `/containers/${containerId}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=true`
    )
    const logs = stripDockerHeaders(raw)
    return NextResponse.json({ logs })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch container logs' }, { status: 500 })
  }
}
