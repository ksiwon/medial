import type { Pose, WeekEvent, WeekRequest, WeekScene } from './types';

// The AI's side of an event, as its judgment panel shows it beside the scene:
//
//   지금 아는 것            the lines the AI was in - what it said and what it heard, up to the line on screen
//   걸린 규칙               the rules the version runs under; on a later version, the ones its last request changed, before and after
//   연락한 사람             who it spoke to in this event, how, and whether they have answered yet
//
// (What it says is the scene's bubble; a fourth step that repeated it was dropped on 2026-10-18.)
//
// Only what the AI holds: a scene it is not in (cast without 'AI') adds nothing, and the panel says it cannot see
// that scene. Its context is this event's alone (AGENTS.md): it starts empty with the event, and a later version -
// the same event run again under the chosen request - starts empty again. Nothing here is a fact about
// the world the AI could not have heard; the scene beside it shows the world.

export interface Known { speaker: string; text: string; /** true: someone said it to the AI; false: the AI said it. */ heard: boolean }

export interface PanelRule {
  label: string;
  sentence: string;
  /** The sentence before the version's last request changed it; null for a rule it left alone. */
  was: string | null;
}

export type ContactWay = 'phone' | 'speaker' | 'here';

export interface Contact { actor: string; way: ContactWay; answered: boolean }

export interface Judgment {
  /** The AI is in the scene on screen. */
  present: boolean;
  knows: Known[];
  rules: PanelRule[];
  contacts: Contact[];
  /** An emergency runs no chosen rule: the panel says so instead of listing none. */
  emergency: boolean;
}

/**
 * The event's rules as the AI runs them on a version: the requests made so far in force, the last one's changes marked
 * (what it was before). ver1 has none made.
 */
export function rulesIn(event: WeekEvent, chain: WeekRequest[]): PanelRule[] {
  const latest = new Map(chain.flatMap((q) => q.rules).map((r) => [r.type, r]));
  const last = new Set((chain[chain.length - 1]?.rules ?? []).map((r) => r.type));
  const rows = event.rules.map((r) => {
    const change = latest.get(r.type);
    if (!change) return { label: r.label, sentence: r.sentence, was: null };
    return { label: r.label, sentence: change.afterSentence, was: last.has(r.type) ? change.beforeSentence : null };
  });
  // What the visitor changed is what this telling is about: it goes first.
  return [...rows.filter((r) => r.was !== null), ...rows.filter((r) => r.was === null)];
}

function wayOf(scene: WeekScene, actor: string): ContactWay {
  const frame = scene.frames.find((f) => actor in f.who);
  const pose: Pose | undefined = frame?.who[actor];
  if (pose === 'phone') return 'phone';
  return frame?.device ? 'speaker' : 'here';
}

/**
 * The panel at one point of a telling: `scenes` are the telling's scenes, and the reader is on line `line` of
 * scene `sceneIndex` (0-based; null before the first line).
 */
export function judgmentAt(event: WeekEvent, chain: WeekRequest[], scenes: WeekScene[], sceneIndex: number, line: number | null): Judgment {
  const knows: Known[] = [];
  const contacts = new Map<string, Contact>();
  scenes.slice(0, sceneIndex + 1).forEach((scene, i) => {
    if (!scene.cast.includes('AI')) return;
    const upTo = i < sceneIndex ? scene.lines.length : line === null ? 0 : line + 1;
    for (const actor of scene.cast) {
      if (actor !== 'AI' && !contacts.has(actor)) contacts.set(actor, { actor, way: wayOf(scene, actor), answered: false });
    }
    for (const l of scene.lines.slice(0, upTo)) {
      if (l.speaker !== 'AI') { const c = contacts.get(l.speaker); if (c) c.answered = true; }
      knows.push({ speaker: l.speaker, text: l.text, heard: l.speaker !== 'AI' });
    }
  });
  return {
    present: scenes[sceneIndex]?.cast.includes('AI') ?? false,
    knows,
    rules: rulesIn(event, chain),
    contacts: [...contacts.values()],
    emergency: event.noChoice,
  };
}
