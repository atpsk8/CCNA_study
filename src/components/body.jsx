import Home from './sections/Home.jsx'
import StudyPlan from './sections/StudyPlan.jsx'
import Quizzes from './sections/Quizzes.jsx'
import Labs from './sections/Labs.jsx'
import Subnetting from './sections/Subnetting.jsx'
import Flashcards from './sections/Flashcards.jsx'
import Glossary from './sections/Glossary.jsx'
import ExamCriteria from './sections/ExamCriteria.jsx'

// Picks which section to show based on the selected header button
const VIEWS = {
  home: Home,
  plan: StudyPlan,
  quizzes: Quizzes,
  labs: Labs,
  subnetting: Subnetting,
  flashcards: Flashcards,
  glossary: Glossary,
  criteria: ExamCriteria,
}

export default function Body({ active, params, navigate }) {
  const View = VIEWS[active] ?? Home

  return(
  <main className="content">
    {/* key resets the section's state when the filter passed in changes */}
    <View key={active + JSON.stringify(params)} params={params} navigate={navigate} />
  </main>
  )
}
