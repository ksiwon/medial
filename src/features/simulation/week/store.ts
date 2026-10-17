import { create } from 'zustand';
import { api, ApiError } from '../api/client';
import type { Step, Week } from './types';

// Where the visitor is in the week. One path, no branches to back out of:
//
//   week  ->  before (the event's scenes)  ->  evaluations  ->  choose  ->  after (the request's scene)  ->  result
//                                                  \_ an emergency has no choose: it goes back to the week _/
//
// Every scene and evaluation was written and checked before the exhibition (server/.../week.py); choosing a
// request opens what that request's scene already says. Nothing here runs anything.

interface WeekState {
  loaded: boolean;
  week: Week | null;
  error: string | null;
  /** The visitor pressed start and the opening film has been played or skipped. */
  introStarted: boolean;
  pathStarted: boolean;
  step: Step;
  eventId: string | null;
  requestId: string | null;
  /** The line the telling has reached, counted across the scenes of the current step. */
  lineIndex: number;
  /** Which resident's card is open on the evaluations page (null: the list). */
  openActor: string | null;
  /** The events the visitor has finished, so the week can say what is left to read. */
  seen: string[];

  init: () => Promise<void>;
  startIntro: () => void;
  enterWeek: () => void;
  openEvent: (eventId: string) => void;
  setLine: (index: number) => void;
  goEvaluations: () => void;
  openResident: (actor: string | null) => void;
  /** After the evaluations: an emergency is finished, anything else goes on to its requests. */
  afterEvaluations: () => void;
  chooseRequest: (requestId: string) => void;
  goResult: () => void;
  backToWeek: () => void;
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
  requestId: null,
  lineIndex: 0,
  openActor: null,
  seen: [],

  init: async () => {
    if (get().loaded) return;
    try {
      set({ week: await api.week(), loaded: true });
    } catch (error) {
      set({ loaded: true, error: error instanceof ApiError ? error.message : '주간 기록을 불러오지 못했습니다.' });
    }
  },

  startIntro: () => set({ introStarted: true }),
  enterWeek: () => set({ pathStarted: true, step: 'week', eventId: null, requestId: null, lineIndex: 0, openActor: null }),

  openEvent: (eventId) => {
    if (!get().week?.events.some((e) => e.id === eventId)) return;
    set({ pathStarted: true, step: 'before', eventId, requestId: null, lineIndex: 0, openActor: null });
  },

  setLine: (lineIndex) => set({ lineIndex: Math.max(0, lineIndex) }),
  goEvaluations: () => set({ step: 'evaluations', openActor: null, lineIndex: 0 }),
  openResident: (openActor) => set({ openActor }),

  afterEvaluations: () => {
    const { week, eventId } = get();
    const event = week?.events.find((e) => e.id === eventId);
    if (!event) return;
    if (event.noChoice) {
      set((s) => ({ step: 'result', seen: s.seen.includes(event.id) ? s.seen : [...s.seen, event.id], lineIndex: 0, openActor: null }));
      return;
    }
    set({ step: 'choose', openActor: null });
  },

  chooseRequest: (requestId) => {
    const { week, eventId, step } = get();
    // A press that does not belong to this screen is dropped: the tablet may be a moment behind.
    if (step !== 'choose') return;
    const event = week?.events.find((e) => e.id === eventId);
    if (!event?.requests.some((r) => r.id === requestId)) return;
    set({ step: 'after', requestId, lineIndex: 0, openActor: null });
  },

  goResult: () => {
    const { eventId } = get();
    if (!eventId) return;
    set((s) => ({ step: 'result', lineIndex: 0, openActor: null, seen: s.seen.includes(eventId) ? s.seen : [...s.seen, eventId] }));
  },

  backToWeek: () => set({ step: 'week', eventId: null, requestId: null, lineIndex: 0, openActor: null }),

  restart: () => set({
    introStarted: false, pathStarted: false, step: 'week', eventId: null, requestId: null, lineIndex: 0, openActor: null, seen: [],
  }),
}));
