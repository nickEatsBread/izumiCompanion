const INITIAL = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])
const schedule = new Uint32Array(64)

const rotateRight = (value: number, count: number) => (value >>> count) | (value << (32 - count))

export function sha256Block32(input: Uint8Array<ArrayBufferLike>, output: Uint8Array<ArrayBufferLike> = new Uint8Array(32)): Uint8Array<ArrayBufferLike> {
  if (input.length !== 32) throw new Error('SHA-256 input must be 32 bytes.')
  for (let index = 0; index < 8; index += 1) {
    const offset = index * 4
    schedule[index] = ((input[offset] << 24) | (input[offset + 1] << 16) | (input[offset + 2] << 8) | input[offset + 3]) >>> 0
  }
  schedule[8] = 0x80000000
  for (let index = 9; index < 15; index += 1) schedule[index] = 0
  schedule[15] = 256
  for (let index = 16; index < 64; index += 1) {
    const s0 = rotateRight(schedule[index - 15], 7) ^ rotateRight(schedule[index - 15], 18) ^ (schedule[index - 15] >>> 3)
    const s1 = rotateRight(schedule[index - 2], 17) ^ rotateRight(schedule[index - 2], 19) ^ (schedule[index - 2] >>> 10)
    schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0
  }
  let [a, b, c, d, e, f, g, h] = INITIAL
  for (let index = 0; index < 64; index += 1) {
    const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
    const choice = (e & f) ^ (~e & g)
    const t1 = (h + s1 + choice + K[index] + schedule[index]) >>> 0
    const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
    const majority = (a & b) ^ (a & c) ^ (b & c)
    const t2 = (s0 + majority) >>> 0
    h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
  }
  const words = [a + INITIAL[0], b + INITIAL[1], c + INITIAL[2], d + INITIAL[3], e + INITIAL[4], f + INITIAL[5], g + INITIAL[6], h + INITIAL[7]]
  words.forEach((word, index) => {
    const value = word >>> 0
    const offset = index * 4
    output[offset] = value >>> 24
    output[offset + 1] = value >>> 16
    output[offset + 2] = value >>> 8
    output[offset + 3] = value
  })
  return output
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(normalized)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function encodeBase64(value: Uint8Array): string {
  let output = ''
  for (let offset = 0; offset < value.length; offset += 0x8000) output += String.fromCharCode(...value.subarray(offset, offset + 0x8000))
  return btoa(output)
}

type Challenge = { seed: string; k: number; g: number }
type WorkerScope = typeof globalThis & { postMessage(message: unknown): void; onmessage: ((event: MessageEvent<Challenge>) => void) | null }

const scope = globalThis as WorkerScope
if (typeof scope.postMessage === 'function') {
  scope.onmessage = (event) => {
    try {
      const { seed, k, g } = event.data
      if (!Number.isInteger(k) || !Number.isInteger(g) || k <= 0 || g <= 0 || k * g > 64_000_000 || k > 20_000) {
        throw new Error('Cloudflare returned an unsupported deployment challenge.')
      }
      const seedBytes = decodeBase64Url(seed)
      if (seedBytes.length !== 32) throw new Error('Cloudflare returned an invalid deployment seed.')
      let current: Uint8Array<ArrayBufferLike> = sha256Block32(seedBytes)
      let next: Uint8Array<ArrayBufferLike> = new Uint8Array(32)
      const checkpoints = new Uint8Array((k + 1) * 32)
      checkpoints.set(current, 0)
      for (let segment = 0; segment < k; segment += 1) {
        for (let iteration = 0; iteration < g; iteration += 1) {
          sha256Block32(current, next)
          const swap = current; current = next; next = swap
        }
        checkpoints.set(current, (segment + 1) * 32)
        if (segment % Math.max(1, Math.floor(k / 100)) === 0) scope.postMessage({ type: 'progress', progress: Math.floor((segment / k) * 100) })
      }
      scope.postMessage({ type: 'done', checkpoints: encodeBase64(checkpoints) })
    } catch (error) {
      scope.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'Could not solve the deployment challenge.' })
    }
  }
}
