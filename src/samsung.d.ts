interface SamsungAvPlayListener {
  onbufferingstart?: () => void
  onbufferingprogress?: (percent: number) => void
  onbufferingcomplete?: () => void
  oncurrentplaytime?: (milliseconds: number) => void
  onstreamcompleted?: () => void
  onerror?: (error: unknown) => void
  onerrormsg?: (code: unknown, message: string) => void
  onevent?: (eventType: string, eventData: string) => void
  onsubtitlechange?: (duration: number, text: string, data3: unknown, data4: unknown) => void
  ondrmevent?: (drmEvent: string, drmData: unknown) => void
}

interface SamsungAvPlay {
  open(url: string): void
  close(): void
  prepareAsync(success: () => void, error: (error: unknown) => void): void
  setListener(listener: SamsungAvPlayListener): void
  setDisplayRect(x: number, y: number, width: number, height: number): void
  setDisplayMethod?(method: 'PLAYER_DISPLAY_MODE_LETTER_BOX' | 'PLAYER_DISPLAY_MODE_FULL_SCREEN' | string): void
  setBufferingParam?(type: string, unit: string, amount: number): void
  setStreamingProperty?(type: string, value: string): void
  getStreamingProperty?(type: string): string
  setDrm?(type: string, operation: string, properties: string): void
  suspend?(): void
  restore?(restoreTime: number, prepare: boolean, success?: () => void, error?: (error: unknown) => void): void
  play(): void
  pause(): void
  stop(): void
  seekTo(milliseconds: number, success?: () => void, error?: (error: unknown) => void): void
  getState(): 'NONE' | 'IDLE' | 'READY' | 'PLAYING' | 'PAUSED'
  getDuration(): number
  getCurrentTime(): number
  getTotalTrackInfo(): { type: 'VIDEO' | 'AUDIO' | 'TEXT'; index: number; extra_info?: string }[]
  getCurrentStreamInfo?(): { type: 'VIDEO' | 'AUDIO' | 'TEXT'; index: number; extra_info?: string }[]
  setSelectTrack(type: 'AUDIO' | 'TEXT', index: number): void
  setSilentSubtitle?(silent: boolean): void
  setSubtitlePosition?(milliseconds: number): void
}

interface SamsungTvInputDevice {
  registerKey(name: string): void
  registerKeyBatch?(names: string[]): void
}

interface SamsungTvAudioControl {
  getVolume(): number
  setVolume(volume: number): void
  isMute(): boolean
  setMute(muted: boolean): void
}

interface SamsungVoiceControlCommand {
  command: string
  type?: 'FOREGROUND'
}

interface SamsungVoiceControlClient {
  setCommandList(commands: SamsungVoiceControlCommand[], type?: 'FOREGROUND'): void
  unsetCommandList(type?: 'FOREGROUND'): void
  addResultListener(listener: (event: string, list: SamsungVoiceControlCommand[], result: string) => void): number
  removeResultListener(id: number): void
  release?(): void
}

interface SamsungVoiceInteraction {
  setCallback(callback: Record<string, (...args: never[]) => unknown>): void
  listen(): void
  buildVoiceInteractionContentContextItem?(x: number, y: number, title: string, aliases: string[], focused: boolean): unknown
  buildVoiceInteractionContentContextResponse?(items: unknown[]): string
}

interface SamsungSmartViewChannel {
  on(event: string, callback: (data: unknown, from?: unknown) => void): void
  publish(event: string, data: unknown, target?: string): void
  connect(options: { name: string }, callback: (error?: unknown) => void): void
  disconnect(): void
}

interface SamsungSmartViewService {
  channel(id: string): SamsungSmartViewChannel
}

interface Window {
  __IZUMI_TV_PROFILE__?: {
    read(): import('./lib/tv-performance').TvPerformanceEntry[]
    clear(): void
  }
  webapis?: {
    avplay?: SamsungAvPlay
    network?: { getIp(): string }
    voiceinteraction?: SamsungVoiceInteraction
  }
  tizen?: {
    ApplicationControl?: new (operation: string, uri: string | null, mime: string | null, category: string | null, data: unknown[], launchMode: 'SINGLE' | 'GROUP') => unknown
    ApplicationControlData?: new (key: string, value: string[]) => unknown
    VoiceControlCommand?: new (command: string, type?: 'FOREGROUND') => SamsungVoiceControlCommand
    tvinputdevice?: SamsungTvInputDevice
    tvaudiocontrol?: SamsungTvAudioControl
    application?: {
      getCurrentApplication(): { exit(): void; appInfo?: { version: string } }
      getAppInfo?(id: string): { id: string; version: string }
      launchAppControl?(control: unknown, id: string, success: () => void, error: (error: { message?: string }) => void): void
    }
    voicecontrol?: { getVoiceControlClient(): SamsungVoiceControlClient }
  }
  msf?: {
    local(callback: (error: unknown, service?: SamsungSmartViewService) => void): void
  }
}
