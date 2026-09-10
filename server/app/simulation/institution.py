"""The health centre as a desk with a shift and a finite number of people.

The previous model multiplied ``initialQueueDepth`` by ``reviewMinutes`` and
called the product a wait. That is not a queue: it does not know how many staff
there are, when the shift starts, or that a person doing a home visit cannot
also be answering the phone. So a handoff that arrived at 18:30 was still
"reviewed", and ``staffCount`` changed nothing.

This module keeps one busy calendar per staff member. Work is placed in the
earliest free slot inside the shift, and everything the centre does - review,
call, visit - takes a named amount of that same budget. Nothing here is
measured: every duration comes from ``ResourceRevision`` and is an experiment
assumption, which is why :meth:`Desk.assumptions` travels with the numbers.

Round trip vs one way
---------------------
``visitTravelMinutes`` is **one way**. The engine used to describe it as a round
trip in the resource label and then bill it twice, so the same number meant two
different things depending on which line you read. It is now one way
everywhere, and a visit occupies ``2 x travel + visitMinutes`` of staff time.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

MIN_MS = 60_000


@dataclass
class WorkItem:
    kind: str            # queued_backlog | review | call | visit
    request_id: str | None
    staff_index: int
    start_ms: int
    end_ms: int
    requested_ms: int

    @property
    def wait_ms(self) -> int:
        return max(0, self.start_ms - self.requested_ms)

    def as_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "requestId": self.request_id,
                "staffIndex": self.staff_index, "startMs": self.start_ms,
                "endMs": self.end_ms, "requestedMs": self.requested_ms,
                "waitMs": self.wait_ms}


class ShiftExhausted(RuntimeError):
    """No slot left inside the shift. The work does not silently happen anyway."""


class Desk:
    """A shift, N staff, and a list of what each of them is busy with."""

    def __init__(self, resources: Any) -> None:
        self.resources = resources
        self.staff_count = max(1, int(resources.staffCount))
        self.shift_start_ms = int(resources.shiftStartMs)
        self.shift_end_ms = int(resources.shiftEndMs)
        self.busy: list[list[tuple[int, int]]] = [[] for _ in range(self.staff_count)]
        self.log: list[WorkItem] = []
        self._seed_backlog()

    # -- setup ----------------------------------------------------------
    def _seed_backlog(self) -> None:
        """The cases already on the desk when the shift starts.

        They are real occupancy, not a number multiplied into a wait: they are
        spread over the staff so that ``staffCount=2`` genuinely clears the
        backlog twice as fast.
        """
        minutes = int(self.resources.reviewMinutes)
        for index in range(int(self.resources.initialQueueDepth)):
            staff = index % self.staff_count
            start = self._earliest_for(staff, self.shift_start_ms)
            item = WorkItem("queued_backlog", None, staff, start,
                            start + minutes * MIN_MS, self.shift_start_ms)
            self.busy[staff].append((item.start_ms, item.end_ms))
            self.log.append(item)

    # -- scheduling ------------------------------------------------------
    def _earliest_for(self, staff: int, not_before_ms: int) -> int:
        cursor = max(not_before_ms, self.shift_start_ms)
        for start, end in sorted(self.busy[staff]):
            if end <= cursor:
                continue
            if start > cursor:
                break
            cursor = end
        return cursor

    def schedule(self, kind: str, request_id: str | None, requested_ms: int,
                 duration_ms: int) -> WorkItem:
        """Place one piece of work in the earliest free slot inside the shift."""
        best: tuple[int, int] | None = None
        for staff in range(self.staff_count):
            start = self._earliest_for(staff, requested_ms)
            if best is None or start < best[1]:
                best = (staff, start)
        assert best is not None
        staff, start = best
        if start + duration_ms > self.shift_end_ms:
            raise ShiftExhausted(
                "근무시간(%02d:%02d 종료) 안에 %d분 업무를 넣을 수 없다"
                % (self.shift_end_ms // 3_600_000, (self.shift_end_ms // MIN_MS) % 60,
                   duration_ms // MIN_MS))
        item = WorkItem(kind, request_id, staff, start, start + duration_ms, requested_ms)
        self.busy[staff].append((item.start_ms, item.end_ms))
        self.log.append(item)
        return item

    # -- reporting -------------------------------------------------------
    @property
    def staff_ms(self) -> int:
        """Minutes the centre actually spent on *this* case load.

        The seeded backlog is other people's work and is counted separately, so
        a comparison between two policies is not inflated by the assumption.
        """
        return sum(i.end_ms - i.start_ms for i in self.log if i.kind != "queued_backlog")

    @property
    def backlog_ms(self) -> int:
        return sum(i.end_ms - i.start_ms for i in self.log if i.kind == "queued_backlog")

    @property
    def wait_ms(self) -> int:
        return sum(i.wait_ms for i in self.log if i.kind != "queued_backlog")

    def report(self) -> dict[str, Any]:
        return {
            "staffCount": self.staff_count,
            "shiftStartMs": self.shift_start_ms,
            "shiftEndMs": self.shift_end_ms,
            "staffMinutes": round(self.staff_ms / MIN_MS, 1),
            "preexistingBacklogMinutes": round(self.backlog_ms / MIN_MS, 1),
            "queueWaitMinutes": round(self.wait_ms / MIN_MS, 1),
            "items": [i.as_dict() for i in self.log],
            "travelBasis": "visitTravelMinutes는 편도다. 방문 1건은 편도×2 + 체류를 쓴다.",
            "note": "모든 시간은 ResourceRevision의 실험 가정이며 측정값이 아니다.",
        }
