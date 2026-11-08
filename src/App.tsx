import { useEffect, useMemo, useRef, useState } from 'react'
import { BlobFile, RemoteFile } from 'generic-filehandle2'

import DataViewer from './DataViewer.tsx'
import { loadCram } from './cram.ts'

import type { CramData } from './cram.ts'

const exampleFiles = [
  {
    name: 'Illumina WGS 30x (GRCh38, NA12878, 1000 Genomes)',
    url: 'https://s3.amazonaws.com/1000genomes/1000G_2504_high_coverage/data/ERR3239334/NA12878.final.cram',
  },
  {
    name: 'Illumina exome (GRCh38, NA12878)',
    url: 'https://jbrowse.org/genomes/GRCh38/alignments/NA12878/NA12878.alt_bwamem_GRCh38DH.20150826.CEU.exome.cram',
  },
  {
    name: 'PacBio CLR (hg19, SKBR3)',
    url: 'https://s3.amazonaws.com/jbrowse.org/genomes/hg19/reads_lr_skbr3.fa_ngmlr-0.2.3_mapped.cram',
  },
  {
    name: 'Nanopore tumor (GRCh38, COLO829)',
    url: 'https://ont-open-data.s3.amazonaws.com/colo829_2024.03/wf_somatic_variation/sup/COLO829_tumor.ht.cram',
  },
  {
    name: 'Nanopore amplicon, deep (hg19, EGFR)',
    url: 'https://s3.amazonaws.com/jbrowse.org/genomes/hg19/amplicon_deep_seq/nanopore_egfr.cram',
  },
  {
    name: 'PacBio IsoSeq (hg19)',
    url: 'https://s3.amazonaws.com/jbrowse.org/genomes/hg19/alzheimers_isoseq/hq_isoforms.fasta.cram',
  },
  {
    name: 'Volvox test data (tiny)',
    url: 'https://jbrowse.org/code/jb2/latest/test_data/volvox/volvox-sv.cram',
  },
]

function HelpDialog({
  dialogRef,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
}) {
  return (
    <dialog
      ref={dialogRef}
      onClick={event => {
        if (event.target === dialogRef.current) {
          dialogRef.current.close()
        }
      }}
    >
      <h3>How a CRAM file is laid out</h3>
      <ul>
        <li>
          <b>File definition</b>: 26 bytes, the magic <code>CRAM</code>, the
          version and a file ID.
        </li>
        <li>
          <b>Header container</b>: the SAM header text.
        </li>
        <li>
          <b>Data containers</b>: each opens with a container header (reference,
          span, record count, and <i>landmarks</i>, the offset of each slice),
          then a <b>compression header</b> that says how every data series in
          the container is encoded, then one or more <b>slices</b>.
        </li>
        <li>
          <b>Slices</b> hold the records, stored column-wise: a slice header, a{' '}
          <i>core</i> block of bit-packed values, and an <i>external</i> block
          per data series (quality scores, bases, read names, tags…), each
          compressed with its own codec (gzip, rANS, fqzcomp, name tokenizer…).
        </li>
      </ul>
      <h3>How the .crai index differs from a .bai</h3>
      <p>
        A .crai is a gzipped table with one line per slice: reference, start,
        span, container byte offset, slice offset in the container, and slice
        size. There are no bins and no linear index. A query finds the lines
        overlapping the region and reads each slice whole, plus the header and
        compression header of each container it touches.
      </p>
      <h3>Panels</h3>
      <ul>
        <li>
          <b>Index density</b>: each slice's byte size spread evenly over the
          reference span it covers, which approximates coverage the way{' '}
          <a
            href="https://github.com/brentp/indexcov"
            target="_blank"
            rel="noopener noreferrer"
          >
            indexcov
          </a>{' '}
          does for BAI.
        </li>
        <li>
          <b>CRAI entries</b>: one bar per slice. Long-read files overlap, so
          their slices stack into rows.
        </li>
        <li>
          <b>File layout</b>: the same slices on a byte axis, beside the reads
          @gmod/cram actually issued for the last action.
        </li>
        <li>
          <b>Slice inspector</b>: one slice's blocks, which data series each one
          holds, and how well each compressed.
        </li>
      </ul>
      <div className="dialog-footer">
        <a
          href="https://samtools.github.io/hts-specs/CRAMv3.pdf"
          target="_blank"
          rel="noopener noreferrer"
        >
          CRAMv3 spec
        </a>
        <button
          onClick={() => {
            dialogRef.current?.close()
          }}
        >
          Close
        </button>
      </div>
    </dialog>
  )
}

