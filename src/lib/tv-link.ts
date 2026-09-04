import type { CompanionCloudflareTransport } from '../types'

const RELAY_URL = 'wss://tv-link.izumi.watch/v1/pair'
const ROOM_LIFETIME_MS = 10 * 60_000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/
const SESSION_PATTERN = /^[A-Za-z0-9_-]{16,80}$/
const LINK_SECRET_PATTERN = /^[A-Za-z0-9_-]{22}$/

export type TvLinkPhase = 'preparing' | 'waiting' | 'phone-connected' | 'confirming' | 'approved' | 'installing' | 'complete' | 'error'

export interface TvLinkInfo {
  code: string
  expiresAt: number
  phase: TvLinkPhase
  message?: string
  confirmation?: string
  linkSecret?: string
}

interface TvLinkEvents {
  onInfo(info: TvLinkInfo): void
  onSetup(transport: CompanionCloudflareTransport): void | Promise<void>
}

interface TvLinkSession {
  id: string
  key: CryptoKey
  confirmation: string
  mode: 'qr' | 'manual'
  approved: boolean
}

interface BrowserHello {
  type: 'browser.hello'
  protocol: 2
  mode: 'qr' | 'manual'
  sessionId: string
  publicKey: JsonWebKey
}

interface EncryptedSetup {
  type: 'setup.payload'
  protocol: 2
  sessionId: string
  iv: string
  ciphertext: string
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length))
}

function randomHex(length: number): string {
  return Array.from(randomBytes(length), (value) => value.toString(16).padStart(2, '0')).join('')
}

function encode(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function createTvLinkSecret(): string {
  return bytesToBase64Url(randomBytes(16))
}

export async function createTvLinkTicket(code: string, linkSecret: string): Promise<string> {
  if (!CODE_PATTERN.test(code) || !LINK_SECRET_PATTERN.test(linkSecret)) throw new Error('The secure TV invitation is invalid.')
  const digest = await crypto.subtle.digest('SHA-256', encode(`izumi-tv-link-ticket-v2|${code}|${linkSecret}`))
  return bytesToBase64Url(new Uint8Array(digest))
}

function base64UrlToBytes(value: string, maximumLength: number): Uint8Array<ArrayBuffer> {
  if (!value || value.length > maximumLength || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('The encrypted setup message is invalid.')
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  let binary = ''
  try { binary = atob(padded) } catch { throw new Error('The encrypted setup message is invalid.') }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function hmac(keyBytes: BufferSource, value: BufferSource): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, value))
}

// Chrome 56 supports ECDH, HMAC and AES-GCM, but not WebCrypto's native HKDF name. Expanding
// HKDF with HMAC keeps the TV compatible while producing the same RFC 5869 output as the phone.
async function hkdf(shared: ArrayBuffer, code: string, info: string, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const prk = await hmac(encode(code), shared)
  const output = new Uint8Array(length)
  let previous = new Uint8Array(0)
  let offset = 0
  let counter = 1
  while (offset < length) {
    const infoBytes = encode(info)
    const input = new Uint8Array(previous.length + infoBytes.length + 1)
    input.set(previous)
    input.set(infoBytes, previous.length)
    input[input.length - 1] = counter
    previous = await hmac(prk, input)
    const chunk = previous.subarray(0, Math.min(previous.length, length - offset))
    output.set(chunk, offset)
    offset += chunk.length
    counter += 1
  }
  return output
}

function validPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.includes(':')) return false
  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = octets
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || a === 100 && b >= 64 && b <= 127
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 168)
}

function normalizeEndpoint(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null
  try {
    const endpoint = new URL(value)
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || endpoint.pathname !== '/' && endpoint.pathname !== '' || !validPublicHostname(endpoint.hostname)) return null
    return endpoint.toString().replace(/\/$/, '')
  } catch { return null }
}

export function createTvLinkCode(): string {
  const random = randomBytes(8)
  return Array.from(random, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('')
}

export function parseTvLinkSetup(value: unknown): CompanionCloudflareTransport | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const cloudflare = input.cloudflare && typeof input.cloudflare === 'object'
    ? input.cloudflare as Record<string, unknown>
    : null
  if (input.protocol !== 1 || !cloudflare || cloudflare.protocol !== 1
    || typeof cloudflare.pairingId !== 'string' || !SESSION_PATTERN.test(cloudflare.pairingId)
    || typeof cloudflare.tvToken !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(cloudflare.tvToken)) return null
  const endpoint = normalizeEndpoint(input.endpoint)
  const cloudflareEndpoint = normalizeEndpoint(cloudflare.endpoint)
  if (!endpoint || endpoint !== cloudflareEndpoint) return null
  return {
    protocol: 1,
    endpoint,
    pairingId: cloudflare.pairingId,
    tvToken: cloudflare.tvToken,
    playbackMode: cloudflare.playbackMode === 'cloud-and-device' ? 'cloud-and-device' : 'cloud-only',
    wakeWhenClosed: cloudflare.wakeWhenClosed === true,
  }
}

