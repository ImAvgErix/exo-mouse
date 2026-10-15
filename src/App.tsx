import type { ReactNode } from 'react'
import type { MouseStatus } from '@openmouse/protocol/drivers/mouse-types'
import { can, useMouse } from './mouse'
import type { Section } from './section'
import { FinalmousePanels } from './Finalmouse'
import { AtkMiscPanels } from './brands/atk-misc'
import { CoreExtrasPanels, coreExtrasReplaces } from './brands/core-extras'
import { EndgamePulsarPanels } from './brands/endgame-pulsar'
import { LogitechPanels, logitechOwnsLiftOff } from './brands/logitech'
import { MagneticToolsPanels } from './brands/magnetic-tools'
import { Profiles } from './Profiles'
import { deviceImage } from './device-images'
import { signalLevel, signalWord, useMouseAlerts } from './alerts'
import { useState } from 'react'
import { NumberField, Panel, Row, Segmented, Select, Slider, Switch } from './ui'


export function App() {
  const mouse = useMouse()
  useMouseAlerts(mouse.phase === 'ready' ? mouse.status : null)
  if (mouse.phase === 'looking' || mouse.phase === 'opening') {
    return <Centered title={mouse.phase === 'opening' ? `Connecting to ${mouse.current?.name ?? 'your mouse'}` : 'Looking for your mouse'} />
  }
  if (mouse.phase === 'none') {
    return <Centered title="No supported mouse found" line="Plug in your mouse or its receiver. Exo shows it here as soon as Windows sees it." />
  }
  if (mouse.phase === 'error' || !mouse.status) {
    return (
      <Centered title="Exo could not reach your mouse" line={mouse.error ?? undefined}>
        <button type="button" className="m-button" onClick={mouse.retry}>Try again</button>
      </Centered>
    )
  }
  const section: Section = { status: mouse.status, client: mouse.client, apply: mouse.apply, applyAll: mouse.applyAll, busy: mouse.busy }
  return (
    <main className="m-room">
      <Device status={mouse.status} brand={mouse.brand}>
        {mouse.candidates.length > 1 ? (
          <Segmented
            label="Device"
            options={mouse.candidates.map(c => ({ value: c.id, label: c.name }))}
            value={mouse.current?.id}
            onChange={mouse.choose}
          />
        ) : null}
      </Device>
      <div className="m-settings">
      {mouse.error ? <p className="m-error" role="alert">{mouse.error}</p> : null}
      <div className="m-grid">
        <Sensitivity {...section} />
        <CoreExtrasPanels {...section} />
        <Performance {...section} />
        <FinalmousePanels {...section} />
        <EndgamePulsarPanels {...section} />
        <AtkMiscPanels {...section} />
        <LogitechPanels {...section} />
        <MagneticToolsPanels {...section} />
        <Buttons {...section} />
        <Lighting {...section} />
        <Power {...section} />
        {mouse.current ? <Profiles device={mouse.current.id} status={mouse.status} client={mouse.client} applyAll={mouse.applyAll} busy={mouse.busy} /> : null}
      </div>
      </div>
    </main>
  )
}

function Centered({ title, line, children }: { title: string; line?: string; children?: ReactNode }) {
  return (
    <main className="m-center" role="status">
      <p className="m-center-title">{title}</p>
      {line ? <p className="m-center-line">{line}</p> : null}
      {children}
    </main>
  )
}

