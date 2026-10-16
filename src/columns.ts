import { useEffect, useLayoutEffect, useRef } from 'react'

/** The gap between columns and between panels in a column, as in mouse.css. */
const GAP = 16
/** A column is never narrower than a row's label beside its widest control, nor so wide its rows drift apart (times text size). */
const MIN_COLUMN = 380
const MAX_COLUMN = 840
/** Beside the hero, a column reads best at about this width; what the columns do not need goes to the hero's picture. */
const COMFORT_COLUMN = 560
/** One column whose neighbouring panels may sit in pairs: wide enough for two narrow ones. */
const PAIRED_COLUMN = 920
/** The hero's least width, and the room width under which it stacks above the settings (mouse.css). */
const HERO_MIN = 280
const STACKED = '(max-width: 860px)'
/**
 * Row heights, roomiest first. A row keeps a natural height whatever the room
 * (52 down to 44): spare height never stretches rows apart.
 */
const ROWS = [52, 48, 44]
/** Two halves this close in height count as level. */
const ALIKE = 8

/**
 * Either balanced columns (`groups`: each panel's column) or one column of
 * lines (`lines`: the panels on each line, one or two side by side).
 */
type Shape = { groups: number[]; lines: null } | { groups: null; lines: number[][] }
type Plan = Shape & { panels: HTMLElement[]; width: number; height: number; scale: number; rowMin: number }

const scale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--exo-scale')) || 1

/**
 * Contiguous groups of panels, in order, into at most `count` columns, keeping
 * the tallest column as short as it can be. Returns each panel's column.
 */
function partition(heights: number[], count: number): number[] {
  const n = heights.length
  const sum = (a: number, b: number) => heights.slice(a, b).reduce((t, h) => t + h, 0) + GAP * (b - a - 1)
  // best[k][i]: the tallest column when the first i panels fill k columns; cut[k][i]: where the last column starts.
  const best = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(Infinity))
  const cut = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(0))
  best[0][0] = 0
  for (let k = 1; k <= count; k++) {
    for (let i = 1; i <= n; i++) {
      for (let j = k - 1; j < i; j++) {
        const tallest = Math.max(best[k - 1][j], sum(j, i))
        if (tallest < best[k][i]) { best[k][i] = tallest; cut[k][i] = j }
      }
    }
  }
  let k = 1
  for (let c = 2; c <= Math.min(count, n); c++) if (best[c][n] < best[k][n]) k = c
  const column = new Array<number>(n).fill(0)
  for (let i = n; k > 0; k--) {
    const j = cut[k][i]
    for (let p = j; p < i; p++) column[p] = k - 1
    i = j
  }
  return column
}

const tallest = (heights: number[], groups: number[]) => {
  const columns: number[] = []
  heights.forEach((h, i) => { columns[groups[i]] = (columns[groups[i]] === undefined ? 0 : columns[groups[i]] + GAP) + h })
  return Math.max(0, ...columns)
}

/**
 * One line's halves: a single spans both; a pair is one panel a side; three
 * are one panel on the left beside the next two stacked on the right.
 */
const halves = (line: number[], half: number[]): [number, number] =>
  line.length === 2 ? [half[line[0]], half[line[1]]] : [half[line[0]], half[line[1]] + GAP + half[line[2]]]

/** How tall one column of lines stands: a single at full width, otherwise its taller half. */
const linesHeight = (lines: number[][], full: number[], half: number[]) =>
  lines.reduce((t, line) => t + (line.length === 1 ? full[line[0]] : Math.max(...halves(line, half))), 0) + GAP * Math.max(0, lines.length - 1)

/** How far a line's halves differ in height: the empty space a side would show. */
const uneven = (lines: number[][], half: number[]) =>
  lines.reduce((t, line) => t + (line.length === 1 ? 0 : Math.abs(halves(line, half)[0] - halves(line, half)[1])), 0)

/** Every way to set panels 0..n-1 in lines of one, two or three neighbours, most shared first (a single across the wide column spreads its rows apart). */
function pairings(n: number): number[][][] {
  const all: number[][][] = []
  const walk = (i: number, lines: number[][]) => {
    if (i >= n) { all.push(lines); return }
    walk(i + 1, [...lines, [i]])
    if (i + 1 < n) walk(i + 2, [...lines, [i, i + 1]])
    if (i + 2 < n) walk(i + 3, [...lines, [i, i + 1, i + 2]])
  }
  walk(0, [])
  return all.sort((a, b) => a.length - b.length)
}

