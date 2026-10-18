import { useCallback, useEffect, useRef, useState } from 'react';
import { positionIn, requestOf, eventOf, dayOf, nameOf } from '../week/selectors';
import { useWeekStore } from '../week/store';
import type { Evaluation, Week, WeekEvent, WeekScene } from '../week/types';
import { postState } from './bus';
import { IDLE_STATE, type Command, type DayBrief, type Phase, type RequestBrief, type ResidentBrief, type StageState } from './protocol';
import { useStream } from './stream';
import { autoOf, type AutoAction } from '../week/auto';

// The wall's side of the two screens: it does what the tablet pressed, and says what it shows.
//
// A press is applied to the week's store, so the walk behaves the same whoever pressed. A press that does
// not belong to the screen the wall is on is dropped: the tablet may be a moment behind, and a "choose" from
// a screen that has gone must not open another telling. Nothing here starts a run: every scene and every
// evaluation was written and checked before the exhibition (server/app/simulation/week.py).

/** The scenes the wall is telling right now: the event's own, or the one a chosen request led to. */
export function scenesOf(event: WeekEvent | null, step: string, requestId: string | null): WeekScene[] {
  if (!event) return [];
  if (step === 'after') {
    const request = requestOf(event, requestId);
    return request ? [request.after.scene] : [];
  }
  return event.before.scenes;
}

/** The evaluations on the page: those of the event as it ran, or of the request's scene after it was chosen. */
export function evaluationsOf(event: WeekEvent | null, step: string, requestId: string | null): Evaluation[] {
  if (!event) return [];
  if (step === 'result' && requestId) return requestOf(event, requestId)?.after.evaluations ?? [];
  return event.before.evaluations;
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
  const on = (step: string) => w.pathStarted && w.step === step;
  switch (command.name) {
    case 'start':
      if (!w.introStarted && !w.pathStarted) w.startIntro();
      return;
    case 'skipIntro':
      if (w.introStarted && !w.pathStarted) w.enterWeek();
      return;
    case 'openEvent':
      if (on('week')) w.openEvent(command.id);
      return;
    case 'line': {
      if (!(on('before') || on('after')) || !event) return;
      const scenes = scenesOf(event, w.step, w.requestId);
      const total = scenes.reduce((n, sc) => n + sc.lines.length, 0);
      w.setLine(Math.min(Math.max(w.lineIndex + command.value, 0), Math.max(total - 1, 0)));
      return;
    }
    case 'skipScene': {
      if (!(on('before') || on('after')) || !event) return;
      const scenes = scenesOf(event, w.step, w.requestId);
      const at = positionIn(scenes, w.lineIndex);
      const next = scenes.slice(0, at.scene + 1).reduce((n, sc) => n + sc.lines.length, 0);
      w.setLine(Math.min(next, positionIn(scenes, 9999).total - 1));
      return;
    }
    case 'toEvaluations':
      if (on('before')) w.goEvaluations();
      else if (on('after')) w.goResult();
      return;
    case 'openResident':
      if ((on('evaluations') || on('result')) && evaluationsOf(event, w.step, w.requestId).some((e) => e.actor === command.id)) w.openResident(command.id);
      return;
    case 'closeResident':
      if (on('evaluations') || on('result')) w.openResident(null);
      return;
    case 'toChoose':
      if (on('evaluations')) w.afterEvaluations();
      return;
    case 'consider':
      w.consider(command.id);
      return;
    case 'choose':
      w.chooseRequest(command.id);
      return;
    case 'toResult':
      if (on('after')) w.goResult();
      return;
    case 'week':
      if (w.pathStarted && w.step !== 'week' && w.step !== 'closing') w.backToWeek();
      return;
    case 'finish':
      if (w.pathStarted && (w.step === 'week' || w.step === 'result' || w.step === 'choose')) w.finish();
      return;
    case 'closingWords':
      w.showClosingWords();
      return;
    case 'home':
      if (w.pathStarted || w.introStarted) w.restart();
      return;
  }
}

const requestBrief = (event: WeekEvent, week: Week): RequestBrief[] =>
  event.requests.map((r) => ({
    id: r.id, label: r.label, expect: r.expect, cost: r.cost, basis: r.basis.verdict,
    from: r.basis.actor ? nameOf(week, r.basis.actor) : null,
  }));

const residentBrief = (week: Week, list: Evaluation[]): ResidentBrief[] =>
  list.map((e) => ({ id: e.actor, name: nameOf(week, e.actor), said: e.paragraph }));

const weekBrief = (week: Week, seen: string[], chosen: Record<string, string | null>): DayBrief[] =>
  week.days.map((d) => ({
    day: d.day,
    events: d.events.map((id) => {
      const e = eventOf(week, id)!;
      const at = e.requests.findIndex((r) => r.id === chosen[id]);
      return { id, title: e.title, noChoice: e.noChoice, seen: seen.includes(id), chosen: at >= 0 ? at + 1 : null };
    }),
  }));

/** What the wall shows right now, for the tablet. Pure: the same store always says the same thing. */
export function describeStage(args: {
  week: Week | null; introStarted: boolean; pathStarted: boolean; step: string; eventId: string | null;
  requestId: string | null; lineIndex: number; openActor: string | null; seen: string[];
  considering?: string | null; closingWords?: boolean; lastPress?: number; chosen?: Record<string, string | null>;
}): StageState {
  const { week } = args;
  if (!week) return IDLE_STATE;
  if (!args.pathStarted) return { ...IDLE_STATE, phase: args.introStarted ? 'intro' : 'idle' };
  const phase = args.step as Phase;
  const event = eventOf(week, args.eventId);
  const scenes = scenesOf(event, phase, args.requestId);
  const told = (phase === 'before' || phase === 'after') && positionIn(scenes, args.lineIndex).done;
  const auto = autoOf({
    pathStarted: true, step: phase, eventId: args.eventId, openActor: args.openActor, toldAll: told,
    noChoice: event?.noChoice ?? false, seen: args.seen.length, closingWords: args.closingWords ?? false, lastPress: args.lastPress ?? 0,
  });
  const base: StageState = {
    ...IDLE_STATE, phase, week: weekBrief(week, args.seen, args.chosen ?? {}), seen: args.seen.length,
    total: week.days.reduce((n, d) => n + d.events.length, 0),
    event: event ? { id: event.id, title: event.title, day: dayOf(week, event.id), noChoice: event.noChoice } : null,
    auto: auto ? { key: auto.key, seconds: auto.seconds, say: auto.say } : null,
    closingWords: args.closingWords ?? false,
  };
  if (!event) return base;
  if (phase === 'before' || phase === 'after') {
    const at = positionIn(scenes, args.lineIndex);
    const scene = scenes[at.scene];
    return {
      ...base, line: args.lineIndex, lines: at.total, toldAll: at.done,
      scene: scene ? { time: scene.time, place: scene.frames[0]?.label ?? null, index: at.scene, of: scenes.length } : null,
      chosen: args.requestId,
    };
  }
  if (phase === 'evaluations' || phase === 'result') {
    return { ...base, residents: residentBrief(week, evaluationsOf(event, phase, args.requestId)), openActor: args.openActor, chosen: args.requestId };
  }
  if (phase === 'choose') return { ...base, requests: requestBrief(event, week), considering: args.considering ?? null };
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
    requestId: w.requestId, lineIndex: w.lineIndex, openActor: w.openActor, seen: w.seen,
    considering: w.considering, closingWords: w.closingWords, lastPress: w.lastPress, chosen: w.chosen,
  });

  // After every render: the cheap comparison above decides whether anything goes out.
  useEffect(() => { publish(false); });
  return { paired };
}
