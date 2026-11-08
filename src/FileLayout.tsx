import { useEffect, useMemo, useRef, useState } from 'react'

import { classifyRead, readKindColors } from './cram.ts'
import { useWidth } from './useWidth.ts'
import { fmtBytes, setupCanvas } from './util.ts'

import type { FileSummary, ReadKind, Slice } from './cram.ts'
import type { ReadLogEntry } from './loggingFile.ts'

const ROW_H = 18
const LABEL_W = 110

interface Range {
  min: number
  max: number
}

function readRange(log: ReadLogEntry[]) {
  const min = Math.min(...log.map(r => r.position))
  const max = Math.max(...log.map(r => r.position + r.length))
  const pad = Math.max((max - min) * 0.05, 64)
  return { min: Math.max(min - pad, 0), max: max + pad }
}

export default function FileLayout({
  summary,
  seqId,
  refNames,
  querySlices,
  log,
}: {
  summary: FileSummary
  seqId: number
  refNames: (seqId: number) => string
  querySlices: Slice[]
  log: ReadLogEntry[]
}) {
  const [containerRef, outerWidth] = useWidth<HTMLDivElement>()
  const width = Math.max(outerWidth - LABEL_W, 0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoomToReads, setZoomToReads] = useState(false)
  const canZoom = log.length > 0
  const range: Range =
    zoomToReads && canZoom ? readRange(log) : { min: 0, max: summary.fileEnd }

  const classified = useMemo(
    () =>
      log.map(r => ({
        ...r,
        kind: classifyRead(r.position, r.length, summary),
      })),
    [log, summary],
  )

  const height = ROW_H * 3 + 24

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas && width > 0 ? setupCanvas(canvas, width, height) : null
    if (ctx) {
      const span = range.max - range.min
      const px = (pos: number) => ((pos - range.min) / span) * width
      ctx.font = '10px system-ui'
      for (const [i, ext] of summary.refExtents.entries()) {
        const x1 = px(ext.min)
        const x2 = px(ext.max)
        ctx.fillStyle =
          ext.seqId === seqId
            ? 'hsl(200, 60%, 45%)'
            : i % 2 === 0
              ? '#ccc'
              : '#aaa'
        ctx.fillRect(x1, 0, Math.max(x2 - x1, 1), ROW_H - 2)
        const label = refNames(ext.seqId)
        if (x2 - x1 > ctx.measureText(label).width + 6) {
          ctx.fillStyle = ext.seqId === seqId ? '#fff' : '#333'
          ctx.fillText(label, Math.max(x1, 0) + 3, ROW_H - 6)
        }
      }
      ctx.fillStyle = 'hsl(200, 60%, 35%)'
      for (const s of querySlices) {
        const x1 = px(s.containerStart + s.sliceStart)
        const w = Math.max((s.sliceBytes / span) * width, 2)
        ctx.fillRect(x1, ROW_H, w, ROW_H - 2)
      }
      for (const r of classified) {
        ctx.fillStyle = readKindColors[r.kind]
        ctx.fillRect(
          px(r.position),
          ROW_H * 2,
          Math.max((r.length / span) * width, 2),
          ROW_H - 2,
        )
      }
      ctx.fillStyle = '#333'
      ctx.textAlign = 'left'
      ctx.fillText(fmtBytes(range.min, 2), 0, height - 4)
      ctx.textAlign = 'right'
      ctx.fillText(fmtBytes(range.max, 2), width, height - 4)
    }
  }, [
    width,
    height,
    range.min,
    range.max,
    summary,
    seqId,
    refNames,
    querySlices,
    classified,
  ])

  const totalMs = Math.max(...classified.map(r => r.startMs + r.ms), 1)
  const kinds = [...new Set(classified.map(r => r.kind))]
  const kindTotals = (kind: ReadKind) =>
    classified.filter(r => r.kind === kind).reduce((a, r) => a + r.length, 0)

  return (
    <div className="file-layout" ref={containerRef}>
      <div className="file-layout-header">
        <h3>File layout (byte offsets)</h3>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={zoomToReads && canZoom}
            disabled={!canZoom}
            onChange={event => {
              setZoomToReads(event.target.checked)
            }}
          />
          Zoom to the bytes read
        </label>
      </div>
      <div className="canvas-row">
        <div className="canvas-labels" style={{ width: LABEL_W }}>
          <div style={{ height: ROW_H }}>references</div>
          <div style={{ height: ROW_H }}>slices in view</div>
          <div style={{ height: ROW_H }}>reads issued</div>
        </div>
        <canvas ref={canvasRef} />
      </div>
      {kinds.length > 0 ? (
        <div className="legend">
          {kinds.map(kind => (
            <span key={kind}>
              <span
                className="swatch"
                style={{ background: readKindColors[kind] }}
              />
              {kind}: {fmtBytes(kindTotals(kind))}
            </span>
          ))}
        </div>
      ) : null}
      {classified.length > 0 ? (
        <details>
          <summary>
            Request waterfall ({classified.length} reads over{' '}
            {(totalMs / 1000).toFixed(2)} s)
          </summary>
          <div className="waterfall">
            {classified
              .toSorted((a, b) => a.startMs - b.startMs)
              .map(r => (
                <div
                  key={`${r.position}-${r.length}-${r.startMs}`}
                  className="waterfall-row"
                >
                  <span className="waterfall-label">
                    <span
                      className="swatch"
                      style={{ background: readKindColors[r.kind] }}
                    />
                    {r.kind} @ {r.position.toLocaleString()},{' '}
                    {fmtBytes(r.length)}
                  </span>
                  <span className="waterfall-track">
                    <span
                      className="waterfall-bar"
                      title={`${r.startMs.toFixed(0)} ms + ${r.ms.toFixed(0)} ms`}
                      style={{
                        left: `${(r.startMs / totalMs) * 100}%`,
                        width: `${Math.max((r.ms / totalMs) * 100, 0.3)}%`,
                        background: readKindColors[r.kind],
                      }}
                    />
                  </span>
                  <span className="muted">{r.ms.toFixed(0)} ms</span>
                </div>
              ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}
