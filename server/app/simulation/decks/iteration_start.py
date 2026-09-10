"""The v0 operating policy an iteration session starts from.

Doc 12 step 4 is "introduce the orchestrator and fix its initial procedures".
That initial version is not supposed to be a tuned answer - it is the first
plausible way of running the service, written before anybody has seen what it
does to the village. This one asks the village head first, tells the institution
everything, sets no handover deadline and leans on a single helper.

It is a *starting point for the loop*, not a recommendation, and it is separate
from the A/B policies used for the manual comparison so that neither is quietly
tuned into the other.
"""
from __future__ import annotations

from ..contracts import ContactStrategy, PolicyParams, PolicyRevision

POLICY_ITER_V0 = PolicyRevision(
    id="policy-IT-v0",
    parentId=None,
    coreItem="응답이 없거나 이동이 필요한 상황을 누구의 시간으로 해결할 것인가",
    label="v0 · 초기 운영안 (조율 절차 미정)",
    changes=[],
    contactStrategy=ContactStrategy.head_first,
    params=PolicyParams(
        # No retry, one helper, no deadline: the first draft of a procedure,
        # with the gaps a first draft has.
        retryCount=0,
        retryIntervalMin=40,
        quietWindowMin=0,
        helperContactCap=1,
        disclosure="named",
        escalateToInstitutionAfterMin=None,
        allowHeadContact=True,
        rideCandidateOrder="kin_first",
        maxRideDetourMin=20,
    ),
    assumptionRefs=["assumption-head-availability", "assumption-seat-capacity",
                    "assumption-clinic-capacity"],
)
