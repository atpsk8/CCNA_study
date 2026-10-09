// IOS command-line emulation: modes, abbreviations, help, and every supported command.

import { parseV4, maskToLen, v4ToStr, parseV6, parseV6Prefix, parseVlanList, networkOf, v6ToStr, lenToMask } from './ip.js'
import { canonicalIface, expandRange, isSubif, parentOf, ifaceType, isPhysical } from './iface.js'
import {
  hostname, isIos, isSwitch, ensureSection, getSection, removeSection, setLine, removeLines, ifaceLines, lineValue,
  hasLine, interfaces, globalLines, setGlobal, type7, fakeHash, renderRunning, tokens as tok, startsWithTokens, sectionsOf,
} from './device.js'
import { compileAce, aclTable, roundTrip, ospfProcess, routesEnabled, lookup, forward, dhcpRequest, vlanDb, swConfig } from './network.js'
import * as S from './show.js'

// ======================================================================
// Grammar
// ======================================================================
// Modes: user, priv, config, if, subif, range, router, line, vlan, acl, dhcp
// Pattern tokens: literal | a|b (value choice) | <type> | token? (optional)
// Types: ip mask wild num word text iface vlist v6pfx v6 any

const IFM = ['if', 'subif', 'range']
const SUB = ['if', 'subif', 'range', 'router', 'line', 'vlan', 'acl', 'dhcp']
const CFG = ['config', ...SUB]

const T = [] // templates
function cmd(modes, pattern, run, opts = {}) {
  T.push({ modes, pattern, toks: parsePattern(pattern), run, ...opts })
}

function parsePattern(p) {
  return p.split(' ').map((w) => {
    const optional = w.endsWith('?') && w.length > 1
    if (optional) w = w.slice(0, -1)
    const m = /^<(\w+)(?::(\d+)-(\d+))?>$/.exec(w)
    if (m) return { ph: m[1], min: m[2] ? Number(m[2]) : null, max: m[3] ? Number(m[3]) : null, optional }
    const alts = w.split('|')
    return { lit: alts, value: alts.length > 1, optional }
  })
}

const HELP_TYPE = { ip: 'A.B.C.D', mask: 'A.B.C.D', wild: 'A.B.C.D', num: '<0-4294967295>', word: 'WORD', text: 'LINE', iface: 'Interface', vlist: 'WORD', v6pfx: 'X:X:X:X::X/<0-128>', v6: 'X:X:X:X::X', any: 'WORD' }

// ---------- exec commands ----------
cmd(['user'], 'enable', (c) => c.enable())
cmd(['priv'], 'enable', () => '')
cmd(['user', 'priv'], 'exit', (c) => c.exitExec())
cmd(['user', 'priv'], 'logout', (c) => c.exitExec())
cmd(['priv'], 'disable', (c) => { c.ctx.mode = 'user' })
cmd(['priv'], 'configure terminal', (c) => { c.ctx.mode = 'config'; return 'Enter configuration commands, one per line.  End with CNTL/Z.' })
// Saving also keeps the RSA key pair in NVRAM, so SSH still works after a reload
const saveConfig = (c) => { c.dev.startup = JSON.parse(JSON.stringify(c.dev.config)); c.dev.startupRsa = c.dev.rt.rsaBits; return 'Building configuration...\n[OK]' }
cmd(['priv'], 'copy running-config startup-config', (c) => c.ask('Destination filename [startup-config]? ', () => saveConfig(c)))
cmd(['priv'], 'write memory?', (c) => saveConfig(c))
cmd(['priv'], 'erase startup-config', (c) => c.ask('Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]', () => { c.dev.startup = null; return '[OK]\nErase of nvram: complete' }))
cmd(['priv'], 'reload', (c) => c.ask('Proceed with reload? [confirm]', () => c.engine.reload(c.dev.id)))
cmd(['priv'], 'clear ip ospf process', (c) => c.ask('Reset ALL OSPF processes? [no]: ', (a) => {
  if (!/^y/i.test(a)) return ''
  c.dev.rt.ospfStarted = false
  for (const st of Object.values(c.engine.rt.ospfDr ?? {})) {
    if (st.dr?.startsWith(c.dev.id + '|')) st.dr = null
    if (st.bdr?.startsWith(c.dev.id + '|')) st.bdr = null
  }
  c.engine.markDirty()
  return ''
}))
cmd(['priv'], 'clear ip nat translation *', (c) => { c.dev.rt.nat = []; c.engine.markDirty() })
cmd(['priv'], 'clear ip dhcp binding *', (c) => { c.dev.rt.leases = []; c.engine.markDirty() })
cmd(['priv'], 'clear mac address-table dynamic', () => '')
cmd(['priv'], 'clear counters', (c) => c.ask('Clear "show interface" counters on all interfaces [confirm]', () => ''))
cmd(['priv'], 'clear arp-cache', (c) => { c.dev.rt.arp = []; return '' })
cmd(['priv'], 'terminal monitor', () => '')
cmd(['priv'], 'terminal length <num>', () => '')
cmd(['priv'], 'terminal no monitor', () => '')
cmd(['user', 'priv'], 'ping <any>', (c, v) => c.ping(v[0]))
cmd(['user', 'priv'], 'ping <any> source <any>', (c, v) => c.ping(v[0], { source: v[1] }))
cmd(['user', 'priv'], 'ping <any> repeat <num:1-100>', (c, v) => c.ping(v[0], { repeat: v[1] }))
cmd(['user', 'priv'], 'ping <any> source <any> repeat <num:1-100>', (c, v) => c.ping(v[0], { source: v[1], repeat: v[2] }))
cmd(['user', 'priv'], 'ping <any> repeat <num:1-100> source <any>', (c, v) => c.ping(v[0], { repeat: v[1], source: v[2] }))
cmd(['user', 'priv'], 'ping ipv6 <any>', (c, v) => c.ping(v[0], { v6: true }))
cmd(['user', 'priv'], 'traceroute <any>', (c, v) => c.traceroute(v[0]))
cmd(['user', 'priv'], 'traceroute <any> source <any>', (c, v) => c.traceroute(v[0], { source: v[1] }))
cmd(['user', 'priv'], 'ssh -l <word> <ip>', (c, v) => c.remote('ssh', v[1], v[0]))
cmd(['user', 'priv'], 'telnet <ip>', (c, v) => c.remote('telnet', v[0]))
cmd(['user', 'priv'], 'show privilege', (c) => `Current privilege level is ${c.ctx.mode === 'user' ? 1 : 15}`)
cmd(['user', 'priv'], 'show history', (c) => c.session.history.slice(-10).map((h) => '  ' + h).join('\n'))

// ---------- show ----------
const showCmd = (pattern, fn, userOk = true) => cmd(userOk ? ['user', 'priv'] : ['priv'], `show ${pattern}`, (c, v) => {
  const out = fn(c.net, c.dev, v, c)
  return out === null ? '% This command applies to a different device type.' : out
})
showCmd('running-config', (n, d) => renderRunning(d), false)
showCmd('running-config interface <iface>', (n, d, v) => {
  const s = getSection(d, `interface ${v[0]}`)
  return s ? `Building configuration...\n\nCurrent configuration : ${s.lines.join('').length + 40} bytes\n!\n${s.head}\n${s.lines.map((l) => ' ' + l).join('\n')}\nend` : '%Invalid interface'
}, false)
showCmd('startup-config', (n, d) => (d.startup ? renderRunning({ ...d, config: d.startup }).replace('Current configuration', 'Using') : 'startup-config is not present'), false)
showCmd('version', (n, d) => S.showVersion(n, d))
showCmd('clock', () => `*${new Date().toTimeString().slice(0, 8)}.512 UTC ${new Date().toDateString()}`)
showCmd('ip interface brief', (n, d) => S.ipIntBrief(n, d))
showCmd('ip interface <iface>', (n, d, v) => S.ipInterface(n, d, v[0]) ?? '%Invalid interface')
showCmd('ip interface', (n, d) => interfaces(d).map((i) => S.ipInterface(n, d, i)).join('\n'))
showCmd('interfaces', (n, d) => S.showInterfaces(n, d))
showCmd('interfaces <iface>', (n, d, v) => S.showInterfaces(n, d, v[0]) ?? '%Invalid interface')
showCmd('interfaces status', (n, d) => S.interfacesStatus(n, d))
showCmd('interfaces description', (n, d) => S.interfacesDescription(n, d))
showCmd('interfaces status err-disabled', (n, d) => S.interfacesStatus(n, d, 'err-disabled'))
showCmd('interfaces trunk', (n, d) => S.interfacesTrunk(n, d))
showCmd('interfaces <iface> switchport', (n, d, v) => S.interfaceSwitchport(n, d, v[0]))
showCmd('vlan brief', (n, d) => S.vlanBrief(n, d))
showCmd('vlan', (n, d) => S.vlanBrief(n, d))
showCmd('mac address-table', (n, d) => S.showMac(n, d))
showCmd('mac address-table dynamic', (n, d) => S.showMac(n, d))
showCmd('spanning-tree', (n, d) => S.spanningTree(n, d))
showCmd('spanning-tree vlan <num:1-4094>', (n, d, v) => S.spanningTree(n, d, v[0]))
showCmd('spanning-tree summary', (n, d) => S.stpSummary(n, d))
showCmd('etherchannel summary', (n, d) => S.etherchannelSummary(n, d))
showCmd('etherchannel port-channel', (n, d) => S.etherchannelSummary(n, d))
showCmd('lacp neighbor', (n, d) => S.etherchannelSummary(n, d))
showCmd('ip route', (n, d) => S.ipRoute(n, d))
showCmd('ip route static', (n, d) => S.ipRoute(n, d, { code: ['S', 'S*'] }))
showCmd('ip route connected', (n, d) => S.ipRoute(n, d, { code: ['C', 'L'] }))
showCmd('ip route ospf', (n, d) => S.ipRoute(n, d, { code: ['O', 'O*E2'] }))
showCmd('ip route <ip>', (n, d, v) => S.ipRoute(n, d, { addr: parseV4(v[0]) }))
showCmd('ipv6 route', (n, d) => S.ipv6Route(n, d))
showCmd('ipv6 route static', (n, d) => S.ipv6Route(n, d, ['S']))
showCmd('ipv6 interface brief', (n, d) => S.ipv6IntBrief(n, d))
showCmd('ipv6 interface <iface>', (n, d, v) => S.ipv6Interface(n, d, v[0]) ?? '%Invalid interface')
showCmd('ipv6 neighbors', (n, d) => S.ipv6Neighbors(n, d))
showCmd('ip ospf neighbor', (n, d) => S.ospfNeighbor(n, d))
showCmd('ip ospf interface', (n, d) => S.ospfInterface(n, d))
showCmd('ip ospf interface brief', (n, d) => S.ospfIntBrief(n, d))
showCmd('ip ospf interface <iface>', (n, d, v) => S.ospfInterface(n, d, v[0]))
showCmd('ip ospf', (n, d) => (ospfProcess(d) ? ` Routing Process "ospf ${ospfProcess(d).pid}" with ID ${d.rt.ospfRid ?? '0.0.0.0'}\n Start time: 00:00:12.391, Time elapsed: 02:13:01.004\n Supports only single TOS(TOS0) routes\n Router is not originating router-LSAs with maximum metric\n Reference bandwidth unit is ${lineValue(ospfProcess(d).lines, 'auto-cost reference-bandwidth') ?? 100} mbps\n    Area BACKBONE(0)\n        Number of interfaces in this area is ${(n.ospf.ifaces[d.id] ?? []).length}` : ''))
showCmd('ip protocols', (n, d) => S.ipProtocols(n, d))
showCmd('access-lists', (n, d) => S.accessLists(n, d))
showCmd('ip access-lists', (n, d) => S.accessLists(n, d, true))
showCmd('access-lists <word>', (n, d, v) => S.accessLists(n, d, false, v[0]))
showCmd('ip access-lists <word>', (n, d, v) => S.accessLists(n, d, true, v[0]))
showCmd('ip nat translations', (n, d) => S.natTranslations(n, d))
showCmd('ip nat statistics', (n, d) => S.natStatistics(n, d))
showCmd('ip dhcp binding', (n, d) => S.dhcpBinding(n, d))
showCmd('ip dhcp pool', (n, d) => S.dhcpPool(n, d))
showCmd('dhcp lease', (n, d) => {
  const l = Object.entries(d.rt.dhcpClient ?? {})
  return l.length ? l.map(([i, x]) => `Temp IP addr: ${x.ip}  for peer on Interface: ${i}\nTemp  sub net mask: ${x.mask}\n   DHCP Lease server: ${x.serverIp ?? 'unknown'}, state: 5 Bound\n   Default Gateway addr: ${x.gw ?? '0.0.0.0'}`).join('\n') : ''
})
showCmd('standby', (n, d) => S.standby(n, d))
showCmd('standby brief', (n, d) => S.standbyBrief(n, d))
showCmd('ntp associations', (n, d) => S.ntpAssociations(n, d))
showCmd('ntp status', (n, d) => S.ntpStatus(n, d))
showCmd('logging', (n, d) => S.showLogging(n, d))
showCmd('cdp neighbors', (n, d) => S.cdpNeighbors(n, d))
showCmd('cdp neighbors detail', (n, d) => S.cdpNeighbors(n, d, true))
showCmd('lldp neighbors', (n, d) => S.lldpNeighbors(n, d))
showCmd('port-security', (n, d) => S.portSecurity(n, d))
showCmd('port-security interface <iface>', (n, d, v) => S.portSecurity(n, d, v[0]))
showCmd('port-security address', (n, d) => S.portSecurityAddress(n, d))
showCmd('ip dhcp snooping', (n, d) => S.snooping(n, d))
showCmd('ip dhcp snooping binding', (n, d) => S.snoopingBinding(n, d))
showCmd('ip arp inspection', (n, d) => S.arpInspection(n, d))
showCmd('ip arp inspection statistics', (n, d) => S.arpInspection(n, d))
showCmd('ip ssh', (n, d) => S.showIpSsh(d))
showCmd('ip arp', (n, d) => S.showArp(n, d))
showCmd('arp', (n, d) => S.showArp(n, d))
showCmd('users', (n, d, v, c) => `    Line       User       Host(s)              Idle       Location\n*  0 con 0                idle                 00:00:00\n${c.session.stack.length > 1 ? '' : ''}`)

