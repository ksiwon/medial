import { create } from 'zustand';
import { api, ApiError } from './api/client';
import type {
  Capabilities,
  GenerationComparison,
  SessionDetail,
  SessionStatus,
} from './api/iteration';
import { RUNNING_STATUSES } from './api/iteration';
import { useSimStore } from './store';

// A separate store from the attempt/replay one. They share the map and the
// event log, but the iteration loop has its own lifetime: it keeps running on
// the server while the researcher reads an earlier generation, and reading an
// earlier generation must never change what the loop is doing.
//
// Polling rather than streaming: a rule-adapter session finishes in under a
// second and a model-backed one takes minutes, so a 1.2 s poll while the server
// says it is running is enough and needs no socket.

const POLL_MS = 1200;

let commandCounter = 0;
const nextCommandId = (name: string) => `it-${name}-${Date.now()}-${commandCounter++}`;

/**
 * What to show a person when a call failed.
 *
 * The server's own refusals already say which condition was refused, in Korean,
 * and those must pass through untouched. What must not reach the screen is a
 * transport failure's stock English: with the server down, the dev proxy answers
 * "Internal Server Error", and the prepare screen printed that verbatim between
 * two Korean sentences. It also tells the reader nothing they can act on.
 */
function describe(error: unknown): string {
  const unreachable =
    '연구 서버가 응답하지 않습니다. 서버(python server/sim_main.py)가 떠 있는지 확인한 뒤 다시 시작하세요.';
  if (error instanceof ApiError) {
    const stock = /^(internal server error|bad gateway|service unavailable|gateway timeout|not found)$/i;
    if (error.status >= 500 && stock.test(error.message.trim())) {
      return `${unreachable} (HTTP ${error.status})`;
    }
    return error.message;
  }
  // fetch() rejects with a TypeError when it cannot reach the host at all.
  if (error instanceof TypeError) return unreachable;
  return error instanceof Error ? error.message : String(error);
}

/** The three top-level screens (doc 15 section 3). The six research steps of
 *  doc 12 still exist and still run in that order - they are the *loop*, shown
 *  as read-only progress - but they are no longer six places to click. */
export type Screen = 'prepare' | 'observe' | 'compare';

/** Which body of material a screen is reading. Separate from `Screen` on
 *  purpose: the UI stage and the kind of record being read are different
 *  questions, and collapsing them is what produced seven tabs. */
export type CompareView = 'summary' | 'all_generations' | 'manual';

/** Exactly the body the create endpoint takes. Named so the prepare screen and
 *  the store cannot drift apart about what an experiment is. */
export interface StartRequest {
  label: string;
  coreItem: string;
  basePolicyId: string;
  developmentDeckRefs: string[];
  resourceRevisionId: string;
  maxGenerations: number;
  maxChangeSetsPerGeneration: number;
  callBudget: number;
  reviewAdapter: string;
  improvementAdapter: string;
}

/** What happened to the last single-press start, kept explicit so create
 *  failure, start failure and "already running" are three visible outcomes
 *  rather than one red box. */
export type StartPhase =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'starting'; sessionId: string }
  | { kind: 'running'; sessionId: string }
  | { kind: 'create_failed'; message: string }
  /** The session exists. Retrying must start *this* one, never make another. */
  | { kind: 'start_failed'; sessionId: string; message: string };

interface IterationState {
  capabilities: Capabilities | null;
  sessionId: string | null;
  detail: SessionDetail | null;
  comparison: GenerationComparison | null;
  /** Which generation the review / improvement screens are reading. Changing it
   *  never changes what the loop is running. */
  viewGenerationId: string | null;
  screen: Screen;
  compareView: CompareView;
  /** Which version the *comparison* is reading. Independent of the version the
   *  loop is processing; reading an old one changes neither. */
  compareLeftId: string | null;
  compareRightId: string | null;
  /** Open when the designer is choosing what to take to the field. */
  fieldSheetOpen: boolean;
  startPhase: StartPhase;
  busy: boolean;
  error: string | null;
  notice: string | null;
  pollHandle: number | null;

