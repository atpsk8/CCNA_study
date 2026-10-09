// Network engine: derives the operational state of a lab from device configs + cabling.
// compute() is pure-ish: it reads configs and runtime state (dev.rt) and returns a snapshot `net`.
// A few things are learned during compute (sticky MACs, OSPF router ID capture) the way a real
// device would learn them.

import {
  parseV4, v4ToStr, maskToLen, wildcardToLen, networkOf, netMask, parseV6, parseV6Prefix,
  eui64, LINK_LOCAL_PREFIX, parseVlanList, macToStr,
} from './ip.js'
import { ifaceType, isSubif, parentOf, isPhysical, bandwidthKbps, stpCost, compareIfaces } from './iface.js'
import {
  isIos, isSwitch, ifaceLines, lineValue, hasLine, interfaces, getSection, sectionsOf,
  getGlobal, globalLines, hostname, macBig, tokens,
} from './device.js'

// ======================================================================
// Small helpers
// ======================================================================

const MASK32 = (1n << 32n) - 1n

export function ifaceMac(dev, iface) {
  const base = macBig(dev)
  if (!isIos(dev)) return base
  const phys = parentOf(iface)
  const idx = dev.ports.indexOf(phys)
  return idx >= 0 ? base + BigInt(idx + 1) : base
}

export function vlanDb(dev) {
  const set = new Map([[1, 'default']])
  for (const s of sectionsOf(dev, 'vlan ')) {
    const id = Number(s.head.slice(5))
    if (!Number.isNaN(id)) set.set(id, lineValue(s.lines, 'name') ?? `VLAN${String(id).padStart(4, '0')}`)
  }
  return set
}

// Switchport configuration (as configured, not operational)
export function swConfig(dev, iface) {
  if (!isSwitch(dev)) return null
  const t = ifaceType(iface)
  if (t === 'Vlan' || t === 'Loopback') return null
  const L = ifaceLines(dev, iface)
  if (hasLine(L, 'no switchport')) return { mode: 'routed' }
  const allowedRaw = lineValue(L, 'switchport trunk allowed vlan')
  return {
    mode: lineValue(L, 'switchport mode') ?? 'dynamic auto',
    accessVlan: Number(lineValue(L, 'switchport access vlan') ?? 1),
    voiceVlan: lineValue(L, 'switchport voice vlan') ? Number(lineValue(L, 'switchport voice vlan')) : null,
    native: Number(lineValue(L, 'switchport trunk native vlan') ?? 1),
    allowed: allowedRaw ? (allowedRaw === 'none' ? new Set() : parseVlanList(allowedRaw)) : 'all',
    nonegotiate: hasLine(L, 'switchport nonegotiate'),
  }
}

const allows = (allowed, v) => allowed === 'all' || allowed.has(v)

// Is PortFast operational on a switchport? Interface portfast (or the global default) only acts on
// non-trunking ports; "spanning-tree portfast disable" overrides the global default.
function portfastOn(dev, p, mode) {
  const L = ifaceLines(dev, p)
  if (L.includes('spanning-tree portfast disable') || mode === 'trunk') return false
  return L.includes('spanning-tree portfast') || (hasLine(dev.config.global, 'spanning-tree portfast default') && mode === 'access')
}

export function stpMode(dev) {
  return lineValue(dev.config.global, 'spanning-tree mode') ?? 'rapid-pvst'
}

function vlanPriority(dev, vlan) {
  for (const l of globalLines(dev, 'spanning-tree vlan')) {
    const m = /^spanning-tree vlan (\S+) priority (\d+)$/.exec(l)
    if (m) {
      const list = parseVlanList(m[1])
      if (list && list !== 'all' && list.has(vlan)) return Number(m[2])
    }
  }
  return 32768
}

// ======================================================================
// ACL evaluation
// ======================================================================

// Parse "any" | "host A" | "A W" at tokens[i]; returns { match(addr), next }
function parseAddrSpec(t, i) {
  if (t[i] === 'any') return { match: () => true, next: i + 1 }
  if (t[i] === 'host') {
    const a = parseV4(t[i + 1])
    if (a === null) return null
    return { match: (x) => x === a, next: i + 2 }
  }
  const a = parseV4(t[i])
  if (a === null) return null
  const w = parseV4(t[i + 1])
  if (w !== null && i + 1 < t.length) {
    const care = MASK32 ^ w
    return { match: (x) => (x & care) === (a & care), next: i + 2 }
  }
  return { match: (x) => x === a, next: i + 1 } // standard ACL with no wildcard = host
}

const PORT_NAMES = { ftp: 21, 'ftp-data': 20, ssh: 22, telnet: 23, smtp: 25, domain: 53, bootps: 67, bootpc: 68, tftp: 69, www: 80, http: 80, pop3: 110, ntp: 123, snmp: 161, snmptrap: 162, https: 443, 443: 443, syslog: 514 }
const portNum = (s) => (PORT_NAMES[s] !== undefined ? PORT_NAMES[s] : /^\d+$/.test(s) ? Number(s) : null)
const PROTO_NUM = { ip: null, icmp: 1, tcp: 6, udp: 17, ospf: 89, eigrp: 88, gre: 47, esp: 50, ahp: 51 }

function parsePortSpec(t, i) {
  const op = t[i]
  if (['eq', 'neq', 'lt', 'gt'].includes(op)) {
    const p = portNum(t[i + 1])
    if (p === null) return null
    const f = { eq: (x) => x === p, neq: (x) => x !== p, lt: (x) => x < p, gt: (x) => x > p }[op]
    return { match: f, next: i + 2 }
  }
  if (op === 'range') {
    const a = portNum(t[i + 1])
    const b = portNum(t[i + 2])
    if (a === null || b === null) return null
    return { match: (x) => x >= a && x <= b, next: i + 3 }
  }
  return { match: () => true, next: i }
}

// Validate/compile one ACL entry body ("permit tcp any host 1.1.1.1 eq 80"). Returns null if invalid.
export function compileAce(body, type) {
  const t = tokens(body)
  const action = t[0]
  if (action === 'remark') return { remark: true }
  if (action !== 'permit' && action !== 'deny') return null
  if (type === 'standard') {
    const src = parseAddrSpec(t, 1)
    if (!src) return null
    const extra = t.slice(src.next)
    if (extra.length && !(extra.length === 1 && extra[0] === 'log')) return null
    return { action, test: (p) => p.fam === 4 && src.match(p.src) }
  }
  const proto = t[1]
  if (!(proto in PROTO_NUM) && !/^\d+$/.test(proto)) return null
  const src = parseAddrSpec(t, 2)
  if (!src) return null
  let i = src.next
  let sport = { match: () => true }
  if (proto === 'tcp' || proto === 'udp') { sport = parsePortSpec(t, i); if (!sport) return null; i = sport.next }
  const dst = parseAddrSpec(t, i)
  if (!dst) return null
  i = dst.next
  let dport = { match: () => true }
  if (proto === 'tcp' || proto === 'udp') { dport = parsePortSpec(t, i); if (!dport) return null; i = dport.next }
  let icmpType = null
  let established = false
  while (i < t.length) {
    const w = t[i]
    if (proto === 'icmp' && ['echo', 'echo-reply', 'unreachable', 'time-exceeded'].includes(w)) icmpType = w
    else if (proto === 'tcp' && w === 'established') established = true
    else if (w !== 'log') return null
    i++
  }
  return {
    action,
    test: (p) => {
      if (p.fam !== 4) return false
      if (proto !== 'ip') {
        const want = PROTO_NUM[proto] ?? Number(proto)
        if (p.proto !== want) return false
      }
      if (!src.match(p.src) || !dst.match(p.dst)) return false
      if (proto === 'tcp' || proto === 'udp') {
        if (!sport.match(p.sport) || !dport.match(p.dport)) return false
      }
      if (icmpType && p.icmpType !== icmpType) return false
      if (established && !p.ack) return false
      return true
    },
  }
}

// All ACLs on a device: { name: { type, entries: [{seq, body}] } }
export function aclTable(dev) {
  const acls = {}
  for (const l of globalLines(dev, 'access-list')) {
    const m = /^access-list (\d+) (.*)$/.exec(l)
    if (!m) continue
    const n = Number(m[1])
    const type = (n >= 1 && n <= 99) || (n >= 1300 && n <= 1999) ? 'standard' : 'extended'
    acls[m[1]] ??= { type, numbered: true, entries: [] }
    acls[m[1]].entries.push({ seq: (acls[m[1]].entries.length + 1) * 10, body: m[2] })
  }
  for (const s of sectionsOf(dev, 'ip access-list ')) {
    const m = /^ip access-list (standard|extended) (\S+)$/.exec(s.head)
    if (!m) continue
    const entries = s.lines.map((l) => {
      const mm = /^(\d+) (.*)$/.exec(l)
      return { seq: Number(mm[1]), body: mm[2] }
    }).sort((a, b) => a.seq - b.seq)
    // Numbered ACLs edited in named mode merge with the numbered entries
    if (acls[m[2]]) acls[m[2]].entries = entries
    else acls[m[2]] = { type: m[1], numbered: /^\d+$/.test(m[2]), entries }
  }
  return acls
}

// Returns { permit: bool, entry }  (undefined ACL = permit everything, like IOS)
export function evalAcl(dev, name, pkt, hits) {
  const acl = aclTable(dev)[name]
  if (!acl) return { permit: true }
  const real = acl.entries.filter((e) => !e.body.startsWith('remark'))
  if (!real.length) return { permit: true }
  for (const e of real) {
    const c = compileAce(e.body, acl.type)
    if (c && !c.remark && c.test(pkt)) {
      if (hits) hits[`${dev.id}|${name}|${e.seq}`] = (hits[`${dev.id}|${name}|${e.seq}`] ?? 0) + 1
      return { permit: c.action === 'permit', entry: e }
    }
  }
  return { permit: false, implicit: true }
}

// ======================================================================
// compute()
// ======================================================================

