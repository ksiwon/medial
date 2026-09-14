"""Persistence for the iteration loop, mixed into :class:`Store`.

Same database, same connection, same lock as the attempt store, because a
generation and the attempt it ran are one research record and must not be able
to disagree after a crash.

Two things here are not ordinary CRUD:

* **artifacts are insert-only.** Reviews, syntheses and Change Sets are written
  once. A generation's *status* is mutable - it has to be, or the loop could not
  resume - but the things it points at never change under it;
* **model results are cached by an idempotency key** built from the session, the
  generation, the role, the subject and a hash of the input. After a restart the
  loop finds the stored result and reuses it instead of paying for the call
  again *and* executing the same Change Set twice.

Every table is created with ``IF NOT EXISTS`` and no existing table is altered
destructively, so a database written by the previous build keeps its runs.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any

ITERATION_SCHEMA = """
CREATE TABLE IF NOT EXISTS iteration_sessions (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    status TEXT NOT NULL,
    stop_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    session_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    parent_id TEXT,
    policy_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    created_at TEXT NOT NULL,
    generation_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_reviews (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    generation_id TEXT,
    attempt_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    source TEXT NOT NULL,
    adapter TEXT NOT NULL,
    created_at TEXT NOT NULL,
    review_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_syntheses (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    synthesis_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS change_sets (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    validation_status TEXT NOT NULL,
    confirmation_status TEXT NOT NULL,
    change_hash TEXT,
    created_at TEXT NOT NULL,
    change_set_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_calls (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    generation_index INTEGER,
    role TEXT NOT NULL,
    subject TEXT,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    call_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_results (
    idempotency_key TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    subject TEXT,
    created_at TEXT NOT NULL,
    result_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS designer_decisions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decision_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS field_packages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    package_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS human_reviews (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    package_id TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    review_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS iteration_commands (
    command_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    received_at TEXT NOT NULL,
    request_json TEXT NOT NULL,
    result_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS generations_by_session ON generations (session_id, idx);
CREATE INDEX IF NOT EXISTS reviews_by_generation ON agent_reviews (generation_id);
CREATE INDEX IF NOT EXISTS change_sets_by_generation ON change_sets (generation_id);
"""


class ArtifactExists(RuntimeError):
    """An insert-only research artifact was written twice."""


def _dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False)


class IterationTables:
    """Mixed into :class:`~.store.Store`; uses its connection and lock."""

    _conn: sqlite3.Connection
    _lock: Any

    def _init_iteration(self) -> None:
        self._conn.executescript(ITERATION_SCHEMA)

    # -- sessions ---------------------------------------------------------
    def save_session(self, session: Any) -> None:
        data = session.model_dump(mode="json")
        with self._lock, self._conn:
            existing = self._conn.execute(
                "SELECT 1 FROM iteration_sessions WHERE id = ?", (session.id,)).fetchone()
            if existing is not None:
                raise ArtifactExists("iteration session %s already exists" % session.id)
            self._conn.execute(
                "INSERT INTO iteration_sessions (id, label, status, stop_reason,"
                " created_at, updated_at, session_json) VALUES (?,?,?,?,?,?,?)",
                (session.id, session.label, session.status.value, session.stopReason,
                 session.createdAt, session.updatedAt, _dumps(data)))

    def update_session(self, session: Any) -> None:
        """Status, budget counters and stop reason move; the record does not."""
        data = session.model_dump(mode="json")
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE iteration_sessions SET status = ?, stop_reason = ?,"
                " updated_at = ?, session_json = ? WHERE id = ?",
                (session.status.value, session.stopReason, session.updatedAt,
                 _dumps(data), session.id))

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT session_json FROM iteration_sessions WHERE id = ?",
                (session_id,)).fetchone()
        return json.loads(row["session_json"]) if row else None

    def list_sessions(self) -> list[dict[str, Any]]:
        with self._lock:
            return [json.loads(r["session_json"]) for r in self._conn.execute(
                "SELECT session_json FROM iteration_sessions ORDER BY created_at, id"
            ).fetchall()]

    # -- generations ------------------------------------------------------
    def save_generation(self, generation: Any) -> None:
        data = generation.model_dump(mode="json")
        with self._lock, self._conn:
            existing = self._conn.execute(
                "SELECT 1 FROM generations WHERE id = ?", (generation.id,)).fetchone()
            if existing is not None:
                raise ArtifactExists("generation %s already exists" % generation.id)
            self._conn.execute(
                "INSERT INTO generations (id, session_id, idx, parent_id, policy_id,"
                " outcome, created_at, generation_json) VALUES (?,?,?,?,?,?,?,?)",
                (generation.id, generation.sessionId, generation.index,
                 generation.parentGenerationId, generation.policyRevisionId,
                 generation.outcome.value, generation.createdAt, _dumps(data)))

    def update_generation(self, generation: Any) -> None:
        data = generation.model_dump(mode="json")
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE generations SET outcome = ?, generation_json = ? WHERE id = ?",
                (generation.outcome.value, _dumps(data), generation.id))

    def get_generation(self, generation_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT generation_json FROM generations WHERE id = ?",
                (generation_id,)).fetchone()
        return json.loads(row["generation_json"]) if row else None

    def list_generations(self, session_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [json.loads(r["generation_json"]) for r in self._conn.execute(
                "SELECT generation_json FROM generations WHERE session_id = ?"
                " ORDER BY idx, created_at, id", (session_id,)).fetchall()]

    # -- artifacts --------------------------------------------------------
    def save_agent_reviews(self, generation_id: str, reviews: list[Any]) -> None:
        with self._lock, self._conn:
            try:
                self._conn.executemany(
                    "INSERT INTO agent_reviews (id, session_id, generation_id,"
                    " attempt_id, actor_id, source, adapter, created_at, review_json)"
                    " VALUES (?,?,?,?,?,?,?,?,?)",
                    [(r.id, r.sessionId, generation_id, r.attemptId, r.actorId,
                      r.source, r.adapter, r.createdAt,
                      _dumps(r.model_dump(mode="json")))
                     for r in reviews])
            except sqlite3.IntegrityError as exc:
                raise ArtifactExists(
                    "리뷰를 두 번 저장하려 했다 (%s). 재시작 후 중복 생성이다: %s"
                    % (generation_id, exc)) from exc

    def agent_reviews(self, generation_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [json.loads(r["review_json"]) for r in self._conn.execute(
                "SELECT review_json FROM agent_reviews WHERE generation_id = ?"
                " ORDER BY actor_id, id", (generation_id,)).fetchall()]

    def save_synthesis(self, generation_id: str, synthesis: Any) -> None:
        with self._lock, self._conn:
            try:
                self._conn.execute(
                    "INSERT INTO review_syntheses (id, session_id, generation_id,"
                    " created_at, synthesis_json) VALUES (?,?,?,?,?)",
                    (synthesis.id, synthesis.sessionId, generation_id,
                     synthesis.createdAt, _dumps(synthesis.model_dump(mode="json"))))
            except sqlite3.IntegrityError as exc:
                raise ArtifactExists("synthesis %s already exists" % synthesis.id) from exc

    def synthesis(self, synthesis_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT synthesis_json FROM review_syntheses WHERE id = ?",
                (synthesis_id,)).fetchone()
        return json.loads(row["synthesis_json"]) if row else None

    def save_change_sets(self, generation_id: str, change_sets: list[Any]) -> None:
        with self._lock, self._conn:
            try:
                self._conn.executemany(
                    "INSERT INTO change_sets (id, session_id, generation_id,"
                    " validation_status, confirmation_status, change_hash, created_at,"
                    " change_set_json) VALUES (?,?,?,?,?,?,?,?)",
                    [(p.id, p.sessionId, generation_id, p.validationStatus.value,
                      p.confirmationStatus.value, p.changeHash, p.createdAt,
                      _dumps(p.model_dump(mode="json")))
                     for p in change_sets])
            except sqlite3.IntegrityError as exc:
                raise ArtifactExists(
                    "Change Set을 두 번 저장하려 했다 (%s): %s" % (generation_id, exc)) from exc

    def update_change_set(self, change_set: Any) -> None:
        """Attach validation, confirmation, and execution results to a Change Set."""
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE change_sets SET validation_status = ?,"
                " confirmation_status = ?, change_hash = ?, change_set_json = ? WHERE id = ?",
                (change_set.validationStatus.value, change_set.confirmationStatus.value,
                 change_set.changeHash, _dumps(change_set.model_dump(mode="json")),
                 change_set.id))

    def change_sets(self, generation_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [json.loads(r["change_set_json"]) for r in self._conn.execute(
                "SELECT change_set_json FROM change_sets WHERE generation_id = ?"
                " ORDER BY created_at, id", (generation_id,)).fetchall()]

    def session_change_hashes(self, session_id: str) -> list[str]:
        """Every Change Set this session has already produced, for cycle detection."""
        with self._lock:
            return [r["change_hash"] for r in self._conn.execute(
                "SELECT DISTINCT change_hash FROM change_sets WHERE session_id = ?"
                " AND change_hash IS NOT NULL AND change_hash != ''",
                (session_id,)).fetchall()]

    def session_applied_change_hashes(self, session_id: str) -> list[str]:
        """Only Change Sets that produced a revision; drafts are not applications."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT change_set_json FROM change_sets WHERE session_id = ?"
                " AND change_hash IS NOT NULL AND change_hash != ''",
                (session_id,)).fetchall()
        return [data["changeHash"] for row in rows
                if (data := json.loads(row["change_set_json"]))
                and data.get("resultingPolicyRevisionId")]

    # -- model calls ------------------------------------------------------
    def save_model_call(self, record: Any) -> None:
        data = record.as_dict() if hasattr(record, "as_dict") else dict(record)
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO model_calls (id, session_id, generation_index,"
                " role, subject, request_hash, status, created_at, call_json)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (data["id"], data.get("sessionId"), data.get("generationIndex"),
                 data["role"], data.get("subject"), data["requestHash"],
                 data.get("status", "ok"), data.get("createdAt", ""), _dumps(data)))

    def model_calls(self, session_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [json.loads(r["call_json"]) for r in self._conn.execute(
                "SELECT call_json FROM model_calls WHERE session_id = ?"
                " ORDER BY created_at, id", (session_id,)).fetchall()]

    def cached_model_result(self, key: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT result_json FROM model_results WHERE idempotency_key = ?",
                (key,)).fetchone()
        return json.loads(row["result_json"]) if row else None

    def cache_model_result(self, key: str, *, session_id: str, role: str,
                           subject: str | None, created_at: str,
                           result: dict[str, Any]) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO model_results (idempotency_key, session_id,"
                " role, subject, created_at, result_json) VALUES (?,?,?,?,?,?)",
                (key, session_id, role, subject, created_at, _dumps(result)))

    # -- designer & field --------------------------------------------------
    def save_decision(self, decision: Any) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO designer_decisions (id, session_id, created_at,"
                " decision_json) VALUES (?,?,?,?)",
                (decision.id, decision.sessionId, decision.createdAt,
                 _dumps(decision.model_dump(mode="json"))))

    def decisions_for_session(self, session_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [json.loads(r["decision_json"]) for r in self._conn.execute(
                "SELECT decision_json FROM designer_decisions WHERE session_id = ?"
                " ORDER BY created_at, id", (session_id,)).fetchall()]

    def save_field_package(self, package: Any) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO field_packages (id, session_id, generation_id,"
                " created_at, package_json) VALUES (?,?,?,?,?)",
                (package.id, package.sessionId, package.generationId,
                 package.createdAt, _dumps(package.model_dump(mode="json"))))

    def field_package(self, package_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT package_json FROM field_packages WHERE id = ?",
                (package_id,)).fetchone()
        return json.loads(row["package_json"]) if row else None

    def field_packages(self, session_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [json.loads(r["package_json"]) for r in self._conn.execute(
                "SELECT package_json FROM field_packages WHERE session_id = ?"
                " ORDER BY created_at, id", (session_id,)).fetchall()]

    def save_human_review(self, review: Any) -> None:
        """The only writer of ``source="human"`` rows.

        Nothing in the automatic loop calls this, which is what makes "no human
        data exists before a person submits it" a checkable property.
        """
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO human_reviews (id, session_id, package_id, submitted_at,"
                " review_json) VALUES (?,?,?,?,?)",
                (review.id, review.sessionId, review.packageId, review.submittedAt,
                 _dumps(review.model_dump(mode="json"))))

    def human_reviews(self, session_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [json.loads(r["review_json"]) for r in self._conn.execute(
                "SELECT review_json FROM human_reviews WHERE session_id = ?"
                " ORDER BY submitted_at, id", (session_id,)).fetchall()]

    def human_review_count(self) -> int:
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) AS n FROM human_reviews").fetchone()
        return int(row["n"])

    # -- commands ---------------------------------------------------------
    def record_iteration_command(self, command_id: str, session_id: str, name: str,
                                 received_at: str, request: dict[str, Any],
                                 result: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Same contract as the replay commands: repeating one with the same
        arguments replays the stored result, repeating it with different ones is
        a conflict rather than a silent second start."""
        from .store import CommandConflict

        with self._lock:
            row = self._conn.execute(
                "SELECT session_id, name, request_json, result_json FROM"
                " iteration_commands WHERE command_id = ?", (command_id,)).fetchone()
            if row is not None:
                stored = json.loads(row["request_json"])
                if (row["session_id"], row["name"], stored) != (session_id, name, request):
                    raise CommandConflict(
                        "commandId %s was already used for %s/%s with %r"
                        % (command_id, row["session_id"], row["name"], stored))
                return (json.loads(row["result_json"]), True)
            with self._conn:
                self._conn.execute(
                    "INSERT INTO iteration_commands (command_id, session_id, name,"
                    " received_at, request_json, result_json) VALUES (?,?,?,?,?,?)",
                    (command_id, session_id, name, received_at, _dumps(request),
                     _dumps(result)))
            return (result, False)
