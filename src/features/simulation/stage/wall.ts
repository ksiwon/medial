import { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerationDetail, SessionDetail } from '../api/iteration';
import type { DomainEvent } from '../api/types';
import { useIterationStore } from '../iterationStore';
import { DAY_START_MS, usePlayback } from '../scene/playback';
import { askedReviews, pagesOf, saidOf, wentThrough } from '../selectors/evaluations';
import { personName } from '../selectors/story';
import { childFor, chosenRequests, dayName, openingOf, pathTo } from '../selectors/tree';
import { useSimStore } from '../store';
import { postState } from './bus';
import { IDLE_STATE, type Command, type Phase, type StageState } from './protocol';
import { useStream } from './stream';

// The wall's side of the two screens: it does what the tablet pressed, and says what it shows.
//
// A press is applied to the same stores the single screen's buttons used, so the walk
// behaves identically whoever pressed - the playhead, the timers and every choice's
// consequence stay here. Nothing here starts a run: choosing a revision opens a day that
// was already run when the record was made.

/** Apply one press. A press that does not belong to the screen the wall is on is dropped: the tablet may
 *  be a moment behind, and a "choose" from a screen that has gone must not open another day. */
export async function apply(command: Command): Promise<void> {
  const it = useIterationStore.getState();
  const playback = usePlayback.getState();
  const detail = it.detail;
  const day = currentDay(detail, it.viewGenerationId);
  const on = (screen: 'case' | 'evaluations' | 'improve') => it.pathStarted && it.screen === screen;
  switch (command.name) {
    case 'start':
      if (!it.introStarted && !it.pathStarted) it.startIntro();
      return;
    case 'skipIntro': {
      const first = detail ? openingOf(detail) : null;
      if (first && it.introStarted && !it.pathStarted) await it.choose(first.id);
      return;
    }
    case 'skipScene':
      if (on('case')) await playback.skipScene();
      return;
    case 'skipLine':
      if (on('case')) await playback.skipLine();
      return;
    case 'readEvaluations':
      if (on('case')) { await playback.pause(); it.setScreen('evaluations'); }
      return;
    case 'evalPage': {
      if (!on('evaluations')) return;
      const next = it.page + command.value;
      if (next >= 0 && next < pagesOf(askedReviews(day).length)) it.setPage(next);
      return;
    }
    case 'evalOpen':
      if (on('evaluations') && askedReviews(day).some((r) => r.actorId === command.id)) it.setOpenActor(command.id);
      return;
    case 'evalClose':
      if (on('evaluations')) { it.setOpenActor(null); it.setIssues(false); }
      return;
    case 'evalIssues':
      if (on('evaluations') && (day?.synthesis?.issueGroups.length ?? 0) > 0) it.setIssues(!it.issues);
      return;
    case 'goImprove':
      if (on('evaluations')) it.setScreen('improve');
      return;
    case 'choose': {
      // Only a revision of this day that the record ran can be chosen; the day it opens plays from 05:00.
      if (!on('improve') || !detail || !day) return;
      const runs = day.changeSets.map((cs) => childFor(detail, cs.id)?.id);
      if (runs.includes(command.id)) await it.choose(command.id);
      return;
    }
    case 'closing':
      // Asked for before the wait is over: the three days give way to the closing words now.
      if (on('improve') && day?.changeSets.length === 0) it.setClosing(true);
      return;
    case 'home':
      if (it.pathStarted || it.introStarted) it.restartPath();
      return;
  }
}

const currentDay = (detail: SessionDetail | null, id: string | null): GenerationDetail | null =>
  detail?.generations.find((g) => g.id === id) ?? null;

