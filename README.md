# Quizly AI

AI-powered quiz generator. Type any topic — or several — and get a quiz generated
on demand, then play it solo at your own pace or live against friends in a
realtime group room.

Built with Vue 3, Vite, Tailwind CSS 4, daisyUI 5, and TypeScript.

## Features

- **AI question generation** — quizzes are generated per request from one or
  multiple topics (mix and shuffled), using Gemini or DeepSeek as the LLM backend.
- **Solo mode** — pick difficulty and question count, play timed or untimed,
  go back to review earlier questions, and finish with a results summary.
- **Group mode** — host a room and friends join from their own devices with a
  6-character code (or a join link). Everyone answers the same question at the
  same time; a live leaderboard ranks answers by correctness *and* speed.
- **Settings menu** — 35 daisyUI themes with instant switching, an in-app help
  guide, and a bug report that drafts an email to the developer.
- **Theme-adaptive UI** — everything derives from daisyUI theme tokens
  (base-100, primary, …), so the interface stays consistent across light, dark,
  and all other themes.

## Tech stack

| Layer        | Tech                                                               |
| ------------ | ------------------------------------------------------------------ |
| Frontend     | Vue 3 (`<script setup>`), Pinia, Vite, Tailwind CSS 4, daisyUI 5   |
| Language     | TypeScript (strict)                                                 |
| AI providers | Google GenAI (Gemini) or DeepSeek chat completions (via `openai`)  |
| Realtime     | Node room server using the `ws` package (no framework)             |
| Testing      | Node's built-in `node:test` for the room server logic              |

## Architecture

```
Browser (Vue 3 SPA)
├── Solo quiz ────► AI provider (Gemini/DeepSeek) ────► questions ──► quiz UI
└── Group mode ───► WebSocket room server (ws://<host>:8787)
                      ├─ host creates room, players join by code
                      └─ server owns game state: timers, live answers, scoring
```

The frontend is a single-page app that asks the AI for questions and then
renders the quiz; it never stores question history. Group mode adds a small
in-memory room server (`server/`) that brokers realtime game state between the
host and players over WebSocket.

```
src/
  App.vue                    # top-level flow orchestrator (start → quiz → results)
  components/                # StartScreen, QuizScreen, ResultScreen, GroupHost,
                             # GroupPlayer, SettingsMenu, LoadingScreen
  stores/groupStore.ts       # Pinia store: room lifecycle + WebSocket client
  composables/useCountdown.ts# shared countdown (solo timer, group question timer)
  quizConfig.ts              # difficulty presets (mode, timer, question count)
  prompts.ts                 # LLM prompt building (multi-topic, shuffled)
  scoring.ts                 # solo scoring (correct count)
  groupProtocol.ts           # shared WS message types (client ↔ server)
  jsonParse.ts               # tolerant JSON extraction from LLM responses
server/
  index.mjs                  # HTTP + WebSocket entry point
  roomManager.mjs            # room state machines, join codes, speed scoring
  roomManager.test.mjs       # node:test suite for room logic
scripts/
  free-port.mjs              # kills a stale process on a port (predev:all)
```

## Getting started

Requirements: Node.js 20.19+ (or 22.12+).

```sh
npm install

# configure keys (at least one AI provider)
cp .env.example .env
# edit .env: VITE_GEMINI_API_KEY and/or VITE_DEEPSEEK_API_KEY, VITE_AI_PROVIDER

npm run dev
```

`npm run dev` starts the Vite dev server and automatically launches the room
server on port 8787 if it isn't already running, so both solo and group modes
work out of the box.

## Configuration

`VITE_*` variables live in `.env` (committed example: `.env.example`).

| Variable              | Purpose                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `VITE_GEMINI_API_KEY` | Gemini API key (used when `VITE_AI_PROVIDER="gemini"`).          |
| `VITE_DEEPSEEK_API_KEY` | DeepSeek API key (used when `VITE_AI_PROVIDER="deepseek"`).    |
| `VITE_AI_PROVIDER`    | `"gemini"` (default) or `"deepseek"`.                            |
| `VITE_WS_URL`         | Room server WebSocket URL; defaults to `ws://<page-host>:8787`.  |
| `VITE_REPORT_EMAIL`   | Recipient of the in-app bug report email; unaddressed when empty.|

## How the modes work

### Solo

1. Enter one or more topics on the landing screen, pick a difficulty and the
   number of questions, then hit **Start learning**.
2. The app asks the configured AI for questions; the topics are split evenly
   across the set and the final order is shuffled client-side.
3. Answer each question. With the timer on, each question counts down (and
   pauses when you go Back); without it, play at your own pace. The correct
   answer is revealed immediately after you pick.
4. On the last question, confirm submission, then review your results
   (correct count and percentage).

### Group

1. **Host:** start a quiz, pick **Group**, set how many players can join
   (2–100) and the time per question (5–300s). A 6-character room code is
   generated; share it or the "Copy join link" button.
2. **Players:** open the app on their own device (the host's LAN address or the
   join link, e.g. `?room=ABC123`), enter a name and the code, and join the
   lobby. The host starts the game when everyone's in.
3. Everyone sees the same question and answers within the time limit; the host
   screen shows who has answered live.
4. Scoring is speed-based: each correct answer earns 5.0–10.0 points depending
   on how fast it was submitted (the fastest answer gets the maximum). Wrong or
   missed answers earn nothing. The final leaderboard ranks players by total
   points, then by total time spent.

### Room server & networking

- The room server listens on **8787** by default (override with `PORT`).
- `npm run dev:all` runs Vite and the room server together and first frees port
  8787 from any stale process (via `scripts/free-port.mjs`).
- The lobby's join link replaces `localhost` with the host's LAN address
  automatically. If other devices can't connect, allow Node through the
  firewall (Windows: allow `node.exe` on Private networks).
- All room state lives in memory on the server; closing it ends all games.

## Scripts

| Script            | Description                                        |
| ----------------- | -------------------------------------------------- |
| `npm run dev`     | Vite dev server (room server starts automatically) |
| `npm run server`  | Room server only                                   |
| `npm run dev:all` | Vite + room server (frees port 8787 first)         |
| `npm run build`   | Type-check, then production build                  |
| `npm run preview` | Preview the production build                       |
| `npm run test:server` | Room server test suite (`node --test`)         |
| `npm run lint`    | oxlint + eslint with autofix                       |
| `npm run format`  | Prettier over `src/` and `server/`                 |

## Testing

Room server logic (room creation, joining, answer validation, scoring,
leaderboards) is covered by the `node:test` suite in
`server/roomManager.test.mjs`:

```sh
npm run test:server
```