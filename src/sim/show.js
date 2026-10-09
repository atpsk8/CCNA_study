// "show" command output, formatted like IOS / IOS XE.

import { v4ToStr, v6ToStr, lenToMask, macToStr, prefixToStr, parseV4, solicitedNode, parseVlanList } from './ip.js'
import { shortIface as sh, compareIfaces, ifaceType, isPhysical, isSubif } from './iface.js'
import {
  hostname, isIos, isSwitch, ifaceLines, lineValue, hasLine, interfaces, globalLines, sectionsOf, macBig, getSection,
} from './device.js'
import {
  vlanDb, swConfig, stpMode, aclTable, ospfProcess, usableAddrs, ifaceMac, macTable, natPools, natStatics, poolsOf,
  roundTrip, routesEnabled, segOf, segMembers,
} from './network.js'

const pad = (s, n) => String(s).padEnd(n)
const lpad = (s, n) => String(s).padStart(n)

// ---------- interfaces ----------

export function ipIntBrief(net, dev) {
  const rows = [`${pad('Interface', 23)}${pad('IP-Address', 16)}OK? Method Status                Protocol`]
  const names = interfaces(dev).sort(compareIfaces)
  for (const i of names) {
    const st = net.ifState[dev.id][i] ?? { status: 'down', protocol: 'down' }
    const L = ifaceLines(dev, i)
    const a = (net.addrs[dev.id] ?? []).find((x) => x.iface === i && x.fam === 4 && x.primary)
    const cfg = L.find((l) => l.startsWith('ip address'))
    let ip = 'unassigned'
    let method = 'unset'
    if (cfg === 'ip address dhcp') { ip = a ? v4ToStr(a.addr) : 'unassigned'; method = 'DHCP' }
    else if (cfg) { ip = cfg.split(' ')[2]; method = 'manual' }
    else if (isSwitch(dev) && isPhysical(i)) method = 'unset'
    const status = st.reason === 'err-disabled' ? 'down' : st.status
    rows.push(`${pad(i, 22)} ${pad(ip, 15)} YES ${pad(method, 7)}${pad(status, 22)}${st.protocol}`)
  }
  return rows.join('\n')
}

export function interfacesStatus(net, dev, filter) {
  if (!isSwitch(dev)) return null
  const rows = [`\n${pad('Port', 10)}${pad('Name', 19)}${pad('Status', 13)}${pad('Vlan', 11)}${pad('Duplex', 7)}${pad('Speed', 7)}Type`]
  const ports = [...dev.ports, ...interfaces(dev).filter((i) => i.startsWith('Port-channel'))]
  for (const p of ports) {
    const st = net.ifState[dev.id][p] ?? { status: 'down' }
    let status = st.status === 'up' ? 'connected' : st.status === 'administratively down' ? 'disabled' : st.reason === 'err-disabled' ? 'err-disabled' : 'notconnect'
    if (filter === 'err-disabled' && status !== 'err-disabled') continue
    const s = net.sw[dev.id]?.[p]
    const c = swConfig(dev, p)
    let vlan = c?.mode === 'routed' ? 'routed' : s?.oper === 'trunk' ? 'trunk' : String(c?.accessVlan ?? 1)
    const pk = net.channels.find((g) => g.dev === dev.id && g.members.some((m) => m.iface === p))
    if (pk && pk.flags[p] === 'P') vlan = vlan
    const L = ifaceLines(dev, p)
    const desc = (lineValue(L, 'description') ?? '').slice(0, 18)
    const duplex = st.status === 'up' ? (lineValue(L, 'duplex') ?? 'a-full').replace(/^full$/, 'full') : 'auto'
    const speed = st.status === 'up' ? (lineValue(L, 'speed') ?? 'a-1000') : 'auto'
    rows.push(`${pad(sh(p), 10)}${pad(desc, 19)}${pad(status, 13)}${pad(vlan, 11)}${pad(duplex, 7)}${pad(speed, 7)}${p.startsWith('Port') ? '' : '10/100/1000BaseTX'}`)
  }
  return rows.join('\n')
}

export function interfacesDescription(net, dev) {
  const rows = [`${pad('Interface', 31)}${pad('Status', 15)}${pad('Protocol', 9)}Description`]
  for (const i of interfaces(dev).sort(compareIfaces)) {
    const st = net.ifState[dev.id][i] ?? { status: 'down', protocol: 'down' }
    const status = st.status === 'administratively down' ? 'admin down' : st.status
    rows.push(`${pad(sh(i), 31)}${pad(status, 15)}${pad(st.protocol, 9)}${lineValue(ifaceLines(dev, i), 'description') ?? ''}`)
  }
  return rows.join('\n')
}

export function showInterfaces(net, dev, only) {
  const names = (only ? [only] : interfaces(dev).sort(compareIfaces))
  const out = []
  for (const i of names) {
    const st = net.ifState[dev.id][i]
    if (!st && !getSection(dev, `interface ${i}`)) return null
    const s = st ?? { status: 'down', protocol: 'down' }
    const a = (net.addrs[dev.id] ?? []).find((x) => x.iface === i && x.fam === 4 && x.primary)
    const L = ifaceLines(dev, i)
    const mac = macToStr(ifaceMac(dev, i))
    const status = s.reason === 'err-disabled' ? 'down (err-disabled)' : s.status
    out.push(`${i} is ${status}, line protocol is ${s.protocol}${s.reason === 'notconnect' && s.status !== 'administratively down' ? ' (notconnect)' : ''}`)
    out.push(`  Hardware is ${ifaceType(i) === 'Vlan' ? 'Ethernet SVI' : ifaceType(i) === 'Loopback' ? 'Loopback' : 'Gigabit Ethernet'}, address is ${mac} (bia ${mac})`)
    const desc = lineValue(L, 'description')
    if (desc) out.push(`  Description: ${desc}`)
    if (a) out.push(`  Internet address is ${v4ToStr(a.addr)}/${a.len}`)
    out.push(`  MTU 1500 bytes, BW ${lineValue(L, 'bandwidth') ?? (ifaceType(i) === 'FastEthernet' ? '100000' : ifaceType(i) === 'Loopback' ? '8000000' : '1000000')} Kbit/sec, DLY ${ifaceType(i) === 'Loopback' ? 5000 : 10} usec,`)
    out.push('     reliability 255/255, txload 1/255, rxload 1/255')
    if (isSubif(i)) {
      const enc = lineValue(L, 'encapsulation dot1Q')
      out.push(`  Encapsulation 802.1Q Virtual LAN, Vlan ID  ${enc ? enc.split(' ')[0] : '1'}.`)
    } else out.push('  Encapsulation ARPA, loopback not set')
    if (isPhysical(i)) {
      const dup = lineValue(L, 'duplex') ?? 'auto'
      const spd = lineValue(L, 'speed') ?? 'auto'
      out.push(`  ${dup === 'half' ? 'Half' : 'Full'}-duplex, ${spd === 'auto' ? '1000Mb/s' : spd + 'Mb/s'}, media type is 10/100/1000BaseTX`)
      const mm = s.duplexMismatch
      const inpkts = s.protocol === 'up' ? 18234 : 0
      out.push('  5 minute input rate 1000 bits/sec, 2 packets/sec')
      out.push(`     ${inpkts} packets input, ${inpkts * 120} bytes, 0 no buffer`)
      out.push(`     Received 412 broadcasts (398 multicasts)`)
      out.push(`     ${mm && dup !== 'half' ? 37 : 0} runts, 0 giants, 0 throttles`)
      out.push(`     ${mm && dup !== 'half' ? 211 : 0} input errors, ${mm && dup !== 'half' ? 174 : 0} CRC, 0 frame, 0 overrun, 0 ignored`)
      out.push(`     ${inpkts + 902} packets output, ${(inpkts + 902) * 118} bytes, 0 underruns`)
      out.push(`     0 output errors, ${mm && dup === 'half' ? 96 : 0} collisions, 1 interface resets`)
      out.push(`     0 late collision, ${mm && dup === 'half' ? 58 : 0} deferred`.replace('0 late collision', `${mm && dup === 'half' ? 41 : 0} late collision`))
    }
  }
  return out.join('\n')
}

