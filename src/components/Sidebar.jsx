import { CHAPTERS } from '../data/index.js'
import { useProgress } from '../progress.js'
import { useBook } from '../book/BookProvider.jsx'
import { useStored, KEYS } from '../hooks/useStored.js'

export default function Sidebar({ sections, active, onSelect }) {
  const progress = useProgress()
  const book = useBook()
  const [theme, setTheme] = useStored(KEYS.theme, 'system')
  const done = CHAPTERS.filter((c) => progress.state(c).status === 'done').length

  return (
    <header className="side">
      <button className="brand" onClick={() => onSelect('home')}>
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <span className="brand-name">CCNA Study</span>
      </button>

      <nav className="side-nav" aria-label="Sections">
        {sections.map((s) => (
          <button key={s.id} className={active === s.id ? 'active' : ''} aria-current={active === s.id ? 'page' : undefined} onClick={() => onSelect(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>

      <div className="side-foot">
        <div className="side-progress" title={`${done} of ${CHAPTERS.length} chapters done`}>
          <span>{done} of {CHAPTERS.length} chapters</span>
          <div className="side-meter"><span style={{ width: `${(done / CHAPTERS.length) * 100}%` }} /></div>
        </div>
        <button className={`book-btn ${book.connected ? 'on' : ''}`} onClick={() => book.setSetupOpen(true)}>
          <span className="dot" aria-hidden="true" />
          {book.connected ? 'Book connected' : 'Connect your book'}
        </button>
        <div className="theme-switch" role="group" aria-label="Theme">
          {[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']].map(([k, label]) => (
            <button key={k} className={theme === k ? 'active' : ''} aria-pressed={theme === k} onClick={() => setTheme(k)}>{label}</button>
          ))}
        </div>
      </div>
    </header>
  )
}
