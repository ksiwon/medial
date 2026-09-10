"""The wall between "a proposal was made" and "a proposal will run".

Everything here is code. A proposal is not accepted because the model said it was
safe, and it is not accepted because the rule adapter produced it - both go
through the same checks.

What may change is MEDial's operating policy and the service procedures the
engine actually implements. What may never change through this path:

* personas, interview evidence, initial memories - the model of the people;
* the scenario deck, the exogenous events and their difficulty;
* the evaluation criteria and their direction;
* the world (roads, distances, who is where) and the resource revision
  (staff count, vehicles, seats);
* anything the engine has no handler for.

The last one is not a refusal to think about it: an unsupported change is kept as
a design suggestion with ``requires_implementation`` so that the design space
does not silently shrink to whatever happens to be coded.
"""
from __future__ import annotations

from typing import Any

from ..contracts import ContactStrategy, PolicyParams
from .contracts import ChangeProposal, ProposalValidation
from .improvement import SUPPORTED_CAPABILITIES, patch_hash

#: Paths that name something which is *not* MEDial's operating policy. Matched by
#: prefix and reported with the reason, so a rejection says which boundary was
#: crossed rather than "invalid path".
FORBIDDEN_PREFIXES: tuple[tuple[str, str], ...] = (
    ("/persona", "페르소나와 인터뷰 근거는 정책 patch로 바꿀 수 없다. 사람 모델을 고쳐 "
                 "좋은 리뷰를 만드는 경로를 막는다."),
    ("/evidence", "근거 카드는 원자료의 투영이다. 실행 중에 편집할 수 없다."),
    ("/memory", "초기 기억은 세대 간 통제 조건이다. 정책 patch로 바꿀 수 없다."),
    ("/initialMemory", "초기 기억은 세대 간 통제 조건이다."),
    ("/deck", "시나리오 deck과 외생 사건의 난도는 평가 대상이지 조정 대상이 아니다."),
    ("/scenario", "외생 사건은 정책 patch로 바꿀 수 없다."),
    ("/world", "도로·거리·누가 어디 있는지는 세계 사실이다."),
    ("/village", "마을 데이터는 정책이 아니다."),
    ("/criteria", "평가 기준과 방향은 iteration 시작 시 고정된다. 바꾸려면 새 session이다."),
    ("/rubric", "평가 rubric은 정책 patch로 바꿀 수 없다."),
    ("/resources", "인력·차량·좌석 증원은 별도 ResourceRevision이며 policy-only 비교에서 "
                   "분리한다."),
    ("/staffCount", "인력 증원은 정책 조건이 아니다."),
    ("/seat", "좌석 수는 자원 가정이다."),
    ("/metrics", "지표 값은 결과다. 바꾸는 대상이 아니다."),
    ("/reviews", "리뷰는 산출물이다. 바꾸는 대상이 아니다."),
)

#: Fields the engine reads, with their editable path.
_PARAM_PATHS = {"/params/%s" % name: name for name in PolicyParams.SUPPORTED}
STRATEGY_PATH = "/contactStrategy"


class PatchRejected(ValueError):
    """A proposal did not pass. The reasons are kept and shown."""


def default_allowed_paths() -> list[str]:
    return [STRATEGY_PATH] + sorted(_PARAM_PATHS)


def _field_spec() -> dict[str, dict[str, Any]]:
    schema = PolicyParams.model_json_schema()
    out: dict[str, dict[str, Any]] = {}
    for name in PolicyParams.SUPPORTED:
        spec = schema["properties"].get(name, {})
        branch = spec
        nullable = False
        if "anyOf" in spec:
            options = [b for b in spec["anyOf"] if b.get("type") != "null"]
            nullable = len(options) != len(spec["anyOf"])
            branch = options[0] if options else {}
        out[name] = {
            "type": branch.get("type") or spec.get("type"),
            "nullable": nullable,
            "minimum": branch.get("minimum"),
            "maximum": branch.get("maximum"),
            "enum": branch.get("enum"),
        }
    return out


