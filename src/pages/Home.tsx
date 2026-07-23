import { useCallback, useEffect, useRef, useState } from 'react'
import * as satellite from 'satellite.js'
import { GlobeEngine } from '@/lib/globe-engine'
import { UI_GROUPS } from '@/lib/satellites'
import type { SatInfo } from '@/lib/satellites'
import { useSimClock } from '@/hooks/useSimClock'
import { useTleData } from '@/hooks/useTleData'
import { usePropagator } from '@/hooks/usePropagator'
import TrackerHud from '@/components/hud/TrackerHud'
import SearchBox from '@/components/hud/SearchBox'
import DetailPanel from '@/components/hud/DetailPanel'
import type { Telemetry } from '@/components/hud/DetailPanel'
import FallbackTable from '@/components/FallbackTable'

const EARTH_R = 6371
const EMPTY_SATS: SatInfo[] = []

interface HoverState {
  index: number
  x: number
  y: number
}

function detectWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

function setUrlSat(norad: number | null) {
  const url = new URL(window.location.href)
  if (norad === null) url.searchParams.delete('sat')
  else url.searchParams.set('sat', String(norad))
  window.history.replaceState(null, '', url)
}

export default function Home() {
  const mountRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<GlobeEngine | null>(null)
  const clock = useSimClock()
  const { status, dataset, error } = useTleData()

  const [webglOk] = useState(detectWebGL)
  const [ctxLost, setCtxLost] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [selectedNorad, setSelectedNorad] = useState<number | null>(null)
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [groupVisible, setGroupVisible] = useState<boolean[]>(() =>
    UI_GROUPS.map(() => true),
  )
  const [showOrbit, setShowOrbit] = useState(true)
  const [showFoot, setShowFoot] = useState(true)
  const [follow, setFollow] = useState(false)

  const satsRef = useRef<SatInfo[]>(EMPTY_SATS)
  const noradMapRef = useRef(new Map<number, number>())
  const recCache = useRef(new Map<number, satellite.SatRec>())
  const groupVisibleRef = useRef(groupVisible)
  groupVisibleRef.current = groupVisible
  const selectedNoradRef = useRef<number | null>(null)
  selectedNoradRef.current = selectedNorad
  const urlInitRef = useRef(false)

  const sats = dataset?.sats ?? EMPTY_SATS

  const getRec = useCallback((index: number): satellite.SatRec | null => {
    const cached = recCache.current.get(index)
    if (cached) return cached
    const s = satsRef.current[index]
    if (!s) return null
    try {
      const rec = satellite.twoline2satrec(s.l1, s.l2)
      recCache.current.set(index, rec)
      return rec
    } catch {
      return null
    }
  }, [])

  // ---- direct SGP4 providers for the selected satellite (exact sim time) ----
  const orbitProvider = useCallback(
    (index: number, simMs: number, past: Float32Array, future: Float32Array) => {
      const rec = getRec(index)
      if (!rec) return
      const periodMs = ((2 * Math.PI) / rec.no) * 60 * 1000
      const n = past.length / 3
      const fill = (out: Float32Array, startMs: number, endMs: number) => {
        let lx = 0
        let ly = 0
        let lz = 0
        for (let i = 0; i < n; i++) {
          const t = startMs + ((endMs - startMs) * i) / (n - 1)
          try {
            const pv = satellite.propagate(rec, new Date(t))
            const p = pv?.position
            if (p && isFinite(p.x)) {
              lx = p.x / EARTH_R
              ly = p.y / EARTH_R
              lz = p.z / EARTH_R
            }
          } catch {
            /* keep last */
          }
          out.set([lx, ly, lz], i * 3)
        }
      }
      fill(past, simMs - periodMs / 2, simMs)
      fill(future, simMs, simMs + periodMs / 2)
    },
    [getRec],
  )

  const footprintProvider = useCallback(
    (index: number, simMs: number) => {
      const rec = getRec(index)
      if (!rec) return null
      try {
        const pv = satellite.propagate(rec, new Date(simMs))
        const p = pv?.position
        if (!p || !isFinite(p.x)) return null
        const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)
        if (r - EARTH_R < 50) return null
        return { x: p.x / r, y: p.y / r, z: p.z / r, ang: Math.acos(EARTH_R / r) }
      } catch {
        return null
      }
    },
    [getRec],
  )

  // ---- selection (NORAD-stable) ----
  const selectSat = useCallback((index: number | null) => {
    if (index === null) {
      setSelectedIndex(null)
      setSelectedNorad(null)
      engineRef.current?.setSelected(null)
      setUrlSat(null)
      return
    }
    const s = satsRef.current[index]
    if (!s) return
    if (!groupVisibleRef.current[s.group]) {
      // a hidden group's satellite becomes visible when chosen
      setGroupVisible((prev) => {
        const next = [...prev]
        next[s.group] = true
        return next
      })
      engineRef.current?.setGroupVisible(s.group, true)
    }
    setSelectedIndex(index)
    setSelectedNorad(s.norad)
    engineRef.current?.setSelected(index, UI_GROUPS[s.group]?.color)
    setUrlSat(s.norad)
  }, [])

  // ---- engine lifecycle (created once) ----
  useEffect(() => {
    if (!webglOk || !mountRef.current) return
    const engine = new GlobeEngine(mountRef.current, {
      getSimTime: clock.getTime,
      onSelect: (idx) => selectSat(idx),
      onHover: (idx, x, y) => setHover(idx !== null ? { index: idx, x, y } : null),
      onContextLost: () => setCtxLost(true),
      onContextRestored: () => setCtxLost(false),
      orbitProvider,
      footprintProvider,
    })
    engineRef.current = engine
    return () => {
      engine.dispose()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webglOk])

  // ---- dataset -> engine (hot swap; preserves UI state) ----
  useEffect(() => {
    if (!dataset) return
    satsRef.current = dataset.sats
    recCache.current.clear()
    const map = new Map<number, number>()
    dataset.sats.forEach((s, i) => map.set(s.norad, i))
    noradMapRef.current = map

    engineRef.current?.buildSatellites(
      UI_GROUPS.map((g, i) => ({
        color: g.color,
        size: g.size,
        count: dataset.counts[i],
      })),
    )
    groupVisibleRef.current.forEach((v, i) =>
      engineRef.current?.setGroupVisible(i, v),
    )

    // re-resolve selection by NORAD identity
    const norad = selectedNoradRef.current
    if (norad !== null) {
      const idx = map.get(norad)
      if (idx === undefined) {
        setSelectedIndex(null)
        setSelectedNorad(null)
        engineRef.current?.setSelected(null)
        setUrlSat(null)
      } else {
        setSelectedIndex(idx)
        engineRef.current?.setSelected(idx, UI_GROUPS[dataset.sats[idx].group]?.color)
      }
    }

    // initial deep link ?sat=25544&speed=60
    if (!urlInitRef.current) {
      urlInitRef.current = true
      const params = new URLSearchParams(window.location.search)
      const sp = parseInt(params.get('speed') ?? '', 10)
      if ([1, 60, 600].includes(sp)) clock.setSpeed(sp)
      const p = params.get('sat')
      if (p) {
        const idx = map.get(parseInt(p, 10))
        if (idx !== undefined) selectSat(idx)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset])

  const { degraded } = usePropagator(dataset, engineRef, clock)

  // ---- telemetry for the selected satellite (direct SGP4 at exact sim time) ----
  useEffect(() => {
    if (selectedIndex === null) {
      setTelemetry(null)
      return
    }
    const update = () => {
      const rec = getRec(selectedIndex)
      if (!rec) return
      try {
        const simMs = clock.getTime()
        const pv = satellite.propagate(rec, new Date(simMs))
        const p = pv?.position
        const v = pv?.velocity
        if (!p || !v || !isFinite(p.x)) return
        const gmst = satellite.gstime(new Date(simMs))
        const geo = satellite.eciToGeodetic(p, gmst)
        setTelemetry({
          lat: satellite.degreesLat(geo.latitude),
          lon: satellite.degreesLong(geo.longitude),
          alt: geo.height,
          speed: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
          period: (2 * Math.PI) / rec.no,
          incl: (rec.inclo * 180) / Math.PI,
        })
      } catch {
        /* decayed */
      }
    }
    update()
    const id = setInterval(update, 250)
    return () => clearInterval(id)
  }, [selectedIndex, getRec, clock])

  // ---- engine-side option sync ----
  useEffect(() => {
    engineRef.current?.setShowOrbit(showOrbit)
  }, [showOrbit])
  useEffect(() => {
    engineRef.current?.setShowFootprint(showFoot)
  }, [showFoot])
  useEffect(() => {
    engineRef.current?.setFollow(follow)
  }, [follow])

  // Escape clears the selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selectSat(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectSat])

  const toggleGroup = (i: number) => {
    setGroupVisible((prev) => {
      const next = prev.map((v, j) => (j === i ? !v : v))
      engineRef.current?.setGroupVisible(i, next[i])
      return next
    })
  }

  const selSat =
    selectedIndex !== null && selectedIndex < sats.length ? sats[selectedIndex] : null

  // tooltip stays inside the viewport
  const tooltipPos = hover
    ? {
        left: Math.min(hover.x + 14, window.innerWidth - 180),
        top: Math.min(hover.y + 14, window.innerHeight - 44),
      }
    : null

  if (!webglOk) {
    return (
      <div className="h-full w-full overflow-y-auto bg-[#04060a]">
        <FallbackTable dataset={dataset} />
      </div>
    )
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#04060a] font-sans text-slate-200">
      <div ref={mountRef} className="absolute inset-0" />

      {hover && tooltipPos && (
        <div
          className="pointer-events-none fixed z-30 max-w-[170px] truncate rounded-md border border-white/10 bg-[#0b0f16]/90 px-2.5 py-1 text-xs backdrop-blur-sm"
          style={tooltipPos}
        >
          {satsRef.current[hover.index]?.name}
        </div>
      )}

      {dataset && (
        <TrackerHud
          dataset={dataset}
          clock={clock}
          groupVisible={groupVisible}
          onToggleGroup={toggleGroup}
        >
          <SearchBox sats={sats} onSelect={selectSat} />
        </TrackerHud>
      )}

      {selSat && (
        <DetailPanel
          sat={selSat}
          telemetry={telemetry}
          showOrbit={showOrbit}
          showFoot={showFoot}
          follow={follow}
          onToggleOrbit={() => setShowOrbit((v) => !v)}
          onToggleFoot={() => setShowFoot((v) => !v)}
          onToggleFollow={() => setFollow((v) => !v)}
          onClose={() => selectSat(null)}
        />
      )}

      {degraded && (
        <div className="absolute bottom-4 left-4 z-20 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[11px] text-amber-200">
          Live propagation degraded: {degraded}
        </div>
      )}

      <div className="pointer-events-none absolute bottom-4 right-6 z-10 hidden text-right text-[11px] leading-5 text-slate-600 md:block">
        drag to rotate · scroll to zoom
        <br />
        click a satellite to inspect
      </div>

      {ctxLost && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#04060a]/90">
          <div className="rounded-2xl border border-white/10 bg-[#0a0e14] px-6 py-5 text-center">
            <div className="text-sm text-slate-200">Graphics context lost</div>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 rounded-lg border border-sky-400/40 px-3 py-1 text-xs text-sky-200 hover:bg-sky-400/10"
            >
              Reload
            </button>
          </div>
        </div>
      )}

      {status === 'loading' && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#04060a]">
          <div className="text-xl font-bold tracking-[0.3em] text-white">LEO LIVE</div>
          <div className="mt-6 h-7 w-7 animate-spin rounded-full border-2 border-sky-400/25 border-t-sky-300" />
          <div className="mt-4 text-xs text-slate-500">Loading orbital data…</div>
        </div>
      )}

      {status === 'error' && !dataset && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#04060a]">
          <div className="text-xl font-bold tracking-[0.3em] text-white">LEO LIVE</div>
          <div className="mt-6 max-w-sm text-center text-sm text-rose-300">
            Failed to load orbital data{error ? `: ${error}` : '.'}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg border border-rose-400/40 px-3 py-1 text-xs text-rose-200 hover:bg-rose-400/10"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
