export const UPDATER_APP_ID = 'IzumiUP001.Updater'
export const UPDATE_RELEASE_URL = 'https://api.github.com/repos/nickEatsBread/izumiCompanion/releases/latest'
export interface TvUpdate { version: string; helperInstalled: boolean }

export function newerVersion(candidate: string, installed: string): boolean {
  if (!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(candidate) || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(installed)) return false
  const next = candidate.split('.').map(Number), current = installed.split('.').map(Number)
  for (let index = 0; index < 3; index++) if (next[index] !== current[index]) return next[index] > current[index]
  return false
}
export function updateVersionFromRelease(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return
  const release = value as { tag_name?: string; draft?: boolean; prerelease?: boolean; assets?: Array<{ name: string; digest?: string; browser_download_url?: string }> }
  if (release.draft || release.prerelease || !/^v?\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(release.tag_name || '') || !Array.isArray(release.assets)) return
  for (const name of ['izumi-companion.wgt', 'izumi-updater.wgt']) {
    const matches = release.assets.filter((asset) => asset.name === name)
    if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest || '') || matches[0].browser_download_url !== `https://github.com/nickEatsBread/izumiCompanion/releases/download/${release.tag_name}/${name}`) return
  }
  return release.tag_name!.replace(/^v/, '')
}
export function updaterInstalled(): boolean {
  try { return Boolean(window.tizen?.application?.getAppInfo?.(UPDATER_APP_ID)) } catch { return false }
}
export function checkTvUpdate(): Promise<TvUpdate | undefined> {
  let installed: string | undefined
  try { installed = window.tizen?.application?.getCurrentApplication().appInfo?.version } catch { return Promise.resolve(undefined) }
  if (!installed) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', UPDATE_RELEASE_URL)
    xhr.timeout = 15000
    xhr.onload = () => {
      try {
        const version = xhr.status === 200 ? updateVersionFromRelease(JSON.parse(xhr.responseText)) : undefined
        resolve(version && newerVersion(version, installed!) ? { version, helperInstalled: updaterInstalled() } : undefined)
      } catch { resolve(undefined) }
    }
    xhr.onerror = xhr.ontimeout = () => resolve(undefined)
    xhr.send()
  })
}
export function launchUpdater(installAndReturn: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const tizen = window.tizen
    if (!updaterInstalled() || !tizen?.application?.launchAppControl || !tizen.ApplicationControl || !tizen.ApplicationControlData) {
      reject(new Error('Run the izumi desktop installer once to install izumi Updater and set up updates on this TV.'))
      return
    }
    try {
      const data = installAndReturn ? [new tizen.ApplicationControlData('izumi.update', ['install-and-return'])] : []
      const control = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', null, null, null, data, 'SINGLE')
      tizen.application.launchAppControl(control, UPDATER_APP_ID, resolve, (error) => reject(new Error(error.message || 'Could not open izumi Updater. Try opening it from the TV Apps screen.')))
    } catch (error) { reject(error) }
  })
}
