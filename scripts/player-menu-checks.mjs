function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/** Use the app's real remote routing and rendered menu bounds on the legacy TV engine. */
export async function checkPlayerMenus({ cdp, port, evaluate, waitFor, press, capture }) {
  const navigate = async (screen = 'player') => {
    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?preview=1&capture=1&screen=${screen}&scenario=long-menus` })
    await waitFor(`location.search.indexOf('screen=${screen}&scenario=long-menus') !== -1
      && document.readyState === 'complete' && document.querySelector('.${screen}-screen')
      && !document.getElementById('startup-splash')`)
    await evaluate("document.documentElement.style.pointerEvents = 'none'")
  }
  const geometry = () => evaluate(`(() => {
    var menu = document.querySelector('.player-menu'), list = menu.querySelector('.player-menu-options');
    var buttons = Array.from(list.querySelectorAll('button')), focused = list.querySelector('.is-focused');
    var row = focused.getBoundingClientRect(), box = list.getBoundingClientRect(), panel = menu.getBoundingClientRect();
    var heading = menu.querySelector('header').getBoundingClientRect();
    return { index: buttons.indexOf(focused), count: buttons.length, top: row.top, bottom: row.bottom,
      viewportTop: box.top, viewportBottom: box.bottom, panelBottom: panel.bottom,
      panelLeft: panel.left, panelRight: panel.right, width: innerWidth, height: innerHeight,
      headingTop: heading.top, headingBottom: heading.bottom, panelTop: panel.top,
      scrollTop: list.scrollTop, maxScroll: list.scrollHeight - list.clientHeight,
      outerScroll: [window.scrollY, document.getElementById('app').scrollTop,
        document.querySelector('.app-shell').scrollTop, document.querySelector('.player-screen').scrollTop, menu.scrollTop] };
  })()`)
  const checkFocused = async (index, context) => {
    const state = await geometry()
    assert(state.index === index, `${context}: expected row ${index}, got ${state.index}.`)
    assert(state.top >= state.viewportTop - 1 && state.bottom <= Math.min(state.viewportBottom, state.panelBottom) + 1,
      `${context}: focused row is clipped: ${JSON.stringify(state)}`)
    assert(state.panelLeft >= 0 && state.panelRight <= state.width && state.panelBottom <= state.height
      && state.viewportBottom <= state.panelBottom - 1 && state.headingBottom <= state.viewportTop + 1
      && state.headingTop > state.panelTop && state.outerScroll.every(value => value === 0),
    `${context}: menu list overflowed or moved the surrounding player: ${JSON.stringify(state)}`)
    return state
  }
  const traverse = async (context) => {
    const start = await checkFocused(0, context)
    assert(start.maxScroll > 0, `${context}: fixture needs an overflowing list.`)
    for (let index = 1; index < start.count; index += 1) {
      await press('ArrowDown')
      await checkFocused(index, context)
    }
    await press('ArrowDown')
    const end = await checkFocused(start.count - 1, `${context} bottom boundary`)
    assert(end.scrollTop > 0, `${context}: list never scrolled down.`)
    await capture(`m56-${context}-bottom.png`)
    for (let index = start.count - 2; index >= 0; index -= 1) {
      await press('ArrowUp')
      await checkFocused(index, context)
    }
    await press('ArrowUp')
    const reset = await checkFocused(0, `${context} top boundary`)
    assert(reset.scrollTop <= 1, `${context}: list did not return to its start.`)
  }

  for (const [width, height] of [[1280, 720], [1920, 1080], [3840, 2160]]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, fitWindow: false })
    await navigate()
    await press('ArrowDown')
    await press('ArrowDown')
    await press('Enter')
    await waitFor("document.querySelector('.player-menu[aria-label=\"source options\"]')")
    await traverse(`sources-${height}p`)
    // The same list must reset when the menu is closed and reopened after scrolling.
    for (let index = 0; index < 15; index += 1) await press('ArrowDown')
    await press('Backspace')
    await press('Enter')
    const reopened = await checkFocused(0, 'reopened sources')
    assert(reopened.scrollTop === 0, 'Reopened source list kept its previous scroll offset.')

    if (height === 1080) {
      // Faster than the old menu entrance animation; no delayed scroll may override the latest row.
      for (const [key, count] of [['ArrowDown', 40], ['ArrowUp', 40], ['ArrowDown', 20], ['ArrowUp', 3]]) {
        const code = key === 'ArrowDown' ? 40 : 38
        for (let index = 0; index < count; index += 1) {
          await cdp.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, autoRepeat: index > 0 })
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
      }
      await checkFocused(17, 'rapid direction changes')
      for (const menu of ['audio', 'subtitles']) {
        await press('Backspace')
        await press('ArrowRight')
        await press('Enter')
        await waitFor(`document.querySelector('.player-menu[aria-label="${menu} options"]')`)
        await traverse(menu)
      }
    }

    // Cancelling preparation opens directly on a source below the initial viewport.
    await navigate('loading')
    await press('Backspace')
    await waitFor("document.querySelector('.player-menu[aria-label=\"source options\"]')")
    await checkFocused(20, `restored source-${height}p`)
  }
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, fitWindow: false })
}
