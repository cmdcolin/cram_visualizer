import { useEffect, useMemo, useRef, useState } from 'react'

import { blockCategory, categoryColors, decodeSliceReads } from './cram.ts'
import { useWidth } from './useWidth.ts'
import {
  fmtBp,
  fmtBytes,
  fmtInt,
  fmtTick,
  niceTicks,
  setupCanvas,
} from './util.ts'

import type { Slice, SliceInspection, SliceRead } from './cram.ts'

const RULER_H = 20
const NEIGHBOR_H = 12
const MAX_PILEUP_H = 320

function packRows(reads: SliceRead[]) {
  const rowEnds: number[] = []
  return reads.map(read => {
    const free = rowEnds.findIndex(end => end < read.start)
    const row = free === -1 ? rowEnds.length : free
    rowEnds[row] = read.end
    return { read, row }
  })
}

function fieldsFor(read: SliceRead, total: number) {
  return [
    ['BF', 'flags', `${read.flags} (0x${read.flags.toString(16)})`],
    ['AP', 'position', fmtInt(read.start + 1)],
    ['RL', 'read length', fmtInt(read.readLength)],
    ['RN', 'name', read.readName ?? '(not stored)'],
    ['MQ', 'mapping quality', `${read.mappingQuality ?? ''}`],
    ['FN', 'read features', fmtInt(read.readFeatureCount)],
    read.mateRecordNumber === undefined
      ? [
          'NP',
          'mate',
          read.nextStart >= 0
            ? `stored separately, at ${fmtInt(read.nextStart + 1)}`
            : 'none',
        ]
      : [
          'NF',
          'mate',
          `record ${fmtInt(read.mateRecordNumber + 1)} of ${fmtInt(total)} in this slice`,
        ],
    ['TL', 'tags', read.tags.join(' ') || 'none'],
    ['QS', 'qualities', `${fmtInt(read.readLength)} values`],
  ] satisfies [string, string, string][]
}

