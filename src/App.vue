<script setup lang="ts">
import { computed, ref } from 'vue'
import StartScreen from './components/StartScreen.vue'
import { GoogleGenAI, Type } from '@google/genai'
import QuizScreen from './components/QuizScreen.vue'
import LoadingScreen from './components/LoadingScreen.vue'
import OpenAI from 'openai'
import ResultScreen from './components/ResultScreen.vue'
import GroupHost from './components/GroupHost.vue'
import GroupPlayer from './components/GroupPlayer.vue'
import SettingsMenu from './components/SettingsMenu.vue'
import { MODE_CONFIG, type GameMode, type Mode } from './quizConfig'
import { buildQuizPrompt } from './prompts'
import { computeScore } from './scoring'
import { parseJsonResponse } from './jsonParse'
import { useGroupStore } from './stores/groupStore'

type ApiProvider = 'gemini' | 'deepseek'

const apiProvider = (import.meta.env.VITE_AI_PROVIDER as ApiProvider) || 'gemini'

let apiKey: string | undefined

switch (apiProvider) {
  case 'gemini':
    apiKey = import.meta.env.VITE_GEMINI_API_KEY
    break
  case 'deepseek':
    apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY
    break
  default:
    break
}

const groupStore = useGroupStore()

const question = ref<Questions | undefined>(undefined)
const status = ref('start')
const isError = ref(false)
const errorMessage = ref('')
const userAnswers = ref<UserAnswer[]>([])
const selectedMode = ref<Mode>('easy')
const timedMode = ref(true)
const returnFromQuiz = ref(false)

// a join link like ?room=ABC123 drops players straight into the group join flow
const urlParams = new URLSearchParams(window.location.search)
if (urlParams.has('room')) {
  groupStore.prepareJoin()
  status.value = 'group'
}

const score = computed(() => computeScore(userAnswers.value))

function parseAndValidate(raw: string): Questions {
  const parsed = parseJsonResponse(raw) as Questions
  if (!Array.isArray(parsed.results) || parsed.results.length === 0) {
    throw new Error('No quiz questions were generated. Please try again.')
  }
  return parsed
}

async function geminiMain(topics: string[], mode: Mode, count: number): Promise<Questions> {
  const ai = new GoogleGenAI({ apiKey })

  const config = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        response_code: {
          type: Type.NUMBER,
        },
        results: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: {
                type: Type.STRING,
              },
              difficulty: {
                type: Type.STRING,
              },
              category: {
                type: Type.STRING,
              },
              question: {
                type: Type.STRING,
              },
              correct_answer: {
                type: Type.STRING,
              },
              incorrect_answers: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                },
              },
            },
            propertyOrdering: [
              'type',
              'difficulty',
              'category',
              'question',
              'correct_answer',
              'incorrect_answers',
            ],
          },
        },
      },
      propertyOrdering: ['response_code', 'results'],
    },
  }

  const contents = buildQuizPrompt(topics, mode, count)

  const response = await ai.models.generateContent({
    model: 'gemini-3.6-flash',
    contents,
    config,
  })
  return parseAndValidate(response.text ?? '')
}

async function deepseekMain(topics: string[], mode: Mode, count: number): Promise<Questions> {
  const openai = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey,
    dangerouslyAllowBrowser: true,
  })

  const systemPrompt = `
    The user will provide a request or topic for a quiz. Your task is to interpret the INTENT or THEME behind the user's input—especially if it is slang, a colloquialism, or an abstract concept—and generate quiz questions based on that underlying idea rather than using the word literally.
    
    Rules:
    1. Parse idioms, slang, and cultural context (e.g., "kalokohan" means silly trivia, funny facts, or absurd situations).
    2. Map the request to a recognized quiz category (e.g., General Knowledge, Pop Culture, Science & Nature, Entertainment).
    3. Always respond strictly in the valid JSON format specified below, with no markdown code blocks or surrounding text.

    EXAMPLE INPUT 1:
    Create a 5 quiz question about JavaScript.
    Difficulty: Easy to Hard
    Type: Multiple Choice

    EXAMPLE OUTPUT 1:
    {"response_code":0,"results":[{"type":"multiple","difficulty":"medium","category":"Science: Computers","question":"Which keyword is used to declare a constant variable in JavaScript?","correct_answer":"const","incorrect_answers":["var","let","constant"]}]}

    EXAMPLE INPUT 2:
    kalokohan

    EXAMPLE OUTPUT 2:
    {"response_code":0,"results":[{"type":"multiple","difficulty":"easy","category":"General Knowledge","question":"What did a man in 2011 successfully register as a religion in New Zealand?","correct_answer":"Church of the Flying Spaghetti Monster","incorrect_answers":["Jediism","Pastafarianism","Dudeism"]}]}
  `

  const userPrompt = buildQuizPrompt(topics, mode, count)

  const completion = await openai.chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    model: 'deepseek-chat',
    response_format: {
      type: 'json_object',
    },
  })

  const response = completion.choices[0].message.content

  console.log(response)
  return parseAndValidate(response ?? '')
}

