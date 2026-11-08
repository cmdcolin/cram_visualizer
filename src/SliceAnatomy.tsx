import { useState } from 'react'

import { categoryColors, readKindColors } from './cram.ts'
import { useWidth } from './useWidth.ts'
import { fmtBytes } from './util.ts'

import type { SliceInspection } from './cram.ts'

const ROW_H = 30
const GAP = 44
const LABEL_H = 16
const MIN_PX = 3

interface Segment {
  key: string
  label: string
  detail: string
  size: number
  color: string
  highlight?: boolean
}

function layoutSegments(segments: Segment[], width: number) {
  const total = segments.reduce((a, s) => a + s.size, 0)
  const spare = Math.max(width - segments.length * MIN_PX, 0)
  const min =
    segments.length * MIN_PX > width ? width / segments.length : MIN_PX
  let x = 0
  return segments.map(s => {
    const w = min + (spare * s.size) / Math.max(total, 1)
    const placed = { ...s, x, w }
    x += w
    return placed
  })
}

function Row({
  y,
  segments,
  width,
  onHover,
}: {
  y: number
  segments: ReturnType<typeof layoutSegments>
  width: number
  onHover: (s: Segment | undefined) => void
}) {
  return (
    <g transform={`translate(0, ${y})`}>
      <rect width={width} height={ROW_H} fill="none" stroke="#ccc" />
      {segments.map(s => (
        <g
          key={s.key}
          onMouseEnter={() => {
            onHover(s)
          }}
          onMouseLeave={() => {
            onHover(undefined)
          }}
        >
          <rect
            x={s.x}
            width={s.w}
            height={ROW_H}
            fill={s.color}
            stroke="#fff"
            strokeWidth={s.w > 4 ? 1 : 0}
            opacity={s.highlight === false ? 0.35 : 1}
          />
          {s.w > s.label.length * 6.5 + 8 ? (
            <text
              x={s.x + s.w / 2}
              y={ROW_H / 2 + 4}
              textAnchor="middle"
              fontSize={11}
              fill="#fff"
              pointerEvents="none"
            >
              {s.label}
            </text>
          ) : null}
        </g>
      ))}
    </g>
  )
}

export default function SliceAnatomy({
  inspection,
}: {
  inspection: SliceInspection
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<Segment>()
  const { containerHeader, compressionHeader, sliceHeader, blocks, entry } =
    inspection
  const { landmarks, length } = containerHeader

  const containerSegments: Segment[] = [
    {
      key: 'container-header',
      label: 'header',
      detail: 'container header: reference, span, record count, landmarks',
      size: containerHeader._size,
      color: readKindColors['container header'],
    },
    {
      key: 'compression-header',
      label: 'compression header',
      detail: `compression header: encodings for every data series (${fmtBytes(compressionHeader?._size ?? landmarks[0] ?? 0)})`,
      size: landmarks[0] ?? compressionHeader?._size ?? 0,
      color: readKindColors['compression header'],
    },
    ...landmarks.map((landmark, i) => {
      const size = (landmarks[i + 1] ?? length) - landmark
      return {
        key: `slice-${landmark}`,
        label: `slice ${i + 1}`,
        detail: `slice ${i + 1} of ${landmarks.length}: ${fmtBytes(size)} at offset ${landmark.toLocaleString()} in the container`,
        size,
        color: readKindColors.slice,
        highlight: landmark === entry.sliceStart,
      }
    }),
  ]

  const sliceSegments: Segment[] = [
    {
      key: 'slice-header',
      label: 'header',
      detail: `slice header: span, record count, content IDs (${fmtBytes(sliceHeader._size)})`,
      size: sliceHeader._size,
      color: '#444',
    },
    ...blocks.map((b, i) => ({
      key: `block-${i}`,
      label: b.label.split(', ')[0] ?? '',
      detail: `${b.label}: ${b.compressionMethod}, ${fmtBytes(b.size)} stored, ${fmtBytes(b.uncompressedSize)} raw`,
      size: b.size,
      color: categoryColors[b.category] ?? '#999',
    })),
  ]

  const top = layoutSegments(containerSegments, width)
  const bottom = layoutSegments(sliceSegments, width)
  const selected = top.find(s => s.highlight)
  const y2 = LABEL_H + ROW_H + GAP + LABEL_H
  const height = y2 + ROW_H + 2

  return (
    <div ref={ref} className="anatomy">
      {width > 0 ? (
        <svg width={width} height={height}>
          <text x={0} y={12} fontSize={12} fill="#555">
            Container at byte {entry.containerStart.toLocaleString()} (
            {fmtBytes(containerHeader._size + length)})
          </text>
          <Row y={LABEL_H} segments={top} width={width} onHover={setHover} />
          {selected ? (
            <polygon
              points={`${selected.x},${LABEL_H + ROW_H} ${selected.x + selected.w},${LABEL_H + ROW_H} ${width},${y2} 0,${y2}`}
              fill={readKindColors.slice}
              opacity={0.12}
            />
          ) : null}
          <text x={0} y={y2 - 4} fontSize={12} fill="#555">
            This slice ({fmtBytes(entry.sliceBytes)}): a header, then one block
            per data series, each compressed on its own
          </text>
          <Row y={y2} segments={bottom} width={width} onHover={setHover} />
        </svg>
      ) : null}
      <div className="hover-info">{hover?.detail ?? ' '}</div>
    </div>
  )
}
