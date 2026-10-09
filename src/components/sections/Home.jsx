import { CHAPTERS, PARTS, QUESTIONS, TERMS, LABS, chapterLabel } from '../../data/index.js'
import { useProgress, chapterItems } from '../../progress.js'
import { useBook } from '../../book/BookProvider.jsx'
import { PageLink } from '../../book/BookPanels.jsx'

// One "line card" per volume: ports numbered like a Cisco switch, odd on top and even below
function Module({ volume, chapters, progress, onOpen }) {
  const cols = Math.ceil(chapters.length / 2)
  return (
    <div className="module">
      <div className="module-label">Volume {volume}</div>
      <div className="ports" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {chapters.map((c, i) => {
          const st = progress.state(c)
          const row = i % 2 === 0 ? 1 : 2
          const col = Math.floor(i / 2) + 1
          return (
            <button key={c.id} className={`port ${st.status}`} style={{ gridRow: row, gridColumn: col }}
              onClick={() => onOpen(c)} title={`${chapterLabel(c)}: ${c.title} (${st.n}/${st.total} done)`}
              aria-label={`Chapter ${c.number}, ${c.title}, ${st.status === 'done' ? 'done' : st.status === 'partial' ? 'in progress' : 'not started'}`}>
              <span className="led" />
              <span className="jack"><span className="num">{c.number}</span></span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function Home({ navigate }) {
  const progress = useProgress()
  const book = useBook()
  const vol1 = CHAPTERS.filter((c) => c.volume === 1)
  const vol2 = CHAPTERS.filter((c) => c.volume === 2)
  const done = CHAPTERS.filter((c) => progress.state(c).status === 'done').length
  const next = CHAPTERS.find((c) => progress.state(c).status === 'partial') ?? CHAPTERS.find((c) => progress.state(c).status === 'none')
  const nextItems = next ? chapterItems(next) : []
  const nextOpen = next ? nextItems.filter((it) => !progress.isChecked(next, it)).slice(0, 4) : []
  const missed = Object.values(progress.stats).filter((s) => s.last === 'wrong').length
  const allDone = done === CHAPTERS.length
  const open = (c) => navigate('plan', { chapter: c.id })

  return (
    <section className="home">
      <div className="faceplate" role="group" aria-label="Chapter progress">
        <div className="faceplate-top">
          <span className="model">CCNA 200-301</span>
          <span className="sys"><span className={`led ${allDone ? 'done' : done ? 'partial' : 'none'}`} />SYST</span>
          <span className="sys"><span className="led done" />STAT</span>
          <span className="count">{done}/{CHAPTERS.length} up</span>
        </div>
        <div className="modules">
          <Module volume={1} chapters={vol1} progress={progress} onOpen={open} />
          <Module volume={2} chapters={vol2} progress={progress} onOpen={open} />
        </div>
      </div>
      <p className="faceplate-key">Each port is a chapter. Amber means started, green means done. Click a port to open that chapter.</p>

      <div className="home-grid">
        {next && (
          <div className="panel next">
            <p className="kicker">{progress.state(next).status === 'partial' ? 'Pick up where you left off' : 'Up next'}</p>
            <h2>{chapterLabel(next)}: {next.title}</h2>
            <p>{next.summary}</p>
            <ul className="next-items">
              {nextOpen.map((it) => (
                <li key={it.key}>
                  <span>{it.label}</span>
                  {it.page && <PageLink volume={next.volume} page={it.page} label={`${chapterLabel(next)}: ${it.label.replace('Read: ', '')}`} />}
                </li>
              ))}
            </ul>
            <div className="row wrap">
              <button className="btn" onClick={() => open(next)}>Open chapter</button>
              <PageLink volume={next.volume} page={next.pages[0]} end={next.pages[1]} label={`${chapterLabel(next)}: ${next.title}`}>Read in book</PageLink>
              <button className="btn ghost" onClick={() => navigate('quizzes', { filter: `ch:${next.id}` })}>Quiz this chapter</button>
            </div>
          </div>
        )}

        <div className="panel stats">
          <dl>
            <div><dt>Chapters done</dt><dd>{done}<small>/{CHAPTERS.length}</small></dd></div>
            <div><dt>Labs finished</dt><dd>{LABS.filter((l) => l.tasks.every((t) => progress.labs[l.id]?.tasks?.[t.id] || progress.labs[l.id]?.manual?.[t.id])).length}<small>/{LABS.length}</small></dd></div>
            <div><dt>Questions to review</dt><dd>{missed}</dd></div>
          </dl>
          {missed > 0 && <button className="btn ghost" onClick={() => navigate('quizzes', { missed: true })}>Review missed questions</button>}
        </div>

        {!book.connected && (
          <div className="panel book-cta">
            <h2>Open the book from here</h2>
            <p>Connect your PDF of the Official Cert Guide once and every page number on this site opens it at that page. The file stays on your device.</p>
            <button className="btn" onClick={() => book.setSetupOpen(true)}>Connect your book</button>
          </div>
        )}

        <div className="panel how">
          <h2>How each chapter works</h2>
          <ol>
            <li>Read each section of the chapter. The Read buttons open your book at the right page.</li>
            <li>Check off sections as you finish them.</li>
            <li>Drill the chapter&apos;s flashcards.</li>
            <li>Take the quiz until you score 85% or better. This checks itself off.</li>
            <li>Build the linked lab right in the browser. This checks itself off too.</li>
          </ol>
          <p className="fine">{PARTS.length} parts, {QUESTIONS.length} questions, {TERMS.length} flashcards, {LABS.length} labs. Progress is saved in this browser.</p>
        </div>
      </div>
    </section>
  )
}