export function compute(lab) {
  const devs = lab.devices
  const byId = Object.fromEntries(devs.map((d) => [d.id, d]))
  const net = {
    lab, byId, devs,
    ifState: {}, // dev -> iface -> { status, protocol, reason }
    peerOf: {}, // "dev|iface" -> { dev, iface }
    sw: {}, // dev -> iface -> operational switchport info
    channels: [], // etherchannel groups
    stp: {}, // vlan -> { root, bridges }
    graph: new Map(), // nodeId -> [{ to, via }]
    comp: new Map(), // nodeId -> component id
    addrs: {}, // dev -> [{ iface, fam, addr, len, primary, kind }]
    routes: {}, // dev -> { 4: [], 6: [] }
    ospf: { ifaces: {}, neighbors: {}, rids: {} },
    hsrp: {}, // "dev|iface" -> [{ group, vip, state, priority, preempt, active, standby, version }]
    events: [],
  }

  // ---------- physical links ----------
  for (const [a, ai, b, bi] of lab.links) {
    net.peerOf[`${a}|${ai}`] = { dev: b, iface: bi }
    net.peerOf[`${b}|${bi}`] = { dev: a, iface: ai }
  }

  const adminUp = (dev, iface) => {
    if (!isIos(dev)) return true
    return !hasLine(ifaceLines(dev, iface), 'shutdown')
  }
  const errdis = (dev, iface) => isIos(dev) && dev.rt.errdisabled.includes(iface)

  // BPDU guard: an edge port with BPDU guard that hears a switch gets err-disabled
  for (const dev of devs) {
    if (!isSwitch(dev)) continue
    const globalGuard = hasLine(dev.config.global, 'spanning-tree portfast bpduguard default')
    for (const p of dev.ports) {
      const L = ifaceLines(dev, p)
      if (!adminUp(dev, p) || errdis(dev, p)) continue
      const fast = portfastOn(dev, p, swConfig(dev, p)?.mode)
      const guard = hasLine(L, 'spanning-tree bpduguard enable') || (fast && globalGuard)
      if (!guard || hasLine(L, 'spanning-tree bpduguard disable')) continue
      const peer = net.peerOf[`${dev.id}|${p}`]
      const pd = peer && byId[peer.dev]
      if (pd && isSwitch(pd) && adminUp(pd, peer.iface) && !errdis(pd, peer.iface) && swConfig(pd, peer.iface)?.mode !== 'routed') {
        dev.rt.errdisabled.push(p)
        net.events.push({ dev: dev.id, msg: `%SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port ${p} with BPDU Guard enabled. Disabling port.` })
        net.events.push({ dev: dev.id, msg: `%PM-4-ERR_DISABLE: bpduguard error detected on ${shortName(p)}, putting ${shortName(p)} in err-disable state` })
      }
    }
  }

  // Port security: a host whose MAC is not allowed on a full port causes a violation
  net.psDrop = new Set()
  for (const dev of devs) {
    if (!isSwitch(dev)) continue
    for (const p of dev.ports) {
      const L = ifaceLines(dev, p)
      if (!L.includes('switchport port-security') || !adminUp(dev, p) || errdis(dev, p)) continue
      const peer = net.peerOf[`${dev.id}|${p}`]
      const pd = peer && byId[peer.dev]
      if (!pd || isIos(pd)) continue
      const mac = macToStr(macBig(pd))
      const max = Number(lineValue(L, 'switchport port-security maximum') ?? 1)
      const secure = L.filter((l) => /^switchport port-security mac-address (sticky )?[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/.test(l)).map((l) => l.split(' ').pop())
      if (secure.includes(mac) || secure.length < max) continue
      const mode = lineValue(L, 'switchport port-security violation') ?? 'shutdown'
      dev.rt.psViolations ??= {}
      dev.rt.psLast ??= {}
      dev.rt.psLast[p] = mac
      if (mode === 'shutdown') {
        dev.rt.errdisabled.push(p)
        dev.rt.psViolations[p] = (dev.rt.psViolations[p] ?? 0) + 1
        net.events.push({ dev: dev.id, msg: `%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address ${mac} on port ${p}.` })
        net.events.push({ dev: dev.id, msg: `%PM-4-ERR_DISABLE: psecure-violation error detected on ${shortName(p)}, putting ${shortName(p)} in err-disable state` })
      } else {
        net.psDrop.add(`${dev.id}|${p}`)
        if (mode === 'restrict' && !dev.rt.psViolations[p]) {
          dev.rt.psViolations[p] = 1
          net.events.push({ dev: dev.id, msg: `%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address ${mac} on port ${p}.` })
        }
      }
    }
  }

  // ---------- interface states ----------
  for (const dev of devs) {
    net.ifState[dev.id] = {}
    const names = isIos(dev) ? interfaces(dev).filter(isPhysical) : dev.ports
    for (const ifc of names) net.ifState[dev.id][ifc] = physState(dev, ifc)
  }

  function physState(dev, ifc) {
    if (!adminUp(dev, ifc)) return { status: 'administratively down', protocol: 'down' }
    if (errdis(dev, ifc)) return { status: 'down', protocol: 'down', reason: 'err-disabled' }
    const peer = net.peerOf[`${dev.id}|${ifc}`]
    if (!peer) return { status: 'down', protocol: 'down', reason: 'notconnect' }
    const pd = byId[peer.dev]
    if (!adminUp(pd, peer.iface) || errdis(pd, peer.iface)) return { status: 'down', protocol: 'down', reason: 'notconnect' }
    const s1 = lineValue(ifaceLines(dev, ifc), 'speed')
    const s2 = isIos(pd) ? lineValue(ifaceLines(pd, peer.iface), 'speed') : undefined
    if (s1 && s2 && s1 !== 'auto' && s2 !== 'auto' && s1 !== s2) return { status: 'down', protocol: 'down', reason: 'speed mismatch' }
    const d1 = lineValue(ifaceLines(dev, ifc), 'duplex')
    const d2 = isIos(pd) ? lineValue(ifaceLines(pd, peer.iface), 'duplex') : undefined
    const mismatch = (d1 === 'half' && d2 !== 'half') || (d2 === 'half' && d1 !== 'half')
    return { status: 'up', protocol: 'up', duplexMismatch: mismatch }
  }

  const physUp = (devId, ifc) => net.ifState[devId]?.[ifc]?.protocol === 'up'

  // ---------- EtherChannel ----------
  const memberOf = {} // "dev|iface" -> group key
  for (const dev of devs) {
    if (!isSwitch(dev)) continue
    for (const p of dev.ports) {
      const v = lineValue(ifaceLines(dev, p), 'channel-group')
      if (!v) continue
      const [num, , mode] = v.split(' ')
      memberOf[`${dev.id}|${p}`] = { dev: dev.id, po: `Port-channel${num}`, mode, iface: p }
    }
  }
  const compat = (a, b) => {
    const lacp = ['active', 'passive']
    const pagp = ['desirable', 'auto']
    if (a === 'on' || b === 'on') return a === b ? 'on' : 'mismatch'
    if (lacp.includes(a) && lacp.includes(b)) return a === 'passive' && b === 'passive' ? 'standalone' : 'LACP'
    if (pagp.includes(a) && pagp.includes(b)) return a === 'auto' && b === 'auto' ? 'standalone' : 'PAgP'
    return 'mismatch'
  }
  const memberSig = (dev, p) => ifaceLines(dev, p).filter((l) => l.startsWith('switchport') || l.startsWith('speed') || l.startsWith('duplex')).sort().join('|')
  const groups = {}
  for (const m of Object.values(memberOf)) {
    const key = `${m.dev}|${m.po}`
    groups[key] ??= { dev: m.dev, po: m.po, members: [] }
    groups[key].members.push(m)
  }
  const bundled = new Set() // "dev|iface" of bundled members
  for (const g of Object.values(groups)) {
    const dev = byId[g.dev]
    const ref = memberSig(dev, g.members[0].iface)
    g.flags = {}
    g.protocol = '-'
    for (const m of g.members) {
      const peer = net.peerOf[`${g.dev}|${m.iface}`]
      if (!physUp(g.dev, m.iface)) { g.flags[m.iface] = 'D'; continue }
      const pm = peer && memberOf[`${peer.dev}|${peer.iface}`]
      if (memberSig(dev, m.iface) !== ref) { g.flags[m.iface] = 's'; continue }
      if (!pm) { g.flags[m.iface] = m.mode === 'on' ? 'P' : 'I'; if (m.mode === 'on') bundled.add(`${g.dev}|${m.iface}`); continue }
      const c = compat(m.mode, pm.mode)
      if (c === 'mismatch') g.flags[m.iface] = 's'
      else if (c === 'standalone') g.flags[m.iface] = 'I'
      else {
        const pdev = byId[pm.dev]
        if (memberSig(pdev, pm.iface) !== memberSig(pdev, groups[`${pm.dev}|${pm.po}`].members[0].iface)) { g.flags[m.iface] = 's'; continue }
        g.flags[m.iface] = 'P'
        g.protocol = c === 'on' ? '-' : c
        bundled.add(`${g.dev}|${m.iface}`)
      }
    }
    g.up = Object.values(g.flags).includes('P')
    net.channels.push(g)
  }
  // Port-channel interface states
  for (const g of net.channels) {
    const dev = byId[g.dev]
    const st = !adminUp(dev, g.po) ? { status: 'administratively down', protocol: 'down' } : g.up ? { status: 'up', protocol: 'up' } : { status: 'down', protocol: 'down' }
    net.ifState[g.dev][g.po] = st
  }

  // ---------- logical links (bundles collapse into one) ----------
  const logical = []
  const seenPo = new Set()
  for (const [a, ai, b, bi] of lab.links) {
    if (!physUp(a, ai) || !physUp(b, bi)) continue
    const ka = `${a}|${ai}`
    const kb = `${b}|${bi}`
    const ma = memberOf[ka]
    const mb = memberOf[kb]
    if (ma || mb) {
      if (bundled.has(ka) && bundled.has(kb)) {
        const key = [`${a}|${ma.po}`, `${b}|${mb.po}`].sort().join('~')
        if (seenPo.has(key)) continue
        seenPo.add(key)
        logical.push({ a: { dev: a, iface: ma.po }, b: { dev: b, iface: mb.po } })
        continue
      }
      const fa = ma ? groups[`${a}|${ma.po}`].flags[ai] : null
      const fb = mb ? groups[`${b}|${mb.po}`].flags[bi] : null
      if (fa === 's' || fb === 's' || fa === 'P' || fb === 'P') continue // suspended or one-sided bundle
    }
    logical.push({ a: { dev: a, iface: ai }, b: { dev: b, iface: bi } })
  }
  net.logical = logical
  const logicalPeer = {}
  for (const l of logical) {
    logicalPeer[`${l.a.dev}|${l.a.iface}`] = l.b
    logicalPeer[`${l.b.dev}|${l.b.iface}`] = l.a
  }
  net.logicalPeer = logicalPeer

  // ---------- operational switchport mode (DTP) ----------
  for (const dev of devs) {
    if (!isSwitch(dev)) continue
    net.sw[dev.id] = {}
    const ports = [...dev.ports.filter((p) => !memberOf[`${dev.id}|${p}`] || !bundled.has(`${dev.id}|${p}`)), ...net.channels.filter((g) => g.dev === dev.id).map((g) => g.po)]
    for (const p of ports) {
      const cfg = swConfig(dev, p)
      if (!cfg) continue
      if (cfg.mode === 'routed') { net.sw[dev.id][p] = { mode: 'routed' }; continue }
      const peer = logicalPeer[`${dev.id}|${p}`]
      const pdev = peer && byId[peer.dev]
      const pcfg = pdev && isSwitch(pdev) ? swConfig(pdev, peer.iface) : null
      let oper = 'access'
      if (cfg.mode === 'trunk') oper = 'trunk'
      else if (cfg.mode === 'access') oper = 'access'
      else if (pcfg && pcfg.mode !== 'routed') {
        const peerSends = (pcfg.mode === 'trunk' || pcfg.mode === 'dynamic desirable') && !pcfg.nonegotiate
        if (cfg.mode === 'dynamic desirable' && (pcfg.mode === 'dynamic auto' || peerSends)) oper = 'trunk'
        else if (cfg.mode === 'dynamic auto' && peerSends) oper = 'trunk'
      }
      net.sw[dev.id][p] = { ...cfg, oper, admin: cfg.mode }
    }
  }

  // CDP notices trunks whose two ends disagree on the native VLAN, and duplex mismatches
  net.cdpNotices = []
  const cdpOn = (d, i) => isIos(d) && !hasLine(d.config.global, 'no cdp run') && !hasLine(ifaceLines(d, i), 'no cdp enable')
  for (const l of logical) {
    const A = net.sw[l.a.dev]?.[l.a.iface]
    const B = net.sw[l.b.dev]?.[l.b.iface]
    if (A?.oper !== 'trunk' || B?.oper !== 'trunk' || A.native === B.native) continue
    if (!cdpOn(byId[l.a.dev], l.a.iface) || !cdpOn(byId[l.b.dev], l.b.iface)) continue
    for (const [x, y, X, Y] of [[l.a, l.b, A, B], [l.b, l.a, B, A]]) {
      net.cdpNotices.push({ key: `${x.dev}|${x.iface}|native`, dev: x.dev, msg: `%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on ${x.iface} (${X.native}), with ${hostname(byId[y.dev])} ${y.iface} (${Y.native}).` })
    }
  }
  for (const [a, ai, b, bi] of lab.links) {
    if (!net.ifState[a]?.[ai]?.duplexMismatch || !cdpOn(byId[a], ai) || !cdpOn(byId[b], bi)) continue
    for (const [x, xi, y, yi] of [[a, ai, b, bi], [b, bi, a, ai]]) {
      const half = lineValue(ifaceLines(byId[x], xi), 'duplex') === 'half'
      net.cdpNotices.push({ key: `${x}|${xi}|duplex`, dev: x, msg: `%CDP-4-DUPLEX_MISMATCH: duplex mismatch discovered on ${xi} (not ${half ? 'full' : 'half'} duplex), with ${hostname(byId[y])} ${yi} (${half ? 'full' : 'half'} duplex).` })
    }
  }

  // ---------- STP per VLAN ----------
  const vlans = new Set()
  for (const dev of devs) if (isSwitch(dev)) for (const v of vlanDb(dev).keys()) vlans.add(v)

  // Does a switch port carry vlan v (and map it to vlan w on the far side)?
  const carries = (devId, port, v) => {
    const s = net.sw[devId]?.[port]
    if (!s || s.mode === 'routed') return false
    if (!vlanDb(byId[devId]).has(v)) return false
    if (s.oper === 'access') return s.accessVlan === v
    return allows(s.allowed, v)
  }

  for (const v of vlans) {
    const bridges = {}
    for (const dev of devs) {
      if (!isSwitch(dev) || !vlanDb(dev).has(v)) continue
      const prio = vlanPriority(dev, v)
      bridges[dev.id] = { id: dev.id, prio, bid: prio + v, mac: macBig(dev), ports: {}, rootCost: Infinity, rootPort: null }
      for (const p of Object.keys(net.sw[dev.id] ?? {})) {
        if (!carries(dev.id, p, v) || net.ifState[dev.id][p]?.protocol !== 'up') continue
        const L = ifaceLines(dev, p)
        const costLine = lineValue(L, 'spanning-tree cost')
        const cost = costLine ? Number(costLine) : (p.startsWith('Port-channel') ? 3 : stpCost(p))
        const prioLine = lineValue(L, 'spanning-tree port-priority')
        const num = p.startsWith('Port-channel') ? 64 + Number(p.slice(12)) : dev.ports.indexOf(p) + 1
        const portfast = portfastOn(dev, p, net.sw[dev.id][p].oper)
        bridges[dev.id].ports[p] = { cost, pid: (prioLine ? Number(prioLine) : 128) * 1000 + num, prio: prioLine ? Number(prioLine) : 128, num, role: 'Desg', state: 'FWD', portfast, guardRoot: lineValue(L, 'spanning-tree guard') === 'root', guardLoop: lineValue(L, 'spanning-tree guard') === 'loop' }
      }
    }
    const brokenRootGuard = new Set()
    // Switch-to-switch adjacencies in this VLAN
    const adj = () => {
      const out = []
      for (const l of logical) {
        const A = bridges[l.a.dev]
        const B = bridges[l.b.dev]
        if (!A || !B || !A.ports[l.a.iface] || !B.ports[l.b.iface]) continue
        if (brokenRootGuard.has(`${l.a.dev}|${l.a.iface}`) || brokenRootGuard.has(`${l.b.dev}|${l.b.iface}`)) continue
        out.push(l)
      }
      return out
    }
    const better = (x, y) => (x.bid !== y.bid ? x.bid < y.bid : x.mac < y.mac)
    let rootId = null
    for (let pass = 0; pass < 4; pass++) {
      const links = adj()
      // connected components via BFS, root per component = best bridge
      const comp = {}
      const ids = Object.keys(bridges)
      for (const id of ids) {
        if (comp[id] !== undefined) continue
        const q = [id]
        comp[id] = id
        while (q.length) {
          const x = q.shift()
          for (const l of links) {
            const y = l.a.dev === x ? l.b.dev : l.b.dev === x ? l.a.dev : null
            if (y && comp[y] === undefined) { comp[y] = id; q.push(y) }
          }
        }
      }
      const roots = {}
      for (const id of ids) {
        const c = comp[id]
        if (!roots[c] || better(bridges[id], bridges[roots[c]])) roots[c] = id
      }
      for (const id of ids) {
        const b = bridges[id]
        b.root = roots[comp[id]]
        b.rootCost = id === b.root ? 0 : Infinity
        b.rootPort = null
        for (const p of Object.values(b.ports)) { p.role = 'Desg'; p.state = 'FWD' }
      }
      // Bellman-Ford style relaxation (small graphs)
      for (let i = 0; i < ids.length + 1; i++) {
        for (const l of links) {
          for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) {
            const X = bridges[x.dev]
            const Y = bridges[y.dev]
            if (X.root !== Y.root || x.dev === X.root) continue
            const c = Y.rootCost + X.ports[x.iface].cost
            const cand = [c, Y.bid, Y.mac, Y.ports[y.iface].pid]
            const cur = X._best
            if (!cur || lexLess(cand, cur)) { X._best = cand; X.rootCost = c; X.rootPort = x.iface }
          }
        }
      }
      for (const id of ids) delete bridges[id]._best
      // Port roles
      for (const l of links) {
        const A = bridges[l.a.dev]
        const B = bridges[l.b.dev]
        const va = [A.rootCost, A.bid, A.mac, A.ports[l.a.iface].pid]
        const vb = [B.rootCost, B.bid, B.mac, B.ports[l.b.iface].pid]
        const [winner, loser] = lexLess(va, vb) ? [l.a, l.b] : [l.b, l.a]
        bridges[winner.dev].ports[winner.iface].role = 'Desg'
        const L = bridges[loser.dev]
        if (L.rootPort === loser.iface) L.ports[loser.iface].role = 'Root'
        else { L.ports[loser.iface].role = 'Altn'; L.ports[loser.iface].state = 'BLK' }
        A.ports[l.a.iface].p2p = true
        B.ports[l.b.iface].p2p = true
      }
      // Root guard: a guarded port that would become root port goes root-inconsistent
      let changed = false
      for (const b of Object.values(bridges)) {
        if (b.rootPort && b.ports[b.rootPort].guardRoot && !brokenRootGuard.has(`${b.id}|${b.rootPort}`)) {
          brokenRootGuard.add(`${b.id}|${b.rootPort}`)
          changed = true
        }
      }
      rootId = Object.values(bridges)[0]?.root
      if (!changed) break
    }
    for (const key of brokenRootGuard) {
      const [d, p] = key.split('|')
      if (bridges[d]?.ports[p]) { bridges[d].ports[p].role = 'Desg'; bridges[d].ports[p].state = 'BKN'; bridges[d].ports[p].inconsistent = 'ROOT_Inc' }
    }
    net.stp[v] = { bridges, root: rootId }
  }

  const stpFwd = (devId, port, v) => {
    const p = net.stp[v]?.bridges[devId]?.ports[port]
    return !p || p.state === 'FWD'
  }

  // ---------- L2 graph ----------
  const G = net.graph
  const addEdge = (x, y, via) => {
    if (!G.has(x)) G.set(x, [])
    if (!G.has(y)) G.set(y, [])
    G.get(x).push({ to: y, via })
    G.get(y).push({ to: x, via })
  }
  const node = (devId, iface) => `I|${devId}|${iface}`
  const vnode = (devId, v) => `S|${devId}|${v}`

  // What a link end offers: { untagged: node|null, tagged: Map(vlan -> node) }
  const endpoint = (devId, port) => {
    const dev = byId[devId]
    const s = net.sw[devId]?.[port]
    const out = { untagged: null, tagged: new Map(), switchPort: !!s && s.mode !== 'routed' }
    if (s && s.mode !== 'routed') {
      const db = vlanDb(dev)
      if (net.psDrop?.has(`${devId}|${port}`)) return out
      if (s.oper === 'access') {
        if (db.has(s.accessVlan) && stpFwd(devId, port, s.accessVlan)) out.untagged = vnode(devId, s.accessVlan)
        if (s.voiceVlan && db.has(s.voiceVlan)) out.tagged.set(s.voiceVlan, vnode(devId, s.voiceVlan))
      } else {
        for (const v of db.keys()) {
          if (!allows(s.allowed, v) || !stpFwd(devId, port, v)) continue
          if (v === s.native) out.untagged = vnode(devId, v)
          else out.tagged.set(v, vnode(devId, v))
        }
      }
      return out
    }
    // Routed end (router, routed switch port, host NIC)
    if (isIos(dev)) {
      const subs = interfaces(dev).filter((i) => isSubif(i) && parentOf(i) === port)
      let nativeSub = null
      for (const sub of subs) {
        if (!adminUp(dev, sub)) continue
        const enc = lineValue(ifaceLines(dev, sub), 'encapsulation dot1Q') ?? lineValue(ifaceLines(dev, sub), 'encapsulation dot1q')
        if (!enc) continue
        const [vid, native] = enc.split(' ')
        if (native === 'native') nativeSub = sub
        else out.tagged.set(Number(vid), node(devId, sub))
      }
      out.untagged = node(devId, nativeSub ?? port)
    } else out.untagged = node(devId, port)
    return out
  }

  for (const l of logical) {
    const A = endpoint(l.a.dev, l.a.iface)
    const B = endpoint(l.b.dev, l.b.iface)
    const via = { a: l.a, b: l.b }
    if (A.untagged && B.untagged) addEdge(A.untagged, B.untagged, via)
    for (const [v, n] of A.tagged) if (B.tagged.has(v)) addEdge(n, B.tagged.get(v), via)
  }
  // Loopbacks and every L3 interface exist as nodes even if isolated
  for (const dev of devs) for (const i of (isIos(dev) ? interfaces(dev) : dev.ports)) if (!G.has(node(dev.id, i))) G.set(node(dev.id, i), [])

  // SVIs
  for (const dev of devs) {
    if (!isSwitch(dev)) continue
    const db = vlanDb(dev)
    for (const ifc of interfaces(dev)) {
      if (ifaceType(ifc) !== 'Vlan') continue
      const v = Number(ifc.slice(4))
      if (!adminUp(dev, ifc)) { net.ifState[dev.id][ifc] = { status: 'administratively down', protocol: 'down' }; continue }
      const hasPort = db.has(v) && (G.get(vnode(dev.id, v)) ?? []).length > 0
      net.ifState[dev.id][ifc] = hasPort ? { status: 'up', protocol: 'up' } : { status: 'up', protocol: 'down' }
      if (hasPort) addEdge(node(dev.id, ifc), vnode(dev.id, v), { svi: true })
    }
  }
  // Subinterfaces & loopbacks state
  for (const dev of devs) {
    if (!isIos(dev)) continue
    for (const ifc of interfaces(dev)) {
      const t = ifaceType(ifc)
      if (isSubif(ifc)) {
        const parent = net.ifState[dev.id][parentOf(ifc)]
        net.ifState[dev.id][ifc] = !adminUp(dev, ifc) ? { status: 'administratively down', protocol: 'down' } : parent?.protocol === 'up' ? { status: 'up', protocol: 'up' } : { status: 'down', protocol: 'down' }
      } else if (t === 'Loopback') {
        net.ifState[dev.id][ifc] = adminUp(dev, ifc) ? { status: 'up', protocol: 'up' } : { status: 'administratively down', protocol: 'down' }
      }
    }
  }

  // Components
  let cid = 0
  for (const start of G.keys()) {
    if (net.comp.has(start)) continue
    cid++
    const q = [start]
    net.comp.set(start, cid)
    while (q.length) {
      const x = q.shift()
      for (const e of G.get(x)) if (!net.comp.has(e.to)) { net.comp.set(e.to, cid); q.push(e.to) }
    }
  }

  // Sticky MAC learning for port security
  for (const dev of devs) {
    if (!isSwitch(dev)) continue
    for (const p of dev.ports) {
      const L = ifaceLines(dev, p)
      if (!L.includes('switchport port-security') || !L.includes('switchport port-security mac-address sticky')) continue
      if (L.some((l) => /^switchport port-security mac-address sticky [0-9a-f.]+$/.test(l))) continue
      const peer = net.peerOf[`${dev.id}|${p}`]
      const pd = peer && byId[peer.dev]
      if (pd && !isIos(pd) && physUp(dev.id, p)) {
        L.push(`switchport port-security mac-address sticky ${macToStr(macBig(pd))}`)
      }
    }
  }

  // ---------- L3 addresses ----------
  for (const dev of devs) {
    const list = []
    net.addrs[dev.id] = list
    if (!isIos(dev)) {
      const h = dev.host
      const p = dev.ports[0]
      const lease = h.dhcp ? h.lease : null
      const ip = lease ? lease.ip : h.ip
      const mask = lease ? lease.mask : h.mask
      if (ip && mask) list.push({ iface: p, fam: 4, addr: parseV4(ip), len: maskToLen(mask), primary: true })
      if (h.ipv6 === 'auto') {
        const ra = findRa(net, dev.id, p)
        if (ra) list.push({ iface: p, fam: 6, addr: ra.prefix | eui64(macBig(dev)), len: 64, auto: true })
      } else if (h.ipv6) {
        const pr = parseV6Prefix(h.ipv6)
        if (pr) list.push({ iface: p, fam: 6, addr: pr.addr, len: pr.len })
      }
      if (h.ipv6 || h.ipv6gw) list.push({ iface: p, fam: 6, addr: LINK_LOCAL_PREFIX | eui64(macBig(dev)), len: 64, linkLocal: true })
      continue
    }
    for (const ifc of interfaces(dev)) {
      const L = ifaceLines(dev, ifc)
      if (isSwitch(dev) && isPhysical(ifc) && swConfig(dev, ifc)?.mode !== 'routed') continue
      if (isSwitch(dev) && ifc.startsWith('Port-channel') && swConfig(dev, ifc)?.mode !== 'routed') continue
      for (const l of L) {
        let m = /^ip address (\S+) (\S+)( secondary)?$/.exec(l)
        if (m) list.push({ iface: ifc, fam: 4, addr: parseV4(m[1]), len: maskToLen(m[2]), primary: !m[3] })
        if (l === 'ip address dhcp' && dev.rt.dhcpClient?.[ifc]) {
          const ls = dev.rt.dhcpClient[ifc]
          list.push({ iface: ifc, fam: 4, addr: parseV4(ls.ip), len: maskToLen(ls.mask), primary: true, dhcp: true })
        }
        m = /^ipv6 address (\S+)\/(\d+)( eui-64)?$/.exec(l)
        if (m) {
          const base = parseV6(m[1])
          if (base !== null) {
            const len = Number(m[2])
            const addr = m[3] ? networkOf(6, base, len) | eui64(ifaceMac(dev, ifc)) : base
            list.push({ iface: ifc, fam: 6, addr, len, eui: !!m[3] })
          }
        }
        m = /^ipv6 address (\S+) link-local$/.exec(l)
        if (m) list.push({ iface: ifc, fam: 6, addr: parseV6(m[1]), len: 64, linkLocal: true, manual: true })
      }
      const v6 = list.some((a) => a.iface === ifc && a.fam === 6) || hasLine(L, 'ipv6 enable')
      if (v6 && !list.some((a) => a.iface === ifc && a.linkLocal)) list.push({ iface: ifc, fam: 6, addr: LINK_LOCAL_PREFIX | eui64(ifaceMac(dev, ifc)), len: 64, linkLocal: true })
    }
  }

  // ---------- HSRP ----------
  computeHsrp(net)

  // ---------- routing ----------
  for (const dev of devs) net.routes[dev.id] = baseRoutes(net, dev)
  computeOspf(net)
  for (const dev of devs) {
    const extra = net.ospf.routes?.[dev.id] ?? []
    net.routes[dev.id][4] = selectRoutes([...net.routes[dev.id]._cand4, ...extra])
    net.routes[dev.id][6] = selectRoutes(net.routes[dev.id]._cand6)
  }
  return net
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return true
    if (a[i] > b[i]) return false
  }
  return false
}

