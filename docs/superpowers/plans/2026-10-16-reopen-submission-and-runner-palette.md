# Deferred resubmission and reference runner palette implementation plan

> Execute the approved in-chat design; use test-driven implementation and a fresh final review. User explicitly requests implementation and publication of both applications.

Goal: Apply participant-controlled deferred submission reopening and the sampled 24-color palette to Alkane Lite and Ionic Lite.

Repositories: AlkanePuzzleCompetition/cloudflare-lite and IonicFormulaCompetitionCloudFlare/lite. Continue existing clean task branches. Each repository has independent deployment and storage.

## Approved requirements
- Class competition deferred grading only: submitted participant can request reopening on the waiting screen, with permanent caution below the request button. Clicking it reveals cancel and confirmation buttons; only confirmation executes. No teacher approval.
- Only RUNNING before deadline and before results finalization. All submitted still finalizes immediately; collecting, timeout, interruption, finished prohibit reopening. Repeated reopening allowed while eligible.
- Preserve all saved answers, restore editability including previously correct answers, reset submitted/score state, keep sequence monotonic and replay idempotent. Host sees answering again. Final rank remains score first, then elapsed time from latest accepted submission (server time, existing centisecond rounding). If reopened but never resubmitted, grade saved answers at cutoff.
- Do not expose deferred scores/correctness to participants or host progress before FINISHED (including review/question paths). Preserve immediate/mate behavior. Lost acknowledgements, reconnect/reload, offline replay, deadline races must converge to server truth.
- Sampled palette, clockwise from top: #ef0000 #f56b00 #fca000 #ffcd00 #fff500 #d8de00 #9ec700 #4dae0f #009824 #009b71 #009e9f #01a1c5 #00a3e8 #008dcf #0073b6 #01519a #000c7a #6c087c #a1017f #cb0080 #f00183 #ee0070 #ef005b #ef003b.
- Assign colors in a spaced permutation, repeat after 24 joins, keep identity stable across ranking changes/reloads and retain room-derived start/direction. Host race background near white, faint neutral grid, thin darker outline for bright yellow/green when necessary. Names/ranks remain dark. No costly SVG filters or changed runner motion.

## Task 1: Alkane deferred reopening
Files: cloudflare-lite/worker/room.ts, src/protocol.ts, src/socket.ts, src/App.tsx, src/Player.tsx, focused tests and local browser fixture flow. Add sequenced `reopen` operation, durable receipt/replay handling, score privacy, accessible waiting/confirmation component, update final-submit caution.
- [x] Write failing server tests: reopen/edit correct to incorrect or empty, latest submission rank/time, duplicate receipt and resume, rejected roles/modes/states/deadline, timeout from reopened state, score privacy.
- [x] Write failing transport/UI tests for pending reopen replay while submitted, finalized stale pending clearing, and confirmation copy.
- [x] Implement and run focused tests, full root/Lite suites, typecheck/build.

## Task 2: Ionic deferred reopening
Same contract as Task 1 in sibling repository lite/. Preserve Ionic two-field/string/structured FormulaEntry behavior. Test correct field clearing and regrading both fields. No deployment by implementer; coordinator reviews and deploys both.
- [x] Failing tests, implementation, focused tests and full Lite suite/typecheck/build.

## Task 3: Shared palette and background
Files in each repository: src/features/lobby/host-race-colors.ts, HostRace.tsx if needed, app/globals.css, color tests.
- [x] Replace old dark 42-hue/unique-shade expectations with exact reference palette, stable identity, spaced neighbors and repeat-after-24 tests. Check contrast using actual visible outlines for bright colors.
- [x] Implement minimal palette/background/outline changes and run focused tests.

## Task 4: Integration and authorized release
- [x] Review combined diffs, run focused/full checks and Playwright real local flows (two submitted participants with one reopening while another stays active; cancel, confirm, reload, re-submit, host state/time, final results; both games).
- [x] Verify widths 320/390/768/1280 and runner normal/rest/dash/goal visibility; page/console/network errors.
- [ ] Fresh independent review, address findings, commit/push existing task branches.
- [ ] Deploy only via `pnpm --dir cloudflare-lite deploy` and `pnpm --dir lite deploy` respectively. Verify public health/HTML release IDs and public browser flows without altering real classroom data; describe fixture/public boundaries.

Verification: root suites Alkane 430 passed/5 skipped, Ionic 570 passed/3 skipped. Lite focused Alkane24 green and UI confirmation parity; Ionic54 green. Real browser local WS flows for both passed: cancel/Escape, saved answer and reload retention, edit/resubmit, later server timestamp and second-place rank, four widths no overflow, zero page errors/network failures. Independent final review: no findings. No schema changes.

Final local verification: Lite full suites Alkane 155/155, Ionic 54/54. Real browser two-participant flow passed for each; additional 50-person browser fixtures verified all 24 reference colors, repeat after 24, neutral background, all four widths, reopening and resubmission UI, zero page/network errors. Final independent review no actionable findings.
