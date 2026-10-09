import { DOMAINS, OBJECTIVES, CHAPTERS, domainOf, chapterById, chapterLabel } from '../../data/index.js'
import { useProgress } from '../../progress.js'

// CCNA 200-301 v1.1 domains, every exam topic, and where the book covers it
export default function ExamCriteria({ navigate }) {
  const progress = useProgress()
  const done = Object.fromEntries(CHAPTERS.map((c) => [c.id, progress.state(c).status === 'done']))

  return(
  <section>
    <h1>Exam topics</h1>
    <p className="lede">
      CCNA 200-301 v1.1 blueprint. A topic shows as covered once every chapter that teaches it is checked off in your
      Study Plan. Check <a href="https://www.cisco.com/go/certifications" target="_blank" rel="noreferrer">Cisco&apos;s site</a> for the latest version.
    </p>
    {DOMAINS.map((d) => {
      const objs = OBJECTIVES.filter((o) => domainOf(o.id) === d.id)
      const top = objs.filter((o) => o.id.split('.').length === 2)
      const covered = top.filter((o) => o.chapters.every((c) => done[c])).length
      return (
        <details key={d.id} className="card domain-block">
          <summary className="domain">
            <span>{d.id}.0 {d.name} <span className="muted small">{covered}/{top.length} topics covered</span></span>
            <strong>{d.weight}%</strong>
          </summary>
          <ul className="objectives">
            {objs.map((o) => {
              const sub = o.id.split('.').length > 2
              const isCovered = o.chapters.every((c) => done[c])
              return (
                <li key={o.id} className={`${sub ? 'sub' : ''} ${isCovered ? 'covered' : ''}`}>
                  <span><strong>{o.id}</strong> {o.text}</span>
                  <span className="chips">
                    {o.chapters.map((id) => {
                      const c = chapterById(id)
                      return c && (
                        <button key={id} className={`chip ${done[id] ? 'chip-done' : ''}`} title={c.title}
                          onClick={() => navigate('quizzes', { filter: `ch:${id}` })}>
                          {chapterLabel(c)}
                        </button>
                      )
                    })}
                  </span>
                </li>
              )
            })}
          </ul>
        </details>
      )
    })}
    <p className="muted small">Tip: click a chapter chip to quiz on it.</p>
  </section>
  )
}
