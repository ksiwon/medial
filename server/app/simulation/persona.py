"""Compile the persona source into behaviour the engine may use.

The source file is a role-play pack: real (or pseudonymised) names, interview
quotes, and a system prompt per person. None of that belongs in the engine, in
the repository, in the front-end bundle or in a test fixture. What the engine
needs is narrower: does this person drive, do they live alone, who would they say
yes to, and what do we simply not know.

So the compiler produces two things per resident:

* a :class:`PersonaProfile` - structured, name-free behaviour;
* a list of :class:`EvidenceCard` - one per claim, each carrying an RFC 6901
  JSON pointer back into the local source file plus whether the claim is a
  ``fact`` stated there, the researcher's ``interpretation`` of it, an
  ``assumption`` filling a gap, or an explicit ``unknown``.

Two properties of the source are preserved rather than smoothed over: P10 and
P11 were interviewed together (one transcript, two people), and P12 was never
interviewed at all. Both show up as reduced confidence on every card derived
from them, and P12's cards are capped at ``low``.

Nothing here reads a model. Free text is hashed, never copied.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

from .contracts import EvidenceCard, PersonaProfile

REPO_ROOT = Path(__file__).resolve().parents[3]
MANIFEST = REPO_ROOT / "docs" / "research" / "source-manifest.json"
SYNTHETIC = REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json"

#: The anonymised variant is the one to compile; the manifest lists both.
PREFERRED_SOURCE = "은점마을_페르소나_익명.json"

PEOPLE_KEY = "페르소나"
META_KEY = "메타"


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _pointer(index: int, *fields: str) -> str:
    parts = [PEOPLE_KEY, str(index), *fields]
    return "/" + "/".join(p.replace("~", "~0").replace("/", "~1") for p in parts)


def locate_source() -> Path | None:
    """Resolve the persona file from the manifest, without copying it anywhere."""
    override = os.environ.get("MEDIAL_PERSONA_PATH")
    if override:
        candidate = Path(override)
        return candidate if candidate.exists() else None
    if not MANIFEST.exists():
        return None
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for entry in manifest.get("sources", []):
        if entry.get("name") == PREFERRED_SOURCE:
            candidate = Path(entry["localPath"])
            return candidate if candidate.exists() else None
    return None


# --------------------------------------------------------------------------
# Field rules. Each one states what it looked at and what kind of claim it makes.
# --------------------------------------------------------------------------

_LIVES_ALONE = ("혼자 지냅니다", "혼자 삽니다", "혼자 지내고", "독거")
_NO_SELF_DRIVE = ("스스로 운전하지 않습니다", "운전 못", "운전을 못", "운전하지 않습니다")
_HAS_CAR = ("차를 타고", "차로", "차를 몰", "태워", "태우고", "차편")


def _text_of(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " ".join(_text_of(v) for v in value)
    if isinstance(value, dict):
        return " ".join(_text_of(v) for v in value.values())
    return ""


def _confidence_for(basis: str, person_id: str) -> str:
    if person_id == "P12" or "인터뷰 없음" in basis:
        return "low"
    if "합동" in basis:
        return "medium"
    return "high"


def _interview_basis(raw: str) -> str:
    if "인터뷰 없음" in raw:
        return "none"
    if "합동" in raw:
        return "joint_interview"
    if "인터뷰" in raw:
        return "interview"
    return "unknown"


_ID_IN_CONTACT = re.compile(r"\bP\d{1,2}\b")


class PersonaCompiler:
    def __init__(self, path: Path | None, revision_id: str, data_source: str) -> None:
        self.path = path
        self.revision_id = revision_id
        self.data_source = data_source

    def compile(self, raw: dict[str, Any]) -> dict[str, PersonaProfile]:
        people = raw.get(PEOPLE_KEY) or []
        out: dict[str, PersonaProfile] = {}
        for index, person in enumerate(people):
            profile = self._one(index, person)
            out[profile.subjectId] = profile
        return out

    # -- one person ------------------------------------------------------
    def _one(self, index: int, person: dict[str, Any]) -> PersonaProfile:
        pid = person["id"]
        basis_raw = str(person.get("근거", ""))
        basis = _interview_basis(basis_raw)
        ceiling = _confidence_for(basis_raw, pid)
        cards: list[EvidenceCard] = []
        counter = [0]

        def card(kind: str, field: str, claim: str, pointer: str,
                 confidence: str = "high", quote: str | None = None,
                 note: str | None = None) -> None:
            counter[0] += 1
            order = {"low": 0, "medium": 1, "high": 2}
            capped = confidence if order[confidence] <= order[ceiling] else ceiling
            cards.append(EvidenceCard(
                id="ev-%s-%d" % (pid, counter[0]),
                subjectId=pid,
                kind=kind,  # type: ignore[arg-type]
                field=field,
                claim=claim,
                pointer=pointer,
                sourceKind=basis,
                confidence=capped,  # type: ignore[arg-type]
                quoteHash=_hash(quote) if quote else None,
                note=note,
            ))

        card("fact", "interviewBasis",
             {"interview": "인터뷰 전사 1건이 있다",
              "joint_interview": "합동 인터뷰 전사 1건(2인)에서 왔다. 두 사람의 발언이 한 전사에 섞여 있다",
              "none": "인터뷰가 없다. 연구자 구술과 시뮬레이터 데이터로만 채워졌다",
              "unknown": "근거 표기를 해석하지 못했다"}[basis],
             _pointer(index, "근거"),
             confidence="high" if basis != "unknown" else "low",
             note="P12는 다른 11명보다 근거 밀도가 낮다" if basis == "none" else None)

        residence = str(person.get("거주", ""))
        lives_alone: bool | None = None
        if any(k in residence for k in _LIVES_ALONE):
            lives_alone = True
            card("fact", "livesAlone", "혼자 산다고 기술되어 있다",
                 _pointer(index, "거주"), quote=residence)
        elif residence:
            lives_alone = False
            card("interpretation", "livesAlone",
                 "혼자 산다는 기술이 없어 동거인이 있는 것으로 읽었다",
                 _pointer(index, "거주"), confidence="medium", quote=residence)

        drives, has_car = self._vehicle(index, person, card)
        contacts = self._contacts(index, person, card)
        accept, decline, unknowns = self._conditions(index, person, card, pid)

        # Seat capacity is never stated anywhere in the source. Saying "4" would
        # be inventing the one number the ride-sharing flow depends on.
        card("unknown", "seatCapacity",
             "차량 좌석 수는 원자료에 없다. 동승 인원 제한은 실험 가정으로만 둘 수 있다",
             _pointer(index), confidence="high")
        unknowns.append("차량 좌석 수")

        age = person.get("나이")
        band = "unknown"
        if isinstance(age, int):
            band = "%d대" % (age // 10 * 10)
            card("fact", "ageBand", "나이대 %s" % band, _pointer(index, "나이"))

        return PersonaProfile(
            subjectId=pid,
            revisionId=self.revision_id,
            displayName=pid,
            ageBand=band,
            livesAlone=lives_alone,
            drivesSelf=drives,
            hasVehicle=has_car,
            seatCapacity=None,
            closeContacts=contacts,
            groupLabel=str(person.get("관계", {}).get("그룹", "unknown")),
            acceptanceConditions=accept,
            declineConditions=decline,
            unknowns=sorted(set(unknowns)),
            evidence=cards,
            interviewBasis=basis,
            speechSource="rule",
        )

    # -- sub-extractors --------------------------------------------------
    def _vehicle(self, index: int, person: dict[str, Any], card) -> tuple[bool | None, bool | None]:
        blob = " ".join([
            str(person.get("시뮬레이터에서의 역할", "")),
            _text_of(person.get("관계", {})),
            str(person.get("하루", "")),
        ])
        pointer = _pointer(index, "시뮬레이터에서의 역할")
        if any(k in blob for k in _NO_SELF_DRIVE):
            card("fact", "drivesSelf", "스스로 운전하지 않는다고 기술되어 있다", pointer)
            return (False, None)
        if any(k in blob for k in _HAS_CAR):
            card("interpretation", "drivesSelf",
                 "차로 이동하거나 다른 사람을 태운다는 기술에서 직접 운전한다고 읽었다",
                 pointer, confidence="medium")
            return (True, True)
        card("unknown", "drivesSelf",
             "운전 여부를 확인할 기술이 없다. 운전 가능으로 가정하지 않는다", pointer)
        return (None, None)

    def _contacts(self, index: int, person: dict[str, Any], card) -> list[str]:
        rel = person.get("관계", {}) or {}
        listed = rel.get("가까운 사람") or []
        ids: list[str] = []
        for entry in listed:
            found = _ID_IN_CONTACT.search(str(entry))
            if found:
                ids.append(found.group(0))
        if ids:
            card("fact", "closeContacts",
                 "본인이 가깝다고 답한 사람: %s" % ", ".join(ids),
                 _pointer(index, "관계", "가까운 사람"))
        else:
            card("fact", "closeContacts",
                 "정기적으로 함께 다니는 이웃이 없다고 답했다",
                 _pointer(index, "관계", "가까운 사람"))
        return ids

    def _conditions(self, index: int, person: dict[str, Any], card,
                    pid: str) -> tuple[list[str], list[str], list[str]]:
        """When would this person say yes, and when no.

        These are the researcher's reading of the role notes, and they are marked
        as such. A rule that decides whether somebody helps a neighbour is not a
        fact the interview establishes.
        """
        role = str(person.get("시뮬레이터에서의 역할", ""))
        rel_text = _text_of(person.get("관계", {}))
        pointer = _pointer(index, "시뮬레이터에서의 역할")
        accept: list[str] = []
        decline: list[str] = []
        unknowns: list[str] = []

        if "자리를 뜨지 못" in role or "자리를 뜰 수 없" in role or "자리를 뜨지 못합니다" in role:
            decline.append("영업 중 가게를 비울 수 없다")
            card("fact", "declineConditions",
                 "가게를 보고 있어 자리를 뜰 수 없다고 기술되어 있다", pointer)

        if "사촌" in rel_text or "부탁하면" in role:
            accept.append("가까운 친척의 부탁이면 경로 효율과 무관하게 간다")
            card("interpretation", "acceptanceConditions",
                 "친척의 부탁이면 우회해서라도 간다는 기술을 수락 조건으로 읽었다",
                 pointer, confidence="medium")

        if "봉사" in rel_text or "마을 일과" in rel_text:
            accept.append("마을 일로 요청받으면 순찰·회관 일정 뒤에 처리한다")
            card("interpretation", "acceptanceConditions",
                 "마을 일과 봉사를 많이 한다는 기술을 수락 조건으로 읽었다",
                 _pointer(index, "관계", "설명"), confidence="medium")

        if not accept:
            unknowns.append("수락 조건")
            card("unknown", "acceptanceConditions",
                 "이 사람이 어떤 요청을 받아들이는지 원자료에서 확인되지 않는다", pointer)
        if not decline:
            unknowns.append("거절 조건")

        unknowns.append("실제 응답 의사")
        if pid == "P12":
            unknowns.append("본인 확인(인터뷰 없음)")
        return (accept, decline, unknowns)


def apply_community_facts(profiles: dict[str, PersonaProfile],
                          ledger: Any) -> dict[str, PersonaProfile]:
    """Fill ``drivesSelf`` from the ledger's mobility statements.

    Only an *unknown* is filled. A persona whose interview said they do not
    drive keeps that; the researcher's community-level statement does not
    outrank a person's own words. Each filled value gets an evidence card of
    kind ``assumption`` pointing at the ledger, so the ride decision can still
    say where the belief came from.
    """
    statements = getattr(ledger, "mobility", None) or []
    if not statements:
        return profiles
    out: dict[str, PersonaProfile] = {}
    for pid, profile in profiles.items():
        statement = ledger.drives(pid)
        if profile.drivesSelf is not None or statement is None:
            out[pid] = profile
            continue
        card = EvidenceCard(
            id="%s-drivesSelf-ledger" % pid, subjectId=pid, kind="assumption",
            field="drivesSelf",
            claim=("운전 가능으로 둔다: " if statement.drivesSelf else "운전하지 않는 것으로 둔다: ")
            + statement.reason,
            pointer="ledger:%s/mobility" % getattr(ledger, "id", "?"),
            sourceKind="researcher_note", confidence="medium",
            note="공동체 단위의 연구자 진술. 본인 인터뷰가 운전 여부를 말했다면 그쪽이 우선한다.")
        out[pid] = profile.model_copy(update={
            "drivesSelf": statement.drivesSelf,
            "hasVehicle": True if statement.drivesSelf else profile.hasVehicle,
            "evidence": [*profile.evidence, card],
        })
    return out


def load_personas(path: "str | Path | None" = None
                  ) -> tuple[dict[str, PersonaProfile], dict[str, Any]]:
    """Compile personas from the local source, or from the synthetic fixture.

    Returns ``(profiles, provenance)``. ``provenance`` is what the screen shows so
    a synthetic run can never be mistaken for the interview-derived one. Tests
    pass the synthetic path explicitly rather than depending on whether the
    git-ignored interview pack happens to be present on this machine.
    """
    path = Path(path) if path is not None else locate_source()
    if path is None or not path.exists():
        path = SYNTHETIC if SYNTHETIC.exists() else None
    # A synthetic fixture must never be reported as the interview-derived pack,
    # whatever route it arrived by (fallback or MEDIAL_PERSONA_PATH).
    data_source = "synthetic" if (
        path is not None and "synthetic" in path.name) else "persona-source"
    if path is None:
        return ({}, {"dataSource": "none", "personaCount": 0,
                     "note": "페르소나 원자료도 합성 픽스처도 없어 페르소나 없이 실행한다."})

    raw = json.loads(path.read_text(encoding="utf-8"))
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    revision = "persona-%s-%s" % (data_source, digest)
    compiler = PersonaCompiler(path, revision, data_source)
    profiles = compiler.compile(raw)
    provenance = {
        "dataSource": data_source,
        "revisionId": revision,
        "personaCount": len(profiles),
        "sourceName": path.name,
        "jointInterview": sorted(p.subjectId for p in profiles.values()
                                 if p.interviewBasis == "joint_interview"),
        "noInterview": sorted(p.subjectId for p in profiles.values()
                              if p.interviewBasis == "none"),
        "note": ("이름·인터뷰 인용·역할 프롬프트는 컴파일 결과에 담기지 않는다. "
                 "근거 카드는 원자료의 JSON pointer만 가리킨다."),
    }
    return (profiles, provenance)
