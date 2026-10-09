import { useEffect, useState } from 'react'
import { useBook, PRESETS } from './BookProvider.jsx'
import { BOOK } from '../data/index.js'

// Side panel that shows the reader's PDF at the requested printed page
export function BookReader() {
  const book = useBook()
  const r = book.reader
  const [shown, setShown] = useState('')
  const [page, setPage] = useState(r?.page ?? 1)
  const [fixing, setFixing] = useState(false)

  useEffect(() => { if (r) { setPage(r.page); setShown(''); setFixing(!!r.calibrate) } }, [r])
  useEffect(() => {
    if (!r) return undefined
    const onKey = (e) => { if (e.key === 'Escape') book.setReader(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [r, book])

  if (!r) return null
  const url = book.urlFor(r.volume)
  const pdf = book.pdfPage(r.volume, page)
  const src = url ? `${url}#page=${pdf}` : null

  return (
    <aside className="reader" aria-label="Book reader">
      <div className="reader-bar">
        <div className="reader-title">
          <strong>Volume {r.volume}, page {page}</strong>
          {r.label && <span>{r.label}</span>}
        </div>
        <div className="reader-actions">
          <button className="btn ghost" onClick={() => setPage(Math.max(1, page - 1))} aria-label="Previous page">‹</button>
          <button className="btn ghost" onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
          {src && <a className="btn ghost" href={src} target="_blank" rel="noreferrer">New tab</a>}
          <button className="btn ghost" onClick={() => setFixing(!fixing)}>Wrong page?</button>
          <button className="btn ghost" onClick={() => book.setReader(null)} aria-label="Close reader">Close</button>
        </div>
      </div>
      {fixing && (
        <form className="reader-fix" onSubmit={(e) => { e.preventDefault(); const n = Number(shown); if (n > 0) { book.calibrate(r.volume, n, page); setFixing(false) } }}>
          <label>
            {r.calibrate ? 'Check the page number printed on the page that opened. ' : ''}Which printed page number do you see?
            <input type="number" min="1" value={shown} onChange={(e) => setShown(e.target.value)} placeholder={String(page)} />
          </label>
          <button className="btn" type="submit" disabled={!shown}>Fix page numbers</button>
          <button className="btn ghost" type="button" onClick={() => setFixing(false)}>It&apos;s right</button>
        </form>
      )}
      {src ? <iframe key={`${src}|${r.nonce}`} title="Book" src={src} /> : <p className="reader-empty">This volume isn&apos;t connected yet.</p>}
    </aside>
  )
}

// Dialog to connect the reader's own PDF
export function BookSetup() {
  const book = useBook()
  const [mode, setMode] = useState(book.settings?.mode ?? 'library')
  const [files, setFiles] = useState({})
  if (!book.setupOpen) return null
  const ready = mode === 'library' ? !!files.library : !!(files.vol1 || files.vol2)

  return (
    <div className="dialog-backdrop" onClick={() => book.setSetupOpen(false)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="book-setup-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="book-setup-title">Connect your book</h2>
        <p>
          Pick your PDF of <em>{BOOK.title}</em> and every page reference on this site will open it at the right page.
          The file stays in this browser. It is never uploaded anywhere.
        </p>
        <fieldset>
          <legend>Which PDF do you have?</legend>
          {Object.entries(PRESETS).map(([k, p]) => (
            <label key={k} className="radio">
              <input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} />
              {p.label}
            </label>
          ))}
        </fieldset>
        {mode === 'library' ? (
          <label className="file">
            Library PDF
            <input type="file" accept="application/pdf" onChange={(e) => setFiles({ library: e.target.files[0] })} />
          </label>
        ) : (
          <>
            <label className="file">Volume 1 PDF<input type="file" accept="application/pdf" onChange={(e) => setFiles({ ...files, vol1: e.target.files[0] })} /></label>
            <label className="file">Volume 2 PDF<input type="file" accept="application/pdf" onChange={(e) => setFiles({ ...files, vol2: e.target.files[0] })} /></label>
          </>
        )}
        <p className="fine">After connecting, the reader opens Chapter 1. If the page number doesn&apos;t match, use “Wrong page?” once and every link lines up.</p>
        <div className="dialog-actions">
          {book.connected && <button className="btn ghost danger" onClick={() => { book.disconnect(); book.setSetupOpen(false) }}>Disconnect book</button>}
          <span className="spacer" />
          <button className="btn ghost" onClick={() => book.setSetupOpen(false)}>Cancel</button>
          <button className="btn" disabled={!ready} onClick={() => book.connect(mode, mode === 'library' ? { library: files.library } : { vol1: files.vol1, vol2: files.vol2 })}>Connect book</button>
        </div>
      </div>
    </div>
  )
}

// Small "Read p. 191" button used across the site
export function PageLink({ volume, page, end, label, children }) {
  const book = useBook()
  return (
    <button className="page-link" onClick={() => book.openAt(volume, page, label)} title={book.connected ? `Open Volume ${volume} at page ${page}` : 'Connect your book to open it here'}>
      {children ?? (end ? `pp. ${page}–${end}` : `p. ${page}`)}
    </button>
  )
}
