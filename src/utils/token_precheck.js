const axios = require('axios')
const dns = require('dns')
const config = require('../config/config')
const Debug = require('./debug')

async function validate() {
  const token = config.discord.token
  const clientId = config.discord.clientId

  let result = { valid: false, reason: null }

  if (!token || !clientId) {
    result = { valid: false, reason: 'MISSING_ENV' }
  } else {
    const parts = token.split('.')
    if (parts.length !== 3) {
      result = { valid: false, reason: 'FORMAT' }
    } else {
      let decoded
      try {
        decoded = Buffer.from(parts[0], 'base64').toString('utf8')
      } catch (_e) {
        decoded = null
      }

      if (!decoded) {
        result = { valid: false, reason: 'DECODE_FAIL' }
      } else if (decoded !== clientId) {
        result = { valid: false, reason: 'MISMATCH_ID' }
      } else {
        try {
          const res = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bot ${token}` },
            timeout: 5000
          })
          if (res && res.status === 200) {
            result = { valid: true }
          } else {
            result = { valid: false, reason: 'HTTP_' + res.status }
          }
        } catch (e) {
          if (e.response && e.response.status === 401) {
            result = { valid: false, reason: 'UNAUTHORIZED' }
          } else if (e.response && e.response.status === 403) {
            result = { valid: false, reason: 'FORBIDDEN' }
          } else {
            result = { valid: false, reason: 'NETWORK', error: e.message }
          }
        }
      }
    }
  }

  const tasks = []
  tasks.push((async () => {
    try {
      const gw = await axios.get('https://discord.com/api/v10/gateway', { timeout: 5000 })
      Debug.trace('gateway.probe', { status: gw.status })
    } catch (e) {
      Debug.error('gateway.probe', e)
    }
  })())

  tasks.push((async () => {
    const proxyPresent = !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY)
    Debug.trace('proxy.status', { present: proxyPresent })
  })())

  tasks.push((async () => {
    await new Promise((resolve) => {
      dns.lookup('discord.com', (err, address, family) => {
        if (err) Debug.error('dns.lookup', err)
        else Debug.trace('dns.lookup', { address, family })
        resolve()
      })
    })
  })())

  await Promise.allSettled(tasks)

  return result
}

module.exports = { validate }
