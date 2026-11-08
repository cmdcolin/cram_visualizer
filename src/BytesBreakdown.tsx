import { categoryColors, dataSeriesDescriptions } from './cram.ts'
import { fmtBytes } from './util.ts'

import type { SliceInspection } from './cram.ts'

type Block = SliceInspection['blocks'][number]

interface Row {
  label: string
  category: string
  methods: Set<string>
  compressed: number
  uncompressed: number
  count: number
}

function aggregate(blocks: Block[], key: (b: Block) => string) {
  const rows = new Map<string, Row>()
  for (const b of blocks) {
    const k = key(b)
    const row = rows.get(k) ?? {
      label: k,
      category: b.category,
      methods: new Set<string>(),
      compressed: 0,
      uncompressed: 0,
      count: 0,
    }
    row.methods.add(b.compressionMethod)
    row.compressed += b.size
    row.uncompressed += b.uncompressedSize
    row.count++
    rows.set(k, row)
  }
  return [...rows.values()].toSorted((a, b) => b.compressed - a.compressed)
}

function describe(label: string) {
  const names = label.split(', ')
  const first = names[0] ?? ''
  return names.length === 1
    ? (dataSeriesDescriptions[first] ??
        (first.includes(':') ? `aux tag ${first}` : ''))
    : `shared by ${names.length} series`
}

export default function BytesBreakdown({
  blocks,
  perBlock,
}: {
  blocks: Block[]
  perBlock: boolean
}) {
  const total = blocks.reduce((a, b) => a + b.size, 0)
  const totalRaw = blocks.reduce((a, b) => a + b.uncompressedSize, 0)
  const byCategory = aggregate(blocks, b => b.category)
  const rows = perBlock
    ? blocks.map((b, i) => ({
        key: `${i}`,
        label: b.label,
        category: b.category,
        methods: new Set([b.compressionMethod]),
        compressed: b.size,
        uncompressed: b.uncompressedSize,
        count: 1,
        contentId: b.contentType === 'EXTERNAL_DATA' ? b.contentId : undefined,
      }))
    : aggregate(blocks, b => b.label).map(r => ({
        ...r,
        key: r.label,
        contentId: undefined,
      }))
  const maxRow = Math.max(...rows.map(r => r.compressed), 1)

  return (
    <div className="breakdown">
      <div className="stacked-bar">
        {byCategory.map(c => (
          <div
            key={c.label}
            title={`${c.label}: ${fmtBytes(c.compressed)} (${((c.compressed / total) * 100).toFixed(1)}%)`}
            style={{
              width: `${(c.compressed / total) * 100}%`,
              background: categoryColors[c.label],
            }}
          />
        ))}
      </div>
      <div className="legend">
        {byCategory.map(c => (
          <span key={c.label}>
            <span
              className="swatch"
              style={{ background: categoryColors[c.label] }}
            />
            {c.label} {((c.compressed / total) * 100).toFixed(1)}%
          </span>
        ))}
        <span className="muted">
          {fmtBytes(total)} stored, {fmtBytes(totalRaw)} decompressed (
          {(totalRaw / Math.max(total, 1)).toFixed(1)}x)
        </span>
      </div>
      <table className="blocks">
        <thead>
          <tr>
            {perBlock ? <th>content ID</th> : <th>blocks</th>}
            <th>data series</th>
            <th>method</th>
            <th className="num">stored</th>
            <th className="num">raw</th>
            <th className="num">ratio</th>
            <th className="bar-col" />
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td className="num">
                {perBlock ? (r.contentId ?? '') : r.count}
              </td>
              <td>
                <span
                  className="swatch"
                  style={{ background: categoryColors[r.category] }}
                />
                <span className="series">{r.label}</span>{' '}
                <span className="muted">{describe(r.label)}</span>
              </td>
              <td>{[...r.methods].join(', ')}</td>
              <td className="num">{fmtBytes(r.compressed)}</td>
              <td className="num">{fmtBytes(r.uncompressed)}</td>
              <td className="num">
                {r.compressed > 0
                  ? `${(r.uncompressed / r.compressed).toFixed(1)}x`
                  : ''}
              </td>
              <td className="bar-col">
                <div
                  className="bar"
                  style={{
                    width: `${(r.compressed / maxRow) * 100}%`,
                    background: categoryColors[r.category],
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