// ---------- global config ----------
const set = (c, v, s) => { c.store(s.line, s.key) }
cmd(['config'], 'hostname <word>', set)
cmd(['config'], 'enable secret <text>', (c, v) => c.setEnableSecret(v[0], 9))
cmd(['config'], 'enable algorithm-type scrypt|sha256|md5 secret <text>', (c, v) => c.setEnableSecret(v[1], { scrypt: 9, sha256: 8, md5: 5 }[v[0]]))
cmd(['config'], 'enable password <text>', (c, v) => {
  c.dev.secrets.enablePassword = v[0]
  setGlobal(c.dev, `enable password ${c.maybe7(v[0])}`, 'enable password')
})
cmd(['config'], 'username <word> secret <text>', (c, v) => c.setUser(v[0], v[1], 9))
cmd(['config'], 'username <word> privilege <num:0-15> secret <text>', (c, v) => c.setUser(v[0], v[2], 9, v[1]))
cmd(['config'], 'username <word> algorithm-type scrypt|sha256|md5 secret <text>', (c, v) => c.setUser(v[0], v[2], { scrypt: 9, sha256: 8, md5: 5 }[v[1]]))
cmd(['config'], 'username <word> password <text>', (c, v) => c.setUser(v[0], v[1], 0))
cmd(['config'], 'username <word> privilege <num:0-15> password <text>', (c, v) => c.setUser(v[0], v[2], 0, v[1]))
cmd(['config'], 'username <word> privilege <num:0-15> algorithm-type scrypt|sha256|md5 secret <text>', (c, v) => c.setUser(v[0], v[3], { scrypt: 9, sha256: 8, md5: 5 }[v[2]], v[1]))
cmd(['config'], 'service password-encryption', (c) => c.passwordEncryption())
cmd(['config'], 'service timestamps log|debug datetime|uptime <text>?', (c, v) => {
  // datetime options may come in any order: msec localtime show-timezone year
  const OPTS = ['msec', 'localtime', 'show-timezone', 'year']
  const words = (v[2] ?? '').trim().split(/\s+/).filter(Boolean).map((w) => OPTS.filter((o) => o.startsWith(w.toLowerCase())))
  if (words.some((m) => m.length !== 1) || (v[1] === 'uptime' && words.length)) return `${' '.repeat(prompt(c.session).length + 29 + v[1].length)}^\n% Invalid input detected at '^' marker.`
  const set = new Set(words.map((m) => m[0]))
  c.store(['service timestamps', v[0], v[1], ...OPTS.filter((o) => set.has(o))].join(' '), `service timestamps ${v[0]}`)
})
cmd(['config'], 'ip domain name <word>', (c, v) => setGlobal(c.dev, `ip domain name ${v[0]}`, 'ip domain name'))
// the old hyphenated forms still work on IOS XE but are hidden (not in "?" and never ambiguous)
cmd(['config'], 'ip domain-name <word>', (c, v) => setGlobal(c.dev, `ip domain name ${v[0]}`, 'ip domain name'), { hidden: true })
cmd(['config'], 'ip domain lookup', (c) => removeLines(c.dev.config.global, 'no ip domain lookup'))
cmd(['config'], 'ip domain-lookup', (c) => removeLines(c.dev.config.global, 'no ip domain lookup'), { hidden: true })
cmd(['config'], 'crypto key generate rsa', (c) => c.genRsa())
cmd(['config'], 'crypto key generate rsa modulus <num:360-4096>', (c, v) => c.genRsa(v[0]))
cmd(['config'], 'crypto key generate rsa general-keys modulus <num:360-4096>', (c, v) => c.genRsa(v[0]))
cmd(['config'], 'crypto key zeroize rsa', (c) => c.ask('% All keys will be removed.\n% All router certs issued using these keys will also be removed.\nDo you really want to remove these keys? [yes/no]: ', (a) => { if (/^y/i.test(a)) c.dev.rt.rsaBits = 0; return '' }))
cmd(['config'], 'ip ssh version <num:1-2>', set)
cmd(['config'], 'ip default-gateway <ip>', set, { only: ['switch', 'l3switch', 'router'] })
cmd(['config'], 'ip routing', set, { only: ['router', 'l3switch'] })
cmd(['config'], 'ipv6 unicast-routing', set, { only: ['router', 'l3switch'] })
cmd(['config'], 'ip route <ip> <mask> <text>', (c, v) => c.ipRoute(v))
cmd(['config'], 'ipv6 route <v6pfx> <text>', (c, v) => c.ipv6Route(v))
cmd(['config'], 'access-list <num:1-2699> <text>', (c, v) => c.numberedAcl(v[0], v[1]))
cmd(['config'], 'ip nat inside source static <ip> <ip>', (c, v, s) => c.store(s.line, null))
cmd(['config'], 'ip nat inside source list <word> pool <word> overload?', (c, v, s) => c.store(s.line, `ip nat inside source list ${v[0]}`))
// IOS adds "overload" by itself when the interface form is used without it
cmd(['config'], 'ip nat inside source list <word> interface <iface> overload?', (c, v) => c.store(`ip nat inside source list ${v[0]} interface ${v[1]} overload`, `ip nat inside source list ${v[0]}`))
cmd(['config'], 'ip nat pool <word> <ip> <ip> netmask <mask>', (c, v, s) => c.store(s.line, `ip nat pool ${v[0]}`))
cmd(['config'], 'ip nat pool <word> <ip> <ip> prefix-length <num:1-32>', (c, v) => c.store(`ip nat pool ${v[0]} ${v[1]} ${v[2]} netmask ${lenToMask(v[3])}`, `ip nat pool ${v[0]}`))
cmd(['config'], 'ip dhcp excluded-address <ip> <ip>?', (c, v, s) => c.store(s.line, null))
cmd(['config'], 'ip dhcp snooping', set, { only: ['switch', 'l3switch'] })
cmd(['config'], 'ip dhcp snooping vlan <vlist>', (c, v, s) => c.store(s.line, null), { only: ['switch', 'l3switch'] })
cmd(['config'], 'ip dhcp snooping information option', (c) => removeLines(c.dev.config.global, 'no ip dhcp snooping information option'), { only: ['switch', 'l3switch'] })
cmd(['config'], 'ip arp inspection vlan <vlist>', (c, v, s) => c.store(s.line, null), { only: ['switch', 'l3switch'] })
cmd(['config'], 'spanning-tree mode pvst|rapid-pvst|mst', set, { only: ['switch', 'l3switch'] })
cmd(['config'], 'spanning-tree vlan <vlist> priority <num:0-61440>', (c, v) => c.stpPriority(v[0], v[1]), { only: ['switch', 'l3switch'] })
cmd(['config'], 'spanning-tree vlan <vlist> root primary|secondary', (c, v) => c.stpRoot(v[0], v[1]), { only: ['switch', 'l3switch'] })
cmd(['config'], 'spanning-tree portfast default', set, { only: ['switch', 'l3switch'] })
cmd(['config'], 'spanning-tree portfast bpduguard default', set, { only: ['switch', 'l3switch'] })
cmd(['config'], 'errdisable recovery cause <word>', (c, v, s) => c.store(s.line, null))
cmd(['config'], 'errdisable recovery interval <num:30-86400>', set)
cmd(['config'], 'ntp server <ip>', (c, v, s) => c.store(s.line, null))
cmd(['config'], 'ntp master <num:1-15>?', (c, v) => { removeLines(c.dev.config.global, 'ntp master'); c.store(v[0] ? `ntp master ${v[0]}` : 'ntp master', null) })
cmd(['config'], 'logging host <ip>', (c, v, s) => c.store(s.line, null))
cmd(['config'], 'logging <ip>', (c, v) => c.store(`logging host ${v[0]}`, null))
cmd(['config'], 'logging trap <word>', (c, v) => c.logLevel('logging trap', v[0]))
cmd(['config'], 'logging console <word>?', (c, v) => (v[0] ? c.logLevel('logging console', v[0]) : removeLines(c.dev.config.global, 'no logging console')))
cmd(['config'], 'logging buffered <word>?', (c, v) => (v[0] ? c.logLevel('logging buffered', v[0]) : (removeLines(c.dev.config.global, 'logging buffered'), c.store('logging buffered', null))))
cmd(['config'], 'logging buffered <num:4096-2147483647> <word>', (c, v) => c.store(`logging buffered ${v[0]} ${v[1]}`, 'logging buffered'))
cmd(['config'], 'clock timezone <word> <num:-23-23>', (c, v) => c.store(`clock timezone ${v[0]} ${v[1]} 0`, 'clock timezone'))
cmd(['config'], 'clock timezone <word> <any> <num:0-59>?', (c, v) => c.store(`clock timezone ${v[0]} ${v[1]} ${v[2] ?? 0}`, 'clock timezone'))
cmd(['config'], 'cdp run', (c) => removeLines(c.dev.config.global, 'no cdp run'))
cmd(['config'], 'lldp run', set)
cmd(['config'], 'snmp-server community <word> ro|rw <word>?', (c, v, s) => c.store(s.line, `snmp-server community ${v[0]}`))
cmd(['config'], 'snmp-server location <text>', set)
cmd(['config'], 'snmp-server contact <text>', set)
cmd(['config'], 'snmp-server host <ip> version? <text>', (c, v, s) => c.store(s.line, null))
cmd(['config'], 'banner motd <text>', (c, v) => c.banner(v[0]))
cmd(['config'], 'vtp mode transparent|server|client|off', set, { only: ['switch', 'l3switch'] })

