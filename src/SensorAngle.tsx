import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MouseStatus } from '@openmouse/protocol/drivers/mouse-types'
import { MIN_CHECK, MIN_SWIPES, measureAngle, nextValue, observedGain, type AnglePoint, type AngleReading, type Move } from './angle'
import { Overlay } from './brands/magnetic-tools-tests'
import { can } from './mouse'
import type { Section } from './section'
import { Panel, Progress, Row, Spinner } from './ui'
import './sensor-angle.css'

/**
 * Sensor angle: swipe side to side with your own grip and Exo measures the angle your swipes run at (angle.ts), then
 * sets the mouse's own sensor angle to cancel it and checks the swipes come out flat. Measure sits beside the angle's
 * control (Sensor angle, Pulsar Pro's and Endgame Gear's Angle tuning); a mouse whose angle Exo can't set gets the
 * measurement alone, among the tests.
 */

/** The mouse's sensor angle where Exo can set it: its value now, its range, its setter, and whether it counts degrees. */
type Setting = { value: number; min: number; max: number; method: string; degrees: boolean }

/**
 * OpenMouse's drivers send the angle as the brand's own app shows it (a signed byte; Wallhack's with 30 added) and
 * every one but Endgame Gear's names its unit, degrees, and its range. None says which way a positive value turns the
 * cursor, and brands differ. So every mouse starts from one guess, that a positive value turns the swipes
 * counterclockwise; the check after a change shows which way it really turned, and a wrong guess is put right at
 * once and remembered for that model. Endgame Gear's OP1 value (-127 to 127) names no unit: its check learns how far
 * a step turns as well.
 */
const FIRST_GUESS = 1

function angleSetting({ status, client }: Pick<Section, 'status' | 'client'>): Setting | null {
  const egg = (status as MouseStatus & { eggAngleTuning?: number | null }).eggAngleTuning
  if (egg != null && can(client, 'setSensorAngleTuning')) return { value: egg, min: -127, max: 127, method: 'setSensorAngleTuning', degrees: false }
  // An ATK F1 Ultimate's angle has no row (core-extras.tsx).
  if (status.angleTuning != null && status.atkSensorMode == null && can(client, 'setAngleTuning')) {
    return { value: status.angleTuning, min: -30, max: 30, method: 'setAngleTuning', degrees: true }
  }
  return null
}

const shown = (v: number, degrees = true) => `${v > 0 ? '+' : ''}${v}${degrees ? '°' : ''}`

/* ------------------------------------------------------------------ what Exo learned of each model */

/** Per model: the gain its checks showed, its last measurement, and the value Exo last set (a check is due while it stands). */
type Memory = { gain?: number; last?: AnglePoint; set?: number }
const MEMORY = 'exo-mouse.sensor-angle'
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function memories(): Record<string, Memory> {
  try {
    const all: unknown = JSON.parse(localStorage.getItem(MEMORY) ?? '{}')
    return all && typeof all === 'object' ? all as Record<string, Memory> : {}
  } catch {
    return {}
  }
}

function recall(model: string): Memory {
  const m = memories()[model] ?? {}
  const last = m.last && finite(m.last.value) && finite(m.last.tilt) && finite(m.last.margin) ? m.last : undefined
  return { gain: finite(m.gain) && m.gain !== 0 ? m.gain : undefined, last, set: finite(m.set) ? m.set : undefined }
}

function keep(model: string, memory: Memory) {
  try { localStorage.setItem(MEMORY, JSON.stringify({ ...memories(), [model]: memory })) } catch { /* it guesses again next time */ }
}

/* ------------------------------------------------------------------ entry points */

