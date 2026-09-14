# Decision 03 — MEDial Improvement Targets

Status: **decided**

## Canonical names

- **Research title:** Resident Agents as Evaluators
- **Evaluated system:** MEDial
- **System category:** AI Care Orchestrator
- **Evaluation environment:** Simulated Rural Village

`AI Care Orchestrator` is a category, not the product name. In product and research text, use `MEDial` when referring to the concrete orchestrator. The research itself must be called `Resident Agents as Evaluators`.

## Improvement boundary

Resident-agent evaluations may lead to changes in five areas of MEDial:

1. **Quest completion and escalation**
2. **Task composition and flow**
3. **Task assignment and refusal**
4. **Timing and burden control**
5. **Explanation and information disclosure**

Existing numeric and categorical policy parameters are not a separate sixth area. They are engine-level bindings used to execute a meaningful Quest or Task rule.

## Layer model

### Fixed case input

The resident need, triggering event, subject, scenario facts, consent boundary, personas, relationships, world, resources, and evaluation rubric stay fixed within an iteration comparison.

### Editable Quest plan

MEDial may change:

- completion and stop conditions;
- overall deadline;
- escalation trigger and destination;
- failure and fallback path;
- required completion evidence;
- constraints inherited by its Tasks.

The underlying resident need and the Quest's core goal do not change within the comparison.

### Editable Task plan

MEDial may change:

- which Tasks exist;
- order and dependencies;
- start, success, timeout, and failure conditions;
- eligible assignees and assignment order;
- acceptance, refusal, and reassignment rules;
- requested action, explanation, and disclosed information;
- retry, contact, travel, workload, and resource constraints;
- evidence required to mark the Task complete.

### Internal parameter bindings

Fields such as `retryCount`, `retryIntervalMin`, `quietWindowMin`, `helperContactCap`, `disclosure`, `escalateToInstitutionAfterMin`, `allowHeadContact`, `rideCandidateOrder`, and `maxRideDetourMin` implement Quest and Task rules. They should not be presented as an independent design vocabulary.

### Immutable runtime record

Instantiated Quests, assigned Tasks, acceptance/refusal, movement, messages, completion, failure, resident evaluations, and event logs are immutable evidence. A new revision is created instead of editing history.

## Evaluation-to-target routing

| Resident evaluation dimension | Primary MEDial improvement targets |
|---|---|
| Help and resolution | Quest completion/escalation; Task composition/flow |
| Time and labour | Assignment/refusal; timing/burden |
| Choice and refusal | Assignment/refusal; explanation |
| Disclosure | Explanation/information disclosure |
| Understandability | Task request and status explanation |
| Reuse condition | Quest conditions; Task fallback and constraints |

This routing controls what the improvement interface reveals. It does not determine the correct change.

## Improvement proposal contract

One proposal represents one coherent mechanism, even when it touches a Quest rule, one or more Tasks, and their internal parameter bindings together. It must include:

- resident evaluation references;
- event and interview-evidence references;
- affected Quest and Task identifiers;
- before and after rules in human-readable form;
- exact structured changes;
- expected effects;
- possible regressions and unknowns;
- affected residents and institutions;
- what to observe in the next run.

The proposal is rejected mechanically if it edits fixed case inputs, immutable runtime records, evaluation content, or unsupported MEDial behavior.

## Researcher authority

The researcher may:

1. accept a drafted proposal;
2. edit its Quest, Task, and bound parameter changes;
3. author a proposal directly.

A directly authored proposal must cite resident-evaluation evidence or be explicitly labelled as a researcher hypothesis. Only the researcher-confirmed revision is executed.

## Progressive disclosure

The interface must not show all Quest, Task, and parameter fields at once.

1. Start from one resident-evaluation issue.
2. Show the affected Quest segment and only the relevant Tasks.
3. Show the meaningful before/after rule.
4. Keep bound parameters collapsed under technical details.
5. Provide a read-only full MEDial overview separately for audit.

There is one source of truth: the structured Quest/Task revision. A semantic rule must not be independently editable in Quest, Task, and parameter screens.

## Deferred scope

- automatic prioritisation across simultaneous Quests;
- global resource optimisation across Quests;
- free-form resident negotiation that rewrites Tasks;
- long-running autonomous replanning;
- unrestricted tool or Task-type generation;
- generic medical-policy authoring.
