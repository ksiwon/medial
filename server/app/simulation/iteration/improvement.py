"""Propose the next operating policy from the issues, and nothing else.

This adapter runs *outside* the world. It reads reviews, issues and researcher
metrics; it cannot read positions, hidden reasons or another attempt's outcome,
and it cannot speak to anybody in the village.

Every mechanism below states what it expects to change and what it might break,
because the second half is the part a tool like this tends to omit. None of them
is guaranteed to help: whether a change improved anything is decided by running
it, and a mechanism whose regression actually happens is reported as a
regression, not quietly dropped.

What cannot be proposed at all is enforced in :mod:`validation` rather than here,
so the same wall stands in front of the model-backed adapter.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from ..contracts import HEALTH_STAFF
from .contracts import (
    ChangeProposal,
    IssueGroup,
    PatchOp,
    ReviewDimensionKey as D,
    ReviewSynthesis,
)
from .llm import content_hash


def patch_hash(patch: list[PatchOp]) -> str:
    return content_hash([[p.path, p.before, p.after] for p in sorted(
        patch, key=lambda p: p.path)])


def signals(objective: dict[str, Any],
            params: dict[str, Any] | None = None) -> dict[str, bool]:
    """Which parts of the service this generation actually exercised.

    Without this a check-in cycle produces proposals about ride detours: the
    dimension matches, the dial exists, and the change is completely ungrounded
    in anything that happened. A mechanism may only fire for machinery the run
    actually used.
    """
    attempts = list(objective.values())

    def total(*path: str) -> float:
        out = 0.0
        for row in attempts:
            node: Any = row
            for key in path:
                node = (node or {}).get(key) if isinstance(node, dict) else None
            if isinstance(node, (int, float)):
                out += float(node)
        return out

    transport_needs = total("transport", "needsRaised")
    disclosure_fields = sum(
        int((v or {}).get("fieldCount") or 0)
        for row in attempts for v in (row.get("disclosure") or {}).values())
    contacts_per_actor = [
        int((row.get("residentBurden") or {}).get(actor, {}).get("contactsReceived") or 0)
        for row in attempts for actor in (row.get("residentBurden") or {})]
    busiest = max(contacts_per_actor, default=0)
    cap = int((params or {}).get("helperContactCap") or 0)
    return {
        "contact": total("contacts", "attempts") > 0,
        "transport": transport_needs > 0,
        "rideShortfall": total("transport", "ridesCompleted") < transport_needs,
        "rideConflicts": total("transport", "conflictsDetected") > 0,
        "disclosure": disclosure_fields > 0,
        "institution": total("institutionBurden", "staffMinutes") > 0,
        # A cap nobody reached did not cause anybody's burden, and a quiet window
        # matters only where somebody was actually contacted twice. Proposing
        # either without the signal would be changing a dial for its own sake.
        "capBinding": bool(cap) and busiest >= cap,
        "repeatContacts": busiest >= 2,
    }


@dataclass
class Mechanism:
    key: str
    dimension: D
    label: str
    mechanism: str
    build: Callable[[dict[str, Any], dict[str, Any], IssueGroup], list[PatchOp] | None]
    expected: list[str]
    regressions: list[str]
    #: Engine features the change needs. Empty means "the engine already reads
    #: this condition"; anything listed goes through the capability check and,
    #: if unsupported, becomes a design suggestion instead of a run.
    capabilities: tuple[str, ...] = ()
    priority: int = 50
    #: Signal keys from :func:`signals` that must all be true. A mechanism about
    #: machinery this cycle never touched is not a proposal, it is noise.
    requires: tuple[str, ...] = ()


def _p(path: str, before: Any, after: Any) -> PatchOp:
    return PatchOp(op="replace", path=path, before=before, after=after)


# ------------------------------------------------------------------ mechanisms
def _escalation_deadline(params, policy, issue):
    if params.get("escalateToInstitutionAfterMin") is not None:
        return None
    return [_p("/params/escalateToInstitutionAfterMin", None, 90)]


def _shorten_deadline(params, policy, issue):
    current = params.get("escalateToInstitutionAfterMin")
    if current is None or current <= 45:
        return None
    return [_p("/params/escalateToInstitutionAfterMin", current, max(45, current // 2))]


def _retry_once_more(params, policy, issue):
    current = int(params.get("retryCount") or 0)
    if current >= 3:
        return None
    return [_p("/params/retryCount", current, current + 1)]


def _spread_helper_load(params, policy, issue):
    current = int(params.get("helperContactCap") or 0)
    if current <= 1:
        return None
    return [_p("/params/helperContactCap", current, current - 1)]


def _longer_quiet_window(params, policy, issue):
    quiet = int(params.get("quietWindowMin") or 0)
    interval = int(params.get("retryIntervalMin") or 40)
    target = min(240, max(interval + 20, quiet + 30))
    if quiet >= target:
        return None
    return [_p("/params/quietWindowMin", quiet, target)]


def _minimise_disclosure(params, policy, issue):
    if params.get("disclosure") != "named":
        return None
    return [_p("/params/disclosure", "named", "minimal")]


def _restore_neighbour_route(params, policy, issue):
    """Bring the village head back into the loop when nobody else could close it."""
    if policy.get("contactStrategy") != "retry_then_clinic":
        return None
    ops = [_p("/contactStrategy", "retry_then_clinic", "head_first")]
    if not params.get("allowHeadContact"):
        # head_first without this is an incoherent policy and the engine refuses
        # it, so the two fields move together or not at all.
        ops.append(_p("/params/allowHeadContact", params.get("allowHeadContact"), True))
    return ops


def _shift_to_institution(params, policy, issue):
    """Take the check-in off the neighbours and put it on the institution."""
    if policy.get("contactStrategy") != "head_first":
        return None
    return [_p("/contactStrategy", "head_first", "retry_then_clinic"),
            _p("/params/retryCount", int(params.get("retryCount") or 0),
               max(1, int(params.get("retryCount") or 0) + 1))]


def _tighten_detour(params, policy, issue):
    current = int(params.get("maxRideDetourMin") or 0)
    if current <= 2:
        return None
    return [_p("/params/maxRideDetourMin", current, max(2, current // 2))]


def _loosen_detour(params, policy, issue):
    current = int(params.get("maxRideDetourMin") or 0)
    if current >= 60:
        return None
    return [_p("/params/maxRideDetourMin", current, min(60, max(10, current * 2)))]


def _flip_ride_order(params, policy, issue):
    current = params.get("rideCandidateOrder")
    other = "closest_first" if current == "kin_first" else "kin_first"
    return [_p("/params/rideCandidateOrder", current, other)]


MECHANISMS: tuple[Mechanism, ...] = (
    Mechanism(
        key="escalation_deadline", dimension=D.help_resolution,
        label="미해결 건에 기관 인계 기한(90분)을 둔다",
        mechanism=("아무도 갈 수 없어 닫히지 못한 요청이 기한 뒤 기관으로 넘어가게 한다. "
                   "인계는 해결이 아니라 담당자 이전이다."),
        build=_escalation_deadline,
        expected=["미해결로 끝나는 건이 줄어든다", "닫히기까지의 대기가 기한 이내로 상한이 생긴다"],
        regressions=["보건소 담당자의 업무 시간과 대기열이 늘어난다",
                     "근무 종료 직전에 넘어간 건은 그대로 다음 날로 밀린다"],
        priority=10, requires=("contact",)),
    Mechanism(
        key="shorten_deadline", dimension=D.help_resolution,
        label="인계 기한을 절반으로 줄인다",
        mechanism="기한이 길어 대기가 길다면 같은 절차를 더 이르게 발동시킨다.",
        build=_shorten_deadline,
        expected=["해결까지의 대기가 줄어든다"],
        regressions=["이웃이 해결할 수 있었을 건까지 기관으로 넘어간다",
                     "기관 업무량이 늘어난다"],
        priority=20, requires=("contact",)),
    Mechanism(
        key="retry_once_more", dimension=D.help_resolution,
        label="본인에게 다시 연락하는 횟수를 한 번 늘린다",
        mechanism="응답이 없는 시각을 피해 한 번 더 닿아 보면 본인 확인으로 닫힐 수 있다.",
        build=_retry_once_more,
        expected=["본인 응답으로 닫히는 건이 늘 수 있다"],
        regressions=["연락을 받는 사람의 방해가 늘어난다", "해결이 더 늦어질 수 있다"],
        priority=30, requires=("contact",)),
    Mechanism(
        key="restore_neighbour_route", dimension=D.help_resolution,
        label="이장 확인 경로를 다시 사용한다",
        mechanism="기관만으로 닫히지 않는 건을 마을 안에서 먼저 확인한다.",
        build=_restore_neighbour_route,
        expected=["기관에 도착하기 전에 닫히는 건이 생긴다"],
        regressions=["이장 한 사람의 시간이 다시 늘어난다",
                     "이웃에게 상황이 알려지는 범위가 넓어진다"],
        priority=40, requires=("contact",)),
    Mechanism(
        key="shift_to_institution", dimension=D.time_labour,
        label="이웃 대신 본인 재연락 후 기관으로 넘긴다",
        mechanism=("이웃의 시간을 먼저 쓰지 않고, 본인에게 다시 연락한 뒤 기관에 넘긴다. "
                   "부담을 없애는 것이 아니라 누구의 시간을 쓸지 바꾸는 것이다."),
        build=_shift_to_institution,
        expected=["이웃이 쓰는 시간이 줄어든다"],
        regressions=["보건소 담당자의 업무 시간이 늘어난다",
                     "확인까지의 대기가 길어진다",
                     "기관에 전달되는 정보 항목이 늘어난다"],
        priority=12, requires=("contact",)),
    Mechanism(
        key="spread_helper_load", dimension=D.time_labour,
        label="한 사람이 하루에 받는 조율 연락 상한을 낮춘다",
        mechanism="같은 사람에게 요청이 반복 배정되는 것을 상한으로 막는다.",
        build=_spread_helper_load,
        expected=["한 사람에게 몰리는 시간이 줄어든다"],
        regressions=["부탁할 사람이 줄어 미해결이나 기관 인계가 늘어난다"],
        priority=15, requires=("contact", "capBinding")),
    Mechanism(
        key="longer_quiet_window", dimension=D.time_labour,
        label="같은 사람에게 다시 연락하기까지의 최소 간격을 늘린다",
        mechanism="짧은 간격의 반복 연락을 막는다.",
        build=_longer_quiet_window,
        expected=["하루에 받는 연락 횟수가 줄어든다"],
        regressions=["확인이 늦어져 대기가 길어진다"],
        priority=25, requires=("contact", "repeatContacts")),
    Mechanism(
        key="minimise_disclosure", dimension=D.disclosure,
        label="공개 범위를 최소로 되돌린다",
        mechanism="'응답 없음' 외의 항목을 넘기지 않는다.",
        build=_minimise_disclosure,
        expected=["전달되는 항목 수가 줄어든다"],
        regressions=["기관이 전화로 확인할 수 없어 방문이 늘고 업무 시간이 늘어난다"],
        priority=35, requires=("disclosure",)),
    Mechanism(
        key="tighten_detour", dimension=D.time_labour,
        label="운전자에게 허용하는 추가 우회 시간을 줄인다",
        mechanism="이미 자기 일정이 있는 운전자에게 큰 우회를 요구하지 않는다.",
        build=_tighten_detour,
        expected=["운전자의 추가 이동 시간이 줄어든다", "이중 예약 충돌이 줄어들 수 있다"],
        regressions=["태워 줄 수 있는 사람이 줄어 이동이 필요한 사람의 대기가 늘어난다"],
        priority=18, requires=("transport", "rideConflicts")),
    Mechanism(
        key="loosen_detour", dimension=D.help_resolution,
        label="허용 우회 시간을 늘려 후보를 넓힌다",
        mechanism="우회 상한 때문에 아무도 태우지 못했다면 상한을 올려 후보를 넓힌다.",
        build=_loosen_detour,
        expected=["이동 요청이 성사될 가능성이 늘어난다"],
        regressions=["운전자의 추가 이동 시간이 늘어난다"],
        priority=28, requires=("transport", "rideShortfall")),
    Mechanism(
        key="flip_ride_order", dimension=D.choice_refusal,
        label="이동 후보 순서를 바꾼다",
        mechanism=("본인이 지목한 사람을 먼저 묻는 순서와 동선이 겹치는 사람을 먼저 묻는 "
                   "순서 중 다른 쪽을 시험한다."),
        build=_flip_ride_order,
        expected=["누구에게 먼저 묻는지가 바뀐다"],
        regressions=["본인이 원하지 않는 사람에게 먼저 부탁이 갈 수 있다",
                     "우회 시간이 늘어날 수 있다"],
        priority=45, requires=("transport",)),
)

#: Changes that would need engine work. They are recorded as design suggestions
#: and never executed - doc 12 section 7 asks for exactly this split.
UNSUPPORTED_SUGGESTIONS: tuple[tuple[str, D, str, str, tuple[str, ...]], ...] = (
    ("advance_availability_check", D.choice_refusal,
     "부탁하기 전에 가능한 시간을 먼저 확인하는 절차",
     "운전자에게 '언제면 가능한가'를 먼저 묻고 그 시간대로 배정한다. "
     "현재 엔진에는 사전 가능 시간 확인 절차가 없다.",
     ("transport.availability_probe",)),
    ("progress_callback", D.understandability,
     "당사자에게 진행 상황을 되돌려 주는 절차",
     "요청이 어떻게 마무리됐는지 당사자에게 한 번 알린다. "
     "현재 엔진에는 종료 통지 단계가 없다.",
     ("notify.closure",)),
    ("institution_call_before_visit", D.time_labour,
     "방문 전에 전화로 먼저 확인하는 절차를 정책으로 고정",
     "이동 시간을 줄이기 위해 방문 전 통화를 의무화한다. "
     "현재는 공개된 일과로 통화 시각을 고르는 규칙만 있고 정책 조건이 아니다.",
     ("institution.call_first_policy",)),
)

#: What the engine can actually execute today.
SUPPORTED_CAPABILITIES = (
    "contact.retry", "contact.quiet_window", "contact.helper_cap",
    "disclosure.level", "escalation.deadline", "strategy.head_first",
    "strategy.retry_then_clinic", "transport.candidate_order",
    "transport.detour_limit",
)


class RuleImprovementAdapter:
    """Deterministic proposals from a stated mechanism table.

    Deterministic is not the same as pre-scripted: which mechanism fires depends
    on what the reviews said and what the current policy already is, and nothing
    consults the generation index. A cycle that produced no issues produces no
    proposals.
    """

    name = "rule"

    def propose(self, *, synthesis: ReviewSynthesis, policy: dict[str, Any],
                allowed_paths: list[str], capabilities: list[str],
                criteria: list[dict[str, Any]], core_item: str,
                max_candidates: int, session_id: str, generation_index: int,
                created_at: str, id_prefix: str,
                already_tried: list[str]) -> tuple[list[ChangeProposal], str | None]:
        params = dict(policy.get("params") or {})
        active = signals(synthesis.objectiveMetrics, params)
        tried = set(already_tried)
        by_dimension: dict[str, list[IssueGroup]] = {}
        for issue in synthesis.issueGroups:
            by_dimension.setdefault(issue.dimension.value, []).append(issue)

        severity_rank = {"blocking": 0, "significant": 1, "minor": 2, "unknown": 3}
        ordered = sorted(
            (m for m in MECHANISMS
             if m.dimension.value in by_dimension
             and all(active.get(flag) for flag in m.requires)),
            key=lambda m: (severity_rank[min(
                (i.severity for i in by_dimension[m.dimension.value]),
                key=lambda s: severity_rank[s])], m.priority))

        proposals: list[ChangeProposal] = []
        seen_paths: set[str] = set()
        seen_dimensions: set[str] = set()
        skipped_repeat = 0

        for mech in ordered:
            if len(proposals) >= max_candidates:
                break
            # One candidate per dimension. Two dials aimed at the same complaint
            # tell the designer less than one dial each at the two biggest ones,
            # and the second is usually the same experiment twice.
            if mech.dimension.value in seen_dimensions:
                continue
            issue = sorted(by_dimension[mech.dimension.value],
                           key=lambda i: severity_rank[i.severity])[0]
            patch = mech.build(params, policy, issue)
            if not patch:
                continue
            if any(op.path in seen_paths for op in patch):
                # Two candidates that move the same dial are not two candidates.
                continue
            digest = patch_hash(patch)
            if digest in tried:
                skipped_repeat += 1
                continue
            unsupported = [c for c in mech.capabilities if c not in capabilities]
            proposals.append(ChangeProposal(
                id="%s-%d" % (id_prefix, len(proposals) + 1),
                sessionId=session_id, generationIndex=generation_index,
                baseRevisionId=policy["id"], label=mech.label,
                reviewItemRefs=issue.reviewItemRefs[:8],
                issueRefs=[issue.id], mechanism=mech.mechanism,
                patch=patch, expectedEffects=list(mech.expected),
                possibleRegressions=list(mech.regressions),
                assumptionRefs=list(issue.alternativeExplanations),
                affectedActors=sorted(set(issue.affectedActors)
                                      | set(issue.dissentingActors)
                                      | ({HEALTH_STAFF} if "기관" in " ".join(mech.regressions)
                                         else set())),
                requiredCapabilities=unsupported,
                watchNext=list(issue.objectiveMetricRefs) + [
                    "%s 차원의 리뷰가 어떻게 바뀌는지" % mech.dimension.value],
                adapter="rule", createdAt=created_at, patchHash=digest))
            seen_paths.update(op.path for op in patch)
            seen_dimensions.add(mech.dimension.value)

        suggestions = self._suggestions(synthesis, by_dimension, capabilities,
                                        session_id, generation_index, created_at,
                                        id_prefix, len(proposals))
        if not proposals:
            if skipped_repeat:
                reason = ("허용 범위 안에 남은 변경이 이미 시도한 것과 같다. "
                          "같은 patch를 되풀이하지 않는다.")
            elif not synthesis.issueGroups:
                reason = "이번 Cycle의 리뷰에서 정책으로 대응할 문제가 나오지 않았다."
            else:
                reason = ("문제는 있지만 허용된 정책 조건으로 바꿀 수 있는 것이 남아 있지 않다. "
                          "남은 것은 구현이 필요한 절차 변경이다."
                          if suggestions else
                          "허용된 정책 조건 중 더 바꿀 수 있는 값이 없다.")
            return suggestions, reason
        return proposals + suggestions, None

    def _suggestions(self, synthesis: ReviewSynthesis,
                     by_dimension: dict[str, list[IssueGroup]],
                     capabilities: list[str], session_id: str, generation_index: int,
                     created_at: str, id_prefix: str, offset: int) -> list[ChangeProposal]:
        """Design suggestions that the engine cannot run.

        Recorded, shown, and never executed. Writing them down is the honest
        alternative to silently shrinking the design space to whatever happens to
        be implemented.
        """
        out: list[ChangeProposal] = []
        for key, dimension, label, mechanism, needs in UNSUPPORTED_SUGGESTIONS:
            issues = by_dimension.get(dimension.value)
            if not issues:
                continue
            if all(c in capabilities for c in needs):
                continue
            issue = issues[0]
            out.append(ChangeProposal(
                id="%s-req-%s" % (id_prefix, key),
                sessionId=session_id, generationIndex=generation_index,
                baseRevisionId="", label=label,
                reviewItemRefs=issue.reviewItemRefs[:6], issueRefs=[issue.id],
                mechanism=mechanism, patch=[],
                expectedEffects=["구현되면 %s 차원의 문제에 직접 대응한다" % dimension.value],
                possibleRegressions=["구현 전에는 효과를 확인할 수 없다"],
                affectedActors=list(issue.affectedActors),
                requiredCapabilities=list(needs),
                watchNext=[], adapter="rule", createdAt=created_at,
                validationStatus="requires_implementation",  # type: ignore[arg-type]
                selectionStatus="not_run",  # type: ignore[arg-type]
                validationErrors=["엔진이 지원하지 않는 절차다. 자동 실행하지 않는다."]))
        return out
