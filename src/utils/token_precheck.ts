import axios from 'axios';
import dns from 'dns';
import config = require('../config/config');
import * as Debug from './debug';

interface PrecheckResult { valid: boolean; reason?: string; error?: string }

export async function validate(): Promise<PrecheckResult> {
  const token = config.discord.token;
  const clientId = config.discord.clientId;

  let result: PrecheckResult = { valid: false };

  if (!token || !clientId) {
    result = { valid: false, reason: 'MISSING_ENV' };
  } else {
    const parts = token.split('.');
    if (parts.length !== 3) {
      result = { valid: false, reason: 'FORMAT' };
    } else {
      let decoded: string | null;
      try {
        decoded = Buffer.from(parts[0], 'base64').toString('utf8');
      } catch (_e) {
        decoded = null;
      }

      if (!decoded) {
        result = { valid: false, reason: 'DECODE_FAIL' };
      } else if (decoded !== clientId) {
        result = { valid: false, reason: 'MISMATCH_ID' };
      } else {
        try {
          const res = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bot ${token}` },
            timeout: 5000,
          });
          if (res && res.status === 200) {
            result = { valid: true };
          } else {
            result = { valid: false, reason: 'HTTP_' + res.status };
          }
        } catch (e: unknown) {
          const axiosErr = e as { response?: { status: number }; message?: string };
          if (axiosErr.response && axiosErr.response.status === 401) {
            result = { valid: false, reason: 'UNAUTHORIZED' };
          } else if (axiosErr.response && axiosErr.response.status === 403) {
            result = { valid: false, reason: 'FORBIDDEN' };
          } else {
            result = { valid: false, reason: 'NETWORK', error: axiosErr.message };
          }
        }
      }
    }
  }

  const tasks: Promise<void>[] = [];

  tasks.push((async () => {
    try {
      const gw = await axios.get('https://discord.com/api/v10/gateway', { timeout: 5000 });
      Debug.trace('gateway.probe', { status: gw.status });
    } catch (e) {
      Debug.error('gateway.probe', e as Error);
    }
  })());

  tasks.push((async () => {
    const proxyPresent = !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY);
    Debug.trace('proxy.status', { present: proxyPresent });
  })());

  tasks.push((async () => {
    await new Promise<void>((resolve) => {
      dns.lookup('discord.com', (err, address, family) => {
        if (err) Debug.error('dns.lookup', err);
        else Debug.trace('dns.lookup', { address, family });
        resolve();
      });
    });
  })());

  await Promise.allSettled(tasks);

  return result;
}
