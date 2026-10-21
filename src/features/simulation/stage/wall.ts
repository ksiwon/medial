import { useCallback, useEffect, useRef, useState } from 'react';
import { positionIn, eventOf, dayOf, eventsRead, runsOf, versionOf, type Paths } from '../week/selectors';
import { useWeekStore } from '../week/store';
import type { Evaluation, Week, WeekEvent, WeekScene } from '../week/types';
import { postState } from './bus';
import { IDLE_STATE, type Command, type DayBrief, type Phase, type RequestBrief, type StageState } from './protocol';
import { useStream } from './stream';
import type { AutoAction } from '../week/auto';

// The wall's side of the two screens: it does what the tablet pressed, and says what it shows.
//
// A press is applied to the week's store, so the walk behaves the same whoever pressed. A press that does
// not belong to the screen the wall is on is dropped: the tablet may be a moment behind, and a "choose" from
// a screen that has gone must not open another telling. Nothing here starts a run: every scene and every
// evaluation was written and checked before the exhibition (server/app/simulation/week.py).

/** The scenes the wall is telling right now: those of the version of the event being read. */
export function scenesOf(event: WeekEvent | null, path: readonly string[]): WeekScene[] {
  return versionOf(event, path)?.scenes ?? [];
}

/** The evaluations on the page: what the residents made of the version being read. */
export function evaluationsOf(event: WeekEvent | null, path: readonly string[]): Evaluation[] {
  return versionOf(event, path)?.evaluations ?? [];
}

/** Apply one press. Every press is also a sign someone is at the tablet: the page's clock starts over. */
export function apply(command: Command): void {
  useWeekStore.getState().touch();
  run(command);
}

/** What a run-out clock does (week/auto.ts): the same as the press it stands for, without counting as one. */
export function runAuto(action: AutoAction): void {
  run({ name: action } as Command);
}

function run(command: Command): void {
  const w = useWeekStore.getState();
  const event = eventOf(w.week ?? ({ events: [] } as unknown as Week), w.eventId);
  const path = w.paths[w.eventId ?? ''] ?? [];
  const on = (step: string) => w.pathStarted && w.step === step;
  switch (command.name) {
    case 'start':
      if (!w.introStarted && !w.pathStarted) w.startIntro();
      return;
    case 'skipIntro':
      // The first press takes the film to its last scene; a second one (or the film's end) goes on to the week.
      if (w.introStarted && !w.pathStarted) { if (w.introSkipped) w.enterWeek(); else w.skipIntro(); }
      return;
    case 'openEvent':
      if (on('week')) w.openEvent(command.id);
      return;
    case 'line': {
      if (!on('telling') || !event) return;
      const scenes = scenesOf(event, path);
      const total = scenes.reduce((n, sc) => n + sc.lines.length, 0);
      w.setLine(Math.min(Math.max(w.lineIndex + command.value, 0), Math.max(total - 1, 0)));
      return;
    }
    case 'skipScene': {
      if (!on('telling') || !event) return;
      const scenes = scenesOf(event, path);
      const at = positionIn(scenes, w.lineIndex);
      const next = scenes.slice(0, at.scene + 1).reduce((n, sc) => n + sc.lines.length, 0);
      w.setLine(Math.min(next, positionIn(scenes, 9999).total - 1));
      return;
    }
    case 'toEvaluations':
      // From the telling, and back from the requests (the way back is the residents' words).
      if ((on('telling') || on('choose')) && !w.generating) w.goEvaluations();
      return;
    case 'toTelling':
      if (on('evaluations')) w.backToTelling();
      return;
    case 'toChoose':
      if (on('evaluations')) w.goChoose();
      return;
    case 'consider':
      w.consider(command.id);
      return;
    case 'choose':
      w.chooseRequest(command.id);
      return;
    case 'week':
      if (w.pathStarted && w.step !== 'week' && w.step !== 'closing' && !w.generating) w.backToWeek();
      return;
    case 'finish':
      if (w.pathStarted && (w.step === 'week' || w.step === 'choose') && !w.generating) w.finish();
      return;
    case 'closingWords':
      w.showClosingWords();
      return;
    case 'home':
      if (w.pathStarted || w.introStarted) w.restart();
      return;
  }
}

