"""What was asked of whom - the elicitation ledger.

The engine reads the village's relations, who knows whose day, whether a phone
is answered in a field, and the conditions under which a person says no. Every
one of those came from an interview or a recorded quest, and an interview that
never asked a question leaves a blank that looks exactly like "none". The
ledger is where that difference is written down: for each person and each
topic, whether the record is complete, partial, an explicit "nobody", or a
question nobody asked.

Fixed case input, hashed into the attempt like the environment and the
relations. Not editable by a Change Set: the answer to "who does P1 rely on"
is a fact about the village, not a knob.

Two things the engine takes from here rather than from code:

* **who knows whose day at place level** (``routineKnowledge``) - until
  2026-09-15 the village head was hard-coded as knowing everybody's usual
  place, with no provenance. Now each (knower, subject) pair carries one, and
  a decision that leaned on an assumed pair says so;
* **whether "no relation" means no relation** - ``relation_first`` reads the
  subject's ``help_contacts`` status and, when the question was never asked,
  says "not asked" instead of "nobody".

Loading: ``MEDIAL_LEDGER_PATH``, else a ``ledger*.json`` beside the village
file, else ``legacy_ledger()`` - everything ``not_asked``, the head assumed to
know all - so an old setup runs unchanged and its gaps are visible.
"""
from __future__ import annotations

import hashlib
import json
import os
from enum import Enum
from pathlib import Path
from typing import Any, ClassVar, Literal

from pydantic import Field

from .contracts import Base

Topic = Literal["companions", "help_contacts", "routine_knowers", "reachability",
                "decline_conditions"]

TOPICS: tuple[str, ...] = ("companions", "help_contacts", "routine_knowers",
                           "reachability", "decline_conditions")

#: What each topic means, in the words the guide and the screen use.
TOPIC_WORDS = {
    "companions": "함께 다니는 사람",
    "help_contacts": "부탁하거나 도움을 청하는 사람",
    "routine_knowers": "내 평소 일과를 아는 사람",
    "reachability": "연락이 닿는 조건 (어디서 · 무엇으로)",
    "decline_conditions": "부탁을 못 받는 조건",
}


class ElicitationStatus(str, Enum):
    #: Asked, and what was said is fully in the record.
    recorded = "recorded"
    #: Asked, but only part of it is in the record (a name without the rest,
    #: or an answer the transcript cuts off).
    partial = "partial"
    #: Asked, and the answer was "nobody" / "none". A real absence.
    asked_none = "asked_none"
    #: The question was never put. Not an absence.
    not_asked = "not_asked"


STATUS_WORDS = {
    ElicitationStatus.recorded: "기록됨",
    ElicitationStatus.partial: "일부만 기록됨",
    ElicitationStatus.asked_none: "물었고 없음",
    ElicitationStatus.not_asked: "안 물어봄",
}


class LedgerEntry(Base):
    actorId: str
    topic: Topic
    status: ElicitationStatus
    #: Where the answer (or its absence) can be checked: an interview
    #: question, a quest, a transcript line. Empty only for ``not_asked``.
    basis: str = ""


class RoutineKnowledge(Base):
    """``knowerId`` knows ``subjectId``'s usual places through the day."""

    knowerId: str
    subjectId: str
    provenance: Literal["source-adapted", "researcher-assumption"]
    reason: str


class ElicitationLedger(Base):
    EDITABLE_BY_CHANGE_SET: ClassVar[bool] = False

    id: str
    label: str
    entries: list[LedgerEntry] = Field(default_factory=list)
    routineKnowledge: list[RoutineKnowledge] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)

    def status(self, actor_id: str, topic: str) -> ElicitationStatus:
        for e in self.entries:
            if e.actorId == actor_id and e.topic == topic:
                return e.status
        return ElicitationStatus.not_asked

    def knowers_of(self, subject_id: str) -> list[RoutineKnowledge]:
        return [k for k in self.routineKnowledge if k.subjectId == subject_id]

    def known_by(self, knower_id: str) -> list[RoutineKnowledge]:
        return [k for k in self.routineKnowledge if k.knowerId == knower_id]

    def content_hash(self) -> str:
        payload = json.dumps(self.model_dump(mode="json"), ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]

    def gaps(self, actor_id: str) -> list[str]:
        """The topics on which the record for this person is not complete."""
        return [t for t in TOPICS
                if self.status(actor_id, t) in (ElicitationStatus.partial,
                                                ElicitationStatus.not_asked)]


def legacy_ledger(resident_ids: list[str], village_head_id: str) -> ElicitationLedger:
    """The ledger a run has when nobody wrote one: every question unasked, and
    the village head assumed to know everyone's day - which is exactly what the
    code assumed silently before this file existed."""
    return ElicitationLedger(
        id="ledger-legacy",
        label="채록 장부 없음 (모두 안 물어봄 · 이장이 전원의 일과를 안다고 가정)",
        entries=[LedgerEntry(actorId=a, topic=t, status=ElicitationStatus.not_asked)
                 for a in resident_ids for t in TOPICS],
        routineKnowledge=[
            RoutineKnowledge(knowerId=village_head_id, subjectId=a,
                             provenance="researcher-assumption",
                             reason="장부가 없어 이장이 모두의 평소 장소를 안다고 가정. 현장 확인 필요")
            for a in resident_ids if a != village_head_id],
        assumptions=["채록 장부가 없는 실행이다. 관계·연락 조건·거절 조건은 물었는지 알 수 없고, "
                     "이장의 지역 지식은 연구자 가정이다."],
    )


def locate_ledger(village_path: Path | None) -> Path | None:
    override = os.environ.get("MEDIAL_LEDGER_PATH")
    if override:
        p = Path(override)
        return p if p.exists() else None
    if village_path is None:
        return None
    for candidate in sorted(village_path.parent.glob("ledger*.json")):
        return candidate
    return None


def load_ledger(village_path: Path | None, resident_ids: list[str],
                village_head_id: str) -> ElicitationLedger:
    target = locate_ledger(village_path)
    if target is None:
        return legacy_ledger(resident_ids, village_head_id)
    data = json.loads(target.read_text(encoding="utf-8"))
    ledger = ElicitationLedger.model_validate(data)
    unknown = {e.actorId for e in ledger.entries} - set(resident_ids)
    if unknown:
        raise ValueError("ledger %s names people not in the village: %s"
                         % (target.name, sorted(unknown)))
    return ledger


def ledger_summary(ledger: ElicitationLedger) -> dict[str, Any]:
    """Per topic, how many people fall under each status. For the catalogue."""
    out: dict[str, dict[str, int]] = {}
    for e in ledger.entries:
        out.setdefault(e.topic, {}).setdefault(e.status.value, 0)
        out[e.topic][e.status.value] += 1
    return {"id": ledger.id, "label": ledger.label, "byTopic": out,
            "routineKnowledge": len(ledger.routineKnowledge),
            "assumedKnowledge": sum(1 for k in ledger.routineKnowledge
                                    if k.provenance == "researcher-assumption")}
