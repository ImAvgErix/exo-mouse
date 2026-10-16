import { useCallback, useRef, useState } from 'react'
import type { MouseStatus } from '@openmouse/protocol/drivers/mouse-types'
import type { SupportedClient } from '@openmouse/protocol/drivers/registry'
import { Room } from './App'
import type { Candidate, Step, useMouse } from './mouse'

/**
 * Development only: `npx vite` in mouse/, opened with ?mock, shows the room on a
 * Finalmouse Starlight X that is not there, so the whole room can be seen
 * without the mouse or Exo. main.tsx loads this behind import.meta.env.DEV,
 * so a build never contains it. Writes change the pretend mouse after a short
 * wait (the work band shows), the host's calls are answered here, and
 * ?scale=1.25, ?motion=reduce, ?battery=12, ?charging, ?asleep, ?apart, ?lod=1.4
 * and ?fail try the room at another text size, with reduce motion, low,
 * charging, unread for minutes, with the right switch mechanical, on a
 * custom lift-off, or with a write that does not take.
 */

const params = new URLSearchParams(location.search)
const DEVICE = '361d:200'

const START = {
  brand: 'Finalmouse',
  name: 'Finalmouse Starlight X',
  ui: { family: 'finalmouse-slx', defaultDisplayName: 'Finalmouse Starlight X', hideUnsupportedPollingRates: true, forceShowBattery: true, pollingReadOnly: true, hideMotionSync: true },
  batteryPercent: params.has('battery') ? Number(params.get('battery')) : 76,
  batteryVoltageMv: 3940,
  batteryState: params.has('charging') ? 'Charging' : 'Discharging',
  dpi: 800,
  pollingRateHz: 8000,
  supportedPollingRates: [],
  activeProfile: null,
  unitId: null,
  connectionType: 'Wireless',
  connectionDetail: '2.4 GHz receiver · -42 dBm',
  motionSync: null,
  signalStrength: 4,
  liftOffDistance: 'Medium',
  supportedLiftOffDistances: ['Medium', 'High'],
  liftOffScale: null,
  finalmouseIsSlx: true,
  finalmouseDongleLedMode: 2,
  finalmouseIndicatorColor: { r: 61, g: 214, b: 140 },
  finalmouseTournamentScrollMode: 1,
  finalmouseTournamentScrollTimeoutMs: 500,
  finalmouseClickModeL: 1,
  finalmouseClickModeR: params.has('apart') ? 0 : 1,
  finalmouseClickReleaseL: 0,
  finalmouseClickReleaseR: 0,
  finalmouseTmrThrL: 25,
  finalmouseTmrThrR: 25,
  finalmouseTmrHystL: 220,
  finalmouseTmrHystR: 220,
  finalmouseTmrMspL: null,
  finalmouseTmrMspR: null,
  finalmousePawLodMm: params.has('lod') ? Number(params.get('lod')) : 1,
  finalmousePawLodCustom: params.has('lod'),
  finalmouseProfileCount: 3,
  finalmouseProfileActive: 0,
  finalmouseProfileEnabledMask: 0b111,
  finalmouseProfileNames: { 0: 'Profile 1', 1: 'Profile 2', 2: 'Profile 3' },
  firmware: ['Mouse 1.1.1', 'Dongle RF 1.1.1', 'Dongle USB 1.0.6'],
} as unknown as MouseStatus

type Fields = Record<string, unknown>
const SETTERS: Record<string, (s: Fields, ...a: number[]) => Fields> = {
  setDpi: (s, dpi) => ({ ...s, dpi }),
  setPawLodMm: (s, mm) => ({ ...s, finalmousePawLodMm: mm, finalmousePawLodCustom: false }),
  setLiftOffScale: (s, raw) => ({ ...s, finalmousePawLodMm: raw / 10, finalmousePawLodCustom: true }),
  setClickMode: (s, l, r, rl, rr) => ({ ...s, finalmouseClickModeL: l, finalmouseClickModeR: r, ...(rl == null ? {} : { finalmouseClickReleaseL: rl, finalmouseClickReleaseR: rr }) }),
  setTmrActuation: (s, l, r, hl, hr) => ({ ...s, finalmouseTmrThrL: Math.round(l * 100), finalmouseTmrThrR: Math.round(r * 100), finalmouseTmrHystL: hl, finalmouseTmrHystR: hr }),
  setActiveProfile: (s, i) => ({ ...s, finalmouseProfileActive: i }),
  setDongleLedMode: (s, m) => ({ ...s, finalmouseDongleLedMode: m }),
  setIndicatorColor: (s, r, g, b) => ({ ...s, finalmouseIndicatorColor: { r, g, b } }),
  setTournamentScrollMode: (s, m) => ({ ...s, finalmouseTournamentScrollMode: m }),
  setTournamentScrollTimeout: (s, ms) => ({ ...s, finalmouseTournamentScrollTimeoutMs: ms }),
}

