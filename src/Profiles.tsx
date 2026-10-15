import { useEffect, useRef, useState } from 'react'
import type { MouseStatus } from '@openmouse/protocol/drivers/mouse-types'
import { can, type Step, type useMouse } from './mouse'
import { call, onHostEvent, tell } from './exo-hid'
import { Panel } from './ui'

type Client = ReturnType<typeof useMouse>['client']
/** games: the Exo game ids this profile is for; it applies while one of them runs. */
type Profile = { id: string; name: string; steps: Step[]; savedAt: string; games?: string[] }
type Game = { id: string; title: string }

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
    readAll().then(setAll).catch(() => setSaveError('Exo could not read your saved profiles.'))
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
  const [filter, setFilter] = useState('')
  useEffect(() => {
    call('exo.games')
      .then(r => setGames((r as unknown as { games?: Game[] }).games ?? []))
      .catch(() => setGames([]))
  }, [])
  const titles = new Map(games.map(g => [g.id, g.title]))
  const titlesNow = useRef(titles)
  titlesNow.current = titles

  // The newest list, settings and writer, for the game events below.
  const live = useRef({ list, now, applyAll })
  live.current = { list, now, applyAll }
  /** The game whose profile is on the mouse now, and the settings to put back after it. */
  const session = useRef<{ game: string; before: Step[] } | null>(null)
  useEffect(() => {
    onHostEvent('game.runState', data => {
      const d = data as { id?: string; isRunning?: boolean }
      if (!d.id) return
      const { list: profiles, now: current, applyAll: write } = live.current
      if (d.isRunning) {
        if (session.current?.game === d.id) return
        const profile = profiles.find(p => p.games?.includes(d.id!))
        if (!profile) return
        // The room may be closed and the last read a minute old: write the whole profile.
        session.current = { game: d.id, before: session.current?.before ?? current }
        void write(profile.steps).then(took => { if (took) tell({ notice: `${profile.name} mouse profile on for ${titlesNow.current.get(d.id!) ?? 'your game'}.` }) })
      } else if (session.current?.game === d.id) {
        const before = session.current.before
        session.current = null
        void write(before).then(took => { if (took) tell({ notice: 'Your mouse settings are back.' }) })
      }
    })
  }, [])
  /** A game is linked to one profile at most: linking it here unlinks it elsewhere. */
  const toggleGame = (profile: Profile, game: string) => {
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
  const add = () => {
    const clean = name.trim().slice(0, 40)
    if (!clean) return
    const existing = list.find(p => p.name.toLowerCase() === clean.toLowerCase())
    const profile: Profile = { id: existing?.id ?? crypto.randomUUID(), name: clean, steps: now, savedAt: new Date().toISOString() }
    save(existing ? list.map(p => p.id === existing.id ? profile : p) : [...list, profile])
    setName('')
  }
  const rename = (id: string) => {
    const clean = draft.trim().slice(0, 40)
    if (clean) save(list.map(p => p.id === id ? { ...p, name: clean } : p))
    setRenaming(null)
  }
  const remove = (id: string) => {
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
          {renaming === p.id ? (
            <input className="m-text" aria-label="Profile name" autoFocus maxLength={40} value={draft}
              onChange={e => setDraft(e.target.value)} onBlur={() => rename(p.id)}
              onKeyDown={e => { if (e.key === 'Enter') rename(p.id); if (e.key === 'Escape') setRenaming(null) }} />
          ) : (
            <span className="m-row-label">
              {p.name}
              {active(p) ? <span className="m-row-value is-good">Active</span> : null}
              {p.games?.length ? <span className="m-row-value">{p.games.map(g => titles.get(g) ?? 'A removed game').join(', ')}</span> : null}
            </span>
          )}
          <span className="m-row-control m-actions">
            <button type="button" className="m-button" disabled={busy || active(p)} onClick={() => void apply(p)}>Apply</button>
            <button type="button" className="m-link" aria-expanded={linking === p.id} onClick={() => { setLinking(l => l === p.id ? null : p.id); setFilter('') }}>Games</button>
            <button type="button" className="m-link" onClick={() => { setRenaming(p.id); setDraft(p.name) }}>Rename</button>
            <button type="button" className="m-link" onClick={() => remove(p.id)}>{deleting === p.id ? 'Sure?' : 'Delete'}</button>
          </span>
        </div>
        {linking === p.id ? (
          <div className="m-games">
            <input className="m-text" aria-label="Find a game" placeholder="Find a game" autoFocus value={filter} onChange={e => setFilter(e.target.value)} />
            <div className="m-games-list" role="group" aria-label={`Games for ${p.name}`}>
              {games.filter(g => g.title.toLowerCase().includes(filter.trim().toLowerCase())).map(g => (
                <button key={g.id} type="button" role="checkbox" aria-checked={!!p.games?.includes(g.id)}
                  className={`m-game${p.games?.includes(g.id) ? ' is-on' : ''}`} onClick={() => toggleGame(p, g.id)}>
                  {g.title}
                </button>
              ))}
              {games.length === 0 ? <span className="m-state">No installed games</span> : null}
            </div>
          </div>
        ) : null}
        </div>
      ))}
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
