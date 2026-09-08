import { MODE_CONFIG, type Mode } from './quizConfig'

export interface QuizPromptOptions {
  /** Question texts asked in recent quizzes — the model must not repeat these. */
  recentQuestions?: string[]
  /** Random per-quiz token that nudges the model toward different subtopics/angles. */
  variationSeed?: string
}

export function buildQuizPrompt(
  topics: string[],
  mode: Mode,
  count: number,
  options: QuizPromptOptions = {},
): string {
  const topicList = topics.map((topic) => `- ${topic.trim()}`).filter(Boolean).join('\n')
  const recent = (options.recentQuestions ?? []).map((q) => q.trim()).filter(Boolean)
  const exclusion =
    recent.length > 0
      ? `\nThese questions were already asked in recent quizzes — do NOT repeat or closely paraphrase any of them:\n${recent.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n`
      : ''
  const seed = options.variationSeed?.trim() ?? ''
  const seedLine =
    seed !== ''
      ? `\nVariation seed: "${seed}" — let it steer you toward different subtopics, examples, and phrasings than you would pick by default.\n`
      : ''
  return `
      Create exactly ${count} quiz questions split evenly across these topics:
      ${topicList}
      Difficulty: ${MODE_CONFIG[mode].difficulty}
      Type: Multiple Choice
      Mix the questions from different topics randomly — do not group them by topic.
      Cover a varied mix of subtopics and angles — do not ask only the most
      obvious, canonical questions on each topic.
      ${seedLine}
      ${exclusion}
      The output JSON must contain a "results" array with exactly ${count} entries.
      Do not stop early, do not summarize, and do not skip any questions.
      Return all ${count} questions, then stop.
    `
}
