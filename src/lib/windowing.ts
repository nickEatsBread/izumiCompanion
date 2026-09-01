export interface LinearWindow {
  start: number
  end: number
}

/** Inclusive render window around the current remote-control focus. */
export function linearWindow(length: number, center: number, radius: number): LinearWindow {
  const safeLength = Math.max(0, Math.floor(length))
  if (!safeLength) return { start: 0, end: 0 }
  const safeRadius = Math.max(0, Math.floor(radius))
  const safeCenter = Math.max(0, Math.min(safeLength - 1, Math.floor(center)))
  return {
    start: Math.max(0, safeCenter - safeRadius),
    end: Math.min(safeLength, safeCenter + safeRadius + 1),
  }
}

/** Keep a small number of complete grid rows around focus so vertical D-pad movement is instant. */
export function gridItemVisible(index: number, focusIndex: number, columns: number, rowRadius: number): boolean {
  const safeColumns = Math.max(1, Math.floor(columns))
  return Math.abs(Math.floor(index / safeColumns) - Math.floor(Math.max(0, focusIndex) / safeColumns)) <= rowRadius
}

