export function computeScore(answers: UserAnswer[]): number {
  return answers.filter((answer) => answer.answer === answer.question.correct_answer).length
}
