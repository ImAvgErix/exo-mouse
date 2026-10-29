// The sensor angle math (src/angle.ts) on synthetic swipes at known angles. `npm test` (Node's own runner, which reads
// TypeScript as it is); `npm run check` runs it too.
//
// How it could fail: the turn of each swipe (a hook up or down as the hand reverses) pulls the angle; a few stray
// diagonal moves or a whole stray swipe pull it; one spike (a jump as the lock starts) steers it; reports' rounding to
// whole counts biases small moves; a swipe left and a swipe right cancel instead of agreeing; an arc from the wrist
// reads as a tilt; too few swipes still give a number; scattered swipes give a confident one; the sign of a
// correction comes out backwards; a check within its noise flips a sign that was right.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIN_CHECK, MIN_SWIPES, axial, correction, measureAngle, nextValue, observedGain, zigzag, type Move } from '../src/angle.ts'

/** A seeded generator, so a failure is the same failure every run. */
function random(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const normal = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next())
  return { next, normal }
}

type Options = {
  /** Degrees a swipe to the right rises. */
  angle: number
  count: number
  /** Counts per swipe. */
  length?: number
  /** Reports per swipe. */
  reports?: number
  /** Counts of noise on each axis of each report. */
  noise?: number
  /** Degrees the path bends over a swipe (a wrist's arc), symmetric about the axis. */
  arc?: number
  /** Reports of a hook straight up or down as the hand turns. */
  hook?: number
  /** Each swipe's own angle scatters this much (degrees, one sigma). */
  scatter?: number
  seed?: number
}

/** Back-and-forth swipes as a mouse reports them: bell-shaped speed, whole counts, the remainder carried. */
function swipes({ angle, count, length = 1600, reports = 40, noise = 1.5, arc = 0, hook = 0, scatter = 0, seed = 1 }: Options): Move[] {
  const rng = random(seed)
  const moves: Move[] = []
  let carryX = 0, carryY = 0
  const push = (x: number, y: number) => {
    carryX += x; carryY += y
    const rx = Math.round(carryX), ry = Math.round(carryY)
    carryX -= rx; carryY -= ry
    moves.push({ x: rx, y: ry })
  }
  for (let s = 0; s < count; s++) {
    const dir = s % 2 === 0 ? 1 : -1
    const own = angle + scatter * rng.normal()
    for (let i = 0; i < reports; i++) {
      const u = (i + 0.5) / reports
      const speed = (length * Math.PI / 2 / reports) * Math.sin(Math.PI * u)
      // The arc: the direction turns from -arc/2 to +arc/2 going right, and back the same way going left.
      const bend = arc * (dir > 0 ? u - 0.5 : 0.5 - u)
      const a = (own + bend) * Math.PI / 180
      // y down on screen: a rise is a negative y.
      push(dir * speed * Math.cos(a) + noise * rng.normal(), -dir * speed * Math.sin(a) + noise * rng.normal())
    }
    for (let i = 0; i < hook; i++) push(noise * rng.normal(), (s % 4 < 2 ? -1 : 1) * 12 + noise * rng.normal())
  }
  return moves
}

const near = (actual: number | null, expected: number, within: number, what = '') => {
  assert.ok(actual !== null, `${what} gave no angle`)
  assert.ok(Math.abs(actual - expected) <= within, `${what} read ${actual?.toFixed(2)}°, expected ${expected}° ± ${within}`)
}

test('clean swipes read their angle, both signs and flat', () => {
  for (const angle of [-25, -12, -6.1, -1, 0, 0.7, 3, 6.1, 8.5, 20, 28]) {
    const reading = measureAngle(swipes({ angle, count: 14, seed: Math.round(angle * 10) + 100 }))
    assert.equal(reading.status, 'ok', `${angle}°`)
    near(reading.angle, angle, 0.3, `${angle}°`)
    assert.equal(reading.swipes, 14, `${angle}° swipe count`)
    assert.equal(reading.confidence, 'high', `${angle}° confidence`)
  }
})

test('a swipe left and a swipe right agree: the reversals do not cancel the angle', () => {
  const reading = measureAngle(swipes({ angle: 6, count: 12, noise: 3, seed: 7 }))
  near(reading.angle, 6, 0.4)
})

test('hooks at every turn, an arc from the wrist and noisy reports still read the axis', () => {
  for (const [angle, seed] of [[5, 1], [-9, 2], [14, 3]]) {
    const reading = measureAngle(swipes({ angle, count: 16, noise: 4, arc: 14, hook: 4, reports: 30, seed }))
    assert.equal(reading.status, 'ok')
    near(reading.angle, angle, 0.6, `${angle}° with hooks and an arc`)
    assert.equal(reading.swipes, 16)
  }
})

