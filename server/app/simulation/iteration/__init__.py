"""Review-driven iteration: run a cycle, ask each agent about its own
experience, turn those reviews into bounded Quest/Task Change Sets, wait for
researcher confirmation, run one revision, and preserve the evidence chain.

Everything in this package is *outside* the world except the reviews
themselves, which are retrospective products of actors who were inside it. The
split is enforced in code, not by convention:

* :mod:`experience` decides what one actor is allowed to review over;
* :mod:`reviewers` produce an ``AgentReview`` and nothing else;
* :mod:`synthesis` and :mod:`improvement` run *outside* the world and never
  write into it - they emit Change Set drafts that :mod:`validation` checks;
* :mod:`engine` owns the state machine, the budget and the stop reasons.
"""
