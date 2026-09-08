export const WORKER_UPDATE_REMOTE = 'izumi:worker-update-remote'

export interface WorkerUpdateStatus {
  version: string
  configured: boolean
  automatic: boolean
  phase: 'setup-required' | 'unchecked' | 'checking' | 'queued' | 'delayed' | 'error' | 'available' | 'current'
  latestVersion: string
  error: string
  retryAt?: number
}

export function parseWorkerUpdateStatus(value: Record<string, unknown>): WorkerUpdateStatus {
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version)
    || typeof value.configured !== 'boolean' || typeof value.automatic !== 'boolean'
    || !['setup-required', 'unchecked', 'checking', 'queued', 'delayed', 'error', 'available', 'current'].includes(String(value.phase))) {
    throw new Error('The Worker update status could not be verified.')
  }
  return { version: value.version, configured: value.configured, automatic: value.automatic,
    phase: value.phase as WorkerUpdateStatus['phase'],
    latestVersion: typeof value.latestVersion === 'string' && /^\d+\.\d+\.\d+$/.test(value.latestVersion) ? value.latestVersion : '',
    error: typeof value.error === 'string' ? value.error : '',
    ...(typeof value.retryAt === 'number' && Number.isFinite(value.retryAt) ? { retryAt: value.retryAt } : {}),
  }
}

export function workerUpdateMessage(status: WorkerUpdateStatus): string {
  switch (status.phase) {
    case 'setup-required': return 'Update this Worker from Izumi. Future updates will then install automatically.'
    case 'queued': return `Worker ${status.latestVersion} update requested. Waiting for installation…`
    case 'delayed': return 'The update is taking longer than expected. Your Worker will retry automatically.'
    case 'checking': return 'Your Worker is checking for an update…'
    case 'current': return `Worker ${status.version} is up to date.`
    case 'available': return `Worker ${status.latestVersion} is available.`
    case 'error': return status.error || 'The update could not be confirmed. Try checking again.'
    default: return `Worker ${status.version} is installed. Select Update now to check for a stable release.`
  }
}

/** Read-only check. Cloudflare administration stays on the owner's phone or computer. */
export function checkWorkerVersion(endpoint: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let url: URL
    try {
      url = new URL(endpoint)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || url.pathname !== '/') throw new Error('invalid endpoint')
    } catch {
      reject(new Error('This TV does not have a valid private Worker address.'))
      return
    }
    const request = new XMLHttpRequest()
    request.open('GET', `${url.origin}/v1/status`, true)
    request.timeout = 10_000
    request.onload = () => {
      try {
        const status = JSON.parse(request.responseText)
        if (request.status < 200 || request.status >= 300 || status?.app !== 'izumi-sync'
          || status.protocol !== 1 || typeof status.version !== 'string'
          || !/^\d+\.\d+\.\d+$/.test(status.version)) throw new Error('invalid status')
        resolve(status.version)
      } catch {
        reject(new Error('The Worker version could not be verified. Try checking again.'))
      }
    }
    request.onerror = () => reject(new Error('The TV could not reach your Worker. Try checking again.'))
    request.ontimeout = () => reject(new Error('The Worker did not respond in time. Try checking again.'))
    request.send()
  })
}
