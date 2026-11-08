import { useEffect, useMemo, useRef, useState } from 'react'

import { useWidth } from './useWidth.ts'
import {
  type View,
  clampView,
  fmtBp,
  fmtBytes,
  fmtTick,
  niceTicks,
  setupCanvas,
  zoomView,
} from './util.ts'

import type { Slice } from './cram.ts'

const RULER_H = 22
const DENSITY_H = 90
const ROW_H = 12
const MAX_ROWS = 8
const SHARED_ROW_OVERLAP = 0.05
const MAX_DRAWN_SLICES = 4000

interface PlacedSlice {
  slice: Slice
  row: number
  containerOrdinal: number
}

function layoutSlices(
  visible: Slice[],
  containerOrdinals: Map<number, number>,
) {
  const rowEnds: number[] = []
  return visible.map(slice => {
    const tolerance = slice.span * SHARED_ROW_OVERLAP
    const free = rowEnds.findIndex(end => end - tolerance <= slice.start)
    const row = free === -1 ? Math.min(rowEnds.length, MAX_ROWS - 1) : free
    rowEnds[row] = Math.max(rowEnds[row] ?? 0, slice.start + slice.span)
    const placed: PlacedSlice = {
      slice,
      row,
      containerOrdinal: containerOrdinals.get(slice.containerStart) ?? 0,
    }
    return placed
  })
}

