// Device model and config storage.
// Config is stored the way IOS shows it: global lines + sections ("interface X", "router ospf 1", ...).
// Everything here is plain JSON so a lab can be saved to localStorage and resumed.

import { compareIfaces, isPhysical, ifaceType } from './iface.js'

export function createDevice(spec) {
  const kind = spec.kind
  const dev = {
    id: spec.id,
    kind, // 'router' | 'switch' | 'l3switch' | 'pc' | 'server'
    model: spec.model ?? defaultModel(kind),
    mac: spec.mac ?? macFromId(spec.id), // hex string, 12 digits
    ports: spec.ports ?? defaultPorts(kind),
    config: { global: [], sections: [] },
    startup: null,
    secrets: { enable: null, enablePassword: null, users: {}, lines: {} },
    rt: { ospfRid: null, ospfStarted: false, rsaBits: 0, errdisabled: [], nat: [], natNext: {}, leases: [], snoopBindings: [], hsrpActive: {}, log: [], sticky: {} },
    host: null, // PCs and servers: { ip, mask, gw, dns, dhcp, ipv6, ipv6gw, services }
  }
  if (kind === 'pc' || kind === 'server') {
    dev.host = { ip: null, mask: null, gw: null, dns: null, dhcp: false, ipv6: null, ipv6len: 64, ipv6gw: null, services: [], ...(spec.host ?? {}) }
    return dev
  }
  setGlobal(dev, `hostname ${spec.hostname ?? defaultHostname(kind)}`, 'hostname')
  for (const p of dev.ports) {
    const sec = ensureSection(dev, `interface ${p}`)
    if (kind === 'router') sec.lines.push('shutdown')
  }
  if (kind !== 'router') ensureSection(dev, 'interface Vlan1').lines.push('no ip address', 'shutdown')
  for (const l of ['line con 0', 'line vty 0 4', 'line vty 5 15']) ensureSection(dev, l)
  return dev
}

function macFromId(id) {
  let h = 2166136261
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return ('0c' + h.toString(16).padStart(8, '0') + '00').slice(0, 12)
}

const defaultModel = (k) => ({ router: 'ISR4321', switch: 'C9200L-24P', l3switch: 'C9300-24P', pc: 'PC', server: 'Server' })[k]
const defaultHostname = (k) => (k === 'router' ? 'Router' : 'Switch')

function defaultPorts(kind) {
  if (kind === 'router') return ['GigabitEthernet0/0/0', 'GigabitEthernet0/0/1', 'GigabitEthernet0/0/2']
  if (kind === 'switch' || kind === 'l3switch') return Array.from({ length: 24 }, (_, i) => `GigabitEthernet1/0/${i + 1}`)
  return ['Ethernet0']
}

export const hostname = (dev) => (dev.kind === 'pc' || dev.kind === 'server') ? dev.id : (getGlobal(dev, 'hostname')?.split(' ')[1] ?? dev.id)
export const isIos = (dev) => dev.kind === 'router' || dev.kind === 'switch' || dev.kind === 'l3switch'
export const isSwitch = (dev) => dev.kind === 'switch' || dev.kind === 'l3switch'
export const macBig = (dev) => BigInt('0x' + dev.mac)

// ---------- line helpers ----------

export const tokens = (line) => line.trim().split(/\s+/)

// Does `line` start with the same tokens as `prefix`?
export function startsWithTokens(line, prefix) {
  const a = tokens(line)
  const b = tokens(prefix)
  return b.every((t, i) => a[i] === t)
}

export function setLine(lines, line, key) {
  if (key) {
    const i = lines.findIndex((l) => startsWithTokens(l, key))
    if (i >= 0) { lines[i] = line; return }
  } else if (lines.includes(line)) return
  lines.push(line)
}

export function removeLines(lines, prefix) {
  let removed = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    if (startsWithTokens(lines[i], prefix)) { lines.splice(i, 1); removed++ }
  }
  return removed
}

// ---------- sections ----------

export const getSection = (dev, head) => dev.config.sections.find((s) => s.head === head)

export function ensureSection(dev, head) {
  let s = getSection(dev, head)
  if (!s) {
    s = { head, lines: [] }
    dev.config.sections.push(s)
  }
  return s
}

export function removeSection(dev, head) {
  dev.config.sections = dev.config.sections.filter((s) => s.head !== head)
}

export const sectionsOf = (dev, prefix) => dev.config.sections.filter((s) => s.head.startsWith(prefix))

export const ifaceSection = (dev, name) => getSection(dev, `interface ${name}`)
export const ifaceLines = (dev, name) => ifaceSection(dev, name)?.lines ?? []
export const interfaces = (dev) => sectionsOf(dev, 'interface ').map((s) => s.head.slice(10))

// First line in a section starting with prefix (returns the remainder tokens after prefix)
export function lineValue(lines, prefix) {
  const l = lines.find((x) => startsWithTokens(x, prefix))
  return l === undefined ? undefined : l.trim().slice(prefix.length).trim()
}
export const hasLine = (lines, prefix) => lines.some((x) => startsWithTokens(x, prefix))

