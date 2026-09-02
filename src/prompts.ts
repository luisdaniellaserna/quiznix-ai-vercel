import { MODE_CONFIG, type Mode } from './quizConfig'

export function buildQuizPrompt(topics: string[], mode: Mode, count: number): string {
  const topicList = topics.map((topic) => `- ${topic}`).join('\n')
  return `
      Create ${count} quiz questions split evenly across these topics:
      ${topicList}
      Difficulty: ${MODE_CONFIG[mode].difficulty}
      Type: Multiple Choice
      Mix the questions from different topics randomly — do not group them by topic.
    `
}
