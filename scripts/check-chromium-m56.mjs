import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const revision = '433064'
const expectedBrowser = 'Chrome/56.0.2924.0'
const snapshotUrl = `https://storage.googleapis.com/chromium-browser-snapshots/Win_x64/${revision}/chrome-win32.zip`
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(project, 'dist')
const runtime = resolve(tmpdir(), `izumi-chromium-m56-r${revision}`)
const archive = resolve(runtime, `chromium-${revision}.zip`)
const executable = resolve(runtime, 'chrome-win32', 'chrome.exe')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function run(command, args) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => code === 0
      ? resolveRun()
      : reject(new Error(`${command} exited with code ${code}`)))
  })
}

async function prepareChromium() {
  if (process.platform !== 'win32') {
    throw new Error('The pinned Chromium 56 TV check currently supports Windows only.')
  }
  if (await exists(executable)) return

  await mkdir(runtime, { recursive: true })
  if (!(await exists(archive))) {
    process.stdout.write(`Downloading Chromium 56 snapshot ${revision}...\n`)
    const response = await fetch(snapshotUrl)
    if (!response.ok) throw new Error(`Chromium download failed with HTTP ${response.status}`)
    await writeFile(archive, Buffer.from(await response.arrayBuffer()))
  }

  await run('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    '& { param($zip, $destination) Expand-Archive -LiteralPath $zip -DestinationPath $destination -Force }',
    archive,
    runtime,
  ])
  assert(await exists(executable), 'Chromium 56 extraction did not produce chrome.exe.')
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function startServer() {
  assert(await exists(resolve(dist, 'index.html')), 'Build dist/ before running the Chromium 56 check.')
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
      if (pathname === '/$WEBAPIS/webapis/webapis.js') {
        response.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
        response.end('window.webapis = window.webapis || {};')
        return
      }

      const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
      const path = resolve(dist, requested)
      if (path !== dist && !path.startsWith(`${dist}${sep}`)) {
        response.writeHead(403).end()
        return
      }
      const body = await readFile(path)
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': mimeTypes[extname(path)] ?? 'application/octet-stream',
      })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address !== 'string', 'Could not determine the preview server port.')
  return { server, port: address.port }
}

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address !== 'string', 'Could not reserve a DevTools port.')
  const port = address.port
  await new Promise((resolveClose) => server.close(resolveClose))
  return port
}

