// Chapter checklists: what "done" means for each chapter, and how far along it is.
import { useMemo } from 'react'
import { QUESTIONS, TERMS, LABS } from './data/index.js'
import { useStored, KEYS } from './hooks/useStored.js'

// Checklist items for a chapter: every book section, flashcards, quiz, linked labs
export function chapterItems(c) {
  const items = c.sections.map((s, i) => ({ key: `s:${i}`, kind: 'section', label: s.title === 'Chapter Review' ? 'Work through the chapter review' : `Read: ${s.title}`, page: s.page, volume: c.volume }))
  if (TERMS.some((t) => t.chapter === c.id)) items.push({ key: 'cards', kind: 'cards', label: 'Drill this chapter\'s flashcards' })
  if (QUESTIONS.some((q) => q.chapter === c.id)) items.push({ key: 'quiz', kind: 'quiz', label: 'Score 85% or better on the chapter quiz', auto: true })
  for (const l of LABS.filter((x) => x.chapters.includes(c.id))) items.push({ key: `lab:${l.id}`, kind: 'lab', label: `Finish the lab: ${l.title}`, lab: l.id, auto: true })
  return items
}

// Has the user mastered the chapter quiz? (every question answered, 85%+ right on last try)
export function quizMastered(chapterId, stats) {
  const qs = QUESTIONS.filter((q) => q.chapter === chapterId)
  if (!qs.length) return false
  if (!qs.every((q) => stats[q.id])) return false
  const right = qs.filter((q) => stats[q.id].last === 'right').length
  return right / qs.length >= 0.85
}

export function labComplete(labId, labs) {
  const lab = LABS.find((l) => l.id === labId)
  const st = labs[labId]
  if (!lab || !st) return false
  return lab.tasks.every((t) => st.tasks?.[t.id] || st.manual?.[t.id])
}

export function useProgress() {
  const [done, setDone] = useStored(KEYS.done, {})
  const [items, setItems] = useStored(KEYS.items, {})
  const [stats] = useStored(KEYS.quizStats, {})
  const [labs] = useStored(KEYS.labs, {})

  return useMemo(() => {
    const isChecked = (c, item) => {
      if (items[`${c.id}|${item.key}`]) return true
      if (item.kind === 'quiz') return quizMastered(c.id, stats)
      if (item.kind === 'lab') return labComplete(item.lab, labs)
      return false
    }
    const state = (c) => {
      const list = chapterItems(c)
      const n = list.filter((it) => isChecked(c, it)).length
      if (done[c.id] || (list.length && n === list.length)) return { status: 'done', n: list.length, total: list.length }
      return { status: n ? 'partial' : 'none', n, total: list.length }
    }
    const setItem = (c, key, value) => setItems({ ...items, [`${c.id}|${key}`]: value })
    const toggleChapter = (c) => {
      const isDone = state(c).status === 'done'
      const next = { ...items }
      for (const it of chapterItems(c)) next[`${c.id}|${it.key}`] = !isDone
      setItems(next)
      setDone({ ...done, [c.id]: !isDone })
    }
    return { done, items, stats, labs, isChecked, state, setItem, toggleChapter }
  }, [done, items, stats, labs, setDone, setItems])
}
