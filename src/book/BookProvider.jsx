import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useStored, KEYS } from '../hooks/useStored.js'

// The reader's own copy of the book stays in this browser (IndexedDB). It is never uploaded.
// Printed page numbers are converted to PDF page numbers with a per-volume offset.

const DB = 'ccna-book'
const STORE = 'files'

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function idbGet(key) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key)
    r.onsuccess = () => resolve(r.result ?? null)
    r.onerror = () => reject(r.error)
  })
}
async function idbPut(key, value) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
async function idbClear() {
  const db = await idb()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
  })
}

// Offsets: PDF page = printed page + offset
export const PRESETS = {
  library: { label: 'Official Cert Guide Library (one PDF with both volumes)', offsets: { 1: 57, 2: 1139 } },
  separate: { label: 'Two separate PDFs, one per volume', offsets: { 1: 54, 2: 50 } },
}

const BookContext = createContext(null)

export function BookProvider({ children }) {
  const [settings, setSettings] = useStored(KEYS.book, null)
  const [urls, setUrls] = useState({})
  const [reader, setReader] = useState(null) // { volume, page, label, nonce }
  const [setupOpen, setSetupOpen] = useState(false)
  const pending = useRef(null)
  const [error, setError] = useState(null)

  // Load stored files once
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const out = {}
        for (const k of ['library', 'vol1', 'vol2']) {
          const f = await idbGet(k)
          if (f) out[k] = URL.createObjectURL(f)
        }
        if (alive) setUrls(out)
      } catch {
        if (alive) setError('This browser blocked local storage, so your book can only stay connected until you close the tab.')
      }
    })()
    return () => { alive = false }
  }, [])

  const connected = settings && (settings.mode === 'library' ? !!urls.library : !!(urls.vol1 || urls.vol2))

  const urlFor = useCallback((volume) => {
    if (!settings) return null
    return settings.mode === 'library' ? urls.library : urls[`vol${volume}`]
  }, [settings, urls])

  const pdfPage = useCallback((volume, printed) => printed + (settings?.offsets?.[volume] ?? 0), [settings])

  const openAt = useCallback((volume, page, label) => {
    const target = { volume, page, label, nonce: Date.now() }
    if (!connected || !urlFor(volume)) {
      pending.current = target
      setSetupOpen(true)
      return
    }
    setReader(target)
  }, [connected, urlFor])

  const connect = useCallback(async (mode, files) => {
    const next = {}
    try {
      await idbClear()
      for (const [k, f] of Object.entries(files)) if (f) { await idbPut(k, f); next[k] = URL.createObjectURL(f) }
    } catch {
      for (const [k, f] of Object.entries(files)) if (f) next[k] = URL.createObjectURL(f)
      setError('This browser blocked local storage, so your book will stay connected only until you close the tab.')
    }
    setUrls(next)
    setSettings({ mode, offsets: { ...PRESETS[mode].offsets } })
    setSetupOpen(false)
    // Open what the reader was trying to see, or chapter 1 so they can confirm the page lines up
    const target = pending.current ?? { volume: 1, page: 16, label: 'Check: this should be Chapter 1, page 16', nonce: Date.now() }
    pending.current = null
    setReader({ ...target, calibrate: true })
  }, [setSettings])

  const disconnect = useCallback(async () => {
    try { await idbClear() } catch { /* ignore */ }
    setUrls({})
    setSettings(null)
    setReader(null)
  }, [setSettings])

  // The user says "this PDF page actually shows printed page N"
  const calibrate = useCallback((volume, shownPrinted, requestedPrinted) => {
    if (!settings) return
    const delta = requestedPrinted - shownPrinted
    setSettings({ ...settings, offsets: { ...settings.offsets, [volume]: (settings.offsets[volume] ?? 0) + delta } })
    setReader((r) => r && { ...r, nonce: Date.now() })
  }, [settings, setSettings])

  const value = useMemo(() => ({
    settings, connected, urlFor, pdfPage, openAt, connect, disconnect, calibrate, reader, setReader,
    setupOpen, setSetupOpen, error, hasVolume: (v) => !!urlFor(v),
  }), [settings, connected, urlFor, pdfPage, openAt, connect, disconnect, calibrate, reader, setupOpen, error])

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>
}

export const useBook = () => useContext(BookContext)
