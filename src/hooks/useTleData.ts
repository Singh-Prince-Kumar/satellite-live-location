import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildDataset,
  isValidTleText,
  MIN_VALID_SATS,
  parseTle,
} from '@/lib/satellites'
import type { Dataset } from '@/lib/satellites'
import { cacheGet, cacheSet } from '@/lib/tle-cache'

const CELESTRAK_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle'
const SNAPSHOT_URL = `${import.meta.env.BASE_URL}data/tle-snapshot.txt`
export const TLE_TTL_MS = 2 * 3600 * 1000

export interface TleDataState {
  /** 'loading' only until the first usable dataset exists. */
  status: 'loading' | 'ready' | 'error'
  dataset: Dataset | null
  error: string | null
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

function parseValidated(text: string) {
  if (!isValidTleText(text)) throw new Error('invalid TLE structure')
  const sats = parseTle(text)
  if (sats.length < MIN_VALID_SATS) {
    throw new Error(`too few satellites (${sats.length})`)
  }
  return sats
}

/**
 * Data pipeline:
 *  1. bundled snapshot -> immediate first render (~2s)
 *  2. IndexedDB cache (fresh < 2h) -> upgrade to CACHED
 *  3. CelesTrak live fetch in background -> upgrade to LIVE + re-cache
 * A generation id ignores stale responses; the old dataset stays active
 * until a complete validated replacement is ready.
 */
export function useTleData() {
  const [state, setState] = useState<TleDataState>({
    status: 'loading',
    dataset: null,
    error: null,
  })
  const genRef = useRef(0)
  const busyRef = useRef(false)
  const invalidate = useCallback(() => {
    genRef.current += 1
  }, [])

  /** Background live refresh; never disturbs the UI on failure. */
  const refreshLive = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    const myGen = genRef.current
    try {
      const text = await fetchText(CELESTRAK_URL, 15000)
      const sats = parseValidated(text)
      const fetchedAt = Date.now()
      if (genRef.current !== myGen) return
      setState((prev) => ({
        status: 'ready',
        dataset: buildDataset(sats, 'live', fetchedAt),
        error: prev.error,
      }))
      void cacheSet({ text, fetchedAt })
    } catch {
      /* 403 / timeout / offline: keep current dataset */
    } finally {
      busyRef.current = false
    }
  }, [])

  const initialLoad = useCallback(async () => {
    const gen = ++genRef.current
    const isStale = () => genRef.current !== gen

    // 1. snapshot first — the globe must appear within ~2 seconds.
    // Retry with growing timeouts: on very slow devices the main thread may
    // be busy compiling shaders, starving the fetch continuation.
    let lastErr: unknown = null
    for (const timeoutMs of [10000, 20000, 30000]) {
      try {
        const text = await fetchText(SNAPSHOT_URL, timeoutMs)
        const sats = parseValidated(text)
        if (isStale()) return
        setState({
          status: 'ready',
          dataset: buildDataset(sats, 'snapshot', Date.now()),
          error: null,
        })
        lastErr = null
        break
      } catch (err) {
        lastErr = err
      }
    }
    if (lastErr) {
      if (isStale()) return
      setState({
        status: 'error',
        dataset: null,
        error: lastErr instanceof Error ? lastErr.message : String(lastErr),
      })
      // continue anyway: live fetch below may still succeed
    }

    // 2. fresh cache from a previous session -> CACHED
    try {
      const cached = await cacheGet()
      if (cached && Date.now() - cached.fetchedAt < TLE_TTL_MS) {
        const sats = parseValidated(cached.text)
        if (isStale()) return
        setState({
          status: 'ready',
          dataset: buildDataset(sats, 'cached', cached.fetchedAt),
          error: null,
        })
      }
    } catch {
      /* invalid cache — ignore */
    }

    // 3. live fetch in background
    void refreshLive()
  }, [refreshLive])

  useEffect(() => {
    void initialLoad()
    const id = setInterval(() => void refreshLive(), TLE_TTL_MS)
    return () => {
      invalidate() // ignore in-flight responses after unmount
      clearInterval(id)
    }
  }, [initialLoad, refreshLive, invalidate])

  return state
}
