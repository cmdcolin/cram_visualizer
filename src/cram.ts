import { CraiIndex, CramFile, IndexedCramFile } from '@gmod/cram'

import { LoggingFile } from './loggingFile.ts'

import type { ReferenceInfo, Slice } from '@gmod/cram'
import type { GenericFilehandle } from 'generic-filehandle2'

type CramContainer = ReturnType<CramFile['getContainerAtPosition']>
type CompressionScheme = NonNullable<
  Awaited<ReturnType<CramContainer['getCompressionScheme']>>
>
export type CramEncoding = NonNullable<
  CompressionScheme['dataSeriesEncoding'][keyof CompressionScheme['dataSeriesEncoding']]
>
export type ContainerHeader = Awaited<ReturnType<CramContainer['getHeader']>>
type CramSlice = ReturnType<CramContainer['getSlice']>
export type SliceHeader = Awaited<ReturnType<CramSlice['getHeader']>>
export type CramBlock = Awaited<ReturnType<CramSlice['getBlocks']>>[number]

export type { Slice } from '@gmod/cram'

export interface CramData {
  cram: CramFile
  indexed: IndexedCramFile
  log: LoggingFile
  refs: ReferenceInfo[]
  index: Record<string, Slice[] | undefined>
  definition: Awaited<ReturnType<CramFile['getDefinition']>>
  headerText: string
}

export async function loadCram(
  cramHandle: GenericFilehandle,
  craiHandle: GenericFilehandle,
  onProgress?: (loaded: number, total?: number) => void,
) {
  const log = new LoggingFile(cramHandle)
  const cram = new CramFile({ filehandle: log })
  const crai = new CraiIndex({ filehandle: craiHandle })
  const indexed = new IndexedCramFile({ cram, index: crai })
  const [index, refs, definition, headerText] = await Promise.all([
    crai.getIndex({ onProgress }),
    cram.getReferenceInfo(),
    cram.getDefinition(),
    cram.getHeaderText(),
  ])
  const data: CramData = {
    cram,
    indexed,
    log,
    refs,
    index,
    definition,
    headerText: headerText ?? '',
  }
  return data
}

export const codecNames: Record<number, string> = {
  0: 'NULL',
  1: 'EXTERNAL',
  2: 'GOLOMB',
  3: 'HUFFMAN',
  4: 'BYTE_ARRAY_LEN',
  5: 'BYTE_ARRAY_STOP',
  6: 'BETA',
  7: 'SUBEXP',
  8: 'GOLOMB_RICE',
  9: 'GAMMA',
}

export const dataSeriesDescriptions: Record<string, string> = {
  BF: 'BAM bit flags',
  CF: 'CRAM bit flags',
  RI: 'reference ID',
  RL: 'read length',
  AP: 'alignment position',
  RG: 'read group',
  RN: 'read name',
  MF: 'mate flags',
  NS: 'mate reference ID',
  NP: 'mate position',
  TS: 'template size',
  NF: 'distance to next fragment',
  TL: 'tag list ID',
  FN: 'number of read features',
  FC: 'read feature code',
  FP: 'read feature position',
  DL: 'deletion length',
  BB: 'bases (stretch)',
  QQ: 'quality scores (stretch)',
  BS: 'base substitution code',
  IN: 'insertion',
  RS: 'reference skip length',
  PD: 'padding',
  HC: 'hard clip',
  SC: 'soft clip',
  MQ: 'mapping quality',
  BA: 'bases',
  QS: 'quality scores',
}

function externalIds(encoding: CramEncoding): number[] {
  return encoding.codecId === 1 || encoding.codecId === 5
    ? [encoding.parameters.blockContentId]
    : encoding.codecId === 4
      ? [
          ...externalIds(encoding.parameters.lengthsEncoding),
          ...externalIds(encoding.parameters.valuesEncoding),
        ]
      : []
}

export interface SeriesEncoding {
  name: string
  isTag: boolean
  encoding: CramEncoding
  contentIds: number[]
}

export function describeScheme(scheme: CompressionScheme) {
  const series: SeriesEncoding[] = [
    ...Object.entries(scheme.dataSeriesEncoding).map(([name, encoding]) => ({
      name,
      isTag: false,
      encoding,
      contentIds: externalIds(encoding),
    })),
    ...Object.entries(scheme.tagEncoding).map(([key, encoding]) => ({
      name: `${key.slice(0, 2)}:${key[2]}`,
      isTag: true,
      encoding,
      contentIds: externalIds(encoding),
    })),
  ]
  const byContentId = new Map<number, string[]>()
  for (const s of series) {
    for (const id of s.contentIds) {
      byContentId.set(id, [...(byContentId.get(id) ?? []), s.name])
    }
  }
  const coreSeries = series
    .filter(s => s.contentIds.length === 0 && s.encoding.codecId !== 0)
    .map(s => s.name)
  return {
    series,
    byContentId,
    coreSeries,
    preservation: {
      readNamesIncluded: scheme.readNamesIncluded,
      APdelta: scheme.APdelta,
      referenceRequired: scheme.referenceRequired,
      tagIdsDictionary: scheme.tagIdsDictionary,
      substitutionMatrix: scheme.substitutionMatrix,
    },
  }
}

export type SchemeDescription = ReturnType<typeof describeScheme>

export function blockLabel(block: CramBlock, scheme: SchemeDescription) {
  return block.contentType === 'CORE_DATA'
    ? scheme.coreSeries.length > 0
      ? `core (${scheme.coreSeries.join(', ')})`
      : 'core'
    : block.contentType === 'EXTERNAL_DATA'
      ? (scheme.byContentId.get(block.contentId)?.join(', ') ??
        `content ${block.contentId}`)
      : block.contentType
}

