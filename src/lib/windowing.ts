export interface LinearWindow {
  start: number
  end: number
}

export interface GridWindow extends LinearWindow {
  leadingRows: number
  trailingRows: number
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

/** Complete grid rows around focus, plus row counts represented by cheap spacer elements. */
export function gridWindow(length: number, focusIndex: number, columns: number, rowRadius: number): GridWindow {
  const safeLength = Math.max(0, Math.floor(length))
  const safeColumns = Math.max(1, Math.floor(columns))
  const totalRows = Math.ceil(safeLength / safeColumns)
  if (!totalRows) return { start: 0, end: 0, leadingRows: 0, trailingRows: 0 }
  const focusRow = Math.floor(Math.max(0, Math.min(safeLength - 1, focusIndex)) / safeColumns)
  const safeRadius = Math.max(0, Math.floor(rowRadius))
  const firstRow = Math.max(0, focusRow - safeRadius)
  const lastRow = Math.min(totalRows, focusRow + safeRadius + 1)
  return {
    start: firstRow * safeColumns,
    end: Math.min(safeLength, lastRow * safeColumns),
    leadingRows: firstRow,
    trailingRows: totalRows - lastRow,
  }
}

/** Aggregate omitted flex items without CSS variables or modern calc arithmetic. */
export function horizontalSpacerDimensions(
  count: number,
  itemWidthVw: number,
  itemMinimumPx: number,
  gapVw = .55,
  legacyGapPx = 7,
): { width: string; minWidth: string } {
  const safeCount = Math.max(0, Math.floor(count))
  const internalGaps = Math.max(0, safeCount - 1)
  const width = safeCount * itemWidthVw + internalGaps * gapVw
  const minimum = safeCount * itemMinimumPx + internalGaps * legacyGapPx
  return {
    width: `${Number(width.toFixed(3))}vw`,
    minWidth: `${Math.round(minimum)}px`,
  }
}
