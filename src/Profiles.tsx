import { useEffect, useRef, useState } from 'react'
import type { MouseStatus } from '@openmouse/protocol/drivers/mouse-types'
import { can, type Step, type useMouse } from './mouse'
import { call, onHostEvent, tell } from './exo-hid'
import { GamePicker, LinkedCovers, type Game } from './GamePicker'
import { Panel } from './ui'

type Client = ReturnType<typeof useMouse>['client']
/** games: the Exo game ids this profile is for; it applies while one of them runs. */
/**
 * isDefault marks Desktop: built in, always there, always first, the profile the
 * mouse goes back to whenever no linked game is running. It is never renamed,
 * deleted or linked to games; Update saves the mouse's current settings into it.
 */
type Profile = { id: string; name: string; steps: Step[]; savedAt: string; games?: string[]; isDefault?: boolean }

const KEY = 'exo-mouse.profiles.v1'

type All = Record<string, Profile[]>

/** Profiles an earlier Exo Mouse kept in this frame's own storage. */
function readOld(): All | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as All : null
  } catch { return null }
}

/**
 * Exo keeps the profiles in its own data folder, so they survive anything that
 * clears this frame. Older ones move there once, and leave the frame only after
 * Exo has saved them.
 */
async function readAll(): Promise<All> {
  const reply = await call('exo.profiles.read') as unknown as { data?: All | null }
  if (reply.data) return reply.data
  const old = readOld()
  if (!old) return {}
  await writeAll(old)
  try { localStorage.removeItem(KEY) } catch { /* moved already; the copy here is harmless */ }
  return old
}

async function writeAll(all: All): Promise<void> {
  await call('exo.profiles.write', { data: all })
}

/**
 * The settings this mouse has now, as the setter calls that would put them
 * back: only setters its driver has, only values the mouse reported, never a
 * value the mouse treats as fixed (PerfectPolling, a hidden Motion Sync).
 */
export function snapshot(status: MouseStatus, client: Client): Step[] {
  const ui = status.ui ?? {}
  const steps: Step[] = []
  const add = (method: string, ...args: unknown[]) => { if (can(client, method) && args.every(a => a !== null && a !== undefined)) steps.push([method, args]) }
  const slx = !!status.finalmouseIsSlx
  add('setDpi', status.dpi)
  if (!ui.pollingReadOnly && (status.supportedPollingRates?.length ?? 1) > 0) add('setPollingRate', status.pollingRateHz)
  if (slx) {
    if (status.finalmousePawLodMm != null && !status.finalmousePawLodCustom) add('setPawLodMm', status.finalmousePawLodMm)
  } else if (status.liftOffDistance) add('setLiftOffDistance', status.liftOffDistance)
  if (!ui.hideMotionSync && !ui.hideProcessingCard) add('setMotionSync', status.motionSync)
  if (!ui.hideAngleSnapping && !ui.hideProcessingCard) add('setAngleSnapping', status.angleSnapping)
  if (!ui.hideRippleControl && !ui.hideProcessingCard) add('setRippleControl', status.rippleControl)
  add('setDebounceTime', status.debounceMs)
  if (!ui.hideSleepCard) add('setSleepTimeout', status.sleepTimeout)
  if (status.powerModes?.length) add('setPowerMode', status.powerMode)
  if (slx) {
    // Modes first: actuation only takes on a side that is analog.
    add('setClickMode', status.finalmouseClickModeL, status.finalmouseClickModeR, status.finalmouseClickReleaseL ?? 0, status.finalmouseClickReleaseR ?? 0)
    if (status.finalmouseTmrThrL != null && status.finalmouseTmrThrR != null)
      add('setTmrActuation', status.finalmouseTmrThrL / 100, status.finalmouseTmrThrR / 100, status.finalmouseTmrHystL, status.finalmouseTmrHystR)
    add('setDongleLedMode', status.finalmouseDongleLedMode)
    add('setTournamentScrollMode', status.finalmouseTournamentScrollMode)
    if (status.finalmouseTournamentScrollMode) add('setTournamentScrollTimeout', status.finalmouseTournamentScrollTimeoutMs)
  }
  return steps
}

const same = (a: Step[], b: Step[]) => JSON.stringify(a) === JSON.stringify(b)

const DESKTOP = 'Desktop'
const isDesktopName = (name: string) => name.trim().toLowerCase() === DESKTOP.toLowerCase()

/**
 * This mouse's profiles with Desktop in place: the one already marked, else one
 * already called Desktop, else a new one from the settings the mouse has now.
 * It comes first, with no games; any other profile marked default is not.
 */
function withDesktop(list: Profile[], now: Step[]): Profile[] {
  const desktop = list.find(p => p.isDefault) ?? list.find(p => isDesktopName(p.name))
    ?? { id: crypto.randomUUID(), name: DESKTOP, steps: now, savedAt: new Date().toISOString() }
  const rest = list.filter(p => p.id !== desktop.id).map(p => p.isDefault ? { ...p, isDefault: false } : p)
  return [{ ...desktop, name: DESKTOP, isDefault: true, games: [] }, ...rest]
}