export function interfacesTrunk(net, dev) {
  if (!isSwitch(dev)) return null
  const trunks = Object.entries(net.sw[dev.id] ?? {}).filter(([p, s]) => s.oper === 'trunk' && net.ifState[dev.id][p]?.protocol === 'up').sort((a, b) => compareIfaces(a[0], b[0]))
  if (!trunks.length) return ''
  const db = vlanDb(dev)
  const fmtList = (vs) => {
    if (!vs.length) return 'none'
    const parts = []
    let start = vs[0]
    let prev = vs[0]
    for (const v of [...vs.slice(1), null]) {
      if (v === prev + 1) { prev = v; continue }
      parts.push(start === prev ? `${start}` : `${start}-${prev}`)
      start = prev = v
    }
    return parts.join(',')
  }
  const out = [`\n${pad('Port', 12)}${pad('Mode', 17)}${pad('Encapsulation', 14)}${pad('Status', 14)}Native vlan`]
  for (const [p, s] of trunks) out.push(`${pad(sh(p), 12)}${pad(s.admin === 'trunk' ? 'on' : s.admin.replace('dynamic ', ''), 17)}${pad('802.1q', 14)}${pad('trunking', 14)}${s.native}`)
  out.push(`\n${pad('Port', 12)}Vlans allowed on trunk`)
  for (const [p, s] of trunks) out.push(`${pad(sh(p), 12)}${s.allowed === 'all' ? '1-4094' : fmtList([...s.allowed].sort((a, b) => a - b))}`)
  out.push(`\n${pad('Port', 12)}Vlans allowed and active in management domain`)
  const active = (s) => [...db.keys()].filter((v) => s.allowed === 'all' || s.allowed.has(v)).sort((a, b) => a - b)
  for (const [p, s] of trunks) out.push(`${pad(sh(p), 12)}${fmtList(active(s))}`)
  out.push(`\n${pad('Port', 12)}Vlans in spanning tree forwarding state and not pruned`)
  for (const [p, s] of trunks) out.push(`${pad(sh(p), 12)}${fmtList(active(s).filter((v) => (net.stp[v]?.bridges[dev.id]?.ports[p]?.state ?? 'FWD') === 'FWD'))}`)
  return out.join('\n')
}

export function interfaceSwitchport(net, dev, iface) {
  const c = swConfig(dev, iface)
  if (!c) return null
  if (c.mode === 'routed') return `Name: ${sh(iface)}\nSwitchport: Disabled`
  const s = net.sw[dev.id]?.[iface] ?? { oper: c.mode === 'trunk' ? 'trunk' : 'access' }
  const db = vlanDb(dev)
  const vname = (v) => (db.has(v) ? `${v} (${db.get(v)})` : `${v} (Inactive)`)
  return [
    `Name: ${sh(iface)}`,
    'Switchport: Enabled',
    `Administrative Mode: ${c.mode === 'trunk' ? 'trunk' : c.mode === 'access' ? 'static access' : c.mode}`,
    `Operational Mode: ${net.ifState[dev.id][iface]?.protocol === 'up' ? (s.oper === 'trunk' ? 'trunk' : 'static access') : 'down'}`,
    'Administrative Trunking Encapsulation: dot1q',
    `Negotiation of Trunking: ${c.nonegotiate ? 'Off' : 'On'}`,
    `Access Mode VLAN: ${vname(c.accessVlan)}`,
    `Trunking Native Mode VLAN: ${vname(c.native)}`,
    `Voice VLAN: ${c.voiceVlan ? vname(c.voiceVlan) : 'none'}`,
    `Trunking VLANs Enabled: ${c.allowed === 'all' ? 'ALL' : [...c.allowed].join(',') || 'NONE'}`,
  ].join('\n')
}

// ---------- VLANs / MAC / STP ----------

export function vlanBrief(net, dev) {
  if (!isSwitch(dev)) return null
  const db = vlanDb(dev)
  const out = [`\n${pad('VLAN', 5)}${pad('Name', 33)}${pad('Status', 10)}Ports`, `${'-'.repeat(4)} ${'-'.repeat(32)} ${'-'.repeat(9)} ${'-'.repeat(31)}`]
  const byVlan = {}
  for (const p of dev.ports) {
    const c = swConfig(dev, p)
    const s = net.sw[dev.id]?.[p]
    if (!c || c.mode === 'routed') continue
    if (s && s.oper === 'trunk') continue
    const pk = net.channels.find((g) => g.dev === dev.id && g.members.some((m) => m.iface === p) && g.flags[p] === 'P')
    if (pk) continue
    byVlan[c.accessVlan] ??= []
    byVlan[c.accessVlan].push(sh(p))
    if (c.voiceVlan) { byVlan[c.voiceVlan] ??= []; byVlan[c.voiceVlan].push(sh(p)) }
  }
  for (const [v, name] of [...db.entries()].sort((a, b) => a[0] - b[0])) {
    const ports = byVlan[v] ?? []
    const lines = []
    for (let i = 0; i < ports.length; i += 4) lines.push(ports.slice(i, i + 4).join(', '))
    out.push(`${pad(v, 5)}${pad(name, 33)}${pad('active', 10)}${lines[0] ?? ''}`)
    for (const l of lines.slice(1)) out.push(`${' '.repeat(48)}${l}`)
  }
  for (const [v, n] of [[1002, 'fddi-default'], [1003, 'token-ring-default'], [1004, 'fddinet-default'], [1005, 'trnet-default']]) out.push(`${pad(v, 5)}${pad(n, 33)}act/unsup`)
  return out.join('\n')
}

export function showMac(net, dev) {
  if (!isSwitch(dev)) return null
  const rows = macTable(net, dev.id)
  const out = ['          Mac Address Table', '-------------------------------------------', '', 'Vlan    Mac Address       Type        Ports', '----    -----------       --------    -----']
  for (const r of rows) out.push(`${lpad(r.vlan, 4)}    ${pad(r.mac, 18)}DYNAMIC     ${sh(r.port)}`)
  out.push(`Total Mac Addresses for this criterion: ${rows.length}`)
  return out.join('\n')
}

const fmtBid = (b) => `${b}`

export function spanningTree(net, dev, onlyVlan) {
  if (!isSwitch(dev)) return null
  const mode = stpMode(dev)
  const vlans = Object.keys(net.stp).map(Number).filter((v) => net.stp[v].bridges[dev.id] && Object.keys(net.stp[v].bridges[dev.id].ports).length).sort((a, b) => a - b)
  const list = onlyVlan ? vlans.filter((v) => v === onlyVlan) : vlans
  if (onlyVlan && !list.length) return `Spanning tree instance(s) for vlan ${onlyVlan} does not exist.`
  const out = []
  for (const v of list) {
    const st = net.stp[v]
    const me = st.bridges[dev.id]
    const root = st.bridges[me.root]
    out.push('', `VLAN${String(v).padStart(4, '0')}`, `  Spanning tree enabled protocol ${mode === 'rapid-pvst' ? 'rstp' : 'ieee'}`)
    out.push(`  Root ID    Priority    ${root.bid}`, `             Address     ${macToStr(root.mac)}`)
    if (me.root === dev.id) out.push('             This bridge is the root')
    else {
      out.push(`             Cost        ${me.rootCost}`)
      const rp = me.ports[me.rootPort]
      out.push(`             Port        ${rp.num} (${me.rootPort})`)
    }
    out.push('             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec', '')
    out.push(`  Bridge ID  Priority    ${me.bid}  (priority ${me.prio} sys-id-ext ${v})`, `             Address     ${macToStr(me.mac)}`)
    out.push('             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec', '             Aging Time  300 sec', '')
    out.push(`${pad('Interface', 20)}${pad('Role', 5)}${pad('Sts', 4)}${pad('Cost', 10)}${pad('Prio.Nbr', 9)}Type`)
    out.push(`${'-'.repeat(19)} ${'-'.repeat(4)} ${'-'.repeat(3)} ${'-'.repeat(9)} ${'-'.repeat(8)} ${'-'.repeat(24)}`)
    for (const [p, info] of Object.entries(me.ports).sort((a, b) => compareIfaces(a[0], b[0]))) {
      let type = info.p2p || true ? 'P2p' : 'Shr'
      if (info.portfast) type += ' Edge'
      if (info.inconsistent) type += ` *${info.inconsistent}`
      out.push(`${pad(sh(p), 20)}${pad(info.role, 5)}${pad(info.state, 4)}${pad(info.cost, 10)}${pad(`${info.prio}.${info.num}`, 9)}${type}`)
    }
  }
  return out.join('\n')
}

