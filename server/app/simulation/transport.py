"""Seats in somebody's car, held for a specific trip.

A ride is the one coordination outcome the source material actually records
(P12 driving 552 m out of his way to collect P9; P3 dropping P9 at the pension
on the way back). None of that is a fact about the day: it is what happened
after somebody asked. So the *need* to travel is kept in the scenario and the
ride is produced only by a policy that arranges one.

The reservation book exists so that three failures are detectable rather than
merely unlikely:

* **double booking** - a second rider is promised a seat on a trip that has
  already left, or on a driver who is somewhere else at that minute;
* **teleporting** - a driver accepts a pickup they cannot physically reach in
  time; the engine asks :meth:`TransportBook.conflicts` before holding a seat
  and refuses when the arithmetic does not work;
* **residue** - a cancelled ride that still occupies a seat. ``cancel`` removes
  the hold, and :meth:`held_for` is the only way anything reads the book, so a
  cancelled reservation cannot keep a seat by being forgotten somewhere else.

Seat count is *not* in the source. The persona compiler records it as
``unknown`` and refuses to invent one; the number used here comes from the
resource revision and is labelled as an experiment assumption wherever it is
reported.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .contracts import TransportReservation

MIN_MS = 60_000


@dataclass
class Trip:
    """One vehicle movement a rider can be attached to."""

    reservation_id: str
    driver_id: str
    depart_ms: int
    arrive_ms: int
    pickup_place: str
    destination: str


@dataclass
class TransportBook:
    seat_assumption: str
    seats_per_vehicle: int
    reservations: dict[str, TransportReservation] = field(default_factory=dict)
    _n: int = 0

    # -- queries ---------------------------------------------------------
    def held_for(self, driver_id: str) -> list[TransportReservation]:
        return [r for r in self.reservations.values()
                if r.driverId == driver_id and r.status in ("held", "picked_up")]

    def active(self) -> list[TransportReservation]:
        return [r for r in self.reservations.values() if r.status != "cancelled"]

    def for_rider(self, rider_id: str) -> list[TransportReservation]:
        return [r for r in self.reservations.values()
                if r.riderId == rider_id and r.status in ("held", "picked_up")]

    # -- checks ----------------------------------------------------------
    def conflicts(self, driver_id: str, rider_id: str, depart_ms: int,
                  arrive_ms: int, destination: str) -> dict[str, Any] | None:
        """Why this seat cannot be held, or ``None`` if it can.

        Returned rather than raised: a conflict is a legitimate simulation
        outcome that the log should carry, not an engine fault.
        """
        existing = self.held_for(driver_id)
        if len(existing) >= self.seats_per_vehicle:
            return {"reason": "seats_exhausted",
                    "conflictWith": sorted(r.id for r in existing),
                    "detail": "이 차량의 가정 좌석 수(%d)를 이미 채웠다" % self.seats_per_vehicle,
                    "assumption": self.seat_assumption}
        for other in existing:
            if other.riderId == rider_id:
                return {"reason": "duplicate_reservation",
                        "conflictWith": [other.id],
                        "detail": "같은 사람에게 이미 좌석이 잡혀 있다"}
            same_trip = (other.destination == destination
                         and abs(other.departMs - depart_ms) <= 15 * MIN_MS)
            if same_trip:
                continue  # a second rider can share one trip
            overlaps = not (arrive_ms <= other.departMs or depart_ms >= _end_of(other, arrive_ms))
            if overlaps:
                return {"reason": "driver_double_booked",
                        "conflictWith": [other.id],
                        "detail": ("%s는 %d분에 이미 다른 운행을 잡아 두었다"
                                   % (driver_id, other.departMs // MIN_MS))}
        for other in self.for_rider(rider_id):
            return {"reason": "rider_already_riding",
                    "conflictWith": [other.id],
                    "detail": "이 사람은 이미 다른 차량에 좌석을 잡고 있다"}
        return None

    # -- mutation ---------------------------------------------------------
    def hold(self, request_id: str, driver_id: str, rider_id: str, depart_ms: int,
             pickup_place: str, destination: str,
             conditions: list[str] | None = None) -> TransportReservation:
        self._n += 1
        seat = len(self.held_for(driver_id))
        reservation = TransportReservation(
            id="res-%s-%d" % (driver_id, self._n),
            requestId=request_id,
            driverId=driver_id,
            riderId=rider_id,
            seatIndex=seat,
            departMs=int(depart_ms),
            pickupPlace=pickup_place,
            destination=destination,
            conditions=list(conditions or []),
        )
        self.reservations[reservation.id] = reservation
        return reservation

    def pick_up(self, reservation_id: str) -> TransportReservation:
        reservation = self.reservations[reservation_id]
        self.reservations[reservation_id] = reservation.model_copy(
            update={"status": "picked_up"})
        return self.reservations[reservation_id]

    def complete(self, reservation_id: str) -> TransportReservation:
        reservation = self.reservations[reservation_id]
        self.reservations[reservation_id] = reservation.model_copy(
            update={"status": "completed"})
        return self.reservations[reservation_id]

    def cancel(self, reservation_id: str) -> TransportReservation:
        reservation = self.reservations[reservation_id]
        self.reservations[reservation_id] = reservation.model_copy(
            update={"status": "cancelled"})
        return self.reservations[reservation_id]

    def report(self) -> dict[str, Any]:
        return {
            "seatsPerVehicle": self.seats_per_vehicle,
            "seatAssumption": self.seat_assumption,
            "reservations": [r.model_dump(mode="json")
                             for r in self.reservations.values()],
            "activeCount": len(self.active()),
            "cancelledCount": len(self.reservations) - len(self.active()),
        }


def _end_of(reservation: TransportReservation, fallback_ms: int) -> int:
    """When the driver is free again. Uses the return leg when one is booked."""
    if reservation.returnDepartMs is not None:
        return int(reservation.returnDepartMs)
    return max(int(reservation.departMs), fallback_ms)
