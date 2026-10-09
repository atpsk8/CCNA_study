// IPv4 / IPv6 helpers. Every address is a BigInt so v4 and v6 share the same routing code.
// A "prefix" is { fam: 4|6, net: BigInt, len: number }.

const V4_BITS = 32n
const V6_BITS = 128n
const bits = (fam) => (fam === 4 ? V4_BITS : V6_BITS)

export function parseV4(str) {
  if (typeof str !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(str)) return null
  const parts = str.split('.').map(Number)
  if (parts.some((p) => p > 255)) return null
  return parts.reduce((acc, p) => (acc << 8n) | BigInt(p), 0n)
}

export function v4ToStr(n) {
  return [24n, 16n, 8n, 0n].map((s) => String((n >> s) & 255n)).join('.')
}

// Mask "255.255.255.0" -> 24, or null if not contiguous
export function maskToLen(maskStr) {
  const m = parseV4(maskStr)
  if (m === null) return null
  let len = 0
  let seenZero = false
  for (let i = 31n; i >= 0n; i--) {
    const bit = (m >> i) & 1n
    if (bit === 1n) {
      if (seenZero) return null
      len++
    } else seenZero = true
  }
  return len
}

export function lenToMask(len) {
  return v4ToStr(len === 0 ? 0n : ((1n << 32n) - 1n) ^ ((1n << BigInt(32 - len)) - 1n))
}

export function wildcardToLen(wild) {
  const w = parseV4(wild)
  if (w === null) return null
  return maskToLen(v4ToStr(((1n << 32n) - 1n) ^ w))
}

export function netMask(fam, len) {
  const b = bits(fam)
  return len === 0 ? 0n : ((1n << b) - 1n) ^ ((1n << (b - BigInt(len))) - 1n)
}

export const networkOf = (fam, addr, len) => addr & netMask(fam, len)

export function inPrefix(prefix, fam, addr) {
  return prefix.fam === fam && networkOf(fam, addr, prefix.len) === prefix.net
}

export function broadcastOf(addr, len) {
  return networkOf(4, addr, len) | (((1n << 32n) - 1n) ^ netMask(4, len))
}

// ---------- IPv6 ----------

export function parseV6(str) {
  if (typeof str !== 'string') return null
  let s = str.trim().toLowerCase()
  if (!/^[0-9a-f:]+$/.test(s) || s.split('::').length > 2) return null
  let groups
  if (s.includes('::')) {
    const [a, b] = s.split('::')
    const left = a ? a.split(':') : []
    const right = b ? b.split(':') : []
    const fill = 8 - left.length - right.length
    if (fill < 1) return null
    groups = [...left, ...Array(fill).fill('0'), ...right]
  } else groups = s.split(':')
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n)
}

// RFC 5952-style compression, upper case like IOS output
export function v6ToStr(n) {
  const groups = []
  for (let i = 7n; i >= 0n; i--) groups.push(Number((n >> (i * 16n)) & 0xffffn))
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) { i++; continue }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLen && j - i >= 2) { bestStart = i; bestLen = j - i }
    i = j
  }
  const hex = groups.map((g) => g.toString(16).toUpperCase())
  if (bestStart === -1) return hex.join(':')
  const left = hex.slice(0, bestStart).join(':')
  const right = hex.slice(bestStart + bestLen).join(':')
  return `${left}::${right}`
}

// "2001:db8::1/64" -> { addr, len }
export function parseV6Prefix(str) {
  const m = /^([0-9a-fA-F:]+)\/(\d{1,3})$/.exec(str ?? '')
  if (!m) return null
  const addr = parseV6(m[1])
  const len = Number(m[2])
  if (addr === null || len > 128) return null
  return { addr, len }
}

// Modified EUI-64 interface ID from a MAC (BigInt 48-bit)
export function eui64(mac) {
  const hi = mac >> 24n
  const lo = mac & 0xffffffn
  let id = (hi << 40n) | (0xfffen << 24n) | lo
  id ^= 0x02n << 56n // flip the U/L bit
  return id
}

export const LINK_LOCAL_PREFIX = 0xfe80n << 112n

export function solicitedNode(addr) {
  return (0xff02n << 112n) | (1n << 32n) | (0xffn << 24n) | (addr & 0xffffffn)
}

// ---------- MAC ----------

export function macToStr(mac) {
  const h = mac.toString(16).padStart(12, '0')
  return `${h.slice(0, 4)}.${h.slice(4, 8)}.${h.slice(8, 12)}`
}

export function addrToStr(fam, n) {
  return fam === 4 ? v4ToStr(n) : v6ToStr(n)
}

export function prefixToStr(p) {
  return p.fam === 4 ? `${v4ToStr(p.net)}/${p.len}` : `${v6ToStr(p.net)}/${p.len}`
}

// Parse "10,20,30-32" or "all"
export function parseVlanList(str) {
  if (!str) return null
  if (str === 'all') return 'all'
  const out = new Set()
  for (const part of str.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part)
    if (!m) return null
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    if (a < 1 || b > 4094 || b < a) return null
    for (let v = a; v <= b; v++) out.add(v)
  }
  return out
}