export const shortName = (n) => n.replace('GigabitEthernet', 'Gi').replace('FastEthernet', 'Fa').replace('Port-channel', 'Po').replace('Loopback', 'Lo').replace('Vlan', 'Vl')

// ---------- helpers on a computed net ----------

export const ifUp = (net, devId, ifc) => net.ifState[devId]?.[ifc]?.protocol === 'up'
export const nodeId = (devId, ifc) => `I|${devId}|${ifc}`
export const segOf = (net, devId, ifc) => (ifUp(net, devId, ifc) ? net.comp.get(nodeId(devId, ifc)) : undefined)

// All L3 endpoints in the same segment: [{ dev, iface }]
export function segMembers(net, seg) {
  const out = []
  if (seg === undefined) return out
  for (const [n, c] of net.comp) {
    if (c !== seg || !n.startsWith('I|')) continue
    const [, dev, iface] = n.split('|')
    if (ifUp(net, dev, iface)) out.push({ dev, iface })
  }
  return out
}

export const usableAddrs = (net, devId) => (net.addrs[devId] ?? []).filter((a) => ifUp(net, devId, a.iface))

function routesEnabled(dev, fam) {
  if (dev.kind === 'router') return fam === 4 || hasLine(dev.config.global, 'ipv6 unicast-routing')
  if (dev.kind === 'l3switch') return fam === 4 ? hasLine(dev.config.global, 'ip routing') : hasLine(dev.config.global, 'ipv6 unicast-routing')
  return false
}
export { routesEnabled }

