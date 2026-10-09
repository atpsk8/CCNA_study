import { useCallback, useSyncExternalStore } from 'react'

// A tiny shared store backed by localStorage. Every component using the same key sees the
// same value and re-renders when it changes. Storage can be unavailable (private windows,
// blocked site data), so reads and writes are wrapped and the app keeps working in memory.

const cache = new Map()
const listeners = new Map()

function read(key, initial) {
  if (cache.has(key)) return cache.get(key)
  let value = initial
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) value = JSON.parse(raw)
  } catch {
    // ignore
  }
  cache.set(key, value)
  return value
}

export function writeStored(key, value) {
  cache.set(key, value)
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore: progress just won't persist
  }
  for (const fn of listeners.get(key) ?? []) fn()
}

export function readStored(key, initial) {
  return read(key, initial)
}

export function useStored(key, initial) {
  const subscribe = useCallback((fn) => {
    if (!listeners.has(key)) listeners.set(key, new Set())
    listeners.get(key).add(fn)
    return () => listeners.get(key).delete(fn)
  }, [key])
  const value = useSyncExternalStore(subscribe, () => read(key, initial), () => initial)
  const set = useCallback((next) => {
    const cur = read(key, initial)
    writeStored(key, typeof next === 'function' ? next(cur) : next)
  }, [key, initial])
  return [value, set]
}

// Keys used across the site, in one place
export const KEYS = {
  done: 'ccna.done', // { [chapterId]: true } chapters marked done by hand
  items: 'ccna.items', // { "v1-08|s:0": true } individual checklist items
  hoursPerWeek: 'ccna.hoursPerWeek',
  startDate: 'ccna.startDate',
  quizStats: 'ccna.quizStats', // { [questionId]: { right, wrong, last } }
  labs: 'ccna.labs', // { [labId]: { tasks: { t1: true }, manual: { t2: true } } }
  theme: 'ccna.theme', // 'light' | 'dark' | 'system'
  book: 'ccna.book', // { mode: 'library' | 'separate', offsets: { 1: 57, 2: 1139 } }
}
