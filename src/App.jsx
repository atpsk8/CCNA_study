import { useEffect, useState } from 'react'
import './App.css'
import Sidebar from './components/Sidebar.jsx'
import Body from './components/body.jsx'
import { BookProvider } from './book/BookProvider.jsx'
import { BookReader, BookSetup } from './book/BookPanels.jsx'
import { BOOK } from './data/index.js'
import { useStored, KEYS } from './hooks/useStored.js'

export const SECTIONS = [
  { id: 'home', label: 'Today' },
  { id: 'plan', label: 'Study plan' },
  { id: 'labs', label: 'Labs' },
  { id: 'quizzes', label: 'Quizzes' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'subnetting', label: 'Subnetting' },
  { id: 'glossary', label: 'Glossary' },
  { id: 'criteria', label: 'Exam topics' },
]

export default function App() {
  // view = which section; params = optional context passed along (e.g. { chapter: 'v1-08' })
  const [route, setRoute] = useState({ view: 'home', params: {} })
  const [theme] = useStored(KEYS.theme, 'system')

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  function navigate(view, params = {}) {
    setRoute({ view, params })
    window.scrollTo({ top: 0 })
  }

  return (
    <BookProvider>
      <div className={`shell ${route.view === 'labs' && route.params.lab ? 'wide' : ''}`}>
        <Sidebar sections={SECTIONS} active={route.view} onSelect={(id) => navigate(id)} />
        <div className="main-col">
          <Body active={route.view} params={route.params} navigate={navigate} />
          <footer className="foot">
            Page references follow <em>{BOOK.title}</em> by {BOOK.author}. Notes, questions, labs and definitions on this
            site are original. Not affiliated with Cisco or Pearson.
          </footer>
        </div>
        <BookReader />
        <BookSetup />
      </div>
    </BookProvider>
  )
}
