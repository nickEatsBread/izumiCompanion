import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkWorkerVersion } from './worker-update'

class RequestMock {
  static requests: RequestMock[] = []
  method = ''
  url = ''
  timeout = 0
  status = 200
  responseText = ''
  onload = () => {}
  onerror = () => {}
  ontimeout = () => {}
  headers: Record<string, string> = {}
  body: unknown
  open(method: string, url: string) { this.method = method; this.url = url }
  setRequestHeader(name: string, value: string) { this.headers[name] = value }
  send(body?: unknown) { this.body = body; RequestMock.requests.push(this) }
}

beforeEach(() => { RequestMock.requests = []; vi.stubGlobal('XMLHttpRequest', RequestMock) })
afterEach(() => vi.unstubAllGlobals())

describe('Companion Worker version check', () => {
  it('reads the linked Worker public status without transmitting credentials', async () => {
    const checking = checkWorkerVersion('https://private.example.workers.dev')
    const request = RequestMock.requests[0]
    expect(request).toMatchObject({ method: 'GET', url: 'https://private.example.workers.dev/v1/status', timeout: 10_000, headers: {}, body: undefined })
    request.responseText = JSON.stringify({ app: 'izumi-sync', protocol: 1, version: '1.11.0' })
    request.onload()
    await expect(checking).resolves.toBe('1.11.0')
  })

  it.each(['', 'http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?token=secret'])('rejects an invalid address before making a request: %s', async endpoint => {
    await expect(checkWorkerVersion(endpoint)).rejects.toThrow('valid private Worker address')
    expect(RequestMock.requests).toHaveLength(0)
  })

  it.each(['not json', '{}', '{"app":"other","protocol":1,"version":"1.0.0"}', '{"app":"izumi-sync","protocol":1,"version":123}'])('does not report an unverified version as success: %s', async body => {
    const checking = checkWorkerVersion('https://private.example.workers.dev')
    RequestMock.requests[0].responseText = body
    RequestMock.requests[0].onload()
    await expect(checking).rejects.toThrow('could not be verified')
  })

  it.each(['onerror', 'ontimeout'] as const)('reports connection failure from %s', async event => {
    const checking = checkWorkerVersion('https://private.example.workers.dev')
    RequestMock.requests[0][event]()
    await expect(checking).rejects.toThrow(/could not reach|did not respond/)
  })
})
