import type { CompanionMedia, ScreenName } from '../types'

export const VOICE_SEARCH_EVENT = 'izumi:voice-search'
export const MAX_VOICE_SEARCH_COMMANDS = 512
export const MAX_VOICE_CONTEXT_TITLES = 120

interface VoiceSearchCallbacks {
  getScreen(): ScreenName
  onOpenSearch(): void
  onSearch(query: string): void
}

interface VoiceCommandLike {
  command: string
}

interface VoiceControlClientLike {
  setCommandList(commands: VoiceCommandLike[], type?: 'FOREGROUND'): void
  unsetCommandList(type?: 'FOREGROUND'): void
  addResultListener(listener: (event: string, list: VoiceCommandLike[], result: string) => void): number
  removeResultListener(id: number): void
  release?(): void
}

interface VoiceSearchRuntime {
  target: EventTarget
  tizen?: {
    VoiceControlCommand?: new (command: string, type?: 'FOREGROUND') => VoiceCommandLike
    voicecontrol?: { getVoiceControlClient(): VoiceControlClientLike }
  }
  interaction?: {
    setCallback(callback: Record<string, (...args: never[]) => unknown>): void
    listen(): void
    buildVoiceInteractionContentContextItem?(x: number, y: number, title: string, aliases: string[], focused: boolean): unknown
    buildVoiceInteractionContentContextResponse?(items: unknown[]): string
  }
}

function normalizedSpeech(value: string): string {
  return String(value || '').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim()
}

/** Accept the common Samsung/Bixby phrasings while keeping the actual catalogue query clean. */
export function voiceSearchQuery(value: string): string | undefined {
  const spoken = normalizedSpeech(value)
  const match = /^(?:search(?:\s+for)?|find|look\s+for)\s+(.+)$/i.exec(spoken)
  if (!match && /^(?:(?:play|pause|resume|stop|rewind|fast forward|skip|seek|volume|mute|unmute|go|open|close|switch|change|turn)\b|(?:search|find|back|home|settings|up|down|left|right|select|ok|exit|next|previous)$)/i.test(spoken)) return undefined
  const query = (match ? match[1] : spoken).replace(/\s+(?:in|on)\s+izumi$/i, '').trim()
  return query && query.length <= 80 ? query : undefined
}

/** Tizen 4 voice control recognizes predefined foreground commands. Keep the list bounded so a
 * large merged catalogue cannot pin thousands of command strings in an older TV process. */
export function voiceSearchCommands(media: CompanionMedia[], limit = MAX_VOICE_SEARCH_COMMANDS): string[] {
  const maximum = Math.max(2, Math.floor(limit))
  const commands = ['search', 'find']
  const seen = new Set(commands)
  const titles: string[] = []
  for (const item of media) {
    const title = normalizedSpeech(item.title)
    if (!title || title.length > 80) continue
    const titleKey = title.toLowerCase()
    if (seen.has(`title:${titleKey}`)) continue
    seen.add(`title:${titleKey}`)
    titles.push(title)
  }
  // Register both ways of naming each title before spending slots on alternate phrasings.
  for (const title of titles) {
    for (const command of [`search ${title}`, ...(voiceSearchQuery(title) ? [title] : [])]) {
      if (commands.length >= maximum) return commands
      const key = command.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      commands.push(command)
    }
    if (commands.length >= maximum) break
  }
  const variants = ['search for', 'find', 'look for']
  for (const prefix of variants) {
    for (const title of titles) {
      if (commands.length >= maximum) return commands
      const command = `${prefix} ${title}`
      const key = command.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      commands.push(command)
    }
  }
  return commands
}

function voiceApplicationState(screen: ScreenName): string {
  if (screen === 'search') return 'Search'
  if (screen === 'player' || screen === 'loading') return 'Player'
  if (screen === 'settings') return 'Setting'
  if (screen === 'home') return 'Home'
  return 'List'
}

