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
    const codes = { Enter: 13, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, MediaFastForward: 417, MediaRewind: 412 }
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
        trackTransform: getComputedStyle(document.querySelector('.home-motion-track')).transform,
        previewRhythm: (() => {
          var rows = document.querySelectorAll('.media-row');
          var card = rows[0].querySelector('.home-poster-card').getBoundingClientRect();
          var nextTitle = rows[1].querySelector('h2').getBoundingClientRect();
          return [Math.round(card.bottom), Math.round(nextTitle.top)];
        })()
      };
    })()`)
    assert(JSON.stringify(hero.viewport) === '[1920,1080]', `Unexpected M56 viewport ${hero.viewport}.`)
    assert(JSON.stringify(hero.card) === '[0,0,1920,640]', `Unexpected hero geometry ${hero.card}.`)
    assert(Object.values(hero.supports).every((supported) => supported === false), 'The M56 feature baseline changed.')
    assert(hero.shadeBackground.includes('linear-gradient'), 'The M56 hero contrast gradient did not render.')
    assert(hero.trackTransform === 'none', 'Home uses a full-page compositor transform.')
    assert(hero.previewRhythm[1] >= hero.previewRhythm[0], `Preview row titles overlap the cards: ${hero.previewRhythm}.`)
    const collapsedNavigation = await evaluate(`(() => {
      var items = Array.from(document.querySelectorAll('.nav-item'));
      var tops = items.map(function (item) { return Math.round(item.getBoundingClientRect().top); });
      return {
        gaps: tops.slice(1).map(function (top, index) { return top - tops[index]; }),
        activeMarker: getComputedStyle(document.querySelector('.nav-item.is-active .nav-item-glyph'), '::after').display
      };
    })()`)
    assert(Math.max(...collapsedNavigation.gaps) - Math.min(...collapsedNavigation.gaps) <= 2, `Sidebar spacing is uneven: ${collapsedNavigation.gaps}.`)
    assert(collapsedNavigation.activeMarker === 'none', 'The active Home icon still uses an underline marker.')
    await waitFor("!document.getElementById('startup-splash')")
    await capture('m56-home-hero.png')

    const initialHeroSource = await evaluate("document.querySelector('.hero-backdrop').src")
    await press('ArrowRight')
    const heroMotion = await waitFor(`(() => {
      var artwork = document.querySelector('.hero-backdrop');
      if (!artwork || artwork.src === ${JSON.stringify(initialHeroSource)}) return null;
      return {
        source: artwork.src,
        transition: getComputedStyle(artwork).transitionDuration,
        incomingLayers: document.querySelectorAll('.hero-backdrop.is-incoming').length,
        copyAnimation: getComputedStyle(document.querySelector('.hero-copy')).animationDuration
      };
    })()`)
    assert(heroMotion.source !== initialHeroSource, 'Hero navigation did not replace its artwork.')
    assert(heroMotion.transition === '0s' && heroMotion.incomingLayers === 0, `Hero artwork still fades between images: ${JSON.stringify(heroMotion)}.`)
    assert(heroMotion.copyAnimation !== '0s', `Hero copy transition is disabled: ${heroMotion.copyAnimation}.`)
    await wait(440)

    await press('ArrowDown')
    await waitFor("document.querySelector('.home-focus-card.is-focused')")
    await wait(520)
    const settledFirstRow = await evaluate(`(() => {
      var row = document.querySelector('.media-row');
      var rows = document.querySelector('.catalog-rows');
      return {
        top: Math.round(row.getBoundingClientRect().top),
        rowTop: getComputedStyle(row).top,
        rowTransform: getComputedStyle(row).transform,
        rowsTop: Math.round(rows.getBoundingClientRect().top),
        rowsTransform: getComputedStyle(rows).transform
      };
    })()`)
    assert(settledFirstRow.top === 52, `First rail settled incorrectly: ${JSON.stringify(settledFirstRow)}.`)
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
      rowTransition: getComputedStyle(document.querySelector('.media-row')).transitionDuration,
      focusAnimation: getComputedStyle(document.querySelector('.home-focus-frame')).animationDuration,
      mediaAnimation: getComputedStyle(document.querySelector('.home-focus-media')).animationDuration,
      trackTransform: getComputedStyle(document.querySelector('.home-motion-track')).transform
    }))()`)
    assert(JSON.stringify(rows.body) === '[1920,1080]', `Home overflowed the TV viewport: ${rows.body}.`)
    assert(JSON.stringify(rows.tops.slice(0, 3)) === '[52,824,1340]', `Unexpected row positions ${rows.tops}.`)
    assert(rows.images.slice(0, 2).every((count) => count > 0) && rows.images[2] === 0, `Artwork windowing is incorrect: ${rows.images}.`)
    assert(JSON.stringify(rows.posterWidths) === '[320]', `Poster stride changed during focus: ${rows.posterWidths}.`)
    assert(rows.gap === '20px', `M56 rail fallback gap is ${rows.gap}, expected 20px.`)
    assert(JSON.stringify(rows.focus) === '[132,106,960,700,952,536]', `Unexpected focus spotlight geometry ${rows.focus}.`)
    assert(rows.continueCopy.includes('S1 E12') && rows.continueCopy.includes('9m left'), `Continue Watching context is incomplete: ${rows.continueCopy}.`)
    assert(rows.continueProgress === '64%', `Continue Watching progress is ${rows.continueProgress}.`)
    assert(rows.rowTransition === '0s', `The rail frame moves during vertical navigation: ${rows.rowTransition}.`)
    assert(rows.focusAnimation === '0s', `The focus outline moves with its content: ${rows.focusAnimation}.`)
    assert(rows.mediaAnimation !== '0s', `Focused artwork transition is disabled: ${rows.mediaAnimation}.`)
    assert(rows.trackTransform === 'none', 'Vertical navigation transformed the full Home page.')
    await capture('m56-continue-watching.png')

    for (let index = 0; index < 3; index += 1) await press('ArrowRight')
    await press('ArrowDown')
    await wait(360)
    const verticalDestination = await evaluate(`(() => {
      var focused = document.querySelector('.home-focus-card.is-focused');
      var frame = focused.querySelector('.home-focus-frame').getBoundingClientRect();
      var copy = focused.querySelector('.home-focus-logo, .home-focus-title');
      var copyBounds = copy.getBoundingClientRect();
      return {
        row: Number(focused.closest('.media-row').getAttribute('data-home-row')),
        index: Number(focused.getAttribute('data-media-index')),
        frame: [frame.left, frame.top, frame.width, frame.height],
        copy: [copyBounds.top, copyBounds.bottom],
        logo: copy.classList.contains('home-focus-logo') ? copy.getAttribute('alt') : '',
        plainTitle: Boolean(focused.querySelector('.home-focus-title')),
        copyAnimation: getComputedStyle(copy).animationName,
        achievements: Array.from(focused.querySelectorAll('.home-achievement')).map(function (item) { return item.textContent.trim(); }),
        achievementIcons: focused.querySelectorAll('.home-achievement > svg').length,
        facts: Array.from(focused.querySelectorAll('.home-focus-facts > span')).map(function (item) { return item.textContent.trim(); })
      };
    })()`)
    assert(verticalDestination.row === 1 && verticalDestination.index === 0, `A new rail inherited the previous rail position: ${JSON.stringify(verticalDestination)}.`)
    assert(verticalDestination.frame[0] === 136 && Math.abs(verticalDestination.frame[1] - 110) <= 3 && verticalDestination.frame[2] === 952 && verticalDestination.frame[3] === 536, `Vertical navigation moved the focus outline: ${verticalDestination.frame}.`)
    assert(verticalDestination.copy[0] >= verticalDestination.frame[1] && verticalDestination.copy[1] <= verticalDestination.frame[1] + verticalDestination.frame[3], `Focused title treatment is clipped outside its frame: ${verticalDestination.copy}.`)
    assert(verticalDestination.logo === 'Chainsaw Man' && !verticalDestination.plainTitle, `Focused card did not prefer its source logo: ${JSON.stringify(verticalDestination)}.`)
    assert(verticalDestination.copyAnimation === 'home-focus-copy-change', `Focused title treatment uses the wrong animation: ${verticalDestination.copyAnimation}.`)
    assert(verticalDestination.achievements.length === 2 && verticalDestination.achievementIcons === 2, `Focused achievements are incomplete: ${JSON.stringify(verticalDestination)}.`)
    assert(JSON.stringify(verticalDestination.facts) === '["Show","Action","2022","12 episodes"]', `Focused facts repeat shelf copy or omit metadata: ${JSON.stringify(verticalDestination.facts)}.`)
    for (let index = 0; index < 3; index += 1) await press('ArrowRight')
    await waitFor("document.querySelector('.home-focus-art')")
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
        focusAnimation: getComputedStyle(focused.querySelector('.home-focus-frame')).animationDuration,
        mediaAnimation: getComputedStyle(focused.querySelector('.home-focus-media')).animationDuration,
        mediaOpacity: getComputedStyle(focused.querySelector('.home-focus-media')).opacity,
        mediaWillChange: getComputedStyle(focused.querySelector('.home-focus-media')).willChange,
        artworkTransition: getComputedStyle(focused.querySelector('.home-focus-art')).transitionDuration,
        artworkLayers: focused.querySelectorAll('.home-focus-media > img').length,
        stripTransform: getComputedStyle(strip).transform,
        broken: Array.from(document.images).filter(function (image) { return image.complete && !image.naturalWidth; }).length
      };
    })()`)
    assert(horizontal.index === 8, `Expected rail index 8, received ${horizontal.index}.`)
    assert(horizontal.scrollLeft > 0, 'Horizontal navigation did not scroll its local viewport.')
    assert(horizontal.width === 960 && horizontal.visualWidth === 960, `Focused spotlight changed geometry: ${horizontal.width}/${horizontal.visualWidth}px.`)
    assert(JSON.stringify(horizontal.posterWidths) === '[320]', `Neighbour cards reflowed: ${horizontal.posterWidths}.`)
    assert(horizontal.focusLeft === 132, `Focus outline moved during horizontal navigation: ${horizontal.focusLeft}px.`)
    assert(horizontal.focusAnimation === '0s', `Focus outline animation is enabled: ${horizontal.focusAnimation}.`)
    assert(horizontal.mediaAnimation !== '0s', `Focused content animation is disabled: ${horizontal.mediaAnimation}.`)
    assert(horizontal.mediaOpacity === '1', `Horizontal navigation dims the focused tile to ${horizontal.mediaOpacity}.`)
    assert(horizontal.mediaWillChange === 'transform', `Focused artwork allocates unnecessary compositor properties: ${horizontal.mediaWillChange}.`)
    assert(horizontal.artworkTransition === '0s' && horizontal.artworkLayers === 1, `Focused tile crossfades multiple photos: ${horizontal.artworkTransition}/${horizontal.artworkLayers}.`)
    assert(horizontal.stripTransform === 'none', 'Horizontal navigation transformed the entire rail.')
    assert(horizontal.broken === 0, `${horizontal.broken} artwork images failed.`)

    await press('ArrowRight')
    await press('ArrowRight')
    const wrappedRailIndex = await evaluate("Number(document.querySelector('.home-focus-card.is-focused').getAttribute('data-media-index'))")
    assert(wrappedRailIndex === 0, `Right navigation did not loop to the start of the rail: ${wrappedRailIndex}.`)
    await press('ArrowLeft')
    await waitFor("document.querySelector('.nav-rail.is-open .nav-item.is-focused')")
    const navigation = await evaluate(`(() => ({
      width: document.querySelector('.nav-rail').getBoundingClientRect().width,
      items: Array.from(document.querySelectorAll('.nav-item-label strong')).map(function (item) { return item.textContent; }),
      details: Array.from(document.querySelectorAll('.nav-item-label small')).map(function (item) { return item.textContent; }),
      labelLefts: Array.from(document.querySelectorAll('.nav-item-label strong')).map(function (item) { return Math.round(item.getBoundingClientRect().left); }),
      detailLefts: Array.from(document.querySelectorAll('.nav-item-label small')).map(function (item) { return Math.round(item.getBoundingClientRect().left); }),
      focused: document.querySelector('.nav-item.is-focused').textContent
    }))()`)
    assert(navigation.width >= 370 && navigation.width <= 430, `Navigation drawer width is ${navigation.width}px.`)
    assert(JSON.stringify(navigation.items) === '["Home","Search","Browse","My List","Settings"]', `Unexpected navigation destinations: ${navigation.items}.`)
    assert(navigation.details.every((detail) => detail.length > 0), 'Navigation destinations are missing descriptions.')
    assert(Math.max(...navigation.labelLefts) - Math.min(...navigation.labelLefts) <= 1, `Navigation labels are not aligned: ${navigation.labelLefts}.`)
    assert(Math.max(...navigation.detailLefts) - Math.min(...navigation.detailLefts) <= 1, `Navigation descriptions are not aligned: ${navigation.detailLefts}.`)
    await capture('m56-navigation.png')

    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?preview=1&capture=1&screen=home&layout=carousel` })
    await waitFor("document.readyState === 'complete' && document.querySelector('.home-screen.mode-carousel')")
    await waitFor("!document.getElementById('startup-splash')")
    const carouselIndicators = await evaluate(`(() => ({
      text: document.querySelector('.hero-carousel-status').textContent.trim(),
      sizes: Array.from(document.querySelectorAll('.hero-carousel-pips > i')).map(function (pip) {
        var bounds = pip.getBoundingClientRect();
        return [bounds.width, bounds.height];
      })
    }))()`)
    assert(carouselIndicators.text === '', `Carousel still exposes numeric slide counters: ${carouselIndicators.text}.`)
    assert(carouselIndicators.sizes.some(function (size) { return size[0] === 96 && size[1] === 8; }), `Active carousel indicator is not large enough: ${JSON.stringify(carouselIndicators.sizes)}.`)
    await press('ArrowDown')
    await waitFor("document.querySelector('.home-poster-card.is-focused')")
    await waitFor("Array.from(document.querySelectorAll('.home-poster-card img')).every(function (image) { return image.complete && image.naturalWidth > 0 })")
    await wait(460)
    const carouselHome = await evaluate(`(() => {
      var hero = document.querySelector('.hero').getBoundingClientRect();
      var rows = document.querySelector('.catalog-rows').getBoundingClientRect();
      var card = document.querySelector('.home-poster-card.is-focused').getBoundingClientRect();
      var viewport = document.querySelector('.media-row.is-active .media-strip-viewport').getBoundingClientRect();
      return {
        hero: [hero.left, hero.top, hero.width, hero.height],
        rows: [rows.top, rows.height],
        card: [card.width, card.height],
        expanded: Boolean(document.querySelector('.home-focus-card')),
        receding: document.querySelector('.hero').classList.contains('is-receding'),
        heroTitle: document.querySelector('.hero h1').textContent,
        cardTitle: document.querySelector('.home-poster-card.is-focused').getAttribute('aria-label'),
        rankContext: document.querySelector('.hero-rank-context').textContent,
        viewport: [viewport.left, viewport.width],
        cards: Array.from(document.querySelectorAll('.media-row.is-active .home-poster-card')).map(function (item) {
          var bounds = item.getBoundingClientRect();
          return [bounds.left, bounds.width, Boolean(item.querySelector('img'))];
        })
      };
    })()`)
    assert(JSON.stringify(carouselHome.hero) === '[0,0,1920,640]', `Cinematic hero geometry is ${carouselHome.hero}.`)
    assert(JSON.stringify(carouselHome.rows) === '[640,440]', `Cinematic rail geometry is ${carouselHome.rows}.`)
    assert(JSON.stringify(carouselHome.card) === '[238,340]', `Cinematic card geometry is ${carouselHome.card}.`)
    assert(carouselHome.cards.length >= 5 && carouselHome.cards.every(function (card) { return card[2]; }), `Cinematic rail did not render its artwork: ${JSON.stringify(carouselHome)}.`)
    assert(!carouselHome.expanded && !carouselHome.receding, 'Cinematic mode expanded a card or hid its hero.')
    assert(carouselHome.cardTitle.includes(carouselHome.heroTitle), 'Focused carousel artwork did not update the hero.')
    assert(/Continue Watching|Trending|Popular/i.test(carouselHome.rankContext), `Hero ranking context is missing: ${carouselHome.rankContext}.`)
    await waitFor("document.querySelector('.home-hover-trailer')")
    const hoverTrailer = await evaluate(`(() => {
      var trailer = document.querySelector('.home-hover-trailer');
      return { source: trailer.src, title: trailer.title };
    })()`)
    assert(hoverTrailer.source.includes('autoplay=1') && hoverTrailer.source.includes('mute=1'), `Focused-card trailer is not muted autoplay: ${hoverTrailer.source}.`)
    assert(hoverTrailer.title.includes(carouselHome.heroTitle), `Focused-card trailer label is incorrect: ${hoverTrailer.title}.`)
    await capture('m56-home-carousel.png')

    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?preview=1&capture=1&screen=trending&layout=carousel` })
    await waitFor("document.readyState === 'complete' && document.querySelector('.home-screen.page-browse.mode-carousel')")
    await waitFor("!document.getElementById('startup-splash')")
    const mergedBrowse = await evaluate(`(() => {
      var page = document.querySelector('.home-screen.page-browse');
      var hero = page.querySelector('.hero').getBoundingClientRect();
      return {
        label: page.getAttribute('aria-label'),
        catalogue: page.querySelector('.nav-mark-button span').textContent.trim(),
        activeNavigation: page.querySelector('.nav-item.is-active').getAttribute('aria-label'),
        hero: [hero.left, hero.top, hero.width, hero.height],
        pips: page.querySelectorAll('.hero-carousel-pips > i').length,
        rows: Array.from(page.querySelectorAll('.media-row > h2')).map(function (heading) { return heading.textContent.trim(); }),
        legacyGrid: Boolean(page.querySelector('.browse-catalog, .browse-grid'))
      };
    })()`)
    assert(mergedBrowse.label === 'Browse merged catalogue', `Browse does not identify its merged catalogue: ${JSON.stringify(mergedBrowse)}.`)
    assert(mergedBrowse.catalogue === 'Merged' && mergedBrowse.activeNavigation === 'Browse', `Browse did not select Merged: ${JSON.stringify(mergedBrowse)}.`)
    assert(JSON.stringify(mergedBrowse.hero) === '[0,0,1920,640]' && mergedBrowse.pips >= 2, `Browse is missing the Home carousel: ${JSON.stringify(mergedBrowse)}.`)
    assert(mergedBrowse.rows.length >= 3 && !mergedBrowse.legacyGrid, `Browse still uses the legacy grid: ${JSON.stringify(mergedBrowse)}.`)
    assert(mergedBrowse.rows.includes('Anime') && mergedBrowse.rows.includes('Fantasy') && mergedBrowse.rows.includes('Action & Adventure'), `Browse did not derive conservative merged categories: ${JSON.stringify(mergedBrowse.rows)}.`)
    await press('ArrowDown')
    await waitFor("document.querySelector('.page-browse .home-poster-card.is-focused')")
    const browseRail = await evaluate(`(() => {
      var card = document.querySelector('.page-browse .home-poster-card.is-focused');
      return { title: card.getAttribute('aria-label'), hero: document.querySelector('.page-browse .hero h1').textContent };
    })()`)
    assert(browseRail.title.includes(browseRail.hero), `Browse rail focus did not update its hero: ${JSON.stringify(browseRail)}.`)
    await capture('m56-browse-merged.png')

    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?preview=1&capture=1&screen=search` })
    await waitFor("document.readyState === 'complete' && document.querySelector('[data-search-key=\"b\"]')")
    await waitFor("!document.getElementById('startup-splash')")
    const searchFieldSpacing = await evaluate(`(() => {
      var field = document.querySelector('.search-query');
      var icon = field.querySelector('svg').getBoundingClientRect();
      var input = field.querySelector('input').getBoundingClientRect();
      return Math.round(input.left - icon.right);
    })()`)
    assert(searchFieldSpacing >= 12, `Search icon is only ${searchFieldSpacing}px from its text.`)
    await evaluate("document.querySelector('[data-search-key=\"a\"]').focus()")
    await press('ArrowLeft')
    await waitFor("document.querySelector('[data-search-key=\"voice\"]').classList.contains('is-focused')")
    await press('ArrowRight')
    await waitFor("document.querySelector('.search-result-grid .browse-card.is-focused')")
    await evaluate("document.querySelector('[data-search-key=\"b\"]').focus()")
    await waitFor("document.querySelector('[data-search-key=\"b\"]').classList.contains('is-focused')")
    await press('ArrowUp')
    await waitFor("document.querySelector('[data-search-key=\"space\"]').classList.contains('is-focused')")
    await press('ArrowDown')
    const keyboardFocus = await evaluate("document.querySelector('.search-keyboard > .is-focused').getAttribute('data-search-key')")
    assert(keyboardFocus === 'b', `Vertical keyboard navigation drifted diagonally to ${keyboardFocus}.`)
    for (let column = 0; column < 6; column += 1) {
      await evaluate(`document.querySelector('[data-search-row="1"][data-search-column="${column}"]').focus()`)
      await waitFor(`document.querySelector('.search-keyboard > .is-focused').getAttribute('data-search-column') === '${column}'`)
      const laneLeft = await evaluate("document.querySelector('.search-keyboard > .is-focused').offsetLeft")
      for (let row = 2; row <= 6; row += 1) {
        await press('ArrowDown')
        const verticalKey = await evaluate(`(() => {
          var key = document.querySelector('.search-keyboard > .is-focused');
          return [Number(key.getAttribute('data-search-row')), Number(key.getAttribute('data-search-column')), key.offsetLeft];
        })()`)
        assert(verticalKey[0] === row && verticalKey[1] === column && Math.abs(verticalKey[2] - laneLeft) <= 1, `Keyboard moved diagonally in column ${column}: expected x ${laneLeft}, received ${verticalKey}.`)
      }
    }
    await capture('m56-search-keyboard.png')
    await evaluate("document.querySelector('[data-focus-id=\"nav-0\"]').focus()")
    await press('Enter')
    const homeSkeleton = await waitFor(`(() => {
      var skeleton = document.querySelector('.navigation-skeleton.skeleton-home');
      if (!skeleton) return null;
      var block = skeleton.querySelector('.skeleton-block');
      return { blocks: skeleton.querySelectorAll('.skeleton-block').length, animation: getComputedStyle(block).animationName };
    })()`)
    assert(homeSkeleton.blocks >= 12 && homeSkeleton.animation.includes('skeleton-pulse'), `Home skeleton does not match or animate on M56: ${JSON.stringify(homeSkeleton)}.`)

    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?preview=1&capture=1&screen=player&scenario=buffering` })
    await waitFor("document.readyState === 'complete' && document.querySelector('.player-buffering-status')")
    await waitFor("document.querySelector('.player-state-icon.is-focused')")
    await waitFor("!document.getElementById('startup-splash')")
    const bufferingPlayer = await evaluate(`(() => ({
      status: document.querySelector('.player-buffering-status').textContent,
      transport: document.querySelector('.player-state-icon').getAttribute('aria-label'),
      transportFocused: document.querySelector('.player-state-icon').classList.contains('is-focused'),
      position: Number(document.querySelector('.player-timeline-control').getAttribute('aria-valuenow'))
    }))()`)
    assert(bufferingPlayer.status.includes('Buffering') && bufferingPlayer.status.includes('46%'), `Buffering indicator is incomplete: ${bufferingPlayer.status}.`)
    assert(bufferingPlayer.transport === 'Pause' && bufferingPlayer.transportFocused, `Playing transport is not a focused Pause action: ${JSON.stringify(bufferingPlayer)}.`)
    await press('ArrowDown')
    await waitFor("document.querySelector('.player-timeline-control.is-focused')")
    await press('ArrowRight')
    const scrubbedPosition = await evaluate("Number(document.querySelector('.player-timeline-control').getAttribute('aria-valuenow'))")
    assert(scrubbedPosition > bufferingPlayer.position, `Buffering timeline did not seek: ${bufferingPlayer.position} -> ${scrubbedPosition}.`)
    await cdp.call('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key: 'MediaFastForward', code: 'MediaFastForward', windowsVirtualKeyCode: 417, nativeVirtualKeyCode: 417,
    })
    await wait(1_650)
    const heldSeek = await evaluate(`(() => ({
      position: Number(document.querySelector('.player-timeline-control').getAttribute('aria-valuenow')),
      multiplier: document.querySelector('.player-seek-feedback strong').textContent,
      chevrons: document.querySelectorAll('.player-seek-chevrons svg').length
    }))()`)
    await cdp.call('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'MediaFastForward', code: 'MediaFastForward', windowsVirtualKeyCode: 417, nativeVirtualKeyCode: 417,
    })
    assert(heldSeek.position >= scrubbedPosition + 70, `Held fast-forward did not accumulate: ${scrubbedPosition} -> ${heldSeek.position}.`)
    assert(heldSeek.multiplier === '3×' && heldSeek.chevrons === 3, `Held fast-forward feedback is incomplete: ${JSON.stringify(heldSeek)}.`)
    await press('ArrowDown')
    await waitFor("document.querySelector('.player-actions > button.is-focused')")
    await capture('m56-player-buffering.png')

    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?preview=1&capture=1&screen=player&scenario=next` })
    await waitFor("document.readyState === 'complete' && document.querySelector('.next-episode-card')")
    await waitFor("document.querySelector('.player-skip')")
    const playbackPrompts = await evaluate(`(() => ({
      next: document.querySelector('.next-episode-card').textContent,
      skip: document.querySelector('.player-skip').textContent,
      markers: document.querySelectorAll('.player-segment-marker').length,
      nextTop: Math.round(document.querySelector('.next-episode-card').getBoundingClientRect().top),
      body: [document.body.scrollWidth, document.body.scrollHeight]
    }))()`)
    assert(playbackPrompts.next.includes('S1 E13') && playbackPrompts.next.includes('Play next episode'), `Next episode prompt is incomplete: ${playbackPrompts.next}.`)
    assert(playbackPrompts.skip.toLowerCase().includes('skip'), `Skip prompt is incomplete: ${playbackPrompts.skip}.`)
    assert(playbackPrompts.markers === 2, `Expected two skip markers, received ${playbackPrompts.markers}.`)
    assert(playbackPrompts.nextTop < 160, `Up-next card did not enter at its stable top position: ${playbackPrompts.nextTop}.`)
    assert(JSON.stringify(playbackPrompts.body) === '[1920,1080]', `Player prompts overflowed the TV viewport: ${playbackPrompts.body}.`)
    await capture('m56-player-prompts.png')

    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?preview=1&capture=1&screen=postplay` })
    await waitFor("document.readyState === 'complete' && document.querySelector('.post-play-recommendations button')")
    await waitFor("!document.getElementById('startup-splash')")
    const postPlay = await evaluate(`(() => ({
      heading: document.querySelector('.post-play-recommendations header p').textContent,
      recommendations: document.querySelectorAll('.post-play-recommendations button').length,
      actions: document.querySelectorAll('.post-play-actions button').length,
      body: [document.body.scrollWidth, document.body.scrollHeight]
    }))()`)
    assert(postPlay.heading === 'More like this', `Post-play heading is ${postPlay.heading}.`)
    assert(postPlay.recommendations >= 4, `Post-play has only ${postPlay.recommendations} recommendations.`)
    assert(postPlay.actions === 2, `Post-play action count is ${postPlay.actions}.`)
    assert(JSON.stringify(postPlay.body) === '[1920,1080]', `Post-play overflowed the TV viewport: ${postPlay.body}.`)
    await capture('m56-post-play.png')

    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?preview=1&capture=1&screen=settings` })
    await waitFor("document.readyState === 'complete' && document.querySelectorAll('.settings-options > button').length === 7")
    await waitFor("!document.getElementById('startup-splash')")
    const settings = await evaluate(`(() => ({
      options: document.querySelectorAll('.settings-options > button').length,
      toggles: document.querySelectorAll('.settings-toggle').length,
      panelBottom: document.querySelector('.settings-panel').getBoundingClientRect().bottom,
      body: [document.body.scrollWidth, document.body.scrollHeight]
    }))()`)
    assert(settings.options === 7 && settings.toggles === 5, `Playback settings are incomplete: ${settings.options}/${settings.toggles}.`)
    assert(settings.panelBottom <= 1080, `Settings panel is clipped at ${settings.panelBottom}px.`)
    assert(JSON.stringify(settings.body) === '[1920,1080]', `Settings overflowed the TV viewport: ${settings.body}.`)
    await capture('m56-playback-settings.png')

    const exceptions = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown')
    const applicationExceptions = exceptions.filter((event) => !/^https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\//i.test(event.params?.exceptionDetails?.url ?? ''))
    assert(applicationExceptions.length === 0, `Chromium 56 reported ${applicationExceptions.length} application exception(s): ${JSON.stringify(applicationExceptions.map((event) => event.params?.exceptionDetails))}`)
    process.stdout.write('Chromium 56 check passed: Home geometry, merged Browse carousel, one-photo tiles, looping rails, straight search navigation, animated skeletons, accelerated seeking, trailer fallback, player prompts, and no application runtime errors.\n')
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