FIELD_SPEC = _field_spec()


def _current_value(policy: dict[str, Any], path: str) -> Any:
    if path == STRATEGY_PATH:
        return policy.get("contactStrategy")
    name = _PARAM_PATHS.get(path)
    if name is None:
        raise PatchRejected("알 수 없는 경로: %s" % path)
    return (policy.get("params") or {}).get(name)


def _check_value(path: str, value: Any) -> list[str]:
    if path == STRATEGY_PATH:
        allowed = [s.value for s in ContactStrategy]
        if value not in allowed:
            return ["%s 값 %r 은(는) %s 중 하나여야 한다" % (path, value, allowed)]
        return []
    name = _PARAM_PATHS[path]
    spec = FIELD_SPEC[name]
    errors: list[str] = []
    if value is None:
        if not spec["nullable"]:
            return ["%s 은(는) 비울 수 없다" % path]
        return []
    expected = spec["type"]
    if expected == "integer" and (isinstance(value, bool) or not isinstance(value, int)):
        errors.append("%s 은(는) 정수여야 한다 (받은 값: %r)" % (path, value))
    elif expected == "boolean" and not isinstance(value, bool):
        errors.append("%s 은(는) true/false 여야 한다 (받은 값: %r)" % (path, value))
    elif expected == "string" and not isinstance(value, str):
        errors.append("%s 은(는) 문자열이어야 한다 (받은 값: %r)" % (path, value))
    if spec["enum"] and value not in spec["enum"]:
        errors.append("%s 값 %r 은(는) %s 중 하나여야 한다" % (path, value, spec["enum"]))
    if isinstance(value, int) and not isinstance(value, bool):
        if spec["minimum"] is not None and value < spec["minimum"]:
            errors.append("%s 은(는) %s 이상이어야 한다" % (path, spec["minimum"]))
        if spec["maximum"] is not None and value > spec["maximum"]:
            errors.append("%s 은(는) %s 이하여야 한다" % (path, spec["maximum"]))
    return errors


def patch_to_changes(policy: dict[str, Any],
                     patch: list[Any]) -> dict[str, Any]:
    """Turn a validated patch into the edit the policy service already accepts."""
    params = dict(policy.get("params") or {})
    changes: dict[str, Any] = {"params": {}}
    for op in patch:
        if op.path == STRATEGY_PATH:
            changes["contactStrategy"] = op.after
        else:
            changes["params"][_PARAM_PATHS[op.path]] = op.after
    # Keep the untouched fields explicit so the resulting revision is a complete
    # statement of the conditions it ran under.
    for name, value in params.items():
        changes["params"].setdefault(name, value)
    return changes


