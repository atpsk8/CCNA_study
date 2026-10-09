// Lab engine: owns devices, cabling, terminals and logs. The UI talks only to this.

import { createDevice, hostname, isIos, ifaceLines, hasLine, lineValue, interfaces, getSection, macBig } from './device.js'
import { compute, roundTrip, forward, dhcpRequest, lookup, evalAcl, usableAddrs, shortName, ifaceMac } from './network.js'
import { createSession, execute, prompt as promptText, help as helpText, complete as completeText } from './cli.js'
import { parseV4, v4ToStr, parseV6, v6ToStr, macToStr, lenToMask } from './ip.js'
import { canonicalIface } from './iface.js'
import { levelNum } from './show.js'

const MAX_LINES = 600

export class LabEngine {
  constructor(def, saved) {
    this.def = def
    this.dirty = true
    this.net = null
    this.prevSnap = null
    if (saved && saved.version === 2) {
      this.devices = saved.devices
      this.rt = saved.rt ?? {}
      this.transcripts = saved.transcripts ?? {}
      this.cmdLog = saved.cmdLog ?? {}
      this.manual = saved.manual ?? {}
    } else this.reset(true)
    this.lab = { devices: this.devices, links: def.links, rt: this.rt }
    this.sessions = {}
    for (const d of this.devices) {
      this.sessions[d.id] = createSession(this, d.id)
      if (!isIos(d)) this.sessions[d.id].stack[0].mode = 'pc'
      else this.sessions[d.id].stack[0].mode = saved ? 'priv' : 'user'
      this.transcripts[d.id] ??= []
    }
    this.getNet()
    this.prevSnap = this.snapshot()
  }

  reset(initial) {
    this.devices = this.def.devices.map((spec) => createDevice(spec))
    this.rt = { hsrp: {}, aclHits: {} }
    this.transcripts = {}
    this.cmdLog = {}
    this.manual = {}
    this.lab = { devices: this.devices, links: this.def.links, rt: this.rt }
    // Apply the starting configuration through the real CLI so it is stored canonically
    for (const spec of this.def.devices) {
      const dev = this.dev(spec.id)
      if (!isIos(dev) || !spec.config) continue
      const s = createSession(this, dev.id)
      s.stack[0].mode = 'config'
      for (const line of spec.config.trim().split('\n')) {
        const l = line.replace(/^\s+/, '')
        if (!l || l.startsWith('!')) continue
        // indented lines belong to the previous mode; unindented lines go back to global
        if (!/^\s/.test(line) && s.stack[0].mode !== 'config') { s.stack[0].mode = 'config'; s.stack[0].heads = null }
        const out = execute(s, l)
        if (out && /Invalid|Incomplete|Ambiguous|Bad mask|overlaps|^%/m.test(out) && !/^% (Access|Voice) VLAN/.test(out)) console.warn(`[lab ${this.def.id}] ${dev.id}: "${l}" -> ${out}`)
      }
      dev.startup = JSON.parse(JSON.stringify(dev.config))
    }
    for (const d of this.devices) {
      if (!isIos(d) && d.host.dhcp && d.host.autoDhcp) { this.getNet(); this.renew(d.id, true) }
      d.rt.log = []
    }
    this.dirty = true
    if (!initial) {
      this.sessions = {}
      for (const d of this.devices) {
        this.sessions[d.id] = createSession(this, d.id)
        if (!isIos(d)) this.sessions[d.id].stack[0].mode = 'pc'
        this.transcripts[d.id] = []
      }
      this.getNet()
      this.prevSnap = this.snapshot()
    }
  }

  dev(id) { return this.devices.find((d) => d.id === id) }
  markDirty() { this.dirty = true }

  getNet() {
    if (this.dirty || !this.net) {
      this.dirty = false
      // messages raised while forwarding packets (e.g. DAI drops) are logged with the next diff
      const pending = this.net?.events ?? []
      this.lab.rt = this.rt
      this.net = compute(this.lab)
      // IOS DHCP clients pick up an address once something answers
      let again = false
      for (const d of this.devices) {
        if (!isIos(d)) continue
        for (const i of interfaces(d)) {
          if (!ifaceLines(d, i).includes('ip address dhcp') || d.rt.dhcpClient?.[i]) continue
          const r = dhcpRequest(this.net, d.id, i)
          if (r.lease) {
            d.rt.dhcpClient ??= {}
            d.rt.dhcpClient[i] = { ...r.lease, serverIp: r.server }
            this.log(d.id, `%DHCP-6-ADDRESS_ASSIGN: Interface ${i} assigned DHCP address ${r.lease.ip}, mask ${r.lease.mask}, hostname ${hostname(d)}`)
            again = true
          }
        }
        for (const i of Object.keys(d.rt.dhcpClient ?? {})) if (!ifaceLines(d, i).includes('ip address dhcp')) { delete d.rt.dhcpClient[i]; again = true }
      }
      if (again) this.net = compute(this.lab)
      this.net.events.unshift(...pending)
    }
    return this.net
  }

