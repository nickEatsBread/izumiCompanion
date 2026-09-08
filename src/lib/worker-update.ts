export const WORKER_UPDATE_REMOTE = 'izumi:worker-update-remote'
export const WORKER_UPDATE_GUIDE = 'https://github.com/nickEatsBread/izumi/tree/main/cloudflare-sync-worker#updating'

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
        reject(new Error('The Worker version could not be verified. You can still follow the update guide.'))
      }
    }
    request.onerror = () => reject(new Error('The TV could not reach your Worker. You can still follow the update guide.'))
    request.ontimeout = () => reject(new Error('The Worker did not respond in time. Try checking again.'))
    request.send()
  })
}
