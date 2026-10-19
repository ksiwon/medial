import { describe, expect, it } from 'vitest';
import narration from '../../../../fixtures/exhibition/narration.json';
import { INTRO_SAY } from '../screens/IntroScreen';
import { autoOf, AUTO_S, type AutoState } from './auto';
import { CLOSE_SAY } from './ClosingScreen';
import { judgmentAt, rulesIn } from './judgment';
import { eventOf, timetable } from './selectors';
import type { Week } from './types';
import { spotsOf } from './VillageMap';
import { AXIS, feedbackOf } from './WeekScreen';
import fixture from './week.fixture.json';

// The pieces brought back on 2026-10-18 (the AI's judgment panel, the village map, the clocks, the closing page)
// each says only what the week holds.

const week = fixture as unknown as Week;
const E1 = eventOf(week, 'E1')!;

describe("the AI's judgment panel", () => {
  it('knows nothing before the first line, and then only the lines it was in', () => {
    const scenes = E1.before.scenes;
    expect(judgmentAt(E1, [], scenes, 0, null).knows).toEqual([]);
    const first = judgmentAt(E1, [], scenes, 0, 0);
    expect(first.present).toBe(true);
    expect(first.knows).toHaveLength(1);
    // The field scene (s2) has no AI in it: the panel says it cannot see it and learns nothing there.
    const field = judgmentAt(E1, [], scenes, 1, scenes[1].lines.length - 1);
    expect(scenes[1].cast).not.toContain('AI');
    expect(field.present).toBe(false);
    expect(field.knows).toHaveLength(scenes[0].lines.length);
  });

  it('says who it spoke to, and how, and whether they have answered', () => {
    const scenes = E1.before.scenes;
    const before = judgmentAt(E1, [], scenes, 0, 0);
    expect(before.contacts).toEqual([{ actor: 'P6', way: 'phone', answered: false }]);
    const after = judgmentAt(E1, [], scenes, 0, scenes[0].lines.length - 1);
    expect(after.contacts[0].answered).toBe(true);
  });

  it('runs the rules as they were, and on a later version the last request\'s changed ones first, with what they were', () => {
    expect(rulesIn(E1, []).every((r) => r.was === null)).toBe(true);
    const A = E1.requests.find((q) => q.id === 'A')!;
    const rows = rulesIn(E1, [A]);
    expect(rows.slice(0, A.rules.length).map((r) => r.was)).toEqual(A.rules.map((r) => r.beforeSentence));
    expect(rows.slice(0, A.rules.length).map((r) => r.sentence)).toEqual(A.rules.map((r) => r.afterSentence));
    expect(judgmentAt(eventOf(week, 'E6')!, [], eventOf(week, 'E6')!.before.scenes, 0, 0).emergency).toBe(true);
  });

  it('keeps an earlier request in force on the version after it, marking only what the last one changed', () => {
    const E1b = eventOf(week, 'E1')!;
    const A = E1b.requests.find((q) => q.id === 'A')!;
    const B = A.after.requests[0];
    const rows = rulesIn(E1b, [A, B]);
    const changedByA = A.rules.filter((rule) => !B.rules.some((x) => x.type === rule.type));
    // What A changed and B left alone is in force, no longer marked.
    for (const rule of changedByA) expect(rows.find((x) => x.label === rule.label)).toMatchObject({ sentence: rule.afterSentence, was: null });
    // What B changed is marked, with what ver2 ran.
    for (const rule of B.rules) expect(rows.find((x) => x.label === rule.label)).toMatchObject({ sentence: rule.afterSentence, was: rule.beforeSentence });
  });
});