export function blockCategory(label: string) {
  const first = label.split(/[ ,]/)[0] ?? ''
  return first.includes(':')
    ? 'tags'
    : first === 'core'
      ? 'core'
      : ['QS', 'QQ'].includes(first)
        ? 'qualities'
        : ['BA', 'BB', 'BS', 'IN', 'SC'].includes(first)
          ? 'bases'
          : first === 'RN'
            ? 'names'
            : ['AP', 'RL', 'BF', 'CF', 'RI', 'MQ', 'RG', 'TL'].includes(first)
              ? 'positions & flags'
              : ['MF', 'NS', 'NP', 'TS', 'NF'].includes(first)
                ? 'mates'
                : ['FN', 'FC', 'FP', 'DL', 'RS', 'PD', 'HC'].includes(first)
                  ? 'read features'
                  : 'other'
}

export const categoryColors: Record<string, string> = {
  qualities: '#d1495b',
  bases: '#00798c',
  names: '#edae49',
  tags: '#8f5bd6',
  'positions & flags': '#3d7a3d',
  mates: '#5b8bd6',
  'read features': '#c97b2a',
  core: '#666666',
  other: '#999999',
}

export async function inspectSlice(cram: CramFile, entry: Slice) {
  const container = cram.getContainerAtPosition(entry.containerStart)
  const containerHeader = await container.getHeader()
  const compressionHeader = await container.getCompressionHeaderBlock()
  const scheme = await container.getCompressionScheme()
  const slice = container.getSlice(entry.sliceStart, entry.sliceBytes)
  const sliceHeader = await slice.getHeader()
  const blocks = await slice.getBlocks()
  const description = scheme ? describeScheme(scheme) : undefined
  return {
    entry,
    slice,
    containerHeader,
    compressionHeader,
    description,
    sliceHeader,
    blocks: blocks.map(block => {
      const label = description
        ? blockLabel(block, description)
        : block.contentType
      return {
        contentType: block.contentType,
        contentId: block.contentId,
        compressionMethod: block.compressionMethod,
        compressedSize: block.compressedSize,
        uncompressedSize: block.uncompressedSize,
        filePosition: block._endPosition - block._size,
        size: block._size,
        label,
        category: blockCategory(label),
      }
    }),
  }
}

export type SliceInspection = Awaited<ReturnType<typeof inspectSlice>>

export function containersOf(entries: Slice[]) {
  const map = new Map<number, Slice[]>()
  for (const e of entries) {
    map.set(e.containerStart, [...(map.get(e.containerStart) ?? []), e])
  }
  return map
}

export function fileSummary(index: Record<string, Slice[] | undefined>) {
  const all = Object.values(index).flatMap(e => e ?? [])
  const containers = containersOf(all)
  const sortedStarts = [...containers.keys()].toSorted((a, b) => a - b)
  let fileEnd = 0
  const refExtents: {
    seqId: number
    min: number
    max: number
    slices: number
    bytes: number
  }[] = []
  for (const [seqId, entries] of Object.entries(index)) {
    let min = Number.POSITIVE_INFINITY
    let max = 0
    let bytes = 0
    for (const e of entries ?? []) {
      const end = e.containerStart + e.sliceStart + e.sliceBytes
      min = Math.min(min, e.containerStart)
      max = Math.max(max, end)
      bytes += e.sliceBytes
    }
    fileEnd = Math.max(fileEnd, max)
    refExtents.push({
      seqId: Number(seqId),
      min,
      max,
      slices: entries?.length ?? 0,
      bytes,
    })
  }
  return {
    totalSlices: all.length,
    containers,
    sortedStarts,
    fileEnd,
    refExtents: refExtents.toSorted((a, b) => a.min - b.min),
  }
}

export type FileSummary = ReturnType<typeof fileSummary>

export type ReadKind =
  'file header' | 'container header' | 'compression header' | 'slice' | 'other'

export const readKindColors: Record<ReadKind, string> = {
  'file header': '#888888',
  'container header': '#edae49',
  'compression header': '#8f5bd6',
  slice: '#00798c',
  other: '#d1495b',
}

export function classifyRead(
  position: number,
  length: number,
  summary: FileSummary,
): ReadKind {
  const { sortedStarts, containers } = summary
  let lo = 0
  let hi = sortedStarts.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sortedStarts[mid]! <= position) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  const containerStart = sortedStarts[lo - 1]
  const slices =
    containerStart === undefined ? undefined : containers.get(containerStart)
  return containerStart === undefined
    ? 'file header'
    : position === containerStart
      ? 'container header'
      : slices?.some(s => s.sliceBytes === length)
        ? 'slice'
        : slices &&
            position <
              containerStart + Math.min(...slices.map(s => s.sliceStart)) + 1024
          ? 'compression header'
          : 'other'
}

export async function decodeSliceReads(inspection: SliceInspection) {
  const records = await inspection.slice.getAllRecords()
  return records.map(r => ({
    index: r.index,
    start: r.start,
    end: r.end,
    flags: r.flags,
    readName: r.readName,
    readLength: r.readLength,
    mappingQuality: r.mappingQuality,
    readFeatureCount: r.readFeatureCount,
    templateSize: r.templateSize,
    nextStart: r.nextStart,
    mateRecordNumber: r.mateRecordNumber,
    tags: Object.keys(r.tags),
  }))
}

export type SliceRead = Awaited<ReturnType<typeof decodeSliceReads>>[number]
