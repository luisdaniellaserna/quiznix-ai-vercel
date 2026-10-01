import { describe, expect, it, vi } from 'vitest'
import {
  fillToCount,
  isDuplicateQuestion,
  isValidQuestion,
  questionSimilarity,
  sanitizeQuestions,
} from './quizGeneration'

const PLANET = 'Which planet is known as the Red Planet?'
const PLANET_TYPO = 'Which planet is known as the Red Planet'
const SEA = 'Which ocean is the largest on Earth?'
const GAS = 'What gas do plants absorb from the atmosphere?'
const WALL = 'In which year did the Berlin Wall fall?'
const ROMEO = 'Who wrote the play Romeo and Juliet?'

function makeQuestion(question: string, overrides: Partial<QuestionFormat> = {}): QuestionFormat {
  return {
    type: 'multiple',
    difficulty: 'easy',
    category: 'Test',
    question,
    correct_answer: 'A',
    incorrect_answers: ['B', 'C', 'D'],
    ...overrides,
  }
}

describe('isValidQuestion', () => {
  it('accepts a well-formed question', () => {
    expect(isValidQuestion(makeQuestion(PLANET))).toBe(true)
  })

  it('rejects missing, empty, or malformed fields', () => {
    expect(isValidQuestion(null)).toBe(false)
    expect(isValidQuestion({})).toBe(false)
    expect(isValidQuestion(makeQuestion('   '))).toBe(false)
    expect(isValidQuestion(makeQuestion(PLANET, { correct_answer: '' }))).toBe(false)
    expect(isValidQuestion(makeQuestion(PLANET, { incorrect_answers: [] }))).toBe(false)
    expect(isValidQuestion(makeQuestion(PLANET, { incorrect_answers: ['ok', ''] }))).toBe(false)
  })

  it('rejects more choices than the server accepts', () => {
    const tooMany = Array.from({ length: 9 }, (_, i) => `wrong-${i}`)
    expect(isValidQuestion(makeQuestion(PLANET, { incorrect_answers: tooMany }))).toBe(false)
  })
})

describe('sanitizeQuestions', () => {
  it('drops malformed entries and keeps the valid ones', () => {
    const clean = sanitizeQuestions([
      makeQuestion(PLANET),
      { question: 'missing fields' },
      null,
      makeQuestion(GAS),
    ])
    expect(clean.map((q) => q.question)).toEqual([PLANET, GAS])
  })

  it('normalizes a blank explanation to undefined', () => {
    const [clean] = sanitizeQuestions([makeQuestion(PLANET, { explanation: '   ' })])
    expect(clean.explanation).toBeUndefined()
  })

  it('returns an empty array for non-array input', () => {
    expect(sanitizeQuestions(undefined)).toEqual([])
    expect(sanitizeQuestions({ results: [] })).toEqual([])
  })
})

describe('questionSimilarity and isDuplicateQuestion', () => {
  it('treats a reworded question as a near-duplicate', () => {
    const original = 'Which keyword declares a constant in JavaScript?'
    const reworded = 'In JavaScript, which keyword declares a constant variable?'
    expect(questionSimilarity(original, reworded)).toBeGreaterThanOrEqual(0.8)
    expect(isDuplicateQuestion(reworded, [original])).toBe(true)
  })

  it('treats an exact repeat as a duplicate', () => {
    expect(isDuplicateQuestion(PLANET, [PLANET_TYPO])).toBe(true)
  })

  it('keeps genuinely different questions apart', () => {
    expect(isDuplicateQuestion(ROMEO, [PLANET, GAS, WALL, SEA])).toBe(false)
  })
})

describe('fillToCount', () => {
  it('dedupes the seed and each batch, then tops up to the requested count', async () => {
    const history = [ROMEO]
    const seed = [
      makeQuestion(PLANET),
      makeQuestion(PLANET), // exact repeat within the seed
      makeQuestion(ROMEO), // repeat from a previous quiz
    ]
    const batches = [
      [makeQuestion(GAS), makeQuestion(GAS)], // repeat within one batch
      [makeQuestion(WALL)],
    ]
    let call = 0
    const fetchMore = async (missing: number) => (batches[call++] ?? []).slice(0, missing)

    const result = await fillToCount({ requested: 3, seed, history, fetchMore })

    expect(result.map((q) => q.question)).toEqual([PLANET, GAS, WALL])
  })

  it('drops malformed seed questions before counting', async () => {
    const seed = [{ question: 'malformed' } as unknown as QuestionFormat, makeQuestion(PLANET)]
    const fetchMore = async () => [makeQuestion(GAS), makeQuestion(WALL)]

    const result = await fillToCount({ requested: 3, seed, history: [], fetchMore })

    expect(result.map((q) => q.question)).toEqual([PLANET, GAS, WALL])
  })

  it('stops retrying and returns what it has when the model keeps repeating', async () => {
    const fetchMore = vi.fn(async () => [makeQuestion(PLANET)])

    const result = await fillToCount({
      requested: 3,
      seed: [makeQuestion(PLANET)],
      history: [],
      fetchMore,
      maxRounds: 2,
    })

    expect(result).toHaveLength(1)
    expect(fetchMore).toHaveBeenCalledTimes(2)
  })

  it('keeps valid seed questions when a top-up call fails', async () => {
    const fetchMore = async () => {
      throw new Error('api down')
    }

    const result = await fillToCount({
      requested: 3,
      seed: [makeQuestion(PLANET)],
      history: [],
      fetchMore,
    })

    expect(result.map((q) => q.question)).toEqual([PLANET])
  })
})