/** The mouse itself: its picture (OpenMouse's render, when there is one), name, link and battery. */
function Device({ status, brand, children }: { status: MouseStatus; brand: string; children?: ReactNode }) {
  const battery = status.batteryPercent
  const charging = status.batteryState.startsWith('Charging')
  const image = deviceImage(status.name)
  const [missing, setMissing] = useState<string | null>(null)
  return (
    <aside className="m-device">
      {image && missing !== image ? <img className="m-device-image" src={image} alt="" draggable={false} onError={() => setMissing(image)} /> : <span className="m-device-image is-empty" />}
      <div>
        <h1 className="m-name">{status.name}</h1>
        <p className="m-meta">
          {[brand, status.connectionType, status.connectionDetail].filter(Boolean).join(' · ')}
        </p>
      </div>
      {battery != null ? (
        <div className={`m-battery${battery <= 15 && !charging ? ' is-low' : ''}`} aria-label={`Battery ${battery}%${charging ? ', charging' : ''}`}>
          <span className="m-battery-bar"><span style={{ width: `${Math.max(4, battery)}%` }} /></span>
          <span className="m-battery-text">{battery}%{charging ? ' · Charging' : ''}</span>
        </div>
      ) : null}
      <Signal status={status} />
      {children}
    </aside>
  )
}

/** The wireless signal as four bars and a word; nothing on a wired mouse or one that does not report it. */
function Signal({ status }: { status: MouseStatus }) {
  const level = signalLevel(status)
  if (level == null) return null
  const bars = Math.max(1, Math.round(level * 4))
  return (
    <div className={`m-signal${level <= 0.25 ? ' is-weak' : ''}`} aria-label={`Signal ${signalWord(level).toLowerCase()}`}>
      <span className="m-signal-bars" aria-hidden="true">
        {[1, 2, 3, 4].map(i => <span key={i} className={i <= bars ? 'is-on' : ''} style={{ height: `${i * 25}%` }} />)}
      </span>
      <span>{signalWord(level)} signal</span>
    </div>
  )
}

// ------------------------------------------------------------------ sensitivity

/** Brand fields the protocol's MouseStatus type may not name; read loosely, only to decide what to hide. */
const has = (status: MouseStatus, key: string) => (status as unknown as Record<string, unknown>)[key] != null

function Sensitivity(section: Section) {
  const { status, client, apply, busy } = section
  // Endgame Gear sets CPI per stage on its own grid; the core DPI card replaces this one where it applies.
  if (coreExtrasReplaces(section).sensitivity || has(status, 'eggCpiStages') || has(status, 'otCpiStages')) return null
  const editor = status.ui?.dpiStageEditor
  const min = editor?.minDpi ?? 50
  const max = Math.max(editor?.maxDpi ?? 26_000, status.dpi)
  const step = editor?.stepDpi ?? 50
  const stages = status.dpiStages ?? []
  const canDpi = can(client, 'setDpi')
  if (!canDpi && stages.length === 0) return null
  return (
    <Panel title="Sensitivity">
      {canDpi ? (
        <Row label="DPI">
          <span className="m-dpi">
            <Slider label="DPI" min={min} max={Math.min(max, 6400)} step={step} value={Math.min(status.dpi, 6400)} onCommit={v => void apply('setDpi', v)} disabled={busy} />
            <NumberField label="DPI" min={min} max={max} step={editor?.stepDpi ?? 1} value={status.dpi} onCommit={v => void apply('setDpi', v)} disabled={busy} />
          </span>
        </Row>
      ) : null}
      {stages.length > 0 ? (
        <Row label="Stages">
          <span className="m-stages" role="radiogroup" aria-label="DPI stage">
            {stages.map((dpi, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={status.activeDpiStage === i}
                className={`m-stage${status.activeDpiStage === i ? ' is-on' : ''}`}
                disabled={busy || !can(client, 'setActiveDpiStage')}
                onClick={() => void apply('setActiveDpiStage', i)}
              >
                {status.dpiStageColors?.[i] ? <span className="m-stage-dot" style={{ background: status.dpiStageColors[i] }} /> : null}
                {dpi}
              </button>
            ))}
          </span>
        </Row>
      ) : null}
    </Panel>
  )
}

// ------------------------------------------------------------------ performance

const POLLING = [125, 250, 500, 1000, 2000, 4000, 8000]
/** The Starlight X's lift-off presets, the two its receiver reports back as presets. */
const PAW_PRESETS = [{ value: 1, label: '1 mm' }, { value: 2, label: '2 mm' }] as const
const DEBOUNCE = [0, 1, 2, 4, 8, 12, 16]

