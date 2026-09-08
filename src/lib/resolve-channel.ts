import { fetchTvSourceMetadata, validTvSourceUrl } from './tv-source-lookup'

type Result = Record<string, unknown>
type Cancellation = { cancel?: () => void }

/** Once a start may have reached the Worker, another transport must not repeat its work. */
export class ResolveChannelError extends Error {}

export async function resolveWithChannel(options: {
  requestId: string
  input: unknown
  endpoint: string
  bootstrap: (cancellation: Cancellation) => Promise<Result>
  http: () => Promise<Result>
  isCurrent: () => boolean
  cancellation: Cancellation
  onProgress?: (result: Result) => void
}): Promise<Result> {
  if (typeof WebSocket === 'undefined') return options.http()
  let initial: Result
  try { initial = await options.bootstrap(options.cancellation) }
  catch (error) {
    if (!options.isCurrent()) throw new ResolveChannelError('Source lookup cancelled.')
    const status = (error as { status?: number }).status
    if (status === 401 || status === 403) throw new ResolveChannelError('Choose and unlock your profile again.')
    return options.http() // No operation has been sent yet.
  }
  if (!options.isCurrent()) throw new ResolveChannelError('Source lookup cancelled.')
  if (initial.protocol !== 1) return options.http()

  return new Promise<Result>((resolve, reject) => {
    let socket: WebSocket | undefined
    let settled = false
    let sent = false
    let retries = 0
    let sequence = -1
    let latest: Result | undefined
    let connecting: ReturnType<typeof setTimeout> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let lastPong = Date.now()
    let bytes = 0
    let runningFetches = 0
    const pending = new Set<XMLHttpRequest>()
    const reconnectCancellation: Cancellation = {}
    const fetches = new Map<string, { url: string; streams?: Result[] }>()
    const queue: string[] = []
    const send = (value: Result) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ protocol: 1, requestId: options.requestId, ...value }))
    }
    const close = () => {
      if (!socket) return
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null
      socket.close()
      socket = undefined
    }
    const finish = (value?: Result, error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(connecting); clearTimeout(retryTimer); clearTimeout(deadline); clearInterval(heartbeat)
      reconnectCancellation.cancel?.()
      pending.forEach(request => request.abort())
      close()
      if (options.cancellation.cancel === cancel) options.cancellation.cancel = undefined
      if (value) resolve(value)
      else reject(error ?? new ResolveChannelError('The source lookup was interrupted. Try again.'))
    }
    const fail = (message: string, allowPartial = true) => {
      if (settled) return
      try { send({ type: 'resolve.cancel' }) } catch { /* The server has its own deadline. */ }
      if (allowPartial && latest && options.isCurrent()) finish({ ...latest, fallback: null })
      else finish(undefined, new ResolveChannelError(message))
    }
    const cancel = () => {
      fail('Source lookup cancelled.', false)
    }
    options.cancellation.cancel = cancel
    const deadline = setTimeout(() => fail('The source lookup timed out. Try again.'), 60_000)
    const heartbeat = setInterval(() => {
      if (!options.isCurrent()) { cancel(); return }
      if (socket?.readyState !== WebSocket.OPEN) return
      if (Date.now() - lastPong > 20_000) { reconnect(); return }
      try { socket.send('izumi:ping') } catch { reconnect() }
    }, 8_000)
    const fallback = () => {
      if (sent) { fail('The source channel disconnected. Try again.'); return }
      // Finish channel cleanup before the HTTP helper installs its own cancellation callback.
      settled = true
      clearTimeout(connecting); clearTimeout(retryTimer); clearTimeout(deadline); clearInterval(heartbeat)
      close()
      options.cancellation.cancel = undefined
      options.http().then(resolve, reject)
    }
    const pump = () => {
      while (!settled && runningFetches < 2 && queue.length) {
        const fetchId = queue.shift()!
        const entry = fetches.get(fetchId)!
        runningFetches++
        void fetchTvSourceMetadata(entry.url, pending).catch(() => []).then(streams => {
          if (settled || !options.isCurrent()) return
          entry.streams = streams.filter(stream => {
            const size = JSON.stringify(stream).length * 3
            if (bytes + size > 360_000) return false
            bytes += size
            return true
          })
          try { send({ type: 'fetch.result', fetchId, streams: entry.streams }) } catch { reconnect() }
        }).finally(() => { runningFetches--; pump() })
      }
    }
    const reconnect = () => {
      if (settled || retryTimer) return
      clearTimeout(connecting)
      close()
      if (!options.isCurrent()) { cancel(); return }
      if (!sent) { fallback(); return }
      if (retries >= 2) { fail('The source channel disconnected. Try again.'); return }
      const delay = ++retries === 1 ? 500 : 1_500
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        void options.bootstrap(reconnectCancellation).then(value => {
          if (!settled) connect(value)
        }).catch(error => {
          const status = (error as { status?: number }).status
          if (status === 401 || status === 403) fail('Choose and unlock your profile again.', false)
          else reconnect()
        })
      }, delay)
    }
    const connect = (admission: Result) => {
      if (settled) return
      if (!options.isCurrent()) { cancel(); return }
      try {
        const url = new URL(String(admission.url))
        const expected = new URL(options.endpoint)
        if (admission.protocol !== 1 || url.protocol !== (expected.protocol === 'https:' ? 'wss:' : 'ws:')
          || url.host !== expected.host || url.pathname !== `${expected.pathname.replace(/\/$/, '')}/resolve-channel`
          || url.username || url.password || url.hash || !/^[a-f0-9]{32}$/.test(url.searchParams.get('ticket') ?? '')) {
          fail('The Worker returned an invalid source channel.', false); return
        }
        const current = new WebSocket(url.href)
        socket = current
        let ready = false
        lastPong = Date.now()
        connecting = setTimeout(reconnect, 5_000)
        current.onerror = current.onclose = () => { if (socket === current) reconnect() }
        current.onmessage = event => {
          if (settled || socket !== current) return
          if (!options.isCurrent()) { cancel(); return }
          if (event.data === 'izumi:pong') { lastPong = Date.now(); return }
          try {
            if (typeof event.data !== 'string' || event.data.length > 512 * 1024) throw new Error()
            const message = JSON.parse(event.data) as Result
            if (message.protocol !== 1) throw new Error()
            if (message.type === 'channel.ready') {
              if (ready) return
              ready = true
              clearTimeout(connecting)
              const resume = sent
              sent = true // Even an ambiguous send failure must not replay external work.
              send({ type: resume ? 'resolve.resume' : 'resolve.start', ...(!resume ? { input: options.input } : {}) })
              return
            }
            if (message.type === 'channel.error') { fail('The source channel rejected a message.', false); return }
            if (!ready || message.requestId !== options.requestId) return
            if (message.type === 'fetch.request') {
              const fetchId = String(message.fetchId)
              const request = message.request as Result | undefined
              if (!/^[a-f0-9]{32}$/.test(fetchId) || !validTvSourceUrl(request?.url)) throw new Error()
              const existing = fetches.get(fetchId)
              if (existing) {
                if (existing.url !== request!.url) throw new Error()
                if (existing.streams) send({ type: 'fetch.result', fetchId, streams: existing.streams })
              } else {
                if (fetches.size >= 6) throw new Error()
                fetches.set(fetchId, { url: request!.url as string }); queue.push(fetchId); pump()
              }
              return
            }
            if (message.type === 'resolve.error') { fail('The source lookup was interrupted. Try again.', message.code !== 'PROFILE_CHANGED'); return }
            if (!Number.isInteger(message.sequence) || Number(message.sequence) <= sequence) return
            sequence = Number(message.sequence)
            if (message.type === 'resolve.progress' || message.type === 'resolve.complete') {
              const result = message.result as Result | undefined
              if (!result || result.ok !== true || !Array.isArray(result.candidates)) throw new Error()
              latest = result
              if (message.type === 'resolve.complete') finish(result)
              else options.onProgress?.(result)
            }
          } catch { fail('The source channel returned an invalid response.', false) }
        }
      } catch { reconnect() }
    }
    connect(initial)
  })
}
