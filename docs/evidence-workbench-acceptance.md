# Evidence workbench UI acceptance

Branch: `feat/stitch-evidence-workbench`
Base: `4a4e72b` (cinematic workbench UI)

## Scope

- Existing video landing page retained.
- Report: grouped check list, problem filter, selected evidence and suggested next step.
- Configuration: commands/model hand-off, protocol and metric-output sections; existing review gates retained.
- Execution: stage cards, scrollable console with optional output following, recorded resource limits and source identity. No invented live telemetry.
- Comparison: baseline/current table, explicit missing values, expandable structured values; differences remain separate from acceptance.
- No backend, API, experiment schema or execution-policy changes.

## Checks performed

- Full `npm test` suite, including grouping and zero/false/missing comparison value checks.
- Production client and worker build; `git diff --check`.
- Final review keeps execution status announcements separate from noisy log updates.
- Browser: actual karpathy/micrograd scan, pinned report, selected evidence, problem filter.
- Browser: Training form edits survive navigation; unconfirmed Apply remains disabled.
- Browser: existing successful Iris record renders log, recorded limits and acceptance independently.
- Browser: existing KTS-o7/AIML-Lab replay renders comparison values and older-record fallback.
- Responsive: 390px report/configuration/comparison, no document horizontal overflow. Comparison table scrolls within its region.
- Browser console: no error entries during acceptance.

## Screenshots

- [Report](ui-preview/evidence-report.png)
- [Configuration](ui-preview/evidence-config.png)
- [Recorded execution](ui-preview/evidence-run.png)
- [Comparison](ui-preview/evidence-comparison.png)

## Limits

No new Docker execution or live streaming/cancel/retry cycle was launched for this presentation-only change. The shared console was checked with real archived output. Existing execution tests passed; a fresh live-run UI check remains advisable before release. Delivery is on the feature branch only; main is not merged.
