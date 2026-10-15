// Fixes in @openmouse/protocol that Exo Mouse needs before upstream ships them.
// Each patch names the version it was written against and stops the build when
// that changes, so a fixed release is noticed and the patch deleted.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/@openmouse/protocol')
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
if (version !== '0.42.2') throw new Error(`@openmouse/protocol is ${version}; check scripts/patch-protocol.mjs against it.`)

// Starlight X: the receiver answers DPI and polling rate as commands 16 and 17
// (the same numbers they are set with), which the decoder did not read, so
// readStatus never saw them and failed. Captured on a Starlight X dongle
// (361d:0300, firmware 1.1.1): 04 10 02 40 06 = 1600 DPI, 04 11 02 e8 03 = 1000 Hz.
const file = resolve(root, 'dist/finalmouse/index.js')
let code = readFileSync(file, 'utf8')
const patches = [
  ['        case 3: {\n            const dpi', '        case 3:\n        case 16: {\n            const dpi'],
  ['        case 4: {\n            const pollingRateHz', '        case 4:\n        case 17: {\n            const pollingRateHz'],
]
let changed = false
for (const [from, to] of patches) {
  if (code.includes(to)) continue
  if (!code.includes(from)) throw new Error('patch-protocol: the Finalmouse decoder changed; update the patch.')
  code = code.replace(from, to)
  changed = true
}
if (changed) writeFileSync(file, code)
console.log(changed ? 'patch-protocol: Finalmouse Starlight X decoder patched.' : 'patch-protocol: already patched.')
