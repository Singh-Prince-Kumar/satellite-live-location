// Satellite data model: TLE parsing, validation, classification, grouping.

export interface SatInfo {
  name: string
  norad: number
  l1: string
  l2: string
  /** UI group index (see UI_GROUPS). */
  group: number
  /** TLE epoch as ms since Unix epoch. */
  epochMs: number
}

export interface UiGroupDef {
  key: string
  label: string
  color: string
  size: number
}

/** The five high-level groups shown in the UI. */
export const UI_GROUPS: UiGroupDef[] = [
  { key: 'stations', label: 'Space Stations', color: '#ffe9a8', size: 2.6 },
  { key: 'starlink', label: 'Starlink', color: '#79d2ff', size: 1.15 },
  { key: 'oneweb', label: 'OneWeb', color: '#c4b5fd', size: 1.35 },
  { key: 'navigation', label: 'Navigation', color: '#fbbf24', size: 1.45 },
  { key: 'other', label: 'Other Active Satellites', color: '#9aa7bd', size: 1.0 },
]

// Internal detailed classification (GPS/GLONASS/Galileo/BeiDou stay distinct
// internally, then merge into Navigation for the UI).
const Internal = {
  Starlink: 0,
  OneWeb: 1,
  Gps: 2,
  Glonass: 3,
  Galileo: 4,
  BeiDou: 5,
  Iridium: 6,
  Weather: 7,
  Stations: 8,
  Other: 9,
} as const
type Internal = (typeof Internal)[keyof typeof Internal]

/** Internal class -> UI group index. */
const INTERNAL_TO_UI: number[] = [
  1, // starlink
  2, // oneweb
  3, // gps -> navigation
  3, // glonass -> navigation
  3, // galileo -> navigation
  3, // beidou -> navigation
  4, // iridium -> other
  4, // weather -> other
  0, // stations
  4, // other
]

const WEATHER_PREFIXES = [
  'NOAA', 'GOES', 'METEOSAT', 'METOP', 'FENGYUN', 'FY-', 'HIMAWARI',
  'ELECTRO-L', 'DMSP', 'GOMS', 'INSAT', 'KALPANA', 'GEO-KOMPSAT', 'ARSAT',
]

function classifyInternal(nameRaw: string): Internal {
  const n = nameRaw.trim().toUpperCase()
  if (n.startsWith('STARLINK')) return Internal.Starlink
  if (n.startsWith('ONEWEB')) return Internal.OneWeb
  if (n.startsWith('GPS ') || n.startsWith('NAVSTAR')) return Internal.Gps
  if (n.includes('GLONASS')) return Internal.Glonass
  if (n.includes('GALILEO') || n.startsWith('GSAT')) return Internal.Galileo
  if (n.startsWith('BEIDOU')) return Internal.BeiDou
  if (n.startsWith('IRIDIUM')) return Internal.Iridium
  if (
    n.includes('ISS') || n.includes('ZARYA') || n.includes('TIANGONG') ||
    n.startsWith('CSS') || n.includes('TIANHE') || n.includes('WENTIAN') ||
    n.includes('MENGTIAN')
  ) {
    return Internal.Stations
  }
  for (const p of WEATHER_PREFIXES) if (n.startsWith(p)) return Internal.Weather
  return Internal.Other
}

/** Parse the TLE epoch (line 1 columns 19-32: YYDDD.DDDDDDDD) to ms. */
export function tleEpochMs(l1: string): number {
  const yy = parseInt(l1.substring(18, 20), 10)
  const day = parseFloat(l1.substring(20, 32))
  if (!isFinite(yy) || !isFinite(day)) return 0
  const year = yy < 57 ? 2000 + yy : 1900 + yy
  return Date.UTC(year, 0, 1) + (day - 1) * 86400000
}

/**
 * Parse 3LE/TLE text into validated, NORAD-deduplicated SatInfo records,
 * sorted by UI group so each group's indices are contiguous.
 */
export function parseTle(text: string): SatInfo[] {
  const lines = text.split(/\r?\n/)
  const byNorad = new Map<number, SatInfo>()
  let name = ''
  let l1 = ''
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('1 ') && line.length >= 60) {
      l1 = line
    } else if (line.startsWith('2 ') && line.length >= 60 && l1) {
      const norad = parseInt(l1.substring(2, 7), 10)
      if (isFinite(norad) && !byNorad.has(norad)) {
        const nm = (name.trim() || `NORAD ${norad}`).replace(/\s+/g, ' ')
        byNorad.set(norad, {
          name: nm,
          norad,
          l1,
          l2: line,
          group: INTERNAL_TO_UI[classifyInternal(nm)],
          epochMs: tleEpochMs(l1),
        })
      }
      name = ''
      l1 = ''
    } else if (line.length > 0 && !line.startsWith('#')) {
      name = line
      l1 = ''
    }
  }
  const sats = [...byNorad.values()]
  sats.sort((a, b) => a.group - b.group)
  return sats
}

/** A response must parse to at least this many satellites to be accepted. */
export const MIN_VALID_SATS = 1000

export function isValidTleText(text: string): boolean {
  if (!text || text.length < 1000) return false
  // structural sanity: must contain TLE line pairs
  const l1 = text.indexOf('\n1 ')
  const l2 = text.indexOf('\n2 ')
  return (text.startsWith('1 ') || l1 >= 0) && l2 >= 0
}

export type DataSource = 'live' | 'cached' | 'snapshot'

export interface Dataset {
  sats: SatInfo[]
  counts: number[]
  /** most recent TLE epoch in the set (ms) */
  epochMs: number
  source: DataSource
  /** when the data was fetched from the network (ms) */
  fetchedAt: number
  /** total deduplicated objects */
  total: number
}

export function buildDataset(
  sats: SatInfo[],
  source: DataSource,
  fetchedAt: number,
): Dataset {
  const counts = new Array(UI_GROUPS.length).fill(0)
  const epochs: number[] = []
  for (const s of sats) {
    counts[s.group]++
    if (s.epochMs > 0) epochs.push(s.epochMs)
  }
  // median epoch is robust against a few future-dated or stale TLEs
  epochs.sort((a, b) => a - b)
  const epoch = epochs.length ? epochs[Math.floor(epochs.length / 2)] : 0
  return { sats, counts, epochMs: epoch, source, fetchedAt, total: sats.length }
}

/** "3h 12m" / "2d 4h" style age string from the newest TLE epoch. */
export function tleAge(epochMs: number, nowMs: number): string {
  if (!epochMs) return 'unknown'
  const mins = Math.max(0, Math.round((nowMs - epochMs) / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 48) return `${h}h ${mins % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function formatUtc(ms: number): string {
  const d = new Date(ms)
  const p = (v: number) => String(v).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`
  )
}
