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
