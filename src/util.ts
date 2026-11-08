function withCommas(n: number, fixed: number) {
  const [intPart, decPart] = n.toFixed(fixed).split('.')
  const int = (intPart ?? '').replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',')
  return decPart ? `${int}.${decPart}` : int
}

export function fmtBytes(n: number, fixed = 1) {
  return n >= 1e9
    ? `${withCommas(n / 1e9, fixed)} GB`
    : n >= 1e6
      ? `${withCommas(n / 1e6, fixed)} MB`
      : n >= 1e3
        ? `${withCommas(n / 1e3, fixed)} kB`
        : `${withCommas(n, 0)} B`
}

export function fmtBp(n: number) {
  return n >= 1e6
    ? `${withCommas(n / 1e6, 2).replace(/\.?0+$/, '')} Mbp`
    : n >= 1e3
      ? `${withCommas(n / 1e3, 1).replace(/\.0$/, '')} kbp`
      : `${withCommas(n, 0)} bp`
}

export function fmtInt(n: number) {
  return withCommas(n, 0)
}

export function fmtLoc(refName: string, start: number, end: number) {
  return `${refName}:${fmtInt(Math.round(start) + 1)}-${fmtInt(Math.round(end))}`
}

export function parseLoc(str: string) {
  const m = /^\s*([^:\s]+)(?::([\d,]+)(?:-([\d,]+))?)?\s*$/.exec(str)
  const num = (s: string | undefined) =>
    s === undefined ? undefined : Number(s.replaceAll(',', ''))
  return m ? { refName: m[1]!, start: num(m[2]), end: num(m[3]) } : undefined
}

export interface View {
  start: number
  end: number
}

export function clampView(view: View, length: number): View {
  const width = Math.min(Math.max(view.end - view.start, 20), length)
  const start = Math.min(Math.max(view.start, 0), length - width)
  return { start, end: start + width }
}

export function zoomView(
  view: View,
  factor: number,
  frac: number,
  length: number,
) {
  const width = view.end - view.start
  const anchor = view.start + width * frac
  const newWidth = width * factor
  return clampView(
    {
      start: anchor - newWidth * frac,
      end: anchor - newWidth * frac + newWidth,
    },
    length,
  )
}

export function setupCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
) {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx?.clearRect(0, 0, width, height)
  return ctx
}

export function niceTicks(start: number, end: number, count: number) {
  const raw = (end - start) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw
  const ticks: number[] = []
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) {
    ticks.push(t)
  }
  return ticks
}

export function fmtTick(t: number, step: number) {
  const scale = t >= 1e6 ? 1e6 : t >= 1e3 ? 1e3 : 1
  const unit = scale === 1e6 ? 'Mbp' : scale === 1e3 ? 'kbp' : 'bp'
  const digits = Math.max(0, Math.ceil(-Math.log10(step / scale)))
  return `${withCommas(t / scale, digits)} ${unit}`
}