const requestBrief = (event: WeekEvent, path: readonly string[]): RequestBrief[] =>
  (versionOf(event, path)?.requests ?? []).map((r) => ({ id: r.id, label: r.label }));

const weekBrief = (week: Week, paths: Paths): DayBrief[] =>
  week.days.map((d) => ({
    day: d.day,
    events: d.events.map((id) => {
      const e = eventOf(week, id)!;
      return { id, title: e.title, noChoice: e.noChoice, version: (paths[id]?.length ?? 0) + 1 };
    }),
  }));

/** What the wall shows right now, for the tablet. Pure: the same store always says the same thing. */
export function describeStage(args: {
  week: Week | null; introStarted: boolean; pathStarted: boolean; step: string; eventId: string | null;
  lineIndex: number; paths?: Paths; read?: readonly string[];
  considering?: string | null; generating?: boolean; closingWords?: boolean;
}): StageState {
  const { week } = args;
  if (!week) return IDLE_STATE;
  if (!args.pathStarted) return { ...IDLE_STATE, phase: args.introStarted ? 'intro' : 'idle' };
  const paths = args.paths ?? {};
  const phase = args.step as Phase;
  const event = eventOf(week, args.eventId);
  const path = paths[args.eventId ?? ''] ?? [];
  const version = versionOf(event, path);
  const base: StageState = {
    ...IDLE_STATE, phase, week: weekBrief(week, paths), runs: runsOf(paths),
    reads: args.read?.length ?? 0, events: eventsRead(args.read ?? []),
    event: event ? { id: event.id, title: event.title, day: dayOf(week, event.id), noChoice: event.noChoice } : null,
    version: version?.number ?? 1,
    leaf: version ? version.requests.length === 0 : false,
    generating: args.generating ?? false,
    closingWords: args.closingWords ?? false,
  };
  if (!event) return base;
  if (phase === 'telling') {
    const scenes = scenesOf(event, path);
    const at = positionIn(scenes, args.lineIndex);
    const scene = scenes[at.scene];
    return {
      ...base, line: args.lineIndex, lines: at.total, toldAll: at.done,
      scene: scene ? { time: scene.time, index: at.scene, of: scenes.length } : null,
    };
  }
  if (phase === 'choose') return { ...base, requests: requestBrief(event, path), considering: args.considering ?? null };
  return base;
}

/** What changes while a telling goes on is the line; the tablet needs it as it moves. */
function coarse(state: StageState): string {
  return JSON.stringify(state);
}

export function useWall(): { paired: boolean } {
  const [paired, setPaired] = useState(false);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const sending = useRef(false);
  const waiting = useRef<StageState | null>(null);
  const sent = useRef('');
  const latest = useRef<StageState>(IDLE_STATE);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      for (let next = waiting.current; next; next = waiting.current) {
        waiting.current = null;
        try { await postState(next); } catch { sent.current = ''; /* try again on the next change */ }
      }
    } finally {
      sending.current = false;
    }
  }, []);
  const publish = useCallback((force: boolean) => {
    const key = coarse(latest.current);
    if (!force && key === sent.current) return;
    sent.current = key;
    waiting.current = latest.current;
    void flush();
  }, [flush]);

  useStream({
    query: 'role=wall',
    on: {
      command: (data) => {
        const command = data as Command;
        chain.current = chain.current.then(() => { apply(command); }).catch(() => {});
      },
      // A tablet that connects later (or one that came back) is told where the wall is again.
      presence: (data) => {
        setPaired(((data as { pad?: number } | null)?.pad ?? 0) > 0);
        publish(true);
      },
      // Another wall page took over (this one was a stale tab): it must not go on acting as the wall.
      replaced: () => { setPaired(false); },
      ping: () => {},
    },
  });

  const w = useWeekStore();
  latest.current = describeStage({
    week: w.week, introStarted: w.introStarted, pathStarted: w.pathStarted, step: w.step, eventId: w.eventId,
    lineIndex: w.lineIndex, paths: w.paths, read: w.read,
    considering: w.considering, generating: w.generating, closingWords: w.closingWords,
  });

  // After every render: the cheap comparison above decides whether anything goes out.
  useEffect(() => { publish(false); });
  return { paired };
}
