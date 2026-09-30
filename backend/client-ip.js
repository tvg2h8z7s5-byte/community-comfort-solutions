'use strict';
const { BlockList, isIP } = require('node:net');
const { networks } = require('./cloudflare-networks.json');
const cloudflare = new BlockList();
for (const cidr of networks) {
  const [address, prefix] = cidr.split('/');
  cloudflare.addSubnet(address, Number(prefix), isIP(address) === 4 ? 'ipv4' : 'ipv6');
}
const privatePeers = new BlockList();
for (const [ip, bits] of [['127.0.0.0',8], ['10.0.0.0',8], ['172.16.0.0',12], ['192.168.0.0',16]]) {
  privatePeers.addSubnet(ip, bits, 'ipv4');
}
privatePeers.addSubnet('fc00::', 7, 'ipv6');
privatePeers.addAddress('::1', 'ipv6');

function normalizeIP(value) {
  if (typeof value !== 'string') return null;
  const ip = value.trim();
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return null;
  // Reject scoped IPv6 values and normalize equivalent spellings for the limiter.
  if (ip.includes('%')) return null;
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = normalized.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/);
  if (mapped) {
    const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16);
    return [hi >>> 8, hi & 255, lo >>> 8, lo & 255].join('.');
  }
  return normalized;
}
const contains = (list, ip) => !!ip && list.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');

function contactClientIP(req) {
  const peer = normalizeIP(req.socket.remoteAddress);
  const forwarded = normalizeIP(req.ip);
  // The existing one-hop trust identifies the peer observed by Traefik. Only
  // consider its forwarded result when our connection is from a private proxy.
  // This relies on Traefik's normal sanitization of untrusted X-Forwarded-For
  // and the app remaining internal to the host-controlled Docker network.
  const edge = contains(cloudflare, peer) ? peer
    : contains(privatePeers, peer) && contains(cloudflare, forwarded) ? forwarded : null;
  if (edge) {
    const visitor = normalizeIP(req.get('CF-Connecting-IP'));
    if (visitor) {
      // Cloudflare Pseudo IPv4 overwrite mode preserves the original IPv6 here.
      if (isIP(visitor) === 4 && Number(visitor.split('.')[0]) >= 240) {
        const original = normalizeIP(req.get('CF-Connecting-IPv6'));
        if (original && isIP(original) === 6) return original;
      }
      return visitor;
    }
  }
  // Missing/malformed/unverified Cloudflare headers never grant a fresh key.
  return forwarded || peer || 'unknown';
}

module.exports = { contactClientIP };
