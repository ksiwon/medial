# Decision 04 — Quest/Task Change Set

Status: **decided**

This decision replaces parameter-patch-first improvement with one meaningful MEDial Change Set.
It refines Decision 03 without widening the two-case prototype.

## Canonical hierarchy

```text
Resident need
  -> Quest
       -> Tasks
            -> internal execution bindings
```

The resident need and outcome being sought are fixed case inputs. A Quest describes how MEDial
tries to reach that outcome. Tasks are the accountable units of contact, coordination, handoff,
and closure. Numeric or categorical engine parameters only bind those rules to the current
implementation; they are not a separate improvement vocabulary.

## Fixed Quest identity and outcome

Within a controlled v0/v1 comparison, the following cannot change:

- Quest identifier and type;
- subject resident;
- resident need and triggering event;
- core goal;
- outcome criterion used to judge whether the need was met.

The outcome criterion is deliberately separate from an editable operational close rule. Otherwise
MEDial could appear to improve by weakening what counts as success.

The initial prototype supports only:

1. `no_response_welfare_check` — establish the resident's safety status with attributable evidence;
2. `medical_transport` — arrange and confirm the resident's requested medical journey.

## Editable Quest plan

A Change Set may edit only:

- overall deadline;
- escalation trigger and destination;
- stop condition;
- fallback route;
- evidence required before MEDial may close the Quest;
- constraints inherited by Tasks;
- the Task graph.

## Minimal Task vocabulary

The Task type whitelist is intentionally closed:

1. `contact` — contact a resident, helper, village head, or institution;
2. `request_help` — request a welfare check, visit, accompaniment, or other bounded help;
3. `arrange_transport` — find, ask, reserve, and verify transport support;
4. `escalate_handoff` — transfer responsibility to an institution without claiming resolution;
5. `notify_close` — report the outcome and close only when required evidence exists.

Target actor, requested action, and channel are Task fields. They do not create new Task types.

## Minimal editable Task fields

- start condition and dependencies;
- eligible assignees and assignment order;
- request and explanation;
- disclosed information;
- acceptance and refusal handling;
- retry, timeout, and quiet period;
- reassignment and fallback;
- travel, workload, and resource constraints;
- completion evidence.

Runtime Task instances, offers, acceptance/refusal, movement, messages, completion, and failure are
immutable records. Editing creates a new MEDial revision.

## Change Set contract

One Change Set represents one coherent mechanism and contains:

- evidence: resident-evaluation item references, experienced-event references, and interview
  evidence references;
- target: one of the five decided MEDial improvement targets;
- affected Quest and Task identifiers;
- a human-readable before rule and after rule;
- exact structured Quest/Task changes;
- collapsed internal execution bindings;
- expected effects, possible regressions, unknowns, affected actors, and observations for the next
  run;
- authorship: AI draft or researcher-authored hypothesis;
- researcher confirmation and reason before execution.

A Change Set may contain several bound values when they implement one semantic rule. The same rule
must not be independently edited in a Quest editor, Task editor, and parameter editor.

## Validation and authority

Mechanical validation checks only that the Change Set:

- cites existing evaluation evidence, or is explicitly marked `researcher_hypothesis`;
- does not edit fixed case input, evaluation output, or immutable runtime history;
- uses supported Quest/Task types and fields;
- has current before-values and coherent dependencies;
- can be executed by the engine;
- does not repeat an already executed Change Set.

Validation does not decide that the change is desirable. An AI draft never executes directly. The
researcher may accept it, edit it, author a new Change Set, or decline to run any candidate. Only a
researcher-confirmed revision executes, and no candidate is automatically declared the winner.

## Progressive disclosure

The improvement UI starts from one resident-evaluation issue and shows:

1. the affected Quest segment;
2. only the relevant Tasks;
3. the meaningful before/after rule;
4. expected benefit, possible burden, and what to observe next.

Internal bindings are collapsed under technical details. A separate read-only MEDial overview is
available for audit. The default screen never opens with the complete Quest, every Task, and every
parameter visible together.

## Implementation sequence

1. Replace `PatchOp` proposals with the Quest/Task Change Set contract in the active iteration path.
2. Translate confirmed Change Sets to the current engine bindings at one validation boundary.
3. Replace parameter-oriented proposal UI with issue -> affected Quest/Task -> before/after.
4. Add researcher edit/author/confirm commands; no draft executes before confirmation.
5. Move the full current MEDial plan to a read-only audit view and remove the independent parameter
   editing path from the default experience.

Steps 1-4 are implemented in the active iteration path. Step 5 is implemented as progressive
disclosure in the default comparison screen: the relevant Quest/Task rule is primary and engine
bindings are collapsed. The broader MEDial plan remains intentionally bounded to the two supported
cases; this is not a general-purpose Quest authoring system.
