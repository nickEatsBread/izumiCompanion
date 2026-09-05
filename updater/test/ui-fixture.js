/* Browser-test service double. This file is never copied into the production WGT. */
window.__UPDATER_STATE = { stage: 'ready', installedVersion: '0.2.35', latestVersion: '0.2.36', message: 'Run the desktop installer to finish setting up TV updates.', setupCode: 'ABCD-1234-EF56', provisioned: false, busy: false, progress: null, updateAvailable: true }
window.__UPDATER_ACTIONS = []
window.tizen = {
  ApplicationControl: function () {},
  application: {
    launchAppControl: function (control, id, success) { success() },
    getCurrentApplication: function () { return { getRequestedAppControl: function () { return null }, exit: function () {} } },
    launch: function (id, success) { window.__UPDATER_OPENED = id; success() }
  },
  filesystem: { resolve: function (file, success) { success({ readAsText: function (done) { done('local-fixture-token') } }) } }
}
window.XMLHttpRequest = function () {}
window.XMLHttpRequest.prototype.open = function (method, url) { this.method = method; this.route = url.replace('http://127.0.0.1:18763', '') }
window.XMLHttpRequest.prototype.setRequestHeader = function () {}
window.XMLHttpRequest.prototype.send = function () {
  var xhr = this
  if (this.method === 'POST') {
    window.__UPDATER_ACTIONS.push(this.route)
    if (this.route === '/update') Object.assign(window.__UPDATER_STATE, { stage: 'downloading', busy: true, progress: 38, message: 'Downloading izumi Companion…' })
  }
  setTimeout(function () { xhr.status = 200; xhr.responseText = JSON.stringify(xhr.method === 'GET' ? window.__UPDATER_STATE : { accepted: true }); xhr.onload() }, 0)
}