/** A driver client as far as `can` looks: every setter above, doing nothing itself. */
const CLIENT = Object.fromEntries(Object.keys(SETTERS).map(name => [name, async () => undefined])) as unknown as SupportedClient

const CANDIDATE = { id: DEVICE, device: {} as HIDDevice, name: 'Starlight X' } satisfies Candidate

const GAMES = [
  { id: 'steam:730', title: 'Counter-Strike 2' },
  { id: 'riot:valorant', title: 'VALORANT' },
  { id: 'steam:1172470', title: 'Apex Legends' },
  { id: 'steam:2357570', title: 'Overwatch 2' },
]

const PROFILES = {
  [DEVICE]: [
    { id: 'desktop', name: 'Desktop', isDefault: true, games: [], savedAt: '2026-10-01T12:00:00Z', steps: [['setDpi', [800]]] },
    { id: 'tac', name: 'Tactical', games: ['steam:730', 'riot:valorant'], savedAt: '2026-10-02T12:00:00Z', steps: [['setDpi', [400]]] },
    { id: 'arena', name: 'Arena', games: ['steam:1172470'], savedAt: '2026-10-03T12:00:00Z', steps: [['setDpi', [1600]]] },
  ],
}

/** Exo's side of the frame's messages, answered in the page itself (standalone, the frame's parent is itself). */
function answerHost() {
  const post = window.postMessage.bind(window)
  window.postMessage = ((message: unknown, ...rest: unknown[]) => {
    const m = message as { exo?: string; id?: number; method?: string } | null
    if (m?.exo !== 'mouse') return (post as (...a: unknown[]) => void)(message, ...rest)
    if (typeof m.id !== 'number') return
    const result = m.method === 'exo.profiles.read' ? { ok: true, data: PROFILES }
      : m.method === 'exo.games' ? { ok: true, games: GAMES }
        : { ok: true }
    window.setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: { exo: 'mouse', id: m.id, result }, source: window })), 40)
  }) as typeof window.postMessage
}

function look() {
  const scale = Number(params.get('scale'))
  if (scale > 0.5 && scale < 2) document.documentElement.style.setProperty('--exo-scale', String(scale))
  if (params.get('motion') === 'reduce') document.documentElement.dataset.exoMotion = 'reduce'
}

function useMockMouse(): ReturnType<typeof useMouse> {
  const [status, setStatus] = useState(START)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [readAt, setReadAt] = useState(() => Date.now() - (params.has('asleep') ? 4 * 60_000 : 0))
  const now = useRef(status)
  const applyAll = useCallback(async (steps: Step[]) => {
    setBusy(true)
    setError(null)
    await new Promise(resolve => window.setTimeout(resolve, 900))
    if (params.has('fail')) {
      setError('The mouse did not answer. Make sure it is on and close xpanel.')
      setBusy(false)
      return null
    }
    let next = now.current as unknown as Fields
    for (const [method, args] of steps) next = SETTERS[method]?.(next, ...(args as number[])) ?? next
    now.current = next as unknown as MouseStatus
    setStatus(now.current)
    setReadAt(Date.now())
    setBusy(false)
    return now.current
  }, [])
  const apply = useCallback((method: string, ...args: unknown[]) => applyAll([[method, args]]), [applyAll])
  return {
    phase: 'ready', candidates: [CANDIDATE], current: CANDIDATE, brand: 'Finalmouse', status, error, busy,
    client: CLIENT, readAt, apply, applyAll, choose: () => undefined, retry: () => undefined,
  }
}

export function MockApp() {
  return <Room mouse={useMockMouse()} />
}

answerHost()
look()