function validBrowserHello(value: Record<string, unknown>): value is Record<string, unknown> & BrowserHello {
  const publicKey = value.publicKey && typeof value.publicKey === 'object' ? value.publicKey as JsonWebKey : null
  return value.type === 'browser.hello' && value.protocol === 2 && (value.mode === 'qr' || value.mode === 'manual')
    && typeof value.sessionId === 'string' && SESSION_PATTERN.test(value.sessionId)
    && Boolean(publicKey && publicKey.kty === 'EC' && publicKey.crv === 'P-256'
      && typeof publicKey.x === 'string' && typeof publicKey.y === 'string')
}

function validEncryptedSetup(value: Record<string, unknown>): value is Record<string, unknown> & EncryptedSetup {
  return value.type === 'setup.payload' && value.protocol === 2
    && typeof value.sessionId === 'string' && SESSION_PATTERN.test(value.sessionId)
    && typeof value.iv === 'string' && typeof value.ciphertext === 'string'
}

export async function deriveTvLinkSession(
  privateKey: CryptoKey,
  code: string,
  challenge: string,
  linkSecret: string,
  value: Record<string, unknown>,
): Promise<TvLinkSession> {
  if (!CODE_PATTERN.test(code) || !/^[a-f0-9]{32}$/.test(challenge) || !LINK_SECRET_PATTERN.test(linkSecret) || !validBrowserHello(value)) {
    throw new Error('The phone sent an invalid secure handshake.')
  }
  const publicKey = await crypto.subtle.importKey('jwk', value.publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  const salt = `izumi-tv-link-v2|${code}|${value.mode === 'qr' ? linkSecret : 'manual'}`
  const keyInfo = `izumi-tv-link-v2|${challenge}|${value.sessionId}`
  const confirmationInfo = `izumi-tv-link-confirm-v2|${challenge}|${value.sessionId}`
  const keyBits = await hkdf(shared, salt, keyInfo, 32)
  const confirmation = await hkdf(shared, salt, confirmationInfo, 4)
  const key = await crypto.subtle.importKey('raw', keyBits, { name: 'AES-GCM' }, false, ['decrypt'])
  const number = (((confirmation[0] << 24) >>> 0) + (confirmation[1] << 16) + (confirmation[2] << 8) + confirmation[3]) % 1_000_000
  return { id: value.sessionId, key, confirmation: String(number).padStart(6, '0'), mode: value.mode, approved: false }
}

export async function decryptTvLinkSetup(
  session: TvLinkSession,
  code: string,
  challenge: string,
  value: Record<string, unknown>,
): Promise<CompanionCloudflareTransport> {
  if (!session.approved) throw new Error('Approve the confirmation number on this TV before setup.')
  if (!validEncryptedSetup(value) || value.sessionId !== session.id) throw new Error('The setup message does not match this TV session.')
  const iv = base64UrlToBytes(value.iv, 32)
  const ciphertext = base64UrlToBytes(value.ciphertext, 96_000)
  if (iv.length !== 12 || ciphertext.length < 17) throw new Error('The encrypted setup message is invalid.')
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv,
      additionalData: encode(`v2|${code}|${challenge}|${session.id}|${session.mode}`),
      tagLength: 128,
    }, session.key, ciphertext)
  } catch { throw new Error('The phone setup could not be authenticated.') }
  let decoded: unknown
  try { decoded = JSON.parse(new TextDecoder().decode(plaintext)) } catch { throw new Error('The phone sent an invalid setup profile.') }
  const transport = parseTvLinkSetup(decoded)
  if (!transport) throw new Error('The phone sent an unsupported Cloudflare setup.')
  return transport
}

