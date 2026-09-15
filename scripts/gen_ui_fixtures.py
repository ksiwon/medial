"""Regenerate the UI mount fixtures from the SYNTHETIC village only.

The first cut of these was captured with curl against the running server, which
serves the real 은점마을 registry. That would have put source-derived material
(real place names, resident ages and jobs) into the repository, which is the one
thing local-data/ is gitignored to prevent. Everything here comes from
fixtures/synthetic/ instead, so the mount tests exercise the same payload
*shapes* without carrying research data.
"""
import json, sys
from pathlib import Path

ROOT = Path(r"C:/Users/pjo12/Downloads/coding/medial")
sys.path.insert(0, str(ROOT / "server"))

from fastapi.testclient import TestClient
from app.simulation.api.routes import create_app, set_service
from app.simulation.iteration.api import set_iteration_service
from app.simulation.iteration.llm import LlmClient
from app.simulation.iteration.service import IterationService
from app.simulation.persistence.store import Store
from app.simulation.service import SimulationService
from app.simulation.village import load_village

SYN = ROOT / "fixtures" / "synthetic"
store = Store(":memory:")
sim = SimulationService(store=store,
                        village=load_village(SYN / "village.synthetic.json"),
                        persona_path=str(SYN / "personas.synthetic.json"))
set_service(sim)
it = IterationService(sim, llm_client=LlmClient())
set_iteration_service(it)
api = TestClient(create_app())

out = ROOT / "fixtures" / "ui"
out.mkdir(parents=True, exist_ok=True)

def save(name, payload):
    (out / name).write_text(json.dumps(payload, ensure_ascii=False, indent=1),
                            encoding="utf-8")
    print("%-16s %8d bytes" % (name, (out / name).stat().st_size))

r = api.post("/api/sim/attempts", json={
    "policyId": "policy-A-v1", "scenarioDeckId": "deck-p1-no-response-v1",
    "resourceRevisionId": "assumed-resources-v1"})
attempt_id = r.json()["attempt"]["id"]

save("attempt.json", api.get("/api/sim/attempts/%s" % attempt_id).json())
save("events.json", api.get("/api/sim/attempts/%s/events" % attempt_id).json())
# The same day under the neighbour-first policy, which is the run where the
# refusal table and its sentences actually fire on the shipped deck.
r = api.post("/api/sim/attempts", json={
    "policyId": "policy-C-v1", "scenarioDeckId": "deck-p1-no-response-v1",
    "resourceRevisionId": "assumed-resources-v1"})
neighbour_id = r.json()["attempt"]["id"]
save("attempt-neighbours.json", api.get("/api/sim/attempts/%s" % neighbour_id).json())
save("events-neighbours.json", api.get("/api/sim/attempts/%s/events" % neighbour_id).json())

save("village.json", api.get("/api/sim/village").json())
save("personas.json", api.get("/api/sim/personas").json())

session = it.create_session(
    label="화면 테스트용 반복", core_item="누구의 시간으로 해결할 것인가",
    base_policy_id="policy-IT-v0",
    development_decks=["deck-p1-no-response-v1"],
    resource_id="assumed-resources-v1", max_generations=2)
it.command(session.id, "cmd-start", "start", blocking=True)

# Confirm the first valid draft so the fixture carries a parent/child pair: the
# comparison screen, the rule-application row and the evaluation screen's
# version picker all need two versions to be exercised at all. The reason below
# is a fixture's reason, not a research decision.
detail = api.get("/api/sim/iteration/sessions/%s" % session.id).json()
generation = next(g for g in detail["generations"]
                  if g["index"] == detail["session"]["currentGenerationIndex"])
draft = next((c for c in generation["changeSets"]
              if c["validationStatus"] == "valid" and c["confirmationStatus"] == "draft"), None)
if draft is not None:
    it.command(session.id, "cmd-confirm", "confirm_change_set",
               payload={"changeSetId": draft["id"],
                        "reason": "화면 픽스처를 만들기 위한 확정. 연구 판단이 아니다."},
               blocking=True)
save("session.json", api.get("/api/sim/iteration/sessions/%s" % session.id).json())