/** Measure, beside a sensor angle control. */
export function MeasureAngle(section: Section) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="m-button is-compact" onClick={() => setOpen(true)}>Measure</button>
      {open ? <AngleSheet section={section} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/** A mouse whose angle Exo can't set: the measurement on its own, with the polling and click tests. */
export function SensorAngleTest(section: Section) {
  const [open, setOpen] = useState(false)
  if (angleSetting(section)) return null
  return (
    <Panel title="Sensor angle" actions={<button type="button" className="m-button" onClick={() => setOpen(true)}>Measure</button>}>
      {open ? <AngleSheet section={section} onClose={() => setOpen(false)} /> : null}
    </Panel>
  )
}

/** The control beside the angle's own: its slider (or value) and Measure. */
export function AngleControl({ section, children }: { section: Section; children: ReactNode }) {
  return <span className="sa-control">{children}<MeasureAngle {...section} /></span>
}

/* ------------------------------------------------------------------ the measurement */

async function lock(pad: HTMLElement) {
  // Raw movement where the browser has it, so Windows' pointer speed and acceleration stay out of it.
  try {
    await pad.requestPointerLock({ unadjustedMovement: true })
  } catch (e) {
    if ((e as DOMException | null)?.name !== 'NotSupportedError') throw e
    await pad.requestPointerLock()
  }
}

type Phase = 'idle' | 'capture' | 'done'

function AngleSheet({ section, onClose }: { section: Section; onClose: () => void }) {
  const { status, busy } = section
  const setting = angleSetting(section)
  const model = `${status.brand} ${status.name}`
  const pad = useRef<HTMLButtonElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const moves = useRef<Move[]>([])
  const capturing = useRef(false)
  const stoppedAt = useRef(0)
  const need = useRef(MIN_SWIPES)
  const [phase, setPhase] = useState<Phase>('idle')
  const [reading, setReading] = useState<AngleReading | null>(null)
  const [swipes, setSwipes] = useState(0)
  const [offer, setOffer] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [failed, setFailed] = useState<'lock' | 'write' | null>(null)
  const due = setting != null && recall(model).set === setting.value

  const set = async (value: number, why: string | null) => {
    if (!setting) return
    setFailed(null)
    if (!(await section.apply(setting.method, value))) { setFailed('write'); return }
    keep(model, { ...recall(model), set: value })
    moves.current = []
    draw(canvas.current, [], null, true)
    setReading(null)
    setOffer(null)
    setNote(why)
    setPhase('idle')
  }

  const finish = () => {
    const result = measureAngle(moves.current, need.current)
    setReading(result)
    setPhase('done')
    draw(canvas.current, moves.current, result, true)
    if (result.status !== 'ok' || result.angle === null || result.margin === null || !setting) return
    const now = { value: setting.value, tilt: result.angle, margin: result.margin }
    const memory = recall(model)
    let gain = memory.gain ?? FIRST_GUESS
    let points = [now]
    let fix: number | null = null
    const learned = memory.last && memory.last.value !== now.value ? observedGain(memory.last, now, setting.degrees) : null
    if (learned !== null && memory.last) {
      // Exo's last change turned the swipes the other way from its guess: turned round at once.
      if (Math.sign(learned) !== Math.sign(gain) && memory.set === now.value) fix = nextValue([memory.last, now], learned, setting.min, setting.max)
      gain = learned
      points = [memory.last, now]
    }
    keep(model, { gain: learned ?? memory.gain, last: now })
    if (fix !== null && fix !== now.value) { setOffer(fix); void set(fix, 'Turned the other way'); return }
    const next = nextValue(points, gain, setting.min, setting.max)
    setOffer(Math.abs(now.tilt) >= 0.5 && next !== now.value ? next : null)
  }

  // Lock and its loss, read through refs so the listeners stay the same for the sheet's life.
  const finishRef = useRef(finish)
  finishRef.current = finish
  const dueRef = useRef(due)
  dueRef.current = due
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const change = () => {
      if (document.pointerLockElement === pad.current && pad.current) {
        if (capturing.current) return
        capturing.current = true
        moves.current = []
        need.current = dueRef.current ? MIN_CHECK : MIN_SWIPES
        setReading(null)
        setOffer(null)
        setNote(null)
        setSwipes(0)
        setPhase('capture')
      } else if (capturing.current) {
        capturing.current = false
        stoppedAt.current = performance.now()
        finishRef.current()
      }
    }
    const refused = () => setFailed('lock')
    // Escape while measuring (and the moment after) stops the measurement, never the sheet.
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (!capturing.current && performance.now() - stoppedAt.current > 500)) return
      e.preventDefault()
      e.stopPropagation()
      if (capturing.current) document.exitPointerLock()
    }
    // The drawing reads the Appearance's colors: a change of Appearance draws it again.
    const look = new MutationObserver(() => { if (!capturing.current) draw(canvas.current, moves.current, measureAngle(moves.current, need.current), true) })
    look.observe(document.documentElement, { attributes: true, attributeFilter: ['data-exo-theme'] })
    document.addEventListener('pointerlockchange', change)
    document.addEventListener('pointerlockerror', refused)
    window.addEventListener('keydown', key, true)
    draw(canvas.current, [], null, true)
    return () => {
      document.removeEventListener('pointerlockchange', change)
      document.removeEventListener('pointerlockerror', refused)
      window.removeEventListener('keydown', key, true)
      look.disconnect()
      capturing.current = false
      if (document.pointerLockElement === pad.current) document.exitPointerLock()
      if (back?.isConnected) back.focus()
    }
  }, [])

  // While measuring: every move, drawn each frame; a right-click stops it.
  useEffect(() => {
    if (phase !== 'capture') return
    let frame = 0
    let counted = 0
    const move = (e: PointerEvent) => { if (e.movementX || e.movementY) moves.current.push({ x: e.movementX, y: e.movementY }) }
    const press = (e: MouseEvent) => {
      e.preventDefault()
      if (e.button === 2) document.exitPointerLock()
    }
    const menu = (e: Event) => e.preventDefault()
    const tick = () => {
      const live = measureAngle(moves.current, need.current)
      draw(canvas.current, moves.current, live, false)
      if (live.swipes !== counted) { counted = live.swipes; setSwipes(counted) }
      frame = requestAnimationFrame(tick)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('mousedown', press, true)
    document.addEventListener('contextmenu', menu, true)
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('mousedown', press, true)
      document.removeEventListener('contextmenu', menu, true)
    }
  }, [phase])

  const start = () => {
    if (capturing.current || !pad.current) return
    setFailed(null)
    lock(pad.current).catch(() => setFailed('lock'))
  }

  const ok = reading?.status === 'ok' && reading.angle !== null ? reading : null
  const flat = ok !== null && Math.abs(ok.angle as number) < 0.5
  const goal = need.current
  const label = failed === 'lock' ? "Exo Mouse couldn't capture the pointer. Click to try again"
    : phase === 'capture' ? `${swipes} ${swipes === 1 ? 'swipe' : 'swipes'} · Right-click or Esc to stop`
      : phase === 'done' ? (reading?.status === 'few' ? 'Not enough swipes. Click to try again'
        : reading?.status === 'uneven' ? 'Swipes too uneven. Click to try again' : 'Click to measure again')
        : due ? `${note ? `${note}. ` : ''}Click, then swipe to check` : 'Click, then swipe side to side'
  const drawn = phase !== 'idle'

  return (
    <Overlay title="Sensor angle" onClose={onClose}>
      <button
        ref={pad}
        type="button"
        // The pad mounts once its popover shows (ui.tsx › Popover), after this sheet's own effects ran.
        autoFocus
        className={`mt-pad sa-pad${phase === 'capture' ? ' is-capture' : ''}`}
        onClick={start}
        onContextMenu={e => e.preventDefault()}
      >
        <canvas ref={canvas} aria-hidden="true" />
        <span className={`sa-pad-label${drawn ? ' is-top' : ''}${failed === 'lock' ? ' is-bad' : ''}`}>{label}</span>
        {phase === 'capture' ? (
          <Progress edge size="small" value={Math.min(1, swipes / goal)} tone={swipes >= goal ? 'done' : undefined}
            label={`Measuring the sensor angle · ${Math.min(swipes, goal)} of ${goal} swipes`} />
        ) : null}
      </button>
      <Row label="Tilt">
        <span className={`m-state${flat ? ' is-good' : ''}`}>
          {ok ? (flat ? 'Flat' : `${Math.abs(ok.angle as number).toFixed(1)}° ${(ok.angle as number) > 0 ? 'up' : 'down'} to the right`) : '-'}
        </span>
      </Row>
      <Row label="Swipes"><span className="m-state">{reading ? reading.swipes : '-'}</span></Row>
      <Row label="Confidence">
        <span className="m-state">{ok ? `${CONFIDENCE[ok.confidence ?? 'low']} · ±${(ok.margin ?? 0).toFixed(1)}°` : '-'}</span>
      </Row>
      {setting ? (
        <Row label="Sensor angle">
          <span className="sa-set">
            <span className="m-state">{shown(setting.value, setting.degrees)}</span>
            {offer !== null ? (
              <button type="button" className="m-button is-primary" disabled={busy} onClick={() => void set(offer, null)}>
                {busy ? <Spinner /> : null}Set to {shown(offer, setting.degrees)}
              </button>
            ) : null}
          </span>
        </Row>
      ) : status.angleTuning != null ? (
        <Row label="Sensor angle"><span className="m-state">{shown(status.angleTuning)}</span></Row>
      ) : null}
      {failed === 'write' ? <p className="mt-message is-bad">Your mouse didn't take the new angle.</p> : null}
    </Overlay>
  )
}

