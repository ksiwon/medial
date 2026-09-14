"""Who, in this village, would actually ask whom.

The registry records each resident's *group*, and a group is not a relation.
``cousin`` is a group of one whose meaning is an edge to the village head that
the data never states, and the three ``solo`` residents have no group at all -
yet the recorded quests show P3 driving P9 home and carrying medicine to P11.
So the edges live here, each carrying the recorded thing it comes from.

Fixed case input, like ``EnvironmentRevision`` and ``ModelPolicy``. A Change Set
that could add an edge would let MEDial succeed by giving a lonely person a
friend, and that is the case being deleted rather than MEDial improving.

**Nothing here is invented.** Every edge points at a companion group the
interviews recorded or at one of the five recorded quests. Where the source is
silent there is no edge, and a resident with no edge simply cannot hand work to
anyone - the screen says so rather than quietly inventing a neighbour. This is
the same line drawn in ``day.py`` for the residents whose routine was never
recorded.
"""
from __future__ import annotations

from .contracts import RelationEdge, RelationRevision

#: Companion groups as the registry records them. ``solo`` and ``cousin`` are
#: deliberately absent: one names the lack of a companion, the other is a group
#: of one and is written out below as the edge it actually means.
_COMPANION_GROUPS = {
    "four": (["P4", "P6", "P7", "P8"],
             "점심 마을식품·저녁 어촌체험마을을 함께 다니는 4인 동행군"),
    "pair": (["P2", "P5"], "정기적으로 서로 왕래하는 2인"),
    "couple": (["P10", "P11"], "부부이며 미가식당에서 종일 함께 있다"),
}


def _companions() -> list[RelationEdge]:
    edges: list[RelationEdge] = []
    for members, reason in _COMPANION_GROUPS.values():
        for index, a in enumerate(members):
            for b in members[index + 1:]:
                edges.append(RelationEdge(
                    a=a, b=b, kind="companion",
                    provenance="source-adapted", reason=reason))
    return edges


#: Edges the five recorded quests show directly. Each one happened; none of them
#: is an inference about who *would* help whom in general.
_RECORDED = [
    RelationEdge(a="P6", b="P12", kind="kin", provenance="source-adapted",
                 reason="P12 박동규는 이장 P6의 사촌이다"),
    RelationEdge(a="P9", b="P12", kind="ride", provenance="source-adapted",
                 reason="Q1 병원 동행 갈 때 P12가 P9를 태워 갔다 (08:00~08:38)"),
    RelationEdge(a="P3", b="P9", kind="ride", provenance="source-adapted",
                 reason="Q5 병원 동행 올 때 P3가 P9를 태워 왔다 (12:55~13:27)"),
    RelationEdge(a="P3", b="P11", kind="errand", provenance="source-adapted",
                 reason="Q2 의약품 전달을 P3가 P11에게 가져갔다 (10:40 배정 → 13:10 완료)"),
    RelationEdge(a="P1", b="P6", kind="check", provenance="source-adapted",
                 reason=("Q3 안부 확인을 이장 P6가 맡았고, 기존 절차도 "
                         "생활지원사 전화 → 무응답 → 이장 연락 → 이장 방문이다")),
]

REL_V1 = RelationRevision(
    id="rel-v1",
    label="원자료 관계 (v1)",
    edges=[*_companions(), *_RECORDED],
    assumptions=[
        "간선은 대칭이다. '이 둘은 서로 왕래한다'는 뜻이지 'A가 B를 돕는다'가 아니다. "
        "누가 누구를 태울 수 있는지는 페르소나의 drivesSelf가 따로 판정한다.",
        "원자료에 없는 관계는 만들지 않는다. 간선이 없는 사람은 일을 넘길 수 없고, "
        "화면은 '이 사람의 왕래 기록이 원자료에 없다'고 말한다.",
        "동행군은 함께 다닌 기록이지 친밀도가 아니다. 이 시뮬레이터에 친밀도 점수는 없다.",
        "P1은 P6 하나, P2는 P5 하나뿐이다. 이것은 데이터의 한계가 아니라 "
        "원자료가 기록한 그대로이며, 넘길 사람이 없다는 결과로 드러나야 한다.",
    ],
)

#: The same village with nobody handing work to anybody. Used where the question
#: is "does this mechanism work" rather than "what do the neighbours do".
REL_NONE = RelationRevision(
    id="rel-none",
    label="주민 간 전가 없음",
    edges=[],
    assumptions=["이 실행에서는 주민이 서로에게 일을 넘기지 않는다."],
)

RELATIONS: dict[str, RelationRevision] = {REL_V1.id: REL_V1, REL_NONE.id: REL_NONE}
DEFAULT_RELATION_ID = REL_V1.id
NO_RELATION_ID = REL_NONE.id


def get_relations(relation_id: str | None = None) -> RelationRevision:
    return RELATIONS[relation_id or DEFAULT_RELATION_ID]