  // ---------- logging ----------
  stamp() {
    const d = new Date()
    const mon = d.toLocaleString('en-US', { month: 'short' })
    return `*${mon} ${String(d.getDate()).padStart(2, ' ')} ${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}: `
  }

  log(devId, msg) {
    const dev = this.dev(devId)
    if (!dev || !isIos(dev)) return
    const line = this.stamp() + msg
    dev.rt.log.push(line)
    if (dev.rt.log.length > 200) dev.rt.log.shift()
    const sev = /^%[A-Z0-9_]+-(\d)-/.exec(msg)
    const consoleLvl = levelNum(lineValue(dev.config.global, 'logging console')) ?? 7
    const off = hasLine(dev.config.global, 'no logging console')
    if (!off && (!sev || Number(sev[1]) <= consoleLvl)) this.append(devId, line)
  }

  append(devId, text) {
    const t = (this.transcripts[devId] ??= [])
    for (const l of String(text).split('\n')) t.push(l)
    if (t.length > MAX_LINES) t.splice(0, t.length - MAX_LINES)
  }

  // ---------- state diff -> syslog messages ----------
  snapshot() {
    const net = this.getNet()
    const snap = { ifs: {}, ospf: {}, hsrp: {}, cdp: {} }
    for (const m of net.cdpNotices ?? []) snap.cdp[m.key] = m.msg
    for (const d of this.devices) {
      if (!isIos(d)) continue
      for (const [i, st] of Object.entries(net.ifState[d.id] ?? {})) snap.ifs[`${d.id}|${i}`] = `${st.status}|${st.protocol}`
      for (const n of net.ospf.neighbors[d.id] ?? []) if (n.state === 'FULL' || n.state === '2WAY') snap.ospf[`${d.id}|${v4ToStr(n.rid)}|${n.iface}`] = n.state
    }
    for (const [k, list] of Object.entries(net.hsrp)) for (const g of list) snap.hsrp[`${k}|${g.group}`] = g.state
    return snap
  }

  emitDiff() {
    const prev = this.prevSnap
    const net = this.getNet()
    for (const e of net.events) this.log(e.dev, e.msg)
    net.events = []
    const cur = this.snapshot()
    if (prev) {
      for (const [k, v] of Object.entries(cur.ifs)) {
        const old = prev.ifs[k]
        if (old === v || old === undefined) continue
        const [devId, iface] = k.split('|')
        const [os, op] = old.split('|')
        const [ns, np] = v.split('|')
        if (os !== ns) {
          if (ns === 'administratively down') this.log(devId, `%LINK-5-CHANGED: Interface ${iface}, changed state to administratively down`)
          else this.log(devId, `%LINK-3-UPDOWN: Interface ${iface}, changed state to ${ns === 'up' ? 'up' : 'down'}`)
        }
        if (op !== np && !iface.startsWith('Loopback') || (op !== np && iface.startsWith('Loopback'))) this.log(devId, `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${iface}, changed state to ${np}`)
      }
      for (const k of new Set([...Object.keys(prev.ospf), ...Object.keys(cur.ospf)])) {
        const [devId, rid, iface] = k.split('|')
        const a = prev.ospf[k]
        const b = cur.ospf[k]
        const pid = net.ospf.ifaces[devId]?.[0]?.pid ?? 1
        if (b === 'FULL' && a !== 'FULL') this.log(devId, `%OSPF-5-ADJCHG: Process ${pid}, Nbr ${rid} on ${iface} from LOADING to FULL, Loading Done`)
        // with the interface still up, the neighbor just stops hearing hellos (mismatch, passive, ...)
        if (!b && a) this.log(devId, `%OSPF-5-ADJCHG: Process ${pid}, Nbr ${rid} on ${iface} from ${a === 'FULL' ? 'FULL' : '2WAY'} to DOWN, Neighbor Down: ${net.ifState[devId]?.[iface]?.protocol === 'up' ? 'Dead timer expired' : 'Interface down or detached'}`)
      }
      for (const [k, msg] of Object.entries(cur.cdp)) if (prev.cdp?.[k] !== msg) this.log(k.split('|')[0], msg)
      for (const [k, v] of Object.entries(cur.hsrp)) {
        const old = prev.hsrp[k]
        if (old && old !== v) {
          const [devId, iface, grp] = k.split('|')
          this.log(devId, `%HSRP-5-STATECHANGE: ${shortName(iface)} Grp ${grp} state ${old} -> ${v}`)
        }
      }
    }
    this.prevSnap = cur
  }

