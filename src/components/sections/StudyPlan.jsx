import { useEffect, useMemo, useState } from 'react'
import { PARTS, CHAPTERS, QUESTIONS, TERMS, LABS, OBJECTIVES, chapterLabel } from '../../data/index.js'
import { useStored, KEYS } from '../../hooks/useStored.js'
import { useProgress, chapterItems } from '../../progress.js'
import { PageLink } from '../../book/BookPanels.jsx'

const PRIORITY_LABEL = { core: 'Core', standard: 'Standard', light: 'Skim' }

// Split the chapters into weeks of roughly `hoursPerWeek` hours, in book order
export function buildSchedule(hoursPerWeek) {
  const weeks = []
  let current = { chapters: [], hours: 0 }
  for (const c of CHAPTERS) {
    if (current.chapters.length && current.hours + c.hours > hoursPerWeek) {
      weeks.push(current)
      current = { chapters: [], hours: 0 }
    }
    current.chapters.push(c)
    current.hours += c.hours
  }
  if (current.chapters.length) weeks.push(current)
  return weeks
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d
}
const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export default function StudyPlan({ navigate, params }) {
  const progress = useProgress()
  const [hoursPerWeek, setHoursPerWeek] = useStored(KEYS.hoursPerWeek, 10)
  const [startDate, setStartDate] = useStored(KEYS.startDate, new Date().toISOString().slice(0, 10))
  const [mode, setMode] = useState('parts')
  const focus = params?.chapter

  const weeks = useMemo(() => buildSchedule(Math.max(2, Number(hoursPerWeek) || 10)), [hoursPerWeek])
  const totalHours = CHAPTERS.reduce((s, c) => s + c.hours, 0)
  const doneChapters = CHAPTERS.filter((c) => progress.state(c).status === 'done')
  const doneHours = doneChapters.reduce((s, c) => s + c.hours, 0)
  const pct = Math.round((doneHours / totalHours) * 100)
  const finish = addDays(startDate, weeks.length * 7 - 1)

  useEffect(() => {
    if (!focus) return
    const el = document.getElementById(`ch-${focus}`)
    if (el) { el.open = true; el.scrollIntoView({ block: 'start' }) }
  }, [focus])

  return (
    <section>
      <h1>Study plan</h1>
      <p className="lede">
        Both volumes, split into {CHAPTERS.length} chapters across {PARTS.length} parts. Open a chapter to see its checklist.
        Page numbers open your book.
      </p>

      <div className="panel plan-summary">
        <div>
          <div className="meter big"><span style={{ width: `${pct}%` }} /></div>
          <p className="fine">{doneChapters.length} of {CHAPTERS.length} chapters done, about {doneHours} of {totalHours} study hours ({pct}%).</p>
        </div>
        <div className="plan-settings">
          <label>Hours per week
            <input type="number" min="2" max="60" value={hoursPerWeek} onChange={(e) => setHoursPerWeek(e.target.value)} />
          </label>
          <label>Start date
            <input type="date" value={startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} />
          </label>
          <p className="fine">{weeks.length} weeks, finishing around {finish.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}.</p>
        </div>
      </div>

      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={mode === 'parts'} className={mode === 'parts' ? 'active' : ''} onClick={() => setMode('parts')}>By part</button>
        <button role="tab" aria-selected={mode === 'weeks'} className={mode === 'weeks' ? 'active' : ''} onClick={() => setMode('weeks')}>Week by week</button>
      </div>

      {mode === 'parts' && PARTS.map((part) => {
        const partDone = part.chapters.filter((c) => progress.state(c).status === 'done').length
        return (
          <div key={part.id} className="part">
            <div className="part-head">
              <div>
                <p className="kicker">Volume {part.volume}</p>
                <h2>{part.title}</h2>
                <p className="fine">Milestone: {part.milestone}</p>
              </div>
              <span className="count">{partDone}/{part.chapters.length}</span>
            </div>
            {part.chapters.map((c) => <ChapterRow key={c.id} c={c} progress={progress} navigate={navigate} open={focus === c.id} />)}
          </div>
        )
      })}

      {mode === 'weeks' && weeks.map((week, i) => {
        const weekDone = week.chapters.every((c) => progress.state(c).status === 'done')
        return (
          <div key={i} className={`part ${weekDone ? 'muted-block' : ''}`}>
            <div className="part-head">
              <h2>Week {i + 1} <span className="fine">{fmt(addDays(startDate, i * 7))} to {fmt(addDays(startDate, i * 7 + 6))}</span></h2>
              <span className="count">~{week.hours} h</span>
            </div>
            {week.chapters.map((c) => <ChapterRow key={c.id} c={c} progress={progress} navigate={navigate} />)}
          </div>
        )
      })}
    </section>
  )
}

