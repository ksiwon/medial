"""SQLite persistence.

An attempt is append-only in the strong sense: the write is a plain ``INSERT``,
so re-using an id raises instead of overwriting. That matters because attempt ids
used to come from an in-process counter that restarted at 1 on every boot, and
``INSERT OR REPLACE`` then silently rewrote yesterday's run with today's. Research
records that quietly change are worse than missing ones.

Commands carry a client-supplied ``commandId``. Repeating one returns the stored
result (idempotent); repeating one with *different* arguments is a conflict, not
a duplicate, and is reported as such. The command row and the cursor move in a
single transaction so a crash cannot leave one without the other.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .iteration_store import IterationTables

REPO_ROOT = Path(__file__).resolve().parents[4]

#: Written to ``schema_meta`` on open. Bumped when the JSON shape of a stored
#: record gains fields an older build cannot read (additive only; the DDL is
#: never changed destructively). ``1`` is everything before 2026-09-15;
#: ``2`` adds typed ``semantic`` rule changes, rule application records,
#: staged human reviews and the run manifest.
SCHEMA_VERSION = "2"
DEFAULT_DB = REPO_ROOT / "local-data" / "runs" / "simulation.sqlite3"

SCHEMA = """
CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    parent_seq INTEGER,
    label TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    deck_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    seed INTEGER NOT NULL,
    adapter TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    data_source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    cursor_seq INTEGER NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0,
    log_fingerprint TEXT,
    attempt_json TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    -- The map timeline and the decision trace are part of the run, not a cache of
    -- it: without them a reopened attempt would show an empty map.
    timeline_json TEXT NOT NULL DEFAULT '{}',
    trace_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS events (
    attempt_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    sim_time_ms INTEGER NOT NULL,
    type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    causation_id TEXT,
    visibility TEXT NOT NULL,
    payload TEXT NOT NULL,
    event_json TEXT NOT NULL,
    PRIMARY KEY (attempt_id, seq)
);
CREATE TABLE IF NOT EXISTS decisions (
    attempt_id TEXT NOT NULL,
    id TEXT NOT NULL,
    sim_time_ms INTEGER NOT NULL,
    decision_json TEXT NOT NULL,
    PRIMARY KEY (attempt_id, id)
);
CREATE TABLE IF NOT EXISTS observations (
    attempt_id TEXT NOT NULL,
    id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    observation_json TEXT NOT NULL,
    PRIMARY KEY (attempt_id, id)
);
CREATE TABLE IF NOT EXISTS reviews (
    attempt_id TEXT NOT NULL,
    id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    source TEXT NOT NULL,
    review_json TEXT NOT NULL,
    PRIMARY KEY (attempt_id, id)
);
CREATE TABLE IF NOT EXISTS commands (
    command_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    name TEXT NOT NULL,
    received_at TEXT NOT NULL,
    request_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    created_at TEXT NOT NULL,
    policy_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    core_item TEXT NOT NULL,
    from_policy_id TEXT NOT NULL,
    resulting_policy_id TEXT,
    resulting_attempt_id TEXT,
    finding_json TEXT NOT NULL
);
-- Named for the attempt on purpose. ``model_calls`` was already taken by the
-- iteration tables, which hold the *session's* review and change-set calls, and
-- the collision was invisible: on a fresh database this CREATE ran first and the
-- iteration one silently no-opped, while on an existing database the index below
-- failed and the server would not start.
CREATE TABLE IF NOT EXISTS attempt_model_calls (
    attempt_id TEXT NOT NULL,
    key TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    call_index INTEGER NOT NULL,
    sim_time_ms INTEGER NOT NULL,
    origin TEXT NOT NULL,
    status TEXT NOT NULL,
    record_json TEXT NOT NULL,
    -- Keyed by (attempt, actor, call index) rather than by the content address:
    -- two identical prompts from the same actor are two calls, and collapsing
    -- them would store a recording that cannot reproduce its own run.
    PRIMARY KEY (attempt_id, actor_id, call_index)
);
CREATE INDEX IF NOT EXISTS events_by_attempt ON events (attempt_id, seq);
CREATE INDEX IF NOT EXISTS attempt_model_calls_by_key
    ON attempt_model_calls (attempt_id, key);