  // ---------- terminal I/O ----------
  promptFor(devId) {
    const s = this.sessions[devId]
    if (s.pending) return s.pending.prompt
    const top = s.stack[s.stack.length - 1]
    if (top.mode === 'pc') return 'C:\\>'
    return promptText(s)
  }

  isMasked(devId) { return !!this.sessions[devId].pending?.mask }

  // Run one line typed in a device tab. Returns nothing; read transcripts.
  input(devId, line) {
    const s = this.sessions[devId]
    const masked = this.isMasked(devId)
    const p = this.promptFor(devId)
    const echoed = masked ? p : p + line
    // prompts that end with a newline-less question keep the answer on the same line
    this.append(devId, echoed)
    const top = s.stack[s.stack.length - 1]
    let out
    if (top.mode === 'pc' && !s.pending) out = this.runPc(devId, line)
    else {
      const before = top.devId
      const modeBefore = top.mode
      s.lastLine = null
      out = execute(s, line)
      if (line.trim() && !masked) this.recordCmd(before, s.lastLine ?? line.trim(), { mode: modeBefore })
    }
    if (out) this.append(devId, out)
    if (this.dirty) { this.getNet(); this.emitDiff() }
  }

  recordCmd(devId, line, ctx) {
    (this.cmdLog[devId] ??= []).push({ mode: ctx.mode, line })
    if (this.cmdLog[devId].length > 300) this.cmdLog[devId].shift()
  }

  help(devId, line) {
    const s = this.sessions[devId]
    const top = s.stack[s.stack.length - 1]
    this.append(devId, this.promptFor(devId) + line)
    if (top.mode === 'pc') { this.append(devId, PC_HELP); return line.replace(/\?$/, '') }
    this.append(devId, helpText(s, line))
    return line.replace(/\?$/, '')
  }

  complete(devId, line) {
    const s = this.sessions[devId]
    const top = s.stack[s.stack.length - 1]
    if (top.mode === 'pc') return line
    return completeText(s, line)
  }

  history(devId) { return this.sessions[devId].history }

  // ---------- ping / traceroute ----------
  resolveTarget(target) {
    const v4 = parseV4(target)
    if (v4 !== null) return { fam: 4, addr: v4 }
    const v6 = parseV6(target)
    if (v6 !== null) return { fam: 6, addr: v6 }
    return null
  }

  sourceAddr(devId, src, fam) {
    if (!src) return undefined
    const ip = fam === 4 ? parseV4(src) : parseV6(src)
    if (ip !== null) return ip
    const r = canonicalIface(src)
    if (!r) return null
    const a = usableAddrs(this.getNet(), devId).find((x) => x.iface === r.name && x.fam === fam && (fam === 4 ? x.primary : !x.linkLocal))
    return a ? a.addr : null
  }

