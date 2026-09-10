"""Application service: run, rerun, fork, replay, compare, record a finding.

Play / pause / step / seek operate on a persisted replay cursor over a finished
log. The run itself is computed once, when the attempt is created, because the
rule and scripted adapters are deterministic and a whole day takes milliseconds.
Seeking therefore cannot invoke an adapter, which is the property doc 06 asks
for rather than something we have to remember to honour.

Identity and immutability
-------------------------
Attempt ids are UUID-based. They used to come from ``itertools.count(1)``, which
restarted at 1 on every boot, and the store then overwrote the previous run that
had the same id. A research record that silently changes is worse than a missing
one, so ids are unique across restarts and the store refuses to write an id
twice (:class:`AttemptExists`) instead of replacing.

Rerun and fork
--------------
Both are branches, and they mean different things:

* :meth:`rerun_attempt` - same initial state, edited policy, the whole day runs
  again. ``parentSeq`` stays empty because nothing was carried over.
* :meth:`fork_attempt` - the parent's rules run to ``atSeq`` and the new policy
  takes over from there. The prefix is compared against the parent's stored log
  event by event, and a mismatch aborts the fork rather than storing something
  that only claims to be a branch.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Any

from .contracts import (
    AttemptLineage,
    ContactStrategy,
    DesignFinding,
    PolicyParams,
    PolicyRevision,
)
from .decks.registry import DECK_DEFAULTS, DECKS, POLICIES, RESOURCE_SETS
from .metrics import compare as compare_runs
from .persistence.store import Store
from .runner import catalog, log_fingerprint, log_rows, run_attempt, stored_log_rows
from .village import Village, load_village


class UnsupportedPolicyField(ValueError):
    """An edit named a condition the engine does not read.

    Rejected rather than stored: a condition that appears on screen and changes
    nothing teaches the researcher that it does not matter.
    """


class ForkPrefixMismatch(RuntimeError):
    """The fork did not reproduce its parent's log up to the checkpoint."""


def _short_id() -> str:
    return uuid.uuid4().hex[:12]


