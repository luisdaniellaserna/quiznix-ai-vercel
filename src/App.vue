<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import StartScreen from './components/StartScreen.vue'
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
import { randomId } from './stores/groupTabSync'

const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY

const groupStore = useGroupStore()

const question = ref<Questions | undefined>(undefined)
const status = ref('start')
const isError = ref(false)
const errorMessage = ref('')
const userAnswers = ref<UserAnswer[]>([])
const selectedMode = ref<Mode>('easy')
const timedMode = ref(true)
const returnFromQuiz = ref(false)
const hostReplayMode = ref(false)

// one room session per browser — used to surface the cross-tab takeover confirm
interface BlockingSession {
  tabId: string
  code: string
  role: 'host' | 'player'
  playerName?: string
  ageMs: number
}
const blockingSession = ref<BlockingSession | null>(null)
const pendingGroupAction = ref<(() => void | Promise<void>) | null>(null)

function withRoomGuard(action: () => void | Promise<void>) {
  const blocker = groupStore.getBlockingSession()
  if (blocker) {
    blockingSession.value = blocker
    pendingGroupAction.value = action
    return
  }
  void action()
}

async function confirmTakeover() {
  const blocker = blockingSession.value
  const action = pendingGroupAction.value
  if (!blocker || !action) return
  // evict the other tab first so its session releases the active-group slot,
  // then run the queued action so the new claim sticks
  groupStore.forceTakeover(blocker.tabId)
  // give the other tab a beat to react (it clears localStorage on the storage event)
  await new Promise((resolve) => setTimeout(resolve, 100))
  blockingSession.value = null
  pendingGroupAction.value = null
  await action()
}

function cancelTakeover() {
  blockingSession.value = null
  pendingGroupAction.value = null
}

const takeoverDialogRef = ref<HTMLDialogElement | null>(null)
const evictedDialogRef = ref<HTMLDialogElement | null>(null)

watch(
  () => blockingSession.value,
  (b) => {
    void nextTick(() => {
      if (b) {
        if (!takeoverDialogRef.value?.open) takeoverDialogRef.value?.showModal()
      } else {
        takeoverDialogRef.value?.close()
      }
    })
  },
)

watch(
  () => groupStore.evictedMessage,
  (msg) => {
    void nextTick(() => {
      if (msg) {
        if (!evictedDialogRef.value?.open) evictedDialogRef.value?.showModal()
      } else {
        evictedDialogRef.value?.close()
      }
    })
  },
)

function dismissEvicted() {
  evictedDialogRef.value?.close()
  groupStore.leave()
  status.value = 'start'
}

function onGroupPlayerConflict(payload: {
  blocker: {
    tabId: string
    code: string
    role: 'host' | 'player'
    playerName?: string
    ageMs: number
  }
  code: string
  name: string
}) {
  blockingSession.value = payload.blocker
  pendingGroupAction.value = () => {
    groupStore.joinRoom(payload.code, payload.name)
  }
}

// refresh with a live room: skip the forms and redial it directly; a dead
// room clears itself and lands on the ended prompt via the store's handlers
const urlParams = new URLSearchParams(window.location.search)
const urlRoom = (urlParams.get('room') ?? '').toUpperCase().slice(0, 6) || undefined
if (groupStore.autoResume(urlRoom)) {
  status.value = 'group'
} else if (urlParams.has('room')) {
  // a join link like ?room=ABC123 drops players straight into the group join flow
  withRoomGuard(() => groupStore.prepareJoin())
  status.value = 'group'
}

const score = computed(() => computeScore(userAnswers.value))

function parseAndValidate(raw: string): Questions {
  const parsed = parseJsonResponse(raw) as Questions
  if (!Array.isArray(parsed.results) || parsed.results.length === 0) {
    throw new Error('No quiz questions were generated. Please try again.')
  }
  // Explanation is optional (old cached questions lack it) — normalize when present.
  for (const q of parsed.results) {
    if (typeof q.explanation === 'string') {
      const trimmed = q.explanation.trim()
      q.explanation = trimmed === '' ? undefined : trimmed
    } else {
      q.explanation = undefined
    }
  }
  return parsed
}

