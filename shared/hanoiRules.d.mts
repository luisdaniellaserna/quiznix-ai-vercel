/**
 * Types for shared/hanoiRules.mjs. The implementation stays plain ESM so the
 * room server can import it directly with Node (see the Phase 2 group race).
 */

export type Board = number[][]
export interface Move {
  from: number
  to: number
}

export declare const MIN_DISKS: number
export declare const MAX_DISKS: number
export declare const PEG_COUNT: number
export declare const TARGET_PEG: number

export declare function createBoard(disks: number): Board
export declare function optimalMoves(disks: number): number
export declare function hintsAllowed(disks: number): number
export declare function topDisk(board: Board, peg: number): number | null
export declare function isLegalMove(board: Board, from: number, to: number): boolean
export declare function applyMove(board: Board, from: number, to: number): Board
export declare function isSolved(board: Board, disks: number): boolean
export declare function remainingMoves(board: Board, disks: number): number
export declare function nextHint(board: Board, disks: number): Move | null