/**
 * The settings in the fewest columns that hold them without scrolling, so
 * they fill the room's height and the hero takes the width they leave; rows
 * take the roomiest height that fits. Where one column is a little too tall
 * and two would leave each half empty, neighbouring panels pair up side by
 * side in one wide column instead, as few pairs as fit. The last panel (or
 * pair) of each column reaches the foot. Panels keep their order, top to
 * bottom then left to right. A panel that grows (a switch turned analog,
 * profiles loaded) keeps its place while the plan still fits, so nothing
 * jumps; only when it no longer fits, or the room resizes, is it planned
 * again. When nothing fits, the columns scroll together. Everything happens
 * before paint.
 *
 * The grid holds the panels (`.m-panel`) and empty `.m-break` spans that end
 * a column; this sets each one's `order`, or, paired, makes the grid two
 * tracks and spans each single across both.
 */
export function useColumns() {
  const box = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const plan = useRef<Plan | null>(null)

  const layout = useRef(() => {
    const settings = box.current
    const g = grid.current
    const room = settings?.parentElement
    if (!settings || !g || !room) return
    const panels = [...g.querySelectorAll<HTMLElement>(':scope > .m-panel')]
    const breaks = [...g.querySelectorAll<HTMLElement>(':scope > .m-break')]
    const s = scale()
    // Beside the hero, the settings may take all but the hero's least; stacked under it (a narrow room), all of it.
    const stacked = matchMedia(STACKED).matches
    const look = getComputedStyle(room)
    const inner = room.clientWidth - parseFloat(look.paddingLeft) - parseFloat(look.paddingRight)
    const width = stacked ? inner : inner - HERO_MIN - GAP
    const height = settings.clientHeight
    /** A column's width when `count` share the room: never wider than reads well beside the hero, which takes the rest. */
    const columnWidth = (count: number) => {
      const share = (width - GAP * (count - 1)) / count
      return stacked ? share : Math.min(share, COMFORT_COLUMN * s)
    }
    const pairedWidth = Math.min(width, PAIRED_COLUMN * s)
    const halfWidth = (pairedWidth - GAP) / 2

    // Natural heights at a column width and row height: panels unstretched, one column, rows at their least.
    g.classList.add('is-measuring')
    g.classList.remove('is-paired')
    const measure = (w: number, rowMin: number) => {
      g.style.setProperty('--col-w', `${w}px`)
      g.style.setProperty('--row-min', `${rowMin}px`)
      return panels.map(p => p.offsetHeight)
    }

    const last = plan.current
    const same = !!last && last.width === width && last.height === height && last.scale === s
      && last.panels.length === panels.length && last.panels.every((p, i) => p === panels[i])
    let shape: Shape | null = null
    let rowMin = ROWS[ROWS.length - 1]
    let total = 0
    // The plan in place, while it still fits.
    if (same && last!.lines) {
      const t = linesHeight(last!.lines, measure(pairedWidth, last!.rowMin), measure(halfWidth, last!.rowMin))
      if (t <= height) { shape = { groups: null, lines: last!.lines }; rowMin = last!.rowMin; total = t }
    } else if (same && last!.groups) {
      const count = Math.max(...last!.groups) + 1
      const t = tallest(measure(columnWidth(count), last!.rowMin), last!.groups)
      if (t <= height) { shape = { groups: last!.groups, lines: null }; rowMin = last!.rowMin; total = t }
    }
    if (!shape) {
      const fewest = stacked ? Math.max(1, Math.ceil((width + GAP) / (MAX_COLUMN * s + GAP))) : 1
      const most = Math.max(fewest, Math.min(breaks.length + 1, panels.length, Math.floor((width + GAP) / (MIN_COLUMN * s + GAP))))
      const canPair = fewest === 1 && panels.length > 1 && halfWidth >= MIN_COLUMN * s
      let fallback: { shape: Shape; rowMin: number; total: number } | null = null
      search: for (let c = fewest; c <= most; c++) {
        for (const r of ROWS) {
          const heights = measure(columnWidth(c), r)
          const groups = partition(heights, c)
          const t = tallest(heights, groups)
          fallback = { shape: { groups, lines: null }, rowMin: r, total: t }
          if (t <= height) { shape = fallback.shape; rowMin = r; total = t; break search }
        }
        if (c === 1 && canPair) {
          for (const r of ROWS) {
            const full = measure(pairedWidth, r)
            const half = measure(halfWidth, r)
            // Of the ways that fit, the one whose pairs are most alike in height, so no half stands empty.
            let best: number[][] | null = null
            for (const lines of pairings(panels.length)) {
              if (lines.length === panels.length || linesHeight(lines, full, half) > height) continue
              // Within a few pixels, alike; the earlier (more shared) way stands.
              if (!best || uneven(lines, half) < uneven(best, half) - ALIKE) best = lines
            }
            if (best) { shape = { groups: null, lines: best }; rowMin = r; total = linesHeight(best, full, half); break search }
          }
        }
      }
      if (!shape && fallback) ({ shape, rowMin, total } = fallback)
      if (!shape) shape = { groups: [], lines: null }
      // Fewer panels than columns: the ones there are share the width.
      if (shape.groups) {
        const used = Math.max(0, ...shape.groups) + 1
        total = tallest(measure(columnWidth(used), rowMin), shape.groups)
      }
    }
    plan.current = { ...shape, panels, width, height, scale: s, rowMin }

    const count = shape.groups ? Math.max(0, ...shape.groups) + 1 : 1
    const settingsWidth = shape.lines ? pairedWidth : columnWidth(count) * count + GAP * (count - 1)
    if (stacked) room.style.removeProperty('--settings-w')
    else room.style.setProperty('--settings-w', `${settingsWidth}px`)

    // Fits: the columns fill the room. Does not: they are as tall as the tallest, and scroll.
    g.style.setProperty('--grid-h', `${Math.max(height, total)}px`)
    g.style.setProperty('--col-w', `${shape.lines ? pairedWidth : columnWidth(count)}px`)
    if (shape.lines) {
      // One column of lines: two tracks, singles across both, the last line taking what is left.
      g.classList.add('is-paired')
      let row = 1
      const place = (i: number, gridRow: string, gridColumn: string) => {
        panels[i].style.order = ''
        panels[i].style.gridRow = gridRow
        panels[i].style.gridColumn = gridColumn
      }
      for (const line of shape.lines) {
        if (line.length === 1) place(line[0], `${row}`, '1 / -1')
        else {
          place(line[0], line.length === 3 ? `${row} / span 2` : `${row}`, '1')
          place(line[1], `${row}`, '2')
          if (line.length === 3) place(line[2], `${row + 1}`, '2')
        }
        row += line.length === 3 ? 2 : 1
      }
      g.style.gridTemplateRows = `repeat(${row - 2}, auto) minmax(auto, 1fr)`
      breaks.forEach(b => { b.hidden = true })
    } else {
      // Rows keep their height; the last panel of each column reaches the foot, so the columns end level.
      const groups = shape.groups
      g.style.removeProperty('grid-template-rows')
      panels.forEach((p, i) => {
        p.style.gridColumn = ''
        p.style.gridRow = ''
        p.style.order = String(groups[i] * 2)
        p.style.setProperty('--grow', groups[i + 1] === groups[i] ? '0' : '1')
      })
      breaks.forEach((b, i) => {
        b.style.order = String(i * 2 + 1)
        b.hidden = i >= count - 1
      })
    }
    g.classList.remove('is-measuring')
  })

  // Every render: a panel may have appeared, gone or changed its rows.
  useLayoutEffect(() => layout.current())

  useEffect(() => {
    const run = () => layout.current()
    const sizes = new ResizeObserver(run)
    // The room as well as the settings: the hero takes a room's new width without the settings changing size.
    if (box.current) sizes.observe(box.current)
    if (box.current?.parentElement) sizes.observe(box.current.parentElement)
    // Exo's text size lands on the root's style (host-look.ts).
    const look = new MutationObserver(run)
    look.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    void document.fonts.ready.then(run)
    return () => { sizes.disconnect(); look.disconnect() }
  }, [])

  return { box, grid }
}