  ping(devId, target, opts = {}) {
    const t = this.resolveTarget(target)
    const dev = this.dev(devId)
    if (!t) return `Translating "${target}"...domain server (255.255.255.255)\n% Unrecognized host or address, or protocol not running.`
    const net = this.getNet()
    const src = this.sourceAddr(devId, opts.source, t.fam)
    if (src === null) return `% Invalid source address- IP address not on any of our up interfaces`
    const n = opts.repeat ?? 5
    const lines = ['Type escape sequence to abort.', `Sending ${n}, ${t.fam === 4 ? '100' : '100'}-byte ICMP Echos to ${t.fam === 4 ? v4ToStr(t.addr) : v6ToStr(t.addr)}, timeout is 2 seconds:`]
    if (src !== undefined) lines.push(`Packet sent with a source address of ${t.fam === 4 ? v4ToStr(src) : v6ToStr(src)}`)
    let marks = ''
    let ok = 0
    for (let i = 0; i < n; i++) {
      const r = roundTrip(net, devId, t.fam, t.addr, { src, flow: i, id: i + 1 })
      if (r.ok) {
        const first = r.out.hops[0]
        const key = first ? (t.fam === 4 ? v4ToStr(first.addr) : v6ToStr(first.addr)) : 'self'
        dev.rt.arp ??= []
        dev.rt.nd ??= []
        const cache = t.fam === 4 ? dev.rt.arp : dev.rt.nd
        if (first && !cache.includes(key) && i === 0) { cache.push(key); marks += '.'; continue }
        if (first && !cache.includes(key)) cache.push(key)
        // remember neighbors for show arp on the far side too
        marks += '!'
        ok++
      } else {
        // only a failure on the way out sends an ICMP unreachable back to us; IOS rate-limits
        // those (one per 500 ms), which is why a blocked ping reads U.U.U
        const unreach = !r.back && (r.reason === 'unreachable' || r.reason === 'filtered') && r.out.dev !== devId
        marks += unreach && i % 2 === 0 ? 'U' : '.'
      }
    }
    lines.push(marks)
    const pct = Math.round((ok / n) * 100)
    lines.push(`Success rate is ${pct} percent (${ok}/${n})${ok ? ', round-trip min/avg/max = 1/1/2 ms' : ''}`)
    this.markDirty()
    return lines.join('\n')
  }

  // Address a router uses for an ICMP error about a packet it could not forward: its ingress interface
  icmpSource(net, res, fam) {
    const iface = res.acl?.dir === 'in' ? res.acl.iface : res.hops.length ? res.hops[res.hops.length - 1].iface : null
    const list = usableAddrs(net, res.dev).filter((x) => x.fam === fam && !x.linkLocal)
    const a = list.find((x) => x.iface === iface) ?? list[0]
    return a ? a.addr : null
  }

  traceroute(devId, target, opts = {}) {
    const t = this.resolveTarget(target)
    if (!t) return `Translating "${target}"...domain server (255.255.255.255)\n% Unrecognized host or address, or protocol not running.`
    const net = this.getNet()
    const src = this.sourceAddr(devId, opts.source, t.fam)
    const fmt = (a) => (t.fam === 4 ? v4ToStr(a) : v6ToStr(a))
    const lines = ['Type escape sequence to abort.', `Tracing the route to ${fmt(t.addr)}`, 'VRF info: (vrf in name/id, vrf out name/id)']
    const r = forward(net, devId, { fam: t.fam, src, dst: t.addr, proto: 17, sport: 49152, dport: 33434 })
    r.hops.forEach((h, i) => {
      const last = i === r.hops.length - 1 && r.delivered
      lines.push(`  ${i + 1} ${fmt(last ? t.addr : h.addr)} ${1 + (i % 2)} msec ${i} msec ${1 + (i % 3)} msec`)
    })
    if (!r.delivered) {
      const base = r.hops.length
      if (r.reason === 'filtered' || (r.reason === 'unreachable' && r.dev !== devId)) {
        const a = this.icmpSource(net, r, t.fam)
        lines.push(`  ${base + 1} ${a !== null ? fmt(a) : '*'} ${r.reason === 'filtered' ? '!A  *  !A' : '!H  *  !H'}`)
      } else for (let i = 1; i <= 4; i++) lines.push(`  ${base + i}  *  *  *`)
    }
    return lines.join('\n')
  }