export const getGlobal = (dev, prefix) => dev.config.global.find((l) => startsWithTokens(l, prefix))
export const globalLines = (dev, prefix) => dev.config.global.filter((l) => startsWithTokens(l, prefix))
export function setGlobal(dev, line, key) { setLine(dev.config.global, line, key) }

// ---------- passwords ----------

const XLAT = 'dsfd;kfoA,.iyewrkldJKDHSUBsgvca69834ncxv9873254k;fg87'

// Cisco type 7 (reversible) encoding, used by service password-encryption
export function type7(plain) {
  const seed = 2
  let out = String(seed).padStart(2, '0')
  for (let i = 0; i < plain.length; i++) {
    const c = plain.charCodeAt(i) ^ XLAT.charCodeAt((seed + i) % XLAT.length)
    out += c.toString(16).toUpperCase().padStart(2, '0')
  }
  return out
}

// Fake but stable "hash" for type 5/8/9 display
export function fakeHash(type, plain) {
  let h = 2166136261
  for (const ch of plain + type) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  const alphabet = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  let s = ''
  let x = h
  for (let i = 0; i < 43; i++) { x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0; s += alphabet[x % 64] }
  return type === 5 ? `$1$${s.slice(0, 4)}$${s.slice(4, 26)}` : `$${type}$${s.slice(0, 14)}$${s.slice(14)}`
}

// ---------- show running-config ----------

const PRE = ['version', 'service', 'hostname', 'boot', 'enable', 'aaa', 'clock', 'ip routing', 'ip domain', 'no ip domain', 'ip dhcp excluded', 'ip dhcp snooping', 'no ip dhcp', 'ip arp', 'ipv6 unicast', 'username', 'crypto', 'errdisable', 'spanning-tree', 'vtp', 'lldp', 'no cdp', 'cdp']

export function renderRunning(dev) {
  const out = ['Building configuration...', '', `Current configuration : ${1200 + JSON.stringify(dev.config).length} bytes`, '!', 'version 17.9', '!']
  const preIdx = (l) => PRE.findIndex((p) => l.startsWith(p))
  const pre = dev.config.global.filter((l) => preIdx(l) >= 0).sort((a, b) => preIdx(a) - preIdx(b))
  let post = dev.config.global.filter((l) => preIdx(l) < 0)
  // Numbered ACLs always show as "access-list N ..." lines, in numeric order, even after being
  // edited by sequence number in "ip access-list standard N" mode
  const numbered = []
  for (const sec of dev.config.sections) {
    const m = /^ip access-list (?:standard|extended) (\d+)$/.exec(sec.head)
    if (m) for (const l of sec.lines) numbered.push(`access-list ${m[1]} ${l.replace(/^\d+ /, '')}`)
  }
  const acls = [...post.filter((l) => l.startsWith('access-list ')), ...numbered].map((l, i) => [l, i]).sort((a, b) => Number(a[0].split(' ')[1]) - Number(b[0].split(' ')[1]) || a[1] - b[1]).map((x) => x[0])
  post = [...post.filter((l) => !l.startsWith('access-list ')), ...acls]
  for (const l of pre) out.push(l)
  out.push('!')
  const order = (h) => {
    if (h.startsWith('ip dhcp pool')) return 0
    if (h.startsWith('vlan')) return 1
    if (h.startsWith('interface')) return 2
    if (h.startsWith('router')) return 3
    if (h.startsWith('ip access-list')) return 5
    if (h.startsWith('line')) return 9
    return 4
  }
  const secs = [...dev.config.sections].filter((sec) => !/^ip access-list (?:standard|extended) \d+$/.test(sec.head)).sort((a, b) => {
    const d = order(a.head) - order(b.head)
    if (d) return d
    if (a.head.startsWith('interface') && b.head.startsWith('interface')) return compareIfaces(a.head.slice(10), b.head.slice(10))
    if (a.head.startsWith('vlan') && b.head.startsWith('vlan')) return Number(a.head.slice(5)) - Number(b.head.slice(5))
    return 0
  })
  let printedPost = false
  for (const s of secs) {
    if (!printedPost && order(s.head) >= 4) {
      for (const l of post) out.push(l)
      if (post.length) out.push('!')
      printedPost = true
    }
    out.push(s.head)
    const lines = [...s.lines]
    if (s.head.startsWith('interface ')) {
      const name = s.head.slice(10)
      const routed = dev.kind === 'router' || ifaceType(name) === 'Vlan' || ifaceType(name) === 'Loopback' || lines.includes('no switchport')
      if (routed && !lines.some((l) => l.startsWith('ip address')) && isPhysical(name)) lines.unshift('no ip address')
    }
    for (const l of lines) out.push(' ' + l)
    out.push('!')
  }
  if (!printedPost) for (const l of post) out.push(l)
  out.push('end')
  return out.join('\n')
}
