"""The service under evaluation, behind one boundary (26번 C02).

The evaluation loop - experience, resident evaluation, synthesis, change,
confirmation, rerun, comparison, field review - is about *a service*, and until
2026-09-15 it was about MEDial specifically: the supported quests, the rule
catalogue, the capability list and the words on screen were module constants in
the iteration package.

A :class:`ServiceAdapter` is what the core is allowed to know:

* who the service is (``serviceId``, ``label``, ``category``);
* which cases it can run at all (``supports_case``);
* which rules a Change Set may edit (``rule_types``), and how to read, format
  and compile them - delegated to :mod:`semantic_rules`, which is where a rule's
  one source of truth lives;
* which capabilities the engine actually implements for it.

The core never branches on a service name. Adding a service means adding an
adapter and its rules; it does not mean an ``if serviceId == ...`` in the
validator, the improver, the store or the screen.

**Scope, stated plainly.** This build registers one adapter: MEDial. The second,
non-medical adapter that 26번 Phase 3 asks for - a bounded "공동시설 이용 지원"
service - is **not implemented**; see ``docs/research/28_REFACTOR_LOG`` for why
and for what it would take. What is implemented here is the boundary that makes
adding one a matter of data and one module rather than of editing the loop.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from . import semantic_rules


class ServiceAdapter(Protocol):
    serviceId: str
    label: str
    category: str

    def rule_types(self) -> tuple[str, ...]:
        """Rule types a Change Set may edit for this service."""

    def capabilities(self) -> tuple[str, ...]:
        """Engine features this build actually implements for the service."""

    def supports_case(self, case: Any) -> str | None:
        """``None`` when this service can run on this community, else why not."""

    def catalog(self, active_decks: list[str] | None,
                policy: dict[str, Any] | None) -> list[dict[str, Any]]:
        """The rule catalogue the composer and the model propose from."""


@dataclass(frozen=True)
class MedialAdapter:
    """MEDial, an AI Care Orchestrator: the first service evaluated."""

    serviceId: str = "medial"
    label: str = "MEDial"
    category: str = "AI Care Orchestrator"

    def rule_types(self) -> tuple[str, ...]:
        return tuple(semantic_rules.SPECS)

    def capabilities(self) -> tuple[str, ...]:
        return (
            "contact.retry", "contact.quiet_window", "contact.helper_cap",
            "disclosure.level", "escalation.deadline", "strategy.head_first",
            "strategy.retry_then_clinic", "transport.candidate_order",
            "transport.detour_limit",
        )

    def supports_case(self, case: Any) -> str | None:
        """MEDial needs a desk to hand work to; the village head is needed only
        by the plans that route through one, and that is checked per plan
        (:func:`case_bundle.unsupported_reason`) rather than per service."""
        if case is None:
            return None
        if not case.has_role("health_staff"):
            return ("MEDial은 미해결 건을 기관으로 인계하는데 이 사례에는 보건소 담당자 "
                    "역할이 없다.")
        return None

    def catalog(self, active_decks: list[str] | None = None,
                policy: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        return semantic_rules.catalog(active_decks, policy)


ADAPTERS: dict[str, ServiceAdapter] = {"medial": MedialAdapter()}

#: The service this build evaluates by default. A second adapter would be
#: chosen per session, not per code path.
DEFAULT_SERVICE_ID = "medial"


def get_adapter(service_id: str | None = None) -> ServiceAdapter:
    try:
        return ADAPTERS[service_id or DEFAULT_SERVICE_ID]
    except KeyError as exc:
        raise ValueError("등록되지 않은 서비스다: %s" % service_id) from exc
