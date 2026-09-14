"""Opening a database an older build left behind.

Every other store test uses ``:memory:``, which is always a *fresh* database. A
whole class of failure lives on the other side of that: schema statements that
do nothing because the table already exists, an index added to a table whose
shape has changed, a method name that now collides with an inherited one.

That is not hypothetical. The ``model_calls`` table added for per-attempt model
recording took a name ``IterationTables`` already used. On a fresh database the
new CREATE ran first and the iteration one silently no-opped; on a database that
already existed, the index failed with ``no such column: attempt_id`` and the
server would not start. 332 tests passed and the app did not boot.

So these tests open a committed database file produced by the build at 3d1660a -
the schema is read out of git, not retyped - and check that today's ``Store``
opens it, keeps what is in it, and can still write.

    python -m pytest server/tests/simulation/test_store_upgrade.py -q
"""
from __future__ import annotations

import shutil
import sqlite3
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.persistence.store import Store  # noqa: E402

#: A database as the build before the MAS work left it. Rebuild with
#: ``scripts``-free throwaway code if the baseline ever needs to move; do not
#: edit it by hand, because its value is being genuinely old.
LEGACY_DB = REPO_ROOT / "fixtures" / "legacy-db" / "simulation.pre-mas.sqlite3"


@pytest.fixture()
def legacy(tmp_path):
    """A writable copy. The fixture itself is never opened for writing."""
    assert LEGACY_DB.exists(), "the legacy database fixture is missing"
    target = tmp_path / "simulation.sqlite3"
    shutil.copyfile(LEGACY_DB, target)
    return target


def _tables(path: Path) -> set[str]:
    conn = sqlite3.connect(str(path))
    try:
        return {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'")}
    finally:
        conn.close()


def test_the_fixture_really_is_older_than_the_current_schema():
    """If this stops being true the fixture has been refreshed and proves nothing."""
    names = _tables(LEGACY_DB)
    assert "attempts" in names
    assert "model_calls" in names, "the iteration table must already be there"
    assert "attempt_model_calls" not in names, "the fixture is not old any more"


def test_an_older_database_still_opens(legacy):
    """The exact failure: the server could not boot on a database it had written."""
    store = Store(legacy)
    try:
        assert "attempt_model_calls" in _tables(legacy)
    finally:
        store.close()


def test_what_was_already_stored_is_still_there(legacy):
    store = Store(legacy)
    try:
        rows = store.list_attempts()
        assert [r["attempt"]["id"] for r in rows] == ["att-legacy-1"]
        assert store.get_attempt("att-legacy-1") is not None
    finally:
        store.close()


def test_the_iteration_table_keeps_its_own_rows(legacy):
    """The collision made this return an empty list without anything failing."""
    store = Store(legacy)
    try:
        assert [c["id"] for c in store.model_calls("sess-legacy")] == ["mc-legacy-1"]
        assert store.attempt_model_calls("att-legacy-1") == []
    finally:
        store.close()


def test_an_upgraded_database_can_still_be_written_to(legacy):
    """Opening it is not enough; the next run has to be storable."""
    from app.simulation.persistence.store import Store as S
    from app.simulation.village import load_village
    from app.simulation.service import SimulationService

    store = S(legacy)
    try:
        service = SimulationService(
            store=store,
            village=load_village(str(REPO_ROOT / "fixtures" / "synthetic"
                                     / "village.synthetic.json")),
            persona_path=str(REPO_ROOT / "fixtures" / "synthetic"
                             / "personas.synthetic.json"))
        created = service.create_attempt("policy-A-v1", "deck-p1-no-response-v1",
                                         "assumed-resources-v1")
        assert created["attempt"]["id"]
        # And the old row is still beside the new one.
        assert {"att-legacy-1", created["attempt"]["id"]} <= {
            r["attempt"]["id"] for r in store.list_attempts()}
    finally:
        store.close()


def test_opening_it_twice_is_not_a_different_upgrade(legacy):
    """Migrations run on every boot, so running them again must be a no-op."""
    first = Store(legacy)
    first.close()
    before = _tables(legacy)
    second = Store(legacy)
    second.close()
    assert _tables(legacy) == before