export function stpSummary(net, dev) {
  if (!isSwitch(dev)) return null
  const mode = stpMode(dev)
  const vlans = Object.keys(net.stp).map(Number).filter((v) => net.stp[v].bridges[dev.id]).sort((a, b) => a - b)
  const out = [`Switch is in ${mode} mode`]
  const roots = vlans.filter((v) => net.stp[v].root === dev.id)
  out.push(`Root bridge for: ${roots.length ? roots.map((v) => 'VLAN' + String(v).padStart(4, '0')).join(', ') : 'none'}`)
  const g = dev.config.global
  out.push(`EtherChannel misconfig guard            is enabled`)
  out.push(`Portfast Default                        is ${hasLine(g, 'spanning-tree portfast default') ? 'enabled' : 'disabled'}`)
  out.push(`PortFast BPDU Guard Default             is ${hasLine(g, 'spanning-tree portfast bpduguard default') ? 'enabled' : 'disabled'}`)
  out.push('', `${pad('Name', 21)}Blocking Listening Learning Forwarding STP Active`, `${'-'.repeat(20)} -------- --------- -------- ---------- ----------`)
  for (const v of vlans) {
    const ports = Object.values(net.stp[v].bridges[dev.id].ports)
    const blk = ports.filter((p) => p.state !== 'FWD').length
    out.push(`${pad('VLAN' + String(v).padStart(4, '0'), 21)}${lpad(blk, 8)} ${lpad(0, 9)} ${lpad(0, 8)} ${lpad(ports.length - blk, 10)} ${lpad(ports.length, 10)}`)
  }
  return out.join('\n')
}

export function etherchannelSummary(net, dev) {
  if (!isSwitch(dev)) return null
  const groups = net.channels.filter((g) => g.dev === dev.id)
  const out = [
    'Flags:  D - down        P - bundled in port-channel',
    '        I - stand-alone s - suspended',
    '        H - Hot-standby (LACP only)',
    '        R - Layer3      S - Layer2',
    '        U - in use      f - failed to allocate aggregator',
    '',
    `Number of channel-groups in use: ${groups.length}`,
    `Number of aggregators:           ${groups.length}`,
    '',
    'Group  Port-channel  Protocol    Ports',
    '------+-------------+-----------+-----------------------------------------------',
  ]
  for (const g of groups) {
    const l3 = swConfig(net.byId[g.dev], g.po)?.mode === 'routed'
    const flag = `${l3 ? 'R' : 'S'}${g.up ? 'U' : 'D'}`
    const proto = g.protocol !== '-' ? g.protocol : g.members[0].mode === 'on' ? '-' : ['active', 'passive'].includes(g.members[0].mode) ? 'LACP' : 'PAgP'
    out.push(`${pad(g.po.slice(12), 7)}${pad(`${sh(g.po)}(${flag})`, 14)}${pad(proto, 12)}${g.members.map((m) => `${sh(m.iface)}(${g.flags[m.iface]})`).join(' ')}`)
  }
  return out.join('\n')
}

// ---------- routing ----------

const CODES4 = `Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP
       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area
       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2
       E1 - OSPF external type 1, E2 - OSPF external type 2, m - OMP
       n - NAT, Ni - NAT inside, No - NAT outside, Nd - NAT DIA
       i - IS-IS, su - IS-IS summary, L1 - IS-IS level-1, L2 - IS-IS level-2
       ia - IS-IS inter area, * - candidate default, U - per-user static route
       H - NHRP, G - NHRP registered, g - NHRP registration summary
       o - ODR, P - periodic downloaded static route, l - LISP
       a - application route
       + - replicated route, % - next hop override, p - overrides from PfR
       & - replicated local route overrides by connected

`

export function ipRoute(net, dev, filter) {
  if (!routesEnabled(dev, 4)) {
    const gw = lineValue(dev.config.global, 'ip default-gateway')
    return `Default gateway is ${gw ?? 'not set'}\n\nHost               Gateway           Last Use    Total Uses  Interface\nICMP redirect cache is empty`
  }
  let routes = [...net.routes[dev.id][4]]
  if (filter && filter.addr !== undefined) {
    const r = routes.filter((x) => (filter.addr & (x.len === 0 ? 0n : ((1n << 32n) - 1n) ^ ((1n << BigInt(32 - x.len)) - 1n))) === x.net).sort((a, b) => b.len - a.len)[0]
    if (!r || (r.len === 0 && filter.addr !== 0n)) return '% Network not in table'
    const out = [`Routing entry for ${v4ToStr(r.net)}/${r.len}`, `  Known via "${{ C: 'connected', L: 'connected', S: 'static', 'S*': 'static', O: 'ospf ' + (ospfProcess(dev)?.pid ?? 1), 'O*E2': 'ospf ' + (ospfProcess(dev)?.pid ?? 1) }[r.code]}", distance ${r.ad}, metric ${r.metric}${r.code === 'C' || r.code === 'L' ? ' (connected, via interface)' : ''}`, '  Routing Descriptor Blocks:']
    for (const h of r.hops) out.push(`  * ${h.ip !== undefined ? v4ToStr(h.ip) : 'directly connected'}${h.iface ? `, via ${h.iface}` : ''}`, `      Route metric is ${r.metric}, traffic share count is 1`)
    return out.join('\n')
  }
  if (filter?.code) routes = routes.filter((r) => filter.code.includes(r.code))
  const def = net.routes[dev.id][4].find((r) => r.len === 0)
  const out = [CODES4 + (def ? `Gateway of last resort is ${def.hops[0].ip !== undefined ? v4ToStr(def.hops[0].ip) : '0.0.0.0'} to network 0.0.0.0\n` : 'Gateway of last resort is not set\n')]
  routes.sort((a, b) => (a.net !== b.net ? (a.net < b.net ? -1 : 1) : a.len - b.len))
  // group by classful network like IOS
  let lastMajor = null
  for (const r of routes) {
    const major = classful(r.net)
    const subs = routes.filter((x) => classful(x.net) === major && x.len !== 0)
    const lens = new Set(subs.map((x) => x.len))
    // a classful network that is not subnetted (only its natural mask) gets no header line
    if (r.len !== 0 && major !== lastMajor && subs.length && !(lens.size === 1 && lens.has(major.len))) {
      out.push(lens.size > 1
        ? `      ${v4ToStr(major.net)}/${major.len} is variably subnetted, ${subs.length} subnets, ${lens.size} masks`
        : `      ${v4ToStr(major.net)}/${[...lens][0]} is subnetted, ${subs.length} subnet${subs.length > 1 ? 's' : ''}`)
      lastMajor = major
    }
    const single = r.len !== 0 && new Set(routes.filter((x) => classful(x.net) === major && x.len !== 0).map((x) => x.len)).size === 1 && r.len !== major.len
    out.push(...routeLines(r, single))
  }
  return out.join('\n')
}

function classful(n) {
  const first = Number(n >> 24n)
  const len = first < 128 ? 8 : first < 192 ? 16 : 24
  const net = n & (((1n << 32n) - 1n) ^ ((1n << BigInt(32 - len)) - 1n))
  return classfulCache[`${net}/${len}`] ??= { net, len }
}
const classfulCache = {}

function routeLines(r, indent) {
  const code = pad(r.code === 'O*E2' ? 'O*E2' : r.code, 9)
  const dest = indent ? v4ToStr(r.net) : `${v4ToStr(r.net)}/${r.len}`
  const lines = []
  r.hops.forEach((h, i) => {
    const lead = i === 0 ? `${code}${dest}` : ' '.repeat(9 + dest.length)
    if (r.code === 'C' || r.code === 'L') lines.push(`${lead} is directly connected, ${h.iface}`)
    else if (h.ip === undefined) lines.push(`${lead} is directly connected, ${h.iface}`)
    else lines.push(`${lead} [${r.ad}/${r.metric}] via ${v4ToStr(h.ip)}${r.code.startsWith('O') ? ', 00:01:12' : ''}${r.code.startsWith('O') || r.ifaceOnlyNh ? `, ${h.iface}` : h.iface && r.code !== 'S' && r.code !== 'S*' ? `, ${h.iface}` : ''}`)
  })
  return lines
}

