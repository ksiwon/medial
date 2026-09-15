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

/** The three top-level screens (doc 19 section 9, 26번 5장):
 *
 *  - ``case``        사례와 서비스 경험 - the village, what is fixed, and the run;
 *  - ``evaluations`` 주민 평가 - the screen the loop arrives at when a day ends;
 *  - ``improve``     개선과 확인 - the change, its confirmation, the comparison
 *                    and the field record.
 *
 *  The six research steps of doc 12 still run in that order on the server; they
 *  are read-only progress, not six places to click. */
export type Screen = 'case' | 'evaluations' | 'improve';

/** Inside 사례와 서비스 경험: setting a run up, or reading the one that ran.
 *  ``auto`` is the default and means "whichever fits": a workspace with a run
 *  in it opens on that run, an empty one opens on the setup. Only an explicit
 *  choice pins it, so reopening the tool does not land on a blank form beside
 *  a day that already happened. */
export type CaseView = 'auto' | 'setup' | 'experience';

/** Advanced reads that are reachable but do not occupy the default screen. */
export type CompareView = 'summary' | 'all_generations';

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
  /** Who runs the village: rules, or MEDial's head and every resident as models. */
  behaviourAdapter: string;
  /** The health centre and 119: a fixed procedure, or the head-tier model. */
  institutionAdapter: string;
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
  caseView: CaseView;
  compareView: CompareView;
  /** Set once when a run finishes, so the loop lands on the evaluations rather
   *  than leaving the reader on the map. Cleared when a new run starts. */
  landedOnEvaluations: boolean;
  /** Which version the *comparison* is reading. Independent of the version the
   *  loop is processing; reading an old one changes neither. */
  compareLeftId: string | null;
  compareRightId: string | null;
  /** True once the researcher has chosen the sides themselves. Until then the
   *  comparison follows the newest confirmed version, so a run that has just
   *  finished is the one being read rather than the pair from before it. */
  compareSidesPinned: boolean;
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
  /** Resolves to the server's refusal text, or ``null`` when the draft was
   *  saved. The composer needs the text in place beside its fields rather than
   *  as a banner, and it must keep the input either way. */
  saveResearcherChangeSet: (body: Record<string, unknown>) => Promise<string | null>;
  /** "이번에는 수정하지 않음": an explicit end with its reason. Runs nothing. */
  declineChanges: (reason: string) => Promise<void>;
  decide: (body: {
    disposition: 'adopt_for_field_review' | 'hold' | 'reject';
    generationId: string | null;
    reasons: string[];
    supportedConditions: string[];
    tradeoffs: string[];
    dissent: string[];
    unansweredQuestions: string[];
  }) => Promise<void>;
  submitHumanReview: (body: Record<string, unknown>) => Promise<void>;
  /** Record the moment a respondent is shown the simulated evaluation. The
   *  server refuses it when their independent answer is not on file. */
  recordDisclosure: (body: {
    packageId: string;
    episodeId: string;
    respondentId: string;
    shownReviewIds: string[];
  }) => Promise<void>;
  setScreen: (screen: Screen) => void;
  setCaseView: (view: CaseView) => void;
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
  screen: 'case',
  caseView: 'auto',
  compareView: 'summary',
  landedOnEvaluations: false,
  compareLeftId: null,
  compareRightId: null,
  compareSidesPinned: false,
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
        // Only the case view, never the screen: restoring is asynchronous, and
        // setting the screen here overrode a navigation the reader had already
        // made while it was loading (seen in a browser, 2026-09-15). The
        // default screen is 사례와 서비스 경험 anyway.
        set({ caseView: 'auto' });
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
      set({ startPhase: { kind: 'running', sessionId }, screen: 'case',
            caseView: 'experience', landedOnEvaluations: false });
      await get().refresh();
    } catch (error) {
      // 409 from the server means this session is already past `created`. That
      // is a duplicate press, not a failure: adopt it and carry on rather than
      // offering to start it again.
      if (error instanceof ApiError && error.status === 409) {
        set({
          startPhase: { kind: 'running', sessionId },
          screen: 'case',
          caseView: 'experience',
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
      landOnEvaluations(set, get, detail);
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
    const id = get().sessionId;
    if (!id) return '열려 있는 실험이 없습니다.';
    set({ busy: true, error: null });
    try {
      await api.iteration.command(id, nextCommandId('save'), 'save_researcher_change_set', body);
      await get().refresh();
      set({ notice: '수정안을 저장했습니다. 아직 실행되지 않았고 원본 초안도 그대로입니다.' });
      return null;
    } catch (error) {
      // Not a banner: the composer shows this next to the fields and keeps
      // everything the researcher typed.
      return describe(error);
    } finally {
      set({ busy: false });
    }
  },

  declineChanges: async (reason) => {
    await get().send('decline_changes', { reason });
    set({ notice: '이번에는 수정하지 않기로 기록했습니다. 실행된 것은 없습니다.' });
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

  recordDisclosure: async (body) => {
    const id = get().sessionId;
    if (!id) return;
    set({ busy: true, error: null });
    try {
      await api.iteration.recordDisclosure(id, body);
      await get().refresh();
      set({
        notice:
          '모의 평가를 공개한 시점을 기록했습니다. 앱 밖에서 이미 들었을 수 있으므로 무편향 응답을 보증하지는 않습니다.',
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
      const saved = await api.iteration.submitHumanReview(
        id,
        body as Parameters<typeof api.iteration.submitHumanReview>[1],
      );
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
  setCaseView: (caseView) => set({ caseView }),
  setCompareView: (compareView) => set({ compareView }),
  setCompareSides: (compareLeftId, compareRightId) =>
    set({ compareLeftId, compareRightId, compareSidesPinned: true }),
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
      set({ screen: 'case', caseView: 'experience' });
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

  // Unpinned, the right side follows the newest confirmed version: after a
  // change is confirmed and rerun, the pair on screen was still the one from
  // before it, and the rule-application row read "no record" about a run that
  // had one (seen in a browser, 2026-09-15).
  const right =
    state.compareSidesPinned && state.compareRightId && known.has(state.compareRightId)
      ? state.compareRightId
      : (advanced?.id ?? fallbackRight.id);

  const rightRow = ordered.find((g) => g.id === right);
  const left =
    state.compareSidesPinned && state.compareLeftId && known.has(state.compareLeftId)
      ? state.compareLeftId
      : rightRow?.parentGenerationId && known.has(rightRow.parentGenerationId)
        ? rightRow.parentGenerationId
        : ordered[0].id;

  if (left !== state.compareLeftId || right !== state.compareRightId) {
    set({ compareLeftId: left, compareRightId: right });
  }
}

/**
 * When the day's evaluations exist and the loop has stopped moving, the reader
 * is taken to them once.
 *
 * Doc 19 makes Resident Evaluations the centre of the product; leaving the
 * reader on the map after a run made them the thing you had to go looking for.
 * Once only, and never while the loop is still running: being moved mid-read
 * would be worse than arriving late.
 */
function landOnEvaluations(
  set: (partial: Partial<IterationState>) => void,
  get: () => IterationState,
  detail: SessionDetail,
) {
  const state = get();
  if (state.landedOnEvaluations || detail.running) return;
  if (RUNNING_STATUSES.includes(detail.session.status)) return;
  // Only from the screen the run was watched on. A poll that arrives while the
  // researcher is already reading the improvement screen must not pull them
  // back; being moved mid-read is worse than arriving late.
  if (state.screen !== 'case') return;
  const hasReviews = detail.generations.some((g) => g.reviews.length > 0);
  if (!hasReviews) return;
  set({ landedOnEvaluations: true, screen: 'evaluations' });
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
