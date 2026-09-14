# Decision 02 — Researcher Execution Authority

Status: **decided**

## Decision

Resident-agent evaluations provide evidence for improving MEDial; they do not select a winning design or authorize execution automatically.

- The system may reject a Change Set mechanically when it cannot run or violates the data contract.
- Draft Change Sets are not executed for comparison. The session stops at `awaiting_confirmation`.
- The researcher may edit a draft, author a bounded hypothesis, confirm one Change Set with a reason, or run none.
- Only the confirmed Change Set creates a new MEDial revision. Its result, resident evaluations, objective measures, trade-offs, and dissent are preserved.
- Counts of positive or negative resident-evaluation items must not be converted into a score, rank, or winner rule.

This separates two kinds of judgment:

1. **Mechanical validity:** can the Change Set be executed and audited?
2. **Research/design judgment:** is this the change worth carrying forward, considering resident evidence, trade-offs, and the study question?

Only the first may be automated.

## Minimal implementation boundary

The active implementation boundary is:

1. generate and mechanically validate scoreless, evidence-linked Quest/Task Change Set drafts;
2. show meaningful before/after rules, expected effects, possible burdens, and next observations;
3. keep engine bindings collapsed as implementation detail;
4. require explicit researcher confirmation with a recorded reason before creating or running a revision;
5. compare only the resulting confirmed lineage. Descriptive measures never rank or choose it.

## Claim boundary

The confirmed Change Set is not a validated winner or deployment approval. It is the researcher's hypothesis for the next controlled iteration. Human resident review remains necessary to establish where the simulated evaluations were useful, misleading, or incomplete.
