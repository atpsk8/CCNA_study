import { shortIface } from '../../sim/iface.js'
import { hostname } from '../../sim/device.js'

// Port light: green = up and forwarding, amber = up but STP-blocked, red = down, grey = shut
function portState(net, devId, iface) {
  const st = net.ifState[devId]?.[iface]
  if (!st) return 'off'
  if (st.status === 'administratively down') return 'off'
  if (st.protocol !== 'up' || st.reason) return 'down'
  // bundled member ports report through their port-channel
  const g = net.channels.find((x) => x.dev === devId && x.members.some((m) => m.iface === iface))
  const port = g && g.flags[iface] === 'P' ? g.po : iface
  if (g && g.flags[iface] !== 'P' && g.flags[iface] !== 'I') return 'down'
  for (const v of Object.values(net.stp)) {
    const p = v.bridges[devId]?.ports[port]
    if (p && p.state !== 'FWD') return 'block'
  }
  return 'up'
}

function Icon({ kind }) {
  switch (kind) {
    case 'router':
      return (
        <g className="ico">
          <ellipse cx="0" cy="0" rx="4.2" ry="2.8" />
          <path d="M-2.4 -0.6 h4.8 M1.4 -1.6 l1 1 l-1 1 M2.4 0.7 h-4.8 M-1.4 -0.3 l-1 1 l1 1" className="ico-line" />
        </g>
      )
    case 'switch':
    case 'l3switch':
      return (
        <g className="ico">
          <rect x="-4.6" y="-2.4" width="9.2" height="4.8" rx="0.8" />
          <path d="M-3 -0.8 h5.4 M1.4 -1.8 l1 1 l-1 1 M3 0.9 h-5.4 M-1.4 -0.1 l-1 1 l1 1" className="ico-line" />
          {kind === 'l3switch' && <circle cx="3.4" cy="-1.5" r="0.5" className="ico-dot" />}
        </g>
      )
    case 'server':
      return (
        <g className="ico">
          <rect x="-2.4" y="-3.4" width="4.8" height="6.8" rx="0.5" />
          <path d="M-1.4 -1.8 h2.8 M-1.4 -0.4 h2.8 M-1.4 1 h2.8" className="ico-line" />
        </g>
      )
    default:
      return (
        <g className="ico">
          <rect x="-3.4" y="-2.8" width="6.8" height="4.4" rx="0.5" />
          <path d="M-1.4 2.8 h2.8 M0 1.6 v1.2" className="ico-line" />
        </g>
      )
  }
}

export default function Topology({ lab, engine, net, active, onSelect }) {
  const pos = Object.fromEntries(lab.devices.map((d) => [d.id, d]))
  // Fit the drawing to the devices so small labs don't float in empty space
  const xs = lab.devices.map((d) => d.x)
  const ys = lab.devices.map((d) => d.y)
  const minX = Math.min(...xs) - 11
  const minY = Math.min(...ys) - 7
  const w = Math.max(...xs) - Math.min(...xs) + 22
  const h = Math.max(...ys) - Math.min(...ys) + 17
  return (
    <svg className="topo" viewBox={`${minX} ${minY} ${w} ${h}`} role="img" aria-label={`Topology for ${lab.title}`}>
      {lab.links.map(([a, ai, b, bi]) => {
        const A = pos[a]
        const B = pos[b]
        const sa = portState(net, a, ai)
        const sb = portState(net, b, bi)
        const lerp = (t) => ({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t })
        const pa = lerp(Math.min(0.35, 6 / Math.hypot(B.x - A.x, B.y - A.y)))
        const pb = lerp(1 - Math.min(0.35, 6 / Math.hypot(B.x - A.x, B.y - A.y)))
        // port labels sit beside the wire, nudged off the line so they clear the device icons
        const len = Math.hypot(B.x - A.x, B.y - A.y) || 1
        const nx = -(B.y - A.y) / len
        const ny = (B.x - A.x) / len
        const ta = Math.min(0.45, 12 / len)
        const la = { x: lerp(ta).x + nx * 1.8, y: lerp(ta).y + ny * 1.8 + 0.8 }
        const lb = { x: lerp(1 - ta).x + nx * 1.8, y: lerp(1 - ta).y + ny * 1.8 + 0.8 }
        const linkUp = sa === 'up' && sb === 'up'
        return (
          <g key={`${a}${ai}${b}${bi}`} className="link">
            <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} className={linkUp ? 'wire up' : sa === 'block' || sb === 'block' ? 'wire block' : 'wire'} />
            <circle cx={pa.x} cy={pa.y} r="0.9" className={`led ${sa}`} />
            <circle cx={pb.x} cy={pb.y} r="0.9" className={`led ${sb}`} />
            {ai !== 'Ethernet0' && <text x={la.x} y={la.y} className="port-label">{shortIface(ai)}</text>}
            {bi !== 'Ethernet0' && <text x={lb.x} y={lb.y} className="port-label">{shortIface(bi)}</text>}
          </g>
        )
      })}
      {lab.devices.map((d) => {
        const dev = engine.dev(d.id)
        return (
          <g key={d.id} transform={`translate(${d.x} ${d.y})`} className={`node ${active === d.id ? 'active' : ''}`}
            onClick={() => onSelect(d.id)} role="button" tabIndex={0} aria-label={`Open ${d.id} console`}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(d.id) } }}>
            <rect x="-6" y="-4.5" width="12" height="13" className="hit" />
            <Icon kind={d.kind} />
            <text y="6.6" className="node-label">{dev ? hostname(dev) : d.id}</text>
          </g>
        )
      })}
    </svg>
  )
}