class SimulationService:
    def __init__(self, store: Store | None = None, village: Village | None = None,
                 persona_path: str | None = None) -> None:
        self.store = store or Store()
        self.village = village or load_village()
        self.persona_path = persona_path
        self.policies: dict[str, PolicyRevision] = dict(POLICIES)
        self._runs: dict[str, Any] = {}
        self._restore_policies()

    def _restore_policies(self) -> None:
        for row in self.store.list_policies():
            policy = PolicyRevision.model_validate(row)
            self.policies.setdefault(policy.id, policy)
        for row in self.store.list_attempts():
            policy = PolicyRevision.model_validate(row["policy"])
            self.policies.setdefault(policy.id, policy)

    # -- catalogue -------------------------------------------------------
    def catalog(self) -> dict[str, Any]:
        data = catalog()
        data["policies"] = [p.model_dump(mode="json") for p in self.policies.values()]
        data["attempts"] = [r["attempt"] for r in self.store.list_attempts()]
        data["findings"] = self.store.list_findings()
        return data

    def village_payload(self) -> dict[str, Any]:
        v = self.village
        return {
            "dataSource": v.data_source,
            "isSynthetic": v.is_synthetic,
            "contentHash": v.content_hash,
            "geometry": v.geometry,
            "travel": v.travel,
            "places": v.places,
            "homes": v.homes,
            "roads": v.roads,
            "patrol": v.patrol,
            "groups": v.groups,
            "residents": [
                {"id": r["id"], "displayName": r["displayName"],
                 "isVillageHead": r["isVillageHead"], "group": r["group"],
                 "age": r["age"], "job": r["job"], "pinnedAtHome": r["pinnedAtHome"],
                 "home": {"x": r["home"]["x"], "y": r["home"]["y"]},
                 "overlayCount": len(r["plan"]["overlay"])}
                for r in v.residents
            ],
            "dataIssues": v.data_issues,
            "roadGraphProvenance": v.road_graph_provenance,
            "namedRouteDistances": v.named_route_distances,
            # The source's own map, placed with the same rotation the
            # coordinates went through. Absent for the synthetic fixture, and
            # the screen says so instead of drawing an invented coastline.
            "mapImage": (dict(v.map_image, available=v.map_image_path() is not None)
                         if v.map_image else None),
        }

    def personas_payload(self) -> dict[str, Any]:
        """Compiled personas and their evidence cards.

        Names, quotes and the role-play prompt are not in the compiled profile,
        so this is safe to serve to the browser; the raw pack never leaves the
        local file.
        """
        from .runner import personas as compiled

        profiles, provenance = compiled(self.persona_path)
        return {
            "provenance": provenance,
            "profiles": [p.model_dump(mode="json") for p in profiles.values()],
        }

    # -- policy editing ----------------------------------------------------
    def create_policy(self, base_id: str, changes: dict[str, Any], reason: str,
                      label: str | None = None) -> PolicyRevision:
        """A policy edit is a new revision, never a mutation of the old one."""
        if base_id not in self.policies:
            raise KeyError("unknown policy %s" % base_id)
        base = self.policies[base_id]

        params_in = dict(changes.get("params") or {})
        unsupported = sorted(set(params_in) - set(PolicyParams.SUPPORTED))
        if unsupported:
            raise UnsupportedPolicyField(
                "이 조건은 엔진이 읽지 않으므로 저장하지 않는다: %s (지원: %s)"
                % (", ".join(unsupported), ", ".join(PolicyParams.SUPPORTED)))

        merged = base.params.model_dump()
        merged.update(params_in)
        params = PolicyParams.model_validate(merged)

        strategy = changes.get("contactStrategy") or base.contactStrategy
        if isinstance(strategy, str):
            strategy = ContactStrategy(strategy)

        before = base.params.model_dump()
        diffs = ["%s: %r → %r" % (k, before[k], getattr(params, k))
                 for k in PolicyParams.SUPPORTED if before[k] != getattr(params, k)]
        if strategy != base.contactStrategy:
            diffs.insert(0, "contactStrategy: %s → %s"
                         % (base.contactStrategy.value, strategy.value))

        revision = PolicyRevision(
            id="%s-r%s" % (base.id, _short_id()),
            parentId=base.id,
            coreItem=changes.get("coreItem", base.coreItem),
            label=label or changes.get("label") or (base.label + " (수정)"),
            # Both halves are stored: why the researcher changed it, and what
            # actually changed. The second is computed, not typed.
            changes=[reason] + diffs,
            contactStrategy=strategy,
            params=params,
            assumptionRefs=base.assumptionRefs,
        )
        self.policies[revision.id] = revision
        self.store.save_policy(revision)
        return revision

    def list_policies(self) -> list[dict[str, Any]]:
        return [p.model_dump(mode="json") for p in self.policies.values()]

    # -- attempts ---------------------------------------------------------
    def create_attempt(self, policy_id: str, deck_id: str, resource_id: str,
                       label: str | None = None, seed: int = 17,
                       adapter: str = "rule") -> dict[str, Any]:
        if policy_id not in self.policies:
            raise KeyError("unknown policy %s" % policy_id)
        attempt_id = "att-%s-%s" % (policy_id.replace("policy-", "")[:16], _short_id())
        return self._execute(attempt_id, policy_id, deck_id, resource_id, label, seed,
                             adapter, lineage=AttemptLineage.root)

    def rerun_attempt(self, attempt_id: str, changes: dict[str, Any], reason: str,
                      label: str | None = None) -> dict[str, Any]:
        """Same initial state, edited policy, the day runs again from the start.

        This is the honest name for what the tool used to call a fork. Nothing
        is carried over from the parent run, so ``parentSeq`` stays empty.
        """
        parent = self.store.get_attempt(attempt_id)
        if parent is None:
            raise KeyError("unknown attempt %s" % attempt_id)
        base = PolicyRevision.model_validate(parent["policy"])
        self.policies.setdefault(base.id, base)
        revision = self.create_policy(base.id, changes, reason,
                                      label=changes.get("label"))
        new_id = "att-rerun-%s" % _short_id()
        return self._execute(new_id, revision.id, parent["attempt"]["scenarioDeckId"],
                             parent["attempt"]["resourceRevisionId"],
                             label or revision.label, parent["attempt"]["seed"],
                             parent["attempt"]["adapter"],
                             parent_id=attempt_id,
                             lineage=AttemptLineage.rerun)

    def fork_attempt(self, attempt_id: str, at_seq: int, changes: dict[str, Any],
                     reason: str, label: str | None = None) -> dict[str, Any]:
        """Branch at a point in the parent's log and change the policy there.

        Everything before ``at_seq`` is the parent's run: same state, same
        memories, same reservations, same log prefix. That is verified against
        the stored parent log before anything is saved, so "forked at event 22"
        is a checked claim rather than a label.
        """
        parent = self.store.get_attempt(attempt_id)
        if parent is None:
            raise KeyError("unknown attempt %s" % attempt_id)
        count = int(parent["attempt"]["eventCount"])
        at_seq = max(1, min(count, int(at_seq)))

        base = PolicyRevision.model_validate(parent["policy"])
        self.policies.setdefault(base.id, base)
        revision = self.create_policy(base.id, changes, reason,
                                      label=changes.get("label"))

        new_id = "att-fork-%s" % _short_id()
        result = self._run(new_id, revision.id, parent["attempt"]["scenarioDeckId"],
                           parent["attempt"]["resourceRevisionId"],
                           label or revision.label, parent["attempt"]["seed"],
                           parent["attempt"]["adapter"],
                           parent_id=attempt_id, parent_seq=at_seq,
                           lineage=AttemptLineage.fork,
                           policy_switch={"afterSeq": at_seq, "policy": revision})

        self._verify_fork_prefix(attempt_id, result, at_seq)
        return self._store_and_return(result, self.policies[revision.id])

    def _verify_fork_prefix(self, parent_id: str, result: Any, at_seq: int) -> None:
        parent_events = self.store.events(parent_id, limit=at_seq)
        expected = stored_log_rows(parent_events)
        actual = log_rows(result.events[:at_seq])
        for index, (want, got) in enumerate(zip(expected, actual), start=1):
            # attemptId is not part of the row; everything that describes what
            # happened must match exactly.
            if want != got:
                raise ForkPrefixMismatch(
                    "fork at seq %d diverged from the parent at event %d: %r != %r"
                    % (at_seq, index, want, got))
        if len(expected) < at_seq or len(actual) < at_seq:
            raise ForkPrefixMismatch(
                "fork at seq %d could not reproduce the parent prefix (%d/%d events)"
                % (at_seq, len(actual), len(expected)))

    def _run(self, attempt_id: str, policy_id: str, deck_id: str, resource_id: str,
             label: str | None, seed: int, adapter: str,
             parent_id: str | None = None, parent_seq: int | None = None,
             lineage: AttemptLineage = AttemptLineage.root,
             policy_switch: dict[str, Any] | None = None) -> Any:
        policy = self.policies[policy_id]
        if deck_id not in DECKS:
            raise KeyError("unknown deck %s" % deck_id)
        if resource_id not in RESOURCE_SETS:
            raise KeyError("unknown resource revision %s" % resource_id)
        # A fork starts under the *parent's* policy and switches at the
        # checkpoint, so the engine is handed the parent's revision first.
        running_policy = policy
        if policy_switch is not None and policy.parentId in self.policies:
            running_policy = self.policies[policy.parentId]
        return run_attempt(attempt_id, running_policy.id, deck_id, resource_id,
                           label=label, seed=seed, adapter=adapter,
                           village=self.village, parent_id=parent_id,
                           parent_seq=parent_seq, policy=running_policy,
                           lineage=lineage, policy_switch=policy_switch,
                           persona_path=self.persona_path)

    def _store_and_return(self, result: Any, policy: PolicyRevision) -> dict[str, Any]:
        # The attempt records the policy it ended under; for a fork that is the
        # edited revision, and the switch event says where it took over.
        result.attempt.policyId = policy.id
        fingerprint = log_fingerprint(result.events)
        self.store.save_policy(policy)
        self.store.save_run(result, policy, fingerprint)
        self._runs[result.attempt.id] = result
        return self.get_attempt(result.attempt.id)

    def _execute(self, attempt_id: str, policy_id: str, deck_id: str, resource_id: str,
                 label: str | None, seed: int, adapter: str,
                 parent_id: str | None = None,
                 parent_seq: int | None = None,
                 lineage: AttemptLineage = AttemptLineage.root) -> dict[str, Any]:
        result = self._run(attempt_id, policy_id, deck_id, resource_id, label, seed,
                           adapter, parent_id=parent_id, parent_seq=parent_seq,
                           lineage=lineage)
        return self._store_and_return(result, self.policies[policy_id])

    def get_attempt(self, attempt_id: str) -> dict[str, Any]:
        row = self.store.get_attempt(attempt_id)
        if row is None:
            raise KeyError("unknown attempt %s" % attempt_id)
        # Everything here comes from the store, so an attempt reopened after a
        # restart looks exactly like one that was just run.
        payload = dict(row)
        payload["decisions"] = self.store.decisions(attempt_id)
        payload["reviews"] = self.store.reviews(attempt_id)
        payload["deck"] = _deck_payload(row["attempt"]["scenarioDeckId"])
        payload["resources"] = RESOURCE_SETS[
            row["attempt"]["resourceRevisionId"]].model_dump(mode="json")
        payload["lineageNote"] = _lineage_note(row["attempt"])
        return payload

    def events(self, attempt_id: str, after: int = 0) -> list[dict[str, Any]]:
        return self.store.events(attempt_id, after_seq=after)

    def observations(self, attempt_id: str, actor_id: str | None = None) -> list[dict[str, Any]]:
        return self.store.observations(attempt_id, actor_id)

    # -- design findings ----------------------------------------------------
    def create_finding(self, core_item: str, compared: list[str], observation: str,
                       interpretation: str, next_change: str,
                       from_policy_id: str) -> dict[str, Any]:
        finding = DesignFinding(
            id="find-%s" % _short_id(),
            createdAt=datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            coreItem=core_item,
            comparedAttemptIds=compared,
            observation=observation,
            interpretation=interpretation,
            nextChange=next_change,
            fromPolicyId=from_policy_id,
        )
        self.store.save_finding(finding)
        return finding.model_dump(mode="json")

    def apply_finding(self, finding_id: str, attempt_id: str, changes: dict[str, Any],
                      mode: str = "rerun", at_seq: int | None = None) -> dict[str, Any]:
        """Turn a finding into the next revision and the next attempt.

        This is the link that makes the tool iterative: condition → decision →
        outcome → finding → next condition, all stored, all traceable back.
        """
        findings = {f["id"]: f for f in self.store.list_findings()}
        if finding_id not in findings:
            raise KeyError("unknown finding %s" % finding_id)
        finding = findings[finding_id]
        reason = "DesignFinding %s: %s" % (finding_id, finding["nextChange"])
        if mode == "fork":
            child = self.fork_attempt(attempt_id, int(at_seq or 1), changes, reason)
        else:
            child = self.rerun_attempt(attempt_id, changes, reason)
        self.store.link_finding(finding_id, child["attempt"]["policyId"],
                                child["attempt"]["id"])
        child["finding"] = {f["id"]: f for f in self.store.list_findings()}[finding_id]
        return child

    def list_findings(self) -> list[dict[str, Any]]:
        return self.store.list_findings()

    # -- replay control -----------------------------------------------------
    def command(self, attempt_id: str, command_id: str, name: str,
                seq: int | None = None) -> dict[str, Any]:
        row = self.store.get_attempt(attempt_id)
        if row is None:
            raise KeyError("unknown attempt %s" % attempt_id)
        count = row["attempt"]["eventCount"]
        cursor = row["attempt"].get("cursorSeq", 0)

        if name == "play":
            new_cursor, state = cursor, "playing"
        elif name == "pause":
            new_cursor, state = cursor, "paused"
        elif name == "step":
            # Exactly one event, whatever its timestamp. Ten events can share a
            # millisecond and each of them is a separate step.
            new_cursor, state = min(count, cursor + 1), "paused"
        elif name == "seek":
            new_cursor, state = max(0, min(count, int(seq or 0))), "paused"
        elif name == "cancel":
            new_cursor, state = 0, "paused"
        else:
            raise ValueError("unknown command %s" % name)

        result = {"attemptId": attempt_id, "cursorSeq": new_cursor,
                  "playState": state, "eventCount": count,
                  "replayOnly": True,
                  "note": "저장된 로그의 재생 커서다. 모델이나 어댑터를 다시 호출하지 않는다."}
        # One transaction for the command row and the cursor it moved.
        stored, replayed = self.store.record_command(
            command_id, attempt_id, name,
            datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            {"name": name, "seq": seq}, result,
            cursor_seq=new_cursor)
        stored = dict(stored)
        stored["deduplicated"] = replayed
        return stored

    # -- snapshot -------------------------------------------------------------
    def snapshot(self, attempt_id: str, at_ms: int | None = None,
                 seq: int | None = None) -> dict[str, Any]:
        """Positions and activities at a moment, computed from the stored run.

        ``seq`` is the authoritative cursor; ``atMs`` is derived from it. They
        used to be interchangeable, which meant a step onto the first of ten
        events sharing a timestamp displayed all ten.
        """
        row = self.store.get_attempt(attempt_id)
        if row is None:
            raise KeyError("unknown attempt %s" % attempt_id)
        timeline = row["timeline"]
        if not timeline:
            raise KeyError("attempt %s has no stored timeline" % attempt_id)

        events = self.store.events(attempt_id)
        if seq is not None:
            seq = max(0, min(len(events), int(seq)))
            at_ms = events[seq - 1]["simTimeMs"] if seq > 0 else 0
        elif at_ms is None:
            raise ValueError("snapshot needs seq or atMs")
        else:
            at_ms = int(at_ms)
            visible = [e for e in events if e["simTimeMs"] <= at_ms]
            seq = visible[-1]["seq"] if visible else 0

        actors = []
        for actor_id, entry in sorted(timeline["actors"].items()):
            realized = _segment_at(entry["realized"], at_ms)
            baseline = _segment_at(entry["baseline"], at_ms)
            position = _position(entry, realized, at_ms)
            actors.append({
                "id": actor_id,
                "displayName": entry["displayName"],
                "isVillageHead": entry["isVillageHead"],
                "group": entry["group"],
                "x": None if position is None else round(position[0], 1),
                "y": None if position is None else round(position[1], 1),
                "place": None if realized is None else (
                    realized.get("place") or realized.get("toPlace")),
                "moving": bool(realized and realized["kind"] == "travel"),
                "mode": None if realized is None else realized["mode"],
                "activity": None if realized is None else realized["label"],
                "onTask": bool(realized and realized["origin"] == "task"),
                "requestId": None if realized is None else realized.get("requestId"),
                "offMap": bool(realized and (
                    realized.get("place") == "TOWN"
                    or (realized["kind"] == "travel" and realized.get("toPlace") == "TOWN"))),
                "baselineActivity": None if baseline is None else baseline["label"],
                "divergesFromBaseline": bool(
                    realized and baseline and realized["label"] != baseline["label"]),
            })
        reservations = [
            r for r in (timeline.get("reservations", {}).get("reservations") or [])
            if int(r["departMs"]) <= at_ms and r["status"] != "cancelled"]
        return {"atMs": at_ms, "cursorSeq": seq, "actors": actors,
                "activeReservations": reservations, "eventSeq": seq}


