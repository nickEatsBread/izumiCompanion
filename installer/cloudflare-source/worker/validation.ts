export const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
export const PAIRING_TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function normalizeCode(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : ''
}
export function isAllowedBrowserOrigin(origin: string | null): boolean {
  if (!origin) return false
  try {
    const url = new URL(origin)
    return url.origin === 'https://tv-link.izumi.watch'
      || url.origin === 'https://tv-setup.izumi.watch'
      || ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && ['http:', 'https:'].includes(url.protocol))
  } catch {
    return false
  }
}

export function safeJsonMessage(value: unknown, allowedTypes: ReadonlySet<string>): string | null {
  if (typeof value !== 'string' || value.length > 64 * 1024) return null
  try {
    const parsed = JSON.parse(value) as { type?: unknown }
    return parsed && typeof parsed === 'object' && allowedTypes.has(String(parsed.type)) ? value : null
  } catch {
    return null
  }
}