// mode-entering
cmd(CFG, 'interface <iface>', (c, v) => c.enterInterface(v[0]))
cmd(CFG, 'interface range <text>', (c, v) => c.enterRange(v[0]))
cmd(['config'], 'default interface <iface>', (c, v) => {
  const sec = getSection(c.dev, `interface ${v[0]}`)
  if (!sec) return `${' '.repeat(prompt(c.session).length + 18)}^\n% Invalid input detected at '^' marker.`
  sec.lines = c.dev.kind === 'router' && isPhysical(v[0]) ? ['shutdown'] : []
  c.dev.rt.errdisabled = c.dev.rt.errdisabled.filter((p) => p !== v[0])
  return `Interface ${v[0]} set to default configuration`
})
cmd(CFG, 'router ospf <num:1-65535>', (c, v) => c.enterSection(`router ospf ${v[0]}`, 'router'), { only: ['router', 'l3switch'] })
cmd(CFG, 'line vty <num:0-15> <num:0-15>?', (c, v) => c.enterLine('vty', v[0], v[1] ?? v[0]))
cmd(CFG, 'line console <num:0-0>', (c) => c.enterLine('con', 0, 0))
cmd(CFG, 'vlan <vlist>', (c, v) => c.enterVlan(v[0]), { only: ['switch', 'l3switch'] })
cmd(CFG, 'ip access-list standard|extended <word>', (c, v) => c.enterAcl(v[0], v[1]))
cmd(CFG, 'ip dhcp pool <word>', (c, v) => c.enterSection(`ip dhcp pool ${v[0]}`, 'dhcp'), { only: ['router', 'l3switch'] })

cmd(['config'], 'exit', (c) => { c.ctx.mode = 'priv'; c.configured() })
cmd(CFG, 'end', (c) => { c.ctx.mode = 'priv'; c.ctx.heads = null; c.configured() })
cmd(SUB, 'exit', (c) => { c.ctx.mode = 'config'; c.ctx.heads = null })

// ---------- interface ----------
cmd(IFM, 'description <text>', set)
cmd(IFM, 'shutdown', (c) => { c.store('shutdown', 'shutdown'); c.forEachHead((L, h) => { c.dev.rt.errdisabled = c.dev.rt.errdisabled.filter((p) => `interface ${p}` !== h) }) })
cmd(IFM, 'ip address <ip> <mask>', (c, v) => c.ipAddress(v[0], v[1]))
cmd(IFM, 'ip address <ip> <mask> secondary', (c, v, s) => c.store(s.line, null))
cmd(IFM, 'ip address dhcp', (c) => { if (c.noEncap()) return SUBIF_NO_ENCAP; c.store('ip address dhcp', 'ip address'); c.engine.markDirty() })
cmd(IFM, 'speed 10|100|1000|auto', set)
cmd(IFM, 'duplex full|half|auto', set)
cmd(IFM, 'switchport', (c) => c.forEachHead((L) => {
  // going back to Layer 2 discards the port's Layer 3 settings
  if (removeLines(L, 'no switchport')) for (let i = L.length - 1; i >= 0; i--) if (/^(ip|ipv6|standby) /.test(L[i])) L.splice(i, 1)
}), { only: ['l3switch', 'switch'] })
cmd(IFM, 'switchport mode access|trunk', (c, v, s) => c.switchportMode(s.line), { only: ['switch', 'l3switch'] })
cmd(IFM, 'switchport mode dynamic auto|desirable', (c, v, s) => c.switchportMode(s.line), { only: ['switch', 'l3switch'] })
cmd(IFM, 'switchport access vlan <num:1-4094>', (c, v, s) => c.accessVlan(v[0], s), { only: ['switch', 'l3switch'] })
cmd(IFM, 'switchport voice vlan <num:1-4094>', (c, v, s) => c.accessVlan(v[0], s), { only: ['switch', 'l3switch'] })
cmd(IFM, 'switchport trunk native vlan <num:1-4094>', set, { only: ['switch', 'l3switch'] })
cmd(IFM, 'switchport trunk allowed vlan <text>', (c, v) => c.allowedVlans(v[0]), { only: ['switch', 'l3switch'] })
cmd(IFM, 'switchport nonegotiate', (c, v, s) => c.nonegotiate(s), { only: ['switch', 'l3switch'] })
cmd(IFM, 'switchport port-security', (c, v, s) => c.portSecurity(s), { only: ['switch', 'l3switch'] })
cmd(IFM, 'switchport port-security maximum <num:1-4097>', (c, v, s) => c.portSecurity(s), { only: ['switch', 'l3switch'] })
cmd(IFM, 'switchport port-security violation protect|restrict|shutdown', (c, v, s) => c.portSecurity(s), { only: ['switch', 'l3switch'] })
cmd(IFM, 'switchport port-security mac-address sticky', (c, v, s) => c.portSecurity(s, true), { only: ['switch', 'l3switch'] })
cmd(IFM, 'switchport port-security mac-address <any>', (c, v) => c.psMac(v[0], false), { only: ['switch', 'l3switch'] })
cmd(IFM, 'switchport port-security mac-address sticky <any>', (c, v) => c.psMac(v[0], true), { only: ['switch', 'l3switch'] })
cmd(IFM, 'spanning-tree portfast', (c) => { c.forEachHead((L) => removeLines(L, 'spanning-tree portfast disable')); c.store('spanning-tree portfast', null); return PORTFAST_WARN(c) }, { only: ['switch', 'l3switch'] })
cmd(IFM, 'spanning-tree portfast edge', (c) => { c.forEachHead((L) => removeLines(L, 'spanning-tree portfast disable')); c.store('spanning-tree portfast', null); return PORTFAST_WARN(c) }, { only: ['switch', 'l3switch'] })
cmd(IFM, 'spanning-tree portfast disable', (c) => { c.forEachHead((L) => removeLines(L, 'spanning-tree portfast')); c.store('spanning-tree portfast disable', null) }, { only: ['switch', 'l3switch'] })
cmd(IFM, 'spanning-tree bpduguard enable|disable', set, { only: ['switch', 'l3switch'] })
cmd(IFM, 'spanning-tree bpdufilter enable|disable', set, { only: ['switch', 'l3switch'] })
cmd(IFM, 'spanning-tree guard root|loop|none', (c, v, s) => (v[0] === 'none' ? c.forEachHead((L) => removeLines(L, 'spanning-tree guard')) : c.store(s.line, 'spanning-tree guard')), { only: ['switch', 'l3switch'] })
cmd(IFM, 'spanning-tree cost <num:1-200000000>', set, { only: ['switch', 'l3switch'] })
cmd(IFM, 'spanning-tree port-priority <num:0-240>', set, { only: ['switch', 'l3switch'] })
cmd(IFM, 'channel-group <num:1-48> mode active|passive|on|desirable|auto', (c, v, s) => c.channelGroup(v[0], s), { only: ['switch', 'l3switch'] })
cmd(['subif'], 'encapsulation dot1Q <num:1-4094> native?', (c, v) => c.encapsulation(v[0], !!v[1]))
cmd(IFM, 'ip helper-address <ip>', (c, v, s) => c.store(s.line, null))
cmd(IFM, 'ip access-group <word> in|out', (c, v, s) => c.store(s.line, null, (l) => l.startsWith('ip access-group') && l.endsWith(` ${v[1]}`)))
cmd(IFM, 'ip nat inside|outside', set)
cmd(IFM, 'ip ospf <num:1-65535> area <word>', (c, v, s) => (areaOk(v[1]) ? c.store(s.line, `ip ospf ${v[0]} area`) : badArea(c, s.line)), { only: ['router', 'l3switch'] })
cmd(IFM, 'bandwidth <num:1-100000000>', set, { only: ['router', 'l3switch'] })
cmd(IFM, 'ip ospf cost <num:1-65535>', set, { only: ['router', 'l3switch'] })
cmd(IFM, 'ip ospf priority <num:0-255>', set, { only: ['router', 'l3switch'] })
cmd(IFM, 'ip ospf network point-to-point|broadcast', set, { only: ['router', 'l3switch'] })
cmd(IFM, 'ip ospf hello-interval <num:1-65535>', set, { only: ['router', 'l3switch'] })
cmd(IFM, 'ip ospf dead-interval <num:1-65535>', set, { only: ['router', 'l3switch'] })
cmd(IFM, 'ipv6 address <v6pfx>', (c, v, s) => c.store(normV6(s.line), null))
cmd(IFM, 'ipv6 address <v6pfx> eui-64', (c, v, s) => c.store(normV6(s.line), null))
cmd(IFM, 'ipv6 address <v6> link-local', (c, v, s) => c.store(normV6(s.line), null, (l) => l.endsWith('link-local')))
cmd(IFM, 'ipv6 address autoconfig', set)
cmd(IFM, 'ipv6 enable', set)
cmd(IFM, 'standby version <num:1-2>', set)
cmd(IFM, 'standby <num:0-4095> ip <ip>', (c, v, s) => c.store(s.line, `standby ${v[0]} ip`))
cmd(IFM, 'standby ip <ip>', (c, v) => c.store(`standby 0 ip ${v[0]}`, 'standby 0 ip'))
cmd(IFM, 'standby <num:0-4095> priority <num:0-255>', (c, v, s) => c.store(s.line, `standby ${v[0]} priority`))
cmd(IFM, 'standby priority <num:0-255>', (c, v) => c.store(`standby 0 priority ${v[0]}`, 'standby 0 priority'))
cmd(IFM, 'standby <num:0-4095> preempt', set)
cmd(IFM, 'standby preempt', (c) => c.store('standby 0 preempt', 'standby 0 preempt'))
cmd(IFM, 'ip dhcp snooping trust', set, { only: ['switch', 'l3switch'] })
cmd(IFM, 'ip dhcp snooping limit rate <num:1-2048>', set, { only: ['switch', 'l3switch'] })
cmd(IFM, 'ip arp inspection trust', set, { only: ['switch', 'l3switch'] })
cmd(IFM, 'ip arp inspection limit rate <num:0-2048>', set, { only: ['switch', 'l3switch'] })
cmd(IFM, 'cdp enable', (c) => c.forEachHead((L) => removeLines(L, 'no cdp enable')))
cmd(IFM, 'power inline auto|never', set, { only: ['switch', 'l3switch'] })
cmd(IFM, 'no switchport', (c) => c.noSwitchport(), { only: ['l3switch'], raw: true })

// ---------- router ospf ----------
cmd(['router'], 'router-id <ip>', (c, v) => c.routerId(v[0]))
cmd(['router'], 'network <ip> <wild> area <word>', (c, v, s) => {
  if (!areaOk(v[2])) return badArea(c, s.line)
  // IOS clears the address bits the wildcard ignores: "network 10.0.12.1 0.0.0.3" -> "network 10.0.12.0 0.0.0.3"
  const net = v4ToStr(parseV4(v[0]) & (((1n << 32n) - 1n) ^ parseV4(v[1])))
  c.store(`network ${net} ${v[1]} area ${v[2]}`, null)
})
cmd(['router'], 'passive-interface default', set)
cmd(['router'], 'passive-interface <iface>', (c, v, s) => c.store(s.line, null))
cmd(['router'], 'auto-cost reference-bandwidth <num:1-4294967>', (c, v) => { c.store(`auto-cost reference-bandwidth ${v[0]}`, 'auto-cost reference-bandwidth'); return '% OSPF: Reference bandwidth is changed.\n        Please ensure reference bandwidth is consistent across all routers.' })
cmd(['router'], 'default-information originate always?', (c, v, s) => c.store(s.line, 'default-information originate'))
cmd(['router'], 'maximum-paths <num:1-32>', set)