def _lineage_note(attempt: dict[str, Any]) -> str:
    lineage = attempt.get("lineage", "root")
    if lineage == "fork":
        return ("체크포인트 분기: seq %s까지는 부모와 같은 실행이고 그 이후만 새 정책을 따른다. "
                "접두부는 부모 로그와 사건 단위로 대조해 확인했다."
                % attempt.get("parentSeq"))
    if lineage == "rerun":
        return "재실행: 같은 초기 상태에서 정책만 바꿔 하루를 처음부터 다시 실행했다."
    return "최초 실행."


def _deck_payload(deck_id: str) -> dict[str, Any]:
    deck = DECKS[deck_id]
    return {
        "id": deck.id, "label": deck.label, "classification": deck.classification,
        "assumptions": deck.assumptions, "horizonMs": deck.horizonMs,
        "events": [
            {"id": e.id, "simTimeMs": e.simTimeMs, "type": e.type.value,
             "subjectId": e.subjectId, "prohibitedInferences": e.prohibitedInferences}
            for e in deck.events
        ],
        "note": "hiddenTruth는 연구자 전용이며 API로 내보내지 않는다.",
    }


def _segment_at(segments: list[dict[str, Any]], at_ms: int) -> dict[str, Any] | None:
    for seg in segments:
        if seg["startMs"] <= at_ms < seg["endMs"]:
            return seg
    if segments and at_ms >= segments[-1]["endMs"]:
        return segments[-1]
    return None


