import { webcrypto } from 'node:crypto'
import { createPreviewChallenge, deployPreview, deploymentAccounts, deployWithApiToken } from '../worker/cloudflare-preview'
import { sha256Block32 } from '../src/lib/pow-worker'

// Shared by Electron and the Android/iOS Node runtime. The preview account token
// stays on this device and is never returned to the wizard or public relay.
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto })

export async function solveNativeChallenge(challenge: { seed: string; k: number; g: number }): Promise<string> {
  const { seed, k, g } = challenge
  if (!Number.isInteger(k) || !Number.isInteger(g) || k <= 0 || g <= 0 || k > 20_000 || k * g > 64_000_000) throw new Error('Unsupported Cloudflare security challenge.')
  const seedBytes = Buffer.from(seed, 'base64url')
  if (seedBytes.length !== 32) throw new Error('Invalid Cloudflare security seed.')
  let current = sha256Block32(seedBytes)
  let next: Uint8Array<ArrayBufferLike> = new Uint8Array(32)
  const checkpoints = Buffer.alloc((k + 1) * 32)
  checkpoints.set(current)
  for (let segment = 0; segment < k; segment++) {
    for (let iteration = 0; iteration < g; iteration++) {
      sha256Block32(current, next)
      const swap = current; current = next; next = swap
      // Keep bridge events and cancellation/window-close handling responsive.
      if (iteration > 0 && iteration % 50_000 === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
    checkpoints.set(current, (segment + 1) * 32)
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  return checkpoints.toString('base64')
}

let busy = false
export async function invoke(method: string, input: unknown): Promise<unknown> {
  if (busy) throw new Error('Cloudflare setup is already running. Keep the app open.')
  const value = input as Record<string, unknown> | null
  if (!value || typeof value !== 'object') throw new Error('Invalid Cloudflare request.')
  if (!['preview', 'accounts', 'deploy'].includes(method)) throw new Error('Unknown Cloudflare operation.')
  busy = true
  try {
    if (method === 'accounts') return await deploymentAccounts(value)
    if (method === 'deploy') return await deployWithApiToken(value)
    if (value.acceptTerms !== true || typeof value.bootstrapSecret !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value.bootstrapSecret)) throw new Error('Accept Cloudflare terms and start a valid TV setup before deploying.')
    const challenge = await createPreviewChallenge()
    const checkpoints = await solveNativeChallenge(challenge)
    return await deployPreview({ acceptTerms: true, bootstrapSecret: value.bootstrapSecret, challengeToken: challenge.challengeToken, checkpoints })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cloudflare setup failed.'
    throw new Error(message.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]').slice(0, 400))
  } finally { busy = false }
}
