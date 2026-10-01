/**
 * Pure question-generation helpers: server-mirroring validation, near-duplicate
 * detection, and a bounded fill loop. Kept out of App.vue so the "short quiz"
 * and "repeated questions" behaviour is unit-testable.
 */

// Mirrors server/roomManager.mjs caps, so a question the client accepts can
// never be turned away by update-room-quiz.
export const MAX_QUESTIONS = 100
export const MAX_QUESTION_LENGTH = 500
export const MAX_ANSWER_LENGTH = 100
export const MAX_INCORRECT_ANSWERS = 8

/** At/above this Dice similarity two questions are treated as the same fact. */
export const DUPLICATE_THRESHOLD = 0.8

/** Extra model calls allowed to fill a short count before giving up. */
export const DEFAULT_FILL_ROUNDS = 3

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'in',
  'on',
  'to',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'when',
  'where',
  'why',
  'how',
  'that',
  'this',
  'these',
  'those',
  'it',
  'its',
  'as',
  'at',
  'by',
  'for',
  'from',
  'with',
  'do',
  'does',
  'did',
  'has',
  'have',
  'had',
  'not',
  'no',
  'you',
  'your',
])

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function isValidAnswer(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_ANSWER_LENGTH
}

/** Server-compatible validity check (see assertValidQuestions in roomManager). */
export function isValidQuestion(value: unknown): value is QuestionFormat {
  const q = asRecord(value)
  if (!q) return false
  if (typeof q.question !== 'string') return false
  if (q.question.trim() === '' || q.question.length > MAX_QUESTION_LENGTH) return false
  if (typeof q.correct_answer !== 'string') return false
  if (q.correct_answer.trim() === '' || q.correct_answer.length > MAX_ANSWER_LENGTH) return false
  if (!Array.isArray(q.incorrect_answers)) return false
  if (q.incorrect_answers.length < 1 || q.incorrect_answers.length > MAX_INCORRECT_ANSWERS) {
    return false
  }
  return q.incorrect_answers.every(isValidAnswer)
}

/** Drop malformed entries and normalize the optional explanation. */
export function sanitizeQuestions(value: unknown): QuestionFormat[] {
  if (!Array.isArray(value)) return []
  const clean: QuestionFormat[] = []
  for (const entry of value) {
    if (!isValidQuestion(entry)) continue
    const explanation =
      typeof entry.explanation === 'string' && entry.explanation.trim() !== ''
        ? entry.explanation.trim()
        : undefined
    clean.push({ ...entry, explanation })
  }
  return clean
}

export function normalizeQuestion(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

function significantTokens(text: string): Set<string> {
  const tokens = normalizeQuestion(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
  return new Set(tokens)
}

/** Dice coefficient over significant words: 1 = identical, 0 = no overlap. */
export function questionSimilarity(a: string, b: string): number {
  const left = significantTokens(a)
  const right = significantTokens(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) {
    if (right.has(token)) shared++
  }
  return (2 * shared) / (left.size + right.size)
}

/** True when `question` repeats any text in `existing` (exact or near-duplicate). */
export function isDuplicateQuestion(question: string, existing: Iterable<string>): boolean {
  const normalized = normalizeQuestion(question)
  for (const other of existing) {
    if (normalizeQuestion(other) === normalized) return true
    if (questionSimilarity(question, other) >= DUPLICATE_THRESHOLD) return true
  }
  return false
}

export interface FillToCountOptions {
  requested: number
  /** Fresh, already-validated seed questions (the first model response). */
  seed: QuestionFormat[]
  /** Question texts from previous quizzes that must never resurface. */
  history: string[]
  /** Fetches up to `missing` more questions, told which texts to avoid. */
  fetchMore: (missing: number, alreadyAsked: string[]) => Promise<QuestionFormat[]>
  maxRounds?: number
}

/**
 * Accumulate distinct questions up to `requested`, topping up with extra model
 * calls. Every batch is sanitized and deduped against the accumulated set (and
 * itself) plus cross-session history, so neither malformed entries nor repeats
 * can slip through. Returns fewer than `requested` only when the model still
 * cannot deliver after `maxRounds` extra calls.
 */
export async function fillToCount(options: FillToCountOptions): Promise<QuestionFormat[]> {
  const maxRounds = options.maxRounds ?? DEFAULT_FILL_ROUNDS
  const accepted: QuestionFormat[] = []
  const acceptedTexts: string[] = []

  const accept = (question: QuestionFormat) => {
    if (accepted.length >= options.requested) return
    if (isDuplicateQuestion(question.question, acceptedTexts)) return
    if (isDuplicateQuestion(question.question, options.history)) return
    accepted.push(question)
    acceptedTexts.push(question.question)
  }

  for (const question of sanitizeQuestions(options.seed)) {
    accept(question)
  }

  let rounds = 0
  while (accepted.length < options.requested && rounds < maxRounds) {
    rounds++
    const missing = options.requested - accepted.length
    const alreadyAsked = [...options.history, ...acceptedTexts]
    let batch: QuestionFormat[]
    try {
      batch = await options.fetchMore(missing, alreadyAsked)
    } catch {
      // a failed top-up must never discard the valid questions already collected
      break
    }
    for (const question of sanitizeQuestions(batch)) {
      accept(question)
    }
  }

  return accepted
}