def _position(entry: dict[str, Any], segment: dict[str, Any] | None,
              at_ms: int) -> tuple[float, float] | None:
    if segment is None:
        return (entry["homeXY"][0], entry["homeXY"][1])
    polyline = segment.get("polyline")
    if segment["kind"] in ("travel", "patrol") and polyline:
        span = max(1, segment["endMs"] - segment["startMs"])
        return _along(polyline, (at_ms - segment["startMs"]) / span)
    if segment.get("xy"):
        return (segment["xy"][0], segment["xy"][1])
    if polyline:
        return (polyline[0][0], polyline[0][1])
    return (entry["homeXY"][0], entry["homeXY"][1])


def _along(polyline: list[list[float]], fraction: float) -> tuple[float, float]:
    if len(polyline) == 1:
        return (polyline[0][0], polyline[0][1])
    cum = [0.0]
    for a, b in zip(polyline, polyline[1:]):
        cum.append(cum[-1] + math.hypot(a[0] - b[0], a[1] - b[1]))
    total = cum[-1]
    if total <= 0:
        return (polyline[0][0], polyline[0][1])
    target = max(0.0, min(1.0, fraction)) * total
    for i in range(1, len(cum)):
        if cum[i] >= target:
            seg_len = cum[i] - cum[i - 1]
            t = 0.0 if seg_len == 0 else (target - cum[i - 1]) / seg_len
            a, b = polyline[i - 1], polyline[i]
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    return (polyline[-1][0], polyline[-1][1])


def build_comparison(service: "SimulationService", ids: list[str]) -> dict[str, Any]:
    runs = []
    for attempt_id in ids:
        row = service.store.get_attempt(attempt_id)
        if row is None:
            raise KeyError("unknown attempt %s" % attempt_id)
        runs.append({
            "attempt": row["attempt"],
            "metrics": row["metrics"],
            "policy": row["policy"],
            "policyLabel": row["policy"]["label"],
            "contactStrategy": row["policy"]["contactStrategy"],
            "changes": row["policy"]["changes"],
            "trace": row["trace"],
        })
    return compare_runs(runs)
