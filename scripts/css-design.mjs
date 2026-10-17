// Exo's hover and type rules (src/mouse.css header) for every CSS file, run by `npm run check`.
//   exo/hover-fill      a :hover rule never paints a see-through white background; use var(--hover-fill).
//   exo/no-hover-fade   a :hover rule never lowers opacity (opacity: 1 to reveal a control is fine).
//   exo/type-scale      font sizes come from the scale; anything else is a named exception in css-design.config.mjs.
// A genuine exception at one declaration: `/* design-disable-next-line <rule> -- why */` (the why is required).
// Plain PostCSS (already in the toolchain through Vite) rather than Stylelint, whose glob dependency
// carries a high-severity advisory with no fixed release.
//   node scripts/css-design.mjs [config] [dir]
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import postcss from 'postcss'

const [configPath = 'css-design.config.mjs', dir = 'src'] = process.argv.slice(2)
const config = (await import(pathToFileURL(path.resolve(configPath)).href)).default
const sizes = new Set(config.sizes ?? [])
const exceptions = config.exceptions ?? []

const isHover = (rule) => rule?.type === 'rule' && /:hover\b/.test(rule.selector)
const num = (s) => (s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s))
const norm = (s) => s.replace(/\s+/g, ' ').trim()

/** True for a white (or near-white) colour with alpha below 1, in any notation. */
export function translucentWhite(value) {
  const v = value.toLowerCase().replace(/\s+/g, ' ')
  if (/#f{3}[0-9a-e]\b|#f{6}[0-9a-f][0-9a-e]\b/.test(v)) return true
  for (const m of v.matchAll(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)\s*[,/]\s*([\d.]+%?)\s*\)/g)) {
    if (+m[1] >= 240 && +m[2] >= 240 && +m[3] >= 240 && num(m[4]) < 1) return true
  }
  for (const m of v.matchAll(/hsla?\(\s*[\d.]+(?:deg)?[ ,]+[\d.]+%[ ,]+([\d.]+)%\s*[,/]\s*([\d.]+%?)\s*\)/g)) {
    if (+m[1] >= 94 && num(m[2]) < 1) return true
  }
  for (const m of v.matchAll(/color-mix\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    if (/\b(white|#fff(fff)?)\b/.test(m[1]) && /\btransparent\b/.test(m[1])) return true
  }
  return false
}

/** On scale: calc(Npx * var(--exo-scale, 1)) with N in sizes, a type token, inherit, or 0 (text hidden). */
function onScale(value) {
  const v = norm(value)
  if (/^(inherit|0|var\(--(exo-)?type-[a-z-]+\))$/.test(v)) return true
  const m = /^calc\(([\d.]+)px \* var\(--exo-scale, 1\)\)$/.exec(v)
  return !!m && sizes.has(+m[1])
}

/** The rule a `design-disable-next-line` comment right before this declaration turns off, if any. */
function disabledRule(decl) {
  const prev = decl.prev()
  if (prev?.type !== 'comment') return null
  const m = /^design-disable-next-line\s+(exo\/[a-z-]+)\s+--\s+\S/.exec(prev.text.trim())
  return m ? m[1] : null
}

const problems = []
const used = new Set()
function report(file, decl, rule, message) {
  if (disabledRule(decl) === rule) { used.add(decl.prev()); return }
  problems.push(`${file}:${decl.source?.start?.line ?? 0}  ${message} (${rule})`)
}

function check(file, root) {
  root.walkComments((c) => {
    if (/^design-disable/.test(c.text.trim()) && !/^design-disable-next-line\s+exo\/[a-z-]+\s+--\s+\S/.test(c.text.trim()))
      problems.push(`${file}:${c.source?.start?.line ?? 0}  a design-disable comment names one rule and says why after "--"`)
  })
  root.walkDecls(/^background(-color|-image)?$/, (decl) => {
    if (isHover(decl.parent) && translucentWhite(decl.value))
      report(file, decl, 'exo/hover-fill', `A hover background is never see-through white ("${decl.value}"): use var(--hover-fill)`)
  })
  root.walkDecls('opacity', (decl) => {
    const v = decl.value.trim()
    if (isHover(decl.parent) && /^[\d.]+%?$/.test(v) && num(v) < 1)
      report(file, decl, 'exo/no-hover-fade', `Hover never fades ("opacity: ${v}"): change colour, or reveal with opacity: 1`)
  })
  const scale = (decl, value) => {
    if (onScale(value)) return
    const selector = norm(decl.parent?.selector ?? '')
    if (exceptions.some((e) => norm(e.selector) === selector && norm(e.value) === norm(value))) return
    report(file, decl, 'exo/type-scale', `"${value}" is off the type scale (${[...sizes].join('/')}px as calc(Npx * var(--exo-scale, 1))): use a scale size or name an exception in the config`)
  }
  root.walkDecls((decl) => {
    if (decl.prop === 'font-size' || /^--(exo-)?type-/.test(decl.prop)) scale(decl, decl.value)
    else if (decl.prop === 'font' && !/^(inherit|var\()/.test(decl.value.trim())) {
      const size = /(calc\([^)]*\)\)|[\d.]+(px|rem|em))/.exec(decl.value)
      if (size) scale(decl, size[1])
    }
  })
  // A disable comment that turns nothing off is stale.
  root.walkComments((c) => {
    if (/^design-disable-next-line/.test(c.text.trim()) && !used.has(c))
      problems.push(`${file}:${c.source?.start?.line ?? 0}  this design-disable comment turns nothing off; remove it`)
  })
}

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
let files = 0
for (const file of walk(dir).filter((f) => f.endsWith('.css'))) {
  files++
  check(path.relative(process.cwd(), file), postcss.parse(fs.readFileSync(file, 'utf8'), { from: file }))
}
if (problems.length) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} design problem(s) in ${files} CSS file(s).`)
  process.exit(1)
}
