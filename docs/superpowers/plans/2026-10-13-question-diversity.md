# Alkane competition question diversity implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the mixed mode to ランダム and enforce competition-wide question diversity in every mode.

**Architecture:** Keep persisted mode `both`. Generate bounded, profile-valid candidate pools for each requested mode, then select and order the entire competition using a bounded search. Never relax molecule uniqueness or adjacent substituent-combination restrictions. Store the final set once using the existing room start transaction.

**Tech Stack:** Existing TypeScript, deterministic chemistry engine, React, Vitest, Cloudflare Durable Objects, Playwright.

**Spec:** Approved design in this chat, including application to arrange, name, and random modes.

## Global constraints

- One molecule, identified by the engine's standard name, appears at most once per competition.
- Adjacent questions must have different substituent/OH type sets; counts and locants do not make a new type set. The empty set is one type set.
- Prefer least-used parent-chain/ring carbon counts and avoid consecutive reuse; total carbon count, combination frequency, and partial type overlap are secondary diversity preferences.
- Keep profile eligibility, alcohol ON/OFF, bounds/bends, and mixed-mode counts differing by at most one.
- Do not change existing prepared questions, answer formats, database schemas, or teacher settings.
- Preserve bounded generation and report controlled preparation failures before starting the countdown.

## Review focus

- OH-only or otherwise single-combination settings must fail clearly, without duplicates or silent rule relaxation.
- Layout variants of one molecule must share a uniqueness key across modes.
- A mode with fewer eligible candidates must not be starved by the other mode.
- Carbon diversity must not override mode-specific chemistry or geometry constraints.
- Failed preparation must leave the room waiting and allow settings changes/retry.

## Task 1: Candidate selection and preparation

Files: new `cloudflare-lite/game/question-diversity.ts`; update `game/generator.ts`; new `tests/question-diversity.test.ts`.

- [x] Write failing tests for uniqueness/adjacency in all 3 modes, explicit OH combinations, mode quotas, restricted carbon ranges, and insufficient candidates.
- [x] Run tests and confirm failures against current generation.
- [x] Add a bounded whole-set selector; score parent-carbon usage, adjacency, partial overlap, combination usage and total-carbon usage, with randomized ties and backtracking.
- [x] Generate profile-valid candidates using the existing chemistry engine, deduplicate per mode, build existing payloads after selection, and recheck final invariants.
- [x] Verify fixed seeds and a multi-seed sweep for all difficulty/OH/mode/question-count combinations, including the current live profile.

## Task 2: Display and controlled failure

Files: `src/Settings.tsx`, `worker/room.ts`, relevant unit/browser tests.

- [x] Write a failing rendered-label test for ランダム with persisted mode `both`.
- [x] Write a failing Worker test for preparation failure leaving room WAITING with a useful error and successful retry after settings change.
- [x] Rename labels/summaries and browser selectors. Map only the controlled preparation error to a room error; preserve unrelated error handling.
- [x] Verify both grading modes and the common start path used by class and mate rooms.

## Task 3: Review and release

- [x] Run Lite full tests, typecheck/build, focused browser flows and `git diff --check`; request a read-only independent review.
- [x] Commit/push to the existing branch and deploy only via `pnpm --dir cloudflare-lite deploy`.
- [x] Verify GitHub commit, public health/release/asset hashes, new labels, server-prepared sets in all modes, both grading flows, and responsive layouts.
- [x] Record public verification and distinguish browser evidence from physical-device evidence.
