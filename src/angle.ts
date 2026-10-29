/**
 * The sensor angle of a natural side-to-side swipe, and the setting that flattens it. Pure math, no DOM: unit tested
 * in test/angle.test.ts.
 *
 * Moves are the pointer's movement reports under pointer lock (sensor counts, or pixels where the browser can't give
 * raw movement), x right and y down, as the browser hands them. The angle is the principal axis of the moves: total
 * least squares over them, which is the mean of their doubled angles, so a move left and a move right along one line
 * count alike. Each move weighs its squared length (a report's rounding counts for little), capped so one spike can't
 * steer it, and moves too short to have a direction weigh nothing. The fit is then redone with a Tukey weight on each
 * move's angle off the axis, so a stray diagonal and the hook where a swipe turns drop out. Swipes are the swings along
 * that axis (a zigzag with a threshold scaled to the swipes themselves): their count says when there are enough, and
 * the spread of their own angles says how far to trust the result.
 */

/** One movement report: x right, y down. */
export type Move = { x: number; y: number }

/** Moves `from` (inclusive) to `to` (exclusive): one stroke of the drawing. */
export type Swing = { from: number; to: number; stray: boolean }

export type AngleReading = {
  status: 'few' | 'uneven' | 'ok'
  /** Swipes that count: swings along the axis, strays left out. */
  swipes: number
  /** Every swing so far, the one under way last (for drawing). */
  swings: Swing[]
  /** Degrees a swipe to the right rises (counterclockwise positive, as on paper); null unless ok. */
  angle: number | null
  /** Half-width of the angle's 95% interval, degrees; null unless ok. */
  margin: number | null
  confidence: 'high' | 'medium' | 'low' | null
}

/** Swipes before a first measurement gives a number. */
export const MIN_SWIPES = 10
/** Swipes before a check after a change gives one: it only has to say better or worse. */
export const MIN_CHECK = 6

const DEG = 180 / Math.PI
/** Moves shorter than this (counts or pixels) have no direction worth the name: a hand settling, a report's rounding. */
const TINY = 2
/** A swing shorter than this never counts as a swipe, whatever the others are. */
const MIN_SWING = 24
/** Tukey's cut-off for a move's angle off the axis, tightened over the refits. */
const CUTS = [45, 30, 20, 20]
/** A swipe whose moves are mostly off the axis is a stray: the hand moving somewhere, not swiping. */
const STRAY_SHARE = 0.5
/** Spread of the swipes' own angles past which the swipes aren't one motion. */
const MAX_SPREAD = 15
/** A margin past this says nothing useful about a correction counted in whole degrees. */
const MAX_MARGIN = 4

/** An axial angle (a line, not a direction) into -90..90. */
export const axial = (deg: number) => ((((deg + 90) % 180) + 180) % 180) - 90

const tukey = (off: number, cut: number) => (Math.abs(off) >= cut ? 0 : (1 - (off / cut) ** 2) ** 2)

const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

type Step = { x: number; y: number; angle: number; c2: number; s2: number; base: number }

/** The doubled-angle mean (total least squares through the origin) of the steps in [from, to), each weighed by `weight`. */
function fit(steps: Step[], weight: (s: Step) => number, from = 0, to = steps.length): { angle: number; mass: number } {
  let c = 0, s = 0, mass = 0
  for (let i = from; i < to; i++) {
    const w = weight(steps[i])
    c += w * steps[i].c2
    s += w * steps[i].s2
    mass += w
  }
  return { angle: (0.5 * Math.atan2(s, c) * DEG), mass }
}

/**
 * The turning points of a position that goes back and forth: each time it comes back at least `h` from its last
 * extreme, that extreme is a turn. The first entry is where the first swing starts; the last is the extreme of the
 * swing under way.
 */
export function zigzag(pos: number[], h: number): number[] {
  const turns = [0]
  let dir = 0, hi = 0, lo = 0, ext = 0
  for (let k = 1; k < pos.length; k++) {
    const p = pos[k]
    if (dir === 0) {
      if (p > pos[hi]) hi = k
      if (p < pos[lo]) lo = k
      if (pos[hi] - pos[lo] >= h) {
        dir = hi > lo ? 1 : -1
        turns[0] = Math.min(hi, lo)
        ext = Math.max(hi, lo)
      }
    } else if (dir > 0) {
      if (p >= pos[ext]) ext = k
      else if (pos[ext] - p >= h) { turns.push(ext); dir = -1; ext = k }
    } else {
      if (p <= pos[ext]) ext = k
      else if (p - pos[ext] >= h) { turns.push(ext); dir = 1; ext = k }
    }
  }
  if (dir !== 0) turns.push(ext)
  return turns
}

