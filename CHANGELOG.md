# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