export function ipv6Route(net, dev, filter) {
  const routes = [...net.routes[dev.id][6]].filter((r) => !filter || filter.includes(r.code))
  const out = [`IPv6 Routing Table - default - ${routes.length} entries`, 'Codes: C - Connected, L - Local, S - Static, U - Per-user Static route', '       B - BGP, R - RIP, H - NHRP, I1 - ISIS L1, I2 - ISIS L2', '       IA - ISIS interarea, IS - ISIS summary, D - EIGRP, EX - EIGRP external', '       ND - ND Default, NDp - ND Prefix, DCE - Destination, NDr - Redirect', '       O - OSPF Intra, OI - OSPF Inter, OE1 - OSPF ext 1, OE2 - OSPF ext 2']
  routes.sort((a, b) => (a.net !== b.net ? (a.net < b.net ? -1 : 1) : a.len - b.len))
  for (const r of routes) {
    out.push(`${pad(r.code.replace('*', ''), 3)}${v6ToStr(r.net)}/${r.len} [${r.ad}/${r.metric}]`)
    for (const h of r.hops) {
      if (r.code === 'C' || r.code === 'L') out.push(`     via ${h.iface}, ${r.code === 'C' ? 'directly connected' : 'receive'}`)
      else out.push(`     via ${h.ip !== undefined ? v6ToStr(h.ip) : h.iface}${h.ip !== undefined && h.iface ? `, ${h.iface}` : ''}`)
    }
  }
  return out.join('\n')
}

export function ipv6IntBrief(net, dev) {
  const out = []
  for (const i of interfaces(dev).sort(compareIfaces)) {
    const st = net.ifState[dev.id][i] ?? { status: 'down', protocol: 'down' }
    out.push(`${pad(i, 23)}[${st.status === 'up' && st.protocol === 'up' ? 'up/up' : st.status === 'administratively down' ? 'administratively down/down' : `${st.status}/${st.protocol}`}]`)
    const addrs = (net.addrs[dev.id] ?? []).filter((a) => a.iface === i && a.fam === 6).sort((a, b) => (b.linkLocal ? 1 : 0) - (a.linkLocal ? 1 : 0))
    if (!addrs.length) out.push('    unassigned')
    for (const a of addrs) out.push(`    ${v6ToStr(a.addr)}`)
  }
  return out.join('\n')
}

export function ipv6Interface(net, dev, i) {
  const st = net.ifState[dev.id][i]
  if (!st) return null
  const addrs = (net.addrs[dev.id] ?? []).filter((a) => a.iface === i && a.fam === 6)
  const ll = addrs.find((a) => a.linkLocal)
  const out = [`${i} is ${st.status}, line protocol is ${st.protocol}`]
  if (!ll) { out.push('  IPv6 is disabled'); return out.join('\n') }
  out.push('  IPv6 is enabled, link-local address is ' + v6ToStr(ll.addr), '  No Virtual link-local address(es):', '  Global unicast address(es):')
  for (const a of addrs.filter((x) => !x.linkLocal)) out.push(`    ${v6ToStr(a.addr)}, subnet is ${v6ToStr(a.addr & (((1n << 128n) - 1n) ^ ((1n << BigInt(128 - a.len)) - 1n)))}/${a.len}${a.eui ? ' [EUI]' : ''}`)
  const groups = ['FF02::1', ...(routesEnabled(dev, 6) ? ['FF02::2'] : []), ...addrs.map((a) => v6ToStr(solicitedNode(a.addr)))]
  out.push('  Joined group address(es):', ...[...new Set(groups)].map((g) => `    ${g}`))
  out.push('  MTU is 1500 bytes', '  ICMP error messages limited to one every 100 milliseconds', '  ND DAD is enabled, number of DAD attempts: 1', '  ND reachable time is 30000 milliseconds (using 30000)')
  if (routesEnabled(dev, 6)) out.push('  ND advertised reachable time is 0 (unspecified)', '  ND router advertisements are sent every 200 seconds', '  Hosts use stateless autoconfig for addresses.')
  return out.join('\n')
}

// ---------- OSPF ----------

export function ospfNeighbor(net, dev) {
  const list = net.ospf.neighbors[dev.id] ?? []
  const out = ['', `${pad('Neighbor ID', 17)}${pad('Pri', 5)}${pad('State', 16)}${pad('Dead Time', 12)}${pad('Address', 16)}Interface`]
  for (const n of list) out.push(`${pad(v4ToStr(n.rid), 17)}${pad(n.pri, 5)}${pad(`${n.state}/${n.role === 'DROTHER' ? 'DROTHER' : n.role}`.replace('/-', '/  -'), 16)}${pad(`00:00:${String(Math.max(3, n.dead - 7)).padStart(2, '0')}`, 12)}${pad(v4ToStr(n.addr), 16)}${n.iface}`)
  return out.join('\n')
}

export function ospfIntBrief(net, dev) {
  const list = net.ospf.ifaces[dev.id] ?? []
  const out = [`${pad('Interface', 11)}${pad('PID', 5)}${pad('Area', 16)}${pad('IP Address/Mask', 19)}${pad('Cost', 6)}${pad('State', 6)}Nbrs F/C`]
  const nbrs = net.ospf.neighbors[dev.id] ?? []
  for (const i of list) {
    const n = nbrs.filter((x) => x.iface === i.iface)
    const state = i.loop ? 'LOOP' : i.type === 'P2P' ? 'P2P' : i.passive ? 'DR' : (i.role ?? 'DR')
    out.push(`${pad(sh(i.iface), 11)}${pad(i.pid, 5)}${pad(i.area, 16)}${pad(`${v4ToStr(i.addr)}/${i.len}`, 19)}${pad(i.cost, 6)}${pad(state.replace('DROTHER', 'DROTH'), 5)} ${n.filter((x) => x.state === 'FULL').length}/${n.length}`)
  }
  return out.join('\n')
}

export function ospfInterface(net, dev, only) {
  const list = (net.ospf.ifaces[dev.id] ?? []).filter((i) => !only || i.iface === only)
  if (only && !list.length) return `%OSPF: OSPF not enabled on ${only}`
  const out = []
  const rid = dev.rt.ospfRid
  for (const i of list) {
    const st = net.ifState[dev.id][i.iface]
    out.push(`${i.iface} is ${st.status}, line protocol is ${st.protocol}`)
    out.push(`  Internet Address ${v4ToStr(i.addr)}/${i.len}, Interface ID ${dev.ports.indexOf(i.iface) + 7}, Area ${i.area}`)
    out.push(`  Process ID ${i.pid}, Router ID ${rid}, Network Type ${i.type === 'P2P' ? 'POINT_TO_POINT' : i.type}, Cost: ${i.cost}`)
    if (i.loop) { out.push('  Loopback interface is treated as a stub Host'); continue }
    if (i.type === 'BROADCAST') {
      const state = i.passive ? 'DR' : (i.role ?? 'DR')
      out.push(`  Transmit Delay is 1 sec, State ${state}, Priority ${i.prio}`)
      if (i.drRid !== null && i.drRid !== undefined) out.push(`  Designated Router (ID) ${v4ToStr(i.drRid)}, Interface address ${v4ToStr(i.drAddr)}`)
      if (i.bdrRid !== null && i.bdrRid !== undefined) out.push(`  Backup Designated router (ID) ${v4ToStr(i.bdrRid)}, Interface address ${v4ToStr(i.bdrAddr)}`)
    } else out.push('  Transmit Delay is 1 sec, State POINT_TO_POINT')
    out.push(`  Timer intervals configured, Hello ${i.hello}, Dead ${i.dead}, Wait ${i.dead}, Retransmit 5`)
    if (i.passive) out.push('    No Hellos (Passive interface)')
    else out.push(`    Hello due in 00:00:0${Math.min(9, i.hello - 3)}`)
    const n = (net.ospf.neighbors[dev.id] ?? []).filter((x) => x.iface === i.iface)
    out.push(`  Neighbor Count is ${n.length}, Adjacent neighbor count is ${n.filter((x) => x.state === 'FULL').length}`)
    for (const x of n.filter((y) => y.state === 'FULL')) out.push(`    Adjacent with neighbor ${v4ToStr(x.rid)}${x.role === 'DR' ? '  (Designated Router)' : x.role === 'BDR' ? '  (Backup Designated Router)' : ''}`)
  }
  return out.join('\n')
}