// ---------- line ----------
cmd(['line'], 'password <text>', (c, v) => c.linePassword(v[0]))
cmd(['line'], 'login', (c) => { c.forEachHead((L) => removeLines(L, 'login')); c.store('login', null) })
cmd(['line'], 'login local', (c) => c.store('login local', 'login'))
cmd(['line'], 'transport input <text>', (c, v) => c.transport(v[0]))
cmd(['line'], 'exec-timeout <num:0-35791> <num:0-2147483>?', (c, v) => c.store(`exec-timeout ${v[0]} ${v[1] ?? 0}`, 'exec-timeout'))
cmd(['line'], 'logging synchronous', set)
cmd(['line'], 'access-class <word> in|out', (c, v, s) => c.store(s.line, null, (l) => l.startsWith('access-class ') && l.endsWith(` ${v[1]}`)))
cmd(['line'], 'privilege level <num:0-15>', set)

// ---------- vlan / dhcp ----------
cmd(['vlan'], 'name <word>', set)
cmd(['dhcp'], 'network <ip> <mask>', set)
cmd(['dhcp'], 'network <ip> <word>', (c, v) => {
  // "network 192.168.10.0 /24" is stored with a dotted mask, as IOS does
  const m = /^\/(\d{1,2})$/.exec(v[1])
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 32) return `${' '.repeat(prompt(c.session).length + 9 + v[0].length)}^\n% Invalid input detected at '^' marker.`
  c.store(`network ${v[0]} ${lenToMask(Number(m[1]))}`, 'network')
})
cmd(['dhcp'], 'default-router <text>', (c, v) => c.ipList('default-router', v[0]))
cmd(['dhcp'], 'dns-server <text>', (c, v) => c.ipList('dns-server', v[0]))
cmd(['dhcp'], 'domain-name <word>', set)
cmd(['dhcp'], 'lease <num:0-365> <num:0-23>?', set)

// ACL mode is free-form; handled in execute()

// IOS prints the trunking note too: interface-level portfast does nothing on a trunk
const PORTFAST_WARN = (c) => {
  return '%Warning: portfast should only be enabled on ports connected to a single\n host. Connecting hubs, concentrators, switches, bridges, etc... to this\n interface  when portfast is enabled, can cause temporary bridging loops.\n Use with CAUTION\n\n%Portfast has been configured on ' + c.heads().map((h) => h.slice(10)).join(', ') + ' but will only\n have effect when the interface is in a non-trunking mode.'
}

// OSPF areas: a 32-bit number or dotted-decimal (area 0 = area 0.0.0.0)
const areaOk = (w) => (/^\d+$/.test(w) && Number(w) <= 4294967295) || parseV4(w) !== null
const badArea = (c, line) => `${' '.repeat(prompt(c.session).length + line.lastIndexOf(' ') + 1)}^\n% Invalid input detected at '^' marker.`

const SUBIF_NO_ENCAP = '% Configuring IP routing on a LAN subinterface is only allowed if that\nsubinterface is already configured as part of an IEEE 802.10, IEEE 802.1Q,\nor ISL vLAN.'

// "no" forms that are stored as lines (features on by default)
const NO_STORED = ['no ip domain lookup', 'no ip domain-lookup', 'no cdp run', 'no cdp enable', 'no logging console', 'no ip dhcp snooping information option']

// ======================================================================
// Matching
// ======================================================================

function tokenize(line) {
  const out = []
  const re = /\S+/g
  let m
  while ((m = re.exec(line))) out.push({ t: m[0], start: m.index })
  return out
}

function validPh(tk, text, next) {
  const t = text
  switch (tk.ph) {
    case 'ip': return parseV4(t) !== null ? { v: t } : null
    case 'mask': return maskToLen(t) !== null ? { v: t } : null
    case 'wild': return parseV4(t) !== null ? { v: t } : null
    case 'num': {
      if (!/^-?\d+$/.test(t)) return null
      const n = Number(t)
      if (tk.min !== null && (n < tk.min || n > tk.max)) return null
      return { v: n }
    }
    case 'word': case 'any': return { v: t }
    case 'vlist': return parseVlanList(t) && parseVlanList(t) !== 'all' ? { v: t } : null
    case 'v6pfx': return parseV6Prefix(t) ? { v: t } : null
    case 'v6': return parseV6(t) !== null ? { v: t } : null
    case 'iface': {
      const r = canonicalIface(t, next)
      return r ? { v: r.name, consumed: r.consumed } : null
    }
    default: return null
  }
}

// Try to match one template. partial = allow running out of input (for "no" and "?")
function matchTpl(tpl, toks, raw, partial) {
  const best = { ok: false, failAt: 0, incomplete: false }
  const go = (i, j, vals, exp, exact) => {
    if (j === tpl.toks.length) {
      if (i === toks.length) return { ok: true, vals, exp, exact, j }
      if (i > best.failAt) best.failAt = i
      return null
    }
    const tk = tpl.toks[j]
    if (i === toks.length) {
      if (tpl.toks.slice(j).every((x) => x.optional)) return { ok: true, vals, exp, exact, j }
      if (partial) return { ok: true, partial: true, vals, exp, exact, j }
      best.incomplete = true
      best.failAt = Math.max(best.failAt, i)
      return null
    }
    const word = toks[i].t
    let r = null
    if (tk.lit) {
      const w = word.toLowerCase()
      const hits = tk.lit.filter((a) => a.toLowerCase().startsWith(w))
      const exactHit = tk.lit.find((a) => a.toLowerCase() === w)
      const pick = exactHit ?? (hits.length === 1 ? hits[0] : null)
      if (pick) {
        r = go(i + 1, j + 1, tk.value ? [...vals, pick] : vals, [...exp, { kind: 'lit', v: pick, i, value: tk.value }], exact && !!exactHit)
      }
    } else if (tk.ph === 'text') {
      r = go(toks.length, j + 1, [...vals, raw.slice(toks[i].start)], [...exp, { kind: 'ph', v: raw.slice(toks[i].start), i }], exact)
    } else {
      const v = validPh(tk, word, toks[i + 1]?.t)
      if (v) {
        const consumed = v.consumed ?? 1
        r = go(i + consumed, j + 1, [...vals, v.v], [...exp, { kind: 'ph', v: String(v.v), i }], exact)
      }
    }
    if (r) return r
    if (i > best.failAt) best.failAt = i
    if (tk.optional) return go(i, j + 1, vals, exp, exact)
    return null
  }
  const r = go(0, 0, [], [], true)
  return r ?? best
}

function candidatesFor(mode, kind) {
  return T.filter((t) => t.modes.includes(mode) && (!t.only || t.only.includes(kind)))
}

// Returns { tpl, vals, line, key } or { error }
function resolve(mode, kind, line, opts = {}) {
  const toks = tokenize(line)
  if (!toks.length) return { empty: true }
  const results = []
  let failAt = 0
  let incomplete = false
  for (const tpl of candidatesFor(mode, kind)) {
    if (opts.noForm && tpl.raw) continue
    const r = matchTpl(tpl, toks, line, opts.partial)
    if (r.ok) results.push({ tpl, ...r })
    else {
      failAt = Math.max(failAt, r.failAt)
      if (r.incomplete) incomplete = true
    }
  }
  if (!results.length) {
    // Ambiguity check on the first token
    const firsts = new Set(candidatesFor(mode, kind).flatMap((t) => (t.toks[0].lit ?? []).filter((a) => a.toLowerCase().startsWith(toks[0].t.toLowerCase()))))
    if (firsts.size > 1 && !firsts.has(toks[0].t.toLowerCase())) return { error: 'ambiguous', toks }
    if (incomplete && failAt >= toks.length) return { error: 'incomplete', toks }
    return { error: 'invalid', at: toks[Math.min(failAt, toks.length - 1)].start, toks, unknownFirst: failAt === 0 }
  }
  // Prefer full (non-partial) matches, then exact literal matches
  let pool = results.filter((r) => !r.partial)
  if (!pool.length) pool = results
  const litSig = (r) => r.exp.filter((e) => e.kind === 'lit').map((e) => `${e.i}:${e.v}`).join(' ')
  // Per token position, an exact keyword beats an abbreviation of a longer one ("ip" vs "ipv6")
  for (let k = 0; k < toks.length; k++) {
    const word = toks[k].t.toLowerCase()
    const exactHere = pool.filter((r) => r.exp.some((e) => e.i === k && e.kind === 'lit' && e.v.toLowerCase() === word))
    const litHere = pool.filter((r) => r.exp.some((e) => e.i === k && e.kind === 'lit'))
    if (exactHere.length && exactHere.length < litHere.length) pool = pool.filter((r) => exactHere.includes(r) || !litHere.includes(r))
  }
  const sigs = new Set(pool.map(litSig))
  if (sigs.size > 1) {
    // Different expansions of the same abbreviation -> ambiguous unless one matches exactly
    const exact = pool.filter((r) => r.exact)
    if (exact.length) pool = exact
    else {
      // Allow differences that come from distinct token types (e.g. vlist vs literal)
      const firstDiff = (() => {
        const lists = pool.map((r) => r.exp)
        for (let k = 0; k < Math.max(...lists.map((l) => l.length)); k++) {
          const vals = new Set(lists.map((l) => (l[k] ? `${l[k].kind}:${l[k].v}` : '')))
          if (vals.size > 1) return k
        }
        return -1
      })()
      const kinds = new Set(pool.map((r) => r.exp[firstDiff]?.kind))
      if (kinds.has('lit') && kinds.size === 1) return { error: 'ambiguous', toks }
      pool = pool.sort((a, b) => b.exp.filter((e) => e.kind === 'lit').length - a.exp.filter((e) => e.kind === 'lit').length)
    }
  }
  const r = pool[0]
  // An abbreviation is ambiguous when it could start more than one keyword at that point,
  // even if only one of those commands would be complete ("s" in interface mode)
  for (const e of r.exp) {
    if (e.kind !== 'lit' || e.value) continue
    const word = toks[e.i].t.toLowerCase()
    if (e.v.toLowerCase() === word) continue
    const before = tokenize(line.slice(0, toks[e.i].start))
    const alts = new Set()
    for (const tpl of candidatesFor(mode, kind)) {
      if ((opts.noForm && tpl.raw) || tpl.hidden) continue
      const m = before.length ? matchTpl(tpl, before, line.slice(0, toks[e.i].start), true) : { ok: true, partial: true, j: 0 }
      if (!m.ok || !m.partial) continue
      for (const a of tpl.toks[m.j]?.lit ?? []) if (a.toLowerCase().startsWith(word)) alts.add(a.toLowerCase())
    }
    if (alts.size > 1) return { error: 'ambiguous', toks }
  }
  const lineOut = r.exp.map((e) => e.v).join(' ')
  // Key: tokens up to (not including) the trailing value/placeholder run
  let keyLen = r.exp.length
  while (keyLen > 0) {
    const e = r.exp[keyLen - 1]
    if (e.kind === 'ph' || e.value) keyLen--
    else break
  }
  const key = r.exp.slice(0, keyLen).map((e) => e.v).join(' ') || lineOut
  return { tpl: r.tpl, vals: r.vals, line: lineOut, key, partial: !!r.partial }
}

// ======================================================================
// Session
// ======================================================================

export function createSession(engine, devId) {
  const session = { engine, history: [], histIdx: null, stack: [{ devId, mode: 'user', heads: null }], pending: null }
  return session
}

function promptOf(engine, ctx) {
  const dev = engine.dev(ctx.devId)
  const h = hostname(dev)
  const suffix = { user: '>', priv: '#', config: '(config)#', if: '(config-if)#', subif: '(config-subif)#', range: '(config-if-range)#', router: '(config-router)#', line: '(config-line)#', vlan: '(config-vlan)#', dhcp: '(dhcp-config)#' }[ctx.mode]
  if (ctx.mode === 'acl') return `${h}(config-${ctx.aclType === 'standard' ? 'std' : 'ext'}-nacl)#`
  return h + suffix
}

export function prompt(session) {
  if (session.pending) return session.pending.prompt
  return promptOf(session.engine, session.stack[session.stack.length - 1])
}

