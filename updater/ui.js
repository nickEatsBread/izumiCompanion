/* ES5 UI for Samsung's Chromium 56 browser. */
(function () {
  var token = '', state = {}, autoStart = false, autoStarted = false, failures = 0, checking = false, obtainingToken = false
  var primary = document.getElementById('primary'), open = document.getElementById('open')
  function text(id, value) { document.getElementById(id).textContent = value }
  function intent() {
    try {
      var requested = tizen.application.getCurrentApplication().getRequestedAppControl()
      var values = requested && requested.appControl && requested.appControl.data || []
      // Only izumi can request automatic installation and return-to-app behavior.
      if (!requested || requested.callerAppId !== 'IzumiTV001.IzumiTV') return
      for (var i = 0; i < values.length; i++) if (values[i].key === 'izumi.update' && values[i].value[0] === 'install-and-return') autoStart = true
    } catch (_) {}
  }
  function request(method, route, body, callback) {
    var xhr = new XMLHttpRequest()
    xhr.open(method, 'http://127.0.0.1:18763' + route)
    xhr.setRequestHeader('Authorization', 'Bearer ' + token)
    xhr.timeout = 5000
    if (method === 'POST') xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.onload = function () { try { var value = JSON.parse(xhr.responseText); callback(xhr.status < 300 ? null : new Error(value.error || 'Updater request failed.'), value) } catch (error) { callback(error) } }
    xhr.onerror = xhr.ontimeout = function () { callback(new Error('Waiting for the update service…')) }
    xhr.send(body ? JSON.stringify(body) : null)
  }
  function action(route, body) {
    primary.disabled = true
    request('POST', route, body || {}, function (error) { if (error) { text('message', error.message); primary.disabled = false } else poll() })
  }
  function render(value) {
    state = value
    text('message', state.message)
    text('installed', state.installedVersion || 'Not installed')
    text('latest', state.latestVersion || (state.stage === 'checking' ? 'Checking…' : '—'))
    document.getElementById('setup-panel').hidden = Boolean(state.provisioned)
    document.getElementById('update-steps').hidden = !state.provisioned
    text('setup-code', state.setupCode || 'Starting…')
    var complete = state.stage === 'complete' || state.stage === 'current'
    text('title', complete ? 'izumi is up to date.' : state.busy ? state.stage === 'checking' ? 'Checking for updates.' : 'Updating izumi.' : !state.provisioned ? 'Set up TV updates.' : 'App updates.')
    text('state-label', state.stage === 'error' || state.stage === 'setup-error' ? 'Needs attention' : complete ? 'Update complete' : 'izumi Companion')
    var stages = document.querySelectorAll('[data-stage]')
    var currentStage = state.stage === 'downloading' ? 'download' : state.stage === 'signing' ? 'signing' : ['uploading', 'installing', 'verifying'].indexOf(state.stage) >= 0 ? 'install' : ''
    for (var step = 0; step < stages.length; step++) stages[step].className = stages[step].getAttribute('data-stage') === currentStage ? 'active' : ''
    var updating = ['downloading', 'signing', 'uploading', 'installing', 'verifying'].indexOf(state.stage) >= 0
    document.getElementById('progress-wrap').hidden = !updating && !complete
    var bar = document.getElementById('progress')
    bar.className = state.progress === null ? 'indeterminate' : ''
    if (state.progress === null) bar.removeAttribute('aria-valuenow')
    else bar.setAttribute('aria-valuenow', String(state.progress))
    document.getElementById('progress-fill').style.width = state.progress === null ? '28%' : state.progress + '%'
    text('progress-label', state.progress === null ? state.stage === 'installing' ? 'Samsung is installing the update…' : 'This can take a moment…' : state.progress + '%')
    primary.disabled = Boolean(state.busy)
    open.disabled = Boolean(state.busy)
    primary.textContent = state.busy ? state.stage === 'checking' ? 'Checking…' : 'Updating…' : state.updateAvailable && state.provisioned && state.stage !== 'error' ? 'Update now' : 'Check for updates'
    if (!state.provisioned) text('help', 'Run the izumi desktop installer to finish setup. It securely transfers your TV’s Samsung signing identity.')
    else text('help', 'For updates without a computer: Apps → 12345 → Developer Mode → Host PC IP 127.0.0.1, then restart the TV.')
    if (autoStart && !autoStarted && !state.busy) {
      autoStarted = true
      if (state.provisioned) action('/update', { returnToApp: true })
      else text('message', 'Set up TV updates with the desktop installer first. You can keep using izumi in the meantime.')
    }
    if (!state.busy && document.activeElement !== primary && document.activeElement !== open) primary.focus()
  }
  function poll() {
    if (!token || checking || obtainingToken) return
    checking = true
    request('GET', '/state', null, function (error, value) {
      checking = false
      if (error) {
        failures++
        if (failures > 5) { text('message', 'The update service stopped. Close and reopen izumi Updater to reconnect.'); primary.textContent = 'Reconnect'; primary.disabled = false }
        return
      }
      failures = 0; render(value)
    })
  }
  function readToken(attempt) {
    obtainingToken = true
    try {
      tizen.filesystem.resolve('wgt-private/api-token', function (file) {
        file.readAsText(function (value) {
          token = value.trim()
          // A service launch callback can precede its token rotation. Do not use a stale token.
          request('GET', '/state', null, function (error, value) {
            if (error) { retry(); return }
            obtainingToken = false; failures = 0; render(value)
            if (!autoStart && !value.busy && value.stage !== 'setup-complete') action('/check')
          })
        }, retry, 'UTF-8')
      }, retry, 'r')
    } catch (error) { retry() }
    function retry() { if (attempt < 30) setTimeout(function () { readToken(attempt + 1) }, 500); else { obtainingToken = false; text('message', 'The update service could not start on this TV. Use the desktop installer to repair it.'); primary.textContent = 'Reconnect'; primary.disabled = false; failures = 6; open.focus() } }
  }
  function start() {
    intent()
    try {
      tizen.application.launchAppControl(new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'), 'IzumiUP001.Service', function () { readToken(0) }, function (error) { text('message', 'The TV could not start its update service: ' + error.message); open.focus() })
    } catch (_) { text('message', 'This updater must be opened on a Samsung Tizen TV.'); open.disabled = true }
  }
  primary.onclick = function () {
    if (failures > 5) { failures = 0; start(); return }
    action(state.updateAvailable && state.provisioned && state.stage !== 'error' ? '/update' : '/check', { returnToApp: false })
  }
  open.onclick = function () { try { tizen.application.launch('IzumiTV001.IzumiTV', function () {}, function (error) { text('message', error.message) }) } catch (_) {} }
  document.addEventListener('keydown', function (event) {
    if ([37, 38, 39, 40, 13, 10009].indexOf(event.keyCode) < 0) return
    event.preventDefault()
    if (event.keyCode === 10009) { if (!state.busy) tizen.application.getCurrentApplication().exit(); return }
    if (state.busy) return
    if (event.keyCode === 13) { var target = document.activeElement; if (target === primary || target === open) target.click() }
    else (event.keyCode === 37 || event.keyCode === 38 ? primary : open).focus()
  })
  window.addEventListener('appcontrol', function () { autoStart = false; autoStarted = false; intent(); poll() })
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { intent(); poll() } })
  setInterval(poll, 750)
  start()
})()
