// Interface name handling: abbreviations, canonical names, short names, sorting.

const TYPES = [
  { full: 'GigabitEthernet', short: 'Gi', min: 1 },
  { full: 'FastEthernet', short: 'Fa', min: 1 },
  { full: 'TenGigabitEthernet', short: 'Te', min: 2 },
  { full: 'Loopback', short: 'Lo', min: 1 },
  { full: 'Vlan', short: 'Vl', min: 1 },
  { full: 'Port-channel', short: 'Po', min: 1 },
  { full: 'Serial', short: 'Se', min: 1 },
]

// Resolve a type word ("g", "gig", "fa", "po", "vlan") to its type entry
export function resolveType(word) {
  const w = word.toLowerCase()
  const matches = TYPES.filter((t) => t.full.toLowerCase().startsWith(w) && w.length >= t.min)
  if (matches.length === 1) return matches[0]
  // "g"/"gi" is ambiguous on real IOS only with other G types; we treat it as GigabitEthernet
  if (matches.length > 1) return matches.find((t) => t.full === 'GigabitEthernet') ?? null
  return null
}

// "g0/0/1" | ["g", "0/0/1"] -> "GigabitEthernet0/0/1". Returns null when invalid.
export function canonicalIface(word, next) {
  if (!word) return null
  let m = /^([a-zA-Z-]+)\s*([\d/.]+)$/.exec(word)
  let consumed = 1
  if (!m && next !== undefined && /^[a-zA-Z-]+$/.test(word) && /^[\d/.]+$/.test(next)) {
    m = [null, word, next]
    consumed = 2
  }
  if (!m) return null
  const type = resolveType(m[1])
  if (!type) return null
  return { name: type.full + m[2], consumed }
}

export function shortIface(name) {
  const t = TYPES.find((x) => name.startsWith(x.full))
  return t ? t.short + name.slice(t.full.length) : name
}

export function ifaceType(name) {
  const t = TYPES.find((x) => name.startsWith(x.full))
  return t ? t.full : null
}

export const isSubif = (name) => /\.\d+$/.test(name)
export const parentOf = (name) => name.replace(/\.\d+$/, '')
export const isPhysical = (name) => ['GigabitEthernet', 'FastEthernet', 'TenGigabitEthernet', 'Serial'].includes(ifaceType(name)) && !isSubif(name)

// Sort interface names the way IOS lists them (type order, then numeric parts)
export function compareIfaces(a, b) {
  const order = ['Vlan', 'FastEthernet', 'GigabitEthernet', 'TenGigabitEthernet', 'Serial', 'Port-channel', 'Loopback']
  const ta = order.indexOf(ifaceType(a))
  const tb = order.indexOf(ifaceType(b))
  if (ta !== tb) return ta - tb
  const na = a.replace(/^[A-Za-z-]+/, '').split(/[/.]/).map(Number)
  const nb = b.replace(/^[A-Za-z-]+/, '').split(/[/.]/).map(Number)
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? -1) - (nb[i] ?? -1)
    if (d) return d
  }
  return 0
}

// "g1/0/1 - 12" or "g1/0/1-12, g1/0/20" -> list of canonical names (must exist in `available`)
export function expandRange(text, available) {
  const out = []
  for (const chunk of text.split(',')) {
    const m = /^\s*([a-zA-Z-]+)\s*([\d/]*?)(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(chunk)
    if (!m) return null
    const type = resolveType(m[1])
    if (!type) return null
    const a = Number(m[3])
    const b = m[4] ? Number(m[4]) : a
    if (b < a) return null
    for (let i = a; i <= b; i++) {
      const name = `${type.full}${m[2]}${i}`
      if (!available.includes(name)) return null
      out.push(name)
    }
  }
  return out
}

// Bandwidth in kbps for OSPF cost and STP cost
export function bandwidthKbps(name) {
  const t = ifaceType(name)
  if (t === 'FastEthernet') return 100000
  if (t === 'TenGigabitEthernet') return 10000000
  if (t === 'Serial') return 1544
  if (t === 'Loopback') return 8000000
  return 1000000
}

export function stpCost(name) {
  const t = ifaceType(name)
  if (t === 'FastEthernet') return 19
  if (t === 'TenGigabitEthernet') return 2
  return 4
}
