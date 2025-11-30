const axios = require('axios')
const dns = require('dns')
const config = require('../config/config')
const Debug = require('./debug')

async function validate() {
  const token = config.discord.token
  const clientId = config.discord.clientId
  if (!token || !clientId) {
    return { valid: false, reason: 'MISSING_ENV' }
  }
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { valid: false, reason: 'FORMAT' }
  }
  let decoded
  try {
    decoded = Buffer.from(parts[0], 'base64').toString('utf8')
  } catch (_e) {
    return { valid: false, reason: 'DECODE_FAIL' }
  }
  if (decoded !== clientId) {
    return { valid: false, reason: 'MISMATCH_ID' }
  }
  try {
    const res = await axios.get('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
      timeout: 5000
    })
    if (res && res.status === 200) {
      return { valid: true }
    }
    return { valid: false, reason: 'HTTP_' + res.status }
  } catch (e) {
    if (e.response && e.response.status === 401) {
      return { valid: false, reason: 'UNAUTHORIZED' }
    }
    if (e.response && e.response.status === 403) {
      return { valid: false, reason: 'FORBIDDEN' }
    }
    return { valid: false, reason: 'NETWORK', error: e.message }
  }

  try {
    const gw = await axios.get('https://discord.com/api/v10/gateway', { timeout: 5000 })
    Debug.trace('gateway.probe', { status: gw.status })
  } catch (e) {
    Debug.error('gateway.probe', e)
  }

  const proxyPresent = !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY)
  Debug.trace('proxy.status', { present: proxyPresent })

  await new Promise((resolve) => {
    dns.lookup('discord.com', (err, address, family) => {
      if (err) Debug.error('dns.lookup', err)
      else Debug.trace('dns.lookup', { address, family })
      resolve()
    })
  })
}

module.exports = { validate }
