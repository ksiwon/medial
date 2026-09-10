import { create } from 'zustand';
import { api, ApiError, type PolicyEdit } from './api/client';
import type {
  AttemptDetail,
  Catalog,
  Comparison,
  DesignFinding,
  DomainEvent,
  Observation,
  PersonasPayload,
  ViewMode,
  VillagePayload,
} from './api/types';

// The replay cursor is a *sequence number*, not a time. Those were treated as
// interchangeable before, so stepping onto the first of ten events sharing a
// timestamp displayed all ten. ``cursorSeq`` is what the server stores and what
// this store trusts; ``atMs`` is derived from it for the map, and only runs
// ahead of it while the clock is playing.

interface Loaded {
  detail: AttemptDetail;
  events: DomainEvent[];
  /** What MEDial itself observed. The 'MEDial이 아는 것' view is projected from
   *  this, so the screen cannot show more than the orchestrator held. */
  medialObservations: Observation[];
}

interface SimState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  notice: string | null;
  village: VillagePayload | null;
  catalog: Catalog | null;
  personas: PersonasPayload | null;
  findings: DesignFinding[];
  attempts: Record<string, Loaded>;
  order: string[];
  activeId: string | null;
  compareIds: string[];
  comparison: Comparison | null;
  tab: 'run' | 'compare';
  viewMode: ViewMode;
  cursorSeq: number;
  atMs: number;
  playing: boolean;
  speed: number;
  selectedCluster: string | null;
  selectedActor: string | null;
  detailActor: string | null;
  editorOpen: boolean;
  /** Set while the researcher is turning a recorded finding into the next
   *  revision, so the policy editor knows to link the two. */
  pendingFinding: { id: string; attemptId: string; nextChange: string } | null;
  busy: boolean;

  bootstrap: () => Promise<void>;
  runPolicy: (policyId: string, deckId?: string, resourceId?: string) => Promise<void>;
  rerun: (attemptId: string, edit: PolicyEdit) => Promise<void>;
  forkAt: (attemptId: string, atSeq: number, edit: PolicyEdit) => Promise<void>;
  createFinding: (body: {
    coreItem: string;
    observation: string;
    interpretation: string;
    nextChange: string;
  }) => Promise<void>;
  beginApplyFinding: (finding: DesignFinding) => void;
  cancelApplyFinding: () => void;
  applyFinding: (
    mode: 'rerun' | 'fork',
    atSeq: number | undefined,
    edit: { contactStrategy?: string; params?: Record<string, unknown> },
  ) => Promise<void>;
  setActive: (id: string) => Promise<void>;
  setTab: (tab: 'run' | 'compare') => void;
  setViewMode: (mode: ViewMode) => void;
  setEditorOpen: (open: boolean) => void;
  dismissNotice: () => void;
  toggleCompare: (id: string) => void;
  refreshComparison: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  step: () => Promise<void>;
  stepBack: () => Promise<void>;
  seekToSeq: (seq: number) => Promise<void>;
  restart: () => Promise<void>;
  scrubTo: (atMs: number) => void;
  selectCluster: (key: string | null, actorId?: string | null) => void;
  setDetailActor: (id: string | null) => void;
  tick: (deltaMs: number) => void;
}

let commandCounter = 0;
const nextCommandId = (name: string) => `cmd-${name}-${Date.now()}-${commandCounter++}`;

const DAY_START_MS = 8 * 60 * 60 * 1000;

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** The clock a cursor position corresponds to. Cursor 0 is "before anything
 *  happened", which is the start of the working day, not 00:00. */
export function msAtSeq(events: DomainEvent[], seq: number): number {
  if (seq <= 0) return DAY_START_MS;
  const event = events.find((e) => e.seq === seq) ?? events[Math.min(seq, events.length) - 1];
  return event ? event.simTimeMs : DAY_START_MS;
}

/** The last event at or before a wall-clock time. Used only while playing, where
 *  the clock leads and the cursor follows. */
