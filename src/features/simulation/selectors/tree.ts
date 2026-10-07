import type { GenerationDetail, SessionDetail } from '../api/iteration';

// A session whose versions branch.
//
// The engine's loop is one line: a researcher confirms one Change Set and the
// next version runs it. The exhibition record (scripts/import_exhibition.py) ran
// every option instead - three first settings, and three revisions after every
// day - so its versions are a tree, and reading it is walking one path through
// it: pick a first setting, watch the day, read the reviews, pick a revision,
// watch the next day. These helpers are that walk; nothing here runs anything.

/** More than one first version, or a version with more than one child. */
export function isTree(detail: SessionDetail | null): boolean {
  if (!detail) return false;
  const parents = detail.generations.map((g) => g.parentGenerationId ?? '');
  return parents.some((p, i) => parents.indexOf(p) !== i);
}

const byId = (detail: SessionDetail, id: string | null) =>
  detail.generations.find((g) => g.id === id) ?? null;

/** The first settings, in the order the record lists them. */
export function rootsOf(detail: SessionDetail): GenerationDetail[] {
  return detail.generations.filter((g) => !g.parentGenerationId)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/**
 * The version the exhibition opens with: the first setting the record lists.
 * The record ran three; the exhibition fixes this one, so the other two first
 * settings (and the paths under them) are kept in the record and never reached.
 */
export function openingOf(detail: SessionDetail): GenerationDetail | null {
  return rootsOf(detail)[0] ?? null;
}

/** How many complete walks lead down from `rootId`: its leaves. */
export function pathCount(detail: SessionDetail, rootId: string): number {
  const parents = new Set(detail.generations.map((g) => g.parentGenerationId));
  return detail.generations.filter((g) => !parents.has(g.id) && pathTo(detail, g.id)[0]?.id === rootId).length;
}

/** The version a revision of `generation` led to, or null when it was not run. */
export function childFor(detail: SessionDetail, changeSetId: string): GenerationDetail | null {
  return detail.generations.find((g) => g.appliedChangeSetId === changeSetId) ?? null;
}

/** From the first setting down to this version. */
export function pathTo(detail: SessionDetail, id: string | null): GenerationDetail[] {
  const out: GenerationDetail[] = [];
  for (let g = byId(detail, id); g; g = byId(detail, g.parentGenerationId)) out.unshift(g);
  return out;
}

/** "1일차": in the exhibition record a version is a day. */
export const dayName = (generation: { index: number }) => `${generation.index + 1}일차`;

/** What the exhibition record measured of a day (import_exhibition.py). */
export interface DayFacts {
  dayTitle: string;
  quests: number;
  resolveMinutes: number | null;
  headAsks: number;
  refusals: number;
  handoff: string;
  rideRefused: boolean;
}

export function dayFacts(generation: GenerationDetail): DayFacts | null {
  const row = (generation.metrics as { exhibition?: DayFacts }).exhibition;
  return row && typeof row.quests === 'number' ? row : null;
}

/** The wall's one line under "N일차가 끝났습니다". */
export function dayLine(facts: DayFacts): string {
  return [`오늘 요청 ${facts.quests}건`,
    ...(facts.resolveMinutes != null ? [`확인까지 ${facts.resolveMinutes}분`] : []),
    `이장이 받은 부탁 ${facts.headAsks}번`, `거절 ${facts.refusals}번`].join(' · ');
}

/**
 * The walk the opening film shows as "three days later": of the complete walks
 * down from `rootId`, the one whose last day ended furthest from the rest - the
 * most refusals, the earliest id on a tie. Most walks end on the same numbers
 * (the record's one daytime helper takes most rule changes), so a walk picked
 * any other way would show two rules changing and nothing following from it.
 */
export function farthestPath(detail: SessionDetail, rootId: string): GenerationDetail[] {
  const parents = new Set(detail.generations.map((g) => g.parentGenerationId));
  const walks = detail.generations
    .filter((g) => !parents.has(g.id))
    .map((leaf) => pathTo(detail, leaf.id))
    .filter((walk) => walk[0]?.id === rootId)
    .sort((a, b) => a[a.length - 1].id.localeCompare(b[b.length - 1].id, undefined, { numeric: true }));
  const refusals = (walk: GenerationDetail[]) => dayFacts(walk[walk.length - 1])?.refusals ?? 0;
  return walks.reduce<GenerationDetail[]>((best, walk) => (refusals(walk) > refusals(best) ? walk : best), walks[0] ?? []);
}

/** One rule as the walk changed it, and the request that changed it. */
export interface RuleShift {
  ruleType: string;
  label: string;
  before: string;
  after: string;
  /** The request chosen at the end of `day`. */
  request: string;
  day: string;
}

/** What each step of a walk changed, read off the versions' own rule sentences. */
export function ruleShifts(walk: GenerationDetail[]): RuleShift[] {
  return walk.slice(1).flatMap((next, i) => {
    const before = new Map(walk[i].ruleCatalog.map((r) => [r.ruleType, r.currentRule ?? '']));
    return next.ruleCatalog
      .filter((r) => (r.currentRule ?? '') !== before.get(r.ruleType))
      .map((r) => ({ ruleType: r.ruleType, label: r.label, before: before.get(r.ruleType) ?? '',
                     after: r.currentRule ?? '', request: next.label, day: dayName(walk[i]) }));
  });
}