export default function App() {
  const [cramUrl, setCramUrl] = useState(exampleFiles[0]!.url)
  const [craiUrl, setCraiUrl] = useState(`${exampleFiles[0]!.url}.crai`)
  const [useLocal, setUseLocal] = useState(false)
  const [localCram, setLocalCram] = useState<File>()
  const [localCrai, setLocalCrai] = useState<File>()
  const helpRef = useRef<HTMLDialogElement>(null)

  const handles = useMemo(
    () =>
      useLocal
        ? localCram && localCrai
          ? { cram: new BlobFile(localCram), crai: new BlobFile(localCrai) }
          : undefined
        : { cram: new RemoteFile(cramUrl), crai: new RemoteFile(craiUrl) },
    [useLocal, localCram, localCrai, cramUrl, craiUrl],
  )
  const [status, setStatus] = useState<{
    handles: typeof handles
    data?: CramData
    error?: unknown
    progress?: string
  }>()
  const current = status?.handles === handles ? status : undefined

  useEffect(() => {
    const controller = new AbortController()
    function update(next: Omit<NonNullable<typeof status>, 'handles'>) {
      if (!controller.signal.aborted) {
        setStatus({ handles, ...next })
      }
    }
    if (handles) {
      loadCram(handles.cram, handles.crai, (loaded, total) => {
        update({
          progress: `Downloading .crai: ${(loaded / 1e6).toFixed(2)} MB${total ? ` of ${(total / 1e6).toFixed(2)} MB` : ''}`,
        })
      }).then(
        data => {
          update({ data })
        },
        (error: unknown) => {
          console.error(error)
          update({ error })
        },
      )
    }
    return () => {
      controller.abort()
    }
  }, [handles])

  return (
    <div className="App">
      <div className="app-header">
        <h1>CRAM visualizer</h1>
        <button
          onClick={() => {
            helpRef.current?.showModal()
          }}
        >
          Help
        </button>
      </div>
      <HelpDialog dialogRef={helpRef} />
      <div className="form">
        <fieldset>
          <legend>Open file:</legend>
          <div className="radio-group">
            <label>
              <input
                type="radio"
                checked={!useLocal}
                onChange={() => {
                  setUseLocal(false)
                }}
              />
              URLs
            </label>
            <label>
              <input
                type="radio"
                checked={useLocal}
                onChange={() => {
                  setUseLocal(true)
                }}
              />
              Local files
            </label>
          </div>
          {useLocal ? (
            <div className="file-inputs">
              <label>
                CRAM{' '}
                <input
                  type="file"
                  onChange={event => {
                    setLocalCram(event.target.files?.[0])
                  }}
                />
              </label>
              <label>
                CRAI{' '}
                <input
                  type="file"
                  onChange={event => {
                    setLocalCrai(event.target.files?.[0])
                  }}
                />
              </label>
            </div>
          ) : (
            <div className="url-inputs">
              <div className="url-fields">
                <div className="url-row">
                  <label htmlFor="cram">CRAM</label>
                  <input
                    id="cram"
                    type="text"
                    value={cramUrl}
                    onChange={event => {
                      setCramUrl(event.target.value)
                    }}
                  />
                </div>
                <div className="url-row">
                  <label htmlFor="crai">CRAI</label>
                  <input
                    id="crai"
                    type="text"
                    value={craiUrl}
                    onChange={event => {
                      setCraiUrl(event.target.value)
                    }}
                  />
                </div>
              </div>
              <div className="example-buttons">
                <span>Examples:</span>
                {exampleFiles.map(file => (
                  <button
                    key={file.url}
                    onClick={() => {
                      setCramUrl(file.url)
                      setCraiUrl(`${file.url}.crai`)
                    }}
                  >
                    {file.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </fieldset>
      </div>
      {current?.error ? (
        <div className="error">{`${current.error}`}</div>
      ) : current?.data ? (
        <DataViewer data={current.data} />
      ) : (
        <div>
          {handles
            ? (current?.progress ?? 'Loading index and header…')
            : 'Choose a .cram and its .crai'}
        </div>
      )}
    </div>
  )
}