/** The angle of the moves so far; `need` swipes before it gives a number. */
export function measureAngle(moves: readonly Move[], need = MIN_SWIPES): AngleReading {
  const none = (status: AngleReading['status'], swipes: number, swings: Swing[]): AngleReading =>
    ({ status, swipes, swings, angle: null, margin: null, confidence: null })
  // y up, as angles are read on paper: a swipe to the right that rises on screen is a positive angle.
  const lengths = moves.map(m => Math.hypot(m.x, m.y))
  const moving = lengths.filter(r => r >= TINY)
  if (moving.length < 4) return none('few', 0, [])
  // One spike (a lost report, a jump as the lock starts) weighs no more than a few ordinary moves.
  const cap = 4 * median(moving)
  const steps: Step[] = moves.map((m, i) => {
    const r = lengths[i]
    const x = m.x, y = -m.y
    return r < TINY
      ? { x, y, angle: 0, c2: 0, s2: 0, base: 0 }
      : { x, y, angle: Math.atan2(y, x) * DEG, c2: (x * x - y * y) / (r * r), s2: (2 * x * y) / (r * r), base: Math.min(r, cap) ** 2 }
  })

  let angle = fit(steps, s => s.base).angle
  for (const cut of CUTS) angle = fit(steps, s => s.base * tukey(axial(s.angle - angle), cut)).angle
  const inlier = (s: Step) => s.base * tukey(axial(s.angle - angle), CUTS[CUTS.length - 1])

  // Each move along the axis (a spike no longer than the cap, so it can't make a swing of its own), and the position
  // that adds up to, before each move and after the last.
  const ux = Math.cos(angle / DEG), uy = Math.sin(angle / DEG)
  const alongs = steps.map(s => Math.max(-cap, Math.min(cap, s.x * ux + s.y * uy)))
  const pos = [0]
  for (const along of alongs) pos.push(pos[pos.length - 1] + along)

  // The threshold for a turn, from the swipes themselves: runs of one direction, the bigger ones being swipes.
  const runs: number[] = []
  let run = 0
  for (const along of alongs) {
    if (Math.abs(along) < TINY) continue
    if (run !== 0 && Math.sign(along) !== Math.sign(run)) { runs.push(Math.abs(run)); run = 0 }
    run += along
  }
  if (run !== 0) runs.push(Math.abs(run))
  runs.sort((a, b) => b - a)
  const typical = runs[Math.floor((runs.length - 1) / 4)] ?? 0
  const h = Math.max(MIN_SWING, 0.35 * typical)

  const turns = zigzag(pos, h)
  const swings: Swing[] = []
  const found: { angle: number; amplitude: number; stray: boolean; last: boolean }[] = []
  for (let i = 0; i + 1 < turns.length; i++) {
    const from = turns[i], to = turns[i + 1]
    const own = fit(steps, inlier, from, to)
    const total = fit(steps, s => s.base, from, to).mass
    const stray = total === 0 || own.mass < STRAY_SHARE * total
    swings.push({ from, to, stray })
    found.push({ angle: own.angle, amplitude: Math.abs(pos[to] - pos[from]), stray, last: i + 2 === turns.length })
  }
  // What came after the last turn: the start of the next swing, too short yet to be one.
  const tail = turns[turns.length - 1] ?? 0
  if (tail < steps.length) swings.push({ from: tail, to: steps.length, stray: false })

  // The swing under way counts once it is as long as most: a swipe the hand stopped on.
  const settled = median(found.filter(c => !c.last).map(c => c.amplitude))
  const whole = found.filter(c => !c.last || (settled > 0 && c.amplitude >= 0.6 * settled))
  const swipes = whole.filter(c => !c.stray).map(c => c.angle)
  // Enough swings but too many of them strays: the hand swiped, just not along one line.
  if (swipes.length < need) return none(whole.length >= need && swipes.length < 0.75 * whole.length ? 'uneven' : 'few', swipes.length, swings)

  const offs = swipes.map(a => axial(a - angle))
  const centre = median(offs)
  const spread = Math.max(0.3, 1.4826 * median(offs.map(o => Math.abs(o - centre))))
  // 95%: about two standard errors, a little more for a handful of swipes (a check's six), whose spread reads low.
  const margin = Math.round(10 * (2 + 3 / swipes.length) * spread / Math.sqrt(swipes.length)) / 10
  const share = fit(steps, inlier).mass / Math.max(1e-9, fit(steps, s => s.base).mass)
  if (spread > MAX_SPREAD || margin > MAX_MARGIN || share < 0.6) return none('uneven', swipes.length, swings)
  return {
    status: 'ok', swipes: swipes.length, swings, angle, margin: Math.max(0.1, margin),
    confidence: margin <= 1 ? 'high' : margin <= 2 ? 'medium' : 'low',
  }
}

/** One measurement on the mouse as it was set: its angle value then, the tilt measured and that tilt's margin. */
export type AnglePoint = { value: number; tilt: number; margin: number }

/**
 * The value that flattens a measured tilt: the value it was measured at, less the tilt in the setting's own steps,
 * rounded to a step and kept in the setting's range. `gain` is how many degrees one step turns the swipes
 * counterclockwise: +1 where a positive value turns them counterclockwise a degree a step, -1 the other way.
 */
export function correction(value: number, tilt: number, gain: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value - tilt / gain)))
}

/**
 * The gain two measurements at different values show: how far the tilt moved per step of the setting. Null when the
 * tilt moved no more than the two readings' margins (nothing to learn), so noise never turns the sign round. A
 * setting in degrees (`degrees`) turns a degree a step by definition, so only its direction is learned.
 */
export function observedGain(before: AnglePoint, after: AnglePoint, degrees = true): number | null {
  const steps = after.value - before.value
  const turned = after.tilt - before.tilt
  if (steps === 0 || Math.abs(turned) <= Math.max(0.75, before.margin + after.margin)) return null
  const gain = turned / steps
  return Math.sign(gain) * (degrees ? 1 : Math.min(5, Math.max(0.1, Math.abs(gain))))
}

/**
 * The value to set next, corrected from whichever measurement was nearest flat: the less it extrapolates, the less
 * an error in the gain counts.
 */
export function nextValue(points: readonly AnglePoint[], gain: number, min: number, max: number): number {
  const base = points.reduce((best, p) => (Math.abs(p.tilt) < Math.abs(best.tilt) ? p : best))
  return correction(base.value, base.tilt, gain, min, max)
}