test('a natural spread of swipes reads within its margin, and the margin is honest', () => {
  let inside = 0
  for (let seed = 1; seed <= 40; seed++) {
    const reading = measureAngle(swipes({ angle: 4, count: 14, scatter: 2.5, noise: 3, seed }))
    assert.equal(reading.status, 'ok')
    if (Math.abs((reading.angle ?? 0) - 4) <= (reading.margin ?? 0)) inside++
  }
  // A 95% interval: at least most of 40 runs hold the true angle.
  assert.ok(inside >= 34, `the margin held the true angle in ${inside} of 40 runs`)
})

test('too few swipes give no number', () => {
  const reading = measureAngle(swipes({ angle: 6, count: MIN_SWIPES - 3, seed: 5 }))
  assert.equal(reading.status, 'few')
  assert.equal(reading.angle, null)
  assert.equal(reading.swipes, MIN_SWIPES - 3)
  assert.equal(measureAngle([]).status, 'few')
  assert.equal(measureAngle([{ x: 1, y: 0 }, { x: 0, y: 1 }]).status, 'few')
})

test('a check needs fewer swipes than a first measurement', () => {
  const moves = swipes({ angle: -3, count: MIN_CHECK, seed: 9 })
  assert.equal(measureAngle(moves).status, 'few')
  const check = measureAngle(moves, MIN_CHECK)
  assert.equal(check.status, 'ok')
  near(check.angle, -3, 0.4)
})

test('stray diagonal moves and a stray swipe drop out', () => {
  const rng = random(11)
  const clean = swipes({ angle: 7, count: 14, seed: 11 })
  const moves: Move[] = []
  clean.forEach((m, i) => {
    moves.push(m)
    // A burst of diagonal moves every so often: the hand repositioning.
    if (i % 90 === 45) for (let k = 0; k < 6; k++) moves.push({ x: Math.round(30 + 5 * rng.normal()), y: Math.round(-30 + 5 * rng.normal()) })
  })
  const reading = measureAngle(moves)
  assert.equal(reading.status, 'ok')
  near(reading.angle, 7, 0.6, 'with diagonal bursts')
  assert.equal(reading.swipes, 14)
})

test('a stray swipe out and back, 45° off, is drawn but not counted', () => {
  // After a swipe to the left the hand goes off up and to the right and comes back: two swings, both strays.
  const clean = swipes({ angle: 7, count: 14, seed: 11 })
  const stray = swipes({ angle: 52, count: 2, length: 1300, seed: 12 })
  const moves = [...clean.slice(0, 40 * 8), ...stray, ...clean.slice(40 * 8)]
  const reading = measureAngle(moves)
  assert.equal(reading.status, 'ok')
  near(reading.angle, 7, 0.6, 'with a stray swipe')
  assert.equal(reading.swipes, 14)
  assert.equal(reading.swings.filter(s => s.stray).length, 2)
})

test('one spike does not steer it', () => {
  const moves = swipes({ angle: -4, count: 12, seed: 13 })
  moves.splice(5, 0, { x: 4000, y: -2500 })
  moves.splice(300, 0, { x: -3000, y: 900 })
  const reading = measureAngle(moves)
  near(reading.angle, -4, 0.4, 'with spikes')
  // Nor makes a swipe of its own.
  assert.equal(reading.swipes, 12)
})

test('it reads the same in counts or in pixels at any speed', () => {
  for (const length of [300, 1600, 9000]) near(measureAngle(swipes({ angle: 10, count: 12, length, seed: 17 })).angle, 10, 0.5, `length ${length}`)
})

test('scattered swipes are uneven, not a confident number', () => {
  const reading = measureAngle(swipes({ angle: 0, count: 14, scatter: 25, seed: 19 }))
  assert.equal(reading.status, 'uneven')
  assert.equal(reading.angle, null)
})

test('swings are what the drawing draws: every move after the first turn, in order', () => {
  const moves = swipes({ angle: 3, count: 8, seed: 23 })
  const { swings } = measureAngle(moves)
  assert.ok(swings.length >= 8)
  for (let i = 1; i < swings.length; i++) assert.equal(swings[i].from, swings[i - 1].to)
  assert.equal(swings[swings.length - 1].to, moves.length)
})

