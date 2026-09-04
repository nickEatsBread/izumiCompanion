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

async function waitForExit(child, timeout = 2_000) {
  if (child.exitCode !== null) return
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(timeout),
  ])
}

async function removeTemporaryProfile(path) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if (!['EBUSY', 'EPERM'].includes(error?.code) || attempt === 5) throw error
      await wait(250 * (attempt + 1))
    }
  }
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
  const url = `http://127.0.0.1:${port}/?preview=1&capture=1&profile=1&screen=home`
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
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1918, y: 2 })

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
    const codes = { Enter: 13, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, MediaFastForward: 417, MediaRewind: 412 }
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
    await evaluate("document.documentElement.style.pointerEvents = 'none'")
    for (let index = 0; index < 8; index += 1) {
      if (!(await evaluate("document.querySelector('.media-row.is-active')"))) break
      await press('ArrowUp')
    }
    await waitFor("document.querySelector('.hero-button.primary.is-focused')")

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
        titleLogo: document.querySelector('.hero-title-logo') ? document.querySelector('.hero-title-logo').getAttribute('alt') : '',
        plainTitle: Boolean(document.querySelector('.hero-copy > h1')),
        ratings: Array.from(document.querySelectorAll('.hero-rating')).map(function (rating) { return rating.getAttribute('aria-label'); }),
        imdbBadge: document.querySelector('.hero-rating-source.is-imdb') ? document.querySelector('.hero-rating-source.is-imdb').textContent.trim() : '',
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
    assert(hero.titleLogo === "Frieren: Beyond Journey's End" && !hero.plainTitle, `Continue Watching hero did not prefer its title logo: ${JSON.stringify(hero)}.`)
    assert(hero.ratings.includes('IMDb 8.9') && hero.ratings.includes('Rotten Tomatoes 97%') && hero.imdbBadge === 'IMDb', `Supplied hero ratings or IMDb branding are missing: ${JSON.stringify(hero)}.`)
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
      continueProgressGeometry: (() => {
        var frame = document.querySelector('.home-focus-frame').getBoundingClientRect();
        var progress = document.querySelector('.home-focus-card .home-card-progress').getBoundingClientRect();
        return [progress.height, Math.round(frame.bottom - progress.bottom)];
      })(),
      rowTransition: getComputedStyle(document.querySelector('.media-row')).transitionDuration,
      focusAnimation: getComputedStyle(document.querySelector('.home-focus-frame')).animationDuration,
      mediaAnimation: getComputedStyle(document.querySelector('.home-focus-media')).animationDuration,
      mediaTransform: getComputedStyle(document.querySelector('.home-focus-media')).transform,
      cardTransform: getComputedStyle(document.querySelector('.home-focus-card')).transform,
      trackTransform: getComputedStyle(document.querySelector('.home-motion-track')).transform
    }))()`)
    assert(JSON.stringify(rows.body) === '[1920,1080]', `Home overflowed the TV viewport: ${rows.body}.`)
    assert(JSON.stringify(rows.tops.slice(0, 3)) === '[52,934,1454]', `Unexpected row positions ${rows.tops}.`)
    assert(rows.images.slice(0, 2).every((count) => count > 0) && rows.images[2] === 0, `Artwork windowing is incorrect: ${rows.images}.`)
    assert(JSON.stringify(rows.posterWidths) === '[320]', `Poster stride changed during focus: ${rows.posterWidths}.`)
    assert(rows.gap === '20px', `M56 rail fallback gap is ${rows.gap}, expected 20px.`)
    assert(JSON.stringify(rows.focus) === '[132,106,1120,820,1112,626]', `Unexpected focus spotlight geometry ${rows.focus}.`)
    assert(rows.continueCopy.includes('S1 E12') && rows.continueCopy.includes('9m left'), `Continue Watching context is incomplete: ${rows.continueCopy}.`)
    assert(rows.continueProgress === '64%', `Continue Watching progress is ${rows.continueProgress}.`)
    assert(JSON.stringify(rows.continueProgressGeometry) === '[8,5]', `Continue Watching progress is hidden by the focus outline: ${rows.continueProgressGeometry}.`)
    assert(rows.rowTransition === '0s', `The rail frame moves during vertical navigation: ${rows.rowTransition}.`)
    assert(rows.focusAnimation === '0s', `The focus outline moves with its content: ${rows.focusAnimation}.`)
    assert(rows.mediaAnimation !== '0s', `Focused artwork transition is disabled: ${rows.mediaAnimation}.`)
    assert(rows.mediaTransform === 'none' && rows.cardTransform === 'none', `A settled focused tile retains a compositor layer over its title: ${JSON.stringify(rows)}.`)
    assert(rows.trackTransform === 'none', 'Vertical navigation transformed the full Home page.')
    await capture('m56-continue-watching.png')

    await press('ArrowRight')
    await waitFor("document.querySelector('.home-focus-logo[alt=\"Attack on Titan\"]')")
    const prefetchedTitleArt = await evaluate(`(() => {
      var card = document.querySelector('.home-focus-card.is-focused');
      var logo = card.querySelector('.home-focus-logo');
      return {
        logo: logo ? logo.getAttribute('alt') : '',
        plainText: Boolean(card.querySelector('.home-focus-title')),
        pending: Boolean(card.querySelector('.home-focus-title-pending'))
      };
    })()`)
    assert(prefetchedTitleArt.logo === 'Attack on Titan' && !prefetchedTitleArt.plainText && !prefetchedTitleArt.pending,
      `A prefetched provider logo swapped through text or disappeared: ${JSON.stringify(prefetchedTitleArt)}.`)
    for (let index = 0; index < 2; index += 1) await press('ArrowRight')
    await press('ArrowDown')
    await wait(360)
    const verticalDestination = await evaluate(`(() => {
      var focused = document.querySelector('.home-focus-card.is-focused');
      var frame = focused.querySelector('.home-focus-frame').getBoundingClientRect();
      var copy = focused.querySelector('.home-focus-logo, .home-focus-title');
      var copyBounds = copy.getBoundingClientRect();
      var facts = focused.querySelector('.home-focus-facts');
      var description = focused.querySelector('.home-focus-description');
      var cardBounds = focused.getBoundingClientRect();
      var descriptionBounds = description.getBoundingClientRect();
      return {
        row: Number(focused.closest('.media-row').getAttribute('data-home-row')),
        index: Number(focused.getAttribute('data-media-index')),
        frame: [frame.left, frame.top, frame.width, frame.height],
        copy: [copyBounds.top, copyBounds.bottom],
        copySize: [copyBounds.width, copyBounds.height],
        logo: copy.classList.contains('home-focus-logo') ? copy.getAttribute('alt') : '',
        plainTitle: Boolean(focused.querySelector('.home-focus-title')),
        copyAnimation: getComputedStyle(copy).animationName,
        achievements: Array.from(focused.querySelectorAll('.home-achievement')).map(function (item) { return item.textContent.trim(); }),
        achievementParts: Array.from(focused.querySelectorAll('.home-achievement')).map(function (item) {
          var lead = item.querySelector('.home-achievement-lead');
          var context = item.querySelector('.home-achievement-context');
          return { lead: lead ? lead.textContent.trim() : '', context: context ? context.textContent.trim() : '', contextColor: context ? getComputedStyle(context).color : '' };
        }),
        achievementIcons: focused.querySelectorAll('.home-achievement > svg').length,
        facts: Array.from(focused.querySelectorAll('.home-focus-facts > span')).map(function (item) { return item.textContent.trim(); }),
        factsColor: getComputedStyle(facts).color,
        description: description.textContent.trim(),
        descriptionColor: getComputedStyle(description).color,
        descriptionWeight: getComputedStyle(description).fontWeight,
        descriptionBounds: [Math.round(descriptionBounds.top), Math.round(descriptionBounds.bottom), Math.round(cardBounds.bottom)],
        previousRowVisibility: getComputedStyle(document.querySelector('.media-row[data-home-row="0"]')).visibility,
        previousRowTop: Math.round(document.querySelector('.media-row[data-home-row="0"]').getBoundingClientRect().top),
        nextRowOpacity: getComputedStyle(document.querySelector('.media-row[data-home-row="2"]')).opacity,
        sourceLogoAlignment: (() => {
          var image = focused.querySelector('.home-achievement-source-logo');
          var badge = image.closest('.home-achievement');
          var imageBounds = image.getBoundingClientRect();
          var badgeBounds = badge.getBoundingClientRect();
          return [Math.round(imageBounds.height), Math.round((imageBounds.top + imageBounds.bottom) / 2 - (badgeBounds.top + badgeBounds.bottom) / 2)];
        })()
      };
    })()`)
    assert(verticalDestination.row === 1 && verticalDestination.index === 0, `A new rail inherited the previous rail position: ${JSON.stringify(verticalDestination)}.`)
    assert(verticalDestination.frame[0] === 136 && Math.abs(verticalDestination.frame[1] - 110) <= 3 && verticalDestination.frame[2] === 1112 && verticalDestination.frame[3] === 626, `Vertical navigation moved the focus outline: ${verticalDestination.frame}.`)
    assert(verticalDestination.copy[0] >= verticalDestination.frame[1] && verticalDestination.copy[1] <= verticalDestination.frame[1] + verticalDestination.frame[3], `Focused title treatment is clipped outside its frame: ${verticalDestination.copy}.`)
    assert(verticalDestination.logo === 'Chainsaw Man' && !verticalDestination.plainTitle, `Focused card did not prefer its source logo: ${JSON.stringify(verticalDestination)}.`)
    assert(JSON.stringify(verticalDestination.copySize) === '[460,130]', `Focused title logo has no stable M56 paint box: ${verticalDestination.copySize}.`)
    assert(verticalDestination.copyAnimation === 'none', `Focused title treatment is delayed by an opacity animation: ${verticalDestination.copyAnimation}.`)
    assert(verticalDestination.achievements.length === 2 && verticalDestination.achievementIcons === 2, `Focused achievements are incomplete: ${JSON.stringify(verticalDestination)}.`)
    assert(verticalDestination.achievementParts[1].lead === '#31' && verticalDestination.achievementParts[1].context === 'Highest rated 2022' && verticalDestination.achievementParts[1].contextColor.includes('0.72'), `Achievement hierarchy is not split or capitalized: ${JSON.stringify(verticalDestination.achievementParts)}.`)
    assert(JSON.stringify(verticalDestination.facts) === '["Show","Action","2022","12 episodes"]', `Focused facts repeat shelf copy or omit metadata: ${JSON.stringify(verticalDestination.facts)}.`)
    assert(verticalDestination.factsColor === 'rgb(255, 255, 255)', `Focused metadata is not white: ${verticalDestination.factsColor}.`)
    assert(verticalDestination.description.includes('devil hunter') && verticalDestination.descriptionWeight === '500', `Focused synopsis is missing or over-emphasized: ${JSON.stringify(verticalDestination)}.`)
    assert(verticalDestination.descriptionColor !== verticalDestination.factsColor && verticalDestination.descriptionBounds[1] <= verticalDestination.descriptionBounds[2], `Focused synopsis hierarchy or clipping is incorrect: ${JSON.stringify(verticalDestination)}.`)
    assert(verticalDestination.previousRowVisibility === 'hidden' && verticalDestination.previousRowTop === -900,
      `The previous rail remains visible above the active rail: ${JSON.stringify(verticalDestination)}.`)
    assert(Number(verticalDestination.nextRowOpacity) > 0.45 && Number(verticalDestination.nextRowOpacity) < 0.65,
      `The next rail does not recede behind the active rail: ${verticalDestination.nextRowOpacity}.`)
    assert(JSON.stringify(verticalDestination.sourceLogoAlignment) === '[22,0]', `The AniList mark is not inline with its achievement: ${verticalDestination.sourceLogoAlignment}.`)
    await waitFor("document.querySelector('.home-trailer-footer')")
    await evaluate(`(() => {
      document.querySelector('.home-focus-card').classList.add('is-trailer-playing');
      document.querySelector('.home-focus-card .home-hover-trailer').classList.add('is-playing');
    })()`)
    await wait(260)
    const activeTrailerPresentation = await evaluate(`(() => {
      var card = document.querySelector('.home-focus-card');
      var title = card.querySelector('.home-focus-logo, .home-focus-title');
      var footerTitle = card.querySelector('.home-trailer-footer > span');
      return {
        shade: getComputedStyle(card.querySelector('.home-focus-shade')).opacity,
        title: getComputedStyle(title).opacity,
        footer: getComputedStyle(card.querySelector('.home-trailer-footer')).opacity,
        footerCopy: card.querySelector('.home-trailer-footer').textContent.trim(),
        footerDecorations: card.querySelectorAll('.home-trailer-footer > i, .home-trailer-footer > strong').length,
        footerTitleOpacity: getComputedStyle(footerTitle).opacity,
        footerOverflow: getComputedStyle(footerTitle).textOverflow,
        achievements: getComputedStyle(card.querySelector('.home-focus-achievements')).opacity,
        achievementWidths: Array.from(card.querySelectorAll('.home-achievement')).map(function (item) { return Math.round(item.getBoundingClientRect().width); }),
        anilistLogo: Boolean(card.querySelector('.home-achievement-source-logo[alt="AniList"]')),
        sourceText: Array.from(card.querySelectorAll('.home-achievement small')).map(function (item) { return item.textContent.trim(); }),
        trailerParent: card.querySelector('.home-hover-trailer').parentElement.className,
        trailerVisibility: getComputedStyle(card.querySelector('.home-hover-trailer')).visibility,
        trailerTransform: getComputedStyle(card.querySelector('.home-hover-trailer')).transform,
        cardTransform: getComputedStyle(card).transform,
        mediaTransform: getComputedStyle(card.querySelector('.home-focus-media')).transform,
        mediaWillChange: getComputedStyle(card.querySelector('.home-focus-media')).willChange,
        rowTransform: getComputedStyle(card.closest('.media-row')).transform,
        rowsTransform: getComputedStyle(card.closest('.catalog-rows')).transform
      };
    })()`)
    assert(activeTrailerPresentation.shade === '0' && activeTrailerPresentation.title === '0' && activeTrailerPresentation.footer === '1', `Trailer chrome does not clear the full video: ${JSON.stringify(activeTrailerPresentation)}.`)
    assert(activeTrailerPresentation.footerCopy === 'Chainsaw Man' && activeTrailerPresentation.footerDecorations === 0, `Trailer footer still includes completion copy or a separator: ${JSON.stringify(activeTrailerPresentation)}.`)
    assert(Number(activeTrailerPresentation.footerTitleOpacity) < 1 && activeTrailerPresentation.footerOverflow === 'ellipsis', `Long trailer titles cannot yield space to their content label: ${JSON.stringify(activeTrailerPresentation)}.`)
    assert(activeTrailerPresentation.achievements === '0' && activeTrailerPresentation.anilistLogo && !activeTrailerPresentation.sourceText.includes('AniList'), `Trailer/source achievement treatment is incorrect: ${JSON.stringify(activeTrailerPresentation)}.`)
    assert(activeTrailerPresentation.achievementWidths.every(function (width) { return width < 430; }), `Achievement badges retain an empty black tail: ${activeTrailerPresentation.achievementWidths}.`)
    assert(activeTrailerPresentation.trailerParent === 'home-focus-frame' && activeTrailerPresentation.trailerVisibility === 'visible', `Trailer is not revealed from the stable focus frame: ${JSON.stringify(activeTrailerPresentation)}.`)
    assert(activeTrailerPresentation.trailerTransform === 'none' && activeTrailerPresentation.cardTransform === 'none'
      && activeTrailerPresentation.mediaTransform === 'none' && activeTrailerPresentation.mediaWillChange === 'auto'
      && activeTrailerPresentation.rowTransform === 'none' && activeTrailerPresentation.rowsTransform === 'none',
      `Trailer playback still sits in an M56 compositor transform: ${JSON.stringify(activeTrailerPresentation)}.`)
    await capture('m56-trailer-playing.png')
    await evaluate(`(() => {
      var trailer = document.querySelector('.home-focus-card .home-hover-trailer');
      if (trailer) trailer.remove();
      document.querySelector('.home-focus-card').classList.remove('is-trailer-playing');
    })()`)
    await wait(260)
    const restoredTrailerPresentation = await evaluate(`(() => {
      var card = document.querySelector('.home-focus-card');
      return {
        shade: getComputedStyle(card.querySelector('.home-focus-shade')).opacity,
        title: getComputedStyle(card.querySelector('.home-focus-logo, .home-focus-title')).opacity,
        footer: getComputedStyle(card.querySelector('.home-trailer-footer')).opacity,
        achievements: getComputedStyle(card.querySelector('.home-focus-achievements')).opacity
      };
    })()`)
    assert(JSON.stringify(restoredTrailerPresentation) === '{"shade":"1","title":"1","footer":"0","achievements":"1"}', `Trailer end-state did not restore the tile treatment: ${JSON.stringify(restoredTrailerPresentation)}.`)
    await capture('m56-focused-rail.png')
    await evaluate("window.__IZUMI_TV_PROFILE__.clear()")
    await press('ArrowRight')
    await waitFor("document.querySelector('.home-focus-card.is-focused .home-focus-logo[alt=\"Solo Leveling\"]')")
    const soloLevelingLogo = await evaluate(`(() => {
      var image = document.querySelector('.home-focus-card.is-focused .home-focus-logo');
      return { source: image.src, natural: [image.naturalWidth, image.naturalHeight], title: image.alt };
    })()`)
    assert(soloLevelingLogo.title === 'Solo Leveling' && soloLevelingLogo.source.includes('pFID4dA9XKFbFXlcnx24Nlmx0KX.png') && soloLevelingLogo.natural[0] > 0,
      `Solo Leveling is not using its matching image logo: ${JSON.stringify(soloLevelingLogo)}.`)
    await capture('m56-solo-leveling-title-logo.png')
    await press('ArrowLeft')
    await waitFor("document.querySelector('.home-focus-card.is-focused .home-focus-logo[alt=\"Chainsaw Man\"]')")
    for (let index = 0; index < 3; index += 1) await press('ArrowRight')
    await waitFor("document.querySelector('.home-focus-art')")
    for (let index = 3; index < 8; index += 1) await press('ArrowRight')
    await waitFor("document.querySelector('.home-focus-card.is-focused .home-focus-logo[alt=\"Attack on Titan\"]')")
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
        posterAnimations: Array.from(new Set(Array.from(strip.querySelectorAll('.home-poster-card')).map(function (card) { return getComputedStyle(card).animationDuration; }))),
        focusLeft: focused.getBoundingClientRect().left,
        focusAnimation: getComputedStyle(focused.querySelector('.home-focus-frame')).animationDuration,
        mediaAnimation: getComputedStyle(focused.querySelector('.home-focus-media')).animationDuration,
        mediaOpacity: getComputedStyle(focused.querySelector('.home-focus-media')).opacity,
        mediaWillChange: getComputedStyle(focused.querySelector('.home-focus-media')).willChange,
        fallbackTitle: focused.querySelector('.home-focus-title') ? focused.querySelector('.home-focus-title').textContent.trim() : '',
        fallbackWeight: focused.querySelector('.home-focus-title') ? getComputedStyle(focused.querySelector('.home-focus-title')).fontWeight : '',
        titleLogo: focused.querySelector('.home-focus-logo') ? focused.querySelector('.home-focus-logo').getAttribute('alt') : '',
        titleLogoSource: focused.querySelector('.home-focus-logo') ? focused.querySelector('.home-focus-logo').src : '',
        titlePending: Boolean(focused.querySelector('.home-focus-title-pending')),
        artworkTransition: getComputedStyle(focused.querySelector('.home-focus-art')).transitionDuration,
        artworkLayers: focused.querySelectorAll('.home-focus-media > img').length,
        cyclic: strip.getAttribute('data-cyclic'),
        spacers: strip.querySelectorAll('.media-card-spacer').length,
        stripTransform: getComputedStyle(strip).transform,
        broken: Array.from(document.images).filter(function (image) { return image.complete && !image.naturalWidth; }).length
      };
    })()`)
    assert(horizontal.index === 8, `Expected rail index 8, received ${horizontal.index}.`)
    assert(horizontal.scrollLeft === 0 && horizontal.cyclic === 'true' && horizontal.spacers === 0, `Horizontal navigation still exposes a finite rail seam: ${JSON.stringify(horizontal)}.`)
    assert(horizontal.width === 1120 && horizontal.visualWidth === 1120, `Focused spotlight changed geometry: ${horizontal.width}/${horizontal.visualWidth}px.`)
    assert(JSON.stringify(horizontal.posterWidths) === '[320]', `Neighbour cards reflowed: ${horizontal.posterWidths}.`)
    assert(JSON.stringify(horizontal.posterAnimations) === '["0s"]', `Cyclic navigation still replays the grey poster-entry frame: ${horizontal.posterAnimations}.`)
    assert(horizontal.focusLeft === 132, `Focus outline moved during horizontal navigation: ${horizontal.focusLeft}px.`)
    assert(horizontal.focusAnimation === '0s', `Focus outline animation is enabled: ${horizontal.focusAnimation}.`)
    assert(horizontal.mediaAnimation !== '0s', `Focused content animation is disabled: ${horizontal.mediaAnimation}.`)
    assert(horizontal.mediaOpacity === '1', `Horizontal navigation dims the focused tile to ${horizontal.mediaOpacity}.`)
    assert(horizontal.mediaWillChange === 'auto', `Focused artwork retains an unnecessary compositor allocation: ${horizontal.mediaWillChange}.`)
    assert(horizontal.titleLogo === 'Attack on Titan' && !horizontal.fallbackTitle && !horizontal.titlePending,
      `Late provider title art disappeared or swapped through plain text: ${JSON.stringify(horizontal)}.`)
    assert(horizontal.titleLogoSource.includes('attack-on-titan-logo'),
      `The focused title is paired with unrelated logo artwork: ${horizontal.titleLogoSource}.`)
    assert(horizontal.artworkTransition === '0s' && horizontal.artworkLayers === 1, `Focused tile crossfades multiple photos: ${horizontal.artworkTransition}/${horizontal.artworkLayers}.`)
    assert(horizontal.stripTransform === 'none', 'Horizontal navigation transformed the entire rail.')
    assert(horizontal.broken === 0, `${horizontal.broken} artwork images failed.`)
    const focusPerformance = await evaluate(`(() => {
      var values = window.__IZUMI_TV_PROFILE__.read().filter(function (entry) {
        return entry.name === 'focus-applied' && typeof entry.duration === 'number';
      }).map(function (entry) { return entry.duration; });
      return {
        count: values.length,
        maximum: values.length ? Math.max.apply(Math, values) : 0,
        average: values.length ? values.reduce(function (total, value) { return total + value; }, 0) / values.length : 0
      };
    })()`)
    assert(focusPerformance.count >= 10, `The M56 focus profiler missed navigation events: ${JSON.stringify(focusPerformance)}.`)
    assert(focusPerformance.maximum < 100, `A D-pad focus update exceeded the 100ms response budget: ${JSON.stringify(focusPerformance)}.`)
    await waitFor("document.querySelector('.home-focus-logo').complete && document.querySelector('.home-focus-logo').naturalWidth > 0")
    const verifiedTitleLogo = await evaluate(`(() => {
      var image = document.querySelector('.home-focus-logo');
      var box = image.getBoundingClientRect();
      var card = document.querySelector('.home-focus-card.is-focused');
      return { title: card.getAttribute('aria-label'), alt: image.alt, natural: [image.naturalWidth, image.naturalHeight], box: [box.width, box.height], source: image.src };
    })()`)
    assert(verifiedTitleLogo.alt === 'Attack on Titan' && verifiedTitleLogo.title.includes('Attack on Titan')
      && verifiedTitleLogo.source.includes('attack-on-titan-logo')
      && verifiedTitleLogo.natural[0] > 0 && JSON.stringify(verifiedTitleLogo.box) === '[460,130]',
      `Title-specific logo artwork did not paint for its matching card: ${JSON.stringify(verifiedTitleLogo)}.`)
    await capture('m56-matching-title-logo.png')

    await press('ArrowRight')
    await waitFor("document.querySelector('.home-focus-card.is-focused .home-focus-title')")
    const fallbackTitle = await evaluate(`(() => {
      var card = document.querySelector('.home-focus-card.is-focused');
      var title = card.querySelector('.home-focus-title');
      var style = getComputedStyle(title);
      return {
        label: card.getAttribute('aria-label'),
        text: title.textContent.trim(),
        logo: Boolean(card.querySelector('.home-focus-logo')),
        treatment: card.getAttribute('data-title-treatment'),
        size: style.fontSize,
        weight: style.fontWeight,
        transform: style.textTransform
      };
    })()`)
    assert(fallbackTitle.label.includes('Jujutsu Kaisen') && fallbackTitle.text === 'Jujutsu Kaisen'
      && !fallbackTitle.logo && fallbackTitle.treatment === 'text',
      `A missing provider logo did not use the matching title fallback: ${JSON.stringify(fallbackTitle)}.`)
    assert(parseFloat(fallbackTitle.size) <= 24 && Number(fallbackTitle.weight) <= 500 && fallbackTitle.transform === 'none',
      `Fallback text is still styled as an oversized fake logo: ${JSON.stringify(fallbackTitle)}.`)
    await capture('m56-compact-title-fallback.png')
    await press('ArrowRight')
    await wait(220)
    const wrappedRail = await evaluate(`(() => {
      var focused = document.querySelector('.home-focus-card.is-focused');
      var strip = focused.closest('.media-row').querySelector('.media-strip');
      return {
        index: Number(focused.getAttribute('data-media-index')),
        motion: focused.className,
        neighbours: Array.from(strip.querySelectorAll('.home-poster-card')).map(function (card) { return Number(card.getAttribute('data-media-index')); }),
        spacers: strip.querySelectorAll('.media-card-spacer').length,
        outlines: focused.closest('.media-row').querySelectorAll('.home-focus-outline').length
      };
    })()`)
    assert(wrappedRail.index === 0, `Right navigation did not loop to the start of the rail: ${JSON.stringify(wrappedRail)}.`)
    assert(wrappedRail.motion.includes('motion-forward') && JSON.stringify(wrappedRail.neighbours.slice(0, 4)) === '[1,2,3,4]', `The wrapped rail exposes its end seam instead of continuing forward: ${JSON.stringify(wrappedRail)}.`)
    assert(wrappedRail.spacers === 0 && wrappedRail.outlines === 1, `The wrapped rail left a spacer or focus line behind: ${JSON.stringify(wrappedRail)}.`)
    await capture('m56-looping-rail.png')
    await press('ArrowLeft')
    await waitFor("document.querySelector('.nav-rail.is-open .nav-item.is-focused')")
    const navigation = await evaluate(`(() => ({
      width: document.querySelector('.nav-rail').getBoundingClientRect().width,
      items: Array.from(document.querySelectorAll('.nav-item-label strong')).map(function (item) { return item.textContent; }),
      labelLefts: Array.from(document.querySelectorAll('.nav-item-label strong')).map(function (item) { return Math.round(item.getBoundingClientRect().left); }),
      secondaryLabels: document.querySelectorAll('.nav-item-label small').length,
      focused: document.querySelector('.nav-item.is-focused').textContent,
      retainedRow: Number(document.querySelector('.media-row.is-active').getAttribute('data-home-row')),
      retainedIndex: Number(document.querySelector('.home-focus-card.is-focused').getAttribute('data-media-index')),
      retainedRowTop: Math.round(document.querySelector('.media-row.is-active').getBoundingClientRect().top),
      rowsClass: document.querySelector('.catalog-rows').className,
      heroReceding: document.querySelector('.hero').classList.contains('is-receding')
    }))()`)
    assert(navigation.width >= 370 && navigation.width <= 430, `Navigation drawer width is ${navigation.width}px.`)
    assert(JSON.stringify(navigation.items) === '["Home","Search","Browse","My List","Settings"]', `Unexpected navigation destinations: ${navigation.items}.`)
    assert(navigation.secondaryLabels === 0, 'Navigation still renders secondary description text.')
    assert(Math.max(...navigation.labelLefts) - Math.min(...navigation.labelLefts) <= 1, `Navigation labels are not aligned: ${navigation.labelLefts}.`)
    assert(navigation.retainedRow === 1 && navigation.retainedIndex === 0 && navigation.retainedRowTop === 52, `Opening the sidebar reset the active rail: ${JSON.stringify(navigation)}.`)
    assert(navigation.rowsClass.includes('is-browsing') && navigation.heroReceding, `Opening the sidebar restored the top-of-page presentation: ${JSON.stringify(navigation)}.`)
    await capture('m56-navigation.png')

    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?preview=1&capture=1&screen=home&layout=spotlight&case=series-selection` })
    await waitFor("location.search.indexOf('case=series-selection') >= 0 && document.readyState === 'complete' && document.querySelector('.home-screen.mode-spotlight .hero-button.primary.is-focused')")
    await waitFor("!document.getElementById('startup-splash')")
    await evaluate("document.documentElement.style.pointerEvents = 'none'")
    await press('ArrowDown')
    await waitFor("document.querySelector('.media-row.is-active')")
    for (let index = 0; index < 8; index += 1) {
      const activeRow = await evaluate("Number(document.querySelector('.media-row.is-active').getAttribute('data-home-row'))")
      if (activeRow === 1) break
      await press(activeRow < 1 ? 'ArrowDown' : 'ArrowUp')
    }
    await waitFor("document.querySelector('.media-row.is-active[data-home-row=\"1\"] .home-focus-card.is-focused')")
    const seriesTitle = await evaluate("document.querySelector('.home-focus-card.is-focused').getAttribute('aria-label')")
    await press('Enter')
    await waitFor("document.querySelector('.app-shell.screen-series .series-screen')")
    const seriesSelection = await evaluate(`(() => ({
      shell: document.querySelector('.app-shell').className,
      title: document.querySelector('.series-title-block h1').textContent.trim(),
      player: Boolean(document.querySelector('.player-screen, .loading-screen')),
      actions: document.querySelectorAll('.series-action').length
    }))()`)
    assert(seriesSelection.shell.includes('screen-series') && !seriesSelection.player, `A normal series tile started playback: ${JSON.stringify(seriesSelection)}.`)
    assert(seriesSelection.title && seriesTitle.includes(seriesSelection.title) && seriesSelection.actions > 0, `The selected series page did not open: ${JSON.stringify({ seriesTitle, seriesSelection })}.`)
    await capture('m56-series-selection.png')

    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?preview=1&capture=1&screen=details` })
    await waitFor("document.readyState === 'complete' && document.querySelector('.detail-actions [data-focus-id=\"detail-0\"]')")
    await waitFor("!document.getElementById('startup-splash')")
    const detailPage = await evaluate(`(() => ({
      descriptionSize: parseFloat(getComputedStyle(document.querySelector('.detail-description')).fontSize),
      actions: Array.from(document.querySelectorAll('.detail-actions button')).map(function (button) { return button.textContent.trim(); }),
      actionLabelSpacing: Array.from(document.querySelectorAll('.detail-actions button')).map(function (button) {
        return parseFloat(getComputedStyle(button.querySelector('span')).marginLeft || '0');
      })
    }))()`)
    assert(detailPage.descriptionSize >= 28 && detailPage.actions.some(function (label) { return label.includes('Play Trailer'); }), `Film detail presentation is incomplete: ${JSON.stringify(detailPage)}.`)
    assert(detailPage.actionLabelSpacing.every(function (spacing) { return spacing >= 25; }), `Film detail action icons still crowd their labels: ${JSON.stringify(detailPage)}.`)
    await evaluate("Array.from(document.querySelectorAll('.detail-actions button')).find(function (button) { return button.textContent.includes('Play Trailer'); }).click()")
    await waitFor("document.querySelector('.series-trailer-overlay iframe')")
    const trailerWithoutCaptions = await evaluate(`(() => {
      var overlay = document.querySelector('.series-trailer-overlay');
      var bounds = overlay.getBoundingClientRect();
      return {
        source: overlay.querySelector('iframe').src,
        captionHud: Boolean(document.querySelector('.series-trailer-caption')),
        overlay: [Math.round(bounds.left), Math.round(bounds.top), Math.round(bounds.width), Math.round(bounds.height)],
        layer: Number(getComputedStyle(overlay).zIndex),
        closeControls: overlay.querySelectorAll('.series-trailer-close').length,
        pageClass: document.querySelector('.detail-screen').className,
        hiddenPageLayers: Array.from(document.querySelectorAll('.detail-screen > .detail-art, .detail-screen > .detail-copy, .detail-screen > .detail-poster')).every(function (element) {
          return getComputedStyle(element).visibility === 'hidden';
        })
      };
    })()`)
    assert(trailerWithoutCaptions.source.includes('cc_load_policy=0') && !trailerWithoutCaptions.source.includes('cc_lang_pref') && !trailerWithoutCaptions.captionHud,
      `Trailer captions are still forced on: ${JSON.stringify(trailerWithoutCaptions)}.`)
    assert(JSON.stringify(trailerWithoutCaptions.overlay) === '[0,0,1920,1080]' && trailerWithoutCaptions.layer === 100
      && trailerWithoutCaptions.closeControls === 0 && trailerWithoutCaptions.pageClass.includes('has-trailer-open') && trailerWithoutCaptions.hiddenPageLayers,
      `Title-page layers can still composite over the trailer: ${JSON.stringify(trailerWithoutCaptions)}.`)
    await evaluate(`(() => {
      var iframe = document.querySelector('.series-trailer-overlay iframe');
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe.contentWindow,
        origin: 'https://www.youtube-nocookie.com',
        data: JSON.stringify({ event: 'onStateChange', info: { playerState: 1 } })
      }));
    })()`)
    await waitFor("getComputedStyle(document.querySelector('.series-trailer-native-cover')).opacity === '0'")
    await press('Backspace')
    await waitFor("!document.querySelector('.series-trailer-overlay')")
    await capture('m56-detail-trailer.png')

    await evaluate("window.dispatchEvent(new CustomEvent('izumi:voice-search', { detail: 'The Runner' }))")
    await waitFor("document.querySelector('.app-shell.screen-search input') && document.querySelector('.app-shell.screen-search input').value === 'The Runner'")
    const voiceSearch = await evaluate(`(() => ({
      screen: document.querySelector('.app-shell').className,
      query: document.querySelector('.search-query input').value,
      activeNav: document.querySelector('.nav-item.is-active .nav-item-label strong').textContent.trim()
    }))()`)
    assert(voiceSearch.screen.includes('screen-search') && voiceSearch.query === 'The Runner' && voiceSearch.activeNav === 'Search', `Voice search did not route into the all-source search screen: ${JSON.stringify(voiceSearch)}.`)
    await capture('m56-voice-search.png')

    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?preview=1&capture=1&screen=home&layout=carousel` })
    await waitFor("document.readyState === 'complete' && document.querySelector('.home-screen.mode-carousel')")
    await waitFor("!document.getElementById('startup-splash')")
    await waitFor("document.querySelector('.hero-carousel-status')")
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
      var heroTitle = document.querySelector('.hero-title-logo, .hero h1');
      return {
        hero: [hero.left, hero.top, hero.width, hero.height],
        rows: [rows.top, rows.height],
        card: [card.width, card.height],
        cardLeft: card.left,
        expanded: Boolean(document.querySelector('.home-focus-card')),
        receding: document.querySelector('.hero').classList.contains('is-receding'),
        heroTitle: heroTitle.getAttribute('alt') || heroTitle.textContent,
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
    for (let index = 0; index < carouselHome.cards.length; index += 1) await press('ArrowRight')
    await wait(220)
    const carouselLoop = await evaluate(`(() => {
      var row = document.querySelector('.media-row.is-active');
      var strip = row.querySelector('.media-strip');
      var focused = row.querySelector('.home-poster-card.is-focused');
      return {
        index: Number(focused.getAttribute('data-media-index')),
        left: focused.getBoundingClientRect().left,
        focusedCards: row.querySelectorAll('.home-poster-card.is-focused').length,
        cyclic: strip.getAttribute('data-cyclic'),
        spacers: strip.querySelectorAll('.media-card-spacer').length
      };
    })()`)
    assert(carouselLoop.index === 0 && carouselLoop.left === carouselHome.cardLeft, `Carousel wrapping moved its fixed focus slot: ${JSON.stringify(carouselLoop)}.`)
    assert(carouselLoop.focusedCards === 1 && carouselLoop.cyclic === 'true' && carouselLoop.spacers === 0, `Carousel wrapping left a visible line or finite spacer: ${JSON.stringify(carouselLoop)}.`)
    await capture('m56-carousel-loop.png')
    await waitFor("document.querySelector('.home-hover-trailer')")
    const hoverTrailer = await evaluate(`(() => {
      var trailer = document.querySelector('.home-hover-trailer');
      return { source: trailer.src, title: trailer.title };
    })()`)
    assert(hoverTrailer.source.includes('autoplay=1') && hoverTrailer.source.includes('mute=0') && hoverTrailer.source.includes('cc_load_policy=1') && hoverTrailer.source.includes('cc_lang_pref=en'), `Non-English focused-card trailer is not configured for audible playback with English captions: ${hoverTrailer.source}.`)
    assert(hoverTrailer.title.includes(carouselHome.heroTitle), `Focused-card trailer label is incorrect: ${hoverTrailer.title}.`)
    await evaluate(`(() => {
      document.querySelector('.hero-feature-card > .home-hover-trailer').classList.add('is-playing');
      document.querySelector('.hero').classList.add('is-trailer-playing');
    })()`)
    await wait(220)
    const heroTrailerPresentation = await evaluate(`(() => {
      var trailer = document.querySelector('.hero-feature-card > .home-hover-trailer');
      return {
        rankOpacity: getComputedStyle(document.querySelector('.hero-rank-context')).opacity,
        titleOpacity: getComputedStyle(document.querySelector('.hero-title-logo, .hero h1')).opacity,
        visibility: getComputedStyle(trailer).visibility,
        trailerTransform: getComputedStyle(trailer).transform,
        heroTransform: getComputedStyle(document.querySelector('.hero')).transform
      };
    })()`)
    assert(heroTrailerPresentation.rankOpacity === '0' && heroTrailerPresentation.titleOpacity === '0', `Hero title or score badge remains over trailer playback: ${JSON.stringify(heroTrailerPresentation)}.`)
    assert(heroTrailerPresentation.visibility === 'visible' && heroTrailerPresentation.trailerTransform === 'none' && heroTrailerPresentation.heroTransform === 'none',
      `Hero trailer playback still uses an M56 black-frame compositor layer: ${JSON.stringify(heroTrailerPresentation)}.`)
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
      var heroTitle = document.querySelector('.page-browse .hero-title-logo, .page-browse .hero h1');
      return { title: card.getAttribute('aria-label'), hero: heroTitle.getAttribute('alt') || heroTitle.textContent };
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
       return {
         blocks: skeleton.querySelectorAll('.skeleton-block').length,
         blockAnimation: getComputedStyle(block).animationName,
         sweepAnimation: getComputedStyle(skeleton, '::after').animationName
       };
     })()`)
    assert(homeSkeleton.blocks >= 12 && homeSkeleton.blockAnimation === 'none' && homeSkeleton.sweepAnimation.includes('skeleton-page-sweep'), `Home skeleton is not using its single M56 compositor sweep: ${JSON.stringify(homeSkeleton)}.`)

    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?preview=1&capture=1&screen=loading` })
    await waitFor("document.readyState === 'complete' && document.querySelector('.loading-status')")
    await waitFor("!document.getElementById('startup-splash')")
    const loadingVideo = await evaluate(`(() => ({
      status: document.querySelector('.loading-status').textContent,
      valueText: document.querySelector('.loading-track').getAttribute('aria-valuetext'),
      width: document.querySelector('.loading-progress-indicator').getBoundingClientRect().width,
      animation: getComputedStyle(document.querySelector('.loading-progress-indicator')).animationName
    }))()`)
    assert(loadingVideo.status.includes('34%') && loadingVideo.status.includes('Buffered for playback'), `Video loading progress is unclear: ${JSON.stringify(loadingVideo)}.`)
    assert(loadingVideo.valueText === '34% buffered for playback' && loadingVideo.width > 640 && loadingVideo.width < 670,
      `Video loading progress does not match its rail: ${JSON.stringify(loadingVideo)}.`)
    assert(loadingVideo.animation === 'none', `Determinate video progress still uses an indeterminate animation: ${loadingVideo.animation}.`)

    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?preview=1&capture=1&screen=player&scenario=buffering` })
    await waitFor("document.readyState === 'complete' && document.querySelector('.player-buffering-status')")
    await waitFor("document.querySelector('.player-state-icon.is-focused')")
    await waitFor("!document.getElementById('startup-splash')")
    const bufferingPlayer = await evaluate(`(() => ({
      status: document.querySelector('.player-buffering-status').textContent,
      transport: document.querySelector('.player-state-icon').getAttribute('aria-label'),
      transportFocused: document.querySelector('.player-state-icon').classList.contains('is-focused'),
      position: Number(document.querySelector('.player-timeline-control').getAttribute('aria-valuenow')),
      playedWidth: document.querySelector('.player-timeline-played').getBoundingClientRect().width,
      bufferedWidth: document.querySelector('.player-timeline-buffered').getBoundingClientRect().width,
      valueText: document.querySelector('.player-timeline-control').getAttribute('aria-valuetext')
    }))()`)
    assert(bufferingPlayer.status.includes('Buffering') && bufferingPlayer.status.includes('46% buffered'), `Buffering indicator is incomplete: ${bufferingPlayer.status}.`)
    assert(bufferingPlayer.transport === 'Pause' && bufferingPlayer.transportFocused, `Playing transport is not a focused Pause action: ${JSON.stringify(bufferingPlayer)}.`)
    assert(bufferingPlayer.bufferedWidth > bufferingPlayer.playedWidth && bufferingPlayer.valueText.includes('buffered to'), `Buffered extent is missing from the player rail: ${JSON.stringify(bufferingPlayer)}.`)
    await press('ArrowDown')
    await waitFor("document.querySelector('.player-timeline-control.is-focused')")
    await press('ArrowRight')
    const scrubbedPosition = await evaluate("Number(document.querySelector('.player-timeline-control').getAttribute('aria-valuenow'))")
    assert(scrubbedPosition > bufferingPlayer.position, `Buffering timeline did not seek: ${bufferingPlayer.position} -> ${scrubbedPosition}.`)
    await cdp.call('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key: 'MediaFastForward', code: 'MediaFastForward', windowsVirtualKeyCode: 417, nativeVirtualKeyCode: 417,
    })
    await wait(2_150)
    const heldSeek = await evaluate(`(() => ({
      position: Number(document.querySelector('.player-timeline-control').getAttribute('aria-valuenow')),
      multiplier: document.querySelector('.player-seek-feedback strong').textContent,
      chevrons: document.querySelectorAll('.player-seek-chevrons svg').length
    }))()`)
    await cdp.call('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'MediaFastForward', code: 'MediaFastForward', windowsVirtualKeyCode: 417, nativeVirtualKeyCode: 417,
    })
    // M56 may coalesce one repeat while the test captures the accelerated HUD; two 30-second
    // advances still prove held seeking accumulated instead of issuing one discrete seek.
    assert(heldSeek.position >= scrubbedPosition + 60, `Held fast-forward did not accumulate: ${scrubbedPosition} -> ${heldSeek.position}.`)
    assert(heldSeek.multiplier === '3×' && heldSeek.chevrons === 3, `Held fast-forward feedback is incomplete: ${JSON.stringify(heldSeek)}.`)
    await press('ArrowDown')
    await waitFor("document.querySelector('.player-actions > button.is-focused')")
    await capture('m56-player-buffering.png')
    await press('Backspace')
    await waitFor("document.querySelector('.app-shell.screen-player .player-controls.is-hidden')")
    const hiddenControls = await evaluate("Boolean(document.querySelector('.app-shell.screen-player .player-controls.is-hidden'))")
    assert(hiddenControls, 'Back exited playback instead of hiding visible controls.')

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
    await waitFor("document.readyState === 'complete' && document.querySelectorAll('.settings-options > button').length === 9")
    await waitFor("!document.getElementById('startup-splash')")
    const settings = await evaluate(`(() => ({
      options: document.querySelectorAll('.settings-options > button').length,
      toggles: document.querySelectorAll('.settings-toggle').length,
      videoPreviewLabel: document.querySelectorAll('.settings-options > button')[1].querySelector('strong').textContent.trim(),
      videoPreviewsEnabled: document.querySelectorAll('.settings-options > button')[1].getAttribute('aria-pressed'),
      panelBottom: document.querySelector('.settings-panel').getBoundingClientRect().bottom,
      body: [document.body.scrollWidth, document.body.scrollHeight]
    }))()`)
    assert(settings.options === 9 && settings.toggles === 6, `Playback settings are incomplete: ${settings.options}/${settings.toggles}.`)
    assert(settings.videoPreviewLabel === 'Video previews' && settings.videoPreviewsEnabled === 'true', `Video-preview preference is missing or defaults incorrectly: ${JSON.stringify(settings)}.`)
    assert(settings.panelBottom <= 1080, `Settings panel is clipped at ${settings.panelBottom}px.`)
    assert(JSON.stringify(settings.body) === '[1920,1080]', `Settings overflowed the TV viewport: ${settings.body}.`)
    await capture('m56-playback-settings.png')

    await evaluate("document.querySelectorAll('.settings-options > button')[1].click()")
    await waitFor("document.querySelectorAll('.settings-options > button')[1].getAttribute('aria-pressed') === 'false'")
    const previewsDisabled = await evaluate("JSON.parse(localStorage.getItem('izumi.companion.playback-experience')).videoPreviewsEnabled === false")
    assert(previewsDisabled, 'The video-preview opt-out was not persisted.')

    await evaluate("document.querySelectorAll('.settings-options > button')[6].click()")
    await waitFor("document.querySelector('.independent-setup-screen .independent-setup-heading h1')")
    const independentSetup = await evaluate(`(() => ({
      title: document.querySelector('.independent-setup-heading h1').textContent.trim(),
      titleSize: parseFloat(getComputedStyle(document.querySelector('.independent-setup-heading h1')).fontSize),
      instructionSize: parseFloat(getComputedStyle(document.querySelector('.independent-setup-instruction p')).fontSize),
      logoWidth: document.querySelector('.independent-setup-screen .state-brand').naturalWidth,
      actions: document.querySelectorAll('.independent-setup-actions button').length,
      body: [document.body.scrollWidth, document.body.scrollHeight]
    }))()`)
    assert(independentSetup.title === 'Use this TV without keeping izumi open', `Independent setup title is wrong: ${independentSetup.title}.`)
    assert(independentSetup.titleSize >= 60 && independentSetup.instructionSize >= 24, `Independent setup type is too small for TV: ${JSON.stringify(independentSetup)}.`)
    assert(independentSetup.logoWidth > 0 && independentSetup.actions === 2, `Independent setup branding/actions did not render: ${JSON.stringify(independentSetup)}.`)
    assert(JSON.stringify(independentSetup.body) === '[1920,1080]', `Independent setup overflowed the TV viewport: ${independentSetup.body}.`)
    await evaluate("document.querySelector('.independent-setup-actions button:last-child').click()")
    await waitFor("document.querySelector('.independent-setup-progress > i')")
    const spinner = await evaluate("getComputedStyle(document.querySelector('.independent-setup-progress > i')).borderTopColor")
    assert(spinner === 'rgb(255, 255, 255)', `Independent setup spinner is not white: ${spinner}.`)
    await capture('m56-independent-setup.png')

    const exceptions = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown')
    const applicationExceptions = exceptions.filter((event) => !/^https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\//i.test(event.params?.exceptionDetails?.url ?? ''))
    assert(applicationExceptions.length === 0, `Chromium 56 reported ${applicationExceptions.length} application exception(s): ${JSON.stringify(applicationExceptions.map((event) => event.params?.exceptionDetails))}`)
    process.stdout.write(`Chromium 56 check passed (${focusPerformance.maximum.toFixed(1)}ms max/${focusPerformance.average.toFixed(1)}ms average D-pad focus commit): Home geometry, retained mid-page sidebar position, stable title art, full-frame trailer transitions, Samsung voice-search routing, series-page selection, merged Browse carousel, one-photo tiles, looping rails, straight search navigation, animated skeletons, accelerated seeking, trailer fallback, player prompts, independent Worker onboarding, and no application runtime errors.\n`)
  } finally {
    try { await cdp?.call('Browser.close') } catch { browser.kill() }
    cdp?.socket.close()
    await new Promise((resolveClose) => server.close(resolveClose))
    await waitForExit(browser)
    if (browser.exitCode === null) {
      browser.kill()
      await waitForExit(browser)
    }
    const runtimePrefix = `${runtime}${sep}`
    if (profile.startsWith(runtimePrefix)) await removeTemporaryProfile(profile)
  }
}

await main()
