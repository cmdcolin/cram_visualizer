import BytesBreakdown from './BytesBreakdown.tsx'
import SliceAnatomy from './SliceAnatomy.tsx'
import SliceReads from './SliceReads.tsx'
import { codecNames, dataSeriesDescriptions } from './cram.ts'
import { fmtBp, fmtBytes, fmtInt } from './util.ts'

import type { CramEncoding, Slice, SliceInspection } from './cram.ts'

function encodingSummary(encoding: CramEncoding): string {
  const name = codecNames[encoding.codecId] ?? `codec ${encoding.codecId}`
  return encoding.codecId === 1
    ? `${name} → block ${encoding.parameters.blockContentId}`
    : encoding.codecId === 5
      ? `${name} (stop ${encoding.parameters.stopByte}) → block ${encoding.parameters.blockContentId}`
      : encoding.codecId === 4
        ? `${name} [len: ${encodingSummary(encoding.parameters.lengthsEncoding)}; val: ${encodingSummary(encoding.parameters.valuesEncoding)}]`
        : encoding.codecId === 3
          ? encoding.parameters.numCodes === 1
            ? `${name}, single symbol ${encoding.parameters.symbols[0]} (0 bits)`
            : `${name}, ${encoding.parameters.numCodes} symbols in core block`
          : `${name} in core block`
}

function Facts({ items }: { items: [string, string | number][] }) {
  return (
    <dl className="facts">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{typeof v === 'number' ? fmtInt(v) : v}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function SliceInspector({
  inspection,
  refName,
  neighbors,
  onClose,
}: {
  inspection: SliceInspection
  refName: (seqId: number) => string
  neighbors: Slice[]
  onClose: () => void
}) {
  const {
    entry,
    containerHeader,
    compressionHeader,
    sliceHeader,
    description,
    blocks,
  } = inspection
  const sh = sliceHeader.parsedContent
  const methodsByContentId = new Map(
    blocks.map(b => [b.contentId, b.compressionMethod]),
  )
  const sliceIndex = containerHeader.landmarks.indexOf(entry.sliceStart)

  return (
    <div className="inspector">
      <div className="inspector-header">
        <h3>
          Slice {sliceIndex + 1} of {containerHeader.landmarks.length} in the
          container at byte {fmtInt(entry.containerStart)}
        </h3>
        <button onClick={onClose}>Close</button>
      </div>
      <div className="inspector-columns">
        <div>
          <h4>Container header</h4>
          <Facts
            items={[
              [
                'file offset',
                containerHeader._endPosition - containerHeader._size,
              ],
              ['header size', fmtBytes(containerHeader._size)],
              ['data length', fmtBytes(containerHeader.length)],
              [
                'reference',
                containerHeader.refSeqId === -2
                  ? 'multiple'
                  : refName(containerHeader.refSeqId),
              ],
              ['start', fmtInt(containerHeader.refSeqStart)],
              ['span', fmtBp(containerHeader.alignmentSpan)],
              ['records', containerHeader.numRecords],
              ['bases', containerHeader.numBases],
              ['blocks', containerHeader.numBlocks],
              ['slices (landmarks)', containerHeader.landmarks.length],
              [
                'compression header',
                compressionHeader ? fmtBytes(compressionHeader._size) : 'none',
              ],
            ]}
          />
        </div>
        <div>
          <h4>Slice header</h4>
          <Facts
            items={[
              ['slice offset in container', entry.sliceStart],
              ['slice size (from .crai)', fmtBytes(entry.sliceBytes)],
              ...('refSeqId' in sh
                ? ([
                    [
                      'reference',
                      sh.refSeqId === -2 ? 'multiple' : refName(sh.refSeqId),
                    ],
                    ['start', fmtInt(sh.refSeqStart + 1)],
                    ['span', fmtBp(sh.refSeqSpan)],
                    [
                      'embedded reference',
                      sh.refBaseBlockId >= 0
                        ? `block ${sh.refBaseBlockId}`
                        : 'no',
                    ],
                  ] satisfies [string, string][])
                : []),
              ['records', sh.numRecords],
              ['first record #', sh.recordCounter],
              ['blocks', sh.numBlocks],
              [
                'bytes / record',
                fmtBytes(entry.sliceBytes / Math.max(sh.numRecords, 1)),
              ],
            ]}
          />
        </div>
      </div>

      <SliceAnatomy inspection={inspection} />
      <SliceReads inspection={inspection} neighbors={neighbors} />

      <h4>Where this slice's bytes go</h4>
      <BytesBreakdown blocks={blocks} perBlock />

      {description ? (
        <details>
          <summary>
            Compression header: how each data series is encoded (
            {description.series.length} series)
          </summary>
          <Facts
            items={[
              [
                'read names preserved',
                description.preservation.readNamesIncluded ? 'yes' : 'no',
              ],
              [
                'AP delta-coded',
                description.preservation.APdelta ? 'yes' : 'no',
              ],
              [
                'reference required',
                description.preservation.referenceRequired ? 'yes' : 'no',
              ],
              [
                'tag-line combinations',
                description.preservation.tagIdsDictionary.length,
              ],
            ]}
          />
          <table className="blocks">
            <thead>
              <tr>
                <th>series</th>
                <th>meaning</th>
                <th>encoding</th>
                <th>block method</th>
              </tr>
            </thead>
            <tbody>
              {description.series.map(s => (
                <tr key={s.name}>
                  <td className="series">{s.name}</td>
                  <td className="muted">
                    {dataSeriesDescriptions[s.name] ??
                      (s.isTag ? 'aux tag' : '')}
                  </td>
                  <td>{encodingSummary(s.encoding)}</td>
                  <td>
                    {s.contentIds
                      .map(
                        id => methodsByContentId.get(id) ?? 'not in this slice',
                      )
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Tag-line combinations (TD):{' '}
            {description.preservation.tagIdsDictionary
              .map(line => line.map(t => t.slice(0, 2)).join(' ') || '(none)')
              .join(' | ')}
          </p>
        </details>
      ) : null}
    </div>
  )
}
