import { PARTS, chapterLabel } from '../data/index.js'

// Dropdown for "all / one part / one chapter". Value format: 'all' | 'part:v1-p3' | 'ch:v1-08'
export default function ChapterFilter({ value, onChange, counts }) {
  return(
  <select className="filter" value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="all">All chapters{counts ? ` (${counts.all ?? 0})` : ''}</option>
    {PARTS.map((part) => (
      <optgroup key={part.id} label={`Volume ${part.volume}: ${part.title}`}>
        <option value={`part:${part.id}`}>
          Whole part: {part.title}{counts ? ` (${counts[`part:${part.id}`] ?? 0})` : ''}
        </option>
        {part.chapters.map((c) => (
          <option key={c.id} value={`ch:${c.id}`} disabled={counts && !counts[`ch:${c.id}`]}>
            {chapterLabel(c)} {c.title}{counts ? ` (${counts[`ch:${c.id}`] ?? 0})` : ''}
          </option>
        ))}
      </optgroup>
    ))}
  </select>
  )
}

// Does an item tagged with chapterId pass the filter?
export function matchesFilter(filter, chapterId) {
  if (filter === 'all') return true
  if (filter.startsWith('ch:')) return filter.slice(3) === chapterId
  if (filter.startsWith('part:')) {
    const part = PARTS.find((p) => p.id === filter.slice(5))
    return !!part && part.chapters.some((c) => c.id === chapterId)
  }
  return true
}

// Count items per filter option so empty chapters can be disabled
export function countByFilter(items) {
  const counts = { all: items.length }
  for (const part of PARTS) {
    for (const c of part.chapters) {
      const n = items.filter((x) => x.chapter === c.id).length
      counts[`ch:${c.id}`] = n
      counts[`part:${part.id}`] = (counts[`part:${part.id}`] ?? 0) + n
    }
  }
  return counts
}
