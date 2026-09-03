import { describe, expect, it, vi } from 'vitest'
import type { CompanionMedia } from '../types'
import { installVoiceSearch, MAX_VOICE_SEARCH_COMMANDS, voiceSearchCommands, voiceSearchQuery, VOICE_SEARCH_EVENT } from './voice-search'

const media = (title: string): CompanionMedia => ({ ref: { provider: 'test', type: 'movie', id: title }, title })

describe('Samsung TV voice search', () => {
  it('extracts a clean query from common remote utterances', () => {
    expect(voiceSearchQuery('search Dune Part Two')).toBe('Dune Part Two')
    expect(voiceSearchQuery('Search for The Runner on izumi')).toBe('The Runner')
    expect(voiceSearchQuery('find Frieren')).toBe('Frieren')
    expect(voiceSearchQuery('play Dune')).toBeUndefined()
  })

  it('deduplicates and bounds legacy foreground commands', () => {
    const commands = voiceSearchCommands(Array.from({ length: 600 }, (_, index) => media(`Film ${index % 560}`)))
    expect(commands.slice(0, 2)).toEqual(['search', 'find'])
    expect(commands.length).toBe(MAX_VOICE_SEARCH_COMMANDS)
    expect(new Set(commands.map((command) => command.toLowerCase())).size).toBe(commands.length)
    expect(commands).toContain('search Film 400')
  })

  it('routes a Tizen 4 recognition result into izumi search', () => {
    const target = new EventTarget()
    const onSearch = vi.fn()
    const onOpenSearch = vi.fn()
    let listener: ((event: string, list: { command: string }[], result: string) => void) | undefined
    const client = {
      setCommandList: vi.fn(),
      unsetCommandList: vi.fn(),
      addResultListener: vi.fn((next) => { listener = next; return 7 }),
      removeResultListener: vi.fn(),
      release: vi.fn(),
    }
    const cleanup = installVoiceSearch([media('The Runner')], {
      getScreen: () => 'home',
      onOpenSearch,
      onSearch,
    }, {
      target,
      tizen: {
        VoiceControlCommand: class { constructor(public command: string) {} },
        voicecontrol: { getVoiceControlClient: () => client },
      },
    })

    listener?.('SUCCESS', [], 'search The Runner')
    expect(onSearch).toHaveBeenCalledWith('The Runner')
    target.dispatchEvent(new CustomEvent(VOICE_SEARCH_EVENT, { detail: 'Dune' }))
    expect(onSearch).toHaveBeenLastCalledWith('Dune')
    cleanup()
    expect(client.removeResultListener).toHaveBeenCalledWith(7)
    expect(client.unsetCommandList).toHaveBeenCalledWith('FOREGROUND')
    expect(client.release).toHaveBeenCalled()
  })

  it('supplies search aliases to modern Samsung title selection', () => {
    const target = new EventTarget()
    const onSearch = vi.fn()
    let callbacks: Record<string, (...args: never[]) => unknown> = {}
    const buildItem = vi.fn((_x, _y, title, aliases) => ({ title, aliases }))
    installVoiceSearch([media('The Runner')], {
      getScreen: () => 'home',
      onOpenSearch: vi.fn(),
      onSearch,
    }, {
      target,
      interaction: {
        setCallback: vi.fn((next) => { callbacks = next }),
        listen: vi.fn(),
        buildVoiceInteractionContentContextItem: buildItem,
        buildVoiceInteractionContentContextResponse: (items) => JSON.stringify(items),
      },
    })

    expect(callbacks.onrequestcontentcontext()).toContain('search for The Runner')
    expect(callbacks.ontitleselection('search The Runner' as never)).toBe(true)
    expect(onSearch).toHaveBeenCalledWith('The Runner')
  })
})
