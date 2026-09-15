"""Model residents shadowing a rule village: the same question, side by side.

    python scripts/llm_shadow.py                       # C and D, seeds 1 3 17
    python scripts/llm_shadow.py policy-C-v1 1 2 3     # one policy, chosen days

Under a model head the residents are only ever put in situations the model
head chooses, and on the check-in deck it always asks P9 first, who says yes.
So the "model resident vs decline table" count from scripts/llm_repeat.py has
no decline in it. This script runs the *rule* village - rule head, rule
residents, so the day goes where the table sends it - and, at every question
a resident is asked, also asks the model resident from the identical view.
The model's answer is written down and never applied. What comes out is one
row per question: what the table said, what the model said, and whether the
two agree, over exactly the situations the table produces (the shop couple
at 09:30, the companion who cannot leave, the head on patrol).

SYNTHETIC village. Writes .run/llm-shadow/ (gitignored) and prints a table.
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

from app.simulation import engine as engine_module  # noqa: E402
from app.simulation.agents.base import AdapterError  # noqa: E402
from app.simulation.agents.llm import LlmAdapter  # noqa: E402
from app.simulation.agents.model_calls import ModelCallLog  # noqa: E402
from app.simulation.agents.provider import ModelProvider, policy_from_env  # noqa: E402
from app.simulation.contracts import HEALTH_STAFF  # noqa: E402
from app.simulation.runner import run_attempt  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

args = sys.argv[1:]
POLICIES = [a for a in args if a.startswith("policy-")] or ["policy-C-v1", "policy-D-v1"]
SEEDS = [int(a) for a in args if not a.startswith("policy-")] or [1, 3, 17]
OUT = ROOT / ".run" / "llm-shadow"
OUT.mkdir(parents=True, exist_ok=True)

provider = ModelProvider.from_env(env)
model_policy = policy_from_env(env, mode="record")
if not provider.available:
    sys.exit("no GOOGLE_API_KEY in server/.env")
village = load_village(str(ROOT / "fixtures" / "synthetic" / "village.synthetic.json"))
personas = str(ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")

rows: list[dict] = []


class Shadow:
    """The rule adapter answers and is applied; the model adapter answers the
    same view and is only recorded."""

    def __init__(self, rule, model, run_tag):
        self.rule, self.model, self.run_tag = rule, model, run_tag
        self.name = getattr(rule, "name", "rule")

    def propose(self, view, allowed):
        proposals = self.rule.propose(view, allowed)
        offer = view.latest("request.offered") or view.latest("request.relayed")
        if offer is None:
            return proposals          # not a request: nothing for the table to say
        rule_p = proposals[0] if proposals else None
        row = {**self.run_tag, "actor": view.actor_id,
               "clock": "%02d:%02d" % divmod(view.sim_time_ms // 60_000, 60),
               "asked": offer.kind,
               "table": rule_p.action.value if rule_p else None,
               "tableRule": (rule_p.params.get("rule") if rule_p else None)}
        try:
            shadow = self.model.propose(view, allowed)
            model_p = shadow[0] if shadow else None
            row.update(model=model_p.action.value if model_p else "silent",
                       modelSaid=(model_p.utterance if model_p else "")[:140])
        except AdapterError as exc:
            row.update(model="adapter_error", modelSaid=str(exc)[:140])
        row["agrees"] = (row["model"] == row["table"]
                         or (row["table"] in ("relay", "defer") and row["model"] in ("relay", "defer")))
        rows.append(row)
        return proposals


original_build = engine_module.Engine._build_adapters


def shadowed_build(self, script):
    adapters = original_build(self, script)
    log = ModelCallLog("shadow-" + self.attempt.id, model_policy)
    for actor_id, rule in list(adapters.items()):
        if actor_id == HEALTH_STAFF:
            continue
        model = LlmAdapter(self.factory, actor_id, log, provider=provider,
                           policy=model_policy, interaction=self.environment.interaction)
        adapters[actor_id] = Shadow(rule, model, {"policy": self.policy_revision.id,
                                                  "seed": self.attempt.seed})
    return adapters


engine_module.Engine._build_adapters = shadowed_build

started = time.time()
print("resident model %s · policies %s · seeds %s" % (model_policy.residentModelId, POLICIES, SEEDS))
for policy_id in POLICIES:
    for seed in SEEDS:
        run_attempt("shadow-%s-%d" % (policy_id, seed), policy_id, "deck-p1-no-response-v1",
                    "assumed-resources-v1", village=village, persona_path=personas, seed=seed,
                    environment_id="env-v3")

stamp = time.strftime("%Y%m%d-%H%M%S")
(OUT / ("shadow-%s.json" % stamp)).write_text(json.dumps(rows, ensure_ascii=False, indent=1),
                                             encoding="utf-8")
for r in rows:
    print("%-12s seed %-3d %s %-4s table=%-7s(%-18s) model=%-8s %s  %s" % (
        r["policy"], r["seed"], r["clock"], r["actor"], r["table"], r["tableRule"] or "",
        r["model"], "=" if r["agrees"] else "≠", r["modelSaid"]))
n = len(rows)
dis = [r for r in rows if not r["agrees"]]
print("\n%d questions · %d disagree (%.0f%%) · %.0fs" % (n, len(dis), 100 * len(dis) / n if n else 0,
                                                       time.time() - started))
by_rule: dict = {}
for r in rows:
    key = "%s→%s" % (r["table"], r["tableRule"] or "")
    by_rule.setdefault(key, [0, 0])
    by_rule[key][0] += 1
    by_rule[key][1] += 0 if r["agrees"] else 1
for key, (total, differ) in sorted(by_rule.items()):
    print("  %-32s %d asked, %d differ" % (key, total, differ))
print("written:", OUT / ("shadow-%s.json" % stamp))
