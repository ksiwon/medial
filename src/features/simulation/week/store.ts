import { create } from 'zustand';
import { api, ApiError } from '../api/client';
import { versionOf, type Paths } from './selectors';
import type { Step, Week } from './types';

// Where the visitor is in the week. One path, no branches to back out of:
//
//   week  ->  telling (the event's scenes, as they ran in the version being read)  ->  evaluations  ->  choose
//        ^______________________ a choice makes the next version of that event, and the wall is back at the week _/
//   ... and from the week (or when nobody is left at the tablet) the closing: what was changed this visit, then the
//   closing words, then back to the start (week/auto.ts keeps those clocks).
//
// An event is read in versions: ver1 is how it first ran, and choosing a request makes ver2 (that request's scene and
// what the residents made of it); opening the event again reads ver2, and offers requests of its own. A version with
// nothing to choose is the end of that event. Every scene and evaluation was written and checked before the exhibition
// (server/.../week.py); a choice opens what that request's record already says. Nothing here runs anything.

interface WeekState {
  loaded: boolean;
  week: Week | null;
  error: string | null;
  /** The visitor pressed start and the opening film has been played or skipped. */
  introStarted: boolean;
  pathStarted: boolean;
  step: Step;
  eventId: string | null;
  /** The line the telling has reached, counted across the scenes of the version being read. */
  lineIndex: number;
  /** Which resident's card is open on the evaluations page (null: the list). */
  /** The events the visitor has opened. Not shown: only whether anyone has been here at all. */
  seen: string[];
  /** The requests chosen in each event, in order: its version is the path's length + 1. */
  paths: Paths;
  /** The request a finger rests on at the tablet before it is confirmed: lit on the wall, nothing runs yet. */
  considering: string | null;
  /** A request was just confirmed: the wall says a new simulation is being made for a few seconds, then the week. */
  generating: boolean;
  /** The closing page has gone on from what was changed to the closing words. */
  closingWords: boolean;
  /** When the tablet last pressed anything (ms): every waiting clock counts from it. */
  lastPress: number;

  init: () => Promise<void>;
  startIntro: () => void;
  enterWeek: () => void;
  openEvent: (eventId: string) => void;
  setLine: (index: number) => void;
  goEvaluations: () => void;
  /** Back to the telling of this version, from its evaluations. */
  backToTelling: () => void;
  /** After the evaluations: on to the requests of this version. */
  goChoose: () => void;
  chooseRequest: (requestId: string) => void;
  endGenerating: () => void;
  backToWeek: () => void;
  consider: (requestId: string | null) => void;
  /** The visitor is done: the closing page. */
  finish: () => void;
  showClosingWords: () => void;
  /** A press reached the wall: someone is still there. */
  touch: () => void;
  restart: () => void;
}

export const useWeekStore = create<WeekState>((set, get) => ({
  loaded: false,
  week: null,
  error: null,
  introStarted: false,
  pathStarted: false,
  step: 'week',
  eventId: null,
  lineIndex: 0,
  seen: [],
  paths: {},
  considering: null,
  generating: false,
  closingWords: false,
  lastPress: 0,

  init: async () => {
    if (get().loaded) return;
    try {
      set({ week: await api.week(), loaded: true });
    } catch (error) {
      set({ loaded: true, error: error instanceof ApiError ? error.message : '주간 기록을 불러오지 못했습니다.' });
    }
  },

  startIntro: () => set({ introStarted: true }),
  enterWeek: () => set({ pathStarted: true, step: 'week', eventId: null, lineIndex: 0 }),

  openEvent: (eventId) => {
    if (!get().week?.events.some((e) => e.id === eventId)) return;
    set((s) => ({
      pathStarted: true, step: 'telling', eventId, lineIndex: 0,
      seen: s.seen.includes(eventId) ? s.seen : [...s.seen, eventId],
    }));
  },

  setLine: (index) => set({ lineIndex: Math.max(index, 0) }),

  goEvaluations: () => set({ step: 'evaluations', lineIndex: 0, considering: null }),

  backToTelling: () => set({ step: 'telling', lineIndex: 0 }),

  goChoose: () => {
    const { week, eventId, paths } = get();
    const version = versionOf(week?.events.find((e) => e.id === eventId) ?? null, paths[eventId ?? ''] ?? []);
    // Nothing to choose on this version (an emergency, or the last one): it ends here, back at the week.
    if (!version || version.requests.length === 0) { get().backToWeek(); return; }
    set({ step: 'choose', considering: null });
  },

  chooseRequest: (requestId) => {
    const { week, eventId, step, paths, generating } = get();
    // A press that does not belong to this screen is dropped: the tablet may be a moment behind. A choice already
    // made is made: while the new simulation is being made no second request is taken (the version it leads to may
    // offer a request of the same name).
    if (step !== 'choose' || !eventId || generating) return;
    const version = versionOf(week?.events.find((e) => e.id === eventId) ?? null, paths[eventId] ?? []);
    if (!version?.requests.some((r) => r.id === requestId)) return;
    set((s) => ({ paths: { ...s.paths, [eventId]: [...(s.paths[eventId] ?? []), requestId] }, considering: null, generating: true }));
  },

  // The new simulation is "made": what follows is the week, with the event one version on.
  endGenerating: () => {
    if (!get().generating) return;
    set({ generating: false });
    get().backToWeek();
  },

  backToWeek: () => set({ step: 'week', eventId: null, lineIndex: 0, considering: null }),

  consider: (considering) => {
    const { week, eventId, step, paths } = get();
    if (step !== 'choose') return;
    const version = versionOf(week?.events.find((e) => e.id === eventId) ?? null, paths[eventId ?? ''] ?? []);
    if (considering !== null && !version?.requests.some((r) => r.id === considering)) return;
    set({ considering });
  },

  finish: () => set({ pathStarted: true, step: 'closing', eventId: null, lineIndex: 0, considering: null, closingWords: false }),
  showClosingWords: () => { if (get().step === 'closing') set({ closingWords: true }); },
  touch: () => set({ lastPress: Date.now() }),

  restart: () => set({
    introStarted: false, pathStarted: false, step: 'week', eventId: null, lineIndex: 0, seen: [],
    paths: {}, considering: null, generating: false, closingWords: false,
  }),
}));