export function seqAt(events: DomainEvent[], atMs: number): number {
  let seq = 0;
  for (const event of events) {
    if (event.simTimeMs <= atMs) seq = event.seq;
    else break;
  }
  return seq;
}

/** Events the current view is allowed to show, filtered by sequence rather than
 *  by time so that events sharing a millisecond stay separable. */
export function eventsUpTo(
  events: DomainEvent[],
  cursorSeq: number,
  viewMode: ViewMode,
): DomainEvent[] {
  return events.filter((event) => {
    if (event.seq > cursorSeq) return false;
    if (viewMode === 'researcher') return true;
    return event.visibility.includes('MEDial');
  });
}

export const useSimStore = create<SimState>((set, get) => ({
  status: 'idle',
  error: null,
  notice: null,
  village: null,
  catalog: null,
  personas: null,
  findings: [],
  attempts: {},
  order: [],
  activeId: null,
  compareIds: [],
  comparison: null,
  tab: 'run',
  viewMode: 'researcher',
  cursorSeq: 0,
  atMs: DAY_START_MS,
  playing: false,
  speed: 120,
  selectedCluster: null,
  selectedActor: null,
  detailActor: null,
  editorOpen: false,
  pendingFinding: null,
  busy: false,

  bootstrap: async () => {
    // React StrictMode invokes effects twice in development; without this guard
    // the first run would create two attempts per policy.
    if (get().status !== 'idle') return;
    set({ status: 'loading', error: null });
    try {
      const [village, catalog, personas] = await Promise.all([
        api.village(),
        api.catalog(),
        api.personas(),
      ]);
      set({ village, catalog, personas, findings: catalog.findings, status: 'ready' });
      // Loading the workspace *reads*. It does not run experiments: the old
      // bootstrap started policy A and policy B whenever the log happened to be
      // empty, so simply opening the tool in a fresh browser manufactured two
      // attempts nobody asked for. The empty state is now the prepare screen.
      //
      // Nor does it eagerly open every stored attempt. The catalogue already
      // carries the list; a run's events are fetched when something actually
      // shows it, which also means one unreadable record can no longer blank
      // the tool at startup.
      const last = catalog.attempts[catalog.attempts.length - 1];
      if (last) {
        try {
          // Reopen where the researcher left off: the cursor lives in the
          // database, so a restart lands on the same event.
          await get().setActive(last.id);
          set({ compareIds: catalog.attempts.slice(-2).map((a) => a.id) });
        } catch (error) {
          set({
            notice: `마지막 시도(${last.id})를 불러오지 못했습니다: ${describe(error)}. 다른 시도는 그대로 있습니다.`,
          });
        }
      }
    } catch (error) {
      set({ status: 'error', error: describe(error) });
    }
  },

  runPolicy: async (policyId, deckId, resourceId) => {
    set({ busy: true, error: null });
    try {
      const detail = await api.createAttempt(policyId, deckId, resourceId);
      await adopt(set, get, detail);
      set((state) => ({
        compareIds:
          state.compareIds.length < 2
            ? [...state.compareIds, detail.attempt.id]
            : state.compareIds,
      }));
    } catch (error) {
      set({ error: describe(error) });
    } finally {
      set({ busy: false });
    }
  },

  rerun: async (attemptId, edit) => {
    set({ busy: true, error: null });
    try {
      const detail = await api.rerun(attemptId, edit);
      await adopt(set, get, detail);
      set({
        editorOpen: false,
        notice: `재실행: 같은 초기 상태에서 정책만 바꿔 처음부터 다시 돌렸습니다 (${detail.attempt.id}).`,
      });
    } catch (error) {
      set({ error: describe(error) });
    } finally {
      set({ busy: false });
    }
  },

  forkAt: async (attemptId, atSeq, edit) => {
    set({ busy: true, error: null });
    try {
      const detail = await api.fork(attemptId, atSeq, edit);
      await adopt(set, get, detail);
      set({
        editorOpen: false,
        notice: `분기: 사건 ${atSeq}까지의 상태·기억·예약·로그를 그대로 두고 그 지점부터 정책을 바꿨습니다 (${detail.attempt.id}).`,
      });
    } catch (error) {
      set({ error: describe(error) });
    } finally {
      set({ busy: false });
    }
  },

  createFinding: async ({ coreItem, observation, interpretation, nextChange }) => {
    const { compareIds, attempts } = get();
    const from = compareIds[0] ? attempts[compareIds[0]]?.detail.policy.id : undefined;
    if (!from || compareIds.length < 2) {
      set({ error: '발견을 적으려면 비교 중인 시도가 두 개 이상 있어야 합니다.' });
      return;
    }
    set({ busy: true, error: null });
    try {
      await api.createFinding({
        coreItem,
        comparedAttemptIds: compareIds,
        observation,
        interpretation,
        nextChange,
        fromPolicyId: from,
      });
      const { findings } = await api.findings();
      set({ findings, notice: '발견을 기록했습니다. 여기서 다음 revision을 만들 수 있습니다.' });
    } catch (error) {
      set({ error: describe(error) });
    } finally {
      set({ busy: false });
    }
  },

  beginApplyFinding: (finding) =>
    set({
      pendingFinding: {
        id: finding.id,
        attemptId: finding.comparedAttemptIds[0],
        nextChange: finding.nextChange,
      },
      tab: 'run',
      editorOpen: true,
    }),

  cancelApplyFinding: () => set({ pendingFinding: null }),

  applyFinding: async (mode, atSeq, edit) => {
    const pending = get().pendingFinding;
    if (!pending) return;
    set({ busy: true, error: null });
    try {
      const detail = await api.applyFinding(pending.id, {
        attemptId: pending.attemptId,
        mode,
        ...(atSeq === undefined ? {} : { atSeq }),
        ...edit,
      });
      await adopt(set, get, detail);
      const { findings } = await api.findings();
      set({
        findings,
        tab: 'run',
        editorOpen: false,
        pendingFinding: null,
        notice: `발견 → 새 revision(${detail.attempt.policyId}) → 새 시도(${detail.attempt.id})까지 이어졌습니다.`,
      });
    } catch (error) {
      set({ error: describe(error) });
    } finally {
      set({ busy: false });
    }
  },

  setActive: async (id) => {
    const loaded = get().attempts[id] ?? (await loadAttempt(set, get, id));
    const cursor = loaded.detail.attempt.cursorSeq ?? 0;
    set({
      activeId: id,
      playing: false,
      selectedCluster: null,
      detailActor: null,
      cursorSeq: cursor,
      atMs: msAtSeq(loaded.events, cursor),
    });
  },

  setTab: (tab) => set({ tab }),
  setViewMode: (viewMode) => set({ viewMode, selectedCluster: null }),
  setEditorOpen: (editorOpen) =>
    set({ editorOpen, ...(editorOpen ? {} : { pendingFinding: null }) }),
  dismissNotice: () => set({ notice: null }),

  toggleCompare: (id) =>
    set((state) => ({
      compareIds: state.compareIds.includes(id)
        ? state.compareIds.filter((x) => x !== id)
        : [...state.compareIds, id].slice(-3),
      comparison: null,
    })),

  refreshComparison: async () => {
    const ids = get().compareIds;
    if (ids.length < 2) {
      set({ comparison: null });
      return;
    }
    try {
      set({ comparison: await api.compare(ids) });
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  play: async () => {
    const id = get().activeId;
    if (!id) return;
    set({ playing: true });
    try {
      await api.command(id, nextCommandId('play'), 'play');
    } catch (error) {
      set({ error: describe(error), playing: false });
    }
  },

  pause: async () => {
    const id = get().activeId;
    if (!id) return;
    set({ playing: false });
    const loaded = get().attempts[id];
    const seq = loaded ? seqAt(loaded.events, get().atMs) : 0;
    try {
      // Record where the researcher actually stopped, so the stored cursor and
      // the screen agree after a reload.
      await api.command(id, nextCommandId('seek'), 'seek', seq);
      await api.command(id, nextCommandId('pause'), 'pause');
      set({ cursorSeq: seq });
      await loadAttempt(set, get, id);
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  step: async () => {
    const id = get().activeId;
    if (!id) return;
    set({ playing: false });
    try {
      // The server advances by exactly one sequence number. Ten events can share
      // a millisecond and each is its own step.
      const result = await api.command(id, nextCommandId('step'), 'step');
      applyCursor(set, get, id, result.cursorSeq);
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  stepBack: async () => {
    const id = get().activeId;
    if (!id) return;
    await get().seekToSeq(Math.max(0, get().cursorSeq - 1));
  },

  seekToSeq: async (seq) => {
    const id = get().activeId;
    if (!id) return;
    set({ playing: false });
    try {
      const result = await api.command(id, nextCommandId('seek'), 'seek', seq);
      applyCursor(set, get, id, result.cursorSeq);
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  restart: async () => {
    const id = get().activeId;
    if (!id) return;
    set({ playing: false });
    try {
      const result = await api.command(id, nextCommandId('cancel'), 'cancel');
      applyCursor(set, get, id, result.cursorSeq);
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  scrubTo: (atMs) => {
    const { activeId, attempts } = get();
    const loaded = activeId ? attempts[activeId] : null;
    set({ atMs, cursorSeq: loaded ? seqAt(loaded.events, atMs) : 0, playing: false });
  },

  selectCluster: (key, actorId = null) => set({ selectedCluster: key, selectedActor: actorId }),
  setDetailActor: (id) => set({ detailActor: id }),

  tick: (deltaMs) => {
    const { playing, atMs, speed, activeId, attempts } = get();
    if (!playing || !activeId) return;
    const loaded = attempts[activeId];
    const horizon = loaded?.detail.timeline?.horizonMs ?? 20 * 60 * 60 * 1000;
    const next = atMs + deltaMs * speed;
    if (next >= horizon) {
      set({ atMs: horizon, cursorSeq: loaded ? loaded.events.length : 0 });
      void get().pause();
      return;
    }
    set({ atMs: next, cursorSeq: loaded ? seqAt(loaded.events, next) : 0 });
  },
}));

function applyCursor(
  set: (partial: Partial<SimState>) => void,
  get: () => SimState,
  id: string,
  cursorSeq: number,
) {
  const loaded = get().attempts[id];
  if (!loaded) return;
  set({ cursorSeq, atMs: msAtSeq(loaded.events, cursorSeq) });
}

async function adopt(
  set: (partial: Partial<SimState> | ((s: SimState) => Partial<SimState>)) => void,
  get: () => SimState,
  detail: AttemptDetail,
) {
  const id = detail.attempt.id;
  const [{ events }, { observations }] = await Promise.all([
    api.events(id),
    api.observations(id, 'MEDial'),
  ]);
  set((state) => ({
    attempts: { ...state.attempts, [id]: { detail, events, medialObservations: observations } },
    order: state.order.includes(id) ? state.order : [...state.order, id],
    activeId: id,
    cursorSeq: detail.attempt.cursorSeq ?? 0,
    atMs: msAtSeq(events, detail.attempt.cursorSeq ?? 0),
    playing: false,
  }));
}

async function loadAttempt(
  set: (partial: Partial<SimState> | ((s: SimState) => Partial<SimState>)) => void,
  get: () => SimState,
  id: string,
): Promise<Loaded> {
  const detail = await api.attempt(id);
  const [{ events }, { observations }] = await Promise.all([
    api.events(id),
    api.observations(id, 'MEDial'),
  ]);
  const loaded: Loaded = { detail, events, medialObservations: observations };
  set((state) => ({
    attempts: { ...state.attempts, [id]: loaded },
    order: state.order.includes(id) ? state.order : [...state.order, id],
  }));
  return loaded;
}

export const DAY_START = DAY_START_MS;
