import type { CompanionMedia, ScreenName } from '../types'

export const VOICE_SEARCH_EVENT = 'izumi:voice-search'
export const MAX_VOICE_SEARCH_COMMANDS = 96

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
  if (!match) return undefined
  const query = match[1].replace(/\s+(?:in|on)\s+izumi$/i, '').trim()
  return query || undefined
}

/** Tizen 4 voice control recognizes predefined foreground commands. Keep the list bounded so a
 * large merged catalogue cannot pin thousands of command strings in an older TV process. */
export function voiceSearchCommands(media: CompanionMedia[], limit = MAX_VOICE_SEARCH_COMMANDS): string[] {
  const maximum = Math.max(2, Math.floor(limit))
  const commands = ['search', 'find']
  const seen = new Set(commands)
  for (const item of media) {
    const title = normalizedSpeech(item.title)
    if (!title || title.length > 80) continue
    const command = `search ${title}`
    const key = command.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    commands.push(command)
    if (commands.length >= maximum) break
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

/** Install the newest Samsung Voice Interaction API when present, with a Tizen 4 predefined-
 * command fallback for the Chromium M56 generation. The custom event is also useful to exercise
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
  const onVoiceEvent = (event: Event) => {
    const query = normalizedSpeech(String((event as CustomEvent<unknown>).detail ?? ''))
    if (query) callbacks.onSearch(voiceSearchQuery(query) ?? query)
    else callbacks.onOpenSearch()
  }
  runtime.target.addEventListener(VOICE_SEARCH_EVENT, onVoiceEvent)

  const interaction = runtime.interaction
  if (interaction) {
    try {
      const titles = voiceSearchCommands(media, 34).slice(2).map((command) => command.slice(7))
      interaction.setCallback({
        onupdatestate: () => voiceApplicationState(callbacks.getScreen()),
        onchangeappstate: (state: never) => {
          if (String(state) !== 'Search') return false
          callbacks.onOpenSearch()
          return true
        },
        ontitleselection: (title: never) => {
          const query = normalizedSpeech(String(title))
          if (!query) return false
          callbacks.onSearch(query)
          return true
        },
        onrequestcontentcontext: () => {
          if (!interaction.buildVoiceInteractionContentContextItem || !interaction.buildVoiceInteractionContentContextResponse) return '[]'
          const items = titles.map((title, index) => interaction.buildVoiceInteractionContentContextItem!(index % 6, Math.floor(index / 6), title, [], false))
          return interaction.buildVoiceInteractionContentContextResponse(items)
        },
      })
      interaction.listen()
      return () => runtime.target.removeEventListener(VOICE_SEARCH_EVENT, onVoiceEvent)
    } catch {
      // Older TVs can expose a partial webapis object but not Voice Interaction; use Tizen 4 below.
    }
  }

  const manager = runtime.tizen?.voicecontrol
  const Command = runtime.tizen?.VoiceControlCommand
  if (!manager || !Command) return () => runtime.target.removeEventListener(VOICE_SEARCH_EVENT, onVoiceEvent)

  let client: VoiceControlClientLike | undefined
  let listenerId: number | undefined
  try {
    client = manager.getVoiceControlClient()
    const commands = voiceSearchCommands(media).map((command) => new Command(command, 'FOREGROUND'))
    client.setCommandList(commands, 'FOREGROUND')
    listenerId = client.addResultListener((event, list, result) => {
      if (String(event).toUpperCase() !== 'SUCCESS') return
      if (handleRecognition(result, callbacks)) return
      for (const command of list || []) {
        if (handleRecognition(command.command, callbacks)) return
      }
    })
  } catch {
    client = undefined
    listenerId = undefined
  }

  return () => {
    runtime.target.removeEventListener(VOICE_SEARCH_EVENT, onVoiceEvent)
    if (!client) return
    try { if (listenerId !== undefined) client.removeResultListener(listenerId) } catch { /* already released by firmware */ }
    try { client.unsetCommandList('FOREGROUND') } catch { /* unsupported during application exit */ }
  }
}
