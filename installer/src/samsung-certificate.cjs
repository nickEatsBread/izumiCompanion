const FormData = require('form-data')
const fetch = require('node-fetch')
const { SamsungCertificateCreator: BaseSamsungCertificateCreator } = require('tizen')

const DEVICE_PROFILE_URL = 'https://svdca.samsungqbe.com/apis/v1/distributors'

class SamsungCertificateCreator extends BaseSamsungCertificateCreator {
  constructor(options = {}) {
    super()
    this.fetch = options.fetch || fetch
    this.FormData = options.FormData || FormData
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
