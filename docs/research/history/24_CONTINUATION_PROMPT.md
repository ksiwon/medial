# MEDial continuation prompt — 2026-09-14

Copy the prompt below into a new coding LLM session.

---

You are continuing work on the repository:

`C:\Users\pjo12\Downloads\coding\medial`

Do not restart the product analysis from scratch. First read, in this order:

1. `AGENTS.md`
2. `docs/research/19_RESIDENT_AGENTS_AS_EVALUATORS.md`
3. `docs/research/20_STRUCTURED_RESIDENT_EVALUATION.md`
4. `docs/research/21_HUMAN_SELECTION_AUTHORITY.md`
5. `docs/research/22_MEDIAL_IMPROVEMENT_TARGETS.md`
6. `docs/research/23_QUEST_TASK_CHANGE_SET.md`
7. `docs/research/DECISIONS.md` entries D069–D074
8. `DEVELOPMENT.md`, especially “2026-09-14 · Quest/Task Change Set 전환 상태”

## Canonical research context

- Exact research title: **Resident Agents as Evaluators**
- Research artifact/tool: **Simulated Rural Village**
- Evaluated system name: **MEDial**
- MEDial category: an AI Care Orchestrator
- Case framing/subtitle: **Improving MEDial with a Simulated Rural Village**
- The research contribution is not “building MEDial”, a general social simulator, automatic policy optimization, or 3D village visualization.
- The central question is whether interview-grounded resident agents can evaluate a service they experienced, how those evaluations can inform a bounded MEDial revision, and where simulated evaluation agrees or conflicts with later human resident review.
- Do not call this a longitudinal study without a real longitudinal human study. The implemented comparison is a controlled single-day iteration.
- Never describe simulated residents as real participants, human opinions, satisfaction, consent, or replacements for fieldwork.

Canonical flow:

`interview evidence → simulated service experience → resident-agent evaluation → Quest/Task Change Set → researcher confirmation → one MEDial revision → rerun → evaluation difference → later human review`

## Decisions that are already settled

1. Resident evaluation is scoreless and evidence-based. Preserve `positive/mixed/negative/unknown`; do not aggregate these into a score, rank, winner, or automatic adoption rule.
2. There is no automatic winner selection. Descriptive metrics can show differences and mechanical constraints can reject invalid execution, but desirability belongs to the researcher.
3. AI/rule-generated Change Sets are drafts only. A draft must never execute before explicit researcher confirmation with a recorded reason.
4. The five MEDial improvement targets are:
   - Quest completion and escalation
   - Task composition and flow
   - Task assignment, refusal, and reassignment
   - Timing and burden
   - Explanation and disclosure
5. Canonical hierarchy:
   `resident need → Quest → Tasks → collapsed internal execution bindings`
6. Change Set is the only active improvement unit. It contains evidence refs, affected Quest/Task ids, human-readable before/after rules, structured changes, expected effects, possible regressions, unknowns, affected actors, next observations, authorship, validation, confirmation, and result refs.
7. Parameters are implementation bindings, not a separate design vocabulary or default UI editor.
8. Researcher editing is append-only:
   - editing a draft creates a new `researcher_hypothesis` Change Set;
   - the original becomes `superseded`;
   - original evidence and history remain;
   - saving is not execution authority;
   - confirmation is a separate command.
9. Supported scope stays deliberately small:
   - Quest: no-response welfare check, medical transport
   - closed Task vocabulary: contact, request help, arrange transport, escalation/handoff, notify/close
   - no 119, multi-day memory, universal policy language, autonomous daily-life simulation, or decorative 3D expansion unless the research question is explicitly changed.
10. UI progressive disclosure:
   - begin from a resident-evaluation issue;
   - show only affected Quest/Task and meaningful before/after rule;
   - show expected benefit, possible burden, and what to observe next;
   - keep internal engine bindings collapsed under technical details;
   - never open with every Quest, Task, and parameter at once.

## What was implemented

The old improvement path was replaced rather than extended.

Removed from the active iteration path:

- `PatchOp`, `ChangeProposal`, patch-path allowlists
- `selection.py` and metric/Pareto winner selection
- candidate execution branches
- `needs_decision`, `evaluating_candidates`, `selecting_next`
- `selectedBy`, `selectionReason`, automatic winner semantics
- old proposal persistence/API/UI fields

Current state machine:

`created → running_cycle → collecting_reviews → synthesizing → proposing_changes → validating_changes → awaiting_confirmation`

After researcher confirmation:

`executing_revision → running_cycle ...`

Only one confirmed Change Set creates one child revision. Unconfirmed drafts remain records and are never generations.

Key backend files:

- `server/app/simulation/iteration/contracts.py` — Change Set, RuleChange, execution binding, confirmation and status contracts
- `server/app/simulation/iteration/validation.py` — semantic validation and the single Change Set → engine-binding translation boundary
- `server/app/simulation/iteration/improvement.py` — rule-generated Quest/Task Change Set drafts
- `server/app/simulation/iteration/llm_adapters.py` — structured LLM Change Set output
- `server/app/simulation/iteration/engine.py` — stop-before-confirmation and execute-one-confirmed-revision state machine
- `server/app/simulation/iteration/service.py` — `confirm_change_set`, `save_researcher_change_set`, append-only researcher authorship
- `server/app/simulation/persistence/iteration_store.py` — `change_sets` persistence and executed-vs-drafted hash distinction
- `server/app/simulation/iteration/evaluation_metrics.py` — descriptive measures only, no selection

Key frontend files:

- `src/features/simulation/api/iteration.ts`
- `src/features/simulation/iterationStore.ts`
- `src/features/simulation/screens/CompareScreen.tsx`
- `src/features/simulation/screens/PrepareScreen.tsx`
- `src/features/simulation/components/ProgressBar.tsx`
- `src/features/simulation/components/GenerationPanel.tsx`

The comparison screen now shows relevant Quest/Task rules, before/after, benefits, burdens, affected actors, and next observations. It offers “이 초안 직접 수정” and “새 연구자 가설로 작성”. Internal execution values are collapsed. Confirmation requires a reason.

The API may encounter old v0.3 session rows in the local SQLite DB. Do not restore compatibility fields and do not delete user records. The service filters legacy rows out of the active session list and direct access returns a clear 409. This prevents startup 500s while keeping the old data untouched.

## Verification already completed

- `python -m pytest server/tests -q` → **148 passed**, one dependency deprecation warning
- `npm test -- --run` → **42 passed**
- `npm run build` → passed
- `git diff --check` → passed
- Actual Chromium/Playwright verification:
  - app opened without console errors after legacy-session filtering;
  - a new experiment stopped at `awaiting_confirmation`;
  - two draft Change Sets were visible with Quest/Task before/after rules;
  - no draft had executed;
  - “이 초안 직접 수정” saved a new researcher Change Set and preserved the original;
  - saving did not create a revision;
  - entering a reason and confirming created exactly one second revision;
  - console errors: zero.
- `run.sh` end-to-end verification on Windows `bash.exe`:
  - automatically bridged to the dependency-ready Windows Python;
  - API health and web UI both returned HTTP 200;
  - a second invocation reused the same API/UI PIDs;
  - `./run.sh --stop` removed both listeners;
  - CRLF `server/.env` loaded without modifying the file.

## Working-tree instructions

The worktree is intentionally dirty with this implementation and research documentation. Do not reset, checkout, discard, or overwrite unrelated changes. Do not reintroduce compatibility layers for removed patch/candidate fields. Do not commit unless the user asks.

Before any next change:

1. inspect `git status --short` and the relevant diff;
2. preserve evidence/visibility/source boundaries;
3. remove obsolete code when replacing behavior; do not stack another route over the same responsibility;
4. update `DEVELOPMENT.md` with implemented/partial/unimplemented truth;
5. run the proportional server/frontend tests and inspect the actual browser for UI changes.

## Known intentional limits / sensible next work

- Quest/Task is a bounded semantic layer over two implemented cases, not a general authoring language.
- Researcher “new hypothesis” uses an existing valid structured Change Set as the executable template, while allowing the researcher to rewrite the semantic rule and binding values. This preserves the closed executable scope.
- No real human longitudinal validation has been performed.
- 119, multi-day memory, broader institution roles, and general-purpose service procedures remain out of scope.
- If further simplification is requested, prioritize the resident-evaluation → relevant Change Set → confirmation path, not more simulation controls.
- If improving research validity next, focus on the human revisit protocol and comparison between simulated resident evaluations and actual resident corrections; do not add automatic scoring.

Continue from this state and explain any proposed scope change before implementing it.