  // ---------- SSH / Telnet ----------
  remoteLogin(session, fromId, proto, ipStr, user) {
    const net = this.getNet()
    const ip = parseV4(ipStr)
    const port = proto === 'ssh' ? 22 : 23
    const trying = proto === 'telnet' ? `Trying ${ipStr} ... ` : ''
    const r = roundTrip(net, fromId, 4, ip, { proto: 'tcp', sport: 50000 + Math.floor(Math.random() * 1000), dport: port })
    if (!r.ok) return `${trying}\n% Connection timed out; remote host not responding`
    const target = this.dev(r.out.dev)
    if (!isIos(target)) return `${trying}\n% Connection refused by remote host`
    const vty = getSection(target, 'line vty 0 4')?.lines ?? []
    const transport = lineValue(vty, 'transport input') ?? 'ssh telnet'
    const allowed = transport.split(' ')
    if (!(allowed.includes(proto) || allowed.includes('all'))) return `${trying}\n% Connection refused by remote host`
    const ac = vty.find((l) => l.startsWith('access-class') && l.endsWith(' in'))
    if (ac) {
      const name = ac.split(' ')[1]
      const srcAddr = r.out.pkt.src
      if (!evalAcl(target, name, { fam: 4, src: srcAddr, dst: ip, proto: 6, dport: port }).permit) return `${trying}\n% Connection refused by remote host`
    }
    if (proto === 'ssh' && !(target.rt.rsaBits >= 768)) return '% Connection refused by remote host'
    const loginLocal = hasLine(vty, 'login local')
    const linePw = target.secrets.lines['line vty 0 4']
    const open = (asUser) => {
      const priv = asUser && new RegExp(`^username ${asUser} privilege 15 `).test(target.config.global.find((l) => l.startsWith(`username ${asUser} `)) ?? '')
      session.stack.push({ devId: target.id, mode: priv ? 'priv' : 'user', heads: null, remoteIp: ipStr })
      const motd = lineValue(target.config.global, 'banner motd')
      target.rt.logins = [...(target.rt.logins ?? []), { user: asUser ?? null, from: fromId, proto }]
      this.log(target.id, `%SEC_LOGIN-5-LOGIN_SUCCESS: Login Success [user: ${asUser ?? ''}] [Source: ${v4ToStr(r.out.pkt.src)}] [localport: ${port}]`)
      return motd ? `\n${/^\^C/.test(motd) ? motd.replace(/^\^C|\^C$/g, '') : motd.replace(/^(\S)([\s\S]*)\1$/, '$2')}\n` : ''
    }
    if (proto === 'ssh') {
      if (!loginLocal) return '% Authentication failed.\n[Connection to ' + ipStr + ' closed by foreign host]'
      let tries = 0
      const ask = () => this.askSession(session, 'Password: ', (pw) => {
        if (target.secrets.users[user] !== undefined && target.secrets.users[user] === pw) return open(user)
        tries++
        if (tries >= 3) return '% Authentication failed.\n[Connection to ' + ipStr + ' closed by foreign host]'
        return '% Authentication failed.\n' + ask()
      }, true)
      return ask()
    }
    // telnet
    if (loginLocal) {
      return trying + 'Open\n\n\nUser Access Verification\n\n' + this.askSession(session, 'Username: ', (u) => this.askSession(session, 'Password: ', (pw) => {
        if (target.secrets.users[u] !== undefined && target.secrets.users[u] === pw) return open(u)
        return '% Login invalid\n\n[Connection to ' + ipStr + ' closed by foreign host]'
      }, true))
    }
    const noLogin = vty.includes('no login')
    if (noLogin) return trying + 'Open\n' + open()
    if (!linePw) return `${trying}Open\n\n\nPassword required, but none set\n\n[Connection to ${ipStr} closed by foreign host]`
    return trying + 'Open\n\n\nUser Access Verification\n\n' + this.askSession(session, 'Password: ', (pw) => (pw === linePw ? open() : '% Bad passwords\n\n[Connection to ' + ipStr + ' closed by foreign host]'), true)
  }

  askSession(session, p, onAnswer, mask) {
    session.pending = { prompt: p, onAnswer, mask }
    return ''
  }

  reload(devId) {
    const dev = this.dev(devId)
    const fresh = createDevice(this.def.devices.find((d) => d.id === devId))
    dev.config = dev.startup ? JSON.parse(JSON.stringify(dev.startup)) : fresh.config
    dev.rt = { ...fresh.rt, log: [], rsaBits: dev.startup ? dev.startupRsa ?? 0 : 0 }
    if (!dev.startup) dev.secrets = fresh.secrets
    this.sessions[devId] = createSession(this, devId)
    this.markDirty()
    return '\n%SYS-5-RELOAD: Reload requested by console. Reload Reason: Reload Command.\n\nInitializing Hardware ...\n\nSystem integrity status: 0x610\nBooting...\n\n              Restricted Rights Legend\n\nPress RETURN to get started!\n'
  }

  // ---------- PCs ----------
  renew(devId, silent) {
    const dev = this.dev(devId)
    const net = this.getNet()
    const r = dhcpRequest(net, devId, dev.ports[0])
    for (const l of r.log ?? []) this.log(l.dev, l.msg)
    if (r.lease) {
      dev.host.lease = r.lease
      dev.host.dhcp = true
      this.markDirty()
      return silent ? '' : null
    }
    return 'An error occurred while renewing interface Ethernet0 : unable to contact your DHCP server. Request has timed out.'
  }