// Find a router advertising a /64 on this host's segment (SLAAC)
function findRa(net, devId, ifc) {
  // Hosts are computed before routers' addresses in some orders; scan configs directly
  const seg = net.comp.get(nodeId(devId, ifc))
  for (const m of segMembers(net, seg)) {
    const d = net.byId[m.dev]
    if (!isIos(d) || !hasLine(d.config.global, 'ipv6 unicast-routing')) continue
    for (const l of ifaceLines(d, m.iface)) {
      const mm = /^ipv6 address (\S+)\/64/.exec(l)
      if (mm) {
        const a = parseV6(mm[1])
        if (a !== null) return { prefix: networkOf(6, a, 64), router: m.dev, iface: m.iface }
      }
    }
  }
  return null
}
export { findRa }

function computeHsrp(net) {
  const lab = net.lab
  lab.rt ??= {}
  lab.rt.hsrp ??= {}
  const groups = {} // "seg|group" -> members
  for (const dev of net.devs) {
    if (!isIos(dev)) continue
    for (const ifc of interfaces(dev)) {
      const L = ifaceLines(dev, ifc).filter((l) => l.startsWith('standby'))
      if (!L.length) continue
      const version = hasLine(L, 'standby version 2') ? 2 : 1
      const byGroup = {}
      for (const l of L) {
        const m = /^standby (?:(\d+) )?(ip|priority|preempt)(?: (\S+))?/.exec(l)
        if (!m) continue
        const g = Number(m[1] ?? 0)
        byGroup[g] ??= { group: g, priority: 100, preempt: false, vip: null }
        if (m[2] === 'ip') byGroup[g].vip = m[3]
        if (m[2] === 'priority') byGroup[g].priority = Number(m[3])
        if (m[2] === 'preempt') byGroup[g].preempt = true
      }
      const seg = segOf(net, dev.id, ifc)
      const own = (net.addrs[dev.id] ?? []).find((a) => a.iface === ifc && a.fam === 4 && a.primary)
      for (const g of Object.values(byGroup)) {
        const entry = { ...g, dev: dev.id, iface: ifc, version, up: seg !== undefined && !!own, ip: own?.addr ?? 0n, seg }
        net.hsrp[`${dev.id}|${ifc}`] ??= []
        net.hsrp[`${dev.id}|${ifc}`].push(entry)
        if (entry.up) {
          // HSRPv1 and v2 use different multicast groups, so routers on different versions never see each other
          const key = `${seg}|${g.group}|v${version}`
          groups[key] ??= []
          groups[key].push(entry)
        }
      }
    }
  }
  for (const [key, members] of Object.entries(groups)) {
    const rank = (x) => [x.priority, x.ip]
    const sorted = [...members].sort((a, b) => (lexLess(rank(a), rank(b)) ? 1 : -1))
    const prevId = lab.rt.hsrp[key]
    let active = members.find((m) => `${m.dev}|${m.iface}` === prevId)
    if (!active) active = sorted[0]
    else {
      const challenger = sorted.find((m) => m.preempt && lexLess(rank(active), rank(m)))
      if (challenger) active = challenger
    }
    lab.rt.hsrp[key] = `${active.dev}|${active.iface}`
    const standby = sorted.find((m) => m !== active)
    const vip = members.find((m) => m.vip)?.vip ?? null
    for (const m of members) {
      m.state = m === active ? 'Active' : m === standby ? 'Standby' : 'Listen'
      m.activeIp = active.ip
      m.standbyIp = standby?.ip ?? null
      m.vipResolved = vip
    }
  }
  for (const list of Object.values(net.hsrp)) for (const m of list) if (!m.state) m.state = m.up ? 'Init' : 'Init'
}

