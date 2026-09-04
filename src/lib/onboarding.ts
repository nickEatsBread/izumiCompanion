const TV_LINK_ORIGIN = 'https://tv-link.izumi.watch/'

export function normalizeTvLinkCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase()
}

export function tvLinkUrl(code: string): string {
  return `${TV_LINK_ORIGIN}?code=${encodeURIComponent(normalizeTvLinkCode(code))}`
}