export function ipProtocols(net, dev) {
  const p = ospfProcess(dev)
  const out = ['*** IP Routing is NSF aware ***', '']
  if (!p) return out.join('\n')
  const nets = p.lines.filter((l) => l.startsWith('network')).map((l) => l.split(' '))
  const passive = (net.ospf.ifaces[dev.id] ?? []).filter((i) => i.passive && !i.loop).map((i) => i.iface)
  out.push(`Routing Protocol is "ospf ${p.pid}"`, '  Outgoing update filter list for all interfaces is not set', '  Incoming update filter list for all interfaces is not set')
  out.push(`  Router ID ${dev.rt.ospfRid ?? '0.0.0.0'}`, '  Number of areas in this router is 1. 1 normal 0 stub 0 nssa', `  Maximum path: ${lineValue(p.lines, 'maximum-paths') ?? 4}`, '  Routing for Networks:')
  for (const n of nets) out.push(`    ${n[1]} ${n[2]} area ${n[4]}`)
  const ifcmd = (net.ospf.ifaces[dev.id] ?? []).filter((i) => lineValue(ifaceLines(dev, i.iface), `ip ospf ${p.pid} area`) !== undefined)
  if (ifcmd.length) { out.push('  Routing on Interfaces Configured Explicitly (Area 0):'); for (const i of ifcmd) out.push(`    ${i.iface}`) }
  if (passive.length) { out.push('  Passive Interface(s):'); for (const i of passive) out.push(`    ${i}`) }
  out.push('  Routing Information Sources:', '    Gateway         Distance      Last Update')
  for (const n of net.ospf.neighbors[dev.id] ?? []) if (n.state === 'FULL') out.push(`    ${pad(v4ToStr(n.rid), 16)}${pad(110, 14)}00:01:12`)
  out.push('  Distance: (default is 110)')
  return out.join('\n')
}

// ---------- ACLs ----------

export function accessLists(net, dev, ipOnly, only) {
  const acls = aclTable(dev)
  const hits = net.lab.rt?.aclHits ?? {}
  const out = []
  // IOS lists numbered ACLs first, in numeric order, then named ones
  const names = Object.keys(acls).sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : /^\d+$/.test(a) ? -1 : /^\d+$/.test(b) ? 1 : 0))
  for (const name of names) {
    const acl = acls[name]
    if (only !== undefined && name !== only) continue
    out.push(`${acl.type === 'standard' ? 'Standard' : 'Extended'} IP access list ${name}`)
    for (const e of acl.entries) {
      const h = hits[`${dev.id}|${name}|${e.seq}`]
      // standard ACLs print hosts bare and wildcards as "A.B.C.D, wildcard bits W.X.Y.Z"
      const body = acl.type === 'standard' && !e.body.startsWith('remark') ? e.body.replace(/^(\S+) host /, '$1 ').replace(/^(\S+) (\d+\.\d+\.\d+\.\d+) (\d+\.\d+\.\d+\.\d+)/, '$1 $2, wildcard bits $3') : e.body
      out.push(`    ${e.seq} ${body}${h ? ` (${h} match${h > 1 ? 'es' : ''})` : ''}`)
    }
  }
  void ipOnly
  return out.join('\n')
}

export function ipInterface(net, dev, i) {
  const st = net.ifState[dev.id][i]
  if (!st) return null
  const L = ifaceLines(dev, i)
  const a = (net.addrs[dev.id] ?? []).find((x) => x.iface === i && x.fam === 4 && x.primary)
  const acl = (dir) => {
    const l = L.find((x) => x.startsWith('ip access-group') && x.endsWith(dir))
    return l ? l.split(' ')[2] : 'not set'
  }
  const helpers = L.filter((l) => l.startsWith('ip helper-address')).map((l) => l.split(' ')[2])
  const out = [`${i} is ${st.status}, line protocol is ${st.protocol}`]
  if (a) out.push(`  Internet address is ${v4ToStr(a.addr)}/${a.len}`, '  Broadcast address is 255.255.255.255')
  else out.push('  Internet protocol processing disabled')
  out.push(`  Helper address${helpers.length > 1 ? 'es are' : ' is'} ${helpers.length ? helpers.join('\n                       ') : 'not set'}`)
  out.push(`  Outgoing Common access list is not set`, `  Outgoing access list is ${acl('out')}`, `  Inbound Common access list is not set`, `  Inbound  access list is ${acl('in')}`)
  out.push('  Proxy ARP is enabled', '  ICMP redirects are always sent', `  IP fast switching is enabled`)
  if (hasLine(L, 'ip nat inside')) out.push('  IP NAT inside')
  if (hasLine(L, 'ip nat outside')) out.push('  IP NAT outside')
  return out.join('\n')
}

// ---------- NAT / DHCP ----------

export function natTranslations(net, dev) {
  const out = [`${pad('Pro', 5)}${pad('Inside global', 22)}${pad('Inside local', 22)}${pad('Outside local', 22)}Outside global`]
  for (const s of natStatics(dev)) out.push(`${pad('---', 5)}${pad(v4ToStr(s.global), 22)}${pad(v4ToStr(s.local), 22)}${pad('---', 22)}---`)
  for (const t of dev.rt.nat ?? []) {
    const port = (p) => (p !== undefined ? `:${p}` : '')
    out.push(`${pad(t.proto === 1 ? 'icmp' : t.proto === 6 ? 'tcp' : t.proto === 17 ? 'udp' : '---', 5)}${pad(t.global + port(t.gport), 22)}${pad(t.local + port(t.lport), 22)}${pad(t.outside + port(t.gport), 22)}${t.outside}${port(t.gport)}`)
  }
  out.push(`Total number of translations: ${natStatics(dev).length + (dev.rt.nat ?? []).length}`)
  return out.join('\n')
}

export function natStatistics(net, dev) {
  const inside = interfaces(dev).filter((i) => hasLine(ifaceLines(dev, i), 'ip nat inside'))
  const outside = interfaces(dev).filter((i) => hasLine(ifaceLines(dev, i), 'ip nat outside'))
  const dyn = dev.rt.nat ?? []
  const out = [`Total active translations: ${natStatics(dev).length + dyn.length} (${natStatics(dev).length} static, ${dyn.length} dynamic; ${dyn.filter((d) => d.gport !== undefined).length} extended)`]
  out.push('Outside interfaces:', `  ${outside.join(', ') || ''}`, 'Inside interfaces:', `  ${inside.join(', ') || ''}`)
  out.push(`Hits: ${dyn.length * 5}  Misses: ${dyn.length}`, 'Dynamic mappings:', '-- Inside Source')
  for (const l of globalLines(dev, 'ip nat inside source list')) {
    const m = /list (\S+) (pool (\S+)|interface (\S+))( overload)?/.exec(l)
    out.push(`[Id: 1] access-list ${m[1]} ${m[3] ? `pool ${m[3]}` : `interface ${m[4]}`}${m[5] || m[4] ? ' overload' : ''} refcount ${dyn.length}`)
    if (m[3]) {
      const p = natPools(dev).find((x) => x.name === m[3])
      if (p) out.push(` pool ${p.name}: id 1, netmask ${lineValue(dev.config.global, `ip nat pool ${p.name}`)?.split(' ').slice(3).join(' ')}`, `\tstart ${v4ToStr(p.start)} end ${v4ToStr(p.end)}`, `\ttype generic, total addresses ${Number(p.end - p.start) + 1}, allocated ${dyn.length}`)
    }
  }
  return out.join('\n')
}

export function dhcpBinding(net, dev) {
  const out = ['Bindings from all pools not associated with VRF:', `${pad('IP address', 18)}${pad('Client-ID/', 23)}${pad('Lease expiration', 25)}Type       State      Interface`, `${' '.repeat(18)}${pad('Hardware address/', 23)}`, `${' '.repeat(18)}User name`]
  for (const l of dev.rt.leases ?? []) out.push(`${pad(l.ip, 18)}${pad(('01' + l.mac.replace(/\./g, '')).replace(/(.{4})(?=.)/g, '$1.'), 23)}${pad('Oct 10 2026 02:14 PM', 25)}Automatic  Active     Unknown`)
  return out.join('\n')
}

