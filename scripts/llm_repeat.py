"""The same day, several times, on real models - does the head's choice hold?

    python scripts/llm_repeat.py                     # A, B, C x 5 runs, seed 17
    python scripts/llm_repeat.py 3 policy-C-v1       # 3 runs of one policy

SYNTHETIC village only, same seed every run, so the day is identical and any
difference between runs is the model's. Each run gets its own in-memory store,
so nothing is replayed: every run really asks. Writes one JSON per run and a
summary to .run/llm-repeat/ (gitignored) and prints a table.

What it reads off each run, all from the committed log:
  * the head's decide answers (action, askOrder, waitMinutes) and repairs;
  * each resident answer and whether the decline table would have said the same;
  * outcome, resolution path, adapter failures and their detail;
  * call count and wall time.
A provider refusal (429/5xx after retries) is recorded as that run's error, and
a free-tier quota message is called out by name.
"""
from __future__ import annotations

import io
import json
import os
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
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

RUNS = int(sys.argv[1]) if len(sys.argv) > 1 else 5
POLICIES = sys.argv[2:] or ["policy-A-v1", "policy-B-v1", "policy-C-v1"]
DECK, RES, SEED = "deck-p1-no-response-v1", "assumed-resources-v1", 17
OUT = ROOT / ".run" / "llm-repeat"
OUT.mkdir(parents=True, exist_ok=True)

provider = ModelProvider.from_env(env)
policy = policy_from_env(env, mode="off")
if not provider.available:
    sys.exit("no GOOGLE_API_KEY in server/.env")
missing = provider.verify_models(policy)
if missing:
    sys.exit("models not offered: %s" % missing)
village = load_village(str(ROOT / "fixtures" / "synthetic" / "village.synthetic.json"))
personas = str(ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")


def one(policy_id: str, n: int) -> dict:
    svc = SimulationService(store=Store(":memory:"), village=village, persona_path=personas,
                            model_policy=policy, provider=provider)
    started = time.time()
    row: dict = {"policy": policy_id, "run": n}
    try:
        out = svc.create_attempt(policy_id, DECK, RES, seed=SEED, adapter="llm")
    except Exception as exc:  # noqa: BLE001 - the run's own error, written down
        row.update(error="%s: %s" % (type(exc).__name__, str(exc)[:400]),
                   seconds=round(time.time() - started, 1))
        return row
    attempt_id = out["attempt"]["id"]
    metrics = svc.store.get_attempt(attempt_id)["metrics"]
    calls = svc.store.attempt_model_calls(attempt_id)
    events = svc.store.events(attempt_id)
    head = []
    for c in sorted((c for c in calls if c["role"] == "head"), key=lambda c: c["callIndex"]):
        stage = c["prompt"].get("stage")
        try:
            data = json.loads(c["response"] or "null") or {}
        except ValueError:
            data = {"unparsed": (c["response"] or "")[:200]}
        head.append({"stage": stage, "status": c["status"],
                     "repair": bool(c["prompt"].get("rejected")),
                     "action": data.get("action"), "askOrder": data.get("askOrder"),
                     "waitMinutes": data.get("waitMinutes"),
                     "error": c.get("error")})
    residents = []
    for e in events:
        if e["type"] in ("request.accepted", "request.declined", "request.deferred",
                         "request.relayed", "medial.observed") and e["actorId"] not in ("MEDial",):
            p = e["payload"]
            residents.append({"actor": e["actorId"], "type": e["type"],
                              "utterance": p.get("utterance") or p.get("reason"),
                              "table": (p.get("ruleTableSaid") or {}).get("action"),
                              "agrees": p.get("agreesWithRuleTable")})
    failures = [e["payload"].get("detail") for e in events
                if e["type"] == "medial.waiting" and e["payload"].get("reason") == "adapter_error"]
    row.update(
        seconds=round(time.time() - started, 1),
        outcome=metrics["requests"]["outcomes"],
        paths=metrics["requests"]["resolutionPaths"],
        calls=metrics["modelCalls"]["total"], failedCalls=metrics["modelCalls"]["failed"],
        adapterFailures=failures, head=head, residents=residents,
        burdenMinutes={a: b["addedTaskMinutes"] for a, b in metrics["residentBurden"].items()},
    )
    return row


jobs = [(p, n) for p in POLICIES for n in range(1, RUNS + 1)]
print("head=%s resident=%s · %d runs · seed %d" % (policy.headModelId, policy.residentModelId,
                                                   len(jobs), SEED))
with ThreadPoolExecutor(max_workers=3) as pool:
    rows = list(pool.map(lambda j: one(*j), jobs))

stamp = time.strftime("%Y%m%d-%H%M%S")
(OUT / ("runs-%s.json" % stamp)).write_text(json.dumps(rows, ensure_ascii=False, indent=1),
                                           encoding="utf-8")

for r in rows:
    if "error" in r:
        tag = "FREE-TIER QUOTA" if "FreeTier" in r["error"] else "ERROR"
        print("%-12s #%d  %s  %s" % (r["policy"], r["run"], tag, r["error"][:200]))
        continue
    decides = [h for h in r["head"] if h["stage"] == "decide"]
    plan = " | ".join("%s%s%s" % (h["action"], h["askOrder"] or "",
                                  "(repair)" if h["repair"] else "") for h in decides)
    said = ", ".join("%s:%s%s" % (x["actor"], x["type"].split(".")[1],
                                  "" if x["agrees"] in (None, True) else "≠표") for x in r["residents"])
    print("%-12s #%d %5.1fs calls=%-2d %-12s %s\n     head: %s\n     residents: %s%s" % (
        r["policy"], r["run"], r["seconds"], r["calls"], r["outcome"], r["paths"], plan, said,
        ("\n     FAIL: " + " / ".join(r["adapterFailures"])) if r["adapterFailures"] else ""))

print("\n== by policy")
for p in POLICIES:
    ok = [r for r in rows if r["policy"] == p and "error" not in r]
    first = Counter(json.dumps([h["action"], h["askOrder"]], ensure_ascii=False)
                    for r in ok for h in r["head"][:3] if h["stage"] == "decide")
    print(p, "runs ok %d/%d" % (len(ok), RUNS),
          "| outcomes", dict(Counter(o for r in ok for o in r["outcome"])),
          "| paths", dict(Counter(x for r in ok for x in r["paths"])),
          "| adapter failures", sum(bool(r["adapterFailures"]) for r in ok),
          "| repairs", sum(h["repair"] for r in ok for h in r["head"]),
          "| ≠table", sum(x["agrees"] is False for r in ok for x in r["residents"]),
          "\n   first decide answers:", dict(first))
print("\nwritten:", OUT / ("runs-%s.json" % stamp))
