/**
 * Sudoku rules as pure functions over flat, row-major grids.
 *
 * `0` means empty and every other value is a digit: 1–4 on a 4×4 board, 1–9 on a
 * 9×9 one. A plain `number[]` keeps the board clonable with `slice()`, assertable
 * in tests, and storable without a codec.
 */

export type BoardSize = 4 | 9

export type Grid = number[]

/** Pencil marks per cell, ascending. An untouched cell holds `[]`. */
export type Notes = number[][]

const BOX_SIZES: Record<BoardSize, number> = { 4: 2, 9: 3 }

const peersBySize = new Map<BoardSize, number[][]>()
const unitsBySize = new Map<BoardSize, number[][]>()

export function boxSize(size: BoardSize): number {
  return BOX_SIZES[size]
}

export function cellCount(size: BoardSize): number {
  return size * size
}

export function digits(size: BoardSize): number[] {
  return Array.from({ length: size }, (_, index) => index + 1)
}

export function emptyGrid(size: BoardSize): Grid {
  return Array.from({ length: cellCount(size) }, () => 0)
}

export function emptyNotes(size: BoardSize): Notes {
  return Array.from({ length: cellCount(size) }, () => [])
}

export function rowOf(size: BoardSize, index: number): number {
  return Math.floor(index / size)
}

export function columnOf(size: BoardSize, index: number): number {
  return index % size
}

/** Box ordinal counted left-to-right, top-to-bottom. */
export function boxOf(size: BoardSize, index: number): number {
  const box = boxSize(size)
  return Math.floor(rowOf(size, index) / box) * box + Math.floor(columnOf(size, index) / box)
}

/** Every row, then every column, then every box, each as a list of cell indexes. */
export function units(size: BoardSize): number[][] {
  const cached = unitsBySize.get(size)
  if (cached) return cached

  const box = boxSize(size)

  const rows = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => row * size + column),
  )
  const columns = Array.from({ length: size }, (_, column) =>
    Array.from({ length: size }, (_, row) => row * size + column),
  )

  const boxes: number[][] = []
  for (let startRow = 0; startRow < size; startRow += box) {
    for (let startColumn = 0; startColumn < size; startColumn += box) {
      const cells: number[] = []
      for (let row = 0; row < box; row++) {
        for (let column = 0; column < box; column++) {
          cells.push((startRow + row) * size + startColumn + column)
        }
      }
      boxes.push(cells)
    }
  }

  const all = [...rows, ...columns, ...boxes]
  unitsBySize.set(size, all)
  return all
}

/** The 20 cells (or 8 on a 4×4) that share a row, column or box with `index`. */
export function cellPeers(size: BoardSize, index: number): number[] {
  const cached = peersBySize.get(size)
  if (cached) return cached[index]

  const peers = Array.from({ length: cellCount(size) }, () => new Set<number>())
  for (const unit of units(size)) {
    for (const index of unit) {
      for (const other of unit) if (other !== index) peers[index].add(other)
    }
  }

  const flattened = peers.map((set) => [...set])
  peersBySize.set(size, flattened)
  return flattened[index]
}

/** Cells holding a digit that repeats inside one of its units. */
export function findConflicts(grid: Grid, size: BoardSize): Set<number> {
  const conflicts = new Set<number>()
  for (const unit of units(size)) {
    const seen = new Map<number, number[]>()
    for (const index of unit) {
      const value = grid[index]
      if (!value) continue
      const holders = seen.get(value)
      if (holders) holders.push(index)
      else seen.set(value, [index])
    }
    for (const holders of seen.values()) {
      if (holders.length < 2) continue
      for (const index of holders) conflicts.add(index)
    }
  }
  return conflicts
}

export function isComplete(grid: Grid): boolean {
  return grid.every((value) => value > 0)
}

export function isSolved(grid: Grid, size: BoardSize): boolean {
  return isComplete(grid) && findConflicts(grid, size).size === 0
}

/** Digits the cell can still take without repeating one of its peers. */
export function candidates(grid: Grid, size: BoardSize, index: number): number[] {
  if (grid[index]) return []
  const taken = new Set<number>()
  for (const peer of cellPeers(size, index)) {
    const value = grid[peer]
    if (value) taken.add(value)
  }
  return digits(size).filter((digit) => !taken.has(digit))
}

export function emptyCells(grid: Grid): number[] {
  const empties: number[] = []
  grid.forEach((value, index) => {
    if (!value) empties.push(index)
  })
  return empties
}

export function toggleNote(notes: Notes, index: number, digit: number): Notes {
  const next = notes.map((cell) => cell.slice())
  const current = next[index]
  next[index] = current.includes(digit)
    ? current.filter((value) => value !== digit)
    : [...current, digit].sort((a, b) => a - b)
  return next
}

export function clearCellNotes(notes: Notes, index: number): Notes {
  if (notes[index].length === 0) return notes
  const next = notes.map((cell) => cell.slice())
  next[index] = []
  return next
}

/** Drops `digit` from the pencil marks of every peer, the way a solver would. */
export function prunePeerNotes(notes: Notes, size: BoardSize, index: number, digit: number): Notes {
  const next = notes.map((cell) => cell.slice())
  for (const peer of cellPeers(size, index)) {
    if (!next[peer].includes(digit)) continue
    next[peer] = next[peer].filter((value) => value !== digit)
  }
  return next
}
