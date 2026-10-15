import type { MouseStatus } from '@openmouse/protocol/drivers/mouse-types'
import { can } from './mouse'
import type { useMouse } from './mouse'
import { Panel, Row, Segmented, Slider } from './ui'

type Section = {
  status: MouseStatus
  client: ReturnType<typeof useMouse>['client']
  apply: (method: string, ...args: unknown[]) => Promise<MouseStatus | null>
  busy: boolean
}

const CLICK = [{ value: 0, label: 'Mechanical' }, { value: 1, label: 'Analog' }] as const
const RELEASE = [{ value: 0, label: 'Normal' }, { value: 1, label: 'Early' }, { value: 2, label: 'Late' }] as const

/**
 * The Starlight X's own settings: its TMR analog main switches (mode,
 * actuation, rapid trigger, release), profiles, the receiver's LED and
 * tournament scroll. Each side is set with the other side's current value,
 * since the mouse takes both in one command.
 */
export function FinalmousePanels(section: Section) {
  const { status } = section
  if (!status.finalmouseIsSlx) return null
  return (
    <>
      <Switches {...section} />
      <Receiver {...section} />
    </>
  )
}

function Switches({ status, client, apply, busy }: Section) {
  const modeL = status.finalmouseClickModeL
  const modeR = status.finalmouseClickModeR
  if (modeL == null || modeR == null || !can(client, 'setClickMode')) return null
  const relL = status.finalmouseClickReleaseL ?? 0
  const relR = status.finalmouseClickReleaseR ?? 0
  const thrL = status.finalmouseTmrThrL ?? 20
  const thrR = status.finalmouseTmrThrR ?? 20
  const rtL = status.finalmouseTmrHystL ?? 200
  const rtR = status.finalmouseTmrHystR ?? 200
  const analog = modeL === 1 || modeR === 1
  const tmr = (l: number, r: number, hl: number, hr: number) => void apply('setTmrActuation', l / 100, r / 100, hl, hr)
  const setModes = (l: number, r: number) => apply('setClickMode', l, r, relL, relR)
  const mask = status.finalmouseProfileEnabledMask
  const profiles = Array.from({ length: status.finalmouseProfileCount ?? 0 }, (_, i) => i)
    .filter(i => mask == null || (mask & (1 << i)) !== 0 || i === status.finalmouseProfileActive)
  return (
    <Panel title="Main switches">
      <Row label="Left click">
        <Segmented label="Left click" options={CLICK} value={modeL} onChange={v => void setModes(v, modeR)} disabled={busy} />
      </Row>
      <Row label="Right click">
        <Segmented label="Right click" options={CLICK} value={modeR} onChange={v => void setModes(modeL, v)} disabled={busy} />
      </Row>
      {analog && can(client, 'setTmrActuation') ? (
        <>
          {modeL === 1 ? (
            <Row label="Left actuation">
              <Slider label="Left actuation" min={1} max={40} step={1} value={thrL} format={v => `${(v / 100).toFixed(2)} mm`}
                onCommit={v => tmr(v, thrR, rtL, rtR)} disabled={busy} />
            </Row>
          ) : null}
          {modeR === 1 ? (
            <Row label="Right actuation">
              <Slider label="Right actuation" min={1} max={40} step={1} value={thrR} format={v => `${(v / 100).toFixed(2)} mm`}
                onCommit={v => tmr(thrL, v, rtL, rtR)} disabled={busy} />
            </Row>
          ) : null}
          {modeL === 1 ? (
            <Row label="Left rapid trigger">
              <Slider label="Left rapid trigger" min={150} max={250} step={10} value={rtL} format={v => `${v} µm`}
                onCommit={v => tmr(thrL, thrR, v, rtR)} disabled={busy} />
            </Row>
          ) : null}
          {modeR === 1 ? (
            <Row label="Right rapid trigger">
              <Slider label="Right rapid trigger" min={150} max={250} step={10} value={rtR} format={v => `${v} µm`}
                onCommit={v => tmr(thrL, thrR, rtL, v)} disabled={busy} />
            </Row>
          ) : null}
          <Row label="Release point">
            <Segmented label="Release point" options={RELEASE} value={relL === relR ? relL : null}
              onChange={v => void apply('setClickMode', modeL, modeR, v, v)} disabled={busy} />
          </Row>
        </>
      ) : null}
      {profiles.length > 1 && can(client, 'setActiveProfile') ? (
        <Row label="Onboard profile">
          <Segmented
            label="Onboard profile"
            options={profiles.map(i => ({ value: i, label: status.finalmouseProfileNames?.[i] || String(i + 1) }))}
            value={status.finalmouseProfileActive}
            onChange={v => void apply('setActiveProfile', v)}
            disabled={busy}
          />
        </Row>
      ) : null}
    </Panel>
  )
}

const DONGLE_LED = [{ value: 0, label: 'Off' }, { value: 1, label: 'Battery' }, { value: 2, label: 'White' }] as const
const SCROLL = [{ value: 0, label: 'Off' }, { value: 1, label: 'Up' }, { value: 2, label: 'Down' }, { value: 3, label: 'Both' }] as const
const PASS = [{ value: 100, label: '100 ms' }, { value: 500, label: '500 ms' }, { value: 1000, label: '1 s' }, { value: 1500, label: '1.5 s' }] as const

function Receiver({ status, client, apply, busy }: Section) {
  const rows = [
    status.finalmouseDongleLedMode != null && can(client, 'setDongleLedMode') && (
      <Row key="led" label="Receiver light">
        <Segmented label="Receiver light" options={DONGLE_LED} value={status.finalmouseDongleLedMode} onChange={v => void apply('setDongleLedMode', v)} disabled={busy} />
      </Row>
    ),
    status.finalmouseTournamentScrollMode != null && can(client, 'setTournamentScrollMode') && (
      <Row key="scroll" label="Tournament scroll">
        <Segmented label="Tournament scroll" options={SCROLL} value={status.finalmouseTournamentScrollMode} onChange={v => void apply('setTournamentScrollMode', v)} disabled={busy} />
      </Row>
    ),
    status.finalmouseTournamentScrollMode && status.finalmouseTournamentScrollTimeoutMs != null && can(client, 'setTournamentScrollTimeout') && (
      <Row key="pass" label="Passthrough window">
        <Segmented label="Passthrough window" options={PASS} value={status.finalmouseTournamentScrollTimeoutMs} onChange={v => void apply('setTournamentScrollTimeout', v)} disabled={busy} />
      </Row>
    ),
  ].filter(Boolean)
  return rows.length ? <Panel title="Receiver">{rows}</Panel> : null
}