export default function GenomeView({
  entries,
  refLength,
  view,
  setView,
  inspected,
  onInspect,
}: {
  entries: Slice[]
  refLength: number
  view: View
  setView: (fn: (view: View) => View) => void
  inspected: Slice | undefined
  onInspect: (slice: Slice) => void
}) {
  const [containerRef, width] = useWidth<HTMLDivElement>()
  const densityRef = useRef<HTMLCanvasElement>(null)
  const slicesRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ x: number; view: View; moved: boolean }>(null)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState<PlacedSlice>()

  const containerOrdinals = useMemo(() => {
    const starts = [...new Set(entries.map(e => e.containerStart))].toSorted(
      (a, b) => a - b,
    )
    return new Map(starts.map((s, i) => [s, i]))
  }, [entries])

  const visible = useMemo(
    () =>
      entries.filter(
        e => e.start < view.end && e.start + Math.max(e.span, 1) > view.start,
      ),
    [entries, view],
  )

  const placed = useMemo(
    () =>
      visible.length <= MAX_DRAWN_SLICES
        ? layoutSlices(visible, containerOrdinals)
        : [],
    [visible, containerOrdinals],
  )
  const numRows = Math.max(1, ...placed.map(p => p.row + 1))
  const slicesH = numRows * ROW_H + 4

  const bpPerPx = (view.end - view.start) / Math.max(width, 1)

  const density = useMemo(() => {
    const bins = new Float64Array(Math.max(width, 1))
    for (const e of visible) {
      const perBp = e.sliceBytes / Math.max(e.span, 1)
      const s = Math.max(e.start, view.start)
      const t = Math.min(e.start + Math.max(e.span, 1), view.end)
      const p0 = Math.floor((s - view.start) / bpPerPx)
      const p1 = Math.min(Math.ceil((t - view.start) / bpPerPx), bins.length)
      for (let p = Math.max(p0, 0); p < p1; p++) {
        const binStart = view.start + p * bpPerPx
        const overlap = Math.min(t, binStart + bpPerPx) - Math.max(s, binStart)
        bins[p] = (bins[p] ?? 0) + (perBp * overlap) / bpPerPx
      }
    }
    return bins
  }, [visible, view, width, bpPerPx])

  const maxDensity = useMemo(() => Math.max(...density, 1e-9), [density])

  useEffect(() => {
    const canvas = densityRef.current
    const ctx =
      canvas && width > 0
        ? setupCanvas(canvas, width, RULER_H + DENSITY_H)
        : null
    if (ctx) {
      ctx.fillStyle = '#f7f7f7'
      ctx.fillRect(0, RULER_H, width, DENSITY_H)
      ctx.fillStyle = 'hsl(200, 60%, 45%)'
      for (const [p, v] of density.entries()) {
        const h = (v / maxDensity) * (DENSITY_H - 14)
        ctx.fillRect(p, RULER_H + DENSITY_H - h, 1, h)
      }
      ctx.font = '11px system-ui'
      ctx.fillStyle = '#333'
      ctx.textAlign = 'left'
      ctx.fillText(
        `${fmtBytes(maxDensity * 1000)} per kbp of reference (max)`,
        4,
        RULER_H + 12,
      )
      ctx.strokeStyle = '#999'
      ctx.beginPath()
      ctx.moveTo(0, RULER_H - 0.5)
      ctx.lineTo(width, RULER_H - 0.5)
      ctx.stroke()
      const ticks = niceTicks(view.start, view.end, Math.max(width / 120, 2))
      const step = (ticks[1] ?? Number.POSITIVE_INFINITY) - (ticks[0] ?? 0)
      for (const t of ticks) {
        const x = Math.round((t - view.start) / bpPerPx) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, RULER_H - 6)
        ctx.lineTo(x, RULER_H)
        ctx.stroke()
        const label = fmtTick(t, step)
        const half = ctx.measureText(label).width / 2
        ctx.textAlign = 'center'
        ctx.fillText(
          label,
          Math.min(Math.max(x, half + 1), width - half - 1),
          RULER_H - 9,
        )
      }
    }
  }, [density, maxDensity, width, view, bpPerPx])

  useEffect(() => {
    const canvas = slicesRef.current
    const ctx = canvas && width > 0 ? setupCanvas(canvas, width, slicesH) : null
    if (ctx) {
      if (placed.length === 0 && visible.length > 0) {
        ctx.fillStyle = '#666'
        ctx.font = '12px system-ui'
        ctx.textAlign = 'center'
        ctx.fillText(
          `${visible.length.toLocaleString()} slices in view, zoom in to see them individually`,
          width / 2,
          slicesH / 2 + 4,
        )
      }
      for (const p of placed) {
        const x1 = (p.slice.start - view.start) / bpPerPx
        const w = Math.max(p.slice.span / bpPerPx, 1)
        const isInspected = p.slice === inspected
        const isHover = p.slice === hover?.slice
        ctx.fillStyle = isInspected
          ? '#d1495b'
          : isHover
            ? '#f0a030'
            : p.containerOrdinal % 2 === 0
              ? 'hsl(200, 50%, 55%)'
              : 'hsl(200, 50%, 35%)'
        ctx.fillRect(x1, p.row * ROW_H + 2, w, ROW_H - 2)
        if (w > 3) {
          ctx.fillStyle = '#fff'
          ctx.fillRect(x1, p.row * ROW_H + 2, 1, ROW_H - 2)
        }
      }
    }
  }, [placed, visible, width, view, bpPerPx, slicesH, inspected, hover])

  useEffect(() => {
    const els = [densityRef.current, slicesRef.current]
    function onWheel(event: WheelEvent) {
      event.preventDefault()
      const target = event.currentTarget
      if (target instanceof HTMLElement) {
        const rect = target.getBoundingClientRect()
        const frac = (event.clientX - rect.left) / rect.width
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15
          setView(v => zoomView(v, factor, frac, refLength))
        } else {
          setView(v => {
            const shift = (event.deltaX / rect.width) * (v.end - v.start)
            return clampView(
              { start: v.start + shift, end: v.end + shift },
              refLength,
            )
          })
        }
      }
    }
    for (const el of els) {
      el?.addEventListener('wheel', onWheel, { passive: false })
    }
    return () => {
      for (const el of els) {
        el?.removeEventListener('wheel', onWheel)
      }
    }
  }, [setView, refLength])

  useEffect(() => {
    function onMove(event: MouseEvent) {
      const drag = dragRef.current
      if (drag) {
        const dx = event.clientX - drag.x
        const shift = -(dx / width) * (drag.view.end - drag.view.start)
        drag.moved = drag.moved || Math.abs(dx) > 3
        setView(() =>
          clampView(
            { start: drag.view.start + shift, end: drag.view.end + shift },
            refLength,
          ),
        )
      }
    }
    function onUp() {
      setDragging(false)
    }
    if (dragging) {
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragging, width, setView, refLength])

  function startDrag(event: React.MouseEvent) {
    dragRef.current = { x: event.clientX, view, moved: false }
    setDragging(true)
  }

  function sliceAt(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const bp = view.start + (event.clientX - rect.left) * bpPerPx
    const row = Math.floor((event.clientY - rect.top - 2) / ROW_H)
    const slop = 2 * bpPerPx
    return placed.findLast(
      p =>
        p.row === row &&
        bp >= p.slice.start - slop &&
        bp <= p.slice.start + p.slice.span + slop,
    )
  }

  return (
    <div className="genome-view" ref={containerRef}>
      <div className="graph-label">
        Index density: slice bytes spread over each slice's reference span
      </div>
      <canvas
        ref={densityRef}
        className={dragging ? 'grabbing' : 'grab'}
        onMouseDown={startDrag}
      />
      <div className="graph-label">
        CRAI entries (one per slice; alternating shades mark container
        boundaries; click a slice to inspect it)
      </div>
      <canvas
        ref={slicesRef}
        className={dragging ? 'grabbing' : 'grab'}
        onMouseDown={startDrag}
        onMouseMove={event => {
          setHover(dragging ? undefined : sliceAt(event))
        }}
        onMouseLeave={() => {
          setHover(undefined)
        }}
        onClick={event => {
          const hit = dragRef.current?.moved ? undefined : sliceAt(event)
          if (hit) {
            onInspect(hit.slice)
          }
        }}
      />
      <div className="hover-info">
        {hover
          ? `slice at ${fmtBp(hover.slice.start)} spanning ${fmtBp(hover.slice.span)}: ${fmtBytes(hover.slice.sliceBytes)}, container @ byte ${hover.slice.containerStart.toLocaleString()} (+${hover.slice.sliceStart.toLocaleString()})`
          : ' '}
      </div>
    </div>
  )
}
