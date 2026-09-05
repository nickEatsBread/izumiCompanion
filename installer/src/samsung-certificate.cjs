const FormData = require('form-data')
const fetch = require('node-fetch')
const { SamsungCertificateCreator: BaseSamsungCertificateCreator } = require('tizen')
const fs = require('node:fs')
const path = require('node:path')
const forge = require('node-forge')
const JSZip = require('jszip')
const { DOMParser } = require('@xmldom/xmldom')

const DEVICE_PROFILE_URL = 'https://svdca.samsungqbe.com/apis/v1/distributors'

class SamsungCertificateCreator extends BaseSamsungCertificateCreator {
  constructor(options = {}) {
    super()
    this.fetch = options.fetch || fetch
    this.FormData = options.FormData || FormData
    this.cacheDirectory = options.cacheDirectory
  }

  async _downloadVDCertificates() {
    if (!this.cacheDirectory) return super._downloadVDCertificates()
    const names = ['vd_tizen_dev_author_ca.cer', 'vd_tizen_dev_public2.crt']
    if (names.every(name => fs.existsSync(path.join(this.cacheDirectory, name)))) return
    let url = 'https://download.tizen.org/sdk/extensions/tizen-certificate-extension_2.0.70.zip'
    try {
      const response = await this.fetch('https://download.tizen.org/sdk/tizenstudio/official/extension_info.xml')
      if (!response.ok) throw new Error('Extension index unavailable')
      const xml = new DOMParser().parseFromString(await response.text(), 'text/xml')
      for (const extension of Array.from(xml.getElementsByTagName('extension'))) {
        if (extension.getElementsByTagName('name')[0]?.textContent?.trim() !== 'Samsung Certificate Extension') continue
        const candidate = new URL(extension.getElementsByTagName('repository')[0].textContent.trim())
        if (candidate.protocol === 'https:' && candidate.hostname === 'download.tizen.org') url = candidate.href
      }
    } catch { /* Fall back to Samsung's published extension archive. */ }
    const response = await this.fetch(url)
    if (!response.ok) throw new Error('Could not download the Samsung public certificate chain.')
    let zip = await JSZip.loadAsync(await response.buffer())
    for (const extension of ['.zip', '.jar']) {
      const entry = Object.values(zip.files).find(file => !file.dir && file.name.endsWith(extension))
      if (!entry) throw new Error('Samsung returned an unsupported certificate archive.')
      zip = await JSZip.loadAsync(await entry.async('nodebuffer'))
    }
    fs.mkdirSync(this.cacheDirectory, { recursive: true })
    for (const name of names) {
      const entry = Object.values(zip.files).find(file => !file.dir && path.basename(file.name) === name)
      if (!entry) throw new Error('The Samsung certificate archive is incomplete.')
      fs.writeFileSync(path.join(this.cacheDirectory, name), await entry.async('nodebuffer'))
    }
  }

  _mobilePKCS12(key, issued, name, authorInfo) {
    const chain = fs.readFileSync(path.join(this.cacheDirectory, name), 'utf8')
    const pkcs12 = forge.pkcs12.toPkcs12Asn1(forge.pki.privateKeyFromPem(key.privateKey), [issued, chain], authorInfo.password, { generateLocalKeyId: true, friendlyName: 'UserCertificate' })
    return forge.asn1.toDer(pkcs12).getBytes()
  }

  _generateAuthorPKCS12(key, issued, authorInfo) {
    return this.cacheDirectory ? this._mobilePKCS12(key, issued, 'vd_tizen_dev_author_ca.cer', authorInfo) : super._generateAuthorPKCS12(key, issued, authorInfo)
  }

  _generateDistributorPKCS12(key, issued, authorInfo) {
    if (this.cacheDirectory && authorInfo.privilegeLevel !== 'Public') throw new Error('The mobile installer supports public Samsung certificates.')
    return this.cacheDirectory ? this._mobilePKCS12(key, issued, 'vd_tizen_dev_public2.crt', authorInfo) : super._generateDistributorPKCS12(key, issued, authorInfo)
  }

  async _fetchDeviceProfile(accessInfo, authorInfo, distributorCert) {
    const formData = new this.FormData()
    formData.append('access_token', accessInfo.accessToken)
    formData.append('user_id', accessInfo.userId)
    formData.append('platform', 'VD')
    formData.append('privilege_level', authorInfo.privilegeLevel)
    formData.append('developer_type', 'Individual')
    formData.append('csr', distributorCert.csr, {
      contentType: 'application/octet-stream',
      filename: 'distributor.csr',
    })

    const response = await this.fetch(DEVICE_PROFILE_URL, {
      method: 'POST',
      headers: formData.getHeaders(),
      body: formData,
    })
    const profile = await response.text()
    if (!response.ok) throw new Error(`Failed to fetch Samsung TV device profile\n${profile}`)
    if (!/^\s*<Profile(?:\s|>)/.test(profile)) throw new Error('Samsung did not return a valid TV device profile.')
    return profile
  }

  async createCertificate(authorInfo, accessInfo, duidList) {
    await this._downloadVDCertificates()
    const author = this._generateAuthorCert(authorInfo)
    const distributor = this._generateDistributorCert(authorInfo, duidList)
    const issuedAuthor = await this._fetchAuthorCert(accessInfo, author)
    // Samsung's v1 distributor endpoint returns the TV permission profile. The v3
    // endpoint returns the certificate used to sign the WGT; they are not interchangeable.
    const deviceProfile = await this._fetchDeviceProfile(accessInfo, authorInfo, distributor)
    const issuedDistributor = await this._fetchDistributorCert(accessInfo, authorInfo, distributor)

    return {
      authorCert: await this._generateAuthorPKCS12(author, issuedAuthor, authorInfo),
      distributorCert: await this._generateDistributorPKCS12(distributor, issuedDistributor, authorInfo),
      distributorXML: deviceProfile,
    }
  }
}

module.exports = { DEVICE_PROFILE_URL, SamsungCertificateCreator }