// Is `addr` (fam 4) owned by dev on this interface, including HSRP VIP and NAT pools?
export function ownsAddr(net, devId, ifc, fam, addr) {
  if (usableAddrs(net, devId).some((a) => a.iface === ifc && a.fam === fam && a.addr === addr)) return 'self'
  if (fam === 4) {
    for (const g of net.hsrp[`${devId}|${ifc}`] ?? []) if (g.state === 'Active' && g.vipResolved && parseV4(g.vipResolved) === addr) return 'vip'
    const dev = net.byId[devId]
    if (isIos(dev) && hasLine(ifaceLines(dev, ifc), 'ip nat outside')) {
      for (const p of natPools(dev)) if (addr >= p.start && addr <= p.end) return 'nat'
      for (const s of natStatics(dev)) if (s.global === addr) return 'nat'
    }
  }
  return null
}

export function natPools(dev) {
  return globalLines(dev, 'ip nat pool').map((l) => {
    const m = /^ip nat pool (\S+) (\S+) (\S+)/.exec(l)
    return m ? { name: m[1], start: parseV4(m[2]), end: parseV4(m[3]) } : null
  }).filter(Boolean)
}
export function natStatics(dev) {
  return globalLines(dev, 'ip nat inside source static').map((l) => {
    const m = /^ip nat inside source static (\S+) (\S+)/.exec(l)
    return m ? { local: parseV4(m[1]), global: parseV4(m[2]) } : null
  }).filter(Boolean)
}

// ---------- routing tables ----------

function baseRoutes(net, dev) {
  const cand4 = []
  const cand6 = []
  const addrs = usableAddrs(net, dev.id)
  const routing4 = routesEnabled(dev, 4)
  const routing6 = routesEnabled(dev, 6)
  for (const a of addrs) {
    if (a.fam === 4) {
      const len = a.len
      cand4.push({ fam: 4, net: networkOf(4, a.addr, len), len, code: 'C', ad: 0, metric: 0, hops: [{ iface: a.iface }] })
      if (isIos(dev)) cand4.push({ fam: 4, net: a.addr, len: 32, code: 'L', ad: 0, metric: 0, hops: [{ iface: a.iface }] })
    } else if (!a.linkLocal) {
      cand6.push({ fam: 6, net: networkOf(6, a.addr, a.len), len: a.len, code: 'C', ad: 0, metric: 0, hops: [{ iface: a.iface }] })
      if (isIos(dev)) cand6.push({ fam: 6, net: a.addr, len: 128, code: 'L', ad: 0, metric: 0, hops: [{ iface: a.iface }] })
    }
  }
  const connected4 = cand4.filter((r) => r.code === 'C')
  const connected6 = cand6.filter((r) => r.code === 'C')
  const onLink = (list, fam, addr) => list.find((r) => networkOf(fam, addr, r.len) === r.net)

  if (!isIos(dev)) {
    const h = dev.host
    const gw = h.dhcp ? h.lease?.gw : h.gw
    if (gw) {
      const g = parseV4(gw)
      const c = g !== null && onLink(connected4, 4, g)
      if (c) cand4.push({ fam: 4, net: 0n, len: 0, code: 'S*', ad: 1, metric: 0, hops: [{ ip: g, iface: c.hops[0].iface }] })
    }
    let gw6 = h.ipv6gw
    if (h.ipv6 === 'auto') {
      const ra = findRa(net, dev.id, dev.ports[0])
      if (ra) {
        const rd = net.byId[ra.router]
        const ll = (net.addrs[rd.id] ?? []).find((a) => a.iface === ra.iface && a.linkLocal)
        if (ll) gw6 = ll.addr
      }
    } else if (gw6) gw6 = parseV6(gw6)
    if (gw6 !== null && gw6 !== undefined) cand6.push({ fam: 6, net: 0n, len: 0, code: 'S*', ad: 1, metric: 0, hops: [{ ip: gw6, iface: dev.ports[0] }] })
    return { _cand4: cand4, _cand6: cand6, 4: [], 6: [] }
  }

  if (!routing4) {
    const gw = lineValue(dev.config.global, 'ip default-gateway')
    if (gw) {
      const g = parseV4(gw)
      const c = g !== null && onLink(connected4, 4, g)
      if (c) cand4.push({ fam: 4, net: 0n, len: 0, code: 'S*', ad: 1, metric: 0, hops: [{ ip: g, iface: c.hops[0].iface }], gateway: true })
    }
  } else {
    for (const l of globalLines(dev, 'ip route ')) {
      const r = parseStatic4(dev, l)
      if (!r) continue
      const hop = {}
      if (r.iface) {
        if (!ifUp(net, dev.id, r.iface)) continue
        hop.iface = r.iface
      }
      if (r.nh !== undefined) hop.ip = r.nh
      if (!r.iface) {
        // recursive: next hop must be on a connected network (one level of recursion is enough for labs)
        const c = onLink(connected4, 4, r.nh)
        if (!c) continue
        hop.iface = c.hops[0].iface
      }
      cand4.push({ fam: 4, net: r.net, len: r.len, code: r.len === 0 ? 'S*' : 'S', ad: r.ad, metric: 0, hops: [hop], ifaceOnly: !!r.iface && r.nh === undefined, ifaceOnlyNh: !!r.iface && r.nh !== undefined })
    }
  }
  if (routing6) {
    for (const l of globalLines(dev, 'ipv6 route ')) {
      const r = parseStatic6(dev, l)
      if (!r) continue
      const hop = {}
      if (r.iface) { if (!ifUp(net, dev.id, r.iface)) continue; hop.iface = r.iface }
      if (r.nh !== undefined) hop.ip = r.nh
      if (!r.iface) {
        const c = onLink(connected6, 6, r.nh)
        if (!c) continue
        hop.iface = c.hops[0].iface
      } else if (r.nh !== undefined && (r.nh >> 118n) !== (0xfe80n >> 6n) && !onLink(connected6, 6, r.nh)) {
        // global next hop with interface: fine as long as interface is up
      }
      cand6.push({ fam: 6, net: r.net, len: r.len, code: r.len === 0 ? 'S' : 'S', ad: r.ad, metric: 0, hops: [hop] })
    }
  }
  return { _cand4: cand4, _cand6: cand6, 4: [], 6: [] }
}

export function parseStatic4(dev, line) {
  const t = tokens(line).slice(2)
  const n = parseV4(t[0])
  const len = maskToLen(t[1])
  if (n === null || len === null) return null
  const r = { net: networkOf(4, n, len), len, ad: 1, rawNet: n }
  let i = 2
  if (t[i] && /^[A-Za-z]/.test(t[i]) && t[i] !== 'permanent' && t[i] !== 'name') { r.iface = t[i]; i++ }
  if (t[i] && parseV4(t[i]) !== null) { r.nh = parseV4(t[i]); i++ }
  if (t[i] && /^\d+$/.test(t[i])) { r.ad = Number(t[i]); i++ }
  if (r.iface === undefined && r.nh === undefined) return null
  return r
}

