import { LABS, chapterById, chapterLabel } from '../../data/index.js'
import { useStored, KEYS } from '../../hooks/useStored.js'
import LabRunner from '../lab/LabRunner.jsx'

export default function Labs({ params, navigate }) {
  const [labs] = useStored(KEYS.labs, {})
  const open = params?.lab && LABS.find((l) => l.id === params.lab)

  if (open) return <LabRunner key={open.id} lab={open} onBack={() => navigate('labs')} navigate={navigate} />

  return (
    <section>
      <h1>Labs</h1>
      <p className="lede">
        Every lab runs right here in a simulated Cisco command line, with nothing to install. Tasks check themselves off
        as you configure, and your progress is saved in this browser.
      </p>
      <div className="lab-cards">
        {LABS.map((lab) => {
          const st = labs[lab.id] ?? {}
          const n = lab.tasks.filter((t) => st.tasks?.[t.id] || st.manual?.[t.id]).length
          const pct = Math.round((n / lab.tasks.length) * 100)
          return (
            <article key={lab.id} className="panel lab-card">
              <div className="lab-card-top">
                <span className="tag">{lab.level}</span>
                <span className="fine">{lab.minutes} min, {lab.devices.length} devices</span>
              </div>
              <h2>{lab.title}</h2>
              <p>{lab.scenario}</p>
              <p className="chapters">
                {lab.chapters.map((id) => { const c = chapterById(id); return c && <span key={id} className="tag subtle" title={c.title}>{chapterLabel(c)}</span> })}
              </p>
              <div className="lab-card-foot">
                <div className="meter" aria-label={`${n} of ${lab.tasks.length} tasks done`}><span style={{ width: `${pct}%` }} /></div>
                <button className="btn" onClick={() => navigate('labs', { lab: lab.id })}>{n === 0 ? 'Start lab' : n === lab.tasks.length ? 'Review lab' : 'Continue'}</button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
