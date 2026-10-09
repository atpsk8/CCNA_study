import { useState } from 'react'

// Turns a 32-bit number into dotted-decimal (e.g. 192.168.1.0)
function toIp(n) {
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.')
}

// Random address from one of the private ranges, prefix /8–/30 depending on difficulty
const RANGES = {
  easy: [24, 30],   // last-octet problems
  medium: [16, 30],
  hard: [9, 30],
}

function randomProblem(level) {
  const [lo, hi] = RANGES[level]
  const r = () => Math.floor(Math.random() * 256)
  const bases = [
    () => ((10 << 24) | (r() << 16) | (r() << 8) | r()) >>> 0,
    () => ((172 << 24) | ((16 + Math.floor(Math.random() * 16)) << 16) | (r() << 8) | r()) >>> 0,
    () => ((192 << 24) | (168 << 16) | (r() << 8) | r()) >>> 0,
  ]
  const ip = bases[Math.floor(Math.random() * bases.length)]()
  const prefix = lo + Math.floor(Math.random() * (hi - lo + 1))
  return { ip, prefix }
}

function solve({ ip, prefix }) {
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  const network = (ip & mask) >>> 0
  const broadcast = (network | ~mask) >>> 0
  return {
    mask: toIp(mask),
    network: toIp(network),
    broadcast: toIp(broadcast),
    firstHost: toIp(network + 1),
    lastHost: toIp(broadcast - 1),
    hosts: String(2 ** (32 - prefix) - 2),
  }
}

const FIELDS = [
  ['mask', 'Subnet mask'],
  ['network', 'Subnet ID'],
  ['broadcast', 'Broadcast'],
  ['firstHost', 'First usable'],
  ['lastHost', 'Last usable'],
  ['hosts', 'Usable hosts'],
]

export default function Subnetting() {
  const [level, setLevel] = useState('medium')
  const [problem, setProblem] = useState(() => randomProblem('medium'))
  const [guesses, setGuesses] = useState({})
  const [checked, setChecked] = useState(false)
  const [streak, setStreak] = useState(0)

  const answer = solve(problem)
  const allRight = FIELDS.every(([k]) => (guesses[k] ?? '').trim() === answer[k])

  function next(lvl = level) {
    setProblem(randomProblem(lvl))
    setGuesses({})
    setChecked(false)
  }

  function check() {
    setChecked(true)
    setStreak(allRight ? streak + 1 : 0)
  }

  return(
  <section>
    <h1>Subnetting practice</h1>
    <p className="lede">Type your answers (or work them on paper), then check. Goal: all six right in under 15 seconds.</p>
    <div className="row wrap toolbar">
      {Object.keys(RANGES).map((l) => (
        <button key={l} className={level === l ? 'active' : ''} onClick={() => { setLevel(l); next(l) }}>
          {l[0].toUpperCase() + l.slice(1)}
        </button>
      ))}
      <span>Streak: <strong>{streak}</strong></span>
    </div>
    <div className="card">
      <h3>{toIp(problem.ip)}/{problem.prefix}</h3>
      <form className="answers" onSubmit={(e) => { e.preventDefault(); checked ? next() : check() }}>
        {FIELDS.map(([key, label]) => {
          const ok = (guesses[key] ?? '').trim() === answer[key]
          return (
            <label key={key} className="answer-row">
              <span>{label}</span>
              <input value={guesses[key] ?? ''} disabled={checked} inputMode="decimal"
                className={checked ? (ok ? 'ok' : 'bad') : ''}
                onChange={(e) => setGuesses({ ...guesses, [key]: e.target.value })} />
              {checked && !ok && <span className="reveal">{answer[key]}</span>}
            </label>
          )
        })}
        <div className="row">
          {!checked && <button type="submit">Check</button>}
          {checked && <span>{allRight ? 'All correct!' : 'Answers shown for the ones you missed.'}</span>}
          <button type="button" onClick={() => next()}>New problem</button>
        </div>
      </form>
    </div>
  </section>
  )
}