export function dhcpPool(net, dev) {
  const out = []
  for (const p of poolsOf(dev)) {
    const leased = (dev.rt.leases ?? []).filter((l) => l.pool === p.name).length
    const size = 2 ** (32 - p.len) - 2
    // excluded addresses that fall inside this pool's subnet
    let excl = 0
    for (const l of globalLines(dev, 'ip dhcp excluded-address')) {
      const [a, b] = l.split(' ').slice(3).map(parseV4)
      if (a === null) continue
      const lo = a > p.network + 1n ? a : p.network + 1n
      const hi = (b ?? a) < p.network + BigInt(size) ? (b ?? a) : p.network + BigInt(size)
      if (hi >= lo) excl += Number(hi - lo + 1n)
    }
    out.push('', `Pool ${p.name} :`, ' Utilization mark (high/low)    : 100 / 0', ' Subnet size (first/next)       : 0 / 0', ` Total addresses                : ${size}`, ` Leased addresses               : ${leased}`, ` Excluded addresses             : ${excl}`, ' Pending event                  : none')
    out.push(' 1 subnet is currently in the pool :', ' Current index        IP address range                    Leased/Excluded/Total')
    out.push(` ${pad(v4ToStr(p.network + 1n + BigInt(leased + excl)), 21)}${pad(`${v4ToStr(p.network + 1n)}      - ${v4ToStr(p.network + BigInt(size))}`, 36)}${leased} / ${excl} / ${size}`)
  }
  return out.join('\n')
}

// ---------- FHRP ----------

export function standbyBrief(net, dev) {
  const out = ['                     P indicates configured to preempt.', '                     |', `${pad('Interface', 11)}${pad('Grp', 5)}${pad('Pri', 4)}P ${pad('State', 9)}${pad('Active', 16)}${pad('Standby', 16)}Virtual IP`]
  for (const [key, groups] of Object.entries(net.hsrp)) {
    if (!key.startsWith(dev.id + '|')) continue
    const i = key.split('|')[1]
    for (const g of groups) {
      const act = g.state === 'Active' ? 'local' : g.activeIp ? v4ToStr(g.activeIp) : 'unknown'
      const sb = g.state === 'Standby' ? 'local' : g.standbyIp ? v4ToStr(g.standbyIp) : 'unknown'
      out.push(`${pad(sh(i), 11)}${pad(g.group, 5)}${pad(g.priority, 4)}${g.preempt ? 'P' : ' '} ${pad(g.state, 9)}${pad(act, 16)}${pad(sb, 16)}${g.vipResolved ?? 'unknown'}`)
    }
  }
  return out.join('\n')
}

export function standby(net, dev) {
  const out = []
  for (const [key, groups] of Object.entries(net.hsrp)) {
    if (!key.startsWith(dev.id + '|')) continue
    const i = key.split('|')[1]
    for (const g of groups) {
      const vmac = g.version === 2 ? `0000.0c9f.f${g.group.toString(16).padStart(3, '0')}` : `0000.0c07.ac${g.group.toString(16).padStart(2, '0')}`
      out.push(`${i} - Group ${g.group}${g.version === 2 ? ' (version 2)' : ''}`, `  State is ${g.state}`, `  Virtual IP address is ${g.vipResolved ?? 'unknown'}`, `  Active virtual MAC address is ${vmac} (MAC ${g.state === 'Active' ? 'In Use' : 'Not In Use'})`, '  Hello time 3 sec, hold time 10 sec')
      out.push(`  Preemption ${g.preempt ? 'enabled' : 'disabled'}`)
      out.push(`  Active router is ${g.state === 'Active' ? 'local' : g.activeIp ? v4ToStr(g.activeIp) : 'unknown'}`)
      out.push(`  Standby router is ${g.state === 'Standby' ? 'local' : g.standbyIp ? v4ToStr(g.standbyIp) : 'unknown'}`)
      out.push(`  Priority ${g.priority} (${g.priority === 100 ? 'default 100' : 'configured ' + g.priority})`, `  Group name is "hsrp-${sh(i)}-${g.group}" (default)`)
    }
  }
  return out.join('\n')
}

// ---------- management protocols ----------

export function ntpState(net, dev) {
  const servers = globalLines(dev, 'ntp server').map((l) => l.split(' ')[2])
  const master = lineValue(dev.config.global, 'ntp master')
  const res = []
  for (const s of servers) {
    const a = parseV4(s)
    const rt = a !== null ? roundTrip(net, dev.id, 4, a, { proto: 'udp', sport: 123, dport: 123 }) : { ok: false }
    const peer = rt.ok ? net.byId[rt.out.dev] : null
    const pm = peer && isIos(peer) ? lineValue(peer.config.global, 'ntp master') : undefined
    const stratum = peer && pm !== undefined ? Number(pm || 8) : null
    res.push({ server: s, ok: rt.ok && stratum !== null, stratum })
  }
  return { servers: res, master: master !== undefined ? Number(master || 8) : null }
}

export function ntpAssociations(net, dev) {
  const st = ntpState(net, dev)
  const out = ['', '  address         ref clock       st   when   poll reach  delay  offset   disp']
  if (st.master !== null) out.push(` ~127.127.1.1     .LOCL.          ${st.master - 1}     12     16   377  0.000   0.000  0.240`)
  for (const s of st.servers) out.push(`${s.ok ? '*~' : ' ~'}${pad(s.server, 16)}${pad(s.ok ? '127.127.1.1' : '.INIT.', 16)}${pad(s.ok ? s.stratum : 16, 5)}${pad(s.ok ? 23 : '-', 7)}${pad(64, 6)}${pad(s.ok ? 377 : 0, 6)}${s.ok ? '1.024   0.512  1.893' : '0.000   0.000 15937.'}`)
  out.push(' * sys.peer, # selected, + candidate, - outlyer, x falseticker, ~ configured')
  return out.join('\n')
}

export function ntpStatus(net, dev) {
  const st = ntpState(net, dev)
  const synced = st.servers.find((s) => s.ok)
  if (st.master !== null && !synced) return `Clock is synchronized, stratum ${st.master}, reference is 127.127.1.1\nnominal freq is 250.0000 Hz, actual freq is 250.0000 Hz, precision is 2**10`
  if (synced) return `Clock is synchronized, stratum ${synced.stratum + 1}, reference is ${synced.server}\nnominal freq is 250.0000 Hz, actual freq is 250.0000 Hz, precision is 2**10\nntp uptime is 1500 (1/100 of seconds), resolution is 4000`
  return 'Clock is unsynchronized, stratum 16, no reference clock\nnominal freq is 250.0000 Hz, actual freq is 250.0000 Hz, precision is 2**10'
}

const LEVELS = ['emergencies', 'alerts', 'critical', 'errors', 'warnings', 'notifications', 'informational', 'debugging']
export const levelNum = (v) => (v === undefined ? null : /^\d$/.test(v) ? Number(v) : LEVELS.indexOf(v))
export const levelName = (n) => LEVELS[n]

export function showLogging(net, dev) {
  const g = dev.config.global
  const trap = levelNum(lineValue(g, 'logging trap')) ?? 6
  const buffered = lineValue(g, 'logging buffered')
  const bufLevel = buffered !== undefined ? (levelNum(buffered.split(' ').find((x) => !/^\d{4,}$/.test(x))) ?? 7) : 7
  const consoleLvl = levelNum(lineValue(g, 'logging console')) ?? 7
  const hosts = globalLines(dev, 'logging host').map((l) => l.split(' ')[2])
  const out = ['Syslog logging: enabled (0 messages dropped, 3 messages rate-limited, 0 flushes, 0 overruns, xml disabled, filtering disabled)', '']
  out.push(`    Console logging: ${hasLine(g, 'no logging console') ? 'disabled' : `level ${levelName(consoleLvl)}, ${dev.rt.log.length} messages logged, xml disabled,`}`)
  out.push('                     filtering disabled', `    Monitor logging: level debugging, 0 messages logged, xml disabled,`, '                     filtering disabled')
  out.push(`    Buffer logging:  level ${levelName(bufLevel)}, ${dev.rt.log.length} messages logged, xml disabled,`, '                    filtering disabled')
  out.push(`    Trap logging: level ${levelName(trap)}, ${dev.rt.log.length + 12} message lines logged`)
  for (const h of hosts) out.push(`        Logging to ${h}  (udp port 514, audit disabled,`, '              link up),', `              ${dev.rt.log.length} message lines logged,`, '              0 message lines rate-limited,')
  out.push('', `Log Buffer (8192 bytes):`, '')
  for (const e of dev.rt.log.slice(-40)) out.push(e)
  return out.join('\n')
}

const caps = (d) => (d.kind === 'router' ? 'R B S I' : d.kind === 'l3switch' ? 'R S I' : 'S I')

