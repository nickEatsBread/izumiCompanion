function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/** Exercise the actual app's remote routing, with DOM-only stress text for layout bounds. */
export async function checkTitleScreen({ kind, cdp, evaluate, waitFor, press, capture }) {
  const buttons = kind === 'series' ? '.series-action' : '.detail-actions button'
  const summary = kind === 'series' ? '.series-summary' : '.detail-description'
  const heading = kind === 'series' ? '.series-title-block h1' : '.detail-copy h1'
  const original = await evaluate(`({ title: document.querySelector('${heading}').textContent, description: document.querySelector('${summary}').textContent })`)
  const longTitle = Array(8).fill(original.title).join(' — ')
  const longDescription = Array(35).fill(original.description).join('\n\n')
  for (const [width, height] of [[1280, 720], [1920, 1080], [3840, 2160]]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, fitWindow: false })
    await evaluate(`document.querySelector('${heading}').firstChild.nodeValue = ${JSON.stringify(longTitle)}; document.querySelector('${summary}').firstChild.nodeValue = ${JSON.stringify(longDescription)}`)
    const geometry = await evaluate(`Array.from(document.querySelectorAll('${buttons}')).map(function (button) {
      var rect = button.getBoundingClientRect(), label = button.querySelector('span'), text = label.getBoundingClientRect();
      return { label: label.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        height: rect.height, labelHeight: text.height, fontSize: parseFloat(getComputedStyle(label).fontSize),
        fits: text.left > rect.left && text.right < rect.right && text.bottom <= rect.bottom,
        singleLine: text.height <= parseFloat(getComputedStyle(label).lineHeight) + 1 };
    })`)
    assert(geometry.every((button) => button.fits && button.singleLine && button.left >= width * .05
      && button.right <= width * .95 && button.top >= height * .05 && button.bottom <= height * .9
      && Math.abs(button.top - geometry[0].top) < 1 && Math.abs(button.height / height - .072) < .002),
    `${kind} actions overflow or wrap at ${width}x${height}: ${JSON.stringify(geometry)}`)
  }
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, fitWindow: false })
  await capture(`m56-${kind}-long-text.png`)
  await evaluate(`document.querySelector('${heading}').firstChild.nodeValue = ${JSON.stringify(original.title)}; document.querySelector('${summary}').firstChild.nodeValue = ${JSON.stringify(original.description)}`)
  await capture(`m56-${kind}-actions.png`)

  const infoIndex = await evaluate(`Array.from(document.querySelectorAll('${buttons}')).findIndex(function (button) { return button.textContent.trim() === 'More info'; })`)
  for (let index = 0; index < infoIndex; index += 1) await press('ArrowRight')
  await press('Enter')
  await waitFor("document.querySelector('.title-panel.is-info') && document.activeElement.classList.contains('title-panel-close')")
  assert(await evaluate(`document.querySelector('.title-panel-description').textContent === ${JSON.stringify(original.description)}`), `${kind} More info lost description content.`)
  // This stress substitution verifies native scrolling without adding a production fixture switch.
  await evaluate(`document.querySelector('.title-panel-description').firstChild.nodeValue = ${JSON.stringify(longDescription)}`)
  await press('ArrowDown')
  assert(await evaluate("document.querySelector('.title-panel-body').scrollTop > 100"), `${kind} description cannot scroll with the remote.`)
  await press('ArrowUp')
  assert(await evaluate("document.querySelector('.title-panel-body').scrollTop === 0"), `${kind} description cannot return to its start.`)
  await capture(`m56-${kind}-description.png`)
  await press('Backspace')
  await waitFor(`!document.querySelector('.title-panel') && document.activeElement.textContent.trim() === 'More info'`)

  const rateIndex = await evaluate(`Array.from(document.querySelectorAll('${buttons}')).findIndex(function (button) { return /Rate this title/.test(button.getAttribute('aria-label') || ''); })`)
  assert(rateIndex > infoIndex, `${kind} watched fixture is missing the compact Rate control.`)
  await press('ArrowRight')
  await press('Enter')
  await waitFor("document.querySelector('.title-panel.is-rating')")
  await capture(`m56-${kind}-rating.png`)
  await press('Enter')
  await waitFor("!document.querySelector('.title-panel') && document.activeElement.textContent.trim() === 'Liked'")
  await press('Enter')
  await press('ArrowRight')
  await press('Enter')
  await waitFor("!document.querySelector('.title-panel') && document.activeElement.textContent.trim() === 'Disliked'")
  await press('Enter')
  await waitFor("document.querySelector('.title-rating-choices button.is-focused[aria-pressed=\"true\"]')")
  await press('Enter')
  await waitFor("!document.querySelector('.title-panel') && document.activeElement.textContent.trim() === 'Rate'")
  // Return to Play so callers can continue their existing navigation checks.
  for (let index = 0; index < rateIndex; index += 1) await press('ArrowLeft')
  await press('ArrowRight')
  await press('ArrowDown')
  await waitFor("document.querySelector('.contributor-browser')")
  await press('ArrowUp')
  await waitFor(`document.activeElement === document.querySelectorAll('${buttons}')[1]`)
  await press('ArrowLeft')
  if (kind === 'series') {
    const relatedIndex = await evaluate(`Array.from(document.querySelectorAll('${buttons}')).findIndex(function (button) { return button.textContent.trim() === 'Related'; })`)
    for (let index = 0; index < relatedIndex; index += 1) await press('ArrowRight')
    await press('Enter')
    await waitFor("document.querySelector('.series-relation-row.is-focused')")
    await press('ArrowDown')
    await press('Enter')
    await waitFor("document.querySelector('.series-title-block h1').textContent === 'Frieren: Magic Shorts'")
    assert(await evaluate("!Array.from(document.querySelectorAll('.series-action')).some(function (button) { return /Rate this title/.test(button.getAttribute('aria-label') || ''); })"), 'An unwatched title exposes rating controls.')
    await capture('m56-series-unwatched.png')
    await press('Backspace')
    await waitFor(`document.querySelector('.series-title-block h1').textContent === ${JSON.stringify(original.title)}`)
    await press('Backspace')
    await waitFor("document.activeElement.textContent.trim() === 'Related'")
    for (let index = 0; index < relatedIndex; index += 1) await press('ArrowLeft')
  }
}