describe('the clocks', () => {
  const base: AutoState = {
    pathStarted: true, step: 'week', eventId: null, toldAll: false, leaf: false, seen: 0, closingWords: false, lastPress: 0,
  };

  it('a telling waits for no clock until its last line, then goes on to the residents', () => {
    expect(autoOf({ ...base, step: 'telling' })).toBeNull();
    expect(autoOf({ ...base, step: 'telling', toldAll: true })).toMatchObject({ action: 'toEvaluations', seconds: AUTO_S.told });
  });

  it('the residents\' words go on to the requests, or - where there is nothing to choose - back to the week', () => {
    expect(autoOf({ ...base, step: 'evaluations' })).toMatchObject({ action: 'toChoose', seconds: AUTO_S.evaluations });
    expect(autoOf({ ...base, step: 'evaluations', leaf: true })).toMatchObject({ action: 'week' });
  });

  it('never chooses for the visitor: the request page only gives up to the closing', () => {
    expect(autoOf({ ...base, step: 'choose', seen: 1 })?.action).toBe('finish');
    expect(autoOf({ ...base, step: 'week', seen: 0 })?.action).toBe('home');
  });

  it('starts over on every press', () => {
    const a = autoOf({ ...base, step: 'evaluations', lastPress: 1 })!;
    const b = autoOf({ ...base, step: 'evaluations', lastPress: 2 })!;
    expect(a.key).not.toBe(b.key);
  });

  it('closes: what was changed, then the words, then the start', () => {
    expect(autoOf({ ...base, step: 'closing', seen: 2 })?.action).toBe('closingWords');
    expect(autoOf({ ...base, step: 'closing', seen: 2, closingWords: true })).toMatchObject({ action: 'home', seconds: AUTO_S.closing });
  });
});

describe('the narration', () => {
  it('the closing words and the opening captions are what the narrator reads', () => {
    const scenes = (narration as { scenes: Record<string, { lines: { text: string }[] }> }).scenes;
    expect([...CLOSE_SAY]).toEqual(scenes.outro.lines.map((l) => l.text));
    expect([...INTRO_SAY]).toEqual(scenes.intro.lines.map((l) => l.text));
  });
});

describe('the week as a timetable', () => {
  const days = timetable(week, AXIS);

  it('puts every event on its day from its time, inside the axis', () => {
    expect(days.flatMap((d) => d.blocks).length).toBe(8);
    for (const d of days) for (const b of d.blocks) {
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.top + b.height).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('never stands two events of one day side by side: they follow one another down the column', () => {
    for (const d of days) {
      for (let i = 1; i < d.blocks.length; i += 1) {
        expect(d.blocks[i].top).toBeGreaterThanOrEqual(d.blocks[i - 1].top + d.blocks[i - 1].height + AXIS.gapHours / (AXIS.to - AXIS.from) - 1e-9);
      }
    }
    expect(days.find((d) => d.day === '화')!.blocks).toEqual([]);
  });
});

describe("a week card's feedback", () => {
  it("takes each resident in turn, in the order they said things, and never more than the card holds", () => {
    const E5 = eventOf(week, 'E5')!;
    const said = feedbackOf(E5.before.evaluations, 3);
    expect(said).toHaveLength(3);
    // one from each of the three residents in the first round
    expect(said).toEqual(E5.before.evaluations.map((ev) => feedbackOf([ev], 1)[0]));
    // their first claim, whatever its kind: the card does not pick the discomfort out
    for (const ev of week.events.flatMap((e) => e.before.evaluations)) expect(feedbackOf([ev], 1)[0]).toBe(ev.claims[0]);
  });
});

describe('the village map', () => {
  const village = {
    available: true, viewBox: [0, 0, 10, 10] as [number, number, number, number],
    places: { FARM: { x: 1, y: 1 }, MIGA: { x: 2, y: 2 } }, homes: { P1: { x: 3, y: 3 }, P8: { x: 4, y: 4 } }, patrol: [[0, 0], [5, 5], [9, 9]] as [number, number][],
  };

  it("finds a house by whose it is named, and puts the town off the map", () => {
    const [home, patrol] = spotsOf(E1.before.scenes[0].frames, village, week.people);
    expect(home.at).toEqual({ x: 3, y: 3 });
    expect(patrol.patrol).toBe(true);
    const clinic = spotsOf([{ place: 'CLINIC', label: '보건소', device: null, who: {} }], village, week.people)[0];
    expect(clinic.at).toBeNull();
  });
});