export function cdpNeighbors(net, dev, detail) {
  const enabledGlobally = (d) => !hasLine(d.config.global, 'no cdp run')
  const entries = []
  if (!enabledGlobally(dev)) return '% CDP is not enabled'
  for (const [a, ai, b, bi] of net.lab.links) {
    let me = null
    if (a === dev.id) me = { li: ai, pd: b, pi: bi }
    else if (b === dev.id) me = { li: bi, pd: a, pi: ai }
    if (!me) continue
    const pd = net.byId[me.pd]
    if (!isIos(pd) || !enabledGlobally(pd)) continue
    if (hasLine(ifaceLines(dev, me.li), 'no cdp enable') || hasLine(ifaceLines(pd, me.pi), 'no cdp enable')) continue
    if (net.ifState[dev.id][me.li]?.status !== 'up') continue
    entries.push({ ...me, pdev: pd })
  }
  if (detail) {
    const out = []
    for (const e of entries) {
      const a = usableAddrs(net, e.pd).find((x) => x.fam === 4)
      out.push('-------------------------', `Device ID: ${hostname(e.pdev)}`, 'Entry address(es): ', ...(a ? [`  IP address: ${v4ToStr(a.addr)}`] : []), `Platform: cisco ${e.pdev.model},  Capabilities: ${e.pdev.kind === 'router' ? 'Router Source-Route-Bridge Switch IGMP' : 'Switch IGMP'}`, `Interface: ${e.li},  Port ID (outgoing port): ${e.pi}`, 'Holdtime : 146 sec', '', 'Version :', 'Cisco IOS Software [Cupertino], Version 17.9.4a, RELEASE SOFTWARE (fc3)', '', 'advertisement version: 2', `Native VLAN: ${swConfig(e.pdev, e.pi)?.native ?? 1}`, `Duplex: full`, '')
    }
    out.push(`Total cdp entries displayed : ${entries.length}`)
    return out.join('\n')
  }
  const out = ['Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge', '                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone,', '                  D - Remote, C - CVTA, M - Two-port Mac Relay', '', `${pad('Device ID', 17)}${pad('Local Intrfce', 18)}${pad('Holdtme', 10)}${pad('Capability', 12)}${pad('Platform', 10)}Port ID`]
  for (const e of entries) out.push(`${pad(hostname(e.pdev), 17)}${pad(sh(e.li), 18)}${pad(146, 10)}${pad(caps(e.pdev), 12)}${pad(e.pdev.model.slice(0, 9), 10)}${sh(e.pi)}`)
  out.push('', `Total cdp entries displayed : ${entries.length}`)
  return out.join('\n')
}

export function lldpNeighbors(net, dev) {
  if (!hasLine(dev.config.global, 'lldp run')) return '% LLDP is not enabled'
  const entries = []
  for (const [a, ai, b, bi] of net.lab.links) {
    let me = null
    if (a === dev.id) me = { li: ai, pd: b, pi: bi }
    else if (b === dev.id) me = { li: bi, pd: a, pi: ai }
    if (!me) continue
    const pd = net.byId[me.pd]
    if (!isIos(pd) || !hasLine(pd.config.global, 'lldp run')) continue
    if (net.ifState[dev.id][me.li]?.status !== 'up') continue
    entries.push({ ...me, pdev: pd })
  }
  const out = ['Capability codes:', '    (R) Router, (B) Bridge, (T) Telephone, (C) DOCSIS Cable Device', '    (W) WLAN Access Point, (P) Repeater, (S) Station, (O) Other', '', `${pad('Device ID', 21)}${pad('Local Intf', 15)}${pad('Hold-time', 11)}${pad('Capability', 15)}Port ID`]
  for (const e of entries) out.push(`${pad(hostname(e.pdev), 21)}${pad(sh(e.li), 15)}${pad(120, 11)}${pad(e.pdev.kind === 'router' ? 'R' : 'B', 15)}${sh(e.pi)}`)
  out.push('', `Total entries displayed: ${entries.length}`)
  return out.join('\n')
}

// ---------- L2 security ----------

function psInfo(net, dev, p) {
  const L = ifaceLines(dev, p)
  if (!L.includes('switchport port-security')) return null
  const max = Number(lineValue(L, 'switchport port-security maximum') ?? 1)
  const mode = lineValue(L, 'switchport port-security violation') ?? 'shutdown'
  const sticky = L.filter((l) => /^switchport port-security mac-address sticky \S+$/.test(l)).map((l) => l.split(' ').pop())
  const statics = L.filter((l) => /^switchport port-security mac-address [0-9a-f.]+$/.test(l)).map((l) => l.split(' ').pop())
  const peer = net.peerOf[`${dev.id}|${p}`]
  const pd = peer && net.byId[peer.dev]
  const dynamic = pd && !isIos(pd) && net.ifState[dev.id][p]?.protocol === 'up' && !L.includes('switchport port-security mac-address sticky') && !net.psDrop?.has(`${dev.id}|${p}`) && statics.length < max ? [macToStr(macBig(pd))].filter((m) => !statics.includes(m)) : []
  const violations = dev.rt.psViolations?.[p] ?? 0
  return { max, mode, sticky, statics, dynamic, total: sticky.length + statics.length + dynamic.length, stickyOn: L.includes('switchport port-security mac-address sticky'), violations, last: dev.rt.psLast?.[p] }
}

export function portSecurity(net, dev, only) {
  if (!isSwitch(dev)) return null
  if (only) {
    const i = psInfo(net, dev, only)
    const st = net.ifState[dev.id][only]
    return [
      `Port Security              : ${i ? 'Enabled' : 'Disabled'}`,
      `Port Status                : ${!i ? 'Secure-down' : st?.reason === 'err-disabled' ? 'Secure-shutdown' : st?.protocol === 'up' ? 'Secure-up' : 'Secure-down'}`,
      `Violation Mode             : ${i ? i.mode[0].toUpperCase() + i.mode.slice(1) : 'Shutdown'}`,
      'Aging Time                 : 0 mins',
      'Aging Type                 : Absolute',
      'SecureStatic Address Aging : Disabled',
      `Maximum MAC Addresses      : ${i?.max ?? 1}`,
      `Total MAC Addresses        : ${i?.total ?? 0}`,
      `Configured MAC Addresses   : ${i?.statics.length ?? 0}`,
      `Sticky MAC Addresses       : ${i?.sticky.length ?? 0}`,
      `Last Source Address:Vlan   : ${i && (i.last || i.total) ? (i.last ?? [...i.sticky, ...i.statics, ...i.dynamic][0]) + ':' + (swConfig(dev, only)?.accessVlan ?? 1) : '0000.0000.0000:0'}`,
      `Security Violation Count   : ${i?.violations ?? 0}`,
    ].join('\n')
  }
  const out = ['Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action', '                (Count)       (Count)          (Count)', '---------------------------------------------------------------------------']
  for (const p of dev.ports) {
    const i = psInfo(net, dev, p)
    if (!i) continue
    out.push(`${pad(lpad(sh(p), 11), 13)}${lpad(i.max, 13)}${lpad(i.total, 13)}${lpad(i.violations, 19)}${lpad(i.mode[0].toUpperCase() + i.mode.slice(1), 17)}`)
  }
  out.push('---------------------------------------------------------------------------', 'Total Addresses in System (excluding one mac per port)     : 0', 'Max Addresses limit in System (excluding one mac per port) : 4096')
  return out.join('\n')
}

export function portSecurityAddress(net, dev) {
  const out = ['               Secure Mac Address Table', '-----------------------------------------------------------------------------', 'Vlan    Mac Address       Type                          Ports   Remaining Age', '                                                                   (mins)', '----    -----------       ----                          -----   -------------']
  for (const p of dev.ports) {
    const i = psInfo(net, dev, p)
    if (!i) continue
    const v = swConfig(dev, p)?.accessVlan ?? 1
    for (const m of i.sticky) out.push(`${lpad(v, 4)}    ${pad(m, 18)}${pad('SecureSticky', 30)}${pad(sh(p), 8)}-`)
    for (const m of i.statics) out.push(`${lpad(v, 4)}    ${pad(m, 18)}${pad('SecureConfigured', 30)}${pad(sh(p), 8)}-`)
    for (const m of i.dynamic) out.push(`${lpad(v, 4)}    ${pad(m, 18)}${pad('SecureDynamic', 30)}${pad(sh(p), 8)}-`)
  }
  return out.join('\n')
}

