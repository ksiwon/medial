"""The review loop on a model village, with real models at every seat.

    python scripts/llm_iteration.py            # 2 generations, deck P1
    python scripts/llm_iteration.py 3          # 3 generations

behaviour = llm (MEDial head + residents), review = llm, improvement = llm.
SYNTHETIC village, in-memory store. The researcher's confirmation is done by
this script - the first valid Change Set, with a reason that says so - because
the question here is whether the chain runs on real models, not which change a
researcher would pick. Nothing it confirms is a research decision.

Prints each generation's outcome, reviews, synthesis and Change Sets, the
comparison to the parent, the stop reason and the calls spent; writes the full
session detail to .run/llm-iteration/ (gitignored).
"""
from __future__ import annotations

import io
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
sys.stdout.reconfigure(encoding="utf-8")

env = dict(os.environ)
dotenv = ROOT / "server" / ".env"
if dotenv.exists():
    for line in io.open(dotenv, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env.setdefault(key.strip(), value.strip())

from app.simulation.agents.provider import ModelProvider, policy_from_env  # noqa: E402
from app.simulation.iteration.contracts import SessionStatus  # noqa: E402
from app.simulation.iteration.llm import LlmClient  # noqa: E402
from app.simulation.iteration.service import IterationService  # noqa: E402
from app.simulation.persistence.store import Store  # noqa: E402
from app.simulation.service import SimulationService  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

GENERATIONS = int(sys.argv[1]) if len(sys.argv) > 1 else 2
OUT = ROOT / ".run" / "llm-iteration"
OUT.mkdir(parents=True, exist_ok=True)
SYN = ROOT / "fixtures" / "synthetic"

provider = ModelProvider.from_env(env)
sim = SimulationService(store=Store(":memory:"),
                        village=load_village(str(SYN / "village.synthetic.json")),
                        persona_path=str(SYN / "personas.synthetic.json"),
                        model_policy=policy_from_env(env, mode="off"), provider=provider)
it = IterationService(sim, llm_client=LlmClient.from_env(env))

started = time.time()
session = it.create_session(
    label="실제 모델 반복 검증", core_item="누구의 시간으로 해결할 것인가",
    base_policy_id="policy-IT-v0", development_decks=["deck-p1-no-response-v1"],
    resource_id="assumed-resources-v1", max_generations=GENERATIONS,
    call_budget=400, behaviour_adapter="llm", review_adapter="llm",
    improvement_adapter="llm")
print("session", session.id, "· generations", GENERATIONS)
it.command(session.id, "cmd-start", "start", blocking=True)
session = it.load(session.id)
step = 0
while session.status is SessionStatus.awaiting_confirmation:
    detail = it.detail(session.id)
    generation = next(g for g in detail["generations"]
                      if g["index"] == session.currentGenerationIndex)
    valid = [c for c in generation["changeSets"]
             if c["validationStatus"] == "valid" and c["confirmationStatus"] == "draft"]
    if not valid:
        break
    print("  gen %d: confirming %s (%s)" % (generation["index"], valid[0]["id"], valid[0]["label"]))
    it.command(session.id, "cmd-confirm-%d" % step, "confirm_change_set",
               payload={"changeSetId": valid[0]["id"],
                        "reason": "검증 스크립트가 첫 유효안을 대신 확정 (연구자 판단 아님)"},
               blocking=True)
    step += 1
    session = it.load(session.id)

detail = it.detail(session.id)
stamp = time.strftime("%Y%m%d-%H%M%S")
(OUT / ("session-%s.json" % stamp)).write_text(
    json.dumps(detail, ensure_ascii=False, indent=1, default=str), encoding="utf-8")

s = detail["session"]
print("\nstatus:", s["status"], "|", s.get("stopReason"), "|", s.get("stopDetail"))
print("adapter mode:", detail["adapterMode"], "| calls used:", s["callsUsed"],
      "| tokens:", s["tokensUsed"], "| %.0fs" % (time.time() - started))
for g in detail["generations"]:
    print("\n== generation %d · %s · outcome %s" % (g["index"], g["policyRevisionId"], g["outcome"]))
    for attempt_id in g["attemptIds"]:
        a = sim.store.get_attempt(attempt_id)
        m = a["metrics"]
        print("  attempt", attempt_id, m["requests"]["outcomes"], m["requests"]["resolutionPaths"],
              "| village calls", m["modelCalls"]["total"], "failed", m["modelCalls"]["failed"],
              "| adapter failures", m["adapterFailures"])
    for r in g["reviews"]:
        items = ", ".join("%s=%s" % (i["dimension"], i["assessment"]) for i in r["items"])
        print("  review %-6s %-22s %s" % (r["actorId"], r["usageStatus"], items))
        if r["usageStatus"] != "no_experience":
            print("         \"%s\"" % r["overallNarrative"][:220])
    syn = g.get("synthesis")
    if syn:
        for ig in syn["issueGroups"]:
            print("  issue [%s] %s — %s" % (ig["severity"], ig["title"], ig["assumedMechanism"][:160]))
        if syn["ungroundedClaims"]:
            print("  ungrounded:", syn["ungroundedClaims"][:3])
    for c in g["changeSets"]:
        print("  change set %s [%s/%s] %s" % (c["id"], c["validationStatus"],
                                              c["confirmationStatus"], c["label"]))
        for ch in c["changes"]:
            print("     %s: %s → %s  %s" % (ch["field"], ch["beforeRule"][:60], ch["afterRule"][:80],
                                          [(b["key"], b["before"], b["after"])
                                           for b in ch["executionBindings"]]))
        if c["validationErrors"]:
            print("     errors:", c["validationErrors"])
    cmp_ = (g.get("metrics") or {}).get("comparedToParent")
    if cmp_:
        print("  vs parent: controlled=%s differing=%s" % (cmp_["controlled"], cmp_["differingInputs"]))
        print("    ", cmp_["claim"][:240])
print("\nwritten:", OUT / ("session-%s.json" % stamp))
