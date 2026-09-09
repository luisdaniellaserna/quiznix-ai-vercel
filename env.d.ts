/// <reference types="vite/client" />

interface Questions {
  response_code: number
  results: QuestionFormat[]
}

interface QuestionFormat {
  type: string
  difficulty: string
  category: string
  question: string
  correct_answer: string
  incorrect_answers: string[]
  /** 1-2 sentence explanation of why the correct answer is right. Optional for backward compat. */
  explanation?: string
}

interface UserAnswer {
  question: QuestionFormat
  answer: string | null
}