export function snooping(net, dev) {
  const g = dev.config.global
  const on = g.includes('ip dhcp snooping')
  const vlans = globalLines(dev, 'ip dhcp snooping vlan').map((l) => l.split(' ')[4]).join(',')
  const out = [`Switch DHCP snooping is ${on ? 'enabled' : 'disabled'}`, 'Switch DHCP gleaning is disabled', 'DHCP snooping is configured on following VLANs:', vlans || 'none', 'DHCP snooping is operational on following VLANs:', on ? vlans || 'none' : 'none']
  out.push(`Insertion of option 82 is ${hasLine(g, 'no ip dhcp snooping information option') ? 'disabled' : 'enabled'}`, '   circuit-id default format: vlan-mod-port', '   remote-id: ' + macToStr(macBig(dev)) + ' (MAC)')
  out.push('', `${pad('Interface', 27)}${pad('Trusted', 12)}${pad('Allow option', 16)}Rate limit (pps)`, `${'-'.repeat(25)}  ${'-'.repeat(10)} ${'-'.repeat(15)} ${'-'.repeat(16)}`)
  for (const p of dev.ports) {
    const L = ifaceLines(dev, p)
    const trusted = hasLine(L, 'ip dhcp snooping trust')
    const rate = lineValue(L, 'ip dhcp snooping limit rate')
    if (trusted || rate) out.push(`${pad(p, 27)}${pad(trusted ? 'yes' : 'no', 12)}${pad(trusted ? 'yes' : 'no', 16)}${rate ?? 'unlimited'}`)
  }
  return out.join('\n')
}

export function snoopingBinding(net, dev) {
  const b = dev.rt.snoopBindings ?? []
  const out = [`${pad('MacAddress', 20)}${pad('IpAddress', 17)}${pad('Lease(sec)', 12)}${pad('Type', 15)}${pad('VLAN', 7)}Interface`, `${'-'.repeat(19)}  ${'-'.repeat(15)}  ${'-'.repeat(10)}  ${'-'.repeat(13)}  ${'-'.repeat(4)}  ${'-'.repeat(20)}`]
  for (const x of b) out.push(`${pad(x.mac.toUpperCase().replace(/\./g, '').replace(/(..)(?!$)/g, '$1:'), 20)}${pad(x.ip, 17)}${pad(86133, 12)}${pad('dhcp-snooping', 15)}${pad(x.vlan, 7)}${x.iface}`)
  out.push(`Total number of bindings: ${b.length}`)
  return out.join('\n')
}

export function arpInspection(net, dev) {
  const vlans = new Set()
  for (const l of globalLines(dev, 'ip arp inspection vlan')) {
    const list = parseVlanList(l.split(' ')[4])
    if (list && list !== 'all') for (const v of list) vlans.add(v)
  }
  const out = ['', 'Source Mac Validation      : Disabled', 'Destination Mac Validation : Disabled', 'IP Address Validation      : Disabled', '', ' Vlan     Configuration    Operation   ACL Match          Static ACL', ' ----     -------------    ---------   ---------          ----------']
  for (const v of [...vlans].sort((a, b) => a - b)) out.push(`${lpad(v, 5)}     Enabled          Active`)
  out.push('', ' Vlan     ACL Logging      DHCP Logging      Probe Logging', ' ----     -----------      ------------      -------------')
  for (const v of [...vlans].sort((a, b) => a - b)) out.push(`${lpad(v, 5)}     Deny             Deny              Off`)
  out.push('', ` Interface        Trust State     Rate (pps)    Burst Interval`, ' ---------------  -----------     ----------    --------------')
  for (const p of dev.ports) {
    const L = ifaceLines(dev, p)
    if (!vlans.size) break
    const trusted = hasLine(L, 'ip arp inspection trust')
    if (swConfig(dev, p)?.mode !== 'routed') out.push(` ${pad(sh(p), 17)}${pad(trusted ? 'Trusted' : 'Untrusted', 16)}${pad(trusted ? 'None' : 15, 14)}${trusted ? 'N/A' : 1}`)
  }
  return out.join('\n')
}

// ---------- misc ----------

export function showVersion(net, dev) {
  const isR = dev.kind === 'router'
  return [
    `Cisco IOS XE Software, Version 17.09.04a`,
    `Cisco IOS Software [Cupertino], ${isR ? 'ISR Software (X86_64_LINUX_IOSD-UNIVERSALK9-M)' : 'Catalyst L3 Switch Software (CAT9K_IOSXE)'}, Version 17.9.4a, RELEASE SOFTWARE (fc3)`,
    'Technical Support: http://www.cisco.com/techsupport',
    '',
    `${hostname(dev)} uptime is 2 hours, 14 minutes`,
    `System image file is "bootflash:${isR ? 'isr4300-universalk9.17.09.04a.SPA.bin' : 'packages.conf'}"`,
    '',
    `cisco ${dev.model} (${isR ? '1RU' : 'ARM64'}) processor with 1795999K/6147K bytes of memory.`,
    `${dev.ports.length} Gigabit Ethernet interfaces`,
    '32768K bytes of non-volatile configuration memory.',
    '',
    'Configuration register is 0x2102',
  ].join('\n')
}

export function showArp(net, dev) {
  const out = [`${pad('Protocol', 10)}${pad('Address', 17)}${pad('Age (min)', 11)}${pad('Hardware Addr', 16)}${pad('Type', 6)}Interface`]
  for (const a of usableAddrs(net, dev.id).filter((x) => x.fam === 4)) {
    out.push(`${pad('Internet', 10)}${pad(v4ToStr(a.addr), 17)}${pad('-', 11)}${pad(macToStr(ifaceMac(dev, a.iface)), 16)}${pad('ARPA', 6)}${a.iface}`)
    for (const m of segMembers(net, segOf(net, dev.id, a.iface))) {
      if (m.dev === dev.id) continue
      const pa = usableAddrs(net, m.dev).find((x) => x.iface === m.iface && x.fam === 4)
      if (!pa || ((pa.addr ^ a.addr) >> BigInt(32 - a.len)) !== 0n || !(dev.rt.arp ?? []).includes(v4ToStr(pa.addr))) continue
      out.push(`${pad('Internet', 10)}${pad(v4ToStr(pa.addr), 17)}${pad(2, 11)}${pad(macToStr(ifaceMac(net.byId[m.dev], m.iface)), 16)}${pad('ARPA', 6)}${a.iface}`)
    }
  }
  return out.join('\n')
}

export function ipv6Neighbors(net, dev) {
  const out = [`${pad('IPv6 Address', 41)}${pad('Age', 4)}${pad('Link-layer Addr', 16)}${pad('State', 6)}Interface`]
  for (const a of usableAddrs(net, dev.id).filter((x) => x.fam === 6 && x.linkLocal)) {
    for (const m of segMembers(net, segOf(net, dev.id, a.iface))) {
      if (m.dev === dev.id) continue
      for (const pa of usableAddrs(net, m.dev).filter((x) => x.iface === m.iface && x.fam === 6)) {
        if (!(dev.rt.nd ?? []).includes(v6ToStr(pa.addr)) && !pa.linkLocal) continue
        out.push(`${pad(v6ToStr(pa.addr), 41)}${pad(0, 4)}${pad(macToStr(ifaceMac(net.byId[m.dev], m.iface)), 16)}${pad('REACH', 6)}${sh(a.iface)}`)
      }
    }
  }
  return out.join('\n')
}

export function showIpSsh(dev) {
  const v = lineValue(dev.config.global, 'ip ssh version')
  if (!dev.rt.rsaBits) return 'SSH Disabled - version 1.99\n%Please create RSA keys to enable SSH (and of atleast 768 bits for SSH v2).\nAuthentication methods:publickey,keyboard-interactive,password\nAuthentication timeout: 120 secs; Authentication retries: 3'
  return `SSH Enabled - version ${v === '2' ? '2.0' : '1.99'}\nAuthentication methods:publickey,keyboard-interactive,password\nAuthentication Publickey Algorithms:x509v3-ssh-rsa,ssh-rsa\nHostkey Algorithms:x509v3-ssh-rsa,rsa-sha2-512,rsa-sha2-256,ssh-rsa\nEncryption Algorithms:aes128-gcm,aes256-gcm,aes128-ctr,aes192-ctr,aes256-ctr\nMAC Algorithms:hmac-sha2-256-etm@openssh.com,hmac-sha2-512-etm@openssh.com,hmac-sha2-256,hmac-sha2-512\nAuthentication timeout: 120 secs; Authentication retries: 3\nMinimum expected Diffie Hellman key size : 2048 bits\nIOS Keys in SECSH format(ssh-rsa, base64 encoded): ${hostname(dev)}\nModulus Size : ${dev.rt.rsaBits} bits`
}

export { prefixToStr, lenToMask }