function generateQuestions(topics: string[], mode: Mode, count: number): Promise<Questions> {
  return apiProvider === 'deepseek'
    ? deepseekMain(topics, mode, count)
    : geminiMain(topics, mode, count)
}

// guarantee a randomized question order regardless of the AI's output ordering
function shuffleQuestions<T>(items: T[]): T[] {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

async function startQuiz(payload: {
  topics: string[]
  mode: Mode
  itemCount: number
  gameMode: GameMode
  timed: boolean
  maxPlayers?: number
  timePerQuestion?: number
}) {
  status.value = 'loading'
  isError.value = false
  returnFromQuiz.value = false
  selectedMode.value = payload.mode
  timedMode.value = payload.timed

  try {
    const generated = await generateQuestions(
      payload.topics.filter((topic) => topic !== ''),
      payload.mode,
      payload.itemCount,
    )
    const results = shuffleQuestions(generated.results)
    if (payload.gameMode === 'group') {
      groupStore.createRoom({
        topic: payload.topics.join(', '),
        questions: results,
        timerSeconds: payload.timePerQuestion ?? MODE_CONFIG[payload.mode].timerSeconds,
        maxPlayers: payload.maxPlayers ?? 10,
      })
      status.value = 'group'
    } else {
      question.value = { ...generated, results }
      status.value = 'ready'
    }
  } catch (err) {
    console.error(err)
    errorMessage.value =
      err instanceof SyntaxError
        ? 'The quiz generator returned an invalid response. Please try again.'
        : err instanceof Error
          ? err.message
          : 'Something went wrong! Please try again.'
    status.value = 'start'
    isError.value = true
  }
}

function storeAnswer(answer: UserAnswer) {
  userAnswers.value.push(answer)
}

function removeLastAnswer() {
  userAnswers.value.pop()
}

function joinGroup(payload: { code: string; name: string }) {
  groupStore.joinRoom(payload.code, payload.name)
  status.value = 'group'
}

function leaveGroup() {
  groupStore.leave()
  status.value = 'start'
  returnFromQuiz.value = false
}

function reset() {
  returnFromQuiz.value = true
  status.value = 'start'
  userAnswers.value = []
}
</script>

<template>
  <div class="min-h-screen overflow-x-hidden bg-base-100 text-base-content">
    <StartScreen
      v-if="status === 'start' && apiKey"
      :return-from-quiz="returnFromQuiz"
      @start-quiz="startQuiz"
      @join-group="joinGroup"
    />

    <GroupHost v-else-if="status === 'group' && groupStore.role === 'host'" @leave="leaveGroup" />
    <GroupPlayer
      v-else-if="status === 'group' && groupStore.role === 'player'"
      @leave="leaveGroup"
    />

    <template v-else>
      <header class="navbar bg-base-200 shadow-sm px-4 py-4">
        <div class="navbar-start">
          <span class="text-xl font-bold">Quiznix AI</span>
        </div>
        <div class="navbar-end">
          <SettingsMenu :show-quit="status === 'ready'" @quit-quiz="reset" />
        </div>
      </header>

      <main class="container mx-auto p-4">
        <QuizScreen
          v-if="status === 'ready'"
          @store-answer="storeAnswer"
          @end-quiz="status = 'finished'"
          @previous="removeLastAnswer"
          :questions="question!.results"
          :duration="MODE_CONFIG[selectedMode].timerSeconds"
          :timed="timedMode"
        />
        <LoadingScreen v-else-if="status === 'loading'" />
        <ResultScreen
          v-else-if="status === 'finished'"
          @reset="reset"
          :user-answers="userAnswers"
          :score="score"
          :total="userAnswers.length"
        />
        <div v-else class="alert alert-warning mt-4">No API keys!</div>
      </main>
    </template>

    <div class="toast toast-end toast-bottom z-50">
      <div v-show="isError" role="alert" class="alert alert-error">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6 shrink-0 stroke-current"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 7.5v6m0 3h.01"
          />
        </svg>
        <span>{{ errorMessage }}</span>
      </div>
    </div>
  </div>
</template>
