import { describe, expect, it } from 'vitest'
import { createTvLinkCode, decryptTvLinkSetup, deriveTvLinkSession, parseTvLinkSetup, tvLinkInternal } from './tv-link'

const code = 'ABCD2345'
const challenge = 'ab'.repeat(16)

function encode(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value)
}

async function nativeHkdf(shared: ArrayBuffer, info: string, length: number): Promise<ArrayBuffer> {
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: encode(code), info: encode(info) }, material, length)
}

describe('stateless TV Link protocol', () => {
  it('generates relay-safe eight-character codes', () => {
    for (let index = 0; index < 64; index += 1) {
      expect(createTvLinkCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)
    }
  })

  it('accepts only matching public HTTPS Worker transports', () => {
    const valid = {
      protocol: 1,
      endpoint: 'https://private-izumi.workers.dev',
      cloudflare: {
        protocol: 1,
        endpoint: 'https://private-izumi.workers.dev/',
        pairingId: 'pairing_1234567890',
        tvToken: 'tv_token_123456789012345678901234567890',
        playbackMode: 'cloud-only',
        wakeWhenClosed: false,
      },
    }
    expect(parseTvLinkSetup(valid)).toMatchObject({ endpoint: 'https://private-izumi.workers.dev', playbackMode: 'cloud-only' })
    expect(parseTvLinkSetup({ ...valid, endpoint: 'https://192.168.1.4' })).toBeNull()
    expect(parseTvLinkSetup({ ...valid, endpoint: 'https://different.example' })).toBeNull()
  })

  it('matches the browser native-HKDF handshake and decrypts its AES-GCM payload', async () => {
    const tvKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
    const browserKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
    const tvPublicKey = await crypto.subtle.exportKey('jwk', tvKeys.publicKey)
    const browserPublicKey = await crypto.subtle.exportKey('jwk', browserKeys.publicKey)
    const importedTvKey = await crypto.subtle.importKey('jwk', tvPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: importedTvKey }, browserKeys.privateKey, 256)
    const sessionId = 'browser_session_123456789'
    const session = await deriveTvLinkSession(tvKeys.privateKey, code, challenge, {
      type: 'browser.hello', protocol: 1, sessionId, publicKey: browserPublicKey,
    })
    const confirmationBytes = new Uint8Array(await nativeHkdf(shared, `izumi-tv-link-confirm-v1|${challenge}|${sessionId}`, 32))
    const expectedNumber = (((confirmationBytes[0] << 24) >>> 0) + (confirmationBytes[1] << 16)
      + (confirmationBytes[2] << 8) + confirmationBytes[3]) % 1_000_000
    expect(session.confirmation).toBe(String(expectedNumber).padStart(6, '0'))

    const keyBits = await nativeHkdf(shared, `izumi-tv-link-v1|${challenge}|${sessionId}`, 256)
    const browserKey = await crypto.subtle.importKey('raw', keyBits, { name: 'AES-GCM' }, false, ['encrypt'])
    const payload = {
      protocol: 1,
      endpoint: 'https://private-izumi.workers.dev',
      cloudflare: {
        protocol: 1,
        endpoint: 'https://private-izumi.workers.dev',
        pairingId: 'pairing_1234567890',
        tvToken: 'tv_token_123456789012345678901234567890',
        playbackMode: 'cloud-only',
        wakeWhenClosed: false,
      },
    }
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: encode(`${code}|${challenge}|${sessionId}`), tagLength: 128,
    }, browserKey, encode(JSON.stringify(payload)))
    await expect(decryptTvLinkSetup(session, code, challenge, {
      type: 'setup.payload',
      protocol: 1,
      sessionId,
      iv: tvLinkInternal.bytesToBase64Url(iv),
      ciphertext: tvLinkInternal.bytesToBase64Url(new Uint8Array(ciphertext)),
    })).resolves.toEqual(payload.cloudflare)
  })
})
