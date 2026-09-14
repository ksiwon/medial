"""One day on real models, on the SYNTHETIC village, printed so it can be read.

    python scripts/llm_smoke.py                 # policy-C, head/resident from server/.env
    python scripts/llm_smoke.py policy-A-v1     # another policy
    MEDIAL_LLM_HEAD_MODEL=gemini-3.7-flash python scripts/llm_smoke.py

Synthetic on purpose: the payload shapes are identical and nothing from the
source village leaves the machine. Nothing is stored; the database is in
memory. Every model call is listed with its status and latency so a provider
that answers 503 for a minute shows up as what it is.
"""
from __future__ import annotations

import io
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
from app.simulation.persistence.store import Store  # noqa: E402
from app.simulation.service import SimulationService  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

provider = ModelProvider.from_env(env)
policy = policy_from_env(env, mode="off")
print("provider:", provider.describe(policy))
if not provider.available:
    sys.exit("no key in server/.env")
missing = provider.verify_models(policy)
print("missing models:", missing or "none")
if missing:
    sys.exit(1)

svc = SimulationService(
    store=Store(":memory:"),
    village=load_village(str(ROOT / "fixtures" / "synthetic" / "village.synthetic.json")),
    persona_path=str(ROOT / "fixtures" / "synthetic" / "personas.synthetic.json"),
    model_policy=policy, provider=provider)

policy_id = sys.argv[1] if len(sys.argv) > 1 else "policy-C-v1"
started = time.time()
out = svc.create_attempt(policy_id, "deck-p1-no-response-v1", "assumed-resources-v1",
                         adapter="llm")
attempt_id = out["attempt"]["id"]
metrics = svc.store.get_attempt(attempt_id)["metrics"]
print("elapsed %.1fs" % (time.time() - started))
print("requests:", metrics["requests"])
print("calls:", metrics["modelCalls"]["total"], "failed:", metrics["modelCalls"]["failed"],
      "| adapter failures:", metrics["adapterFailures"], "| rejected:", metrics["rejectedProposals"])
print("refusals:", [(r["actorId"], r["rule"], r["reason"]) for r in metrics["refusals"]["rows"]])
print("handovers:", metrics["handovers"]["count"])
print()
for row in svc.store.attempt_model_calls(attempt_id):
    print("  %-8s %-7s %-22s %-5s %6d ms  %s" % (row["role"], row["actorId"], row["modelId"],
                                                row["status"], row["latencyMs"] or 0,
                                                row["prompt"].get("stage", "")))
    rejected = row["prompt"].get("rejected")
    if rejected:
        print("      다시 물은 이유:", "; ".join(rejected["problems"]))
print()
for event in svc.store.events(attempt_id):
    kind = event["type"]
    if not kind.startswith(("medial.", "request.", "task.check", "need.")):
        continue
    payload = event["payload"]
    line = "%3d %-22s %-6s" % (event["seq"], kind, event["actorId"])
    for key in ("summary", "rationale", "chosen", "toActorId", "message", "utterance",
                "reason", "outcome", "detail"):
        if payload.get(key):
            line += "\n      %s: %s" % (key, str(payload[key])[:300])
    if payload.get("ruleTableSaid"):
        line += "\n      규칙표라면: %s (agrees=%s)" % (payload["ruleTableSaid"]["action"],
                                                    payload.get("agreesWithRuleTable"))
    print(line)
