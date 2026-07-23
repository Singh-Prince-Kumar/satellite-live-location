import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Dataset } from '@/lib/satellites'
import { formatUtc, tleAge } from '@/lib/satellites'
import type { SimClock } from '@/hooks/useSimClock'
import LayerPanel from './LayerPanel'

const SPEEDS = [1, 60, 600]

interface TrackerHudProps {
  dataset: Dataset
  clock: SimClock
  groupVisible: boolean[]
  onToggleGroup: (index: number) => void
  children?: ReactNode // search box slot
}

const SOURCE_STYLE: Record<Dataset['source'], { dot: string; text: string; label: string }> = {
  live: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'LIVE' },
  cached: { dot: 'bg-sky-400', text: 'text-sky-300', label: 'CACHED' },
  snapshot: { dot: 'bg-amber-400', text: 'text-amber-300', label: 'SNAPSHOT' },
}

export default function TrackerHud({
  dataset,
  clock,
  groupVisible,
  onToggleGroup,
  children,
}: TrackerHudProps) {
  const [now, setNow] = useState(0)

  // throttled UI clock — the authoritative time always comes from anchors
  useEffect(() => {
    const id = setInterval(() => setNow(clock.getTime()), 200)
    return () => clearInterval(id)
  }, [clock])

  const src = SOURCE_STYLE[dataset.source]

  return (
    <div className="absolute left-3 top-3 z-20 md:left-6 md:top-6">
      <div className="w-[340px] max-w-[calc(100vw-24px)] rounded-2xl border border-white/10 bg-[#0a0e14]/75 px-5 py-4 backdrop-blur-xl max-md:max-h-[72vh] max-md:overflow-y-auto">
        <h1 className="text-lg font-bold tracking-[0.28em] text-white">LEO LIVE</h1>
        <p className="mt-1 text-[11px] leading-snug text-slate-400">
          Real-time orbital satellite visualization · CelesTrak TLE × SGP4 propagation
        </p>

        {/* data source */}
        <div className="mt-3 flex items-center gap-2 text-[11px]">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${src.dot}`} />
          <span className={`font-medium tracking-wider ${src.text}`}>{src.label}</span>
          <span className="text-slate-500">
            · fetched {new Date(dataset.fetchedAt).toUTCString().slice(17, 25)} UTC
          </span>
        </div>

        {/* simulated clock */}
        <div data-testid="sim-clock" className="mt-2 text-sm tabular-nums text-slate-100">
          {now > 0 ? formatUtc(now) : '—'}
        </div>

        {/* time controls */}
        <div className="mt-3 flex items-center gap-1">
          <button
            onClick={() => (clock.playing ? clock.pause() : clock.resume())}
            className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10"
            title={clock.playing ? 'Pause' : 'Resume'}
          >
            {clock.playing ? '❚❚' : '▶'}
          </button>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => clock.setSpeed(s)}
              className={`rounded-lg px-2.5 py-1 text-xs tabular-nums transition-colors ${
                clock.speed === s && clock.playing
                  ? 'bg-sky-400/20 text-sky-200'
                  : 'text-slate-400 hover:bg-white/10'
              }`}
            >
              {s}×
            </button>
          ))}
          <button
            onClick={() => clock.goNow()}
            className="rounded-lg px-2.5 py-1 text-xs text-slate-400 hover:bg-white/10"
          >
            Now
          </button>
        </div>

        {/* search slot */}
        {children && <div className="mt-3">{children}</div>}

        {/* groups */}
        <div className="mt-3 border-t border-white/[0.07] pt-3">
          <LayerPanel
            counts={dataset.counts}
            visible={groupVisible}
            onToggle={onToggleGroup}
          />
        </div>

        {/* totals + meta */}
        <div className="mt-3 border-t border-white/[0.07] pt-3 text-[11px] leading-relaxed text-slate-500">
          <div>
            <span className="tabular-nums text-slate-300">
              {dataset.total.toLocaleString()}
            </span>{' '}
            objects · TLE age {tleAge(dataset.epochMs, now)}
          </div>
          <div>TLE refreshes automatically every 2 h in the background.</div>
        </div>
      </div>
    </div>
  )
}