test('zigzag turns at each extreme once the way back passes the threshold', () => {
  assert.deepEqual(zigzag([0, 5, 10, 6, 2, 8, 12, 11], 5), [0, 2, 4, 6])
  assert.deepEqual(zigzag([0, 1, 2, 1], 5), [0])
  assert.deepEqual(zigzag([3, 2, 0, -6, -2, 1], 5), [0, 3, 5])
})

test('axial angles wrap to a line', () => {
  assert.equal(axial(170), -10)
  assert.equal(axial(-100), 80)
  assert.equal(axial(45), 45)
})

test('the correction turns the other way by the tilt, in the setting\'s own steps and range', () => {
  // A positive value turning swipes counterclockwise: a 6.1° rise wants -6.
  assert.equal(correction(0, 6.1, 1, -30, 30), -6)
  // The other convention: +6.
  assert.equal(correction(0, 6.1, -1, -30, 30), 6)
  // From where it is now, not from zero.
  assert.equal(correction(4, 2.6, 1, -30, 30), 1)
  // Never past the range.
  assert.equal(correction(-28, 7, 1, -30, 30), -30)
  // A setting in half-degree steps (two steps a degree).
  assert.equal(correction(0, 3, 0.5, -127, 127), -6)
})

test('two measurements teach the gain, and noise teaches nothing', () => {
  // A setting in degrees: only the direction is learned.
  assert.equal(observedGain({ value: 0, tilt: 6, margin: 0.4 }, { value: -6, tilt: 12.1, margin: 0.5 }), -1)
  assert.equal(observedGain({ value: 0, tilt: 6, margin: 0.4 }, { value: -6, tilt: 0.2, margin: 0.5 }), 1)
  // One in steps of its own: how far a step goes, too.
  assert.equal(observedGain({ value: 0, tilt: 6, margin: 0.4 }, { value: -6, tilt: 3, margin: 0.5 }, false), 0.5)
  // Within the readings' margins, or no change of value: nothing.
  assert.equal(observedGain({ value: 0, tilt: 0.6, margin: 0.4 }, { value: -1, tilt: 1.1, margin: 0.5 }), null)
  assert.equal(observedGain({ value: 3, tilt: 6, margin: 0.4 }, { value: 3, tilt: 2, margin: 0.4 }), null)
})

test('the next value comes from the measurement nearest flat', () => {
  const before = { value: 0, tilt: 6.1, margin: 0.3 }
  const after = { value: -6, tilt: 12.1, margin: 0.3 }
  assert.equal(nextValue([before, after], -1, -30, 30), 6)
  assert.equal(nextValue([after], -1, -30, 30), 6)
  assert.equal(nextValue([{ value: -6, tilt: 0.3, margin: 0.3 }, before], 1, -30, 30), -6)
})

/** The whole flow on a pretend mouse whose setting turns the swipes `gain` degrees a step, from a first guess of +1. */
function flatten(gain: number, start: number, degrees = true) {
  const tiltAt = (v: number) => start + gain * v
  const read = (v: number, seed: number, need = MIN_SWIPES) => {
    const reading = measureAngle(swipes({ angle: tiltAt(v), count: need + 2, scatter: 1, seed }), need)
    assert.equal(reading.status, 'ok')
    return { value: v, tilt: reading.angle as number, margin: reading.margin as number }
  }
  let guess = 1
  const first = read(0, 31)
  const check = read(correction(first.value, first.tilt, guess, -127, 127), 32, MIN_CHECK)
  guess = observedGain(first, check, degrees) ?? guess
  const value = nextValue([first, check], guess, -127, 127)
  return { value, residual: tiltAt(value), guess }
}

test('a wrong first guess at the sign is turned round by the check', () => {
  // Within a step of flat: the check is quick (six swipes), so its own noise can still move it one step.
  const wrong = flatten(-1, 6.1)
  assert.equal(wrong.guess, -1)
  assert.ok(wrong.value >= 5 && wrong.value <= 7, `set ${wrong.value}`)
  assert.ok(Math.abs(wrong.residual) <= 1, `left ${wrong.residual}°`)
  const right = flatten(1, 6.1)
  assert.equal(right.guess, 1)
  assert.ok(right.value <= -5 && right.value >= -7, `set ${right.value}`)
  assert.ok(Math.abs(right.residual) <= 1, `left ${right.residual}°`)
  // A setting in steps of its own (half a degree): the first move falls short, the check learns how far a step goes.
  const half = flatten(0.5, -8, false)
  assert.ok(Math.abs(half.residual) <= 1, `left ${half.residual}°`)
  const backwards = flatten(-0.5, 9, false)
  assert.ok(Math.abs(backwards.residual) <= 1, `left ${backwards.residual}°`)
})
