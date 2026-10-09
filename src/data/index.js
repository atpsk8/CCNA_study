// One import point for all study data
import { QUESTIONS_V1 } from './questions-v1.js'
import { QUESTIONS_V2 } from './questions-v2.js'

export { PARTS, CHAPTERS, chapterById, chapterLabel } from './curriculum.js'
export { DOMAINS, OBJECTIVES, domainOf } from './objectives.js'
export { TERMS } from './glossary.js'
export { LABS } from './labs.js'

export const QUESTIONS = [...QUESTIONS_V1, ...QUESTIONS_V2]

export const BOOK = {
  title: 'CCNA 200-301 Official Cert Guide Library, 2nd Edition',
  author: 'Wendell Odom',
}