  runPc(devId, raw) {
    const dev = this.dev(devId)
    const h = dev.host
    const line = raw.trim()
    if (!line) return ''
    const args = line.split(/\s+/)
    const cmd = args[0].toLowerCase()
    const net = this.getNet()
    const ip = h.dhcp ? h.lease?.ip : h.ip
    const mask = h.dhcp ? h.lease?.mask : h.mask
    const gw = h.dhcp ? h.lease?.gw : h.gw
    const s = this.sessions[devId]
    s.history.push(line)
    this.recordCmd(devId, line, { mode: 'pc' })
    const v6 = (net.addrs[devId] ?? []).filter((a) => a.fam === 6)
    if (cmd === 'ipconfig') {
      const sub = (args[1] ?? '').toLowerCase()
      if (sub === '/renew') {
        const err = this.renew(devId)
        if (err) return err
      }
      if (sub === '/release') { if (h.lease) { h.lease = null; this.markDirty() } return '\nWindows IP Configuration\n\nEthernet adapter Ethernet0:\n\n   Connection-specific DNS Suffix  . :\n   IPv4 Address. . . . . . . . . . . : 0.0.0.0' }
      const cur = h.dhcp ? h.lease : { ip: h.ip, mask: h.mask, gw: h.gw, dns: h.dns }
      const out = ['', 'Windows IP Configuration', '', '', 'Ethernet adapter Ethernet0:', '', '   Connection-specific DNS Suffix  . :']
      if (sub === '/all') {
        out.push(`   Description . . . . . . . . . . . : Intel(R) Ethernet Connection`, `   Physical Address. . . . . . . . . : ${macToStr(macBig(dev)).replace(/\./g, '').toUpperCase().replace(/(..)(?!$)/g, '$1-')}`, `   DHCP Enabled. . . . . . . . . . . : ${h.dhcp ? 'Yes' : 'No'}`)
      }
      for (const a of v6) out.push(`   ${a.linkLocal ? 'Link-local IPv6 Address' : 'IPv6 Address. . . . . .'} . . . . . : ${v6ToStr(a.addr).toLowerCase()}${a.linkLocal ? '%12' : ''}`)
      out.push(`   IPv4 Address. . . . . . . . . . . : ${cur?.ip ?? (h.dhcp ? '169.254.12.34' : '0.0.0.0')}`)
      out.push(`   Subnet Mask . . . . . . . . . . . : ${cur?.mask ?? (h.dhcp ? '255.255.0.0' : '0.0.0.0')}`)
      const gw6 = net.routes[devId][6].find((r) => r.len === 0)
      out.push(`   Default Gateway . . . . . . . . . : ${gw6 ? v6ToStr(gw6.hops[0].ip).toLowerCase() + '%12\n                                       ' : ''}${cur?.gw ?? ''}`)
      if (sub === '/all') {
        if (h.dhcp && h.lease) out.push(`   DHCP Server . . . . . . . . . . . : ${h.lease.server ? (usableAddrs(net, h.lease.server).find((a) => a.fam === 4) ? v4ToStr(usableAddrs(net, h.lease.server).find((a) => a.fam === 4).addr) : '') : ''}`)
        out.push(`   DNS Servers . . . . . . . . . . . : ${cur?.dns ?? ''}`)
      }
      if (sub === '/renew') this.getNet()
      return out.join('\n')
    }
    // Windows options: skip "-n 2", "-l 64", "-w 1000", "-i 5", "-h 30" values and plain flags like -d, -4, -6, -t
    const target = args.find((a, i) => i > 0 && !a.startsWith('-') && !/^-[nlwih]$/i.test(args[i - 1]))
    if (cmd === 'ping') {
      const t = target && this.resolveTarget(target)
      if (!t) return `Ping request could not find host ${target ?? ''}. Please check the name and try again.`
      const ni = args.findIndex((a) => a.toLowerCase() === '-n')
      const n = ni > 0 && /^\d+$/.test(args[ni + 1] ?? '') ? Math.min(Math.max(Number(args[ni + 1]), 1), 20) : 4
      const fmt = (a) => (t.fam === 4 ? v4ToStr(a) : v6ToStr(a).toLowerCase())
      const out = ['', `Pinging ${fmt(t.addr)} with 32 bytes of data:`]
      let ok = 0
      for (let i = 0; i < n; i++) {
        const r = roundTrip(net, devId, t.fam, t.addr, { flow: i, id: i + 1 })
        if (r.ok) { ok++; out.push(t.fam === 6 ? `Reply from ${fmt(t.addr)}: time<1ms` : `Reply from ${fmt(t.addr)}: bytes=32 time<1ms TTL=${(isIos(this.dev(r.out.dev)) ? 255 : 128) - (r.back.hops.length - 1)}`) }
        // no usable source/route at all (no address or no default gateway): Windows can't even send
        else if (r.reason === 'no-route-local' || r.reason === 'no-source') out.push('PING: transmit failed. General failure.')
        else if (r.reason === 'arp-fail-local') out.push(t.fam === 4 ? `Reply from ${ip ?? '0.0.0.0'}: Destination host unreachable.` : 'Destination host unreachable.')
        else if (!r.back && (r.reason === 'filtered' || (r.reason === 'unreachable' && r.out?.dev !== devId))) {
          // the router that gave up answers from the interface the packet arrived on
          const a = this.icmpSource(net, r.out, t.fam)
          out.push(`Reply from ${a !== null ? fmt(a) : '?'}: Destination ${r.reason === 'filtered' ? 'net unreachable' : 'host unreachable'}.`)
        } else out.push('Request timed out.')
      }
      out.push('', `Ping statistics for ${fmt(t.addr)}:`, `    Packets: Sent = ${n}, Received = ${ok}, Lost = ${n - ok} (${Math.round(((n - ok) / n) * 100)}% loss),`)
      if (ok) out.push('Approximate round trip times in milli-seconds:', '    Minimum = 0ms, Maximum = 1ms, Average = 0ms')
      this.markDirty()
      return out.join('\n')
    }
    if (cmd === 'tracert') {
      const t = target && this.resolveTarget(target)
      if (!t) return `Unable to resolve target system name ${target ?? ''}.`
      const r = forward(net, devId, { fam: t.fam, dst: t.addr, proto: 1, icmpType: 'echo' })
      const fmt = (a) => (t.fam === 4 ? v4ToStr(a) : v6ToStr(a).toLowerCase())
      const out = ['', `Tracing route to ${fmt(t.addr)} over a maximum of 30 hops`, '']
      r.hops.forEach((hp, i) => out.push(`  ${i + 1}    <1 ms    <1 ms    <1 ms  ${fmt(i === r.hops.length - 1 && r.delivered ? t.addr : hp.addr)}`))
      if (!r.delivered) for (let i = 1; i <= 3; i++) out.push(`  ${r.hops.length + i}     *        *        *     Request timed out.`)
      out.push('', 'Trace complete.')
      return out.join('\n')
    }
    if (cmd === 'ssh' || cmd === 'telnet') {
      let user = null
      let host = null
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '-l') { user = args[++i]; continue }
        if (args[i].includes('@')) { [user, host] = args[i].split('@'); continue }
        host = args[i]
      }
      if (!host || parseV4(host) === null) return `Usage: ${cmd === 'ssh' ? 'ssh -l <user> <ip address>' : 'telnet <ip address>'}`
      if (cmd === 'ssh' && !user) return 'Usage: ssh -l <user> <ip address>'
      return this.remoteLogin(s, devId, cmd, host, user)
    }
    if (cmd === 'curl') {
      const m = /^(?:(https?):\/\/)?([\d.]+)(?::(\d+))?/.exec(args[1] ?? '')
      if (!m) return 'curl: (3) URL using bad/illegal format or missing URL'
      const port = m[3] ? Number(m[3]) : m[1] === 'https' ? 443 : 80
      const dst = parseV4(m[2])
      const r = roundTrip(net, devId, 4, dst, { proto: 'tcp', sport: 49200 + Math.floor(Math.random() * 500), dport: port })
      this.markDirty()
      if (r.ok) return `<!DOCTYPE html><html><body><h1>It works!</h1><p>Served from ${m[2]} on port ${port}</p></body></html>`
      if (r.reason === 'refused') return `curl: (7) Failed to connect to ${m[2]} port ${port}: Connection refused`
      return `curl: (28) Failed to connect to ${m[2]} port ${port} after 21036 ms: Timed out`
    }
    if (cmd === 'arp' && args[1] === '-a') {
      const out = ['', `Interface: ${ip ?? '0.0.0.0'} --- 0xc`, '  Internet Address      Physical Address      Type']
      if (gw) out.push(`  ${gw.padEnd(22)}${'(learned)'.padEnd(22)}dynamic`)
      return out.join('\n')
    }
    if (cmd === 'hostname') return dev.id
    if (cmd === 'help' || cmd === '?') return PC_HELP
    if (cmd === 'cls' || cmd === 'clear') { this.transcripts[devId] = []; return '' }
    return `'${args[0]}' is not recognized as an internal or external command,\noperable program or batch file.`
  }

  // ---------- tasks ----------
  // Silent reachability check that leaves NAT tables and ACL counters untouched
  reach(src, dst, opts = {}) {
    const net = this.getNet()
    const save = this.devices.map((d) => [d, JSON.stringify(d.rt.nat ?? []), JSON.stringify(d.rt.leases ?? [])])
    const hits = JSON.stringify(this.rt.aclHits ?? {})
    const events = net.events.length
    const t = this.resolveTarget(dst)
    const r = t ? roundTrip(net, src, t.fam, t.addr, opts) : { ok: false }
    for (const [d, nat, leases] of save) { d.rt.nat = JSON.parse(nat); d.rt.leases = JSON.parse(leases) }
    this.rt.aclHits = JSON.parse(hits)
    net.events.length = events
    return r.ok
  }

  ran(devId, prefixOrRe) {
    const log = this.cmdLog[devId] ?? []
    return log.some((c) => (prefixOrRe instanceof RegExp ? prefixOrRe.test(c.line) : c.line.startsWith(prefixOrRe)))
  }

  api() {
    const self = this
    const net = this.getNet()
    return {
      net,
      dev: (id) => self.dev(id),
      global: (id) => self.dev(id).config.global,
      iface: (id, name) => ifaceLines(self.dev(id), name),
      section: (id, head) => getSection(self.dev(id), head)?.lines ?? null,
      has: (lines, prefix) => !!lines && hasLine(lines, prefix),
      value: (lines, prefix) => (lines ? lineValue(lines, prefix) : undefined),
      up: (id, name) => net.ifState[id]?.[name]?.protocol === 'up',
      reach: (a, b, o) => self.reach(a, b, o),
      ran: (id, p) => self.ran(id, p),
      route: (id, prefix, code) => (net.routes[id]?.[prefix.includes(':') ? 6 : 4] ?? []).some((r) => `${r.net === undefined ? '' : (prefix.includes(':') ? v6ToStr(r.net) : v4ToStr(r.net))}/${r.len}` === prefix && (!code || r.code === code)),
      routeVia: (id, prefix) => {
        const r = (net.routes[id]?.[4] ?? []).find((x) => `${v4ToStr(x.net)}/${x.len}` === prefix)
        return r ? r.hops.map((h) => (h.ip !== undefined ? v4ToStr(h.ip) : h.iface)) : []
      },
      ospfFull: (id) => (net.ospf.neighbors[id] ?? []).filter((n) => n.state === 'FULL').length,
      ospfIface: (id, name) => (net.ospf.ifaces[id] ?? []).find((i) => i.iface === name),
      stp: (vlan) => net.stp[vlan],
      channel: (id, po) => net.channels.find((g) => g.dev === id && g.po === po),
      hsrp: (id, iface) => net.hsrp[`${id}|${iface}`] ?? [],
      sw: (id, port) => net.sw[id]?.[port],
      host: (id) => self.dev(id).host,
      rt: (id) => self.dev(id).rt,
      addr: (id, name) => {
        const a = (net.addrs[id] ?? []).find((x) => x.iface === name && x.fam === 4 && x.primary)
        return a ? v4ToStr(a.addr) : null
      },
    }
  }

  checkTasks() {
    const api = this.api()
    const res = {}
    for (const t of this.def.tasks) {
      let ok = false
      try { ok = !!t.check(api) } catch (e) { ok = false }
      res[t.id] = ok
    }
    return res
  }

  serialize() {
    return JSON.stringify({ version: 2, devices: this.devices, rt: this.rt, transcripts: Object.fromEntries(Object.entries(this.transcripts).map(([k, v]) => [k, v.slice(-300)])), cmdLog: this.cmdLog, manual: this.manual })
  }
}

const PC_HELP = `Commands available on this PC:
  ipconfig [/all | /renew | /release]   show or renew IP settings
  ping <address>                        test reachability (IPv4 or IPv6)
  tracert <address>                     list the routers on the path
  ssh -l <user> <address>               open an SSH session to a device
  telnet <address>                      open a Telnet session to a device
  curl http://<address> | https://<address>   test a web connection
  arp -a                                show the ARP cache
  cls                                   clear the screen`

export { lenToMask, ifaceMac }
