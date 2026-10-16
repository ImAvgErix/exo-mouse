// Fixes in @openmouse/protocol that Exo Mouse needs before upstream ships them.
// Each patch names the version it was written against and stops the build when
// that changes, so a fixed release is noticed and the patch deleted.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/@openmouse/protocol')
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
if (version !== '0.42.2') throw new Error(`@openmouse/protocol is ${version}; check scripts/patch-protocol.mjs against it.`)

const files = {
  // Starlight X: the receiver answers DPI and polling rate as commands 16 and 17
  // (the same numbers they are set with), which the decoder did not read, so
  // readStatus never saw them and failed. Captured on a Starlight X dongle
  // (361d:0300, firmware 1.1.1): 04 10 02 40 06 = 1600 DPI, 04 11 02 e8 03 = 1000 Hz.
  'dist/finalmouse/index.js': [
    ['        case 3: {\n            const dpi', '        case 3:\n        case 16: {\n            const dpi'],
    ['        case 4: {\n            const pollingRateHz', '        case 4:\n        case 17: {\n            const pollingRateHz'],
  ],
  // Starlight X receiver light, as xpanel has it (xpanel.finalmouse.com, dongle LED
  // page and its protocol chunk): command 20 takes Off 0, Battery 1, Custom colour 2
  // and TMR-DS 4 (Starlight X only); the custom colour is command 54, three bytes
  // r g b, read by sending 54 with no payload. The driver refused mode 4 and never
  // asked for the colour, so neither could be shown or set.
  'dist/drivers/finalmouse/hid.js': [
    [
      '        if (![0, 1, 2].includes(mode))\n            throw new Error("Unsupported Finalmouse dongle LED mode.");',
      '        if (![0, 1, 2, ...(this.isSlx ? [4] : [])].includes(mode))\n            throw new Error("Unsupported Finalmouse dongle LED mode.");',
    ],
    [
      '            await this.write(tx, FINALMOUSE_COMMAND.pawLod);\n        }',
      '            await this.write(tx, FINALMOUSE_COMMAND.pawLod);\n            await this.write(tx, FINALMOUSE_COMMAND.indicatorColor);\n        }',
    ],
    [
      '            finalmouseDongleLedMode: state.dongleLedMode ?? null,\n',
      '            finalmouseDongleLedMode: state.dongleLedMode ?? null,\n            finalmouseIndicatorColor: state.indicatorColor ? { ...state.indicatorColor } : null,\n',
    ],
    [
      '        await this.write(this.txReport, FINALMOUSE_COMMAND.indicatorColor, encodeFinalmouseIndicatorColor(r, g, b));\n    }',
      '        await this.write(this.txReport, FINALMOUSE_COMMAND.indicatorColor, encodeFinalmouseIndicatorColor(r, g, b));\n        this.telemetry.indicatorColor = { r, g, b };\n    }',
    ],
  ],
}

let changed = 0
for (const [path, patches] of Object.entries(files)) {
  const file = resolve(root, path)
  let code = readFileSync(file, 'utf8')
  const before = code
  for (const [from, to] of patches) {
    if (code.includes(to)) continue
    if (!code.includes(from)) throw new Error(`patch-protocol: ${path} changed; update the patch.`)
    code = code.replace(from, to)
  }
  if (code !== before) { writeFileSync(file, code); changed++ }
}
console.log(changed ? 'patch-protocol: Finalmouse Starlight X driver patched.' : 'patch-protocol: already patched.')