"""


class AttemptExists(RuntimeError):
    """An attempt id was written twice. Never resolved by overwriting."""


class CommandConflict(RuntimeError):
    """The same commandId arrived with different arguments."""


class Store(IterationTables):
    def __init__(self, path: str | os.PathLike[str] | None = None) -> None:
        target = Path(path) if path is not None else Path(
            os.environ.get("MEDIAL_SIM_DB", DEFAULT_DB))
        if str(target) != ":memory:":
            target.parent.mkdir(parents=True, exist_ok=True)
        self.path = target
        # Reentrant, and held for *reads* as well as writes. One sqlite3
        # connection is not safe for concurrent use, and this store is read from
        # the API threadpool while the iteration loop writes from its own
        # thread; an unguarded read there produced an intermittent 500 on
        # /events. Reentrant because the write paths take the lock and then call
        # helpers that take it again.
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(target), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        # Additive only: every iteration table is CREATE TABLE IF NOT EXISTS, so a
        # database written by the previous build keeps every run it already has.
        self._init_iteration()
        self._migrate()
        self._conn.commit()

    def _migrate(self) -> None:
        """Add columns a database written by an older build does not have.

        Additive only, and recorded: ``schema_meta`` carries the version the
        build that last opened this file wrote. Nothing is dropped or rewritten,
        so an older build can still open the file - it simply will not
        understand rows written in a newer JSON shape, which its readers
        already treat as "이전 형식" rather than as an error.
        """
        def columns(table: str) -> set[str]:
            return {row["name"] for row in
                    self._conn.execute("PRAGMA table_info(%s)" % table).fetchall()}

        for table, column, default in (
            ("attempts", "timeline_json", "'{}'"),
            ("attempts", "trace_json", "'[]'"),
            ("commands", "request_json", "'{}'"),
        ):
            if column not in columns(table):
                self._conn.execute(
                    "ALTER TABLE %s ADD COLUMN %s TEXT NOT NULL DEFAULT %s"
                    % (table, column, default))
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        row = self._conn.execute(
            "SELECT value FROM schema_meta WHERE key = 'schemaVersion'").fetchone()
        self.previous_schema_version = row["value"] if row else None
        self._conn.execute(
            "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schemaVersion', ?)",
            (SCHEMA_VERSION,))

    def close(self) -> None:
        self._conn.close()

    # -- writes ---------------------------------------------------------
    def save_run(self, result: Any, policy: Any, fingerprint: str) -> None:
        """Insert one finished attempt. Never updates an existing one."""
        attempt = result.attempt
        with self._lock:
            existing = self._conn.execute(
                "SELECT 1 FROM attempts WHERE id = ?", (attempt.id,)).fetchone()
            if existing is not None:
                raise AttemptExists(
                    "attempt %s already exists; refusing to overwrite a stored run"
                    % attempt.id)
            try:
                # One transaction: a half-written attempt with orphan events would
                # be indistinguishable from a real short run.
                with self._conn:
                    self._conn.execute(
                        "INSERT INTO attempts (id, parent_id, parent_seq, label,"
                        " policy_id, deck_id, resource_id, seed, adapter, mode, status,"
                        " engine_version, data_source, created_at, cursor_seq, event_count,"
                        " log_fingerprint, attempt_json, metrics_json, policy_json,"
                        " timeline_json, trace_json)"
                        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (attempt.id, attempt.parentId, attempt.parentSeq, attempt.label,
                         attempt.policyId, attempt.scenarioDeckId,
                         attempt.resourceRevisionId,
                         attempt.seed, attempt.adapter, attempt.mode.value,
                         attempt.status.value,
                         attempt.engineVersion, attempt.dataSource, attempt.createdAt,
                         attempt.cursorSeq, len(result.events), fingerprint,
                         json.dumps(attempt.model_dump(mode="json"), ensure_ascii=False),
                         json.dumps(result.metrics, ensure_ascii=False),
                         json.dumps(policy.model_dump(mode="json"), ensure_ascii=False),
                         json.dumps(result.timeline, ensure_ascii=False),
                         json.dumps(result.trace, ensure_ascii=False)))
                    self._conn.executemany(
                        "INSERT INTO events (attempt_id, seq, sim_time_ms, type,"
                        " actor_id, correlation_id, causation_id, visibility, payload,"
                        " event_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        [(attempt.id, e.seq, e.simTimeMs, e.type.value, e.actorId,
                          e.correlationId, e.causationId,
                          json.dumps(e.visibility, ensure_ascii=False),
                          json.dumps(e.payload, ensure_ascii=False),
                          json.dumps(e.model_dump(mode="json"), ensure_ascii=False))
                         for e in result.events])
                    self._conn.executemany(
                        "INSERT INTO decisions (attempt_id, id, sim_time_ms, decision_json)"
                        " VALUES (?,?,?,?)",
                        [(attempt.id, d.id, d.simTimeMs,
                          json.dumps(d.model_dump(mode="json"), ensure_ascii=False))
                         for d in result.decisions])
                    self._conn.executemany(
                        "INSERT INTO observations (attempt_id, id, actor_id,"
                        " observation_json) VALUES (?,?,?,?)",
                        [(attempt.id, o.id, o.actorId,
                          json.dumps(o.model_dump(mode="json"), ensure_ascii=False))
                         for o in result.observations])
                    self._conn.executemany(
                        "INSERT INTO attempt_model_calls (attempt_id, key, actor_id,"
                        " call_index, sim_time_ms, origin, status, record_json)"
                        " VALUES (?,?,?,?,?,?,?,?)",
                        [(attempt.id, m.key, m.actorId, m.callIndex, m.simTimeMs,
                          m.origin, m.status,
                          json.dumps(m.model_dump(mode="json"), ensure_ascii=False))
                         for m in getattr(result, "model_calls", [])])
                    self._conn.executemany(
                        "INSERT INTO reviews (attempt_id, id, actor_id, source, review_json)"
                        " VALUES (?,?,?,?,?)",
                        [(attempt.id, r.id, r.actorId, r.source,
                          json.dumps(r.model_dump(mode="json"), ensure_ascii=False))
                         for r in result.reviews])
            except sqlite3.IntegrityError as exc:
                # Two concurrent creates that raced past the check above land here.
                # The transaction rolled back, so nothing partial survives.
                raise AttemptExists(
                    "attempt %s could not be stored without overwriting: %s"
                    % (attempt.id, exc)) from exc

    def save_policy(self, policy: Any) -> None:
        """Policy revisions are their own lineage and outlive the process."""
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO policies (id, parent_id, created_at, policy_json)"
                " VALUES (?,?,datetime('now'),?)",
                (policy.id, policy.parentId,
                 json.dumps(policy.model_dump(mode="json"), ensure_ascii=False)))

    def list_policies(self) -> list[dict[str, Any]]:
        with self._lock:
            return [json.loads(r["policy_json"]) for r in self._conn.execute(
                "SELECT policy_json FROM policies ORDER BY created_at, id").fetchall()]

    def save_finding(self, finding: Any) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO findings (id, created_at, core_item, from_policy_id,"
                " resulting_policy_id, resulting_attempt_id, finding_json)"
                " VALUES (?,?,?,?,?,?,?)",
                (finding.id, finding.createdAt, finding.coreItem, finding.fromPolicyId,
                 finding.resultingPolicyId, finding.resultingAttemptId,
                 json.dumps(finding.model_dump(mode="json"), ensure_ascii=False)))

    def link_finding(self, finding_id: str, policy_id: str, attempt_id: str) -> None:
        """Close the loop: this finding produced that revision and that attempt."""
        with self._lock, self._conn:
            row = self._conn.execute(
                "SELECT finding_json FROM findings WHERE id = ?", (finding_id,)).fetchone()
            if row is None:
                raise KeyError("unknown finding %s" % finding_id)
            data = json.loads(row["finding_json"])
            data["resultingPolicyId"] = policy_id
            data["resultingAttemptId"] = attempt_id
            self._conn.execute(
                "UPDATE findings SET resulting_policy_id = ?, resulting_attempt_id = ?,"
                " finding_json = ? WHERE id = ?",
                (policy_id, attempt_id, json.dumps(data, ensure_ascii=False), finding_id))

    def list_findings(self) -> list[dict[str, Any]]:
        with self._lock:
            return [json.loads(r["finding_json"]) for r in self._conn.execute(
                "SELECT finding_json FROM findings ORDER BY created_at, id").fetchall()]

    def record_command(self, command_id: str, attempt_id: str, name: str,
                       received_at: str, request: dict[str, Any],
                       result: dict[str, Any],
                       cursor_seq: int | None = None) -> tuple[dict[str, Any], bool]:
        """Returns (result, was_replayed).

        A repeated ``commandId`` with the same arguments returns the stored
        result and does not move the cursor again. A repeated ``commandId`` with
        *different* arguments is a client bug, so it raises rather than quietly
        answering with someone else's result.
        """
        with self._lock:
            row = self._conn.execute(
                "SELECT attempt_id, name, request_json, result_json FROM commands"
                " WHERE command_id = ?", (command_id,)).fetchone()
            if row is not None:
                stored_request = json.loads(row["request_json"])
                if (row["attempt_id"], row["name"], stored_request) != (
                        attempt_id, name, request):
                    raise CommandConflict(
                        "commandId %s was already used for %s/%s with %r"
                        % (command_id, row["attempt_id"], row["name"], stored_request))
                return (json.loads(row["result_json"]), True)
            with self._conn:
                self._conn.execute(
                    "INSERT INTO commands (command_id, attempt_id, name, received_at,"
                    " request_json, result_json) VALUES (?,?,?,?,?,?)",
                    (command_id, attempt_id, name, received_at,
                     json.dumps(request, ensure_ascii=False),
                     json.dumps(result, ensure_ascii=False)))
                if cursor_seq is not None:
                    # Same transaction as the command row: the log of what was
                    # asked and the state it produced cannot disagree.
                    self._conn.execute(
                        "UPDATE attempts SET cursor_seq = ? WHERE id = ?",
                        (cursor_seq, attempt_id))
            return (result, False)

    def set_cursor(self, attempt_id: str, seq: int) -> None:
        with self._lock, self._conn:
            self._conn.execute("UPDATE attempts SET cursor_seq = ? WHERE id = ?",
                               (seq, attempt_id))

    # -- reads ----------------------------------------------------------
    def list_attempts(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM attempts ORDER BY created_at, id").fetchall()
        return [self._attempt_row(r) for r in rows]

    def get_attempt(self, attempt_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM attempts WHERE id = ?",
                                     (attempt_id,)).fetchone()
        return self._attempt_row(row) if row else None

    @staticmethod
    def _attempt_row(row: sqlite3.Row) -> dict[str, Any]:
        attempt = json.loads(row["attempt_json"])
        attempt["cursorSeq"] = row["cursor_seq"]
        attempt["eventCount"] = row["event_count"]
        # A row written before lineage existed is a root run: it was created from
        # the initial state. Filled in on read so old records stay readable
        # without being rewritten.
        attempt.setdefault("lineage", "root")
        timeline = json.loads(row["timeline_json"] or "{}")
        return {
            "attempt": attempt,
            "metrics": json.loads(row["metrics_json"]),
            "policy": json.loads(row["policy_json"]),
            "logFingerprint": row["log_fingerprint"],
            "timeline": timeline or None,
            "trace": json.loads(row["trace_json"] or "[]"),
        }

    def events(self, attempt_id: str, after_seq: int = 0,
               limit: int | None = None) -> list[dict[str, Any]]:
        sql = ("SELECT event_json FROM events WHERE attempt_id = ? AND seq > ?"
               " ORDER BY seq")
        params: list[Any] = [attempt_id, after_seq]
        if limit is not None:
            sql += " LIMIT ?"
            params.append(limit)
        with self._lock:
            return [json.loads(r["event_json"])
                    for r in self._conn.execute(sql, params).fetchall()]

    def decisions(self, attempt_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [json.loads(r["decision_json"]) for r in self._conn.execute(
                "SELECT decision_json FROM decisions WHERE attempt_id = ?"
                " ORDER BY sim_time_ms, id", (attempt_id,)).fetchall()]

    def reviews(self, attempt_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [json.loads(r["review_json"]) for r in self._conn.execute(
                "SELECT review_json FROM reviews WHERE attempt_id = ? ORDER BY id",
                (attempt_id,)).fetchall()]

    def attempt_model_calls(self, attempt_id: str) -> list[dict[str, Any]]:
        """Every model call a stored attempt made, in the order it made them.

        This is what a fork hands its child so the shared prefix replays the
        parent's exact answers instead of asking the model again.

        Not ``model_calls``: ``IterationTables`` already defines that for the
        review session's own calls, and this class inherits from it. The short
        name here overrode it, so the iteration loop was asking the wrong table
        and getting an empty list back.
        """
        with self._lock:
            rows = self._conn.execute(
                "SELECT record_json FROM attempt_model_calls WHERE attempt_id = ?"
                " ORDER BY actor_id, call_index", (attempt_id,)).fetchall()
        return [json.loads(row["record_json"]) for row in rows]

    def observations(self, attempt_id: str, actor_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            if actor_id:
                rows = self._conn.execute(
                    "SELECT observation_json FROM observations WHERE attempt_id = ?"
                    " AND actor_id = ? ORDER BY id", (attempt_id, actor_id)).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT observation_json FROM observations WHERE attempt_id = ?"
                    " ORDER BY id", (attempt_id,)).fetchall()
        return [json.loads(r["observation_json"]) for r in rows]