// Run one line of input. Returns output text (may be '').
export function execute(session, input) {
  const engine = session.engine
  if (session.pending) {
    const p = session.pending
    session.pending = null
    const out = p.onAnswer(input)
    return typeof out === 'string' ? out : ''
  }
  const ctx = session.stack[session.stack.length - 1]
  const dev = engine.dev(ctx.devId)
  const line = input.replace(/\s+$/, '')
  if (line.trim()) session.history.push(line.trim())
  if (!line.trim()) return ''
  const c = makeCtx(session, ctx, dev)

  // Pipes: show ... | include X
  let pipe = null
  const pm = /^(.*?)\s+\|\s+(include|inc|i|exclude|exc|e|section|sec|s|begin|beg|b)\s+(.+)$/.exec(line)
  let cmdLine = line
  if (pm) { cmdLine = pm[1]; pipe = { kind: pm[2][0], re: pm[3] } }

  let mode = ctx.mode
  let doPrefix = false
  if (CFG.includes(mode) && /^do\s+/.test(cmdLine.trim())) { cmdLine = cmdLine.trim().replace(/^do\s+/, ''); mode = 'priv'; doPrefix = true }

  // "no" forms
  const trimmed = cmdLine.trim()
  if (CFG.includes(mode) && /^no\s+/.test(trimmed)) {
    session.lastLine = trimmed
    const out = runNo(c, mode, trimmed.replace(/^no\s+/, ''))
    engine.markDirty()
    return out ?? ''
  }

  // ACL sub-mode entries
  if (mode === 'acl') {
    const out = aclEntry(c, trimmed)
    if (out !== undefined) { engine.markDirty(); return out }
  }

  let r = resolve(mode, dev.kind, cmdLine)
  // From a sub-mode, global commands are accepted (and drop you to global config)
  if (r.error && SUB.includes(mode)) {
    const g = resolve('config', dev.kind, cmdLine)
    if (!g.error) { r = g; ctx.mode = 'config'; ctx.heads = null; mode = 'config' }
  }
  if (r.error) return errorText(session, ctx, cmdLine, r, mode, dev, doPrefix)
  const before = mode
  session.lastLine = r.line
  let out = r.tpl.run(c, r.vals, r)
  if (typeof out !== 'string') out = ''
  if (CFG.includes(before) || CFG.includes(ctx.mode)) engine.markDirty()
  if (pipe && out) out = applyPipe(out, pipe)
  return out
}

function errorText(session, ctx, cmdLine, r, mode, dev, doPrefix) {
  if (r.error === 'ambiguous') return `% Ambiguous command:  "${cmdLine.trim()}"`
  if (r.error === 'incomplete') return '% Incomplete command.'
  if ((mode === 'user' || mode === 'priv') && r.unknownFirst && !doPrefix) {
    const word = r.toks[0].t
    if (hasLine(dev.config.global, 'no ip domain lookup')) return `Translating "${word}"\n% Unknown command or computer name, or unable to find computer address`
    return `Translating "${word}"...domain server (255.255.255.255)\n% Unknown command or computer name, or unable to find computer address`
  }
  const col = prompt(session).length + r.at + (doPrefix ? 3 : 0)
  return `${' '.repeat(col)}^\n% Invalid input detected at '^' marker.`
}

function applyPipe(out, pipe) {
  let re
  try { re = new RegExp(pipe.re) } catch { re = new RegExp(pipe.re.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }
  const lines = out.split('\n')
  if (pipe.kind === 'i') return lines.filter((l) => re.test(l)).join('\n')
  if (pipe.kind === 'e') return lines.filter((l) => !re.test(l)).join('\n')
  if (pipe.kind === 'b') { const i = lines.findIndex((l) => re.test(l)); return i < 0 ? '' : lines.slice(i).join('\n') }
  if (pipe.kind === 's') {
    const res = []
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith(' ') && re.test(lines[i])) {
        res.push(lines[i])
        while (lines[i + 1]?.startsWith(' ')) res.push(lines[++i])
      }
    }
    return res.join('\n')
  }
  return out
}

// ---------- no ----------
function runNo(c, mode, rest) {
  const dev = c.dev
  if (mode === 'acl') {
    const m = /^(\d+)$/.exec(rest)
    if (m) { removeLines(getSection(dev, c.ctx.heads[0]).lines, m[1]); return '' }
    const s = getSection(dev, c.ctx.heads[0])
    const i = s.lines.findIndex((l) => l.replace(/^\d+ /, '') === rest)
    if (i >= 0) s.lines.splice(i, 1)
    return ''
  }
  // whole-section removal
  const simple = rest.trim()
  if (mode === 'config' || SUB.includes(mode)) {
    let m = /^interface\s+(.+)$/.exec(simple)
    if (m) {
      const r = canonicalIface(...m[1].split(/\s+/))
      if (r && (isSubif(r.name) || ['Loopback', 'Vlan', 'Port-channel'].includes(ifaceType(r.name)))) { removeSection(dev, `interface ${r.name}`); return '' }
      return '% Interface cannot be removed'
    }
    m = /^router\s+ospf\s+(\d+)$/.exec(simple)
    if (m) { removeSection(dev, `router ospf ${m[1]}`); dev.rt.ospfStarted = false; return '' }
    m = /^vlan\s+(\S+)$/.exec(simple)
    if (m && parseVlanList(m[1])) { for (const v of parseVlanList(m[1])) removeSection(dev, `vlan ${v}`); return '' }
    m = /^ip access-list\s+(standard|extended)\s+(\S+)$/.exec(simple)
    if (m) { removeSection(dev, `ip access-list ${m[1]} ${m[2]}`); return '' }
    m = /^access-list\s+(\d+)$/.exec(simple)
    if (m) { removeLines(dev.config.global, `access-list ${m[1]}`); removeSection(dev, `ip access-list standard ${m[1]}`); removeSection(dev, `ip access-list extended ${m[1]}`); return '' }
    m = /^ip dhcp pool\s+(\S+)$/.exec(simple)
    if (m) { removeSection(dev, `ip dhcp pool ${m[1]}`); return '' }
    m = /^ip ospf\s+(\d+)\s+area/.exec(simple)
    if (m && IFM.includes(mode)) { c.forEachHead((L) => removeLines(L, `ip ospf ${m[1]} area`)); return '' }
    if (/^switchport$/.test(simple) && IFM.includes(mode)) return c.noSwitchport()
  }
  // Default-on features stored as "no ..."
  const r = resolve(mode, dev.kind, rest, { partial: true, noForm: true })
  if (r.error) {
    const g = SUB.includes(mode) ? resolve('config', dev.kind, rest, { partial: true, noForm: true }) : r
    if (g.error) return r.error === 'ambiguous' ? `% Ambiguous command:  "no ${rest}"` : `${' '.repeat(prompt(c.session).length + 3 + (r.at ?? 0))}^\n% Invalid input detected at '^' marker.`
    return removeFrom(c, 'config', g)
  }
  return removeFrom(c, mode, r)
}

function removeFrom(c, mode, r) {
  const negLine = `no ${r.line}`.replace('ip domain-lookup', 'ip domain lookup')
  if (NO_STORED.includes(negLine) || NO_STORED.includes(`no ${r.key}`)) {
    if (mode === 'config') setGlobal(c.dev, negLine)
    else c.forEachHead((L) => setLine(L, negLine))
    return ''
  }
  if (r.line === 'passive-interface default' || r.line.startsWith('passive-interface ')) {
    const L = getSection(c.dev, c.ctx.heads[0]).lines
    if (r.line.startsWith('passive-interface ') && hasLine(L, 'passive-interface default') && r.line !== 'passive-interface default') { setLine(L, `no ${r.line}`); return '' }
    removeLines(L, r.line)
    if (r.line === 'passive-interface default') removeLines(L, 'no passive-interface')
    return ''
  }
  if (r.line.startsWith('standby') && !/^standby \d/.test(r.line) && r.line !== 'standby version') {
    c.forEachHead((L) => removeLines(L, r.line.replace(/^standby /, 'standby 0 ')))
    return ''
  }
  if (mode === 'config' && r.line.startsWith('ip route ') && !r.partial) {
    const cr = c.canonRoute(r.vals)
    if (cr.err) return cr.err
    const g = c.dev.config.global
    for (let i = g.length - 1; i >= 0; i--) if (g[i].startsWith('ip route ') && routeSig(g[i]) === routeSig(cr.line)) g.splice(i, 1)
    return ''
  }
  if (/^ipv6 (address|route) /.test(r.line)) {
    const target = normV6(r.line)
    if (mode === 'config') removeLines(c.dev.config.global, target)
    else c.forEachHead((L) => removeLines(L, target))
    return ''
  }
  // turning sticky learning off also drops the addresses it had learned
  if (r.line === 'switchport port-security mac-address sticky') { c.forEachHead((L) => removeLines(L, r.line)); return '' }
  if (r.line.startsWith('ip address') && IFM.includes(mode)) { c.forEachHead((L) => removeLines(L, 'ip address')); return '' }
  if (r.line.startsWith('router-id')) { c.forEachHead((L) => removeLines(L, 'router-id')); return '% OSPF: Reload or use "clear ip ospf process" command, for this to take effect' }
  if (r.line.startsWith('spanning-tree vlan') && /root/.test(r.line)) { removeLines(c.dev.config.global, r.line.replace(/ root.*/, ' priority')); return '' }
  if (mode === 'config' && r.line.startsWith('hostname')) { setGlobal(c.dev, `hostname ${c.dev.kind === 'router' ? 'Router' : 'Switch'}`, 'hostname'); return '' }
  if (r.line.startsWith('enable secret') || r.line.startsWith('enable algorithm-type')) { removeLines(c.dev.config.global, 'enable secret'); c.dev.secrets.enable = null; return '' }
  if (r.line.startsWith('username')) { const u = r.line.split(' ')[1]; removeLines(c.dev.config.global, `username ${u}`); delete c.dev.secrets.users[u]; return '' }
  if (r.line.startsWith('cdp run') || r.line === 'cdp enable') return ''
  if (r.line.startsWith('channel-group')) { c.forEachHead((L) => removeLines(L, 'channel-group')); return '' }
  // generic: an exact match wins ("no ip dhcp snooping" keeps "ip dhcp snooping vlan 10");
  // otherwise remove lines starting with what was typed (or its key when complete)
  const target = r.line
  const drop = (L) => {
    const i = L.indexOf(target)
    if (i >= 0) { L.splice(i, 1); return }
    if (!removeLines(L, target) && r.key && r.key !== target) removeLines(L, r.key)
  }
  if (mode === 'config') drop(c.dev.config.global)
  else if (target.startsWith('switchport')) c.forEachHeadPo((L) => drop(L))
  else c.forEachHead((L) => drop(L))
  if (target === 'ip routing') return ''
  if (target === 'lldp run') return ''
  return ''
}

// ---------- ACL entries ----------
function aclEntry(c, line) {
  const head = c.ctx.heads[0]
  const s = getSection(c.dev, head)
  const type = c.ctx.aclType
  const m = /^(?:(\d+)\s+)?(permit|deny|remark)\s+(.*)$/.exec(line)
  if (!m) {
    const abbreviated = /^(?:(\d+)\s+)?(p|pe|per|perm|permi|d|de|den|r|re|rem)\s+(.*)$/.exec(line)
    if (abbreviated) return aclEntry(c, `${abbreviated[1] ? abbreviated[1] + ' ' : ''}${abbreviated[2].startsWith('p') ? 'permit' : abbreviated[2].startsWith('d') ? 'deny' : 'remark'} ${abbreviated[3]}`)
    return undefined
  }
  const body = normalizeAce(`${m[2]} ${m[3]}`)
  if (m[2] !== 'remark' && !compileAce(body, type)) return `${' '.repeat(prompt(c.session).length + (m[1] ? m[1].length + 1 : 0))}^\n% Invalid input detected at '^' marker.`
  const seq = m[1] ? Number(m[1]) : (Math.max(0, ...s.lines.map((l) => Number(l.split(' ')[0]))) + 10)
  if (s.lines.some((l) => Number(l.split(' ')[0]) === seq)) return '% Duplicate sequence number'
  if (s.lines.some((l) => l.replace(/^\d+ /, '') === body)) return '% Duplicate entry'
  s.lines.push(`${seq} ${body}`)
  s.lines.sort((a, b) => Number(a.split(' ')[0]) - Number(b.split(' ')[0]))
  return ''
}

