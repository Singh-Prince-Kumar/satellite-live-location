import { UI_GROUPS } from '@/lib/satellites'
import type { SatInfo } from '@/lib/satellites'
import { formatUtc } from '@/lib/satellites'

export interface Telemetry {
  lat: number
  lon: number
  alt: number
  speed: number
  period: number
  incl: number
}

interface DetailPanelProps {
  sat: SatInfo
  telemetry: Telemetry | null
  showOrbit: boolean
  showFoot: boolean
  follow: boolean
  onToggleOrbit: () => void
  onToggleFoot: () => void
  onToggleFollow: () => void
  onClose: () => void
}

export default function DetailPanel({
  sat,
  telemetry,
  showOrbit,
  showFoot,
  follow,
  onToggleOrbit,
  onToggleFoot,
  onToggleFollow,
  onClose,
}: DetailPanelProps) {
  const rows: [string, string][] = telemetry
    ? [
        ['Latitude', `${telemetry.lat.toFixed(3)}°`],
        ['Longitude', `${telemetry.lon.toFixed(3)}°`],
        ['Altitude', `${telemetry.alt.toFixed(1)} km`],
        ['Velocity', `${telemetry.speed.toFixed(2)} km/s`],
        ['Orbital period', `${telemetry.period.toFixed(1)} min`],
        ['Inclination', `${telemetry.incl.toFixed(2)}°`],
        ['TLE epoch', sat.epochMs ? formatUtc(sat.epochMs) : 'unknown'],
      ]
    : []

  return (
    <div
      className="absolute z-20 rounded-2xl border border-white/10 bg-[#0a0e14]/80 backdrop-blur-xl
        max-md:inset-x-2 max-md:bottom-2 max-md:max-h-[46vh] max-md:overflow-y-auto
        md:right-6 md:top-6 md:w-[300px]"
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{sat.name}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            NORAD #{sat.norad} · {UI_GROUPS[sat.group]?.label ?? 'Unknown'}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-white/10 hover:text-slate-200"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      {telemetry ? (
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <div className="text-slate-500">{k}</div>
              <div className="text-right tabular-nums text-slate-200">{v}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 px-4 text-xs text-slate-500">
          Propagation unavailable for this satellite.
        </div>
      )}
      <div className="mt-4 flex gap-1.5 px-4 pb-4">
        {(
          [
            ['Orbit', showOrbit, onToggleOrbit],
            ['Footprint', showFoot, onToggleFoot],
            ['Follow', follow, onToggleFollow],
          ] as const
        ).map(([label, val, fn]) => (
          <button
            key={label}
            onClick={fn}
            className={`flex-1 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
              val
                ? 'border-sky-400/40 bg-sky-400/15 text-sky-200'
                : 'border-white/10 text-slate-400 hover:bg-white/5'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