function dedupeByQuestion(existing: QuestionFormat[], candidate: QuestionFormat): boolean {
  const text = normalizeQuestion(candidate.question)
  if (!text) return false
  return existing.some((q) => normalizeQuestion(q.question) === text)
}

function normalizeQuestion(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Texts of recently asked questions, persisted across sessions so the next quiz
// can explicitly exclude them. Only the prompt needs them — no other state.
const QUESTION_HISTORY_KEY = 'quiznix-question-history'
const QUESTION_HISTORY_LIMIT = 60
const QUESTION_EXCLUDE_LIMIT = 30

function loadQuestionHistory(): string[] {
  try {
    const raw = localStorage.getItem(QUESTION_HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((q): q is string => typeof q === 'string' && q.trim() !== '')
  } catch {
    return []
  }
}

function saveQuestionHistory(questions: string[]): void {
  try {
    const seen = new Set<string>()
    const merged = [...loadQuestionHistory(), ...questions]
      .map((q) => q.trim())
      .filter((q) => {
        if (q === '' || seen.has(normalizeQuestion(q))) return false
        seen.add(normalizeQuestion(q))
        return true
      })
    localStorage.setItem(
      QUESTION_HISTORY_KEY,
      JSON.stringify(merged.slice(-QUESTION_HISTORY_LIMIT)),
    )
  } catch {
    /* storage unavailable — quizzes still work, just without cross-session exclusion */
  }
}

// The model sometimes returns fewer questions than requested (often after a topic/difficulty
// change). Retry once with a focused follow-up that asks only for the missing count, citing
// the questions already generated so it doesn't repeat them. If still short, throw — better
// to fail than to ship a quiz with 3 of 5 questions.
async function ensureQuestionCount(
  initial: Questions,
  requested: number,
  fetchMore: (missing: number) => Promise<QuestionFormat[]>,
): Promise<Questions> {
  const existing = [...initial.results]
  if (existing.length >= requested) {
    return { ...initial, results: existing.slice(0, requested) }
  }
  const missing = requested - existing.length
  const extra = await fetchMore(missing)
  const filtered = extra.filter((q) => !dedupeByQuestion(existing, q))
  const merged = [...existing, ...filtered]
  if (merged.length < requested) {
    throw new Error(
      `Only ${merged.length} of ${requested} questions were generated. Please try again.`,
    )
  }
  return { ...initial, results: merged.slice(0, requested) }
}

async function deepseekMain(
  topics: string[],
  mode: Mode,
  count: number,
  recentQuestions: string[],
  variationSeed: string,
  existing: QuestionFormat[] = [],
): Promise<Questions> {
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
    4. Vary your questions across requests: spread them over different subtopics and angles instead of the most obvious, canonical questions, and honor the user message's exclusion list exactly — never repeat or closely paraphrase a listed question. The EXAMPLE OUTPUTS below illustrate FORMAT only: never output those example questions themselves.
    5. Every question must include an "explanation": 1-2 very short sentences (max ~25 words, plain text, no markdown) stating why the correct answer is right.

    EXAMPLE INPUT 1:
    Create a 5 quiz question about JavaScript.
    Difficulty: Easy to Hard
    Type: Multiple Choice

    EXAMPLE OUTPUT 1:
    {"response_code":0,"results":[{"type":"multiple","difficulty":"medium","category":"Science: Computers","question":"Which keyword is used to declare a constant variable in JavaScript?","correct_answer":"const","incorrect_answers":["var","let","constant"],"explanation":"const declares a block-scoped binding that cannot be reassigned after initialization."}]}

    EXAMPLE INPUT 2:
    kalokohan

    EXAMPLE OUTPUT 2:
    {"response_code":0,"results":[{"type":"multiple","difficulty":"easy","category":"General Knowledge","question":"What did a man in 2011 successfully register as a religion in New Zealand?","correct_answer":"Church of the Flying Spaghetti Monster","incorrect_answers":["Jediism","Pastafarianism","Dudeism"],"explanation":"It was officially recognized as a religion in New Zealand in 2011."}]}
  `

  const basePrompt = buildQuizPrompt(topics, mode, count, { recentQuestions, variationSeed })
  const userPrompt =
    existing.length > 0
      ? `${basePrompt}\n\nThese ${existing.length} questions were already asked (in this quiz or recent ones) and must NOT be repeated:\n${existing
          .map((q, i) => `${i + 1}. ${q.question}`)
          .join(
            '\n',
          )}\n\nGenerate exactly ${count} new, distinct questions that fit the same topics and difficulty.`
      : basePrompt

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ] as const

  // Thinking disabled = fastest path (no chain-of-thought tokens before the JSON).
  // reasoning_effort 'low' with thinking enabled is the manual/automatic fallback
  // if disabled ever hurts quality or the API rejects the toggle.
  const requestQuiz = async (
    thinkingType: 'enabled' | 'disabled',
    reasoningEffort?: 'low',
  ): Promise<Questions> => {
    const completion = await openai.chat.completions.create({
      messages: [...messages],
      model: 'deepseek-v4-flash',
      // NOTE: temperature/presence/frequency penalties are ignored by DeepSeek
      // while thinking is enabled, but they DO apply with thinking disabled —
      // keep them so disabled mode still gets varied questions.
      temperature: 1.1,
      presence_penalty: 0.6,
      frequency_penalty: 0.4,
      response_format: {
        type: 'json_object',
      },
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      // DeepSeek-specific toggle, not in the OpenAI SDK types — sent top-level.
      thinking: { type: thinkingType },
    } as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
      thinking: { type: 'enabled' | 'disabled' }
    })

    return parseAndValidate(completion.choices[0].message.content ?? '')
  }

  try {
    return await requestQuiz('disabled')
  } catch (err) {
    console.warn('[quiz] disabled-thinking request failed, retrying with low effort', err)
    return await requestQuiz('enabled', 'low')
  }
}

async function deepseekFetchMore(
  topics: string[],
  mode: Mode,
  missing: number,
  recentQuestions: string[],
  variationSeed: string,
  existing: QuestionFormat[],
): Promise<QuestionFormat[]> {
  const result = await deepseekMain(topics, mode, missing, recentQuestions, variationSeed, existing)
  return result.results
}

async function generateQuestions(topics: string[], mode: Mode, count: number): Promise<Questions> {
  const history = loadQuestionHistory()
  const recent = history.slice(-QUESTION_EXCLUDE_LIMIT)
  const known = new Set(history.map(normalizeQuestion))
  const variationSeed = randomId().slice(0, 8)
  const initial = await deepseekMain(topics, mode, count, recent, variationSeed)
  // Never re-ask a question from a previous quiz, even if the model ignored
  // the exclusion list — treat repeats as missing and fetch replacements.
  const fresh = initial.results.filter((q) => !known.has(normalizeQuestion(q.question)))
  const base = { ...initial, results: fresh }
  // `recent` is already in the base prompt's exclusion list — only the
  // in-quiz questions need repeating here.
  const fetchMore = (missing: number) =>
    deepseekFetchMore(topics, mode, missing, recent, variationSeed, base.results)
  const completed = await ensureQuestionCount(base, count, fetchMore)
  saveQuestionHistory(completed.results.map((q) => q.question))
  return completed
}

/** Even split of total items across topics: first `remainder` topics get +1. */
function computeQuotas(total: number, numTopics: number): number[] {
  if (numTopics <= 0) return []
  const base = Math.floor(total / numTopics)
  const remainder = total % numTopics
  return Array.from({ length: numTopics }, (_, i) => base + (i < remainder ? 1 : 0))
}

/** Group-mode generation: per-topic quota calls so counts are enforceable. */
async function generateGroupQuestions(
  topics: string[],
  mode: Mode,
  total: number,
): Promise<Questions> {
  const clean = topics.filter((t) => t.trim() !== '')
  if (clean.length === 0) throw new Error('Add at least one topic.')
  if (total < clean.length) {
    throw new Error(`Need at least ${clean.length} questions for ${clean.length} topics.`)
  }
  const quotas = computeQuotas(total, clean.length)
  const history = loadQuestionHistory()
  const recent = history.slice(-QUESTION_EXCLUDE_LIMIT)
  const known = new Set(history.map(normalizeQuestion))
  const seedBase = randomId().slice(0, 8)
  const perTopic = await Promise.all(
    clean.map((topic, i) =>
      deepseekMain([topic], mode, quotas[i], recent, `${seedBase}-${i}`).then(
        (res) => ({ topic, quota: quotas[i], results: res.results }),
        (err) => {
          throw new Error(
            `Could not generate questions for "${topic}": ${err instanceof Error ? err.message : String(err)}`,
          )
        },
      ),
    ),
  )
  const merged: QuestionFormat[] = []
  for (const { results } of perTopic) {
    for (const q of results) {
      if (!known.has(normalizeQuestion(q.question)) && !dedupeByQuestion(merged, q)) {
        merged.push(q)
      }
    }
  }
  // top-up any shortfall (model returned fewer or dupes filtered)
  if (merged.length < total) {
    const missing = total - merged.length
    const extra = await deepseekFetchMore(clean, mode, missing, recent, seedBase, merged)
    for (const q of extra) {
      if (!dedupeByQuestion(merged, q) && !known.has(normalizeQuestion(q.question))) {
        merged.push(q)
      }
    }
  }
  if (merged.length < total) {
    throw new Error(`Only ${merged.length} of ${total} questions were generated. Please try again.`)
  }
  const results = shuffleQuestions(merged).slice(0, total)
  saveQuestionHistory(results.map((q) => q.question))
  return { response_code: 0, results }
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

  // guard the group-mode entry — if another tab is in a room, prompt the user first
  if (payload.gameMode === 'group') {
    const blocker = groupStore.getBlockingSession()
    if (blocker) {
      status.value = 'start'
      blockingSession.value = blocker
      pendingGroupAction.value = () => proceedWithGroupStart(payload)
      return
    }
  }

  await proceedWithGroupStart(payload)
}

async function proceedWithGroupStart(payload: {
  topics: string[]
  mode: Mode
  itemCount: number
  gameMode: GameMode
  timed: boolean
  maxPlayers?: number
  timePerQuestion?: number
}) {
  const cleanTopics = payload.topics.filter((topic) => topic !== '')
  const timerSeconds = payload.timePerQuestion ?? MODE_CONFIG[payload.mode].timerSeconds
  const maxPlayers = payload.maxPlayers ?? 10
  const topicLabel = cleanTopics.join(', ')
  if (payload.gameMode !== 'group') {
    status.value = 'loading'
    const MIN_TRIVIA_MS = 5000
    const startedAt = Date.now()
    try {
      const generated = await generateQuestions(cleanTopics, payload.mode, payload.itemCount)
      const results = shuffleQuestions(generated.results)
      const remaining = MIN_TRIVIA_MS - (Date.now() - startedAt)
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining))
      }
      hostReplayMode.value = false
      question.value = { ...generated, results }
      status.value = 'ready'
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
      pendingGroupAction.value = null
      blockingSession.value = null
    }
    return
  }

  // Group flow: room goes live instantly so players can join during generation.
  // New room -> create empty (quizReady=false) then fill via updateRoomQuiz.
  // Existing lobby room -> regenerate in place via updateRoomQuiz.
  const isNewRoom =
    !(groupStore.role === 'host' && groupStore.phase === 'lobby' && groupStore.roomCode !== '') ||
    groupStore.roomExpired
  hostReplayMode.value = false
  if (isNewRoom) {
    groupStore.createRoom({ topic: topicLabel, questions: [], timerSeconds, maxPlayers })
    status.value = 'group'
  } else {
    groupStore.setHostStatus('generating', topicLabel)
    status.value = 'group'
  }
  try {
    const generated = await generateGroupQuestions(cleanTopics, payload.mode, payload.itemCount)
    const results = shuffleQuestions(generated.results)
    groupStore.updateRoomQuiz({ topic: topicLabel, questions: results, timerSeconds, maxPlayers })
  } catch (err) {
    console.error(err)
    errorMessage.value =
      err instanceof Error ? err.message : 'Something went wrong! Please try again.'
    isError.value = true
    if (!isNewRoom) {
      groupStore.setHostStatus('choosing-topic', topicLabel)
    }
    // new rooms stay in the lobby with quizReady=false; host can Edit setup + retry
  }
}

function storeAnswer(answer: UserAnswer) {
  userAnswers.value.push(answer)
}

function removeLastAnswer() {
  userAnswers.value.pop()
}

function joinGroup(payload: { code: string; name: string }) {
  const blocker = groupStore.getBlockingSession()
  if (blocker) {
    blockingSession.value = blocker
    pendingGroupAction.value = () => {
      groupStore.joinRoom(payload.code, payload.name)
      status.value = 'group'
    }
    return
  }
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
  hostReplayMode.value = false
  status.value = 'start'
  userAnswers.value = []
}

// Host clicked "Play again" on the leaderboard — move the room back to the
// lobby (same code, same roster, new players can join while waiting), then
// take the host back to the start screen so they can change the setup.
function playAgain() {
  groupStore.backToLobby()
  status.value = 'start'
  returnFromQuiz.value = false
  hostReplayMode.value = true
}

// Host clicked "Edit setup" inside the lobby — stay in the room, show the
// setup form prefilled, and mark the lobby as choosing-topic for players.
function editGroupSetup() {
  hostReplayMode.value = true
  returnFromQuiz.value = false
  status.value = 'start'
  if (groupStore.roomExpired) return
  try {
    groupStore.setHostStatus('choosing-topic', groupStore.topic)
  } catch {}
}

function cancelEditSetup() {
  hostReplayMode.value = false
  status.value = 'group'
  // dead room: nothing to report status to — finalizing reopens a fresh one
  if (groupStore.roomExpired) return
  try {
    groupStore.setHostStatus(groupStore.quizReady ? 'waiting-to-start' : 'generating')
  } catch {}
}
</script>

<template>
  <div class="min-h-screen overflow-x-hidden bg-base-100 text-base-content">
    <StartScreen
      v-if="status === 'start' && apiKey"
      :return-from-quiz="returnFromQuiz"
      :from-group-replay="hostReplayMode"
      @start-quiz="startQuiz"
      @join-group="joinGroup"
      @cancel-edit="cancelEditSetup"
      @resume-host="status = 'group'"
    />

    <GroupHost
      v-else-if="status === 'group' && groupStore.role === 'host'"
      @leave="leaveGroup"
      @play-again="playAgain"
      @edit-setup="editGroupSetup"
    />
    <GroupPlayer
      v-else-if="status === 'group' && groupStore.role === 'player'"
      @leave="leaveGroup"
      @room-conflict="onGroupPlayerConflict"
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
        <div v-else class="alert alert-warning mt-4">
          No DeepSeek API key! Set VITE_DEEPSEEK_API_KEY in .env.
        </div>
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

    <!-- cross-tab single-room guard: another live tab is already in a room -->
    <dialog ref="takeoverDialogRef" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold">You already have an active room</h3>
        <p class="py-3 text-sm opacity-80">
          This browser is in
          <strong class="font-bold">Room {{ blockingSession?.code || 'PENDING' }}</strong>
          <span v-if="blockingSession?.role">
            as
            <span class="badge badge-sm badge-secondary align-middle">{{
              blockingSession.role
            }}</span>
          </span>
          in another tab. Only one room session per browser is allowed so questions, timers, and
          scores stay in sync.
        </p>
        <p class="py-1 text-sm opacity-70">
          Leave the other room to continue here. The other tab will be closed out and you'll take
          its place.
        </p>
        <div class="modal-action">
          <button class="btn btn-soft" @click="cancelTakeover">Stay in other room</button>
          <button class="btn btn-soft btn-primary" @click="confirmTakeover">
            Leave other &amp; continue
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>

    <!-- surfaced when another tab forcefully took over this tab's session -->
    <dialog ref="evictedDialogRef" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Switched rooms</h3>
        <p class="py-3 text-sm opacity-80">
          {{ groupStore.evictedMessage || 'Another tab took over this session.' }}
        </p>
        <div class="modal-action">
          <button class="btn btn-soft btn-primary" @click="dismissEvicted">Back to home</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