/** What the wall shows right now, for the tablet. Pure: the same stores always say the same thing. */
export function describeStage(args: {
  detail: SessionDetail | null;
  viewGenerationId: string | null;
  introStarted: boolean;
  pathStarted: boolean;
  screen: 'case' | 'evaluations' | 'improve';
  page: number;
  openActor: string | null;
  issues: boolean;
  closing: boolean;
  playing: boolean;
  rt: number;
  total: number;
  atMs: number;
  dayEndMs: number;
  tasks: { startMs: number; title: string }[];
  sceneTitle: string | null;
  events: DomainEvent[] | null;
  eventsAttemptId: string | null;
}): StageState {
  const { detail } = args;
  if (!detail) return IDLE_STATE;
  const day = currentDay(detail, args.viewGenerationId);
  const phase: Phase = !args.pathStarted
    ? (args.introStarted ? 'intro' : 'idle')
    : args.screen === 'case' ? 'day'
    : args.screen === 'evaluations' ? 'evaluations'
    : day && day.changeSets.length === 0 ? 'ending' : 'choose';
  if (phase === 'idle' || phase === 'intro' || !day) return { ...IDLE_STATE, phase };

  const asked = askedReviews(day);
  const open = args.openActor ? asked.find((r) => r.actorId === args.openActor) ?? null : null;
  const byId = new Map((args.events ?? []).map((e) => [e.id, e]));
  const labels = new Map(day.ruleCatalog.map((r) => [r.ruleType, r.label]));
  return {
    phase,
    day: dayName(day),
    dayIndex: day.index,
    dayCount: Math.max(3, day.index + 1, ...detail.generations.map((g) => g.index + 1)),
    scene: args.sceneTitle,
    playing: args.playing,
    progress: args.total > 0 ? Math.min(1, args.rt / args.total) : 0,
    atMs: args.atMs,
    dayStartMs: DAY_START_MS,
    dayEndMs: args.dayEndMs,
    dayOver: args.total > 0 && args.rt >= args.total,
    tasks: args.tasks,
    residents: asked.map((r) => ({ id: r.actorId, name: personName(r.actorId), said: saidOf(r) })),
    page: args.page,
    pages: pagesOf(asked.length),
    openActor: open ? open.actorId : null,
    issues: args.issues,
    hasIssues: (day.synthesis?.issueGroups.length ?? 0) > 0,
    went: open && args.eventsAttemptId === open.attemptId ? wentThrough(open, byId) : [],
    hasChoice: day.changeSets.length > 0,
    choices: day.changeSets.map((cs) => {
      const child = childFor(detail, cs.id);
      const rule = cs.changes[0];
      return {
        id: child ? child.id : null,
        label: cs.label,
        kind: (rule?.semantic && labels.get(rule.semantic.ruleType)) ?? rule?.field ?? '수정 요청',
        goal: cs.expectedEffects[0] ?? null,
        rule: rule ? { before: rule.beforeRule, after: rule.afterRule } : null,
        from: cs.affectedActors.map(personName),
      };
    }),
    chosen: chosenRequests(detail, day.id),
    closing: args.closing,
  };
}

/** What changes about the state while a day plays is the playhead; the tablet needs it about twice a second.
 *  A coarse copy of the state is what is compared, so a reel ticking sixty times a second sends nothing. */
function coarse(state: StageState): string {
  return JSON.stringify({ ...state, progress: Math.round(state.progress * 200), atMs: Math.round(state.atMs / 60_000) });
}

/** Listen for the tablet's presses and report the wall's state whenever it changes. Mount once, on the wall.
 *  Returns whether a tablet is paired: until one is, the wall shows the code to scan instead of the walk.
 *
 *  Two things keep the screens from tripping over each other:
 *  - presses are applied strictly one after another, in the order they arrived (a press that starts a day
 *    is awaited before the next one is looked at, so "choose" and a quick "skip" cannot interleave);
 *  - state goes out one request at a time and only the newest is kept while one is on its way. */
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
        chain.current = chain.current.then(() => apply(command)).catch(() => {});
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

  const it = useIterationStore();
  const playing = usePlayback((s) => s.playing);
  const rt = usePlayback((s) => s.rt);
  const reel = usePlayback((s) => s.reel);
  const position = usePlayback((s) => s.position);
  const activeId = useSimStore((s) => s.activeId);
  const loaded = useSimStore((s) => (activeId ? s.attempts[activeId] ?? null : null));

  const segment = position?.segment ?? null;
  const episode = reel && segment && segment.kind !== 'map' ? reel.episodes[segment.episode] : null;
  latest.current = describeStage({
    detail: it.detail, viewGenerationId: it.viewGenerationId, introStarted: it.introStarted, pathStarted: it.pathStarted,
    screen: it.screen, page: it.page, openActor: it.openActor, issues: it.issues, closing: it.closing,
    playing, rt, total: reel?.total ?? 0, atMs: position?.atMs ?? DAY_START_MS, dayEndMs: reel?.dayEndMs ?? DAY_START_MS,
    tasks: (reel?.episodes ?? []).filter((e) => e.firstOfRequest).map((e) => ({ startMs: e.startMs, title: e.title })),
    sceneTitle: episode?.title ?? null,
    events: loaded?.events ?? null, eventsAttemptId: loaded?.detail.attempt.id ?? null,
  });

  // After every render: the cheap comparison above decides whether anything goes out.
  useEffect(() => { publish(false); });
  return { paired };
}