export default function SliceReads({
  inspection,
  neighbors,
}: {
  inspection: SliceInspection
  neighbors: Slice[]
}) {
  const [containerRef, width] = useWidth<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [reads, setReads] = useState<SliceRead[]>()
  const [error, setError] = useState<unknown>()
  const [selected, setSelected] = useState<SliceRead>()
  const [hover, setHover] = useState<SliceRead>()

  useEffect(() => {
    let active = true
    decodeSliceReads(inspection).then(
      result => {
        if (active) {
          setReads(result)
        }
      },
      (error_: unknown) => {
        console.error(error_)
        if (active) {
          setError(error_)
        }
      },
    )
    return () => {
      active = false
    }
  }, [inspection])

  const placed = useMemo(
    () =>
      packRows(
        (reads ?? [])
          .filter(r => (r.flags & 4) === 0)
          .toSorted((a, b) => a.start - b.start),
      ),
    [reads],
  )
  const unmapped = (reads?.length ?? 0) - placed.length
  const numRows = Math.max(1, ...placed.map(p => p.row + 1))
  const rowH = Math.min(Math.max(MAX_PILEUP_H / numRows, 1), 6)
  const pileupTop = RULER_H + NEIGHBOR_H * (neighbors.length + 1) + 6
  const height = pileupTop + numRows * rowH + 4

  const { entry } = inspection
  const domain = useMemo(() => {
    const starts = [entry.start, ...placed.map(p => p.read.start)]
    const ends = [entry.start + entry.span, ...placed.map(p => p.read.end)]
    return { start: Math.min(...starts), end: Math.max(...ends) }
  }, [entry, placed])
  const bpPerPx = (domain.end - domain.start) / Math.max(width, 1)

  const blockFor = useMemo(() => {
    const { blocks, description } = inspection
    const core = blocks.find(b => b.contentType === 'CORE_DATA')
    return new Map(
      (description?.series ?? []).map(series => [
        series.name,
        series.contentIds.length === 0
          ? core
          : blocks.find(b => series.contentIds.includes(b.contentId)),
      ]),
    )
  }, [inspection])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas && width > 0 ? setupCanvas(canvas, width, height) : null
    if (ctx) {
      const px = (bp: number) => (bp - domain.start) / bpPerPx
      ctx.font = '10px system-ui'
      ctx.fillStyle = '#333'
      ctx.strokeStyle = '#999'
      const ticks = niceTicks(
        domain.start,
        domain.end,
        Math.max(width / 120, 2),
      )
      const step = (ticks[1] ?? Number.POSITIVE_INFINITY) - (ticks[0] ?? 0)
      for (const t of ticks) {
        const x = Math.round(px(t)) + 0.5
        const label = fmtTick(t, step)
        const half = ctx.measureText(label).width / 2
        ctx.beginPath()
        ctx.moveTo(x, RULER_H - 5)
        ctx.lineTo(x, RULER_H)
        ctx.stroke()
        ctx.textAlign = 'center'
        ctx.fillText(
          label,
          Math.min(Math.max(x, half), width - half),
          RULER_H - 8,
        )
      }
      const bands = [
        { slice: entry, label: 'this slice' },
        ...neighbors.map(n => ({
          slice: n,
          label: n.start < entry.start ? 'previous slice' : 'next slice',
        })),
      ]
      for (const [i, band] of bands.entries()) {
        const y = RULER_H + i * NEIGHBOR_H
        const x1 = Math.max(px(band.slice.start), 0)
        const x2 = Math.min(px(band.slice.start + band.slice.span), width)
        ctx.fillStyle = i === 0 ? '#d1495b' : '#bbb'
        ctx.fillRect(x1, y + 2, Math.max(x2 - x1, 1), NEIGHBOR_H - 4)
        ctx.fillStyle = i === 0 ? '#fff' : '#333'
        ctx.textAlign = 'left'
        ctx.fillText(band.label, x1 + 3, y + NEIGHBOR_H - 3)
        ctx.setLineDash([3, 3])
        ctx.strokeStyle = i === 0 ? '#d1495b' : '#999'
        for (const x of [x1, x2]) {
          ctx.beginPath()
          ctx.moveTo(Math.round(x) + 0.5, y + NEIGHBOR_H)
          ctx.lineTo(Math.round(x) + 0.5, height)
          ctx.stroke()
        }
        ctx.setLineDash([])
      }
      if (selected) {
        const x = px(selected.start)
        const w = Math.max((selected.end - selected.start) / bpPerPx, 2)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)'
        ctx.fillRect(x - 3, pileupTop, w + 6, height - pileupTop)
      }
      for (const { read, row } of placed) {
        const isSelected = read === selected
        const isHover = read === hover
        ctx.fillStyle = isSelected
          ? '#000'
          : isHover
            ? '#f0a030'
            : read.flags & 16
              ? 'hsl(210, 55%, 70%)'
              : 'hsl(350, 55%, 75%)'
        ctx.fillRect(
          px(read.start),
          pileupTop + row * rowH,
          Math.max((read.end - read.start) / bpPerPx, 1),
          Math.max(rowH - (rowH > 2 ? 1 : 0), 1),
        )
      }
    }
  }, [
    width,
    height,
    domain,
    bpPerPx,
    placed,
    neighbors,
    entry,
    pileupTop,
    rowH,
    selected,
    hover,
  ])

  function readAt(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const bp = domain.start + (event.clientX - rect.left) * bpPerPx
    const row = Math.floor((event.clientY - rect.top - pileupTop) / rowH)
    const slop = 2 * bpPerPx
    return placed.find(
      p =>
        p.row === row && bp >= p.read.start - slop && bp <= p.read.end + slop,
    )?.read
  }

  const total = reads?.length ?? 0

  return (
    <div className="slice-reads" ref={containerRef}>
      <h4>The reads in this slice</h4>
      {error ? (
        <div className="error">{`${error}`}</div>
      ) : reads ? (
        <>
          <p className="muted">
            {fmtInt(total)} records decoded from the blocks above
            {unmapped > 0 ? ` (${fmtInt(unmapped)} unmapped, not drawn)` : ''}.
            The slice's span is just the extent of its reads, so it overlaps its
            neighbours wherever reads cross the boundary. Pink is forward, blue
            reverse; click a read to see how it is put back together.
          </p>
          <canvas
            ref={canvasRef}
            onMouseMove={event => {
              setHover(readAt(event))
            }}
            onMouseLeave={() => {
              setHover(undefined)
            }}
            onClick={event => {
              setSelected(readAt(event))
            }}
          />
          <div className="hover-info">
            {hover
              ? `record ${hover.index + 1}: ${hover.readName ?? ''} ${fmtInt(hover.start + 1)}-${fmtInt(hover.end)} (${fmtBp(hover.end - hover.start)})`
              : ' '}
          </div>
          {selected ? (
            <div className="record-detail">
              <h4>
                Record {fmtInt(selected.index + 1)} of {fmtInt(total)}: one row,
                gathered from many columns
              </h4>
              <p className="muted">
                CRAM stores each field of every record together, so rebuilding
                this one read takes a value from each of these blocks.
              </p>
              <table className="blocks">
                <tbody>
                  {fieldsFor(selected, total).map(([code, name, value]) => {
                    const block = blockFor.get(code)
                    return (
                      <tr key={code}>
                        <td>
                          <span
                            className="swatch"
                            style={{
                              background: categoryColors[blockCategory(code)],
                            }}
                          />
                          <span className="series">{code}</span>
                        </td>
                        <td className="muted">{name}</td>
                        <td className="record-value">{value}</td>
                        <td className="muted">
                          {block === undefined
                            ? 'not stored in this slice'
                            : block.contentType === 'CORE_DATA'
                              ? `core block, bit-packed with the other core series, ${fmtBytes(block.size)} in all`
                              : `block ${block.contentId}, ${block.compressionMethod}, ${fmtBytes(block.size)} for all ${fmtInt(total)} records`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : (
        <p>Decoding…</p>
      )}
    </div>
  )
}
