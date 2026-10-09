import { useEffect, useMemo, useRef, useState } from 'react'
import { LabEngine } from '../../sim/engine.js'
import { chapterById, chapterLabel } from '../../data/index.js'
import { useStored, KEYS } from '../../hooks/useStored.js'
import Terminal from './Terminal.jsx'
import Topology from './Topology.jsx'

const saveKey = (id) => `ccna.lab.${id}`

function loadSaved(id) {
  try {
    const raw = localStorage.getItem(saveKey(id))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export default function LabRunner({ lab, onBack, navigate }) {
  const engineRef = useRef(null)
  if (!engineRef.current) {
    try { engineRef.current = new LabEngine(lab, loadSaved(lab.id)) } catch { engineRef.current = new LabEngine(lab, null) }
  }
  const engine = engineRef.current
  const [version, setVersion] = useState(0)
  const [active, setActive] = useState(lab.start ?? lab.devices[0].id)
  const [labs, setLabs] = useStored(KEYS.labs, {})
  const [hints, setHints] = useState({})
  const [showSolution, setShowSolution] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const net = useMemo(() => engine.getNet(), [engine, version])
  const auto = useMemo(() => engine.checkTasks(), [engine, version])
  const saved = labs[lab.id] ?? { tasks: {}, manual: {} }
  const doneCount = lab.tasks.filter((t) => auto[t.id] || saved.tasks?.[t.id] || saved.manual?.[t.id]).length
  const complete = doneCount === lab.tasks.length

  // Persist the lab and latch tasks that have been achieved at least once
  useEffect(() => {
    try { localStorage.setItem(saveKey(lab.id), engine.serialize()) } catch { /* storage full or blocked */ }
    const tasks = { ...(saved.tasks ?? {}) }
    let changed = false
    for (const [k, v] of Object.entries(auto)) if (v && !tasks[k]) { tasks[k] = true; changed = true }
    if (changed) setLabs({ ...labs, [lab.id]: { ...saved, tasks } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  const bump = () => setVersion((v) => v + 1)

  function reset() {
    try { localStorage.removeItem(saveKey(lab.id)) } catch { /* ignore */ }
    engineRef.current = new LabEngine(lab, null)
    setLabs({ ...labs, [lab.id]: { tasks: {}, manual: {} } })
    setConfirmReset(false)
    setActive(lab.start ?? lab.devices[0].id)
    bump()
  }

  function toggleManual(t) {
    const manual = { ...(saved.manual ?? {}), [t.id]: !saved.manual?.[t.id] }
    setLabs({ ...labs, [lab.id]: { ...saved, manual } })
  }

  return (
    <section className="lab-runner">
      <div className="lab-head">
        <button className="btn ghost back" onClick={onBack}>All labs</button>
        <div className="lab-title">
          <h1>{lab.title}</h1>
          <p className="lede">{lab.scenario}</p>
          <p className="meta">
            <span className="tag">{lab.level}</span>
            <span className="tag">about {lab.minutes} min</span>
            {lab.chapters.map((id) => {
              const c = chapterById(id)
              return c && <button key={id} className="tag link" onClick={() => navigate('plan', { chapter: id })}>{chapterLabel(c)}</button>
            })}
          </p>
        </div>
      </div>

      <div className="lab-grid">
        <div className="lab-side">
          <div className="panel topo-panel">
            <Topology lab={lab} engine={engine} net={net} active={active} onSelect={setActive} />
            <p className="fine">Click a device to open its console. Port lights: green up, amber blocked by spanning tree, red down, grey shut.</p>
          </div>

          <div className="panel tasks">
            <div className="tasks-head">
              <h2>Tasks</h2>
              <span className={`count ${complete ? 'all' : ''}`}>{doneCount} of {lab.tasks.length}</span>
            </div>
            {complete && <p className="lab-complete">Lab complete. Nice work. It counts toward the linked chapters in your study plan.</p>}
            <ol className="task-list">
              {lab.tasks.map((t) => {
                const isAuto = auto[t.id] || saved.tasks?.[t.id]
                const isDone = isAuto || saved.manual?.[t.id]
                return (
                  <li key={t.id} className={isDone ? 'done' : ''}>
                    <label className="check">
                      <input type="checkbox" checked={!!isDone} onChange={() => toggleManual(t)} disabled={!!isAuto}
                        aria-label={isAuto ? 'Completed automatically' : 'Mark done yourself'} />
                      <span>{t.text}</span>
                    </label>
                    {t.hint && (
                      <>
                        <button className="hint-btn" onClick={() => setHints({ ...hints, [t.id]: !hints[t.id] })}>{hints[t.id] ? 'Hide hint' : 'Hint'}</button>
                        {hints[t.id] && <p className="hint">{t.hint}</p>}
                      </>
                    )}
                  </li>
                )
              })}
            </ol>
            {lab.tryIt && <p className="try"><strong>Try it:</strong> {lab.tryIt}</p>}
            <div className="row wrap">
              <button className="btn ghost" onClick={() => setShowSolution(!showSolution)}>{showSolution ? 'Hide solution' : 'Show solution'}</button>
              {confirmReset ? (
                <>
                  <span className="fine">Erase this lab and start over?</span>
                  <button className="btn danger" onClick={reset}>Reset lab</button>
                  <button className="btn ghost" onClick={() => setConfirmReset(false)}>Keep it</button>
                </>
              ) : <button className="btn ghost" onClick={() => setConfirmReset(true)}>Reset lab</button>}
            </div>
            {showSolution && (
              <div className="solution">
                {Object.entries(lab.solution).map(([d, text]) => (
                  <div key={d}>
                    <h3>{d}</h3>
                    <pre className="config">{text}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lab-main">
          <div className="term-tabs" role="tablist">
            {lab.devices.map((d) => (
              <button key={d.id} role="tab" aria-selected={active === d.id} className={active === d.id ? 'active' : ''} onClick={() => setActive(d.id)}>
                {d.id}
              </button>
            ))}
          </div>
          <Terminal key={active} engine={engine} devId={active} version={version} onCommand={bump} />
          <p className="fine">Abbreviations work (<code>sh ip int br</code>). Tab completes, <code>?</code> lists options, ↑ recalls commands, Ctrl+Z ends config mode.</p>
        </div>
      </div>
    </section>
  )
}
