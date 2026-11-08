import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import FileLayout from './FileLayout.tsx'
import GenomeView from './GenomeView.tsx'
import QueryPanel from './QueryPanel.tsx'
import SliceInspector from './SliceInspector.tsx'
import { fileSummary, inspectSlice } from './cram.ts'
import {
  type View,
  clampView,
  fmtBp,
  fmtBytes,
  fmtInt,
  fmtLoc,
  parseLoc,
  zoomView,
} from './util.ts'

import type { CramData, Slice, SliceInspection } from './cram.ts'

export default function DataViewer({ data }: { data: CramData }) {
  const { refs, index, definition } = data
  const summary = useMemo(() => fileSummary(index), [index])
  const placedSeqIds = summary.refExtents
    .map(e => e.seqId)
    .filter(id => id >= 0)
    .toSorted((a, b) => a - b)
  const [seqId, setSeqId] = useState(placedSeqIds[0] ?? 0)
  const entries = useMemo(() => index[seqId] ?? [], [index, seqId])
  const refLength =
    refs[seqId]?.length ?? Math.max(...entries.map(e => e.start + e.span), 1)
  const [view, setView] = useState<View>({ start: 0, end: refLength })
  const [locInput, setLocInput] = useState('')
  const [locError, setLocError] = useState<string>()
  const [inspection, setInspection] = useState<SliceInspection>()
  const [inspecting, setInspecting] = useState<Slice>()
  const [inspectError, setInspectError] = useState<unknown>()

  const subscribe = useCallback(
    (listener: () => void) => data.log.subscribe(listener),
    [data],
  )
  const log = useSyncExternalStore(subscribe, () => data.log.log)

  const refName = useCallback(
    (id: number) => (id === -1 ? 'unmapped' : (refs[id]?.name ?? `ref ${id}`)),
    [refs],
  )

  const querySlices = useMemo(
    () =>
      entries.filter(
        e => e.start < view.end && e.start + Math.max(e.span, 1) > view.start,
      ),
    [entries, view],
  )

  function selectRef(id: number, v?: View) {
    const length =
      refs[id]?.length ??
      Math.max(...(index[id] ?? []).map(e => e.start + e.span), 1)
    setSeqId(id)
    setView(clampView(v ?? { start: 0, end: length }, length))
    setInspection(undefined)
  }

  function inspect(slice: Slice) {
    setInspecting(slice)
    setInspection(undefined)
    setInspectError(undefined)
    data.log.clear()
    inspectSlice(data.cram, slice).then(
      result => {
        setInspection(result)
      },
      (error: unknown) => {
        console.error(error)
        setInspectError(error)
      },
    )
  }

  function findRef(name: string) {
    const candidates = [name, name.replace(/^chr/i, ''), `chr${name}`]
    return candidates
      .map(c => refs.findIndex(r => r.name === c))
      .find(id => id >= 0)
  }

  function goTo(str: string) {
    const loc = parseLoc(str)
    const id = loc ? findRef(loc.refName) : undefined
    if (loc && id !== undefined) {
      const length = refs[id]!.length
      setLocError(undefined)
      selectRef(id, {
        start: Math.max((loc.start ?? 1) - 1, 0),
        end: loc.end ?? (loc.start === undefined ? length : loc.start + 1000),
      })
    } else {
      setLocError(`Could not find ${str}`)
    }
  }

  const unmapped = index['-1']

  return (
    <div>
      <div className="summary">
        <span>
          CRAM v{definition.majorVersion}.{definition.minorVersion}
        </span>
        <span>{fmtBytes(summary.fileEnd)} indexed</span>
        <span>{fmtInt(summary.containers.size)} containers</span>
        <span>{fmtInt(summary.totalSlices)} slices</span>
        <span>
          {fmtBytes(summary.fileEnd / Math.max(summary.totalSlices, 1))} per
          slice on average
        </span>
        {unmapped ? (
          <span>{fmtInt(unmapped.length)} slices of unplaced reads</span>
        ) : null}
      </div>
      <details>
        <summary>SAM header</summary>
        <pre className="sam-header">{data.headerText}</pre>
      </details>

      <div className="controls">
        <label>
          Reference{' '}
          <select
            value={seqId}
            onChange={event => {
              selectRef(Number(event.target.value))
            }}
          >
            {placedSeqIds.map(id => (
              <option key={id} value={id}>
                {refName(id)} ({fmtInt(index[id]?.length ?? 0)} slices)
              </option>
            ))}
          </select>
        </label>
        <form
          onSubmit={event => {
            event.preventDefault()
            goTo(locInput)
          }}
        >
          <input
            type="text"
            placeholder={fmtLoc(refName(seqId), view.start, view.end)}
            value={locInput}
            onChange={event => {
              setLocInput(event.target.value)
            }}
          />
          <button type="submit">Go</button>
        </form>
        {locError ? <span className="error">{locError}</span> : null}
        <button
          onClick={() => {
            setView(v => zoomView(v, 1 / 2, 0.5, refLength))
          }}
        >
          Zoom in
        </button>
        <button
          onClick={() => {
            setView(v => zoomView(v, 2, 0.5, refLength))
          }}
        >
          Zoom out
        </button>
        <button
          onClick={() => {
            setView({ start: 0, end: refLength })
          }}
        >
          Whole reference
        </button>
        <span className="muted">
          {fmtLoc(refName(seqId), view.start, view.end)} (
          {fmtBp(view.end - view.start)}); scroll to zoom, drag to pan
        </span>
      </div>

      <div className="visualization-panel">
        <GenomeView
          entries={entries}
          refLength={refLength}
          view={view}
          setView={setView}
          inspected={inspecting}
          onInspect={inspect}
        />
        <FileLayout
          summary={summary}
          seqId={seqId}
          refNames={refName}
          querySlices={querySlices}
          log={log}
        />
      </div>

      {inspectError ? <div className="error">{`${inspectError}`}</div> : null}
      {inspection ? (
        <SliceInspector
          key={`${inspection.entry.containerStart}-${inspection.entry.sliceStart}`}
          inspection={inspection}
          refName={refName}
          neighbors={entries
            .filter(
              e =>
                e !== inspection.entry &&
                e.start < inspection.entry.start + inspection.entry.span &&
                e.start + e.span > inspection.entry.start,
            )
            .slice(0, 6)}
          onClose={() => {
            setInspection(undefined)
            setInspecting(undefined)
          }}
        />
      ) : inspecting && !inspectError ? (
        <div className="inspector">Reading slice…</div>
      ) : null}

      <QueryPanel
        data={data}
        seqId={seqId}
        view={view}
        querySlices={querySlices}
        onInspect={inspect}
        inspected={inspecting}
      />
    </div>
  )
}
