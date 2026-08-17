import http from 'node:http';
import os from 'node:os';

const DEFAULT_PORT = 47831;
const DEFAULT_TIMEOUT_MS = 350;
const MAX_CONCURRENCY = 48;

function isLanIpv4(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 4 || !parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)) return false;
  const [first, second] = parts.map(Number);
  if (first === 10) return true;
  if (first === 192 && second === 168) return true;
  return first === 172 && second >= 16 && second <= 31;
}

function ipv4ToInt(value) {
  return value.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0) >>> 0;
}

function intToIpv4(value) {
  return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.');
}

function hostsForInterface(address, netmask) {
  const ip = ipv4ToInt(address);
  const mask = ipv4ToInt(netmask || '255.255.255.0');
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const size = Math.max(0, broadcast - network - 1);
  if (size <= 0 || size > 1022) {
    const prefix = address.split('.').slice(0, 3).join('.');
    return Array.from({ length: 254 }, (_, index) => `${prefix}.${index + 1}`);
  }
  return Array.from({ length: size }, (_, index) => intToIpv4(network + index + 1));
}

function fetchJson(ip, port, timeoutMs) {
  return new Promise(resolve => {
    const started = performance.now();
    const request = http.get({ hostname: ip, port, path: '/server-info', timeout: timeoutMs }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode !== 200) return resolve(null);
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!payload?.serverId || !payload?.protocolVersion) return resolve(null);
          resolve({ ...payload, ip, port, latencyMs: Math.round(performance.now() - started) });
        } catch {
          resolve(null);
        }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

export async function discoverLanServers({ port = DEFAULT_PORT, timeoutMs = DEFAULT_TIMEOUT_MS, knownIp } = {}) {
  const interfaces = Object.values(os.networkInterfaces()).flat().filter(Boolean)
    .filter(item => item.family === 'IPv4' && !item.internal && isLanIpv4(item.address));
  const candidates = new Set();
  if (isLanIpv4(knownIp)) candidates.add(String(knownIp));
  for (const item of interfaces) for (const host of hostsForInterface(item.address, item.netmask)) candidates.add(host);

  const queue = Array.from(candidates);
  const found = [];
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const index = cursor++;
      const result = await fetchJson(queue[index], Number(port), Number(timeoutMs));
      if (result) found.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, () => worker()));
  const unique = new Map();
  for (const item of found) unique.set(item.serverId, item);
  return Array.from(unique.values()).sort((a, b) => a.latencyMs - b.latencyMs);
}