// Normalize ACE text: "0.0.0.0 255.255.255.255" -> any, "x 0.0.0.0" -> host x, expand keywords
// and, like IOS, clear the address bits the wildcard ignores ("10.1.1.5 0.0.0.255" -> "10.1.1.0 0.0.0.255")
function normalizeAce(body) {
  const t = tok(body)
  const out = []
  for (let i = 0; i < t.length; i++) {
    const a = t[i]
    const n = t[i + 1]
    if (a === 'host' && n !== undefined) { out.push('host', n); i++; continue }
    const addr = parseV4(a)
    const wild = parseV4(n)
    if (addr !== null && wild !== null) {
      i++
      if (n === '255.255.255.255') out.push('any')
      else if (n === '0.0.0.0') out.push('host', a)
      else out.push(v4ToStr(addr & (((1n << 32n) - 1n) ^ wild)), n)
      continue
    }
    out.push(a)
  }
  return out.join(' ')
}

// ======================================================================
// Command context (handlers call these)
// ======================================================================

function makeCtx(session, ctx, dev) {
  const engine = session.engine
  const c = {
    session, ctx, dev, engine,
    get net() { return engine.getNet() },
    heads() {
      if (ctx.mode === 'config' || ctx.mode === 'priv' || ctx.mode === 'user') return []
      return ctx.heads ?? []
    },
    forEachHead(fn) { for (const h of c.heads()) { const s = getSection(dev, h); if (s) fn(s.lines, h) } },
    // Like forEachHead, but switchport settings on a Port-channel also go to its member ports
    forEachHeadPo(fn) {
      c.forEachHead((L, h) => {
        fn(L, h)
        const m = /^interface Port-channel(\d+)$/.exec(h)
        if (!m) return
        for (const p of dev.ports) {
          const ML = getSection(dev, `interface ${p}`)?.lines ?? []
          if (ML.some((l) => l.startsWith(`channel-group ${m[1]} `))) fn(ML, `interface ${p}`)
        }
      })
    },
    store(line, key, matcher) {
      // A pure keyword command ("ip dhcp snooping", "switchport port-security") must not replace
      // longer commands that merely start with the same words ("ip dhcp snooping vlan 10").
      if (key === line) key = null
      const apply = (L) => {
        if (matcher) {
          const i = L.findIndex(matcher)
          if (i >= 0) { L[i] = line; return }
          L.push(line)
          return
        }
        // turning a default-on feature back on clears its stored "no" form
        if (key) removeLines(L, `no ${key}`)
        else if (L.includes(`no ${line}`)) L.splice(L.indexOf(`no ${line}`), 1)
        setLine(L, line, key)
      }
      if (ctx.mode === 'config') apply(dev.config.global)
      else c.forEachHead((L, h) => {
        apply(L)
        // Port-channel switchport settings are pushed to the member ports, as on real switches
        const m = /^interface Port-channel(\d+)$/.exec(h)
        if (m && line.startsWith('switchport')) {
          for (const p of dev.ports) {
            const ML = getSection(dev, `interface ${p}`)?.lines ?? []
            if (ML.some((l) => l.startsWith(`channel-group ${m[1]} `))) apply(ML)
          }
        }
      })
    },
    ask(p, onAnswer, mask) { session.pending = { prompt: p, onAnswer, mask }; return '' },
    maybe7(p) { return hasLine(dev.config.global, 'service password-encryption') ? `7 ${type7(p)}` : p },
    configured() {
      engine.log(dev.id, `%SYS-5-CONFIG_I: Configured from console by ${session.stack.length > 1 ? 'admin on vty0' : 'console'}`)
    },
    enable() {
      const sec = dev.secrets.enable ?? dev.secrets.enablePassword
      if (!sec) {
        if (session.stack.length > 1) return '% No password set'
        ctx.mode = 'priv'
        return ''
      }
      let tries = 0
      const askPw = () => c.ask('Password: ', (a) => {
        if (a === sec) { ctx.mode = 'priv'; return '' }
        tries++
        if (tries >= 3) return '% Bad passwords'
        return askPw()
      }, true)
      return askPw()
    },
    exitExec() {
      if (session.stack.length > 1) {
        session.stack.pop()
        const ip = ctx.remoteIp
        return `\n[Connection to ${ip} closed by foreign host]`
      }
      ctx.mode = 'user'
      return `\n\n\n${hostname(dev)} con0 is now available\n\n\n\n\n\nPress RETURN to get started.\n\n`
    },
    setEnableSecret(p, type) {
      dev.secrets.enable = p
      setGlobal(dev, `enable secret ${type} ${fakeHash(type, p)}`, 'enable secret')
      return ''
    },
    setUser(u, p, type, priv) {
      dev.secrets.users[u] = p
      const pv = priv !== undefined ? ` privilege ${priv}` : ''
      if (type === 0) setGlobal(dev, `username ${u}${pv} password ${c.maybe7(p).startsWith('7 ') ? c.maybe7(p) : `0 ${p}`}`, `username ${u}`)
      else setGlobal(dev, `username ${u}${pv} secret ${type} ${fakeHash(type, p)}`, `username ${u}`)
      return ''
    },
    passwordEncryption() {
      setGlobal(dev, 'service password-encryption')
      const g = dev.config.global
      for (let i = 0; i < g.length; i++) {
        let m = /^enable password (?!7 )(.+)$/.exec(g[i])
        if (m) g[i] = `enable password 7 ${type7(m[1])}`
        m = /^(username \S+(?: privilege \d+)?) password 0 (.+)$/.exec(g[i])
        if (m) g[i] = `${m[1]} password 7 ${type7(m[2])}`
      }
      for (const s of sectionsOf(dev, 'line ')) {
        s.lines = s.lines.map((l) => { const m = /^password (?!7 )(.+)$/.exec(l); return m ? `password 7 ${type7(m[1])}` : l })
      }
      return ''
    },
    linePassword(p) {
      c.forEachHead((L, h) => { dev.secrets.lines[h] = p; setLine(L, `password ${c.maybe7(p)}`, 'password') })
      return ''
    },
    transport(text) {
      const words = text.trim().split(/\s+/)
      const ok = ['ssh', 'telnet', 'all', 'none']
      const full = words.map((w) => ok.find((o) => o.startsWith(w.toLowerCase())))
      if (full.some((w) => !w)) return `${' '.repeat(prompt(session).length + 16)}^\n% Invalid input detected at '^' marker.`
      c.store(`transport input ${full.join(' ')}`, 'transport input')
      return ''
    },
    genRsa(bits) {
      if (['Router', 'Switch'].includes(hostname(dev))) return `% Please define a hostname other than ${hostname(dev)}.`
      const dom = lineValue(dev.config.global, 'ip domain name')
      if (!dom) return '% Please define a domain-name first.'
      const done = (b) => {
        dev.rt.rsaBits = b
        engine.log(dev.id, `%SSH-5-ENABLED: SSH ${b >= 768 ? '1.99' : '1.5'} has been enabled`)
        return `% Generating ${b} bit RSA keys, keys will be non-exportable...\n[OK] (elapsed time was 1 seconds)\n`
      }
      const intro = `The name for the keys will be: ${hostname(dev)}.${dom}\n`
      if (bits) return intro + done(bits)
      return c.ask(`${intro}Choose the size of the key modulus in the range of 512 to 4096 for your\n  General Purpose Keys. Choosing a key modulus greater than 512 may take\n  a few minutes.\n\nHow many bits in the modulus [1024]: `, (a) => {
        const b = a.trim() ? Number(a) : 1024
        if (!(b >= 512 && b <= 4096)) return '% Invalid modulus'
        return done(b)
      })
    },
    ipRoute(v) {
      const r = c.canonRoute(v)
      if (r.err) return r.err
      const line = r.line
      // same prefix + same next hop/interface replaces (AD change), else add
      const g = dev.config.global
      const idx = g.findIndex((l) => l.startsWith('ip route ') && routeSig(l) === routeSig(line))
      if (idx >= 0) g[idx] = line
      else g.push(line)
      return ''
    },
    canonRoute(v) {
      const rest = v[2].trim().split(/\s+/)
      const out = [`ip route ${v[0]} ${v[1]}`]
      let i = 0
      const r1 = canonicalIface(rest[0], rest[1])
      if (r1 && !parseV4(rest[0])) {
        if (!interfaces(dev).includes(r1.name)) return { err: '% Invalid interface' }
        out.push(r1.name)
        i += r1.consumed
      }
      if (rest[i] && parseV4(rest[i]) !== null) { out.push(rest[i]); i++ }
      if (out.length === 1) return { err: `${' '.repeat(prompt(session).length + 9 + v[0].length + v[1].length)}^\n% Invalid input detected at '^' marker.` }
      if (rest[i] && /^\d+$/.test(rest[i]) && Number(rest[i]) >= 1 && Number(rest[i]) <= 255) { out.push(rest[i]); i++ }
      if (rest[i] === 'permanent') { out.push('permanent'); i++ }
      if (i < rest.length) return { err: `${' '.repeat(prompt(session).length + v[2].indexOf(rest[i]) + 10 + v[0].length + v[1].length)}^\n% Invalid input detected at '^' marker.` }
      const n = parseV4(v[0])
      const len = maskToLen(v[1])
      if ((n & ~((1n << BigInt(32 - len)) - 1n) & ((1n << 32n) - 1n)) !== n) return { err: '%Inconsistent address and mask' }
      return { line: out.join(' ') }
    },
    ipv6Route(v) {
      const rest = v[1].trim().split(/\s+/)
      const out = [`ipv6 route ${v[0].toUpperCase()}`]
      let i = 0
      const r1 = canonicalIface(rest[0], rest[1])
      if (r1 && parseV6(rest[0]) === null) { out.push(r1.name); i += r1.consumed }
      if (rest[i] && parseV6(rest[i]) !== null) { out.push(rest[i].toUpperCase()); i++ }
      if (rest[i] && /^\d+$/.test(rest[i])) { out.push(rest[i]); i++ }
      if (out.length === 1 || i < rest.length) return `% Invalid input detected at '^' marker.`
      const nh = parseV6(out[out.length - 1]) ?? parseV6(out[out.length - 2] ?? '')
      if (nh !== null && nh !== undefined && (nh >> 118n) === (0xfe80n >> 6n) && !r1) return '% Interface has to be specified for a link-local nexthop'
      setLine(dev.config.global, normV6(out.join(' ')))
      return ''
    },
    numberedAcl(num, text) {
      const type = (num >= 1 && num <= 99) || (num >= 1300 && num <= 1999) ? 'standard' : 'extended'
      if (num >= 200 && num < 1300) return `${' '.repeat(prompt(session).length + 12)}^\n% Invalid input detected at '^' marker.`
      const body = normalizeAce(text.replace(/^(p|pe|per|perm|permi)\s/, 'permit ').replace(/^(d|de|den)\s/, 'deny ').replace(/^(r|re|rem|rema|remar)\s/, 'remark '))
      if (!body.startsWith('remark') && !compileAce(body, type)) {
        return `${' '.repeat(prompt(session).length + 12 + String(num).length)}^\n% Invalid input detected at '^' marker.`
      }
      // numbered ACLs edited in named mode live in a section; keep both in sync
      const sec = getSection(dev, `ip access-list ${type} ${num}`)
      if (sec) {
        const seq = Math.max(0, ...sec.lines.map((l) => Number(l.split(' ')[0]))) + 10
        sec.lines.push(`${seq} ${body}`)
      } else dev.config.global.push(`access-list ${num} ${body}`)
      return ''
    },
    logLevel(prefix, word) {
      const levels = ['emergencies', 'alerts', 'critical', 'errors', 'warnings', 'notifications', 'informational', 'debugging']
      let lvl = /^\d$/.test(word) ? levels[Number(word)] : levels.find((l) => l.startsWith(word.toLowerCase()))
      if (!lvl) return `${' '.repeat(prompt(session).length + prefix.length + 1)}^\n% Invalid input detected at '^' marker.`
      c.store(`${prefix} ${lvl}`, prefix)
      return ''
    },
    stpPriority(vlist, p) {
      if (p % 4096 !== 0) return '% Bridge Priority must be in increments of 4096.\n% Allowed values are:\n  0     4096  8192  12288 16384 20480 24576 28672\n  32768 36864 40960 45056 49152 53248 57344 61440'
      c.store(`spanning-tree vlan ${vlist} priority ${p}`, `spanning-tree vlan ${vlist} priority`)
      return ''
    },
    stpRoot(vlist, which) {
      if (which === 'secondary') { c.store(`spanning-tree vlan ${vlist} priority 28672`, `spanning-tree vlan ${vlist} priority`); return '' }
      // primary: 24576, or lower than the current root by 4096
      let prio = 24576
      const net = engine.getNet()
      for (const v of parseVlanList(vlist)) {
        const st = net.stp[v]
        if (st && st.root && st.root !== dev.id) {
          const r = st.bridges[st.root]
          if (r.prio <= 24576) prio = Math.min(prio, Math.max(0, r.prio - 4096))
        }
      }
      c.store(`spanning-tree vlan ${vlist} priority ${prio}`, `spanning-tree vlan ${vlist} priority`)
      return ''
    },
    enterInterface(name) {
      let sec = getSection(dev, `interface ${name}`)
      const t = ifaceType(name)
      if (!sec) {
        if (isSubif(name)) {
          if (!getSection(dev, `interface ${parentOf(name)}`) || isSwitch(dev) && dev.kind === 'switch') return '% Invalid input detected at \'^\' marker.'
          sec = ensureSection(dev, `interface ${name}`)
        } else if (t === 'Loopback' || t === 'Port-channel') {
          sec = ensureSection(dev, `interface ${name}`)
        } else if (t === 'Vlan' && isSwitch(dev)) {
          sec = ensureSection(dev, `interface ${name}`)
          engine.log(dev.id, `%LINK-3-UPDOWN: Interface ${name}, changed state to up`)
        } else return `${' '.repeat(prompt(session).length + 10)}^\n% Invalid input detected at '^' marker.`
      }
      ctx.mode = isSubif(name) ? 'subif' : 'if'
      ctx.heads = [`interface ${name}`]
      return ''
    },
    enterRange(text) {
      const list = expandRange(text, isIos(dev) ? interfaces(dev) : [])
      if (!list || !list.length) return '% Command rejected: Bad interface range'
      ctx.mode = 'range'
      ctx.heads = list.map((n) => `interface ${n}`)
      return ''
    },
    enterSection(head, mode) {
      ensureSection(dev, head)
      ctx.mode = mode
      ctx.heads = [head]
      return ''
    },
    enterLine(kind, a, b) {
      if (kind === 'con') { ctx.mode = 'line'; ctx.heads = ['line con 0']; return '' }
      const heads = []
      if (a <= 4) heads.push('line vty 0 4')
      if (b >= 5) heads.push('line vty 5 15')
      ctx.mode = 'line'
      ctx.heads = heads
      return ''
    },
    enterVlan(vlist) {
      const list = [...parseVlanList(vlist)]
      if (list.some((v) => v >= 1002 && v <= 1005)) return `% Default VLAN ${list.find((v) => v >= 1002 && v <= 1005)} may not have its name changed.`
      for (const v of list) if (v !== 1) ensureSection(dev, `vlan ${v}`)
      ctx.mode = 'vlan'
      ctx.heads = list.filter((v) => v !== 1).map((v) => `vlan ${v}`)
      if (list.includes(1) && list.length === 1) { ctx.heads = []; return '' }
      return ''
    },
    enterAcl(type, name) {
      const numbered = /^\d+$/.test(name)
      if (numbered) {
        const n = Number(name)
        const isStd = (n >= 1 && n <= 99) || (n >= 1300 && n <= 1999)
        if ((type === 'standard') !== isStd) return `% Invalid access list name.`
        // move numbered entries into the section so they can be edited by sequence
        const existing = globalLines(dev, `access-list ${n} `)
        const sec = ensureSection(dev, `ip access-list ${type} ${name}`)
        existing.forEach((l, i) => sec.lines.push(`${(i + 1) * 10} ${l.replace(/^access-list \d+ /, '')}`))
        removeLines(dev.config.global, `access-list ${n}`)
      } else {
        const other = getSection(dev, `ip access-list ${type === 'standard' ? 'extended' : 'standard'} ${name}`)
        if (other) return `% A named ${type === 'standard' ? 'extended' : 'standard'} IP access list with this name already exists`
        ensureSection(dev, `ip access-list ${type} ${name}`)
      }
      ctx.mode = 'acl'
      ctx.aclType = type
      ctx.heads = [`ip access-list ${type} ${name}`]
      return ''
    },
    // A router subinterface needs its VLAN before it can take an IP address
    noEncap() { return c.heads().some((h) => isSubif(h.slice(10)) && !hasLine(getSection(dev, h)?.lines ?? [], 'encapsulation')) },
    encapsulation(vid, native) {
      const name = ctx.heads[0].slice(10)
      const other = interfaces(dev).find((i) => i !== name && isSubif(i) && parentOf(i) === parentOf(name) && Number((lineValue(ifaceLines(dev, i), 'encapsulation dot1Q') ?? '').split(' ')[0]) === vid)
      if (other) return `%Configuration of multiple subinterfaces of the same main interface\n with the same VID (${vid}) is not permitted.\nThis VID is already configured on ${other}.`
      c.store(`encapsulation dot1Q ${vid}${native ? ' native' : ''}`, 'encapsulation')
      // IOS lists the encapsulation first in the subinterface config
      const L = getSection(dev, ctx.heads[0]).lines
      L.unshift(...L.splice(L.findIndex((l) => l.startsWith('encapsulation')), 1))
      return ''
    },
    ipAddress(ip, mask) {
      if (c.noEncap()) return SUBIF_NO_ENCAP
      const msgs = []
      const len = maskToLen(mask)
      const a = parseV4(ip)
      const netw = networkOf(4, a, len)
      const bcast = netw | ((1n << BigInt(32 - len)) - 1n)
      if (len < 31 && (a === netw || a === bcast)) return `Bad mask /${len} for address ${ip}`
      for (const h of c.heads()) {
        const name = h.slice(10)
        if (isSwitch(dev) && isPhysical(name) && !hasLine(ifaceLines(dev, name), 'no switchport')) {
          msgs.push(`${' '.repeat(prompt(session).length + 3)}^\n% Invalid input detected at '^' marker.`)
          continue
        }
        for (const other of interfaces(dev)) {
          if (other === name) continue
          const m = ifaceLines(dev, other).map((l) => /^ip address (\S+) (\S+)$/.exec(l)).find(Boolean)
          if (!m) continue
          const ol = maskToLen(m[2])
          const minLen = Math.min(ol, len)
          if (networkOf(4, parseV4(m[1]), minLen) === networkOf(4, a, minLen)) {
            msgs.push(`% ${v4ToStr(networkOf(4, a, len))} overlaps with ${other}`)
          }
        }
        if (msgs.some((m) => m.includes('overlaps'))) continue
        setLine(getSection(dev, h).lines, `ip address ${ip} ${mask}`, 'ip address')
      }
      return msgs.join('\n')
    },
    switchportMode(line) {
      c.forEachHeadPo((L) => {
        removeLines(L, 'switchport mode')
        L.push(line)
        if (line !== 'switchport mode access' && line !== 'switchport mode trunk' && hasLine(L, 'switchport port-security')) { /* port security would reject */ }
      })
      return ''
    },
    accessVlan(v, s) {
      let msg = ''
      if (!vlanDb(dev).has(v)) {
        ensureSection(dev, `vlan ${v}`)
        msg = `% ${s.line.startsWith('switchport voice') ? 'Voice' : 'Access'} VLAN does not exist. Creating vlan ${v}`
      }
      c.store(s.line, s.key)
      return msg
    },
    allowedVlans(text) {
      const t = text.trim()
      let mode = 'set'
      let list = t
      const m = /^([a-z]+)\s+(\S+)$/i.exec(t)
      const kw = (w) => ['add', 'remove', 'except', 'all', 'none'].filter((k) => k.startsWith(w.toLowerCase()))
      if (m && kw(m[1]).length === 1 && ['add', 'remove', 'except'].includes(kw(m[1])[0])) { mode = kw(m[1])[0]; list = m[2] }
      else if (/^[a-z]+$/i.test(t) && kw(t).length === 1) list = kw(t)[0]
      if (list !== 'all' && list !== 'none' && /^[a-z]+$/i.test(list) && kw(list).length === 1) list = kw(list)[0]
      if (list !== 'all' && list !== 'none' && !parseVlanList(list)) return `% Invalid input detected at '^' marker.`
      c.forEachHeadPo((L) => {
        const cur = lineValue(L, 'switchport trunk allowed vlan')
        let set = cur === undefined || cur === 'all' ? null : cur === 'none' ? new Set() : parseVlanList(cur)
        const given = list === 'all' ? null : list === 'none' ? new Set() : parseVlanList(list)
        if (mode === 'set') set = given
        if (mode === 'add') { if (set) for (const v of given) set.add(v) }
        if (mode === 'remove') { const base = set ?? new Set(Array.from({ length: 4094 }, (_, i) => i + 1)); for (const v of given) base.delete(v); set = base }
        if (mode === 'except') { set = new Set(Array.from({ length: 4094 }, (_, i) => i + 1)); for (const v of given) set.delete(v) }
        removeLines(L, 'switchport trunk allowed vlan')
        if (set) L.push(`switchport trunk allowed vlan ${set.size ? compress([...set]) : 'none'}`)
      })
      return ''
    },
    nonegotiate(s) {
      const bad = c.heads().filter((h) => {
        const m = lineValue(getSection(dev, h).lines, 'switchport mode')
        return !m || m.startsWith('dynamic')
      })
      if (bad.length) return 'Command rejected: Conflict between \'nonegotiate\' and \'dynamic\' status.'
      c.store(s.line, s.key)
      return ''
    },
    portSecurity(s, isMac) {
      for (const h of c.heads()) {
        const L = getSection(dev, h).lines
        const m = lineValue(L, 'switchport mode')
        if (!m || m.startsWith('dynamic')) return `Command rejected: ${h.slice(10)} is a dynamic port.`
      }
      if (isMac) c.forEachHead((L) => setLine(L, s.line))
      else c.store(s.line, s.key)
      return ''
    },
    // default-router / dns-server take up to 8 addresses
    ipList(word, text) {
      const ips = text.trim().split(/\s+/)
      const bad = ips.findIndex((x) => parseV4(x) === null)
      if (bad >= 0 || ips.length > 8) return `${' '.repeat(prompt(session).length + word.length + 1 + text.indexOf(ips[Math.max(bad, 8)]))}^\n% Invalid input detected at '^' marker.`
      c.store(`${word} ${ips.join(' ')}`, word)
      return ''
    },
    // "banner motd #text#" on one line, or "banner motd #" followed by lines up to the closing delimiter.
    // IOS shows the delimiter as ^C in the running config.
    banner(text) {
      const d = text[0]
      const rest = text.slice(1)
      const save = (body) => { c.store(`banner motd ^C${body}^C`, 'banner motd'); engine.markDirty(); return '' }
      if (rest.includes(d)) return save(rest.slice(0, rest.indexOf(d)))
      const lines = [rest]
      const more = () => c.ask('', (l) => {
        if (l.includes(d)) { lines.push(l.slice(0, l.indexOf(d))); return save(lines.join('\n')) }
        lines.push(l)
        return more()
      })
      return `Enter TEXT message.  End with the character '${d}'.${more()}`
    },
    psMac(mac, sticky) {
      const m = /^([0-9a-f]{1,4})\.([0-9a-f]{1,4})\.([0-9a-f]{1,4})$/i.exec(mac)
      if (!m) return `${' '.repeat(prompt(session).length + 37 + (sticky ? 7 : 0))}^\n% Invalid input detected at '^' marker.`
      const norm = m.slice(1).map((g) => g.toLowerCase().padStart(4, '0')).join('.')
      return c.portSecurity({ line: `switchport port-security mac-address ${sticky ? 'sticky ' : ''}${norm}` }, true)
    },
    channelGroup(num, s) {
      const po = `interface Port-channel${num}`
      let msg = ''
      if (!getSection(dev, po)) {
        const first = getSection(dev, c.heads()[0]).lines.filter((l) => l.startsWith('switchport') && !l.startsWith('switchport port-security') || l === 'no switchport')
        const sec = ensureSection(dev, po)
        sec.lines.push(...first)
        msg = `Creating a port-channel interface Port-channel ${num}`
      }
      c.store(s.line, 'channel-group')
      engine.markDirty()
      return msg
    },
    noSwitchport() {
      c.forEachHead((L) => {
        for (let i = L.length - 1; i >= 0; i--) if (L[i].startsWith('switchport') || L[i].startsWith('spanning-tree')) L.splice(i, 1)
        setLine(L, 'no switchport')
      })
      return ''
    },
    routerId(ip) {
      const L = getSection(dev, ctx.heads[0]).lines
      setLine(L, `router-id ${ip}`, 'router-id')
      if (dev.rt.ospfStarted && dev.rt.ospfRid !== ip) {
        // A process with no OSPF interfaces yet picks up the new ID right away
        if (!(engine.getNet().ospf.ifaces[dev.id] ?? []).length) { dev.rt.ospfRid = ip; return '' }
        return '% OSPF: Reload or use "clear ip ospf process" command, for this to take effect'
      }
      return ''
    },
    ping(target, opts = {}) { return engine.ping(dev.id, target, opts) },
    traceroute(target, opts = {}) { return engine.traceroute(dev.id, target, opts) },
    remote(proto, ip, user) { return engine.remoteLogin(session, dev.id, proto, ip, user) },
  }
  return c
}

