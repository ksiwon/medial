import styled from 'styled-components';
import { pill } from '../ui/primitives';
import { deepA, inkA, night, px, radius, space, type } from '../ui/theme';
import { eventOf, versionOf, type Paths } from './selectors';
import type { RuleChange, Week, WeekEvent } from './types';

// The rules as they stand, over whatever the wall shows, while the tablet's "현재 규칙" is pressed: inside an event,
// the draft with that version's requests in force (what changed marked, and what it was); on the week, the draft and,
// under each rule, the events where the visitor changed it. Requests stay in their event (nothing carries over), and
// the page says so.

const Veil = styled.div`
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: ${space.xxl};
  background: ${deepA(0.72)};
`;

const Box = styled.section`
  width: min(100%, ${px(1400)});
  max-height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
  padding: ${space.xxl};
  border-radius: ${radius.card};
  background: ${night.panel};
  border: 1px solid ${night.line};
  color: ${night.ink};
  > header > small { font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.09em; color: ${night.accent}; }
  > header > h2 { margin: ${space.xs} 0 0; font-size: ${type.display}; font-weight: 800; letter-spacing: -0.04em; line-height: 1.15; }
  > header > p { margin: ${space.sm} 0 0; font-size: ${type.body}; line-height: 1.5; color: ${night.mute}; word-break: keep-all; }
`;

const List = styled.ol`
  list-style: none;
  margin: 0;
  padding: ${space.md} 0 0;
  border-top: 1px solid ${night.line};
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${space.lg} ${space.xl};
  > li { display: flex; flex-direction: column; gap: ${space.xs}; min-width: 0; }
  > li > b { font-size: ${type.title}; font-weight: 800; letter-spacing: -0.02em; display: flex; align-items: center; gap: ${space.sm}; flex-wrap: wrap; }
  > li > b > em { ${pill('xs')} font-style: normal; font-weight: 800; color: ${night.white}; background: ${night.accent}; }
  > li > s { font-size: ${type.body}; line-height: 1.5; color: ${night.faint}; text-decoration-color: ${inkA(0.35)}; word-break: keep-all; }
  > li > span { font-size: ${type.body}; line-height: 1.5; color: ${inkA(0.88)}; word-break: keep-all; }
  > li > span.on { font-weight: 700; color: ${night.ink}; }
  > li > i { font-style: normal; font-size: ${type.body}; line-height: 1.5; color: ${night.mute}; word-break: keep-all; }
  > li > i > strong { color: ${night.accent}; font-weight: 800; }
`;

/** The latest change to each rule along a version's requests, and the version that made it. */
function changesOf(event: WeekEvent, path: string[]): Map<string, { change: RuleChange; version: number }> {
  const out = new Map<string, { change: RuleChange; version: number }>();
  versionOf(event, path)?.chain.forEach((request, k) => {
    for (const change of request.rules) out.set(change.type, { change, version: k + 2 });
  });
  return out;
}

export default function RulesModal({ week, paths, eventId }: { week: Week; paths: Paths; eventId: string | null }) {
  const event = eventOf(week, eventId);
  if (event) {
    const path = paths[event.id] ?? [];
    const changed = changesOf(event, path);
    return (
      <Veil>
        <Box aria-label="현재 규칙">
          <header>
            <small>현재 규칙 · {event.title} · ver{path.length + 1}</small>
            <h2>이 사건에서 AI가 따르는 규칙</h2>
            <p>초안에 이 사건에서 고른 요청을 반영한 것입니다. 고친 규칙은 이 사건에만 적용되고, 다른 사건은 초안대로 돕니다.</p>
          </header>
          <List>
            {week.draft.map((rule) => {
              const c = changed.get(rule.type);
              return (
                <li key={rule.type}>
                  <b>{rule.label}{c && <em>ver{c.version}에서 바뀜</em>}</b>
                  {c && <s>{rule.sentence}</s>}
                  <span className={c ? 'on' : undefined}>{c ? c.change.afterSentence : rule.sentence}</span>
                </li>
              );
            })}
          </List>
        </Box>
      </Veil>
    );
  }
  return (
    <Veil>
      <Box aria-label="현재 규칙">
        <header>
          <small>현재 규칙 · 초안과 이번에 고친 것</small>
          <h2>AI가 따르는 규칙</h2>
          <p>모든 사건은 초안으로 처음 돌았습니다. 고친 규칙은 그 사건에만 적용되어, 사건마다 아래처럼 다르게 돕니다.</p>
        </header>
        <List>
          {week.draft.map((rule) => {
            const edits = week.events.flatMap((e) => {
              const c = changesOf(e, paths[e.id] ?? []).get(rule.type);
              return c ? [{ event: e, ...c }] : [];
            });
            return (
              <li key={rule.type}>
                <b>{rule.label}</b>
                <span>{rule.sentence}</span>
                {edits.map((x) => (
                  <i key={x.event.id}><strong>{x.event.title} ver{x.version}</strong> · {x.change.afterSentence}</i>
                ))}
              </li>
            );
          })}
        </List>
      </Box>
    </Veil>
  );
}