function ChapterRow({ c, progress, navigate, open }) {
  const st = progress.state(c)
  const items = chapterItems(c)
  const qCount = QUESTIONS.filter((q) => q.chapter === c.id).length
  const tCount = TERMS.filter((t) => t.chapter === c.id).length
  const labs = LABS.filter((l) => l.chapters.includes(c.id))

  return (
    <details className={`chapter ${st.status}`} id={`ch-${c.id}`} open={open}>
      <summary>
        <span className={`led ${st.status}`} aria-hidden="true" />
        <span className="chapter-title"><span className="fine">{chapterLabel(c)}</span> {c.title}</span>
        <span className="chapter-meta">
          <span className={`badge ${c.priority}`}>{PRIORITY_LABEL[c.priority]}</span>
          <span>{st.n}/{st.total}</span>
          <span>~{c.hours} h</span>
        </span>
      </summary>

      <div className="chapter-body">
        <div className="chapter-cols">
          <div>
            {c.summary && <p className="summary">{c.summary}</p>}
            <h3>Checklist</h3>
            <ul className="checklist">
              {items.map((it) => {
                const checked = progress.isChecked(c, it)
                const autoDone = checked && it.auto && !progress.items[`${c.id}|${it.key}`]
                return (
                  <li key={it.key} className={checked ? 'done' : ''}>
                    <label className="check">
                      <input type="checkbox" checked={checked} disabled={autoDone}
                        onChange={(e) => progress.setItem(c, it.key, e.target.checked)} />
                      <span>{it.label}{autoDone && <em className="auto"> (checked automatically)</em>}</span>
                    </label>
                    {it.page && <PageLink volume={c.volume} page={it.page} label={`${chapterLabel(c)}: ${it.label.replace('Read: ', '')}`} />}
                    {it.kind === 'quiz' && <button className="page-link" onClick={() => navigate('quizzes', { filter: `ch:${c.id}` })}>Take quiz ({qCount})</button>}
                    {it.kind === 'cards' && <button className="page-link" onClick={() => navigate('flashcards', { filter: `ch:${c.id}` })}>Open cards ({tCount})</button>}
                    {it.kind === 'lab' && <button className="page-link" onClick={() => navigate('labs', { lab: it.lab })}>Open lab</button>}
                  </li>
                )
              })}
            </ul>
            <div className="row wrap">
              <button className="btn ghost" onClick={() => progress.toggleChapter(c)}>{st.status === 'done' ? 'Mark chapter not done' : 'Mark whole chapter done'}</button>
              <PageLink volume={c.volume} page={c.pages[0]} end={c.pages[1]} label={`${chapterLabel(c)}: ${c.title}`}>Read whole chapter (pp. {c.pages[0]}–{c.pages[1]})</PageLink>
            </div>
          </div>

          <div>
            {c.keyPoints.length > 0 && (<>
              <h3>Key points</h3>
              <ul className="points">{c.keyPoints.map((k) => <li key={k}>{k}</li>)}</ul>
            </>)}
            {c.commands.length > 0 && (<>
              <h3>Commands to know</h3>
              <div className="commands">{c.commands.map((k) => <code key={k}>{k}</code>)}</div>
            </>)}
            {c.objectives.length > 0 && (<>
              <h3>Exam topics</h3>
              <div className="chips">
                {c.objectives.map((id) => <span key={id} className="chip" title={OBJECTIVES.find((o) => o.id === id)?.text}>{id}</span>)}
              </div>
            </>)}
            {labs.length > 0 && <p className="fine">Labs: {labs.map((l) => l.title).join(', ')}</p>}
          </div>
        </div>
      </div>
    </details>
  )
}
