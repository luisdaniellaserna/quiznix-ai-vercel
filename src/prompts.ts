import { MODE_CONFIG, type Mode } from './quizConfig'

export function buildQuizPrompt(
  topics: string[],
  mode: Mode,
  count: number,
  sessionId: string,
): string {
  const topicList = topics.map((topic) => `- ${topic.trim()}`).filter(Boolean).join('\n')
  return `
      Create exactly ${count} quiz questions split evenly across these topics:
      ${topicList}
      Difficulty: ${MODE_CONFIG[mode].difficulty}
      Type: Multiple Choice
      Mix the questions from different topics randomly — do not group them by topic.

      The output JSON must contain a "results" array with exactly ${count} entries.
      Do not stop early, do not summarize, and do not skip any questions.
      Return all ${count} questions, then stop.

      Session: ${sessionId}
      This is a brand-new, independent quiz request. Ignore any prior conversations,
      quizzes, or topics. Do not reuse, repeat, or be influenced by questions,
      categories, or examples from any previous session. Generate completely fresh
      questions that fit only the topics listed above.
    `
}