// IPv6 addresses are kept the way IOS shows them: compressed, upper case
const normV6 = (line) => tok(line).map((w) => {
  const m = /^([0-9a-fA-F:]+)(\/\d{1,3})?$/.exec(w)
  if (!m || !w.includes(':')) return w
  const a = parseV6(m[1])
  return a === null ? w : v6ToStr(a) + (m[2] ?? '')
}).join(' ')

// A static route's identity: prefix + exit interface/next hop, ignoring AD and "permanent"
const routeSig = (l) => tok(l).filter((x) => (!/^\d+$/.test(x) || x.includes('.')) && x !== 'permanent').join(' ')

function compress(vs) {
  vs.sort((a, b) => a - b)
  const parts = []
  let s = vs[0]
  let p = vs[0]
  for (const v of [...vs.slice(1), null]) {
    if (v === p + 1) { p = v; continue }
    parts.push(s === p ? `${s}` : `${s}-${p}`)
    s = p = v
  }
  return parts.join(',')
}

// ======================================================================
// Help (?) and Tab completion
// ======================================================================

// Templates that accept `known` as a prefix. Where one template matched a word exactly, templates
// that only matched it as an abbreviation are dropped ("ip ?" must not offer ipv6 commands).
function continuations(mode, kind, known) {
  const toks = tokenize(known)
  const list = []
  for (const tpl of candidatesFor(mode, kind)) {
    if (tpl.hidden) continue
    const r = known ? matchTpl(tpl, toks, known, true) : { ok: true, partial: true, j: 0, exp: [] }
    if (r.ok) list.push({ tpl, r })
  }
  let pool = list
  for (let k = 0; k < toks.length; k++) {
    const word = toks[k].t.toLowerCase()
    const litAt = (x) => x.r.exp.find((e) => e.i === k && e.kind === 'lit')
    if (pool.some((x) => litAt(x)?.v.toLowerCase() === word)) pool = pool.filter((x) => !litAt(x) || litAt(x).v.toLowerCase() === word)
  }
  return pool
}