export function parseStatic6(dev, line) {
  const t = tokens(line).slice(2)
  const p = parseV6Prefix(t[0])
  if (!p) return null
  const r = { net: networkOf(6, p.addr, p.len), len: p.len, ad: 1 }
  let i = 1
  if (t[i] && /^[A-Za-z]/.test(t[i]) && !/^[0-9a-fA-F:]+$/.test(t[i])) { r.iface = t[i]; i++ }
  if (t[i] && parseV6(t[i]) !== null) { r.nh = parseV6(t[i]); i++ }
  if (t[i] && /^\d+$/.test(t[i])) { r.ad = Number(t[i]); i++ }
  if (r.iface === undefined && r.nh === undefined) return null
  return r
}

function selectRoutes(cands) {
  const best = new Map()
  for (const r of cands) {
    const key = `${r.net}/${r.len}`
    const cur = best.get(key)
    if (!cur || r.ad < cur.ad || (r.ad === cur.ad && r.metric < cur.metric)) best.set(key, { ...r, hops: [...r.hops] })
    else if (r.ad === cur.ad && r.metric === cur.metric && r.code === cur.code && r.code !== 'L' && r.code !== 'C') cur.hops.push(...r.hops)
  }
  return [...best.values()]
}

// Longest-prefix lookup. Returns the route or null.
export function lookup(net, devId, fam, addr) {
  const table = net.routes[devId]?.[fam] ?? []
  let best = null
  for (const r of table) {
    if (networkOf(fam, addr, r.len) !== r.net) continue
    if (!best || r.len > best.len) best = r
  }
  return best
}

// ======================================================================
// OSPF
// ======================================================================

export function ospfProcess(dev) {
  const s = sectionsOf(dev, 'router ospf ')[0]
  if (!s) return null
  return { pid: Number(s.head.slice(12)), lines: s.lines }
}

// "0.0.0.1" and "1" are the same area
const areaId = (a) => (/^\d+$/.test(a) ? String(Number(a)) : String(parseV4(a) ?? a))

function computeOspf(net) {
  const O = net.ospf
  O.routes = {}
  const enabled = {} // devId -> [{ iface, area, addr, len, cost, hello, dead, type, prio, passive }]
  for (const dev of net.devs) {
    if (!isIos(dev)) continue
    const proc = ospfProcess(dev)
    if (!proc || !routesEnabled(dev, 4)) { dev.rt.ospfStarted = false; continue }
    const addrs = usableAddrs(net, dev.id).filter((a) => a.fam === 4 && a.primary)
    // Router ID
    const ridLine = lineValue(proc.lines, 'router-id')
    let rid = ridLine ? parseV4(ridLine) : null
    if (rid === null) {
      const loops = addrs.filter((a) => a.iface.startsWith('Loopback')).map((a) => a.addr)
      const all = addrs.map((a) => a.addr)
      rid = loops.length ? loops.reduce((x, y) => (y > x ? y : x)) : all.length ? all.reduce((x, y) => (y > x ? y : x)) : null
    }
    if (!dev.rt.ospfStarted) {
      if (rid === null) continue
      dev.rt.ospfRid = v4ToStr(rid)
      dev.rt.ospfStarted = true
    }
    O.rids[dev.id] = parseV4(dev.rt.ospfRid)
    const refbw = Number(lineValue(proc.lines, 'auto-cost reference-bandwidth') ?? 100)
    const passiveDefault = hasLine(proc.lines, 'passive-interface default')
    const networks = proc.lines.map((l) => /^network (\S+) (\S+) area (\S+)$/.exec(l)).filter(Boolean)
      .map((m) => ({ addr: parseV4(m[1]), wild: parseV4(m[2]), area: areaId(m[3]) }))
      .sort((a, b) => (a.wild < b.wild ? -1 : 1))
    const list = []
    for (const a of addrs) {
      const L = ifaceLines(dev, a.iface)
      let area = null
      const ifArea = lineValue(L, `ip ospf ${proc.pid} area`)
      if (ifArea !== undefined) area = areaId(ifArea)
      else {
        const n = networks.find((x) => ((a.addr ^ x.addr) & (MASK32 ^ x.wild)) === 0n)
        if (n) area = n.area
      }
      if (area === null) continue
      const loop = a.iface.startsWith('Loopback')
      const nt = lineValue(L, 'ip ospf network')
      const type = nt === 'point-to-point' ? 'P2P' : loop ? 'LOOPBACK' : 'BROADCAST'
      const hello = Number(lineValue(L, 'ip ospf hello-interval') ?? 10)
      const dead = Number(lineValue(L, 'ip ospf dead-interval') ?? hello * 4)
      const costLine = lineValue(L, 'ip ospf cost')
      const cost = costLine ? Number(costLine) : Math.max(1, Math.floor((refbw * 1000) / Number(lineValue(L, 'bandwidth') ?? bandwidthKbps(a.iface))))
      const passive = loop || (passiveDefault ? hasLine(proc.lines, `no passive-interface ${a.iface}`) === false : hasLine(proc.lines, `passive-interface ${a.iface}`))
      list.push({ iface: a.iface, area: String(area), addr: a.addr, len: a.len, cost, hello, dead, type, prio: Number(lineValue(L, 'ip ospf priority') ?? 1), passive, loop, pid: proc.pid })
    }
    enabled[dev.id] = list
    O.ifaces[dev.id] = list
    O.neighbors[dev.id] = []
  }

  // Adjacencies per segment
  const segIfaces = {}
  for (const [devId, list] of Object.entries(enabled)) {
    for (const i of list) {
      if (i.passive) continue
      const seg = segOf(net, devId, i.iface)
      if (seg === undefined) continue
      segIfaces[seg] ??= []
      segIfaces[seg].push({ ...i, dev: devId })
    }
  }
  const adjEdges = [] // { from, to, cost, nh, iface }
  for (const members of Object.values(segIfaces)) {
    // pairwise compatibility
    const ok = (a, b) => a.dev !== b.dev && a.area === b.area && a.len === b.len && networkOf(4, a.addr, a.len) === networkOf(4, b.addr, b.len) && a.hello === b.hello && a.dead === b.dead && O.rids[a.dev] !== O.rids[b.dev]
    const broadcast = members.filter((m) => m.type === 'BROADCAST')
    // DR election among broadcast members that have at least one compatible neighbor
    const eligible = broadcast.filter((m) => members.some((x) => ok(m, x)))
    const ranked = eligible.filter((m) => m.prio > 0).sort((a, b) => (a.prio !== b.prio ? b.prio - a.prio : O.rids[b.dev] > O.rids[a.dev] ? 1 : -1))
    // DR/BDR are not preemptive: keep the current holders while they stay eligible
    net.lab.rt.ospfDr ??= {}
    const segKey = broadcast[0] ? `${networkOf(4, broadcast[0].addr, broadcast[0].len)}/${broadcast[0].len}` : null
    const state = segKey ? (net.lab.rt.ospfDr[segKey] ??= {}) : {}
    const idOf = (m) => m && `${m.dev}|${m.iface}`
    const find = (id) => ranked.find((m) => idOf(m) === id)
    let dr = find(state.dr)
    let bdr = find(state.bdr)
    if (!dr && bdr) { dr = bdr; bdr = null }
    if (!dr) dr = ranked.find((m) => m !== bdr)
    if (!bdr || bdr === dr) bdr = ranked.find((m) => m !== dr)
    if (segKey) { state.dr = idOf(dr) ?? null; state.bdr = idOf(bdr) ?? null }
    for (const m of members) {
      m.role = m.type === 'P2P' ? 'P2P' : m === dr ? 'DR' : m === bdr ? 'BDR' : 'DROTHER'
      m.drAddr = m.type === 'BROADCAST' && dr ? dr.addr : null
      m.bdrAddr = m.type === 'BROADCAST' && bdr ? bdr.addr : null
      m.drRid = m.type === 'BROADCAST' && dr ? O.rids[dr.dev] : null
      m.bdrRid = m.type === 'BROADCAST' && bdr ? O.rids[bdr.dev] : null
      // A broadcast interface that hears nobody elects itself DR
      if (m.type === 'BROADCAST' && m.prio > 0 && !members.some((x) => ok(m, x))) {
        m.role = 'DR'; m.drAddr = m.addr; m.drRid = O.rids[m.dev]; m.bdrAddr = null; m.bdrRid = null
      }
      const orig = O.ifaces[m.dev].find((x) => x.iface === m.iface)
      Object.assign(orig, { role: m.role, drAddr: m.drAddr, bdrAddr: m.bdrAddr, drRid: m.drRid, bdrRid: m.bdrRid })
    }
    for (const a of members) {
      for (const b of members) {
        if (!ok(a, b)) continue
        const typeMismatch = a.type !== b.type
        let state = 'FULL'
        if (!typeMismatch && a.type === 'BROADCAST' && ![a.role, b.role].some((r) => r === 'DR' || r === 'BDR')) state = '2WAY'
        O.neighbors[a.dev].push({ rid: O.rids[b.dev], pri: b.prio, state, role: b.type === 'P2P' ? '-' : b.role, addr: b.addr, iface: a.iface, dev: b.dev, dead: b.dead })
        if (state === 'FULL' && !typeMismatch) adjEdges.push({ from: a.dev, to: b.dev, cost: a.cost, nh: b.addr, iface: a.iface })
      }
    }
  }
  net.ospf.adjEdges = adjEdges

  // SPF from every router
  const routers = Object.keys(enabled)
  const advertised = {}
  for (const r of routers) {
    advertised[r] = enabled[r].map((i) => (i.loop && i.type === 'LOOPBACK' ? { net: i.addr, len: 32, cost: 1 } : { net: networkOf(4, i.addr, i.len), len: i.len, cost: i.cost }))
  }
  const originators = routers.filter((r) => {
    const proc = ospfProcess(net.byId[r])
    const di = proc.lines.find((l) => l.startsWith('default-information originate'))
    if (!di) return false
    if (di.includes('always')) return true
    return (net.routes[r]._cand4 ?? []).some((x) => x.len === 0)
  })
  for (const src of routers) {
    const dist = { [src]: 0 }
    const first = { [src]: [] }
    const done = new Set()
    while (true) {
      let u = null
      for (const r of routers) if (!done.has(r) && dist[r] !== undefined && (u === null || dist[r] < dist[u])) u = r
      if (u === null) break
      done.add(u)
      for (const e of adjEdges) {
        if (e.from !== u) continue
        const d = dist[u] + e.cost
        const hops = u === src ? [{ ip: e.nh, iface: e.iface }] : first[u]
        if (dist[e.to] === undefined || d < dist[e.to]) { dist[e.to] = d; first[e.to] = [...hops] }
        else if (d === dist[e.to]) for (const h of hops) if (!first[e.to].some((x) => x.ip === h.ip)) first[e.to].push(h)
      }
    }
    const maxPaths = Number(lineValue(ospfProcess(net.byId[src]).lines, 'maximum-paths') ?? 4)
    const best = new Map()
    for (const r of routers) {
      if (r === src || dist[r] === undefined) continue
      for (const p of advertised[r]) {
        const key = `${p.net}/${p.len}`
        const metric = dist[r] + p.cost
        const cur = best.get(key)
        if (!cur || metric < cur.metric) best.set(key, { fam: 4, net: p.net, len: p.len, code: 'O', ad: 110, metric, hops: [...first[r]] })
        else if (metric === cur.metric) for (const h of first[r]) if (!cur.hops.some((x) => x.ip === h.ip)) cur.hops.push(h)
      }
    }
    for (const o of originators) {
      if (o === src || dist[o] === undefined) continue
      const cur = best.get('0/0')
      if (!cur) best.set('0/0', { fam: 4, net: 0n, len: 0, code: 'O*E2', ad: 110, metric: 1, hops: [...first[o]] })
    }
    O.routes[src] = [...best.values()].map((r) => ({ ...r, hops: r.hops.slice(0, maxPaths) }))
  }
}

