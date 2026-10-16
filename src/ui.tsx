import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useGlide } from './glide'

/** A section: its name is the only bold type, its rows ruled by hairlines; it rises in when it appears. */
export function Panel({ title, actions, children }: { title: string; children?: ReactNode; /** Buttons on the title's own line, for a panel that is only a few actions. */ actions?: ReactNode }) {
  const id = useId()
  return (
    <section className={`m-panel m-arrive${actions ? ' has-actions' : ''}`} aria-labelledby={id}>
      {actions ? (
        <div className="m-panel-head">
          <h2 id={id} className="m-panel-title">{title}</h2>
          <span className="m-actions">{actions}</span>
        </div>
      ) : <h2 id={id} className="m-panel-title">{title}</h2>}
      {children}
    </section>
  )
}

/** Label left, control on the shared right edge, a hairline above. */
export function Row({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div className="m-row">
      <span className="m-row-label">{label}{value ? <span className="m-row-value">{value}</span> : null}</span>
      <span className="m-row-control">{children}</span>
    </div>
  )
}

/** One pill; the current option filled, the fill gliding to a new choice. */
export function Segmented<T extends string | number>({ label, options, value, onChange, disabled = false }: {
  label: string
  /** color: a dot before the label (a DPI stage's LED colour). */
  options: readonly { value: T; label: string; disabled?: boolean; color?: string }[]
  value: T | null | undefined
  onChange: (value: T) => void
  disabled?: boolean
}) {
  const glide = useGlide<HTMLSpanElement>()
  return (
    <span ref={glide} className="m-seg m-glide" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`m-seg-item${o.value === value ? ' is-on' : ''}`}
          disabled={disabled || o.disabled}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          {o.color ? <span className="m-seg-dot" style={{ background: o.color }} /> : null}
          {o.label}
        </button>
      ))}
    </span>
  )
}

/** Exo's switch: a dark track, cream when on. */
export function Switch({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="m-switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="m-switch-knob" />
    </button>
  )
}

/**
 * A colour well that writes once, when the picker closes, so dragging through
 * colours does not send the mouse a command for each one.
 */
export function ColorField({ label, value, onCommit, disabled = false }: { label: string; value: string; onCommit: (hex: string) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const committed = useRef(value)
  const commit = useRef(onCommit)
  commit.current = onCommit
  useEffect(() => { setDraft(value); committed.current = value }, [value])
  useEffect(() => {
    const input = ref.current
    if (!input) return
    const done = () => {
      const next = input.value.toLowerCase()
      if (next !== committed.current.toLowerCase()) commit.current(next)
    }
    input.addEventListener('change', done)
    return () => input.removeEventListener('change', done)
  }, [])
  return <input ref={ref} type="color" className="m-color" aria-label={label} value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)} />
}

/**
 * A slider that follows the pointer and writes once, on release (or on the
 * last arrow key), so dragging does not send the mouse a command per pixel.
 */
export function Slider({ label, min, max, step, value, format, onCommit, disabled = false }: {
  label: string
  min: number
  max: number
  step: number
  value: number
  format?: (v: number) => string
  onCommit: (v: number) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const [held, setHeld] = useState(false)
  useEffect(() => { if (!held) setDraft(value) }, [value, held])
  const commit = () => {
    setHeld(false)
    if (draft !== value) onCommit(draft)
  }
  return (
    <span className="m-slider">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        style={{ '--fill': `${((draft - min) / (max - min || 1)) * 100}%` } as CSSProperties}
        onPointerDown={() => setHeld(true)}
        onChange={e => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={() => held && commit()}
      />
      {format ? <span className="m-slider-value">{format(draft)}</span> : null}
    </span>
  )
}

/** A number typed in: written on Enter or when the field loses focus, clamped and snapped to the step. */
export function NumberField({ label, min, max, step, value, suffix, onCommit, disabled = false }: {
  label: string
  min: number
  max: number
  step: number
  value: number
  suffix?: string
  onCommit: (v: number) => void
  disabled?: boolean
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const n = Number(text)
    if (!Number.isFinite(n)) { setText(String(value)); return }
    const snapped = Math.min(max, Math.max(min, Math.round(n / step) * step))
    setText(String(snapped))
    if (snapped !== value) onCommit(snapped)
  }
  return (
    <span className="m-number">
      <input
        aria-label={label}
        inputMode="numeric"
        value={text}
        disabled={disabled}
        onChange={e => setText(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
      {suffix ? <span className="m-number-suffix">{suffix}</span> : null}
    </span>
  )
}

export function Select({ label, options, value, onChange, disabled = false }: {
  label: string
  options: readonly string[]
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <select className="m-select" aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      {options.includes(value) ? null : <option value={value}>{value}</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
