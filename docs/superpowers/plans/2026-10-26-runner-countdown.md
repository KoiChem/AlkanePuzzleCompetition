# Countdown runner implementation plan

Goal: Both Lite host screens reuse the submitted resting pose before start, then resume running at startAtMs.
Architecture: Add optional waiting boolean to HostRace, passed from the existing countingDown calculation in Lite and shared RoomScreen. Keep submission, scoring, finish and light-mode semantics.

- [ ] Add rendering regression tests for immediate/deferred waiting, active, submitted and expired runners.
- [ ] Add waiting prop and reuse rest pose; permit sleep animation during countdown without permitting dash.
- [ ] Run root and Lite suites, typechecks/builds, and local browser countdown/reload/light checks.
- [ ] Review diff, commit both repositories, deploy both designated Lite Workers, verify served release and browser behavior.

No data/schema changes. Normal countdown sleep retains 4.5s sway; light mode stops decoration. Expired unsubmitted runners remain stopped and upright.