function handleRecognition(value: string, callbacks: VoiceSearchCallbacks): boolean {
  const query = voiceSearchQuery(value)
  if (query) {
    callbacks.onSearch(query)
    return true
  }
  if (/^(?:search|find)$/i.test(normalizedSpeech(value))) {
    callbacks.onOpenSearch()
    return true
  }
  return false
}

/** Install title context and foreground command recognition together: firmware may expose both
 * APIs while delivering microphone results through only one. The custom event also exercises
 * the complete voice-to-search route in a browser where Samsung APIs do not exist. */
export function installVoiceSearch(
  media: CompanionMedia[],
  callbacks: VoiceSearchCallbacks,
  runtime: VoiceSearchRuntime = {
    target: window,
    tizen: window.tizen,
    interaction: window.webapis?.voiceinteraction,
  },
): () => void {
  let active = true, lastQuery = '', lastAt = 0
  const recognize = (value: string) => {
    if (!active) return false
    return handleRecognition(value, {
      ...callbacks,
      onSearch: (query) => {
        const key = query.toLowerCase(), now = Date.now()
        if (key === lastQuery && now - lastAt < 750) return
        lastQuery = key; lastAt = now
        callbacks.onSearch(query)
      },
    })
  }
  const onVoiceEvent = (event: Event) => {
    const query = normalizedSpeech(String((event as CustomEvent<unknown>).detail ?? ''))
    if (query) recognize(query)
    else callbacks.onOpenSearch()
  }
  runtime.target.addEventListener(VOICE_SEARCH_EVENT, onVoiceEvent)

  const interaction = runtime.interaction
  if (interaction) {
    try {
      const titleKeys = new Set<string>()
      const titles = media.map((item) => normalizedSpeech(item.title)).filter((title) => {
        const key = title.toLowerCase()
        if (!title || titleKeys.has(key)) return false
        titleKeys.add(key)
        return true
      }).slice(0, MAX_VOICE_CONTEXT_TITLES)
      interaction.setCallback({
        onupdatestate: () => voiceApplicationState(callbacks.getScreen()),
        onchangeappstate: (state: never) => {
          if (!active || String(state) !== 'Search') return false
          callbacks.onOpenSearch()
          return true
        },
        ontitleselection: (title: never) => {
          return recognize(String(title))
        },
        onrequestcontentcontext: () => {
          if (!interaction.buildVoiceInteractionContentContextItem || !interaction.buildVoiceInteractionContentContextResponse) return '[]'
          const items = titles.map((title, index) => interaction.buildVoiceInteractionContentContextItem!(
            index % 6,
            Math.floor(index / 6),
            title,
            [`search ${title}`, `search for ${title}`, `find ${title}`],
            false,
          ))
          return interaction.buildVoiceInteractionContentContextResponse(items)
        },
      })
      interaction.listen()
    } catch {
      // Older TVs can expose a partial webapis object but not Voice Interaction; use Tizen 4 below.
    }
  }

  const manager = runtime.tizen?.voicecontrol
  const Command = runtime.tizen?.VoiceControlCommand

  let client: VoiceControlClientLike | undefined
  let listenerId: number | undefined
  try {
    if (!manager || !Command) throw new Error('Foreground voice commands unavailable')
    client = manager.getVoiceControlClient()
    const commands = voiceSearchCommands(media).map((command) => new Command(command, 'FOREGROUND'))
    client.setCommandList(commands, 'FOREGROUND')
    listenerId = client.addResultListener((event, list, result) => {
      if (String(event).toUpperCase() !== 'SUCCESS') return
      if (recognize(result)) return
      for (const command of list || []) {
        if (recognize(command.command)) return
      }
    })
  } catch {
    // Keep any partially initialized client so cleanup can release it.
  }

  return () => {
    active = false
    runtime.target.removeEventListener(VOICE_SEARCH_EVENT, onVoiceEvent)
    if (!client) return
    try { if (listenerId !== undefined) client.removeResultListener(listenerId) } catch { /* already released by firmware */ }
    try { client.unsetCommandList('FOREGROUND') } catch { /* unsupported during application exit */ }
    try { client.release?.() } catch { /* already released by firmware */ }
  }
}