// ======================================================================
// Packet forwarding (ping / traceroute / tcp tests)
// ======================================================================

const PROTO = { icmp: 1, tcp: 6, udp: 17 }

// Walk a packet hop by hop. pkt: { fam, src, dst, proto, sport, dport, icmpType }
// Returns { delivered, dev, hops: [{ dev, iface, addr }], reason, pkt }
export function forward(net, startDev, pkt, opts = {}) {
  const hops = []
  let cur = startDev
  let ingress = null
  let local = true
  pkt = { ...pkt }
  for (let ttl = 0; ttl < 32; ttl++) {
    const dev = net.byId[cur]
    // NAT outside -> inside (un-translate) before routing
    if (!local && isIos(dev) && ingress && hasLine(ifaceLines(dev, ingress), 'ip nat outside') && pkt.fam === 4) {
      const t = (dev.rt.nat ?? []).find((x) => x.global === v4ToStr(pkt.dst) && (x.gport === undefined || x.gport === (pkt.dport ?? pkt.id)))
      const st = natStatics(dev).find((s) => s.global === pkt.dst)
      if (st) pkt.dst = st.local
      else if (t) { pkt.dst = parseV4(t.local); if (t.lport !== undefined) pkt.dport = t.lport }
    }
    // Delivered?
    if (usableAddrs(net, cur).some((a) => a.fam === pkt.fam && a.addr === pkt.dst) || (ingress && ownsAddr(net, cur, ingress, pkt.fam, pkt.dst) === 'vip')) {
      return { delivered: true, dev: cur, hops, pkt }
    }
    if (!local && !routesEnabled(dev, pkt.fam)) return { delivered: false, reason: 'no-forward', hops, dev: cur }
    const r = lookup(net, cur, pkt.fam, pkt.dst)
    if (!r) return { delivered: false, reason: local ? 'no-route-local' : 'unreachable', hops, dev: cur }
    const hop = r.hops[(opts.flow ?? 0) % r.hops.length]
    const egress = hop.iface
    const nh = r.code === 'C' || (r.ifaceOnly && hop.ip === undefined) ? pkt.dst : hop.ip
    // Source address for locally generated packets
    if (local && pkt.src === undefined) {
      const a = usableAddrs(net, cur).find((x) => x.iface === egress && x.fam === pkt.fam && (pkt.fam === 4 ? x.primary : !x.linkLocal)) ?? usableAddrs(net, cur).find((x) => x.iface === egress && x.fam === pkt.fam)
      if (!a) return { delivered: false, reason: 'no-source', hops, dev: cur }
      pkt.src = a.addr
    }
    // Outbound ACL (not applied to router-generated traffic)
    if (!local && isIos(dev) && pkt.fam === 4) {
      const acl = lineValue(ifaceLines(dev, egress), 'ip access-group')
      const out = acl && acl.endsWith(' out') ? acl.split(' ')[0] : null
      if (out && !evalAcl(dev, out, pkt, net.lab.rt?.aclHits).permit) return { delivered: false, reason: 'filtered', hops, dev: cur, acl: { dev: cur, iface: egress, name: out, dir: 'out' } }
    }
    // NAT inside -> outside
    if (!local && isIos(dev) && pkt.fam === 4 && ingress && hasLine(ifaceLines(dev, ingress), 'ip nat inside') && hasLine(ifaceLines(dev, egress), 'ip nat outside')) {
      natTranslate(net, dev, egress, pkt)
    }
    // ARP / ND for next hop on the egress segment
    const seg = segOf(net, cur, egress)
    let next = null
    for (const m of segMembers(net, seg)) {
      if (m.dev === cur && m.iface === egress) continue
      if (ownsAddr(net, m.dev, m.iface, pkt.fam, nh)) { next = m; break }
    }
    if (!next) return { delivered: false, reason: local ? 'arp-fail-local' : 'arp-fail', hops, dev: cur, nh }
    if (pkt.fam === 4 && !daiOk(net, cur, egress, next.dev, next.iface)) return { delivered: false, reason: local ? 'arp-fail-local' : 'arp-fail', hops, dev: cur, nh, dai: true }
    const nd = net.byId[next.dev]
    // Inbound ACL at next device
    if (isIos(nd) && pkt.fam === 4) {
      const acl = lineValue(ifaceLines(nd, next.iface), 'ip access-group')
      const inn = acl && acl.endsWith(' in') ? acl.split(' ')[0] : null
      if (inn && !evalAcl(nd, inn, pkt, net.lab.rt?.aclHits).permit) return { delivered: false, reason: 'filtered', hops, dev: next.dev, acl: { dev: next.dev, iface: next.iface, name: inn, dir: 'in' } }
    }
    const inAddr = usableAddrs(net, next.dev).find((a) => a.iface === next.iface && a.fam === pkt.fam && !a.linkLocal)
    hops.push({ dev: next.dev, iface: next.iface, addr: inAddr?.addr ?? nh })
    cur = next.dev
    ingress = next.iface
    local = false
  }
  return { delivered: false, reason: 'ttl', hops, dev: cur }
}

function daiVlans(dev) {
  const set = new Set()
  for (const l of globalLines(dev, 'ip arp inspection vlan')) {
    const list = parseVlanList(tokens(l)[4])
    if (list && list !== 'all') for (const v of list) set.add(v)
  }
  return set
}

// ARP between two L3 endpoints: every untrusted DAI port the ARP enters must have a binding for its sender
function daiOk(net, aDev, aIf, bDev, bIf) {
  if (!net.devs.some((d) => isSwitch(d) && daiVlans(d).size)) return true
  const check = (fromDev, fromIf, toDev, toIf) => {
    const path = l2Path(net, nodeId(fromDev, fromIf), nodeId(toDev, toIf))
    if (!path) return true
    const sender = usableAddrs(net, fromDev).find((x) => x.iface === fromIf && x.fam === 4)
    const senderMac = macToStr(ifaceMac(net.byId[fromDev], fromIf))
    for (const p of ingressPorts(net, path)) {
      const sw = net.byId[p.dev]
      if (!daiVlans(sw).has(p.vlan) || hasLine(ifaceLines(sw, p.iface), 'ip arp inspection trust')) continue
      const ok = (sw.rt.snoopBindings ?? []).some((b) => b.mac === senderMac && sender && b.ip === v4ToStr(sender.addr) && b.vlan === p.vlan)
      if (!ok) {
        sw.rt.daiDrops = (sw.rt.daiDrops ?? 0) + 1
        net.events.push({ dev: sw.id, msg: `%SW_DAI-4-DHCP_SNOOPING_DENY: 1 Invalid ARPs (Req) on ${shortName(p.iface)}, vlan ${p.vlan}.([${senderMac}/${sender ? v4ToStr(sender.addr) : '0.0.0.0'}/0000.0000.0000/0.0.0.0/])` })
        return false
      }
    }
    return true
  }
  return check(aDev, aIf, bDev, bIf) && check(bDev, bIf, aDev, aIf)
}

function natTranslate(net, dev, egress, pkt) {
  const st = natStatics(dev).find((s) => s.local === pkt.src)
  if (st) { pkt.src = st.global; return }
  dev.rt.nat ??= []
  for (const l of globalLines(dev, 'ip nat inside source list')) {
    const m = /^ip nat inside source list (\S+) (pool (\S+)|interface (\S+))( overload)?$/.exec(l)
    if (!m) continue
    if (!evalAcl(dev, m[1], pkt).permit || !aclTable(dev)[m[1]]) continue
    const local = v4ToStr(pkt.src)
    const overload = !!m[5] || !!m[4]
    let existing = dev.rt.nat.find((x) => x.local === local && (overload ? x.lport === (pkt.sport ?? pkt.id ?? 1) : x.lport === undefined))
    if (!existing) {
      let global
      if (m[4]) {
        const a = usableAddrs(net, dev.id).find((x) => x.iface === m[4] && x.fam === 4 && x.primary)
        if (!a) return
        global = a.addr
      } else {
        const pool = natPools(dev).find((p) => p.name === m[3])
        if (!pool) return
        if (overload) global = pool.start
        else {
          const used = new Set(dev.rt.nat.filter((x) => x.lport === undefined).map((x) => x.global))
          for (let a = pool.start; a <= pool.end; a++) if (!used.has(v4ToStr(a))) { global = a; break }
          if (global === undefined) return
        }
      }
      existing = { local, global: v4ToStr(global), proto: pkt.proto, outside: v4ToStr(pkt.dst) }
      if (overload) { existing.lport = pkt.sport ?? pkt.id ?? 1; existing.gport = existing.lport }
      dev.rt.nat.push(existing)
    }
    pkt.src = parseV4(existing.global)
    if (existing.gport !== undefined && pkt.sport !== undefined) pkt.sport = existing.gport
    return
  }
}

