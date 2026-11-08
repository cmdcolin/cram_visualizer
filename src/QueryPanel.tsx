import { useState } from 'react'

import BytesBreakdown from './BytesBreakdown.tsx'
import { inspectSlice } from './cram.ts'
import { fmtBp, fmtBytes, fmtInt } from './util.ts'

import type { CramData, Slice, SliceInspection } from './cram.ts'
import type { View } from './util.ts'

const MAX_SAMPLED = 24

interface QueryResult {
  records: number
  ms: number
  bytesRead: number
  reads: number
}

function sample<T>(arr: T[], n: number) {
  return arr.length <= n
    ? arr
    : Array.from(
        { length: n },
        (_, i) => arr[Math.floor((i * arr.length) / n)]!,
      )
}

export default function QueryPanel({
  data,
  seqId,
  view,
  querySlices,
  onInspect,
  inspected,
}: {
  data: CramData
  seqId: number
  view: View
  querySlices: Slice[]
  onInspect: (slice: Slice) => void
  inspected: Slice | undefined
}) {
  const [result, setResult] = useState<QueryResult>()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<unknown>()
  const [breakdown, setBreakdown] = useState<{
    n: number
    inspections: SliceInspection[]
  }>()
  const [breakdownProgress, setBreakdownProgress] = useState<string>()

  const totalBytes = querySlices.reduce((a, s) => a + s.sliceBytes, 0)
  const containers = new Set(querySlices.map(s => s.containerStart)).size
  const isLarge = totalBytes > 50_000_000

  async function runQuery() {
    setRunning(true)
    setError(undefined)
    setResult(undefined)
    try {
      data.indexed.clearFeatureCache()
      data.log.clear()
      const t0 = performance.now()
      const records = await data.indexed.getRecordsForRange(
        seqId,
        Math.floor(view.start),
        Math.ceil(view.end),
      )
      setResult({
        records: records.length,
        ms: performance.now() - t0,
        bytesRead: data.log.log.reduce((a, r) => a + r.received, 0),
        reads: data.log.log.length,
      })
    } catch (error_) {
      console.error(error_)
      setError(error_)
    } finally {
      setRunning(false)
    }
  }

  async function runBreakdown() {
    const picked = sample(querySlices, MAX_SAMPLED)
    setBreakdown(undefined)
    setError(undefined)
    data.log.clear()
    try {
      const inspections: SliceInspection[] = []
      for (const [i, s] of picked.entries()) {
        setBreakdownProgress(`reading slice ${i + 1} of ${picked.length}`)
        inspections.push(await inspectSlice(data.cram, s))
      }
      setBreakdown({ n: picked.length, inspections })
    } catch (error_) {
      console.error(error_)
      setError(error_)
    } finally {
      setBreakdownProgress(undefined)
    }
  }

  return (
    <div className="query-panel">
      <h3>Query for the region in view</h3>
      <p>
        The .crai lists <b>{fmtInt(querySlices.length)}</b> slices in{' '}
        <b>{fmtInt(containers)}</b> containers overlapping this region,{' '}
        <b>{fmtBytes(totalBytes)}</b> of slice data. Each container costs a
        header read and a compression-header read on top of its slices.
      </p>
      <div className="button-row">
        <button
          disabled={running || querySlices.length === 0}
          onClick={() => {
            void runQuery()
          }}
        >
          {running ? 'Fetching…' : 'Fetch records with @gmod/cram'}
        </button>
        <button
          disabled={breakdownProgress !== undefined || querySlices.length === 0}
          onClick={() => {
            void runBreakdown()
          }}
        >
          {breakdownProgress ??
            `Break down bytes by data series (${Math.min(querySlices.length, MAX_SAMPLED)} slices${querySlices.length > MAX_SAMPLED ? ', sampled' : ''})`}
        </button>
        {isLarge ? (
          <span className="warning">
            Large region: these would download {fmtBytes(totalBytes)}
          </span>
        ) : null}
      </div>
      {error ? <div className="error">{`${error}`}</div> : null}
      {result ? (
        <p>
          {fmtInt(result.records)} records decoded in{' '}
          {(result.ms / 1000).toFixed(2)} s from {fmtInt(result.reads)} reads
          totalling {fmtBytes(result.bytesRead)} (
          {fmtBytes(result.bytesRead / Math.max(result.records, 1))} per
          record). The file layout above shows where those reads landed.
        </p>
      ) : null}
      {breakdown ? (
        <div>
          <h4>
            Bytes by data series across {breakdown.n} slice
            {breakdown.n === 1 ? '' : 's'}
          </h4>
          <BytesBreakdown
            blocks={breakdown.inspections.flatMap(i => i.blocks)}
            perBlock={false}
          />
        </div>
      ) : null}
      <details>
        <summary>Slices overlapping the view</summary>
        <div className="slice-list">
          <table className="blocks">
            <thead>
              <tr>
                <th className="num">container byte</th>
                <th className="num">slice offset</th>
                <th className="num">ref start</th>
                <th className="num">span</th>
                <th className="num">size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {querySlices.slice(0, 500).map(s => (
                <tr
                  key={`${s.containerStart}-${s.sliceStart}`}
                  className={s === inspected ? 'selected' : undefined}
                >
                  <td className="num">{fmtInt(s.containerStart)}</td>
                  <td className="num">{fmtInt(s.sliceStart)}</td>
                  <td className="num">{fmtInt(s.start + 1)}</td>
                  <td className="num">{fmtBp(s.span)}</td>
                  <td className="num">{fmtBytes(s.sliceBytes)}</td>
                  <td>
                    <button
                      onClick={() => {
                        onInspect(s)
                      }}
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {querySlices.length > 500 ? <p>…showing the first 500</p> : null}
        </div>
      </details>
    </div>
  )
}
