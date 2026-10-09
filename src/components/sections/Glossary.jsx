import { useState } from 'react'
import { TERMS, chapterById, chapterLabel } from '../../data/index.js'

// Terms live in src/data/glossary.js (also used by Flashcards)
export { TERMS }

export default function Glossary() {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const shown = TERMS.filter((t) => !q || t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q))

  return(
  <section>
    <h1>Glossary</h1>
    <div className="row wrap toolbar">
      <input className="search" type="search" placeholder={`Search ${TERMS.length} terms…`}
        value={search} onChange={(e) => setSearch(e.target.value)} />
      <span className="muted">{shown.length} shown</span>
    </div>
    <dl className="card glossary">
      {shown.map((t) => {
        const c = chapterById(t.chapter)
        return (
          <div key={t.term}>
            <dt>{t.term} {c && <span className="muted small">{chapterLabel(c)}</span>}</dt>
            <dd>{t.definition}</dd>
          </div>
        )
      })}
      {shown.length === 0 && <p>No matches.</p>}
    </dl>
  </section>
  )
}
