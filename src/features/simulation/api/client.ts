import type {
  Capabilities,
  GenerationComparison,
  SessionDetail,
  SessionStatusPayload,
} from './iteration';
import type {
  AttemptDetail,
  Catalog,
  CommandResult,
  Comparison,
  DesignFinding,
  DomainEvent,
  Observation,
  PersonasPayload,
  PolicyRevision,
  Snapshot,
  VillagePayload,
} from './types';

const BASE = '/api/sim';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** FastAPI puts the message in ``detail``; showing the raw JSON envelope instead
 *  would hide exactly the sentence that says which condition was refused. */
function readDetail(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
  } catch {
    /* not JSON; fall through to the raw text */
  }
  return body || fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    // A dead server is a tooling problem, never a simulation result.
    throw new ApiError('시뮬레이션 서버에 연결하지 못했습니다 (python server/sim_main.py)', 0);
  }
  if (!response.ok) {
    throw new ApiError(readDetail(await response.text(), response.statusText), response.status);
  }
  return (await response.json()) as T;
}

export interface PolicyEdit {
  reason: string;
  label?: string;
  contactStrategy?: string;
  params?: Record<string, unknown>;
}

export const api = {
  health: () => request<{ status: string; dataSource: string; isSynthetic: boolean }>('/health'),
  catalog: () => request<Catalog>('/catalog'),
  village: () => request<VillagePayload>('/village'),
  /** The raster is served by the local API from the git-ignored registry, so it
   *  is never part of the built bundle. */
  mapImageUrl: () => `${BASE}/village/map`,
  personas: () => request<PersonasPayload>('/personas'),

  attempt: (id: string) => request<AttemptDetail>(`/attempts/${id}`),
  events: (id: string, after = 0) =>
    request<{ events: DomainEvent[] }>(`/attempts/${id}/events?after=${after}`),
  observations: (id: string, actorId?: string) =>
    request<{ observations: Observation[] }>(
      `/attempts/${id}/observations${actorId ? `?actorId=${actorId}` : ''}`,
    ),
  snapshot: (id: string, seq: number) =>
    request<Snapshot>(`/attempts/${id}/snapshot?seq=${seq}`),

  createAttempt: (policyId: string, deckId?: string, resourceId?: string, label?: string) =>
    request<AttemptDetail>('/attempts', {
      method: 'POST',
      body: JSON.stringify({
        policyId,
        ...(deckId ? { scenarioDeckId: deckId } : {}),
        ...(resourceId ? { resourceRevisionId: resourceId } : {}),
        label,
      }),
    }),

  /** Same initial state, edited policy. */
  rerun: (id: string, body: PolicyEdit) =>
    request<AttemptDetail>(`/attempts/${id}/rerun`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Branch at a point in the parent's log; the prefix is kept. */
  fork: (id: string, atSeq: number, body: PolicyEdit) =>
    request<AttemptDetail>(`/attempts/${id}/fork`, {
      method: 'POST',
      body: JSON.stringify({ ...body, atSeq }),
    }),

  policies: () => request<{ policies: PolicyRevision[] }>('/policies'),
  createPolicy: (baseId: string, body: PolicyEdit) =>
    request<PolicyRevision>('/policies', {
      method: 'POST',
      body: JSON.stringify({ baseId, ...body }),
    }),

  findings: () => request<{ findings: DesignFinding[] }>('/findings'),
  createFinding: (body: {
    coreItem: string;
    comparedAttemptIds: string[];
    observation: string;
    interpretation: string;
    nextChange: string;
    fromPolicyId: string;
  }) => request<DesignFinding>('/findings', { method: 'POST', body: JSON.stringify(body) }),
  applyFinding: (
    findingId: string,
    body: {
      attemptId: string;
      mode: 'rerun' | 'fork';
      atSeq?: number;
      contactStrategy?: string;
      params?: Record<string, unknown>;
    },
  ) =>
    request<AttemptDetail>(`/findings/${findingId}/apply`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  command: (id: string, commandId: string, name: string, seq?: number) =>
    request<CommandResult>(`/attempts/${id}/commands`, {
      method: 'POST',
      body: JSON.stringify({ commandId, name, seq }),
    }),
  compare: (ids: string[]) => request<Comparison>(`/compare?ids=${ids.join(',')}`),

  // -- review-driven iteration ------------------------------------------
  // The loop runs on the server; the screen polls it. `blocking` is never set
  // from here, so a model-backed generation cannot hold a request open.
  iteration: {
    capabilities: () => request<Capabilities>('/iteration/capabilities'),
    sessions: () =>
      request<{ sessions: unknown[]; startPolicyId: string; capabilities: Capabilities }>(
        '/iteration/sessions',
      ),
    create: (body: {
      label: string;
      coreItem: string;
      basePolicyId: string;
      developmentDeckRefs: string[];
      resourceRevisionId: string;
      maxGenerations: number;
      maxChangeSetsPerGeneration?: number;
      callBudget?: number;
      reviewAdapter?: string;
      improvementAdapter?: string;
    }) =>
      request<SessionDetail>('/iteration/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    detail: (id: string) => request<SessionDetail>(`/iteration/sessions/${id}`),
    status: (id: string) => request<SessionStatusPayload>(`/iteration/sessions/${id}/status`),
    generations: (id: string) =>
      request<GenerationComparison>(`/iteration/sessions/${id}/generations`),
    command: (id: string, commandId: string, name: string, payload: Record<string, unknown> = {}) =>
      request<SessionStatusPayload>(`/iteration/sessions/${id}/commands`, {
        method: 'POST',
        body: JSON.stringify({ commandId, name, payload }),
      }),
    decide: (
      id: string,
      body: {
        disposition: 'adopt_for_field_review' | 'hold' | 'reject';
        generationId?: string | null;
        reasons: string[];
        supportedConditions: string[];
        tradeoffs: string[];
        dissent: string[];
        unansweredQuestions: string[];
      },
    ) =>
      request<{ decision: unknown; package: unknown }>(`/iteration/sessions/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    buildPackage: (id: string, generationId: string) =>
      request<unknown>(`/iteration/sessions/${id}/field-package/${generationId}`, {
        method: 'POST',
      }),
    /** The only call that creates source="human" data. Nothing else may. */
    submitHumanReview: (
      id: string,
      body: {
        packageId: string;
        reviewerRole: string;
        elicitation: string;
        actorId?: string | null;
        selectedEpisodeIds: string[];
        responses: Record<string, unknown>[];
        corrections: Record<string, unknown>[];
        agreement: string;
        consentScope: string;
      },
    ) =>
      request<{ id: string; source: 'human' }>(`/iteration/sessions/${id}/human-reviews`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
};
