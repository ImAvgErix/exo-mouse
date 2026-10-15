import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'

/** A section: rounded, hairline, black inside; its name is the only bold type. */
export function Panel({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  const id = useId()
  return (
    <section className={`m-panel${wide ? ' is-wide' : ''}`} aria-labelledby={id}>
      <h2 id={id} className="m-panel-title">{title}</h2>
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

/** One pill; the current option filled. */
export function Segmented<T extends string | number>({ label, options, value, onChange, disabled = false }: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T | null | undefined
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <span className="m-seg" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`m-seg-item${o.value === value ? ' is-on' : ''}`}
          disabled={disabled}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  )
}

export function Switch({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`m-switch${checked ? ' is-on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="m-switch-knob" />
    </button>
  )
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