function hz(v: number): string {
  return v >= 1000 ? `${v / 1000}K` : String(v)
}

function Performance(section: Section) {
  const { status, client, apply, busy } = section
  const ui = status.ui ?? {}
  // Rows a brand panel draws itself, or that the mouse refuses in its current mode.
  const brandPolling = status.eggGlassMode === true
  const brandLiftOff = has(status, 'eggLodOptions') || coreExtrasReplaces(section).liftOff || logitechOwnsLiftOff(status)
  const brandDebounce = status.atkSensorMode != null || status.lunafury != null
  const rates = status.supportedPollingRates ?? POLLING
  // A fixed rate (Starlight X PerfectPolling) is a value, not a choice.
  const fixedRate = !!ui.pollingReadOnly || rates.length === 0
  const lods = (status.supportedLiftOffDistances ?? ['Low', 'Medium', 'High']).filter(v => !((ui.hideLodLow || ui.family === 'egg-ot') && v === 'Low'))
  const processing = !ui.hideProcessingCard
  const rows = [
    !brandPolling && fixedRate && status.pollingRateHz > 0 && (
      <Row key="poll" label="Polling rate" value={ui.pollingNote ?? (ui.family === 'finalmouse-slx' ? 'PerfectPolling' : undefined)}>
        <span className="m-state">{status.pollingRateHz} Hz</span>
      </Row>
    ),
    !brandPolling && !fixedRate && can(client, 'setPollingRate') && (
      <Row key="poll" label="Polling rate" value={ui.pollingNote}>
        <Segmented label="Polling rate" options={rates.map(r => ({ value: r, label: hz(r) }))} value={status.pollingRateHz}
          onChange={v => void apply('setPollingRate', v)} disabled={busy} />
      </Row>
    ),
    !brandLiftOff && status.liftOffDistance != null && status.finalmousePawLodMm == null && can(client, 'setLiftOffDistance') && (
      <Row key="lod" label="Lift-off distance">
        <Segmented label="Lift-off distance" options={lods.map(v => ({ value: v, label: v }))} value={status.liftOffDistance}
          onChange={v => void apply('setLiftOffDistance', v)} disabled={busy} />
      </Row>
    ),
    status.finalmousePawLodMm != null && can(client, 'setPawLodMm') && (
      <Row key="paw" label="Lift-off distance" value={status.finalmousePawLodCustom ? `Custom ${status.finalmousePawLodMm.toFixed(1)} mm, set in xpanel` : undefined}>
        <Segmented label="Lift-off distance" options={PAW_PRESETS} value={status.finalmousePawLodCustom ? null : status.finalmousePawLodMm}
          onChange={v => void apply('setPawLodMm', v)} disabled={busy} />
      </Row>
    ),
    processing && !ui.hideMotionSync && status.motionSync != null && can(client, 'setMotionSync') && (
      <Row key="ms" label="Motion sync">
        <Switch label="Motion sync" checked={status.motionSync} onChange={v => void apply('setMotionSync', v)} disabled={busy} />
      </Row>
    ),
    processing && !ui.hideAngleSnapping && status.angleSnapping != null && can(client, 'setAngleSnapping') && (
      <Row key="as" label="Angle snapping">
        <Switch label="Angle snapping" checked={status.angleSnapping} onChange={v => void apply('setAngleSnapping', v)} disabled={busy} />
      </Row>
    ),
    processing && !ui.hideRippleControl && status.rippleControl != null && can(client, 'setRippleControl') && (
      <Row key="rc" label="Ripple control">
        <Switch label="Ripple control" checked={status.rippleControl} onChange={v => void apply('setRippleControl', v)} disabled={busy} />
      </Row>
    ),
    !brandDebounce && status.debounceMs != null && can(client, 'setDebounceTime') && (
      <Row key="db" label="Click debounce">
        <Segmented label="Click debounce" options={withCurrent(DEBOUNCE, status.debounceMs).map(v => ({ value: v, label: `${v} ms` }))}
          value={status.debounceMs} onChange={v => void apply('setDebounceTime', v)} disabled={busy} />
      </Row>
    ),
    status.powerModes?.length && can(client, 'setPowerMode') && (
      <Row key="pm" label="Power mode">
        <Segmented label="Power mode" options={status.powerModes.map(v => ({ value: v, label: v }))} value={status.powerMode}
          onChange={v => void apply('setPowerMode', v)} disabled={busy} />
      </Row>
    ),
    status.profileCount && status.profileCount > 1 && can(client, 'setProfile') && (
      <Row key="pr" label="Profile">
        <Segmented label="Profile" options={Array.from({ length: status.profileCount }, (_, i) => ({ value: i + 1, label: status.profileNames?.[i] || String(i + 1) }))}
          value={status.activeProfile} onChange={v => void apply('setProfile', v)} disabled={busy} />
      </Row>
    ),
  ].filter(Boolean)
  return rows.length ? <Panel title="Performance">{rows}</Panel> : null
}

