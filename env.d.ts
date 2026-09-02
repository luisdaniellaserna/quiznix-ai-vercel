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
}

interface UserAnswer {
  question: QuestionFormat
  answer: string | null
}
