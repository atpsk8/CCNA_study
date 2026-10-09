import { useMemo, useState } from 'react'
import { TERMS, chapterById, chapterLabel } from '../../data/index.js'
import ChapterFilter, { matchesFilter, countByFilter } from '../ChapterFilter.jsx'

// Uses the glossary terms, so adding a term there adds a flashcard here
export default function Flashcards({ params }) {
  const [filter, setFilter] = useState(params?.filter ?? 'all')
  const [shuffled, setShuffled] = useState(false)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const counts = useMemo(() => countByFilter(TERMS), [])
  const cards = useMemo(() => {
    const list = TERMS.filter((t) => matchesFilter(filter, t.chapter))
    return shuffled ? [...list].sort(() => Math.random() - 0.5) : list
  }, [filter, shuffled])

  const card = cards[index]
  const chapter = card && chapterById(card.chapter)

  function go(step) {
    setFlipped(false)
    setIndex((index + step + cards.length) % cards.length)
  }

  function change(fn) {
    fn()
    setIndex(0)
    setFlipped(false)
  }

  return(
  <section>
    <h1>Flashcards</h1>
    <p className="lede">Click the card to flip it. Filter by chapter to drill what you just read.</p>
    <div className="row wrap toolbar">
      <ChapterFilter value={filter} counts={counts} onChange={(v) => change(() => setFilter(v))} />
      <label className="check">
        <input type="checkbox" checked={shuffled} onChange={(e) => change(() => setShuffled(e.target.checked))} />
        Shuffle
      </label>
    </div>
    {card ? (<>
      <div className="card flashcard" onClick={() => setFlipped(!flipped)}>
        {flipped ? (
          <div>
            <p>{card.definition}</p>
            {chapter && <p className="muted small">{chapterLabel(chapter)}: {chapter.title}</p>}
          </div>
        ) : <strong>{card.term}</strong>}
      </div>
      <div className="row">
        <button onClick={() => go(-1)}>Previous</button>
        <span>{index + 1} / {cards.length}</span>
        <button onClick={() => go(1)}>Next</button>
      </div>
    </>) : <div className="card">No cards for this selection.</div>}
  </section>
  )
}
