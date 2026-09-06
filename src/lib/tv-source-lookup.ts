import type { CloudResolveRequest } from './cloud-resolver'

const PUBLIC_OPTIONS = new Set(['providers', 'sort', 'language', 'qualityfilter', 'limit', 'sizefilter'])
const MAX_RESPONSE_BYTES = 512 * 1024

export function validTvSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false
  try {
    const url = new URL(value)
    if (url.origin !== 'https://torrentio.strem.fun' || url.username || url.password || url.search || url.hash) return false
    const path = decodeURIComponent(url.pathname)
    const match = path.match(/^(?:\/([^/]+))?\/stream\/(movie|series|anime)\/((?:tt\d+(?::\d+:\d+)?|kitsu:\d+(?::\d+)?))\.json$/)
    if (!match) return false
    return !match[1] || match[1].split('|').every(option => {
      const [key, setting, extra] = option.split('=')
      return PUBLIC_OPTIONS.has(key) && !extra && !!setting && setting.length <= 256 && /^[a-z0-9,.:_-]+$/i.test(setting)
    })
  } catch { return false }
}

function fetchSource(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('GET', url, true)
    request.timeout = 12_000
    request.withCredentials = false
    request.setRequestHeader('Accept', 'application/json')
    request.onprogress = event => { if (event.loaded > MAX_RESPONSE_BYTES) request.abort() }
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) { reject(new Error(`Torrentio returned HTTP ${request.status} to the TV.`)); return }
      if (request.responseText.length > MAX_RESPONSE_BYTES) { reject(new Error('The source response was too large.')); return }
      try { resolve(JSON.parse(request.responseText)) } catch { reject(new Error('Torrentio returned an invalid response to the TV.')) }
    }
    request.onerror = () => reject(new Error('The TV could not reach Torrentio over your home connection.'))
    request.ontimeout = () => reject(new Error('Torrentio did not respond to the TV in time.'))
    request.onabort = () => reject(new Error('The source response exceeded the TV limit.'))
    request.send(null)
  })
}

function torrentMetadata(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return []
  const streams = (value as { streams?: unknown }).streams
  if (!Array.isArray(streams)) return []
  const text = (value: unknown, size: number) => typeof value === 'string' ? value.slice(0, size) : undefined
  return streams.slice(0, 80).flatMap(raw => {
    if (!raw || typeof raw !== 'object' || typeof raw.infoHash !== 'string'
      || !/^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(raw.infoHash)) return []
    return [{
      infoHash: raw.infoHash,
      fileIdx: Number.isInteger(raw.fileIdx) && raw.fileIdx >= 0 ? raw.fileIdx : undefined,
      name: text(raw.name, 300), title: text(raw.title, 700),
      sources: Array.isArray(raw.sources) ? raw.sources.filter((value: unknown) => typeof value === 'string'
        && value.length <= 512 && /^tracker:(?:https?|udp):\/\//i.test(value)).slice(0, 8) : [],
      behaviorHints: { filename: text(raw.behaviorHints?.filename, 500), videoSize: Number(raw.behaviorHints?.videoSize) || undefined },
    }]
  })
}

/** Complete at most one signed continuation. No linked izumi client or account key is involved. */
export async function resolveWithTvSourceLookup(
  input: CloudResolveRequest,
  send: (payload: unknown) => Promise<Record<string, unknown>>,
  isCurrent: () => boolean,
): Promise<Record<string, unknown>> {
  const current = () => { if (!isCurrent()) throw new Error('The playback request or profile changed.') }
  current()
  const result = await send({ ...input, tvSourceLookup: 1 })
  current()
  if (Array.isArray(result.candidates) && result.candidates.length) return result
  const lookup = result.tvSourceLookup as { version?: unknown; ticket?: unknown; requests?: unknown } | undefined
  if (!lookup) return result // Older Workers keep their existing response contract.
  if (lookup.version !== 1 || typeof lookup.ticket !== 'string' || lookup.ticket.length > 32_768
    || !Array.isArray(lookup.requests) || !lookup.requests.length || lookup.requests.length > 6) throw new Error('The Worker returned an invalid TV lookup.')
  const requests = lookup.requests as Array<{ id: string; url: string }>
  const ids = new Set<string>()
  for (const request of requests) {
    if (!request || typeof request.id !== 'string' || !/^torrentio-\d+-\d+$/.test(request.id)
      || ids.has(request.id) || !validTvSourceUrl(request.url)) throw new Error('The Worker returned an unsafe TV source request.')
    ids.add(request.id)
  }
  const results: Array<{ id: string; streams: Record<string, unknown>[] }> = []
  const failures: string[] = []
  let cursor = 0
  let size = 0
  const run = async () => {
    while (cursor < requests.length) {
      current()
      const request = requests[cursor++]
      try {
        const value = await fetchSource(request.url)
        current()
        const streams = torrentMetadata(value).filter(stream => {
          // Conservative UTF-8 bound keeps the complete continuation below the Worker's body limit.
          const bytes = JSON.stringify(stream).length * 3
          if (size + bytes > 360_000) return false
          size += bytes
          return true
        })
        results.push({ id: request.id, streams })
      } catch (error) {
        current()
        failures.push(error instanceof Error ? error.message : 'TV source lookup failed.')
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, requests.length) }, run))
  current()
  if (!results.some(result => result.streams.length)) return {
    ...result, tvSourceLookup: undefined,
    failures: failures.length ? failures : ['Torrentio returned no torrent sources to the TV for this title.'],
  }
  return send({ ...input, tvSourceLookup: 1, tvSourceResults: { ticket: lookup.ticket, results } }).then(value => { current(); return value })
}