/** How long a switch keeps trying while the mouse sleeps: every 3 s for a minute. */
const LAND_TRIES = 20
const LAND_CHECK_MS = 3_000
const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))

/** Only the settings that differ from the mouse now: fewer writes, a faster switch. */
export const changes = (target: Step[], now: Step[]) => target.filter(step => !now.some(n => JSON.stringify(n) === JSON.stringify(step)))

/**
 * Exo's own profiles for this mouse model: named sets of settings, as many as
 * you like, saved on this PC. Save current stores what the mouse has now;
 * Apply puts it back; the one that matches the mouse right now says Active.
 * A profile can be linked to games: when one starts (Exo says so, room open
 * or not), the settings the mouse had are remembered and the profile is
 * written; when it closes, the remembered settings go back.
 */
export function Profiles({ device, status, client, applyAll, busy }: {
  device: string
  status: MouseStatus
  client: Client
  applyAll: (steps: Step[]) => Promise<MouseStatus | null>
  busy: boolean
}) {
  const [all, setAll] = useState<All>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  useEffect(() => {
    readAll().then(all => { setAll(all); setLoaded(true) }).catch(() => setSaveError('Exo could not read your saved profiles.'))
  }, [])
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  /** The profile just written: Active at once, until the confirming read says otherwise. */
  const [applied, setApplied] = useState<string | null>(null)
  const apply = async (p: Profile) => {
    const took = await applyAll(changes(p.steps, now))
    if (!took) return
    setApplied(p.id)
    window.setTimeout(() => setApplied(a => a === p.id ? null : a), 1500)
  }
  const active = (p: Profile) => same(p.steps, now) || applied === p.id
  const list = all[device] ?? []
  const now = snapshot(status, client)

  const [games, setGames] = useState<Game[]>([])
  const [linking, setLinking] = useState<string | null>(null)
  useEffect(() => {
    call('exo.games')
      .then(r => setGames((r as unknown as { games?: Game[] }).games ?? []))
      .catch(() => setGames([]))
  }, [])
  const byId = new Map(games.map(g => [g.id, g]))
  const titles = new Map(games.map(g => [g.id, g.title]))
  const titlesNow = useRef(titles)
  titlesNow.current = titles

  // The newest list, settings and writer, for the game events below.
  const live = useRef({ list, now, applyAll })
  live.current = { list, now, applyAll }
  /** The game whose profile is on the mouse now, and the settings to put back after it. */
  /**
   * The linked games running now, newest last, and the settings the mouse had
   * before the first of them (put back when they all close and there is no
   * default profile).
   */
  /**
   * Writes a profile and keeps at it until the mouse has it. A sleeping wireless
   * mouse drops writes while its receiver still answers reads, so a switch made
   * while it sleeps lands when it wakes: checked every few seconds for a minute.
   * The notice says so only once the mouse has the profile. A newer switch
   * replaces an older one still waiting.
   */
  const landing = useRef(0)
  const land = (steps: Step[], notice: string | null) => {
    const ticket = ++landing.current
    void (async () => {
      for (let attempt = 0; attempt < LAND_TRIES; attempt++) {
        if (landing.current !== ticket) return
        const current = live.current.now
        if (attempt > 0 && same(steps, current)) break
        const took = await live.current.applyAll(attempt === 0 ? steps : changes(steps, current))
        await sleep(LAND_CHECK_MS)
        if (landing.current !== ticket) return
        if (took && same(steps, live.current.now)) break
        if (attempt === LAND_TRIES - 1) return
      }
      if (notice) tell({ notice })
    })()
  }

  const running = useRef<string[]>([])
  const before = useRef<Step[] | null>(null)
  useEffect(() => {
    onHostEvent('game.runState', data => {
      const d = data as { id?: string; isRunning?: boolean }
      if (!d.id) return
      const { list: profiles, now: current } = live.current
      if (d.isRunning) {
        if (running.current.includes(d.id)) return
        const profile = profiles.find(p => p.games?.includes(d.id!))
        if (!profile) return
        if (running.current.length === 0) before.current = current
        running.current = [...running.current, d.id]
        // The room may be closed and the last read a minute old: write the whole profile.
        land(profile.steps, `${profile.name} mouse profile on for ${titlesNow.current.get(d.id!) ?? 'your game'}.`)
        return
      }
      if (!running.current.includes(d.id)) return
      running.current = running.current.filter(g => g !== d.id)
      // Another linked game still running keeps its profile; otherwise the default, else what was there before.
      const still = [...running.current].reverse().map(g => profiles.find(p => p.games?.includes(g))).find(Boolean)
      const fallback = profiles.find(p => p.isDefault)
      if (still) {
        land(still.steps, `${still.name} mouse profile on.`)
      } else if (fallback) {
        before.current = null
        land(fallback.steps, `${fallback.name} mouse profile on.`)
      } else if (before.current) {
        const back = before.current
        before.current = null
        land(back, 'Your mouse settings are back.')
      }
    })
  }, [])

  // When the mouse connects (Exo starting, the mouse waking, a replug) with no
  // linked game running, it takes the default profile, once per connection, quietly.
  const [loaded, setLoaded] = useState(false)
  const settled = useRef(false)
  useEffect(() => {
    if (!loaded || settled.current) return
    settled.current = true
    const fixed = withDesktop(list, now)
    if (JSON.stringify(fixed) !== JSON.stringify(list)) save(fixed)
    const desktop = fixed[0]
    if (running.current.length === 0 && !same(desktop.steps, now)) land(desktop.steps, null)
  }, [loaded, list, now, applyAll])

  /** A game is linked to one profile at most (never Desktop): linking it here unlinks it elsewhere. */
  const toggleGame = (profile: Profile, game: string) => {
    if (profile.isDefault) return
    const on = !profile.games?.includes(game)
    save(list.map(p => p.id === profile.id
      ? { ...p, games: on ? [...(p.games ?? []), game] : (p.games ?? []).filter(g => g !== game) }
      : on ? { ...p, games: (p.games ?? []).filter(g => g !== game) } : p))
  }

  const save = (next: Profile[]) => {
    const updated = { ...all, [device]: next }
    setAll(updated)
    setSaveError(null)
    writeAll(updated).catch(() => setSaveError('Exo could not save your profiles. Try again.'))
  }
  /** Save current: a new profile, or the one with that name (Desktop included) updated to what the mouse has now. */
  const add = () => {
    const clean = name.trim().slice(0, 40)
    if (!clean) return
    const existing = list.find(p => p.name.toLowerCase() === clean.toLowerCase())
    save(existing
      ? list.map(p => p.id === existing.id ? { ...p, steps: now, savedAt: new Date().toISOString() } : p)
      : [...list, { id: crypto.randomUUID(), name: clean, steps: now, savedAt: new Date().toISOString() }])
    setName('')
  }
  const update = (id: string) => save(list.map(p => p.id === id ? { ...p, steps: now, savedAt: new Date().toISOString() } : p))
  const rename = (id: string) => {
    const clean = draft.trim().slice(0, 40)
    // Desktop's name is taken: another profile cannot become it.
    if (clean && !isDesktopName(clean)) save(list.map(p => p.id === id && !p.isDefault ? { ...p, name: clean } : p))
    setRenaming(null)
  }
  const remove = (id: string) => {
    if (list.find(p => p.id === id)?.isDefault) return
    if (deleting !== id) { setDeleting(id); window.setTimeout(() => setDeleting(d => d === id ? null : d), 3000); return }
    save(list.filter(p => p.id !== id))
    setDeleting(null)
  }

  return (
    <Panel title="Profiles">
      {saveError ? <p className="m-error" role="alert">{saveError}</p> : null}
      {list.map(p => (
        <div key={p.id}>
        <div className="m-row">
          {renaming === p.id && !p.isDefault ? (
            <input className="m-text" aria-label="Profile name" autoFocus maxLength={40} value={draft}
              onChange={e => setDraft(e.target.value)} onBlur={() => rename(p.id)}
              onKeyDown={e => { if (e.key === 'Enter') rename(p.id); if (e.key === 'Escape') setRenaming(null) }} />
          ) : (
            <span className="m-row-label">
              {p.name}
              {active(p) || p.isDefault ? (
                <span className="m-row-tags">
                  {active(p) ? <span className="m-row-value is-good">Active</span> : null}
                  {p.isDefault ? <span className="m-row-value">Default</span> : null}
                </span>
              ) : null}
              <LinkedCovers ids={p.games ?? []} games={byId} />
            </span>
          )}
          <span className="m-row-control m-actions">
            <button type="button" className="m-button" disabled={busy || active(p)} onClick={() => void apply(p)}>Apply</button>
            {p.isDefault ? (
              <button type="button" className="m-link" disabled={active(p)} onClick={() => update(p.id)}>Update</button>
            ) : (
              <>
                <button type="button" className="m-link" aria-haspopup="dialog" onClick={() => setLinking(p.id)}>Games</button>
                <button type="button" className="m-link" onClick={() => { setRenaming(p.id); setDraft(p.name) }}>Rename</button>
                <button type="button" className="m-link" onClick={() => remove(p.id)}>{deleting === p.id ? 'Sure?' : 'Delete'}</button>
              </>
            )}
          </span>
        </div>
        </div>
      ))}
      {(() => {
        const picking = list.find(p => p.id === linking)
        return picking ? (
          <GamePicker profile={picking} profiles={list} games={games}
            onToggle={game => toggleGame(picking, game)} onClose={() => setLinking(null)} />
        ) : null
      })()}
      <div className="m-row">
        <input className="m-text" aria-label="New profile name" placeholder="Name" maxLength={40} value={name}
          onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <span className="m-row-control">
          <button type="button" className="m-button" disabled={!name.trim()} onClick={add}>
            {list.some(p => p.name.toLowerCase() === name.trim().toLowerCase()) ? 'Update' : 'Save current'}
          </button>
        </span>
      </div>
    </Panel>
  )
}