function verifyWorker(transport: CompanionCloudflareTransport): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('GET', `${transport.endpoint}/v1/status`, true)
    request.timeout = 12_000
    request.setRequestHeader('Accept', 'application/json')
    request.onload = () => {
      let status: Record<string, unknown> = {}
      try { status = JSON.parse(request.responseText || '{}') as Record<string, unknown> } catch { /* handled below */ }
      if (request.status < 200 || request.status >= 300 || status.app !== 'izumi-sync' || status.protocol !== 1 || status.claimed !== true) {
        reject(new Error('The deployed address is not a ready Izumi Cloudflare Worker.'))
        return
      }
      resolve()
    }
    request.onerror = () => reject(new Error('The TV could not reach the private Cloudflare Worker.'))
    request.ontimeout = () => reject(new Error('The private Cloudflare Worker did not respond in time.'))
    request.send(null)
  })
}

export class TvLinkReceiver {
  private socket?: WebSocket
  private privateKey?: CryptoKey
  private publicKey?: JsonWebKey
  private session?: TvLinkSession
  private info: TvLinkInfo = { code: '', expiresAt: 0, phase: 'preparing' }
  private reconnectTimer?: number
  private expiryTimer?: number
  private generation = 0
  private pairingChallenge = ''
  private linkSecret = ''
  private pairingTicket = ''
  private stopped = true
  private finished = false
  private installing = false

  constructor(private readonly deviceId: string, private readonly events: TvLinkEvents) {}

  start(): void {
    this.stop()
    this.stopped = false
    this.finished = false
    void this.startRound()
  }