/** A preset list that also holds the value the mouse reports, in order. */
function withCurrent(list: number[], current: number): number[] {
  return list.includes(current) ? list : [...list, current].sort((a, b) => a - b)
}

// ------------------------------------------------------------------ buttons, lighting, power

function Buttons({ status, client, apply, busy }: Section) {
  const mappings = status.buttonMappings
  const options = status.buttonOptions
  if (!mappings || !options?.length || !can(client, 'setButtonMapping')) return null
  return (
    <Panel title="Buttons">
      {Object.entries(mappings).map(([button, action]) => (
        <Row key={button} label={button}>
          <Select label={button} options={options} value={action} disabled={busy || !!status.fixedButtons?.includes(button)}
            onChange={v => void apply('setButtonMapping', button, v)} />
        </Row>
      ))}
    </Panel>
  )
}

function Lighting(section: Section) {
  const { status, client, apply, busy } = section
  const light = status.lighting
  if (!light || !can(client, 'setLighting') || coreExtrasReplaces(section).lighting) return null
  const set = (patch: Partial<typeof light>) => void apply('setLighting', { ...light, ...patch })
  return (
    <Panel title="Lighting">
      <Row label={light.zone}>
        <Segmented label="Effect" options={light.modes.map(m => ({ value: m, label: m }))} value={light.mode} onChange={m => set({ mode: m })} disabled={busy} />
      </Row>
      {light.mode && light.colorModes.includes(light.mode) ? (
        <Row label="Colour">
          <input type="color" className="m-color" aria-label="Colour" value={light.color ?? '#ffffff'} disabled={busy}
            onChange={e => set({ color: e.target.value })} />
        </Row>
      ) : null}
      {light.brightnessLevels?.length ? (
        <Row label="Brightness">
          <Segmented label="Brightness" options={light.brightnessLevels.map(v => ({ value: v, label: `${v}%` }))} value={light.brightness ?? null}
            onChange={v => set({ brightness: v })} disabled={busy} />
        </Row>
      ) : null}
    </Panel>
  )
}

const SLEEP = [30, 60, 120, 300, 600, 900]

function seconds(v: number): string {
  return v < 60 ? `${v} s` : `${Math.round(v / 60)} min`
}

function Power({ status, client, apply, busy }: Section) {
  if (status.sleepTimeout == null || !can(client, 'setSleepTimeout') || status.ui?.hideSleepCard) return null
  return (
    <Panel title="Power">
      <Row label="Sleep after">
        <Segmented label="Sleep after" options={withCurrent(SLEEP, status.sleepTimeout).map(v => ({ value: v, label: seconds(v) }))}
          value={status.sleepTimeout} onChange={v => void apply('setSleepTimeout', v)} disabled={busy} />
      </Row>
    </Panel>
  )
}