async function waitForJson(url, timeout = 20_000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch (error) {
      lastError = error
    }
    await wait(100)
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? 'no response'}`)
}

function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  const pending = new Map()
  const events = []
  let sequence = 0

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(String(event.data))
    if (payload.id && pending.has(payload.id)) {
      const entry = pending.get(payload.id)
      pending.delete(payload.id)
      if (payload.error) entry.reject(new Error(payload.error.message))
      else entry.resolve(payload.result)
      return
    }
    if (payload.method) events.push(payload)
  })

  const ready = new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++sequence
    pending.set(id, { resolve: resolveCall, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  return { call, events, ready, socket }
}

async function main() {
  await prepareChromium()
  const profile = await mkdtemp(join(runtime, 'profile-'))
  const { server, port } = await startServer()
  const debugPort = await freePort()
  const url = `http://127.0.0.1:${port}/?preview=1&capture=1&screen=home`
  const browser = spawn(executable, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1920,1080',
    '--force-device-scale-factor=1',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    '--kiosk',
    url,
  ], { stdio: 'ignore', windowsHide: true })

  let cdp
  try {
    const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`)
    assert(version.Browser === expectedBrowser, `Expected ${expectedBrowser}, received ${version.Browser}.`)
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json`)
    const page = targets.find((target) => target.type === 'page')
    assert(page?.webSocketDebuggerUrl, 'Chromium 56 did not expose the Home page target.')

    cdp = connectCdp(page.webSocketDebuggerUrl)
    await cdp.ready
    await cdp.call('Page.enable')
    await cdp.call('Runtime.enable')
    await cdp.call('Console.enable')
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
      fitWindow: false,
    })

    const evaluate = async (expression) => {
      const response = await cdp.call('Runtime.evaluate', { expression, returnByValue: true })
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed.')
      return response.result?.value
    }
    const waitFor = async (expression, timeout = 20_000) => {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const value = await evaluate(expression)
        if (value) return value
        await wait(100)
      }
      throw new Error(`Timed out waiting for: ${expression}`)
    }
    const capture = async (name) => {
      const screenshot = await cdp.call('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      })
      const output = resolve(project, 'artifacts', name)
      await mkdir(dirname(output), { recursive: true })
      const source = Buffer.from(screenshot.data, 'base64')
      const metadata = await sharp(source).metadata()
      if ((metadata.width ?? 0) >= 1920 && (metadata.height ?? 0) >= 1080) {
        await sharp(source).extract({ left: 0, top: 0, width: 1920, height: 1080 }).png().toFile(output)
      } else {
        await writeFile(output, source)
      }
    }
    const codes = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }
    const press = async (key) => {
      const code = codes[key]
      await cdp.call('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code,
      })
      await cdp.call('Input.dispatchKeyEvent', {
        type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code,
      })
      await wait(120)
    }

    await waitFor("document.getElementById('startup-splash')")
    const startup = await evaluate(`(() => {
      var splash = document.getElementById('startup-splash').getBoundingClientRect();
      return [splash.left, splash.top, splash.width, splash.height];
    })()`)
    assert(JSON.stringify(startup) === '[0,0,1920,1080]', `Startup splash does not cover the M56 viewport: ${startup}.`)
    await capture('m56-startup.png')

    await waitFor("document.readyState === 'complete' && document.querySelector('.hero-feature-card')")
    await waitFor("Array.from(document.querySelectorAll('.home-poster-card img')).every(function (image) { return image.complete && image.naturalWidth > 0 })")

    const hero = await evaluate(`(() => {
      var card = document.querySelector('.hero-feature-card').getBoundingClientRect();
      return {
        viewport: [innerWidth, innerHeight],
        card: [card.left, card.top, card.width, card.height],
        supports: {
          gap: CSS.supports('gap', '1px'),
          grid: CSS.supports('display', 'grid'),
          clamp: CSS.supports('width', 'clamp(1px, 2px, 3px)'),
          inset: CSS.supports('inset', '0'),
          aspectRatio: CSS.supports('aspect-ratio', '16 / 9')
        },
        shadeBackground: getComputedStyle(document.querySelector('.hero-shade')).backgroundImage,
        trackTransform: getComputedStyle(document.querySelector('.home-motion-track')).transform
      };
    })()`)
    assert(JSON.stringify(hero.viewport) === '[1920,1080]', `Unexpected M56 viewport ${hero.viewport}.`)
    assert(JSON.stringify(hero.card) === '[112,40,1744,680]', `Unexpected hero geometry ${hero.card}.`)
    assert(Object.values(hero.supports).every((supported) => supported === false), 'The M56 feature baseline changed.')
    assert(hero.shadeBackground.includes('linear-gradient'), 'The M56 hero contrast gradient did not render.')
    assert(hero.trackTransform === 'none', 'Home uses a full-page compositor transform.')
    await waitFor("!document.getElementById('startup-splash')")
    await capture('m56-home-hero.png')

    await press('ArrowDown')
    await waitFor("document.querySelector('.home-focus-card.is-focused')")
    const rows = await evaluate(`(() => ({
      body: [document.body.scrollWidth, document.body.scrollHeight],
      tops: Array.from(document.querySelectorAll('.media-row')).map(function (row) { return row.getBoundingClientRect().top; }),
      images: Array.from(document.querySelectorAll('.media-row')).map(function (row) { return row.querySelectorAll('img').length; }),
      posterWidths: Array.from(new Set(Array.from(document.querySelectorAll('.home-poster-card')).map(function (card) { return card.offsetWidth; }))),
      gap: getComputedStyle(document.querySelector('.media-strip > :nth-child(2)')).marginLeft,
      focus: (() => {
        var card = document.querySelector('.home-focus-card').getBoundingClientRect();
        var frame = document.querySelector('.home-focus-frame').getBoundingClientRect();
        return [card.left, card.top, card.width, card.height, frame.width, frame.height];
      })(),
      continueCopy: document.querySelector('.home-focus-context').textContent,
      continueProgress: document.querySelector('.home-focus-card .home-card-progress > span').style.width,
      trackTransform: getComputedStyle(document.querySelector('.home-motion-track')).transform
    }))()`)
    assert(JSON.stringify(rows.body) === '[1920,1080]', `Home overflowed the TV viewport: ${rows.body}.`)
    assert(JSON.stringify(rows.tops.slice(0, 3)) === '[52,638,1120]', `Unexpected row positions ${rows.tops}.`)
    assert(rows.images.slice(0, 2).every((count) => count > 0) && rows.images[2] === 0, `Artwork windowing is incorrect: ${rows.images}.`)
    assert(JSON.stringify(rows.posterWidths) === '[228]', `Poster stride changed during focus: ${rows.posterWidths}.`)
    assert(rows.gap === '16px', `M56 rail fallback gap is ${rows.gap}, expected 16px.`)
    assert(JSON.stringify(rows.focus) === '[132,96,700,510,692,389]', `Unexpected focus spotlight geometry ${rows.focus}.`)
    assert(rows.continueCopy.includes('S1 E12') && rows.continueCopy.includes('9m left'), `Continue Watching context is incomplete: ${rows.continueCopy}.`)
    assert(rows.continueProgress === '64%', `Continue Watching progress is ${rows.continueProgress}.`)
    assert(rows.trackTransform === 'none', 'Vertical navigation transformed the full Home page.')
    await capture('m56-continue-watching.png')

    await press('ArrowDown')
    for (let index = 0; index < 3; index += 1) await press('ArrowRight')
    await waitFor("document.querySelector('.home-focus-art.is-ready')")
    await capture('m56-focused-rail.png')
    for (let index = 3; index < 8; index += 1) await press('ArrowRight')
    const horizontal = await evaluate(`(() => {
      var focused = document.querySelector('.home-focus-card.is-focused');
      var row = focused.closest('.media-row');
      var viewport = row.querySelector('.media-strip-viewport');
      var strip = row.querySelector('.media-strip');
      return {
        index: Number(focused.getAttribute('data-media-index')),
        scrollLeft: viewport.scrollLeft,
        width: focused.offsetWidth,
        visualWidth: focused.getBoundingClientRect().width,
        posterWidths: Array.from(new Set(Array.from(strip.querySelectorAll('.home-poster-card')).map(function (card) { return card.offsetWidth; }))),
        focusLeft: focused.getBoundingClientRect().left,
        transition: getComputedStyle(focused).transitionDuration,
        stripTransform: getComputedStyle(strip).transform,
        broken: Array.from(document.images).filter(function (image) { return image.complete && !image.naturalWidth; }).length
      };
    })()`)
    assert(horizontal.index === 8, `Expected rail index 8, received ${horizontal.index}.`)
    assert(horizontal.scrollLeft > 0, 'Horizontal navigation did not scroll its local viewport.')
    assert(horizontal.width === 700 && horizontal.visualWidth === 700, `Focused spotlight changed geometry: ${horizontal.width}/${horizontal.visualWidth}px.`)
    assert(JSON.stringify(horizontal.posterWidths) === '[228]', `Neighbour cards reflowed: ${horizontal.posterWidths}.`)
    assert(horizontal.focusLeft === 184, `Previous-title peek did not offset the focus spotlight: ${horizontal.focusLeft}px.`)
    assert(horizontal.transition === '0s', `M56 is animating the focus spotlight for ${horizontal.transition}.`)
    assert(horizontal.stripTransform === 'none', 'Horizontal navigation transformed the entire rail.')
    assert(horizontal.broken === 0, `${horizontal.broken} artwork images failed.`)

    const exceptions = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown')
    assert(exceptions.length === 0, `Chromium 56 reported ${exceptions.length} uncaught exception(s).`)
    process.stdout.write('Chromium 56 Home check passed: 1920x1080 hero, 700px focus spotlight, fixed poster stride, local rail scrolling, Continue Watching context, no runtime errors.\n')
  } finally {
    try { await cdp?.call('Browser.close') } catch { browser.kill() }
    cdp?.socket.close()
    await new Promise((resolveClose) => server.close(resolveClose))
    await wait(300)
    if (!browser.killed) browser.kill()
    const runtimePrefix = `${runtime}${sep}`
    if (profile.startsWith(runtimePrefix)) await rm(profile, { recursive: true, force: true })
  }
}

await main()
