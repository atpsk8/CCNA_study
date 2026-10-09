import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// A console window for one device. Enter runs, ↑/↓ history, Tab completes, ? shows help.
export default function Terminal({ engine, devId, version, onCommand }) {
  const [value, setValue] = useState('')
  const [hist, setHist] = useState(null)
  const screen = useRef(null)
  const input = useRef(null)
  const lines = engine.transcripts[devId] ?? []
  const prompt = engine.promptFor(devId)
  const masked = engine.isMasked(devId)

  useLayoutEffect(() => {
    if (screen.current) screen.current.scrollTop = screen.current.scrollHeight
  }, [version, devId, lines.length])

  useEffect(() => { input.current?.focus({ preventScroll: true }) }, [devId])

  function run(line) {
    engine.input(devId, line)
    setValue('')
    setHist(null)
    onCommand()
  }

  function onKeyDown(e) {
    const history = engine.history(devId)
    if (e.key === 'Enter') { e.preventDefault(); run(value); return }
    if (e.key === 'Tab') {
      e.preventDefault()
      if (!masked) setValue(engine.complete(devId, value))
      return
    }
    if (e.key === '?' && !masked) {
      e.preventDefault()
      setValue(engine.help(devId, value + '?'))
      onCommand()
      return
    }
    if (e.key === 'ArrowUp' && !masked) {
      e.preventDefault()
      if (!history.length) return
      const i = hist === null ? history.length - 1 : Math.max(0, hist - 1)
      setHist(i)
      setValue(history[i])
      return
    }
    if (e.key === 'ArrowDown' && !masked) {
      e.preventDefault()
      if (hist === null) return
      const i = hist + 1
      if (i >= history.length) { setHist(null); setValue(''); return }
      setHist(i)
      setValue(history[i])
      return
    }
    if ((e.key === 'z' || e.key === 'Z') && e.ctrlKey) { e.preventDefault(); run('end') }
  }

  return (
    <div className="term" onClick={() => { if (!window.getSelection()?.toString()) input.current?.focus({ preventScroll: true }) }}>
      <pre ref={screen} className="term-screen" aria-live="polite">
        {lines.length ? lines.join('\n') : `${devId} console. Press Enter to start. Type ? for help.`}
      </pre>
      <div className="term-input">
        <span className="term-prompt">{prompt}</span>
        <input
          ref={input}
          type={masked ? 'password' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          aria-label={`${devId} command line`}
        />
      </div>
    </div>
  )
}
