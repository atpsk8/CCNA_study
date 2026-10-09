// Browser labs. Every lab runs in the built-in simulator, so there's nothing to install.
// Each task's check() receives an API from the engine (see src/sim/engine.js -> api()).
// Device positions (x, y) are on a 100 x 60 grid for the topology drawing.

const G = (n) => `GigabitEthernet${n}`
const R_PORTS4 = [G('0/0/0'), G('0/0/1'), G('0/0/2'), G('0/1/0')]

export const LABS = [
  // ------------------------------------------------------------------
  {
    id: 'switch-ssh',
    title: 'Secure a Switch and Enable SSH',
    level: 'Beginner',
    minutes: 20,
    chapters: ['v1-04', 'v1-06'],
    scenario: 'A new access switch is cabled to your network but still has a factory config. Lock it down and make it manageable over SSH only.',
    devices: [
      { id: 'SW1', kind: 'switch', hostname: 'Switch', x: 50, y: 30 },
      { id: 'R1', kind: 'router', hostname: 'R1', x: 50, y: 8, config: `
interface g0/0/1
 ip address 192.168.1.1 255.255.255.0
 no shutdown` },
      { id: 'PC1', kind: 'pc', x: 20, y: 52, host: { ip: '192.168.1.50', mask: '255.255.255.0', gw: '192.168.1.1' } },
    ],
    links: [['SW1', G('1/0/24'), 'R1', G('0/0/1')], ['SW1', G('1/0/1'), 'PC1', 'Ethernet0']],
    start: 'SW1',
    tasks: [
      { id: 't1', text: 'Name the switch SW1.', hint: 'hostname SW1', check: (a) => a.has(a.global('SW1'), 'hostname SW1') },
      { id: 't2', text: 'Protect privileged mode with a hashed enable secret (not "enable password").', hint: 'enable secret <password>', check: (a) => a.has(a.global('SW1'), 'enable secret') },
      { id: 't3', text: 'Create a local user named admin with a secret.', hint: 'username admin secret <password>', check: (a) => a.global('SW1').some((l) => /^username admin .*secret/.test(l)) },
      { id: 't4', text: 'Give interface VLAN 1 the address 192.168.1.2/24 and bring it up.', hint: 'interface vlan 1 → ip address … → no shutdown', check: (a) => a.addr('SW1', 'Vlan1') === '192.168.1.2' && a.up('SW1', 'Vlan1') },
      { id: 't5', text: 'Point the switch at its default gateway, 192.168.1.1.', hint: 'ip default-gateway 192.168.1.1 (global config)', check: (a) => a.value(a.global('SW1'), 'ip default-gateway') === '192.168.1.1' },
      { id: 't6', text: 'Generate RSA keys of at least 1024 bits and force SSH version 2.', hint: 'SSH keys need a domain name first: ip domain name lab.local, then crypto key generate rsa', check: (a) => a.rt('SW1').rsaBits >= 1024 && a.value(a.global('SW1'), 'ip ssh version') === '2' },
      { id: 't7', text: 'Allow only SSH on every VTY line (0–15), authenticated with local usernames.', hint: 'line vty 0 15 → login local → transport input ssh', check: (a) => ['line vty 0 4', 'line vty 5 15'].every((h) => a.has(a.section('SW1', h), 'login local') && a.value(a.section('SW1', h), 'transport input') === 'ssh') },
      { id: 't8', text: 'From PC1, SSH to the switch as admin.', hint: 'On PC1: ssh -l admin 192.168.1.2', check: (a) => (a.rt('SW1').logins ?? []).some((l) => l.from === 'PC1' && l.proto === 'ssh') },
      { id: 't9', text: 'Save the configuration so it survives a reload.', hint: 'copy running-config startup-config', check: (a) => !!a.dev('SW1').startup && JSON.stringify(a.dev('SW1').startup) === JSON.stringify(a.dev('SW1').config) },
    ],
    solution: {
      SW1: `enable
configure terminal
hostname SW1
enable secret Str0ngEnable!
username admin secret Str0ngUser!
ip domain name lab.local
crypto key generate rsa modulus 2048
ip ssh version 2
interface vlan 1
 ip address 192.168.1.2 255.255.255.0
 no shutdown
exit
ip default-gateway 192.168.1.1
line vty 0 15
 login local
 transport input ssh
end
copy running-config startup-config`,
      PC1: 'ssh -l admin 192.168.1.2',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'vlans-trunk',
    title: 'VLANs and an 802.1Q Trunk',
    level: 'Beginner',
    minutes: 20,
    chapters: ['v1-08'],
    scenario: 'Sales (VLAN 10) and Engineering (VLAN 20) users sit on both floors. Build the VLANs and a trunk so each department reaches its own people across the two switches.',
    devices: [
      { id: 'SW1', kind: 'switch', hostname: 'SW1', x: 30, y: 25 },
      { id: 'SW2', kind: 'switch', hostname: 'SW2', x: 70, y: 25 },
      { id: 'PC1', kind: 'pc', x: 15, y: 52, host: { ip: '192.168.10.11', mask: '255.255.255.0', gw: '192.168.10.1' } },
      { id: 'PC3', kind: 'pc', x: 40, y: 52, host: { ip: '192.168.20.11', mask: '255.255.255.0', gw: '192.168.20.1' } },
      { id: 'PC2', kind: 'pc', x: 60, y: 52, host: { ip: '192.168.10.12', mask: '255.255.255.0', gw: '192.168.10.1' } },
      { id: 'PC4', kind: 'pc', x: 85, y: 52, host: { ip: '192.168.20.12', mask: '255.255.255.0', gw: '192.168.20.1' } },
    ],
    links: [
      ['SW1', G('1/0/24'), 'SW2', G('1/0/24')],
      ['SW1', G('1/0/1'), 'PC1', 'Ethernet0'], ['SW1', G('1/0/2'), 'PC3', 'Ethernet0'],
      ['SW2', G('1/0/1'), 'PC2', 'Ethernet0'], ['SW2', G('1/0/2'), 'PC4', 'Ethernet0'],
    ],
    start: 'SW1',
    tasks: [
      { id: 't1', text: 'On both switches create VLAN 10 named SALES and VLAN 20 named ENG.', hint: 'vlan 10 → name SALES', check: (a) => ['SW1', 'SW2'].every((d) => a.value(a.section(d, 'vlan 10'), 'name') === 'SALES' && a.value(a.section(d, 'vlan 20'), 'name') === 'ENG') },
      { id: 't2', text: 'Make Gi1/0/1 an access port in VLAN 10 and Gi1/0/2 an access port in VLAN 20, on both switches.', hint: 'switchport mode access → switchport access vlan 10', check: (a) => ['SW1', 'SW2'].every((d) => a.value(a.iface(d, G('1/0/1')), 'switchport mode') === 'access' && a.value(a.iface(d, G('1/0/1')), 'switchport access vlan') === '10' && a.value(a.iface(d, G('1/0/2')), 'switchport mode') === 'access' && a.value(a.iface(d, G('1/0/2')), 'switchport access vlan') === '20') },
      { id: 't3', text: 'Hard-code Gi1/0/24 as a trunk on both switches and turn off DTP negotiation.', hint: 'switchport mode trunk, then switchport nonegotiate', check: (a) => ['SW1', 'SW2'].every((d) => a.sw(d, G('1/0/24'))?.oper === 'trunk' && a.has(a.iface(d, G('1/0/24')), 'switchport nonegotiate')) },
      { id: 't4', text: 'Create VLAN 99 (NATIVE) and use it as the native VLAN on the trunk at both ends.', hint: 'switchport trunk native vlan 99', check: (a) => ['SW1', 'SW2'].every((d) => a.value(a.iface(d, G('1/0/24')), 'switchport trunk native vlan') === '99' && a.section(d, 'vlan 99')) },
      { id: 't5', text: 'Allow only VLANs 10, 20 and 99 on the trunk.', hint: 'switchport trunk allowed vlan 10,20,99', check: (a) => ['SW1', 'SW2'].every((d) => a.value(a.iface(d, G('1/0/24')), 'switchport trunk allowed vlan') === '10,20,99') },
      { id: 't6', text: 'Prove it: PC1 pings PC2 and PC3 pings PC4.', hint: 'On PC1: ping 192.168.10.12', check: (a) => a.reach('PC1', '192.168.10.12') && a.reach('PC3', '192.168.20.12') && ['SW1', 'SW2'].every((d) => a.sw(d, G('1/0/24'))?.oper === 'trunk' && a.sw(d, G('1/0/1'))?.accessVlan === 10) },
      { id: 't7', text: 'Check your work with show interfaces trunk and show vlan brief.', check: (a) => a.ran('SW1', 'show interfaces trunk') || a.ran('SW2', 'show interfaces trunk') },
    ],
    solution: {
      SW1: `enable
configure terminal
vlan 10
 name SALES
vlan 20
 name ENG
vlan 99
 name NATIVE
interface g1/0/1
 switchport mode access
 switchport access vlan 10
interface g1/0/2
 switchport mode access
 switchport access vlan 20
interface g1/0/24
 switchport mode trunk
 switchport nonegotiate
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20,99
end
show interfaces trunk`,
      SW2: '(same as SW1)',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'rpvst',
    title: 'Rapid PVST+ Root Election and Edge Protection',
    level: 'Intermediate',
    minutes: 25,
    chapters: ['v1-09', 'v1-10'],
    scenario: 'Three switches in a triangle. Right now the oldest switch (lowest MAC) has won the root election by accident. Move the root where you want it and protect the host ports.',
    devices: [
      { id: 'SW1', kind: 'switch', hostname: 'SW1', mac: '00c0ffee1000', x: 50, y: 8, config: 'spanning-tree mode pvst\nvlan 10\ninterface range g1/0/23 - 24\n switchport mode trunk' },
      { id: 'SW2', kind: 'switch', hostname: 'SW2', mac: '00c0ffee2000', x: 22, y: 34, config: 'spanning-tree mode pvst\nvlan 10\ninterface range g1/0/23 - 24\n switchport mode trunk\ninterface g1/0/1\n switchport mode access\n switchport access vlan 10' },
      { id: 'SW3', kind: 'switch', hostname: 'SW3', mac: '00005e000300', x: 78, y: 34, config: 'spanning-tree mode pvst\nvlan 10\ninterface range g1/0/23 - 24\n switchport mode trunk\ninterface g1/0/1\n switchport mode access\n switchport access vlan 10' },
      { id: 'PC1', kind: 'pc', x: 22, y: 55, host: { ip: '10.10.10.21', mask: '255.255.255.0' } },
      { id: 'PC2', kind: 'pc', x: 78, y: 55, host: { ip: '10.10.10.31', mask: '255.255.255.0' } },
    ],
    links: [
      ['SW1', G('1/0/23'), 'SW2', G('1/0/23')], ['SW1', G('1/0/24'), 'SW3', G('1/0/24')], ['SW2', G('1/0/24'), 'SW3', G('1/0/23')],
      ['SW2', G('1/0/1'), 'PC1', 'Ethernet0'], ['SW3', G('1/0/1'), 'PC2', 'Ethernet0'],
    ],
    start: 'SW3',
    tasks: [
      { id: 't1', text: 'Find the current root bridge for VLAN 10 (show spanning-tree vlan 10).', check: (a) => ['SW1', 'SW2', 'SW3'].some((d) => a.ran(d, 'show spanning-tree')) },
      { id: 't2', text: 'Switch all three switches to Rapid PVST+.', hint: 'spanning-tree mode rapid-pvst', check: (a) => ['SW1', 'SW2', 'SW3'].every((d) => a.value(a.global(d), 'spanning-tree mode') === 'rapid-pvst') },
      { id: 't3', text: 'Make SW1 the root for VLAN 10 using the root primary macro.', hint: 'spanning-tree vlan 10 root primary', check: (a) => a.stp(10)?.root === 'SW1' },
      { id: 't4', text: 'Make SW2 the backup root (priority 28672).', hint: 'spanning-tree vlan 10 root secondary', check: (a) => a.stp(10)?.bridges.SW2?.prio === 28672 },
      { id: 't5', text: 'With SW1 as root, the SW2–SW3 link must block somewhere. Confirm which port is Alternate (BLK) on SW3.', check: (a) => a.stp(10)?.root === 'SW1' && a.ran('SW3', 'show spanning-tree') && Object.values(a.stp(10).bridges.SW3?.ports ?? {}).some((p) => p.role === 'Altn') },
      { id: 't6', text: 'Enable PortFast and BPDU Guard on the PC ports (Gi1/0/1 on SW2 and SW3).', hint: 'spanning-tree portfast + spanning-tree bpduguard enable', check: (a) => ['SW2', 'SW3'].every((d) => {
        // per-port commands, or the global "portfast default" + "portfast bpduguard default" pair
        const L = a.iface(d, G('1/0/1'))
        const fast = L.includes('spanning-tree portfast') || (a.has(a.global(d), 'spanning-tree portfast default') && a.value(L, 'switchport mode') === 'access' && !L.includes('spanning-tree portfast disable'))
        return fast && (L.includes('spanning-tree bpduguard enable') || a.has(a.global(d), 'spanning-tree portfast bpduguard default'))
      }) },
      { id: 't7', text: 'PC1 can still ping PC2 with the new topology.', check: (a) => a.reach('PC1', '10.10.10.31') && a.stp(10)?.root === 'SW1' && a.ran('PC1', /^ping/) },
    ],
    tryIt: 'Put BPDU Guard on SW2 Gi1/0/23 (a switch link) and watch it go err-disabled. Recover it with shutdown then no shutdown after removing BPDU Guard.',
    solution: {
      'All switches': 'configure terminal\nspanning-tree mode rapid-pvst',
      SW1: 'spanning-tree vlan 10 root primary',
      SW2: 'spanning-tree vlan 10 root secondary\ninterface g1/0/1\n spanning-tree portfast\n spanning-tree bpduguard enable',
      SW3: 'interface g1/0/1\n spanning-tree portfast\n spanning-tree bpduguard enable\nend\nshow spanning-tree vlan 10',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'lacp',
    title: 'LACP EtherChannel Between Two Switches',
    level: 'Intermediate',
    minutes: 15,
    chapters: ['v1-10'],
    scenario: 'Two uplinks connect SW1 and SW2, but spanning tree is blocking one of them. Bundle them so both links carry traffic.',
    devices: [
      { id: 'SW1', kind: 'switch', hostname: 'SW1', x: 30, y: 25 },
      { id: 'SW2', kind: 'switch', hostname: 'SW2', x: 70, y: 25 },
      { id: 'PC1', kind: 'pc', x: 30, y: 52, host: { ip: '10.1.1.11', mask: '255.255.255.0' } },
      { id: 'PC2', kind: 'pc', x: 70, y: 52, host: { ip: '10.1.1.12', mask: '255.255.255.0' } },
    ],
    links: [['SW1', G('1/0/23'), 'SW2', G('1/0/23')], ['SW1', G('1/0/24'), 'SW2', G('1/0/24')], ['SW1', G('1/0/1'), 'PC1', 'Ethernet0'], ['SW2', G('1/0/1'), 'PC2', 'Ethernet0']],
    start: 'SW1',
    tasks: [
      { id: 't1', text: 'See the blocked uplink before you start (show spanning-tree on either switch).', check: (a) => a.ran('SW1', 'show spanning-tree') || a.ran('SW2', 'show spanning-tree') },
      { id: 't2', text: 'Put Gi1/0/23–24 on both switches into channel-group 1 using LACP (at least one side active).', hint: 'interface range g1/0/23 - 24 → channel-group 1 mode active', check: (a) => { const g = a.channel('SW1', 'Port-channel1'); return g?.up && g.protocol === 'LACP' && Object.values(g.flags).filter((f) => f === 'P').length === 2 } },
      { id: 't3', text: 'Make Port-channel1 an 802.1Q trunk on both switches.', hint: 'interface port-channel 1 → switchport mode trunk (do the same on the member ports)', check: (a) => a.sw('SW1', 'Port-channel1')?.oper === 'trunk' && a.sw('SW2', 'Port-channel1')?.oper === 'trunk' },
      { id: 't4', text: 'Confirm both members show (P) in show etherchannel summary.', check: (a) => a.ran('SW1', 'show etherchannel summary') || a.ran('SW2', 'show etherchannel summary') },
      { id: 't5', text: 'PC1 can ping PC2 across the bundle.', check: (a) => a.reach('PC1', '10.1.1.12') && a.channel('SW1', 'Port-channel1')?.up },
    ],
    tryIt: 'Set both sides to passive. The ports fall back to stand-alone (I). Then set one side to "on" and see the mismatch suspend the members.',
    solution: {
      SW1: 'configure terminal\ninterface range g1/0/23 - 24\n switchport mode trunk\n channel-group 1 mode active\ninterface port-channel 1\n switchport mode trunk\nend\nshow etherchannel summary',
      SW2: 'configure terminal\ninterface range g1/0/23 - 24\n switchport mode trunk\n channel-group 1 mode passive\ninterface port-channel 1\n switchport mode trunk',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'static-routes',
    title: 'Static, Default, Host and Floating Static Routes',
    level: 'Beginner',
    minutes: 25,
    chapters: ['v1-17', 'v1-20'],
    scenario: 'R1 connects your LAN to two branch paths and the internet. Only R1 is missing routes. Give it a primary path, a backup that only appears when the primary fails, and a default route.',
    devices: [
      { id: 'R1', kind: 'router', hostname: 'R1', model: 'ISR4331', ports: R_PORTS4, x: 30, y: 28, config: `
interface g0/0/0
 ip address 10.0.12.1 255.255.255.252
 no shutdown
interface g0/0/1
 ip address 10.0.13.1 255.255.255.248
 no shutdown
interface g0/0/2
 ip address 192.168.1.1 255.255.255.0
 no shutdown
interface g0/1/0
 ip address 203.0.113.2 255.255.255.252
 no shutdown` },
      { id: 'R2', kind: 'router', hostname: 'R2', x: 70, y: 10, config: `
interface g0/0/0
 ip address 10.0.12.2 255.255.255.252
 no shutdown
interface g0/0/1
 ip address 10.0.23.2 255.255.255.248
 no shutdown
interface g0/0/2
 ip address 192.168.2.1 255.255.255.0
 no shutdown
ip route 0.0.0.0 0.0.0.0 10.0.12.1
ip route 0.0.0.0 0.0.0.0 10.0.23.3 130` },
      { id: 'R3', kind: 'router', hostname: 'R3', x: 70, y: 46, config: `
interface g0/0/0
 ip address 10.0.13.3 255.255.255.248
 no shutdown
interface g0/0/1
 ip address 10.0.23.3 255.255.255.248
 no shutdown
ip route 192.168.1.0 255.255.255.0 10.0.13.1
ip route 192.168.2.0 255.255.255.0 10.0.23.2
ip route 0.0.0.0 0.0.0.0 10.0.13.1` },
      { id: 'ISP', kind: 'router', hostname: 'ISP', x: 8, y: 8, config: `
interface g0/0/0
 ip address 203.0.113.1 255.255.255.252
 no shutdown
interface loopback 0
 ip address 8.8.8.8 255.255.255.255
ip route 192.168.0.0 255.255.0.0 203.0.113.2` },
      { id: 'PC1', kind: 'pc', x: 12, y: 52, host: { ip: '192.168.1.10', mask: '255.255.255.0', gw: '192.168.1.1' } },
      { id: 'PC2', kind: 'pc', x: 94, y: 10, host: { ip: '192.168.2.10', mask: '255.255.255.0', gw: '192.168.2.1' } },
    ],
    links: [
      ['R1', G('0/0/0'), 'R2', G('0/0/0')], ['R1', G('0/0/1'), 'R3', G('0/0/0')], ['R3', G('0/0/1'), 'R2', G('0/0/1')],
      ['R1', G('0/1/0'), 'ISP', G('0/0/0')], ['R1', G('0/0/2'), 'PC1', 'Ethernet0'], ['R2', G('0/0/2'), 'PC2', 'Ethernet0'],
    ],
    start: 'R1',
    tasks: [
      { id: 't1', text: 'On R1, route 192.168.2.0/24 via R2 (10.0.12.2).', hint: 'ip route 192.168.2.0 255.255.255.0 10.0.12.2', check: (a) => a.global('R1').some((l) => /^ip route 192\.168\.2\.0 255\.255\.255\.0 (\S+ )?10\.0\.12\.2$/.test(l)) },
      { id: 't2', text: 'Add a floating static backup for the same network via R3 (10.0.13.3) with administrative distance 130.', hint: 'Add the AD at the end of the command', check: (a) => a.global('R1').some((l) => /^ip route 192\.168\.2\.0 255\.255\.255\.0 (\S+ )?10\.0\.13\.3 130$/.test(l)) },
      { id: 't3', text: 'Send everything else to the ISP with a default route (next hop 203.0.113.1).', check: (a) => a.route('R1', '0.0.0.0/0') && a.routeVia('R1', '0.0.0.0/0').includes('203.0.113.1') },
      { id: 't4', text: 'Add a host route for the server 192.168.2.10 via R2.', hint: 'Host routes use mask 255.255.255.255', check: (a) => a.route('R1', '192.168.2.10/32', 'S') },
      { id: 't5', text: 'PC1 can ping PC2 (192.168.2.10) and the internet (8.8.8.8).', check: (a) => a.reach('PC1', '192.168.2.10') && a.reach('PC1', '8.8.8.8') },
      { id: 't6', text: 'Check show ip route: the floating route should NOT be in the table yet.', check: (a) => a.ran('R1', 'show ip route') && a.routeVia('R1', '192.168.2.0/24').includes('10.0.12.2') },
      { id: 't7', text: 'Shut R1 Gi0/0/0 (toward R2). The floating route takes over and PC1 still reaches 192.168.2.0/24 through R3.', hint: 'Notice the /32 host route disappears too: its next hop is no longer reachable.', check: (a) => a.has(a.iface('R1', G('0/0/0')), 'shutdown') && a.routeVia('R1', '192.168.2.0/24').includes('10.0.13.3') && a.reach('PC1', '192.168.2.1') },
    ],
    solution: {
      R1: 'enable\nconfigure terminal\nip route 192.168.2.0 255.255.255.0 10.0.12.2\nip route 192.168.2.0 255.255.255.0 10.0.13.3 130\nip route 0.0.0.0 0.0.0.0 203.0.113.1\nip route 192.168.2.10 255.255.255.255 10.0.12.2\nend\nshow ip route\nconfigure terminal\ninterface g0/0/0\n shutdown\nend\nshow ip route static',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'router-on-stick',
    title: 'Inter-VLAN Routing: Router-on-a-Stick',
    level: 'Intermediate',
    minutes: 20,
    chapters: ['v1-18'],
    scenario: 'VLANs 10 and 20 are built on SW1, but hosts can only talk inside their own VLAN. Route between them with one router link.',
    devices: [
      { id: 'R1', kind: 'router', hostname: 'R1', x: 50, y: 8 },
      { id: 'SW1', kind: 'switch', hostname: 'SW1', x: 50, y: 30, config: 'vlan 10\n name USERS\nvlan 20\n name SERVERS\ninterface g1/0/1\n switchport mode access\n switchport access vlan 10\ninterface g1/0/2\n switchport mode access\n switchport access vlan 20' },
      { id: 'PC1', kind: 'pc', x: 25, y: 52, host: { ip: '192.168.10.10', mask: '255.255.255.0', gw: '192.168.10.1' } },
      { id: 'PC2', kind: 'pc', x: 75, y: 52, host: { ip: '192.168.20.10', mask: '255.255.255.0', gw: '192.168.20.1' } },
    ],
    links: [['R1', G('0/0/0'), 'SW1', G('1/0/24')], ['SW1', G('1/0/1'), 'PC1', 'Ethernet0'], ['SW1', G('1/0/2'), 'PC2', 'Ethernet0']],
    start: 'SW1',
    tasks: [
      { id: 't1', text: 'Make SW1 Gi1/0/24 (toward R1) a trunk.', check: (a) => a.value(a.iface('SW1', G('1/0/24')), 'switchport mode') === 'trunk' },
      { id: 't2', text: 'Bring up R1 Gi0/0/0 (router ports start shut down).', check: (a) => a.up('R1', G('0/0/0')) },
      { id: 't3', text: 'Create subinterface Gi0/0/0.10 for VLAN 10 with 192.168.10.1/24.', hint: 'interface g0/0/0.10 → encapsulation dot1Q 10 → ip address …', check: (a) => a.value(a.iface('R1', G('0/0/0.10')), 'encapsulation dot1Q') === '10' && a.addr('R1', G('0/0/0.10')) === '192.168.10.1' },
      { id: 't4', text: 'Create subinterface Gi0/0/0.20 for VLAN 20 with 192.168.20.1/24.', check: (a) => a.value(a.iface('R1', G('0/0/0.20')), 'encapsulation dot1Q') === '20' && a.addr('R1', G('0/0/0.20')) === '192.168.20.1' },
      { id: 't5', text: 'PC1 (VLAN 10) pings PC2 (VLAN 20).', check: (a) => a.reach('PC1', '192.168.20.10') },
      { id: 't6', text: 'Look at the two connected routes with show ip route connected.', check: (a) => a.ran('R1', 'show ip route') },
    ],
    solution: {
      SW1: 'enable\nconfigure terminal\ninterface g1/0/24\n switchport mode trunk',
      R1: 'enable\nconfigure terminal\ninterface g0/0/0\n no shutdown\ninterface g0/0/0.10\n encapsulation dot1Q 10\n ip address 192.168.10.1 255.255.255.0\ninterface g0/0/0.20\n encapsulation dot1Q 20\n ip address 192.168.20.1 255.255.255.0\nend\nshow ip route connected',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'svi-routing',
    title: 'Inter-VLAN Routing with a Layer 3 Switch',
    level: 'Intermediate',
    minutes: 15,
    chapters: ['v1-18'],
    scenario: 'Same goal as router-on-a-stick, but the routing happens inside a multilayer switch using SVIs, plus one routed port toward the WAN router.',
    devices: [
      { id: 'DSW1', kind: 'l3switch', hostname: 'DSW1', x: 50, y: 28, config: 'vlan 10\nvlan 20\ninterface g1/0/1\n switchport mode access\n switchport access vlan 10\ninterface g1/0/2\n switchport mode access\n switchport access vlan 20' },
      { id: 'R1', kind: 'router', hostname: 'R1', x: 50, y: 6, config: 'interface g0/0/0\n ip address 10.0.0.1 255.255.255.252\n no shutdown\ninterface loopback 0\n ip address 1.1.1.1 255.255.255.255\nip route 192.168.0.0 255.255.0.0 10.0.0.2' },
      { id: 'PC1', kind: 'pc', x: 25, y: 52, host: { ip: '192.168.10.10', mask: '255.255.255.0', gw: '192.168.10.1' } },
      { id: 'PC2', kind: 'pc', x: 75, y: 52, host: { ip: '192.168.20.10', mask: '255.255.255.0', gw: '192.168.20.1' } },
    ],
    links: [['DSW1', G('1/0/24'), 'R1', G('0/0/0')], ['DSW1', G('1/0/1'), 'PC1', 'Ethernet0'], ['DSW1', G('1/0/2'), 'PC2', 'Ethernet0']],
    start: 'DSW1',
    tasks: [
      { id: 't1', text: 'Turn on IPv4 routing on DSW1.', check: (a) => a.has(a.global('DSW1'), 'ip routing') },
      { id: 't2', text: 'Create SVIs: VLAN 10 = 192.168.10.1/24, VLAN 20 = 192.168.20.1/24.', check: (a) => a.addr('DSW1', 'Vlan10') === '192.168.10.1' && a.addr('DSW1', 'Vlan20') === '192.168.20.1' && a.up('DSW1', 'Vlan10') && a.up('DSW1', 'Vlan20') },
      { id: 't3', text: 'PC1 pings PC2.', check: (a) => a.reach('PC1', '192.168.20.10') },
      { id: 't4', text: 'Make Gi1/0/24 a routed port with 10.0.0.2/30.', hint: 'no switchport, then ip address', check: (a) => a.has(a.iface('DSW1', G('1/0/24')), 'no switchport') && a.addr('DSW1', G('1/0/24')) === '10.0.0.2' },
      { id: 't5', text: 'Add a default route on DSW1 toward R1 and ping R1\'s loopback (1.1.1.1) from PC1.', check: (a) => a.reach('PC1', '1.1.1.1') },
    ],
    solution: {
      DSW1: 'enable\nconfigure terminal\nip routing\ninterface vlan 10\n ip address 192.168.10.1 255.255.255.0\ninterface vlan 20\n ip address 192.168.20.1 255.255.255.0\ninterface g1/0/24\n no switchport\n ip address 10.0.0.2 255.255.255.252\nexit\nip route 0.0.0.0 0.0.0.0 10.0.0.1',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'dhcp-relay',
    title: 'DHCP Server and Relay',
    level: 'Beginner',
    minutes: 15,
    chapters: ['v1-19'],
    scenario: 'The DHCP server lives on R2, one hop away from the users. Build the pool, then relay the LAN\'s broadcasts so PC1 gets an address.',
    devices: [
      { id: 'R1', kind: 'router', hostname: 'R1', x: 40, y: 22, config: 'interface g0/0/0\n ip address 10.0.12.1 255.255.255.252\n no shutdown\ninterface g0/0/1\n ip address 192.168.10.1 255.255.255.0\n no shutdown' },
      { id: 'R2', kind: 'router', hostname: 'R2', x: 80, y: 22, config: 'interface g0/0/0\n ip address 10.0.12.2 255.255.255.252\n no shutdown\nip route 192.168.10.0 255.255.255.0 10.0.12.1' },
      { id: 'SW1', kind: 'switch', hostname: 'SW1', x: 20, y: 38 },
      { id: 'PC1', kind: 'pc', x: 20, y: 56, host: { dhcp: true } },
    ],
    links: [['R1', G('0/0/0'), 'R2', G('0/0/0')], ['R1', G('0/0/1'), 'SW1', G('1/0/24')], ['SW1', G('1/0/1'), 'PC1', 'Ethernet0']],
    start: 'R2',
    tasks: [
      { id: 't1', text: 'On R2, exclude 192.168.10.1–192.168.10.10 from leasing.', check: (a) => a.global('R2').some((l) => l === 'ip dhcp excluded-address 192.168.10.1 192.168.10.10') },
      { id: 't2', text: 'On R2, create pool LAN10 for 192.168.10.0/24 with default router 192.168.10.1 and DNS 8.8.8.8.', check: (a) => { const s = a.section('R2', 'ip dhcp pool LAN10'); return s && a.value(s, 'network') === '192.168.10.0 255.255.255.0' && a.value(s, 'default-router') === '192.168.10.1' && (a.value(s, 'dns-server') ?? '').split(' ').includes('8.8.8.8') } },
      { id: 't3', text: 'Try ipconfig /renew on PC1 now. It fails, because the DHCP Discover is a broadcast that R1 won\'t forward.', check: (a) => a.ran('PC1', /^ipconfig \/renew/i) },
      { id: 't4', text: 'On R1 Gi0/0/1, add a helper address pointing at R2 (10.0.12.2).', check: (a) => a.iface('R1', G('0/0/1')).includes('ip helper-address 10.0.12.2') },
      { id: 't5', text: 'Renew on PC1. It should get 192.168.10.11 with gateway 192.168.10.1.', check: (a) => a.host('PC1').lease?.ip === '192.168.10.11' && a.host('PC1').lease?.gw === '192.168.10.1' },
      { id: 't6', text: 'See the lease on R2 with show ip dhcp binding.', check: (a) => a.ran('R2', 'show ip dhcp binding') },
    ],
    solution: {
      R2: 'enable\nconfigure terminal\nip dhcp excluded-address 192.168.10.1 192.168.10.10\nip dhcp pool LAN10\n network 192.168.10.0 255.255.255.0\n default-router 192.168.10.1\n dns-server 8.8.8.8',
      R1: 'enable\nconfigure terminal\ninterface g0/0/1\n ip helper-address 10.0.12.2',
      PC1: 'ipconfig /renew\nipconfig /all',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'ospf-single',
    title: 'Single-Area OSPFv2',
    level: 'Intermediate',
    minutes: 25,
    chapters: ['v1-21', 'v1-22'],
    scenario: 'Three routers in a triangle, each with a user LAN. Addresses are done. Bring up OSPF area 0 so every LAN can reach every other.',
    devices: [
      { id: 'R1', kind: 'router', hostname: 'R1', x: 50, y: 8, config: 'interface g0/0/0\n ip address 10.0.12.1 255.255.255.252\n no shutdown\ninterface g0/0/1\n ip address 10.0.13.1 255.255.255.248\n no shutdown\ninterface g0/0/2\n ip address 192.168.1.1 255.255.255.0\n no shutdown' },
      { id: 'R2', kind: 'router', hostname: 'R2', x: 22, y: 40, config: 'interface g0/0/0\n ip address 10.0.12.2 255.255.255.252\n no shutdown\ninterface g0/0/1\n ip address 10.0.23.2 255.255.255.248\n no shutdown\ninterface g0/0/2\n ip address 192.168.2.1 255.255.255.0\n no shutdown' },
      { id: 'R3', kind: 'router', hostname: 'R3', x: 78, y: 40, config: 'interface g0/0/0\n ip address 10.0.13.3 255.255.255.248\n no shutdown\ninterface g0/0/1\n ip address 10.0.23.3 255.255.255.248\n no shutdown\ninterface g0/0/2\n ip address 192.168.3.1 255.255.255.0\n no shutdown' },
      { id: 'PC1', kind: 'pc', x: 82, y: 8, host: { ip: '192.168.1.10', mask: '255.255.255.0', gw: '192.168.1.1' } },
      { id: 'PC2', kind: 'pc', x: 8, y: 56, host: { ip: '192.168.2.10', mask: '255.255.255.0', gw: '192.168.2.1' } },
      { id: 'PC3', kind: 'pc', x: 92, y: 56, host: { ip: '192.168.3.10', mask: '255.255.255.0', gw: '192.168.3.1' } },
    ],
    links: [
      ['R1', G('0/0/0'), 'R2', G('0/0/0')], ['R1', G('0/0/1'), 'R3', G('0/0/0')], ['R2', G('0/0/1'), 'R3', G('0/0/1')],
      ['R1', G('0/0/2'), 'PC1', 'Ethernet0'], ['R2', G('0/0/2'), 'PC2', 'Ethernet0'], ['R3', G('0/0/2'), 'PC3', 'Ethernet0'],
    ],
    start: 'R1',
    tasks: [
      { id: 't1', text: 'Start OSPF process 1 on all three routers with router IDs 1.1.1.1, 2.2.2.2 and 3.3.3.3.', hint: 'router ospf 1 → router-id 1.1.1.1 (set it before neighbors form)', check: (a) => ['R1', 'R2', 'R3'].every((d, i) => a.rt(d).ospfRid === `${i + 1}.${i + 1}.${i + 1}.${i + 1}`) },
      { id: 't2', text: 'On R1, enable OSPF with network commands (area 0).', hint: 'network 10.0.0.0 0.255.255.255 area 0 covers both WAN links', check: (a) => (a.section('R1', 'router ospf 1') ?? []).some((l) => l.startsWith('network ')) && (a.net.ospf.ifaces.R1 ?? []).length >= 3 },
      { id: 't3', text: 'On R2, enable OSPF with interface commands instead (ip ospf 1 area 0).', check: (a) => [G('0/0/0'), G('0/0/1'), G('0/0/2')].every((i) => a.iface('R2', i).some((l) => /^ip ospf 1 area (0|0\.0\.0\.0)$/.test(l))) },
      { id: 't4', text: 'Enable OSPF on R3 any way you like, including its LAN.', check: (a) => (a.net.ospf.ifaces.R3 ?? []).length >= 3 },
      { id: 't5', text: 'Make every LAN interface (Gi0/0/2) passive.', check: (a) => ['R1', 'R2', 'R3'].every((d) => a.ospfIface(d, G('0/0/2'))?.passive) },
      { id: 't6', text: 'Each router has two FULL neighbors.', check: (a) => ['R1', 'R2', 'R3'].every((d) => a.ospfFull(d) === 2) },
      { id: 't7', text: 'PC1 can ping PC2 and PC3, and you checked show ip route ospf.', check: (a) => a.reach('PC1', '192.168.2.10') && a.reach('PC1', '192.168.3.10') && ['R1', 'R2', 'R3'].some((d) => a.ran(d, 'show ip route')) },
    ],
    solution: {
      R1: 'enable\nconfigure terminal\nrouter ospf 1\n router-id 1.1.1.1\n network 10.0.0.0 0.255.255.255 area 0\n network 192.168.1.0 0.0.0.255 area 0\n passive-interface g0/0/2',
      R2: 'enable\nconfigure terminal\nrouter ospf 1\n router-id 2.2.2.2\n passive-interface g0/0/2\ninterface range g0/0/0 - 2\n ip ospf 1 area 0',
      R3: 'enable\nconfigure terminal\nrouter ospf 1\n router-id 3.3.3.3\n network 0.0.0.0 255.255.255.255 area 0\n passive-interface g0/0/2\nend\nshow ip ospf neighbor\nshow ip route ospf',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'ospf-dr',
    title: 'OSPF DR/BDR, Network Types, and Cost',
    level: 'Advanced',
    minutes: 30,
    chapters: ['v1-23', 'v1-24'],
    scenario: 'R1, R2 and R3 share one Ethernet segment, and R1 also has a point-to-point link to R4 and a link to the ISP. OSPF is already running. Your job is to control who becomes DR, tune the link types, and advertise a default route.',
    devices: [
      { id: 'R1', kind: 'router', hostname: 'R1', x: 30, y: 30, config: 'interface g0/0/0\n ip address 192.168.123.1 255.255.255.0\n no shutdown\ninterface g0/0/1\n ip address 10.0.14.1 255.255.255.252\n no shutdown\ninterface g0/0/2\n ip address 203.0.113.2 255.255.255.252\n no shutdown\nip route 0.0.0.0 0.0.0.0 203.0.113.1\nrouter ospf 1\n router-id 1.1.1.1\n network 192.168.123.0 0.0.0.255 area 0\n network 10.0.14.0 0.0.0.3 area 0' },
      { id: 'R2', kind: 'router', hostname: 'R2', x: 50, y: 8, config: 'interface g0/0/0\n ip address 192.168.123.2 255.255.255.0\n no shutdown\ninterface loopback 0\n ip address 2.2.2.2 255.255.255.255\nrouter ospf 1\n router-id 2.2.2.2\n network 0.0.0.0 255.255.255.255 area 0' },
      { id: 'R3', kind: 'router', hostname: 'R3', x: 72, y: 30, config: 'interface g0/0/0\n ip address 192.168.123.3 255.255.255.0\n no shutdown\ninterface loopback 0\n ip address 3.3.3.3 255.255.255.255\nrouter ospf 1\n router-id 3.3.3.3\n network 0.0.0.0 255.255.255.255 area 0' },
      { id: 'SW1', kind: 'switch', hostname: 'SW1', x: 50, y: 30 },
      { id: 'R4', kind: 'router', hostname: 'R4', x: 30, y: 54, config: 'interface g0/0/1\n ip address 10.0.14.2 255.255.255.252\n no shutdown\ninterface loopback 0\n ip address 4.4.4.4 255.255.255.255\nrouter ospf 1\n router-id 4.4.4.4\n network 0.0.0.0 255.255.255.255 area 0' },
      { id: 'ISP', kind: 'router', hostname: 'ISP', x: 8, y: 30, config: 'interface g0/0/0\n ip address 203.0.113.1 255.255.255.252\n no shutdown\ninterface loopback 0\n ip address 8.8.8.8 255.255.255.255\nip route 0.0.0.0 0.0.0.0 203.0.113.2' },
    ],
    links: [
      ['R1', G('0/0/0'), 'SW1', G('1/0/1')], ['R2', G('0/0/0'), 'SW1', G('1/0/2')], ['R3', G('0/0/0'), 'SW1', G('1/0/3')],
      ['R1', G('0/0/1'), 'R4', G('0/0/1')], ['R1', G('0/0/2'), 'ISP', G('0/0/0')],
    ],
    start: 'R1',
    tasks: [
      { id: 't1', text: 'Find the current DR and BDR on the shared segment (show ip ospf neighbor or show ip ospf interface).', check: (a) => ['R1', 'R2', 'R3'].some((d) => a.ran(d, 'show ip ospf')) },
      { id: 't2', text: 'Make sure R1 can never become DR or BDR on Gi0/0/0.', hint: 'ip ospf priority 0', check: (a) => a.ospfIface('R1', G('0/0/0'))?.prio === 0 },
      { id: 't3', text: 'Make R2 the DR. Raising its priority isn\'t enough, because the election is not preemptive.', hint: 'Set ip ospf priority 255 on R2, then clear ip ospf process on the current DR (and BDR if needed).', check: (a) => a.ospfIface('R2', G('0/0/0'))?.role === 'DR' },
      { id: 't4', text: 'Change the R1–R4 link to network type point-to-point on BOTH ends (no DR election there).', check: (a) => a.ospfIface('R1', G('0/0/1'))?.type === 'P2P' && a.ospfIface('R4', G('0/0/1'))?.type === 'P2P' && a.ospfFull('R4') === 1 },
      { id: 't5', text: 'Advertise R1\'s default route into OSPF. R2, R3 and R4 should show an O*E2 route.', check: (a) => ['R2', 'R3', 'R4'].every((d) => a.route(d, '0.0.0.0/0', 'O*E2')) },
      { id: 't6', text: 'Break it on purpose: set hello-interval 5 on R4 Gi0/0/1 only and watch the neighbor drop. Then fix it.', check: (a) => a.ran('R4', /hello-interval 5/) && a.ospfFull('R4') === 1 },
      { id: 't7', text: 'Set the reference bandwidth to 10000 Mbps on all four routers.', hint: 'auto-cost reference-bandwidth 10000', check: (a) => ['R1', 'R2', 'R3', 'R4'].every((d) => a.value(a.section(d, 'router ospf 1'), 'auto-cost reference-bandwidth') === '10000') },
    ],
    solution: {
      R1: 'enable\nconfigure terminal\ninterface g0/0/0\n ip ospf priority 0\ninterface g0/0/1\n ip ospf network point-to-point\nrouter ospf 1\n default-information originate\n auto-cost reference-bandwidth 10000',
      R2: 'enable\nconfigure terminal\ninterface g0/0/0\n ip ospf priority 255\nrouter ospf 1\n auto-cost reference-bandwidth 10000',
      R3: '(if R3 is the DR) enable\nclear ip ospf process   → answer yes\nconfigure terminal\nrouter ospf 1\n auto-cost reference-bandwidth 10000',
      R4: 'enable\nconfigure terminal\ninterface g0/0/1\n ip ospf network point-to-point\n ip ospf hello-interval 5\n no ip ospf hello-interval\nrouter ospf 1\n auto-cost reference-bandwidth 10000',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'ipv6',
    title: 'IPv6 Addressing, SLAAC, and Static Routes',
    level: 'Intermediate',
    minutes: 25,
    chapters: ['v1-25', 'v1-27', 'v1-28', 'v1-29'],
    scenario: 'R2 and its LAN already run IPv6. Configure R1 so its LAN hosts autoconfigure addresses (SLAAC) and can reach PC2.',
    devices: [
      { id: 'R1', kind: 'router', hostname: 'R1', x: 35, y: 22 },
      { id: 'R2', kind: 'router', hostname: 'R2', x: 70, y: 22, config: 'ipv6 unicast-routing\ninterface g0/0/0\n ipv6 address 2001:db8:1:2::1/64\n ipv6 address fe80::2 link-local\n no shutdown\ninterface g0/0/1\n ipv6 address 2001:db8:1:12::2/64\n ipv6 address fe80::2 link-local\n no shutdown\nipv6 route ::/0 g0/0/1 fe80::1' },
      { id: 'PC1', kind: 'pc', x: 12, y: 50, host: { ipv6: 'auto' } },
      { id: 'PC2', kind: 'pc', x: 90, y: 50, host: { ipv6: '2001:db8:1:2::10/64', ipv6gw: 'fe80::2' } },
    ],
    links: [['R1', G('0/0/1'), 'R2', G('0/0/1')], ['R1', G('0/0/0'), 'PC1', 'Ethernet0'], ['R2', G('0/0/0'), 'PC2', 'Ethernet0']],
    start: 'R1',
    tasks: [
      { id: 't1', text: 'Enable IPv6 routing on R1.', check: (a) => a.has(a.global('R1'), 'ipv6 unicast-routing') },
      { id: 't2', text: 'Give R1 Gi0/0/0 the address 2001:db8:1:1::1/64 and bring it up.', check: (a) => a.iface('R1', G('0/0/0')).some((l) => /^ipv6 address 2001:db8:1:1::1\/64$/i.test(l)) && a.up('R1', G('0/0/0')) },
      { id: 't3', text: 'Give R1 Gi0/0/1 an EUI-64 address in 2001:db8:1:12::/64, set its link-local to fe80::1, and bring it up.', check: (a) => a.iface('R1', G('0/0/1')).some((l) => /eui-64$/.test(l)) && a.iface('R1', G('0/0/1')).some((l) => /^ipv6 address fe80::1 link-local$/i.test(l)) && a.up('R1', G('0/0/1')) },
      { id: 't4', text: 'Check what EUI-64 built with show ipv6 interface brief.', check: (a) => a.ran('R1', 'show ipv6 interface') },
      { id: 't5', text: 'PC1 autoconfigures a 2001:db8:1:1::/64 address from R1\'s router advertisements (see ipconfig on PC1).', check: (a) => (a.net.addrs.PC1 ?? []).some((x) => x.fam === 6 && x.auto) && a.ran('PC1', /^ipconfig/i) },
      { id: 't6', text: 'Add a static route on R1 for 2001:db8:1:2::/64 via 2001:db8:1:12::2.', check: (a) => a.route('R1', '2001:DB8:1:2::/64', 'S') },
      { id: 't7', text: 'PC1 pings PC2 at 2001:db8:1:2::10.', check: (a) => a.reach('PC1', '2001:db8:1:2::10') },
    ],
    solution: {
      R1: 'enable\nconfigure terminal\nipv6 unicast-routing\ninterface g0/0/0\n ipv6 address 2001:db8:1:1::1/64\n no shutdown\ninterface g0/0/1\n ipv6 address 2001:db8:1:12::/64 eui-64\n ipv6 address fe80::1 link-local\n no shutdown\nexit\nipv6 route 2001:db8:1:2::/64 2001:db8:1:12::2\nend\nshow ipv6 interface brief',
      PC1: 'ipconfig\nping 2001:db8:1:2::10',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'acls',
    title: 'Standard and Extended ACLs',
    level: 'Intermediate',
    minutes: 30,
    chapters: ['v2-06', 'v2-07', 'v2-08'],
    scenario: 'Users on 192.168.1.0/24 reach a server LAN through R1. Block one problem host completely, then limit everyone else to HTTPS on the web server.',
    devices: [
      { id: 'R1', kind: 'router', hostname: 'R1', x: 50, y: 28, config: 'interface g0/0/0\n ip address 10.1.1.1 255.255.255.0\n no shutdown\ninterface g0/0/1\n ip address 192.168.1.1 255.255.255.0\n no shutdown' },
      { id: 'SW1', kind: 'switch', hostname: 'SW1', x: 22, y: 28 },
      { id: 'SW2', kind: 'switch', hostname: 'SW2', x: 78, y: 28 },
      { id: 'PC1', kind: 'pc', x: 10, y: 54, host: { ip: '192.168.1.10', mask: '255.255.255.0', gw: '192.168.1.1' } },
      { id: 'PC2', kind: 'pc', x: 34, y: 54, host: { ip: '192.168.1.50', mask: '255.255.255.0', gw: '192.168.1.1' } },
      { id: 'WEB', kind: 'server', x: 68, y: 54, host: { ip: '10.1.1.10', mask: '255.255.255.0', gw: '10.1.1.1', services: [80, 443] } },
      { id: 'FILES', kind: 'server', x: 90, y: 54, host: { ip: '10.1.1.20', mask: '255.255.255.0', gw: '10.1.1.1', services: [445] } },
    ],
    links: [
      ['R1', G('0/0/1'), 'SW1', G('1/0/24')], ['R1', G('0/0/0'), 'SW2', G('1/0/24')],
      ['SW1', G('1/0/1'), 'PC1', 'Ethernet0'], ['SW1', G('1/0/2'), 'PC2', 'Ethernet0'],
      ['SW2', G('1/0/1'), 'WEB', 'Ethernet0'], ['SW2', G('1/0/2'), 'FILES', 'Ethernet0'],
    ],
    start: 'R1',
    tasks: [
      { id: 't1', text: 'Write standard ACL 10: deny host 192.168.1.50, permit everything else.', check: (a) => {
        // numbered entries live in global config, or in "ip access-list standard 10" once edited by sequence number
        const aces = [...a.global('R1').filter((l) => l.startsWith('access-list 10 ')).map((l) => l.slice(15)), ...(a.section('R1', 'ip access-list standard 10') ?? []).map((l) => l.replace(/^\d+ /, ''))]
        return aces.some((l) => /^deny (host )?192\.168\.1\.50$/.test(l)) && aces.includes('permit any')
      } },
      { id: 't2', text: 'Apply ACL 10 where standard ACLs belong: outbound on Gi0/0/0, close to the destination. PC2 can no longer reach the servers, but PC1 still can.', check: (a) => a.iface('R1', G('0/0/0')).includes('ip access-group 10 out') && !a.reach('PC2', '10.1.1.20') && a.reach('PC1', '10.1.1.20') },
      { id: 't3', text: 'Create named extended ACL WEB-ONLY: permit TCP from 192.168.1.0/24 to host 10.1.1.10 port 443, deny all other IP to 10.1.1.10, then permit ip any any.', check: (a) => { const s = a.section('R1', 'ip access-list extended WEB-ONLY') ?? []; return s.length >= 3 && s.some((l) => /permit tcp 192\.168\.1\.0 0\.0\.0\.255 host 10\.1\.1\.10 eq (443|https)/.test(l)) } },
      { id: 't4', text: 'Apply WEB-ONLY inbound on Gi0/0/1, close to the source.', check: (a) => a.iface('R1', G('0/0/1')).includes('ip access-group WEB-ONLY in') },
      { id: 't5', text: 'Test from PC1: curl https://10.1.1.10 works, but curl http://10.1.1.10 and ping 10.1.1.10 fail.', check: (a) => a.reach('PC1', '10.1.1.10', { proto: 'tcp', dport: 443, sport: 50001 }) && !a.reach('PC1', '10.1.1.10', { proto: 'tcp', dport: 80, sport: 50002 }) && a.ran('PC1', /^curl/i) },
      { id: 't6', text: 'Insert sequence 5 into WEB-ONLY so PC1 (only) can ping the web server again.', hint: 'ip access-list extended WEB-ONLY → 5 permit icmp host 192.168.1.10 host 10.1.1.10', check: (a) => (a.section('R1', 'ip access-list extended WEB-ONLY') ?? []).some((l) => l.startsWith('5 permit icmp')) && a.reach('PC1', '10.1.1.10') },
      { id: 't7', text: 'Read the match counters with show access-lists.', check: (a) => a.ran('R1', 'show access-lists') || a.ran('R1', 'show ip access-lists') },
    ],
    solution: {
      R1: 'enable\nconfigure terminal\naccess-list 10 deny host 192.168.1.50\naccess-list 10 permit any\ninterface g0/0/0\n ip access-group 10 out\nexit\nip access-list extended WEB-ONLY\n permit tcp 192.168.1.0 0.0.0.255 host 10.1.1.10 eq 443\n deny ip 192.168.1.0 0.0.0.255 host 10.1.1.10\n permit ip any any\ninterface g0/0/1\n ip access-group WEB-ONLY in\nexit\nip access-list extended WEB-ONLY\n 5 permit icmp host 192.168.1.10 host 10.1.1.10\nend\nshow access-lists',
      PC1: 'curl https://10.1.1.10\ncurl http://10.1.1.10\nping 10.1.1.10',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'port-security',
    title: 'Port Security',
    level: 'Beginner',
    minutes: 20,
    chapters: ['v2-11'],
    scenario: 'Lock two access ports to the devices that belong there, and see what happens when the wrong device plugs in.',
    devices: [
      { id: 'SW1', kind: 'switch', hostname: 'SW1', x: 50, y: 22 },
      { id: 'PC1', kind: 'pc', x: 25, y: 50, host: { ip: '192.168.1.11', mask: '255.255.255.0' } },
      { id: 'PC2', kind: 'pc', x: 75, y: 50, host: { ip: '192.168.1.12', mask: '255.255.255.0' } },
    ],
    links: [['SW1', G('1/0/5'), 'PC1', 'Ethernet0'], ['SW1', G('1/0/6'), 'PC2', 'Ethernet0']],
    start: 'SW1',
    tasks: [
      { id: 't1', text: 'Try enabling port security on Gi1/0/5 right away. It\'s rejected because the port is dynamic. Make it a static access port first.', check: (a) => a.value(a.iface('SW1', G('1/0/5')), 'switchport mode') === 'access' },
      { id: 't2', text: 'On Gi1/0/5 enable port security with maximum 2, sticky learning, and violation mode restrict.', check: (a) => { const L = a.iface('SW1', G('1/0/5')); return L.includes('switchport port-security') && a.value(L, 'switchport port-security maximum') === '2' && L.includes('switchport port-security mac-address sticky') && a.value(L, 'switchport port-security violation') === 'restrict' } },
      { id: 't3', text: 'PC1\'s MAC is learned and saved as a sticky entry in the running config (check show run interface g1/0/5).', check: (a) => a.iface('SW1', G('1/0/5')).some((l) => /^switchport port-security mac-address sticky [0-9a-f.]{14}$/.test(l)) },
      { id: 't4', text: 'On Gi1/0/6, allow only MAC 0000.1111.2222 (max 1, default shutdown mode). PC2 has a different MAC, so the port should err-disable.', check: (a) => a.iface('SW1', G('1/0/6')).includes('switchport port-security mac-address 0000.1111.2222') && a.rt('SW1').errdisabled.includes(G('1/0/6')) },
      { id: 't5', text: 'Look at the violation with show port-security interface g1/0/6 and show interfaces status.', check: (a) => a.ran('SW1', 'show port-security') },
      { id: 't6', text: 'Recover Gi1/0/6: replace the static MAC with sticky learning, then shutdown / no shutdown. PC1 can ping PC2 again.', check: (a) => a.iface('SW1', G('1/0/6')).includes('switchport port-security mac-address sticky') && !a.rt('SW1').errdisabled.includes(G('1/0/6')) && a.reach('PC1', '192.168.1.12') },
    ],
    solution: {
      SW1: 'enable\nconfigure terminal\ninterface g1/0/5\n switchport mode access\n switchport port-security\n switchport port-security maximum 2\n switchport port-security mac-address sticky\n switchport port-security violation restrict\ninterface g1/0/6\n switchport mode access\n switchport port-security\n switchport port-security mac-address 0000.1111.2222\nend\nshow port-security interface g1/0/6\nconfigure terminal\ninterface g1/0/6\n no switchport port-security mac-address 0000.1111.2222\n switchport port-security mac-address sticky\n shutdown\n no shutdown',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'snooping-dai',
    title: 'DHCP Snooping and Dynamic ARP Inspection',
    level: 'Advanced',
    minutes: 30,
    chapters: ['v2-12'],
    scenario: 'Someone plugged a home router into port Gi1/0/2 and it\'s handing out bad addresses. Stop rogue DHCP with snooping, then use DAI to block hosts that bypass DHCP.',
    devices: [
      { id: 'R1', kind: 'router', hostname: 'R1', x: 50, y: 6, config: 'interface g0/0/0\n ip address 192.168.10.1 255.255.255.0\n no shutdown\nip dhcp excluded-address 192.168.10.1 192.168.10.99\nip dhcp pool USERS\n network 192.168.10.0 255.255.255.0\n default-router 192.168.10.1' },
      { id: 'SW1', kind: 'switch', hostname: 'SW1', x: 50, y: 28, config: 'vlan 10\ninterface range g1/0/1 - 3\n switchport mode access\n switchport access vlan 10\ninterface g1/0/24\n switchport mode access\n switchport access vlan 10' },
      { id: 'PC1', kind: 'pc', x: 20, y: 54, host: { dhcp: true } },
      { id: 'ROGUE', kind: 'server', x: 50, y: 54, host: { ip: '10.66.66.1', mask: '255.255.255.0', dhcpServer: { network: '10.66.66.0', mask: '255.255.255.0', gw: '10.66.66.1', dns: '10.66.66.1' } } },
      { id: 'PC2', kind: 'pc', x: 80, y: 54, host: { ip: '192.168.10.50', mask: '255.255.255.0', gw: '192.168.10.1' } },
    ],
    links: [['SW1', G('1/0/24'), 'R1', G('0/0/0')], ['SW1', G('1/0/1'), 'PC1', 'Ethernet0'], ['SW1', G('1/0/2'), 'ROGUE', 'Ethernet0'], ['SW1', G('1/0/3'), 'PC2', 'Ethernet0']],
    start: 'SW1',
    tasks: [
      { id: 't1', text: 'Run ipconfig /renew on PC1 and notice the 10.66.66.x address from the rogue server.', check: (a) => a.ran('PC1', /^ipconfig \/renew/i) },
      { id: 't2', text: 'Enable DHCP snooping globally and for VLAN 10 on SW1.', check: (a) => a.global('SW1').includes('ip dhcp snooping') && a.global('SW1').some((l) => /^ip dhcp snooping vlan .*10/.test(l)) },
      { id: 't3', text: 'Trust only the uplink to the real server (Gi1/0/24).', check: (a) => a.has(a.iface('SW1', G('1/0/24')), 'ip dhcp snooping trust') && !a.has(a.iface('SW1', G('1/0/2')), 'ip dhcp snooping trust') },
      { id: 't4', text: 'Renew again on PC1 and get a 192.168.10.x lease from R1. If it still fails, see the hint.', hint: 'The switch inserts DHCP option 82, which an IOS DHCP server drops when giaddr is 0. Use: no ip dhcp snooping information option', check: (a) => a.host('PC1').lease?.server === 'R1' },
      { id: 't5', text: 'Confirm PC1 is in the binding table (show ip dhcp snooping binding).', check: (a) => (a.rt('SW1').snoopBindings ?? []).length > 0 && a.ran('SW1', 'show ip dhcp snooping binding') },
      { id: 't6', text: 'Enable Dynamic ARP Inspection on VLAN 10 and trust Gi1/0/24. PC1 still reaches R1, but PC2 (static IP, no binding) can\'t.', check: (a) => a.global('SW1').some((l) => /^ip arp inspection vlan .*10/.test(l)) && a.has(a.iface('SW1', G('1/0/24')), 'ip arp inspection trust') && a.reach('PC1', '192.168.10.1') && !a.reach('PC2', '192.168.10.1') },
    ],
    solution: {
      PC1: 'ipconfig /renew',
      SW1: 'enable\nconfigure terminal\nip dhcp snooping\nip dhcp snooping vlan 10\nno ip dhcp snooping information option\ninterface g1/0/24\n ip dhcp snooping trust\nexit\nip arp inspection vlan 10\ninterface g1/0/24\n ip arp inspection trust\nend\nshow ip dhcp snooping binding',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'mgmt-protocols',
    title: 'NTP, Syslog, CDP, and LLDP',
    level: 'Beginner',
    minutes: 20,
    chapters: ['v2-13'],
    scenario: 'Get every device agreeing on the time, send important logs to the syslog server, and map the network with discovery protocols.',
    devices: [
      { id: 'R1', kind: 'router', hostname: 'R1', x: 30, y: 12, config: 'interface g0/0/0\n ip address 10.0.12.1 255.255.255.252\n no shutdown' },
      { id: 'R2', kind: 'router', hostname: 'R2', x: 70, y: 12, config: 'interface g0/0/0\n ip address 10.0.12.2 255.255.255.252\n no shutdown\ninterface g0/0/1\n ip address 192.168.1.1 255.255.255.0\n no shutdown' },
      { id: 'SW1', kind: 'switch', hostname: 'SW1', x: 70, y: 36 },
      { id: 'SYSLOG', kind: 'server', x: 70, y: 56, host: { ip: '192.168.1.100', mask: '255.255.255.0', gw: '192.168.1.1', services: [514] } },
    ],
    links: [['R1', G('0/0/0'), 'R2', G('0/0/0')], ['R2', G('0/0/1'), 'SW1', G('1/0/24')], ['SW1', G('1/0/1'), 'SYSLOG', 'Ethernet0']],
    start: 'R2',
    tasks: [
      { id: 't1', text: 'Make R1 an authoritative NTP server at stratum 4.', check: (a) => a.value(a.global('R1'), 'ntp master') === '4' },
      { id: 't2', text: 'Make R2 an NTP client of R1. show ntp status reports synchronized at stratum 5.', check: (a) => a.global('R2').includes('ntp server 10.0.12.1') && a.ran('R2', 'show ntp') },
      { id: 't3', text: 'On R2, timestamp log messages with the date and milliseconds.', check: (a) => a.global('R2').some((l) => l.startsWith('service timestamps log datetime')) },
      { id: 't4', text: 'Send R2\'s logs to the syslog server 192.168.1.100, warnings (level 4) and more severe only.', check: (a) => a.global('R2').includes('logging host 192.168.1.100') && a.value(a.global('R2'), 'logging trap') === 'warnings' },
      { id: 't5', text: 'Shut and re-enable R2 Gi0/0/0, then find the link messages with show logging.', check: (a) => a.ran('R2', 'show logging') && a.ran('R2', 'shutdown') },
      { id: 't6', text: 'Map neighbors with CDP from R2 (show cdp neighbors). It\'s on by default.', check: (a) => a.ran('R2', 'show cdp neighbors') },
      { id: 't7', text: 'Enable LLDP on R2 and SW1 and confirm they see each other.', check: (a) => a.has(a.global('R2'), 'lldp run') && a.has(a.global('SW1'), 'lldp run') && (a.ran('R2', 'show lldp neighbors') || a.ran('SW1', 'show lldp neighbors')) },
    ],
    solution: {
      R1: 'enable\nconfigure terminal\nntp master 4',
      R2: 'enable\nconfigure terminal\nntp server 10.0.12.1\nservice timestamps log datetime msec\nlogging host 192.168.1.100\nlogging trap warnings\nlldp run\ninterface g0/0/0\n shutdown\n no shutdown\nend\nshow ntp status\nshow logging\nshow cdp neighbors\nshow lldp neighbors',
      SW1: 'enable\nconfigure terminal\nlldp run',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'nat-pat',
    title: 'Static NAT and PAT',
    level: 'Intermediate',
    minutes: 25,
    chapters: ['v2-14'],
    scenario: 'The ISP gave you 203.0.113.0/29. Publish the internal web server at 203.0.113.5 and let every inside host share R1\'s outside address for internet access.',
    devices: [
      { id: 'R1', kind: 'router', hostname: 'R1', x: 45, y: 24, config: 'interface g0/0/0\n ip address 192.168.1.1 255.255.255.0\n no shutdown\ninterface g0/0/1\n ip address 203.0.113.2 255.255.255.248\n no shutdown\nip route 0.0.0.0 0.0.0.0 203.0.113.1' },
      { id: 'ISP', kind: 'router', hostname: 'ISP', x: 78, y: 24, config: 'interface g0/0/0\n ip address 203.0.113.1 255.255.255.248\n no shutdown\ninterface g0/0/1\n ip address 198.51.100.1 255.255.255.0\n no shutdown\ninterface loopback 0\n ip address 8.8.8.8 255.255.255.255' },
      { id: 'SW1', kind: 'switch', hostname: 'SW1', x: 18, y: 24 },
      { id: 'PC1', kind: 'pc', x: 8, y: 52, host: { ip: '192.168.1.20', mask: '255.255.255.0', gw: '192.168.1.1' } },
      { id: 'WEB', kind: 'server', x: 30, y: 52, host: { ip: '192.168.1.10', mask: '255.255.255.0', gw: '192.168.1.1', services: [80, 443] } },
      { id: 'REMOTE', kind: 'pc', x: 90, y: 52, host: { ip: '198.51.100.50', mask: '255.255.255.0', gw: '198.51.100.1' } },
    ],
    links: [['R1', G('0/0/0'), 'SW1', G('1/0/24')], ['SW1', G('1/0/1'), 'PC1', 'Ethernet0'], ['SW1', G('1/0/2'), 'WEB', 'Ethernet0'], ['R1', G('0/0/1'), 'ISP', G('0/0/0')], ['ISP', G('0/0/1'), 'REMOTE', 'Ethernet0']],
    start: 'R1',
    tasks: [
      { id: 't1', text: 'PC1 can\'t reach 8.8.8.8 yet. The ISP has no route back to 192.168.1.0/24. Try it.', check: (a) => a.ran('PC1', /^ping 8\.8\.8\.8/) },
      { id: 't2', text: 'Mark Gi0/0/0 as NAT inside and Gi0/0/1 as NAT outside.', check: (a) => a.has(a.iface('R1', G('0/0/0')), 'ip nat inside') && a.has(a.iface('R1', G('0/0/1')), 'ip nat outside') },
      { id: 't3', text: 'Publish the web server: static NAT 192.168.1.10 ↔ 203.0.113.5. REMOTE can then browse http://203.0.113.5.', check: (a) => a.global('R1').includes('ip nat inside source static 192.168.1.10 203.0.113.5') && a.reach('REMOTE', '203.0.113.5', { proto: 'tcp', dport: 80, sport: 50010 }) },
      { id: 't4', text: 'Configure PAT: ACL 1 matching 192.168.1.0/24, overloaded onto Gi0/0/1.', check: (a) => a.global('R1').some((l) => /^ip nat inside source list 1 interface GigabitEthernet0\/0\/1 overload$/.test(l)) && a.global('R1').some((l) => /^access-list 1 permit 192\.168\.1\.0 0\.0\.0\.255$/.test(l)) },
      { id: 't5', text: 'PC1 pings 8.8.8.8, and show ip nat translations shows the PAT entries.', check: (a) => a.reach('PC1', '8.8.8.8') && a.ran('R1', 'show ip nat translations') },
    ],
    solution: {
      R1: 'enable\nconfigure terminal\ninterface g0/0/0\n ip nat inside\ninterface g0/0/1\n ip nat outside\nexit\nip nat inside source static 192.168.1.10 203.0.113.5\naccess-list 1 permit 192.168.1.0 0.0.0.255\nip nat inside source list 1 interface g0/0/1 overload\nend\nshow ip nat translations',
      REMOTE: 'curl http://203.0.113.5',
      PC1: 'ping 8.8.8.8',
    },
  },
  // ------------------------------------------------------------------
  {
    id: 'hsrp',
    title: 'HSRP Gateway Redundancy',
    level: 'Intermediate',
    minutes: 20,
    chapters: ['v2-16'],
    scenario: 'PC1 uses 192.168.1.254 as its gateway, an address that neither router owns yet. Build HSRP so R1 normally answers and R2 takes over if R1 fails. (OSPF already runs toward the ISP in the background, so upstream routing follows the failover.)',
    devices: [
      { id: 'R1', kind: 'router', hostname: 'R1', x: 30, y: 26, config: 'interface g0/0/0\n ip address 192.168.1.1 255.255.255.0\n no shutdown\ninterface g0/0/1\n ip address 10.0.1.1 255.255.255.252\n no shutdown\nrouter ospf 1\n router-id 1.1.1.1\n network 0.0.0.0 255.255.255.255 area 0\n passive-interface g0/0/0' },
      { id: 'R2', kind: 'router', hostname: 'R2', x: 70, y: 26, config: 'interface g0/0/0\n ip address 192.168.1.2 255.255.255.0\n no shutdown\ninterface g0/0/1\n ip address 10.0.2.1 255.255.255.252\n no shutdown\nrouter ospf 1\n router-id 2.2.2.2\n network 0.0.0.0 255.255.255.255 area 0\n passive-interface g0/0/0' },
      { id: 'ISP', kind: 'router', hostname: 'ISP', x: 50, y: 6, config: 'interface g0/0/0\n ip address 10.0.1.2 255.255.255.252\n no shutdown\ninterface g0/0/1\n ip address 10.0.2.2 255.255.255.252\n no shutdown\ninterface loopback 0\n ip address 8.8.8.8 255.255.255.255\nrouter ospf 1\n router-id 9.9.9.9\n network 10.0.0.0 0.255.255.255 area 0\n default-information originate always' },
      { id: 'SW1', kind: 'switch', hostname: 'SW1', x: 50, y: 42 },
      { id: 'PC1', kind: 'pc', x: 50, y: 58, host: { ip: '192.168.1.10', mask: '255.255.255.0', gw: '192.168.1.254' } },
    ],
    links: [['R1', G('0/0/0'), 'SW1', G('1/0/1')], ['R2', G('0/0/0'), 'SW1', G('1/0/2')], ['SW1', G('1/0/10'), 'PC1', 'Ethernet0'], ['R1', G('0/0/1'), 'ISP', G('0/0/0')], ['R2', G('0/0/1'), 'ISP', G('0/0/1')]],
    start: 'R1',
    tasks: [
      { id: 't1', text: 'Configure HSRP version 2, group 1, virtual IP 192.168.1.254 on Gi0/0/0 of both routers.', check: (a) => ['R1', 'R2'].every((d) => a.has(a.iface(d, G('0/0/0')), 'standby version 2') && a.iface(d, G('0/0/0')).includes('standby 1 ip 192.168.1.254')) },
      { id: 't2', text: 'Give R1 priority 110 and enable preemption so it is the active router.', check: (a) => a.iface('R1', G('0/0/0')).includes('standby 1 priority 110') && a.has(a.iface('R1', G('0/0/0')), 'standby 1 preempt') && a.hsrp('R1', G('0/0/0'))[0]?.state === 'Active' },
      { id: 't3', text: 'PC1 reaches 8.8.8.8 through the virtual gateway.', check: (a) => a.reach('PC1', '8.8.8.8') },
      { id: 't4', text: 'Simulate a failure: shut R1 Gi0/0/0. R2 becomes Active and PC1 still reaches 8.8.8.8.', check: (a) => a.has(a.iface('R1', G('0/0/0')), 'shutdown') && a.hsrp('R2', G('0/0/0'))[0]?.state === 'Active' && a.reach('PC1', '8.8.8.8') },
      { id: 't5', text: 'Bring R1 Gi0/0/0 back. Thanks to preempt, R1 takes Active back (show standby brief).', check: (a) => a.ran('R1', 'shutdown') && !a.has(a.iface('R1', G('0/0/0')), 'shutdown') && a.hsrp('R1', G('0/0/0'))[0]?.state === 'Active' && a.ran('R1', 'show standby') },
    ],
    solution: {
      R1: 'enable\nconfigure terminal\ninterface g0/0/0\n standby version 2\n standby 1 ip 192.168.1.254\n standby 1 priority 110\n standby 1 preempt\n shutdown\n no shutdown\nend\nshow standby brief',
      R2: 'enable\nconfigure terminal\ninterface g0/0/0\n standby version 2\n standby 1 ip 192.168.1.254',
    },
  },
]
