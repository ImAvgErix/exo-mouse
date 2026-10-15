import type { MouseStatus } from '@openmouse/protocol/drivers/mouse-types'
import type { SupportedClient } from '@openmouse/protocol/drivers/registry'
import type { Step } from './mouse'

/**
 * What every settings section gets: the mouse's last read status, its driver
 * client (call setters only through apply/applyAll), and whether a write is
 * in flight. apply runs one setter and reads the mouse back; applyAll runs
 * several, then reads back once. Both resolve to what the mouse took, or null
 * when a step failed (the room shows the error).
 */
export type Section = {
  status: MouseStatus
  client: SupportedClient | null
  apply: (method: string, ...args: unknown[]) => Promise<MouseStatus | null>
  applyAll: (steps: Step[]) => Promise<MouseStatus | null>
  busy: boolean
}