  init: () => Promise<void>;
  /** Create the session and start it, as one press. Returns nothing the caller
   *  has to interpret: the outcome lives in `startPhase`. */
  startExperiment: (body: StartRequest) => Promise<void>;
  /** Retry a start that failed after the session was created. Never creates a
   *  second session. */
  retryStart: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  send: (name: string, payload?: Record<string, unknown>) => Promise<void>;
  confirmChangeSet: (changeSetId: string, reason: string) => Promise<void>;
  saveResearcherChangeSet: (body: Record<string, unknown>) => Promise<void>;
  decide: (body: {
    disposition: 'adopt_for_field_review' | 'hold' | 'reject';
    generationId: string | null;
    reasons: string[];
    supportedConditions: string[];
    tradeoffs: string[];
    dissent: string[];
    unansweredQuestions: string[];
  }) => Promise<void>;
  submitHumanReview: (body: {
    packageId: string;
    reviewerRole: string;
    elicitation: string;
    actorId: string | null;
    selectedEpisodeIds: string[];
    responses: Record<string, unknown>[];
    corrections: Record<string, unknown>[];
    agreement: string;
    consentScope: string;
  }) => Promise<void>;
  setScreen: (screen: Screen) => void;
  setCompareView: (view: CompareView) => void;
  setCompareSides: (left: string | null, right: string | null) => void;
  setFieldSheet: (open: boolean) => void;
  setViewGeneration: (id: string) => void;
  /** Open the scene a review item cites: switch to that attempt and seek to the
   *  event. This is a read of a stored log; it invokes no adapter. */
  openScene: (attemptId: string, eventId: string) => Promise<void>;
  dismiss: () => void;
  stopPolling: () => void;
}

