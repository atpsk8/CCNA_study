import { useMemo, useState } from 'react'
import { QUESTIONS, chapterById, chapterLabel } from '../../data/index.js'
import { useStored, KEYS } from '../../hooks/useStored.js'
import ChapterFilter, { matchesFilter, countByFilter } from '../ChapterFilter.jsx'
import { PageLink } from '../../book/BookPanels.jsx'

function shuffle(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function Quizzes({ params }) {
  const [filter, setFilter] = useState(params?.filter ?? 'all')
  const [missedOnly, setMissedOnly] = useState(!!params?.missed)
  const [stats, setStats] = useStored(KEYS.quizStats, {})
  const [seed, setSeed] = useState(0) // bump to reshuffle
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState(null)
  const [score, setScore] = useState({ right: 0, answered: 0 })

  const counts = useMemo(() => countByFilter(QUESTIONS), [])

  // Questions for this run: filtered, optionally only ones missed last time, shuffled
  const deck = useMemo(() => {
    const list = QUESTIONS.filter((q) => matchesFilter(filter, q.chapter))
      .filter((q) => !missedOnly || (stats[q.id]?.last === 'wrong'))
    return shuffle(list)
    // stats intentionally left out so answering doesn't reshuffle mid-run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, missedOnly, seed])

  function restart(changes = {}) {
    if ('filter' in changes) setFilter(changes.filter)
    if ('missedOnly' in changes) setMissedOnly(changes.missedOnly)
    setSeed((s) => s + 1)
    setIndex(0)
    setPicked(null)
    setScore({ right: 0, answered: 0 })
  }

  function answer(i) {
    const q = deck[index]
    const correct = i === q.answer
    setPicked(i)
    setScore((s) => ({ right: s.right + (correct ? 1 : 0), answered: s.answered + 1 }))
    const prev = stats[q.id] ?? { right: 0, wrong: 0 }
    setStats({
      ...stats,
      [q.id]: {
        right: prev.right + (correct ? 1 : 0),
        wrong: prev.wrong + (correct ? 0 : 1),
        last: correct ? 'right' : 'wrong',
      },
    })
  }

  function next() {
    setPicked(null)
    setIndex(index + 1)
  }

  const missedCount = Object.values(stats).filter((s) => s.last === 'wrong').length
  const finished = deck.length > 0 && index >= deck.length
  const q = deck[index]
  const chapter = q && chapterById(q.chapter)

  return(
  <section>
    <h1>Quizzes</h1>
    <p className="lede">{QUESTIONS.length} original questions mapped to book chapters. Pick a part or chapter, or quiz on everything. Getting 85% on a chapter checks its quiz off in your study plan.</p>

    <div className="row wrap toolbar">
      <ChapterFilter value={filter} counts={counts} onChange={(v) => restart({ filter: v })} />
      <label className="check">
        <input type="checkbox" checked={missedOnly} onChange={(e) => restart({ missedOnly: e.target.checked })} />
        Only questions I missed last time ({missedCount})
      </label>
      <button onClick={() => restart()}>Shuffle / restart</button>
    </div>

    {deck.length === 0 && (
      <div className="card"><p>No questions match. {missedOnly ? 'Nothing missed here. Nice work!' : ''}</p></div>
    )}

    {finished && (
      <div className="card">
        <h3>Done: {score.right} / {score.answered} ({Math.round((score.right / Math.max(1, score.answered)) * 100)}%)</h3>
        <p className="muted">Aim for 85% or higher before checking a chapter off in the Study Plan.</p>
        <div className="row wrap">
          <button onClick={() => restart()}>Go again</button>
          {missedCount > 0 && <button onClick={() => restart({ missedOnly: true })}>Review missed questions</button>}
        </div>
      </div>
    )}

    {q && !finished && (
      <div className="card">
        <p className="muted">
          Question {index + 1} of {deck.length}, score {score.right}/{score.answered}
          {chapter && <>, from {chapterLabel(chapter)}: {chapter.title}</>}
        </p>
        <h3 className="question">{q.question}</h3>
        <div className="options">
          {q.options.map((option, i) => {
            let state = ''
            if (picked !== null && i === q.answer) state = 'correct'
            else if (picked === i) state = 'wrong'
            return (
              <button key={i} className={state} disabled={picked !== null} onClick={() => answer(i)}>
                {option}
              </button>
            )
          })}
        </div>
        {picked !== null && (
          <div className="feedback">
            <p><strong>{picked === q.answer ? 'Correct!' : 'Not quite.'}</strong> {q.explanation}</p>
            {chapter && (
              <p className="muted">Review it in the book: <PageLink volume={chapter.volume} page={chapter.pages[0]} end={chapter.pages[1]} label={`${chapterLabel(chapter)}: ${chapter.title}`} /></p>
            )}
            <button onClick={next}>{index + 1 < deck.length ? 'Next question' : 'See results'}</button>
          </div>
        )}
      </div>
    )}
  </section>
  )
}
