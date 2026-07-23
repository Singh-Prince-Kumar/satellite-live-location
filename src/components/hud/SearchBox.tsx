import { useMemo, useRef, useState } from 'react'
import type { SatInfo } from '@/lib/satellites'

interface SearchBoxProps {
  sats: SatInfo[]
  onSelect: (index: number) => void
}

/** subsequence fuzzy match: does `q` appear in `name` in order? */
function fuzzy(name: string, q: string): boolean {
  let i = 0
  for (const ch of name) {
    if (ch === q[i]) i++
    if (i >= q.length) return true
  }
  return false
}

export default function SearchBox({ sats, onSelect }: SearchBoxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (q.length < 2) return []
    const exact: number[] = []
    const prefix: number[] = []
    const nameHits: number[] = []
    const fuzzyHits: number[] = []
    const isNum = /^\d+$/.test(q)
    for (let i = 0; i < sats.length; i++) {
      const s = sats[i]
      if (isNum) {
        const id = String(s.norad)
        if (id === q) exact.push(i)
        else if (id.startsWith(q)) prefix.push(i)
      }
      const nm = s.name.toUpperCase()
      if (nm.includes(q)) nameHits.push(i)
      else if (!isNum && fuzzy(nm, q)) fuzzyHits.push(i)
      if (exact.length + prefix.length + nameHits.length + fuzzyHits.length >= 24) break
    }
    return [...exact, ...prefix, ...nameHits, ...fuzzyHits].slice(0, 8)
  }, [query, sats])

  const choose = (index: number) => {
    onSelect(index)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results.length > 0) choose(results[0])
          if (e.key === 'Escape') {
            if (query) {
              setQuery('')
            } else {
              inputRef.current?.blur()
            }
            setOpen(false)
          }
        }}
        placeholder="Search name or NORAD ID…"
        className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-sky-400/40"
      />
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-white/10 bg-[#0b0f16]/95 backdrop-blur-md">
          {results.map((i) => (
            <button
              key={sats[i].norad}
              onClick={() => choose(i)}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-sky-400/10"
            >
              <span className="truncate text-slate-200">{sats[i].name}</span>
              <span className="shrink-0 tabular-nums text-slate-500">#{sats[i].norad}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