export const useIterationStore = create<IterationState>((set, get) => ({
  capabilities: null,
  sessionId: null,
  detail: null,
  comparison: null,
  viewGenerationId: null,
  screen: 'prepare',
  compareView: 'summary',
  compareLeftId: null,
  compareRightId: null,
  fieldSheetOpen: false,
  startPhase: { kind: 'idle' },
  busy: false,
  error: null,
  notice: null,
  pollHandle: null,

  init: async () => {
    if (get().capabilities) return;
    try {
      const { sessions, capabilities } = await api.iteration.sessions();
      set({ capabilities });
      const rows = sessions as { id: string; updatedAt: string }[];
      if (rows.length > 0) {
        // Restoring the session the researcher last worked in is a read. It
        // starts nothing: `openSession` never sends a command, so a refresh
        // cannot re-run a loop that already finished.
        const latest = [...rows].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).pop()!;
        await get().openSession(latest.id);
        set({ screen: 'observe' });
      }
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  // One press, two server calls, four distinct outcomes.
  //
  // `createSession` used to swallow its own error and return void, so a caller
  // that simply awaited it and then sent `start` would fire the command at a
  // session that was never created - or, on a retry, create a second one. This
  // action holds the id itself and keeps the two failures apart: a create that
  // fails leaves nothing behind, and a start that fails leaves a session whose
  // start can be retried.
  startExperiment: async (body) => {
    if (get().busy) return; // double-click lock
    set({ busy: true, error: null, notice: null, startPhase: { kind: 'creating' } });

    let sessionId: string;
    try {
      const detail = await api.iteration.create(body);
      sessionId = detail.session.id;
      set({
        sessionId,
        detail,
        viewGenerationId: detail.generations[0]?.id ?? null,
        startPhase: { kind: 'starting', sessionId },
      });
    } catch (error) {
      set({ busy: false, startPhase: { kind: 'create_failed', message: describe(error) } });
      return;
    }

    set({ busy: false });
    await get().retryStart();
  },

  retryStart: async () => {
    const phase = get().startPhase;
    const sessionId =
      phase.kind === 'starting' || phase.kind === 'start_failed' ? phase.sessionId : get().sessionId;
    if (!sessionId) {
      set({ startPhase: { kind: 'create_failed', message: '시작할 session이 없습니다.' } });
      return;
    }
    if (get().busy) return;
    set({ busy: true, error: null, startPhase: { kind: 'starting', sessionId } });
    try {
      await api.iteration.command(sessionId, nextCommandId('start'), 'start');
      set({ startPhase: { kind: 'running', sessionId }, screen: 'observe' });
      await get().refresh();
    } catch (error) {
      // 409 from the server means this session is already past `created`. That
      // is a duplicate press, not a failure: adopt it and carry on rather than
      // offering to start it again.
      if (error instanceof ApiError && error.status === 409) {
        set({
          startPhase: { kind: 'running', sessionId },
          screen: 'observe',
          notice: '이미 시작된 실험입니다. 진행 중인 실행을 그대로 보고 있습니다.',
        });
        await get().refresh();
      } else {
        set({
          startPhase: { kind: 'start_failed', sessionId, message: describe(error) },
        });
      }
    } finally {
      set({ busy: false });
    }
  },

  openSession: async (id) => {
    set({ busy: true, error: null });
    try {
      const detail = await api.iteration.detail(id);
      const comparison = await api.iteration.generations(id);
      set({
        sessionId: id,
        detail,
        comparison,
        viewGenerationId: get().viewGenerationId ?? detail.generations[0]?.id ?? null,
        // A restored session is already past `created`; recording that here
        // stops the prepare screen offering to start it a second time.
        startPhase:
          detail.session.status === 'created'
            ? { kind: 'idle' }
            : { kind: 'running', sessionId: id },
      });
      seedCompareSides(set, get, detail);
      schedulePoll(set, get, detail.session.status, detail.running);
    } catch (error) {
      set({ error: describe(error) });
    } finally {
      set({ busy: false });
    }
  },

  refresh: async () => {
    const id = get().sessionId;
    if (!id) return;
    try {
      const detail = await api.iteration.detail(id);
      const comparison = await api.iteration.generations(id);
      const current = get().viewGenerationId;
      const stillThere = detail.generations.some((g) => g.id === current);
      set({
        detail,
        comparison,
        viewGenerationId: stillThere ? current : (detail.generations[0]?.id ?? null),
      });
      seedCompareSides(set, get, detail);
      schedulePoll(set, get, detail.session.status, detail.running);
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  send: async (name, payload = {}) => {
    const id = get().sessionId;
    if (!id) return;
    set({ busy: true, error: null });
    try {
      await api.iteration.command(id, nextCommandId(name), name, payload);
      await get().refresh();
    } catch (error) {
      set({ error: describe(error) });
    } finally {
      set({ busy: false });
    }
  },

  confirmChangeSet: async (changeSetId, reason) => {
    await get().send('confirm_change_set', { changeSetId, reason });
    set({
      notice: '연구자가 확정한 Change Set 하나로 새 MEDial revision을 실행합니다.',
    });
  },

  saveResearcherChangeSet: async (body) => {
    await get().send('save_researcher_change_set', body);
    set({ notice: '연구자 수정본을 새 Change Set으로 저장했습니다. 원본 기록은 유지됩니다.' });
  },

  decide: async (body) => {
    const id = get().sessionId;
    if (!id) return;
    set({ busy: true, error: null });
    try {
      await api.iteration.decide(id, body);
      await get().refresh();
      set({
        fieldSheetOpen: true,
        notice:
          body.disposition === 'hold'
            ? '보류로 기록했습니다. 이유와 남은 질문이 함께 저장됩니다.'
            : '선택을 기록하고 현장 검토용 장면 패키지를 만들었습니다.',
      });
    } catch (error) {
      set({ error: describe(error) });
    } finally {
      set({ busy: false });
    }
  },

  submitHumanReview: async (body) => {
    const id = get().sessionId;
    if (!id) return;
    set({ busy: true, error: null });
    try {
      const saved = await api.iteration.submitHumanReview(id, body);
      await get().refresh();
      set({
        notice: `실제 사람의 응답으로 저장했습니다 (${saved.id}). 모의 리뷰와 합산하지 않습니다.`,
      });
    } catch (error) {
      set({ error: describe(error) });
    } finally {
      set({ busy: false });
    }
  },

  setScreen: (screen) => set({ screen }),
  setCompareView: (compareView) => set({ compareView }),
  setCompareSides: (compareLeftId, compareRightId) => set({ compareLeftId, compareRightId }),
  setFieldSheet: (fieldSheetOpen) => set({ fieldSheetOpen }),
  setViewGeneration: (viewGenerationId) => set({ viewGenerationId }),

  openScene: async (attemptId, eventId) => {
    const sim = useSimStore.getState();
    try {
      await sim.setActive(attemptId);
      const loaded = useSimStore.getState().attempts[attemptId];
      const event = loaded?.events.find((e) => e.id === eventId);
      if (!event) {
        set({ error: `이 시도의 로그에서 사건 ${eventId} 을(를) 찾지 못했습니다.` });
        return;
      }
      await useSimStore.getState().seekToSeq(event.seq);
      // Opening a cited scene is a read of a stored log. It moves the observe
      // screen's cursor and touches nothing else - no adapter runs, and the
      // loop keeps doing whatever it was doing.
      set({ screen: 'observe' });
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  dismiss: () => set({ notice: null, error: null }),

  stopPolling: () => {
    const handle = get().pollHandle;
    if (handle) window.clearTimeout(handle);
    set({ pollHandle: null });
  },
}));

/**
 * Default the comparison to a pair that is actually comparable.
 *
 * "Newest against oldest" looked right and read badly: the highest index is
 * may be a draft that was never executed. The default is the newest confirmed
 * version, against the version it came from,
 * which is the one pair where "same day, one condition changed" holds.
 *
 * Newest is not "best" and is never labelled as one. Both sides stay
 * user-selectable, and every version remains reachable from 전체 시도 보기.
 */
function seedCompareSides(
  set: (partial: Partial<IterationState>) => void,
  get: () => IterationState,
  detail: SessionDetail,
) {
  const ordered = [...detail.generations].sort((a, b) => a.index - b.index);
  if (ordered.length === 0) return;
  const state = get();
  const known = new Set(ordered.map((g) => g.id));

  // A generation exists only after researcher confirmation; use the newest child.
  const advanced = [...ordered]
    .reverse()
    .find((g) => g.outcome !== 'blocked' && g.parentGenerationId != null);
  const fallbackRight = ordered[ordered.length - 1];

  const right =
    state.compareRightId && known.has(state.compareRightId)
      ? state.compareRightId
      : (advanced?.id ?? fallbackRight.id);

  const rightRow = ordered.find((g) => g.id === right);
  const left =
    state.compareLeftId && known.has(state.compareLeftId)
      ? state.compareLeftId
      : rightRow?.parentGenerationId && known.has(rightRow.parentGenerationId)
        ? rightRow.parentGenerationId
        : ordered[0].id;

  if (left !== state.compareLeftId || right !== state.compareRightId) {
    set({ compareLeftId: left, compareRightId: right });
  }
}

function schedulePoll(
  set: (partial: Partial<IterationState>) => void,
  get: () => IterationState,
  status: SessionStatus,
  running: boolean,
) {
  const previous = get().pollHandle;
  if (previous) window.clearTimeout(previous);
  // Only while the loop is actually moving. A blocked or finished session must
  // not keep the browser talking to the server about nothing.
  if (!running && !RUNNING_STATUSES.includes(status)) {
    set({ pollHandle: null });
    return;
  }
  const handle = window.setTimeout(() => {
    void get().refresh();
  }, POLL_MS);
  set({ pollHandle: handle });
}
