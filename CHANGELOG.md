# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A Mind Gym dashboard at `/` that lists the games as cards, replacing the quiz
  start screen. Games are declared once in `src/games/registry.ts`, so adding one
  is a folder plus a manifest entry.
- Client-side routing with lazy game chunks. The dashboard's first paint dropped
  from ~105 kB to ~56 kB gzip, with the quiz (and its AI client) loading only when
  its route is opened.
- `/join/ABC123` as a shareable room link, alongside the older `?room=ABC123`
  form which now redirects to the quiz.
- A second game: the Tower of Hanoi, reached at `/hanoi` and playable solo.
- A confetti burst now rewards finishing a solo quiz. It is scaled up for a
  perfect score and withheld below half marks, so a poor result is not
  celebrated.
- Tower of Hanoi as a second game alongside the quiz: 3-8 disks, optimal-move
  hints, restart, and a live move counter.
- A solve stopwatch that measures time without ever ending the game, plus
  personal bests per disk count (fewest moves, fastest time breaks a tie) kept in
  `localStorage` and shown on both the size picker and the results screen.
- A "What do you want to play?" step in the start flow that offers the AI quiz or
  the puzzle.
- Canonical Hanoi rules in `shared/hanoiRules.mjs` — plain ESM so the browser
  bundles it and the room server can import the same file for the future group
  race.
- Client test suite (`npm run test`, vitest) covering the rules, the hint solver,
  personal-best tie-breaks, and clock formatting.

### Changed

- The app is branded **Mind Gym** as the umbrella for its games; the quiz keeps
  the Quiznix AI name on its own card and screen. `localStorage` keys are
  unchanged (`quiznix-*`), so themes, setups and records carry over.
- `App.vue` is now a thin shell (header + router view + the cross-tab room guard).
  The quiz's flow, and the Tower of Hanoi's, each own their phases in
  `src/games/<game>/`, so the shell no longer grows with every game.
- Group rooms use the single shell header: the host/player role shows as a badge
  beside the brand, and "Exit quiz" now appears in the shared settings menu
  instead of a second per-screen header.
- The Tower of Hanoi clock now starts on the player's first pickup or move
  instead of the moment the board appears, so time spent reading the screen or
  finding the controls is not counted against their solve.
- The Tower of Hanoi celebration no longer waits for a personal best — every
  solved puzzle is rewarded, with a bigger burst for a minimum-move run or a new
  record.
- Hints are now limited to one per disk (3 disks give 3 hints, 8 give 8). The
  button shows the remaining allowance, disables at zero, and `H` respects it.
- A hint is delivered as a notification beside the board instead of a line of
  grey text, and it is announced to screen readers. The two pegs involved are
  ringed at the same time, and the notification carries a depletion gauge showing
  how much of the allowance is left.
- The keyboard controls are listed in a persistent panel below the board, with
  the keys rendered as keycaps, replacing the one-time drag banner.
- The Hint button carries a warning accent and Restart is now a quiet ghost
  action, so the two are no longer identical grey rectangles.
- Tower of Hanoi disks now read as one material with the pegs — lit top, shaded
  bottom, contact shadow — and the three pegs stand on one continuous wooden
  base instead of separate plinths, so the board looks like a real one. The
  per-tower outlines are gone too: peg state is shown with rings, so the idle
  board reads as one unit rather than three cards.
- The disk in hand is lifted, scaled and given a primary glow, so it is obvious
  which disk was picked up; a rejected drop still shakes and turns the peg red.
- Disk and peg numbers were removed. Size ordering is carried by the width and
  the lightness ramp instead, and the keyboard cursor is now a caret above the
  chosen peg.
- Disk colour is an ordered two-hue theme ramp (lightest smallest, most solid
  largest). Measured contrast against the board is now monotonic in both light
  and dark themes, and every disk rim clears 3:1.
- The board scales with the viewport instead of staying a fixed 768px column:
  wider container, taller pegs and disks roughly 1.5x thicker.
- Peg states are unambiguous now: solid ring and fill for a legal drop, a dimmed
  peg for an illegal one, red for a rejected one, and a numbered badge for the
  keyboard cursor instead of a dashed outline.
- An invalid move raises a `role="alert"` message beside the board rather than a
  line of grey text under the controls.
- The dragged disk's position is written straight to the DOM instead of through
  a reactive style, so it no longer trails the pointer.
- Tower of Hanoi disks are now dragged onto a peg instead of clicked between
  pegs, with the disk following the pointer and easing back if the drop is
  illegal or away from the board. A motionless tap moves nothing and nudges you
  to drag.
- Tower of Hanoi keyboard play is a single board tab stop: arrow keys move a
  cursor between pegs, `Space`/`Enter` pick up and drop, `Esc` cancels, and the
  status line narrates the board for screen readers.
- The settings menu quit action is now game-aware ("Quit puzzle" during a solve).
- `npm run format` also formats `shared/`.

## [0.2.0] - 2026-10-07

### Added

- Screen wake lock during solo and group games, for players as well as the host.
- App version stamp on the landing page.
- Vitest coverage for AI question generation.

### Fixed

- Questions no longer repeat across runs, and stale quiz replays are cleared when
  a new quiz starts.
- Group reconnect now survives room-server cold starts instead of dropping
  players on the first failed attempt.
- Cross-origin room-server connections are accepted when the SPA origin is
  listed in `ALLOWED_ORIGINS`.
- Room server hardened against answer cheating, message floods and ghost seats.
- IDs are generated without `crypto.randomUUID`, which is unavailable outside
  secure contexts.
- Server test suite runs through a file glob instead of a hardcoded file list.

## [0.1.0] - 2026-09-10

Initial release.

### Added

- AI question generation from one or many topics (mixed and shuffled), backed by
  DeepSeek.
- Solo mode with difficulty presets, question count, optional per-question timer,
  back navigation and a results summary.
- Group mode: host a room, join by 6-character code or join link, synced
  questions, live lobby roster and leaderboard scoring by correctness and speed.
- Group chat with `localStorage`-only history.
- Reconnect/resume tokens so players and hosts can drop and rejoin gracefully.
- Lobby trivia, host and player lobby dashboards, and a unified button style.
- Settings menu with 35 daisyUI themes, in-app help guide and bug report email.
- Room server (`server/`) with join codes, game state machines and speed scoring,
  covered by a `node:test` suite.