function helpFor(tk, dev) {
  if (tk.ph === 'num' && tk.min !== null) return [`<${tk.min}-${tk.max}>`]
  if (tk.ph === 'iface') {
    const types = dev.kind === 'router' ? ['GigabitEthernet', 'Loopback'] : ['GigabitEthernet', 'Loopback', 'Port-channel', 'Vlan']
    return types
  }
  return [HELP_TYPE[tk.ph] ?? tk.ph]
}

// "?" inside an ACL entry: what may come next after "permit"/"deny" ({ opts, cr })
function aclNext(type, t) {
  const ADDR = ['A.B.C.D', 'any', 'host']
  let i = 0
  // consume one address spec; returns the options if input ends inside it
  const addr = () => {
    if (i >= t.length) return { opts: ADDR }
    if (t[i] === 'any') { i++; return null }
    if (t[i] === 'host') { if (i + 1 >= t.length) return { opts: ['A.B.C.D'] }; i += 2; return null }
    if (parseV4(t[i]) === null) return { bad: true }
    if (i + 1 >= t.length) return { opts: ['A.B.C.D'], wildOptional: type === 'standard' }
    if (parseV4(t[i + 1]) !== null) i += 2
    else if (type === 'standard') i++
    else return { bad: true }
    return null
  }
  const PORTOPS = ['eq', 'gt', 'lt', 'neq', 'range']
  const port = () => {
    if (i >= t.length || !PORTOPS.includes(t[i])) return null
    const need = t[i] === 'range' ? 2 : 1
    if (i + need >= t.length) return { opts: ['<0-65535>'] }
    i += need + 1
    return null
  }
  if (type === 'standard') {
    const a = addr()
    if (a) return a.wildOptional ? { opts: ['A.B.C.D', 'log'], cr: true } : a
    return i < t.length && t[i] === 'log' ? { opts: [], cr: true } : { opts: ['log'], cr: true }
  }
  if (!t.length) return { opts: ['<0-255>', 'ahp', 'eigrp', 'esp', 'gre', 'icmp', 'ip', 'ospf', 'tcp', 'udp'] }
  const proto = t[i++]
  const l4 = proto === 'tcp' || proto === 'udp'
  let a = addr()
  if (a) return a
  if (l4) {
    if (i >= t.length) return { opts: [...ADDR, ...PORTOPS] }
    const p = port()
    if (p) return p
  }
  a = addr()
  if (a) return a
  if (l4) { const p = port(); if (p) return p }
  const extra = ['log', ...(proto === 'tcp' ? ['established'] : []), ...(proto === 'icmp' ? ['echo', 'echo-reply', 'time-exceeded', 'unreachable'] : [])]
  return { opts: [...(l4 && !PORTOPS.includes(t[i - 2]) && !PORTOPS.includes(t[i - 3]) ? PORTOPS : []), ...extra], cr: true }
}

export function help(session, input) {
  const ctx = session.stack[session.stack.length - 1]
  const dev = session.engine.dev(ctx.devId)
  let line = input.replace(/\?$/, '')
  let mode = ctx.mode
  if (CFG.includes(mode) && /^do\s+/.test(line)) { line = line.replace(/^do\s+/, ''); mode = 'priv' }
  let noForm = false
  if (CFG.includes(mode) && /^no\s+/.test(line)) { line = line.replace(/^no\s+/, ''); noForm = true }
  const wordHelp = !/\s$/.test(line) && line.length > 0
  const toks = tokenize(line)
  const prefix = wordHelp ? toks.pop().t.toLowerCase() : ''
  const known = toks.map((t) => t.t).join(' ')
  const opts = new Map()
  let complete = false
  // ACL entries are free-form text to the parser, so walk them by hand
  const acl = (() => {
    const w = toks.map((x) => x.t)
    if (mode === 'acl') { if (/^\d+$/.test(w[0] ?? '')) w.shift(); return w.length && /^(p|pe|per|perm|permi|permit|d|de|den|deny)$/i.test(w[0]) ? { type: ctx.aclType, rest: w.slice(1) } : null }
    if (mode === 'config' && /^access-list$/i.test(w[0] ?? '') && /^\d+$/.test(w[1] ?? '') && /^(p|pe|per|perm|permi|permit|d|de|den|deny)$/i.test(w[2] ?? '')) {
      const n = Number(w[1])
      return { type: (n >= 1 && n <= 99) || (n >= 1300 && n <= 1999) ? 'standard' : 'extended', rest: w.slice(3) }
    }
    return null
  })()
  if (acl) {
    const r = aclNext(acl.type, acl.rest)
    const list = (r.opts ?? []).filter((o) => o.toLowerCase().startsWith(prefix))
    if (wordHelp) return list.length ? list.join('  ') : '% Unrecognized command'
    const lines = list.map((k) => `  ${k}`)
    if (r.cr) lines.push('  <cr>')
    return lines.length ? lines.join('\n') : '% Unrecognized command'
  }
  // A sub-mode's "?" lists that mode's commands; global commands only show up when nothing in
  // the sub-mode matches what was typed so far
  for (const m of SUB.includes(mode) ? [mode, 'config'] : [mode]) {
    for (const { tpl, r } of continuations(m, dev.kind, known)) {
      if (!r.partial && !wordHelp) { complete = true; continue }
      const next = tpl.toks[r.j ?? 0]
      if (!next) continue
      if (next.lit) for (const a of next.lit) { if (a.toLowerCase().startsWith(prefix)) opts.set(a, '') }
      else if (!wordHelp) for (const h of helpFor(next, dev)) opts.set(h, '')
      if (next.optional && !wordHelp) complete = true
    }
    if (opts.size || complete || !known) break
  }
  if (mode === 'acl' && !known) for (const w of ['permit', 'deny', 'remark', '<1-2147483647>']) if (w.startsWith(prefix)) opts.set(w, '')
  if (CFG.includes(mode) && !known && !noForm && 'no'.startsWith(prefix)) opts.set('no', '')
  if (CFG.includes(mode) && !known && !noForm && mode !== 'config' && 'exit'.startsWith(prefix)) opts.set('exit', '')
  if (CFG.includes(mode) && !known && !noForm && 'do'.startsWith(prefix)) opts.set('do', '')
  if (noForm) { opts.delete('do'); opts.delete('end'); opts.delete('exit') }
  const list = [...opts.keys()].sort()
  if (wordHelp) return list.length ? list.join('  ') : '% Unrecognized command'
  const lines = list.map((k) => `  ${k}`)
  if (complete) lines.push('  <cr>')
  return lines.length ? lines.join('\n') : '% Unrecognized command'
}

export function complete(session, input) {
  const ctx = session.stack[session.stack.length - 1]
  const dev = session.engine.dev(ctx.devId)
  if (/\s$/.test(input) || !input) return input
  let mode = ctx.mode
  let lead = ''
  let line = input
  if (CFG.includes(mode) && /^do\s+/.test(line)) { lead = line.match(/^do\s+/)[0]; line = line.slice(lead.length); mode = 'priv' }
  if (CFG.includes(mode) && /^no\s+/.test(line)) { lead += line.match(/^no\s+/)[0]; line = line.slice(line.match(/^no\s+/)[0].length) }
  const toks = tokenize(line)
  const last = toks.pop()
  const known = toks.map((t) => t.t).join(' ')
  const hits = new Set()
  for (const m of SUB.includes(mode) ? [mode, 'config'] : [mode]) {
    for (const { tpl, r } of continuations(m, dev.kind, known)) {
      if (!r.partial) continue
      const next = tpl.toks[r.j ?? 0]
      if (next?.lit) for (const a of next.lit) if (a.toLowerCase().startsWith(last.t.toLowerCase())) hits.add(a)
    }
    if (hits.size) break
  }
  if (hits.size !== 1) return input
  return lead + line.slice(0, last.start) + [...hits][0] + ' '
}

export { promptOf, NO_STORED }