  stop(): void {
    this.stopped = true
    this.generation += 1
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer)
    if (this.expiryTimer) window.clearTimeout(this.expiryTimer)
    this.reconnectTimer = undefined
    this.expiryTimer = undefined
    const socket = this.socket
    this.socket = undefined
    try { socket?.close(1000, 'TV setup closed') } catch { /* already closed */ }
    this.privateKey = undefined
    this.publicKey = undefined
    this.session = undefined
    this.linkSecret = ''
    this.pairingTicket = ''
    this.installing = false
  }

  approveSession(): boolean {
    if (this.stopped || this.finished || this.info.phase !== 'confirming' || !this.session) return false
    this.session.approved = true
    this.send({ type: 'tv.confirmed', protocol: 2, sessionId: this.session.id })
    this.update({
      phase: 'approved',
      message: 'Numbers approved. Finish the one-time setup on your phone.',
    })
    return true
  }

  rejectSession(): boolean {
    if (this.stopped || this.finished || !this.session) return false
    this.send({ type: 'tv.error', protocol: 2, sessionId: this.session.id, message: 'The TV rejected the confirmation number.' })
    void this.startRound()
    return true
  }

  private update(next: Partial<TvLinkInfo>): void {
    this.info = { ...this.info, ...next }
    this.events.onInfo(this.info)
  }

  private async startRound(): Promise<void> {
    const generation = ++this.generation
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer)
    if (this.expiryTimer) window.clearTimeout(this.expiryTimer)
    const socket = this.socket
    this.socket = undefined
    try { socket?.close(1000, 'Pairing code refreshed') } catch { /* already closed */ }
    this.session = undefined
    this.installing = false
    const code = createTvLinkCode()
    const linkSecret = createTvLinkSecret()
    this.pairingChallenge = randomHex(16)
    this.linkSecret = linkSecret
    const expiresAt = Date.now() + ROOM_LIFETIME_MS
    this.info = { code, linkSecret, expiresAt, phase: 'preparing', message: 'Creating an encrypted link for this TV.' }
    this.events.onInfo(this.info)
    try {
      if (!crypto.subtle || !/^[a-f0-9]{24}$/i.test(this.deviceId)) throw new Error('Secure pairing is not supported by this TV software.')
      const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
      const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey)
      const pairingTicket = await createTvLinkTicket(code, linkSecret)
      if (this.stopped || generation !== this.generation) return
      this.privateKey = keys.privateKey
      this.publicKey = publicKey
      this.pairingTicket = pairingTicket
      this.update({ phase: 'waiting', message: 'Scan the QR code or enter the TV code on your phone.' })
      this.expiryTimer = window.setTimeout(() => { if (!this.stopped && !this.finished) void this.startRound() }, ROOM_LIFETIME_MS)
      this.connect(generation)
    } catch (error) {
      if (this.stopped || generation !== this.generation) return
      this.update({ phase: 'error', message: error instanceof Error ? error.message : 'This TV could not create a secure setup link.' })
    }
  }

  private connect(generation: number): void {
    if (this.stopped || this.finished || generation !== this.generation) return
    const url = `${RELAY_URL}?role=tv&code=${encodeURIComponent(this.info.code)}&protocol=2&ticket=${encodeURIComponent(this.pairingTicket)}`
    let socket: WebSocket
    try { socket = new WebSocket(url) } catch {
      this.scheduleReconnect(generation)
      return
    }
    this.socket = socket
    socket.addEventListener('open', () => {
      if (this.socket !== socket || generation !== this.generation) return
      this.update({ phase: 'waiting', message: 'Scan the QR code or enter the TV code on your phone.' })
      this.sendHello()
    })
    socket.addEventListener('message', (event) => { if (this.socket === socket) void this.receive(event.data) })
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = undefined
      if (!this.stopped && !this.finished && generation === this.generation) this.scheduleReconnect(generation)
    })
    socket.addEventListener('error', () => {
      if (!this.stopped && !this.finished && generation === this.generation) {
        this.update({ phase: 'waiting', message: 'Reconnecting to the secure setup relay…' })
      }
    })
  }

  private scheduleReconnect(generation: number): void {
    if (this.reconnectTimer || this.stopped || this.finished || Date.now() >= this.info.expiresAt) return
    this.update({ phase: 'waiting', message: 'Reconnecting to the secure setup relay…' })
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect(generation)
    }, 1_500)
  }

  private send(value: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    try { this.socket.send(JSON.stringify(value)) } catch { /* reconnect handles transport failure */ }
  }

  private sendHello(): void {
    if (!this.publicKey || Date.now() >= this.info.expiresAt) return
    this.send({
      type: 'tv.hello',
      protocol: 2,
      deviceId: this.deviceId.toLowerCase(),
      challenge: this.pairingChallenge,
      expiresAt: this.info.expiresAt,
      publicKey: this.publicKey,
      capabilities: {
        cloudResolver: true,
        catalogs: ['auto', 'anilist', 'kitsu', 'tmdb', 'stremio', 'merged'],
      },
    })
  }

  private async receive(raw: unknown): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 100_000 || this.stopped || this.finished) return
    let message: Record<string, unknown>
    try { message = JSON.parse(raw) as Record<string, unknown> } catch { return }
    if (message.type === 'relay.peer' && message.role === 'browser') {
      if (message.connected === true) {
        this.update({ phase: 'phone-connected', message: 'Phone connected. Creating matching confirmation numbers…' })
        this.sendHello()
      } else if (this.session) void this.startRound()
      else this.update({ phase: 'waiting', message: 'Scan the QR code or enter the TV code on your phone.' })
      return
    }
    if (message.type === 'browser.hello') {
      if (!this.privateKey) return
      try {
        const session = await deriveTvLinkSession(this.privateKey, this.info.code, this.pairingChallenge, this.linkSecret, message)
        if (this.stopped || this.finished) return
        this.session = session
        this.update({
          phase: 'confirming',
          confirmation: session.confirmation,
          message: 'Check that this number matches your phone before you deploy.',
        })
      } catch {
        this.update({ phase: 'error', message: 'The phone could not establish a secure session. Creating a new code…' })
        window.setTimeout(() => { if (!this.stopped && !this.finished) void this.startRound() }, 900)
      }
      return
    }
    if (message.type !== 'setup.payload' || !this.session || this.installing) return
    if (!this.session.approved) {
      this.send({ type: 'tv.error', protocol: 2, sessionId: this.session.id, message: 'Approve the confirmation number on the TV first.' })
      void this.startRound()
      return
    }
    this.installing = true
    this.update({ phase: 'installing', message: 'Verifying and saving your private Cloudflare Worker…' })
    try {
      const transport = await decryptTvLinkSetup(this.session, this.info.code, this.pairingChallenge, message)
      await verifyWorker(transport)
      await this.events.onSetup(transport)
      if (this.stopped || this.finished) return
      this.send({ type: 'tv.complete', protocol: 2, sessionId: this.session.id })
      this.finished = true
      if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer)
      if (this.expiryTimer) window.clearTimeout(this.expiryTimer)
      this.update({ phase: 'complete', message: 'Setup complete. Loading your Cloudflare catalogue…' })
      window.setTimeout(() => {
        const socket = this.socket
        this.socket = undefined
        try { socket?.close(1000, 'TV setup complete') } catch { /* already closed */ }
      }, 500)
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'The TV could not save the Cloudflare setup.'
      this.send({ type: 'tv.error', protocol: 2, sessionId: this.session.id, message: messageText.slice(0, 240) })
      this.update({ phase: 'error', message: messageText })
      this.installing = false
    }
  }
}

export const tvLinkInternal = { bytesToBase64Url }