const CONFIDENCE = { high: 'High', medium: 'Medium', low: 'Low' } as const

/* ------------------------------------------------------------------ the drawing */

/**
 * The swipes, each centered on the pad so their angles lie over one another, over a hairline that is flat. Live,
 * the newest are brightest; done, every swipe the same and the measured axis drawn through them, green when flat.
 * Strays are faint. The scale fits the longest swipe and never grows while you swipe, so the drawing holds still.
 */
function draw(canvas: HTMLCanvasElement | null, moves: readonly Move[], reading: AngleReading | null, done: boolean) {
  if (!canvas) return
  const ratio = window.devicePixelRatio || 1
  const w = canvas.clientWidth, h = canvas.clientHeight
  if (!w || !h) return
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio)
    canvas.height = Math.round(h * ratio)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const css = getComputedStyle(canvas)
  const color = (name: string) => css.getPropertyValue(name).trim()
  const cx = w / 2, cy = Math.round(h / 2) + 0.5
  if (!reading || !moves.length) { scale.value = Infinity; return }

  ctx.lineWidth = 1
  ctx.strokeStyle = color('--hair-control')
  ctx.beginPath()
  ctx.moveTo(16, cy)
  ctx.lineTo(w - 16, cy)
  ctx.stroke()

  // Each swing's points about its own middle.
  const strokes: { points: [number, number][]; stray: boolean }[] = []
  let reach = 1, rise = 1
  for (const swing of reading.swings) {
    const points: [number, number][] = []
    let x = 0, y = 0
    for (let i = swing.from; i < swing.to; i++) { points.push([x, y]); x += moves[i].x; y += moves[i].y }
    points.push([x, y])
    const mx = x / 2, my = y / 2
    for (const p of points) { p[0] -= mx; p[1] -= my; reach = Math.max(reach, Math.abs(p[0])); rise = Math.max(rise, Math.abs(p[1])) }
    strokes.push({ points, stray: swing.stray })
  }
  const fit = Math.min(1, (w / 2 - 24) / reach, (h / 2 - 28) / rise)
  scale.value = done ? fit : Math.min(scale.value, fit)
  const k = scale.value

  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color('--muted')
  strokes.forEach((stroke, i) => {
    const age = strokes.length - 1 - i
    ctx.globalAlpha = stroke.stray ? 0.18 : done ? 0.5 : Math.max(0.2, 0.95 - age * 0.06)
    ctx.beginPath()
    stroke.points.forEach(([x, y], j) => (j ? ctx.lineTo(cx + x * k, cy + y * k) : ctx.moveTo(cx + x * k, cy + y * k)))
    ctx.stroke()
  })
  ctx.globalAlpha = 1
  if (done && reading.status === 'ok' && reading.angle !== null) {
    // The measured axis, across the pad: y is down on screen, so a rise draws upward.
    const a = (reading.angle * Math.PI) / 180
    const half = w / 2 - 16
    ctx.lineWidth = 2
    ctx.strokeStyle = Math.abs(reading.angle) < 0.5 ? color('--good') : color('--ink')
    ctx.beginPath()
    ctx.moveTo(cx - half * Math.cos(a), cy + half * Math.sin(a))
    ctx.lineTo(cx + half * Math.cos(a), cy - half * Math.sin(a))
    ctx.stroke()
  }
}

/** The drawing's scale (pixels per count) while one measurement lasts. */
const scale = { value: Infinity }