// Full round trip. Returns { ok, out, back, reason }
export function roundTrip(net, srcDev, fam, dst, opts = {}) {
  const proto = opts.proto ?? 'icmp'
  const pkt = { fam, dst, src: opts.src, proto: PROTO[proto], icmpType: 'echo', sport: opts.sport, dport: opts.dport, id: opts.id ?? 1 }
  const out = forward(net, srcDev, pkt, opts)
  if (!out.delivered) return { ok: false, out, reason: out.reason }
  const p = out.pkt
  const reply = { fam, src: p.dst, dst: p.src, proto: p.proto, icmpType: 'echo-reply', sport: p.dport, dport: p.sport, ack: true, id: p.id }
  const target = out.dev
  const dstDev = net.byId[target]
  // Service check for TCP tests
  if (proto === 'tcp' && !isIos(dstDev) && !(dstDev.host.services ?? []).includes(opts.dport)) return { ok: false, out, reason: 'refused' }
  const back = forward(net, target, reply, opts)
  if (!back.delivered || back.dev !== srcDev) return { ok: false, out, back, reason: back.reason ?? 'wrong-host' }
  return { ok: true, out, back }
}

// ======================================================================
// DHCP
// ======================================================================

function poolsOf(dev) {
  if (!isIos(dev)) {
    const s = dev.host.dhcpServer
    return s ? [{ name: 'SERVER', network: parseV4(s.network), len: maskToLen(s.mask), gw: s.gw, dns: s.dns, rogue: true }] : []
  }
  return sectionsOf(dev, 'ip dhcp pool ').map((s) => {
    const n = lineValue(s.lines, 'network')
    if (!n) return null
    const [a, m] = n.split(' ')
    return { name: s.head.slice(13), network: parseV4(a), len: maskToLen(m) ?? Number(m?.replace('/', '')), gw: lineValue(s.lines, 'default-router')?.split(' ')[0], dns: lineValue(s.lines, 'dns-server') }
  }).filter(Boolean)
}
export { poolsOf }

function excluded(dev) {
  return globalLines(dev, 'ip dhcp excluded-address').map((l) => {
    const t = tokens(l)
    const a = parseV4(t[3])
    return [a, t[4] ? parseV4(t[4]) : a]
  })
}

// Shortest L2 path between two nodes, returning switch ingress ports along the way
function l2Path(net, from, to) {
  const prev = new Map([[from, null]])
  const q = [from]
  while (q.length) {
    const x = q.shift()
    if (x === to) break
    for (const e of net.graph.get(x) ?? []) {
      if (prev.has(e.to)) continue
      prev.set(e.to, { from: x, via: e.via })
      q.push(e.to)
    }
  }
  if (!prev.has(to)) return null
  const steps = []
  let x = to
  while (prev.get(x)) { const p = prev.get(x); steps.unshift({ from: p.from, to: x, via: p.via }); x = p.from }
  return steps
}

// Switch ports a frame enters when going from node A to node B: [{ dev, iface, vlan }]
function ingressPorts(net, steps) {
  const out = []
  for (const s of steps) {
    if (!s.via || s.via.svi) continue
    const [kind, dev, vlan] = s.to.split('|')
    if (kind !== 'S') continue
    const port = s.via.a.dev === dev ? s.via.a.iface : s.via.b.iface
    out.push({ dev, iface: port, vlan: Number(vlan) })
  }
  return out
}

function snoopingOn(dev, vlan) {
  if (!dev.config.global.includes('ip dhcp snooping')) return false
  for (const l of globalLines(dev, 'ip dhcp snooping vlan')) {
    const list = parseVlanList(tokens(l)[4])
    if (list && list !== 'all' && list.has(vlan)) return true
  }
  return false
}

// clientDev/clientIface request an address. Returns { lease, server, reason, log }
export function dhcpRequest(net, clientDevId, clientIface) {
  const clientNode = nodeId(clientDevId, clientIface)
  const seg = net.comp.get(clientNode)
  if (seg === undefined || !ifUp(net, clientDevId, clientIface)) return { reason: 'link down' }
  const clientDev = net.byId[clientDevId]
  const clientMac = isIos(clientDev) ? ifaceMac(clientDev, clientIface) : macBig(clientDev)
  const candidates = []
  for (const m of segMembers(net, seg)) {
    if (m.dev === clientDevId) continue
    const d = net.byId[m.dev]
    const myAddr = usableAddrs(net, m.dev).find((a) => a.iface === m.iface && a.fam === 4 && a.primary)
    // Direct server on the segment
    if (myAddr) {
      for (const p of poolsOf(d)) {
        if (p.rogue || networkOf(4, myAddr.addr, p.len) === p.network) candidates.push({ server: m.dev, entry: m, pool: p, giaddr: null, relay: null })
      }
    }
    // Relay agent
    if (isIos(d) && myAddr) {
      for (const l of ifaceLines(d, m.iface).filter((x) => x.startsWith('ip helper-address'))) {
        const h = parseV4(tokens(l)[2])
        const rt = roundTrip(net, m.dev, 4, h, { proto: 'udp', src: myAddr.addr, sport: 67, dport: 67 })
        if (!rt.ok) continue
        const srv = net.byId[rt.out.dev]
        for (const p of poolsOf(srv)) {
          if (networkOf(4, myAddr.addr, p.len) === p.network || p.rogue) candidates.push({ server: srv.id, entry: m, pool: p, giaddr: myAddr.addr, relay: m.dev })
        }
      }
    }
  }
  // Order by L2 distance from client, filter by DHCP snooping
  const scored = []
  const log = []
  for (const c of candidates) {
    const path = l2Path(net, nodeId(c.entry.dev, c.entry.iface), clientNode)
    if (!path) continue
    const ports = ingressPorts(net, path)
    // Server -> client direction: every switch port the reply enters must be trusted (if snooping on)
    const blocked = ports.find((p) => snoopingOn(net.byId[p.dev], p.vlan) && !hasLine(ifaceLines(net.byId[p.dev], p.iface), 'ip dhcp snooping trust'))
    if (blocked) { log.push({ dev: blocked.dev, msg: `%DHCP_SNOOPING-5-DHCP_SNOOPING_UNTRUSTED_PORT: DHCP_SNOOPING drop message on untrusted port, message type: DHCPOFFER, MAC sa: ${macToStr(macBig(net.byId[c.server]))}` }); continue }
    // Option 82 gotcha: client side passed a snooping switch that inserted option 82 toward an IOS server/relay
    const reverse = l2Path(net, clientNode, nodeId(c.entry.dev, c.entry.iface))
    const upPorts = reverse ? ingressPorts(net, reverse) : []
    const inserted = upPorts.some((p) => snoopingOn(net.byId[p.dev], p.vlan) && !hasLine(net.byId[p.dev].config.global, 'no ip dhcp snooping information option') && !hasLine(ifaceLines(net.byId[p.dev], p.iface), 'ip dhcp snooping trust'))
    if (inserted && isIos(net.byId[c.entry.dev])) {
      log.push({ dev: c.entry.dev, msg: 'DHCPD: inconsistent relay information. Packet with option 82 and giaddr 0.0.0.0 dropped.' })
      continue
    }
    scored.push({ ...c, dist: path.length, clientPorts: upPorts })
  }
  // nearest server answers first; a rogue home router on the same switch is typically fastest
  scored.sort((a, b) => a.dist - b.dist || (b.pool.rogue ? 1 : 0) - (a.pool.rogue ? 1 : 0))
  const pick = scored[0]
  if (!pick) return { reason: 'no offer', log }
  const srv = net.byId[pick.server]
  srv.rt.leases ??= []
  const macStr = macToStr(clientMac)
  let lease = srv.rt.leases.find((l) => l.mac === macStr && l.pool === pick.pool.name)
  if (!lease) {
    const ex = isIos(srv) ? excluded(srv) : []
    const used = new Set(srv.rt.leases.map((l) => l.ip))
    for (const d of net.devs) for (const a of net.addrs[d.id] ?? []) if (a.fam === 4) used.add(v4ToStr(a.addr))
    const size = 1n << BigInt(32 - pick.pool.len)
    let ip = null
    for (let i = 1n; i < size - 1n; i++) {
      const a = pick.pool.network + i
      if (ex.some(([x, y]) => a >= x && a <= y) || used.has(v4ToStr(a))) continue
      ip = a
      break
    }
    if (ip === null) return { reason: 'pool exhausted', log }
    lease = { ip: v4ToStr(ip), mask: v4ToStr(netMask(4, pick.pool.len)), gw: pick.pool.gw ?? null, dns: pick.pool.dns ?? null, mac: macStr, pool: pick.pool.name, server: pick.server, client: clientDevId }
    srv.rt.leases.push(lease)
  }
  // Snooping bindings on switches where the client port is untrusted
  for (const p of pick.clientPorts) {
    const sw = net.byId[p.dev]
    if (!snoopingOn(sw, p.vlan) || hasLine(ifaceLines(sw, p.iface), 'ip dhcp snooping trust')) continue
    sw.rt.snoopBindings = (sw.rt.snoopBindings ?? []).filter((b) => b.mac !== macStr)
    sw.rt.snoopBindings.push({ mac: macStr, ip: lease.ip, vlan: p.vlan, iface: p.iface })
  }
  return { lease, server: pick.server, rogue: !!pick.pool.rogue, log }
}

// MAC address table for a switch: [{ vlan, mac, port }]
export function macTable(net, devId) {
  const dev = net.byId[devId]
  const out = []
  for (const v of vlanDb(dev).keys()) {
    const start = `S|${devId}|${v}`
    if (!net.graph.has(start)) continue
    // BFS remembering first edge (the port)
    const firstPort = new Map([[start, null]])
    const q = [start]
    while (q.length) {
      const x = q.shift()
      for (const e of net.graph.get(x) ?? []) {
        if (firstPort.has(e.to)) continue
        let port = firstPort.get(x)
        if (port === null && e.via && !e.via.svi) port = e.via.a.dev === devId ? e.via.a.iface : e.via.b.iface
        firstPort.set(e.to, port)
        q.push(e.to)
      }
    }
    for (const [n, port] of firstPort) {
      if (!n.startsWith('I|') || !port) continue
      const [, d, i] = n.split('|')
      out.push({ vlan: v, mac: macToStr(ifaceMac(net.byId[d], i)), port })
    }
  }
  return out.sort((a, b) => a.vlan - b.vlan || compareIfaces(a.port, b.port))
}