def validate_proposal(proposal: ChangeProposal, *, policy: dict[str, Any],
                      allowed_paths: list[str],
                      capabilities: tuple[str, ...] = SUPPORTED_CAPABILITIES,
                      known_review_items: set[str] | None = None,
                      world_truth_event_ids: set[str] | None = None,
                      applied_patch_hashes: set[str] | None = None) -> ChangeProposal:
    """Decide what happens to one proposal, and say why.

    Returns a copy with ``validationStatus`` and ``validationErrors`` filled in.
    Nothing is executed here.
    """
    errors: list[str] = []
    status = ProposalValidation.valid

    unsupported = [c for c in proposal.requiredCapabilities if c not in capabilities]
    if unsupported:
        return proposal.model_copy(update={
            "validationStatus": ProposalValidation.requires_implementation,
            "validationErrors": [
                "엔진이 지원하지 않는 기능이 필요하다: %s. 설계 제안으로 남기고 실행하지 않는다."
                % ", ".join(unsupported)],
            "selectionStatus": proposal.selectionStatus,
        })

    if not proposal.patch:
        return proposal.model_copy(update={
            "validationStatus": ProposalValidation.requires_implementation,
            "validationErrors": ["실행할 수 있는 정책 변경이 없다. 설계 제안으로만 남긴다."],
        })

    if proposal.baseRevisionId and proposal.baseRevisionId != policy.get("id"):
        errors.append(
            "제안이 기준한 revision(%s)이 현재 정책(%s)과 다르다. 그 사이에 정책이 바뀌었다."
            % (proposal.baseRevisionId, policy.get("id")))

    if not proposal.reviewItemRefs:
        errors.append("어떤 리뷰 항목을 해결하려는지 적혀 있지 않다. 리뷰 기반 변경이 아니다.")
    elif known_review_items is not None:
        unknown = [r for r in proposal.reviewItemRefs if r not in known_review_items]
        if unknown:
            errors.append("존재하지 않는 리뷰 항목을 참조한다: %s" % unknown[:4])

    if world_truth_event_ids:
        leaked = [e for e in proposal.issueRefs if e in world_truth_event_ids]
        if leaked:
            errors.append(
                "세계 진실 사건을 근거로 삼았다: %s. 개선 에이전트는 관측되지 않은 사실을 "
                "정책에 넣을 수 없다." % leaked[:4])

    seen: set[str] = set()
    for op in proposal.patch:
        if op.op != "replace":
            errors.append("지원하지 않는 연산: %s" % op.op)
            continue
        forbidden = next((msg for prefix, msg in FORBIDDEN_PREFIXES
                          if op.path.startswith(prefix)), None)
        if forbidden is not None:
            errors.append("%s: %s" % (op.path, forbidden))
            continue
        if op.path not in allowed_paths:
            errors.append(
                "%s 은(는) 이 session에서 허용한 수정 경로가 아니다. 허용: %s"
                % (op.path, ", ".join(allowed_paths)))
            continue
        if op.path in seen:
            errors.append("같은 경로를 두 번 바꾼다: %s" % op.path)
        seen.add(op.path)

        actual = _current_value(policy, op.path)
        if op.before != actual:
            errors.append(
                "%s 의 변경 전 값이 실제와 다르다 (제안: %r, 현재: %r). "
                "오래된 revision을 기준으로 쓴 제안이다." % (op.path, op.before, actual))
        if op.before == op.after:
            errors.append("%s 은(는) 바뀌는 것이 없다" % op.path)
        errors.extend(_check_value(op.path, op.after))

    if not errors:
        errors.extend(_coherence(policy, proposal.patch))

    digest = patch_hash(proposal.patch)
    if applied_patch_hashes and digest in applied_patch_hashes:
        errors.append("이미 적용한 것과 같은 patch다. 같은 변경을 반복하지 않는다.")

    if errors:
        status = ProposalValidation.rejected
    return proposal.model_copy(update={
        "validationStatus": status,
        "validationErrors": errors,
        "patchHash": digest,
    })


def _coherence(policy: dict[str, Any], patch: list[Any]) -> list[str]:
    """Would the patched policy be a policy the engine can run at all?

    ``head_first`` with ``allowHeadContact`` off is the concrete case: the engine
    raises on it, and a candidate that crashes the run is not a candidate.
    """
    merged_params = dict(policy.get("params") or {})
    strategy = policy.get("contactStrategy")
    for op in patch:
        if op.path == STRATEGY_PATH:
            strategy = op.after
        else:
            merged_params[_PARAM_PATHS[op.path]] = op.after

    errors: list[str] = []
    try:
        PolicyParams.model_validate(merged_params)
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        errors.append("정책 조건 검증 실패: %s" % exc)
    if strategy == ContactStrategy.head_first.value and not merged_params.get(
            "allowHeadContact"):
        errors.append(
            "head_first 전략은 allowHeadContact 를 끌 수 없다. 엔진이 실행을 거부한다.")
    return errors
