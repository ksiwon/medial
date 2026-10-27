import { useRef } from 'react';
import styled from 'styled-components';
import { deepA, night, px, radius, shadeA, space, type } from '../ui/theme';
import { clipsContent, useFit } from '../ui/useFit';
import { JOBS, JobPanel, RuleItem } from './RuleViews';
import { eventOf, versionOf, type Paths } from './selectors';
import type { RuleChange, Rule, Week, WeekEvent } from './types';

// The rules as they stand, over whatever the wall shows, while the tablet's "현재 규칙" is pressed: inside an event,
// the draft with that version's requests in force (what changed marked, and what it was); on the week, the draft and,
// under each rule, the events where the visitor changed it. Requests stay in their event (nothing carries over), and
// the page says so. The rules are drawn by week/RuleViews, as on the draft page.

const Veil = styled.div`
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: ${space.xl};
  background: ${deepA(0.78)};
  backdrop-filter: blur(${px(8)});
`;

const Box = styled.section`
  width: min(100%, ${px(1520)});
  max-height: 100%;
  overflow: hidden;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
  padding: ${space.lg} ${space.xl} ${space.xl};
  border-radius: ${radius.card};
  background: ${night.panel};
  border: 1px solid ${night.line};
  box-shadow: 0 ${px(24)} ${px(64)} ${shadeA(0.5)};
  color: ${night.ink};
`;

const Top = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: ${space.xl};
  > div { min-width: 0; }
  > div > small { display: flex; align-items: center; gap: ${space.sm}; font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.09em; color: ${night.accent}; }
  > div > small::before { content: ''; width: ${px(28)}; height: 2px; background: ${night.accent}; }
  > div > h2 { margin: ${space.xs} 0 0; font-size: ${type.display}; font-weight: 800; letter-spacing: -0.04em; line-height: 1.15; }
  > div > p { margin: ${space.sm} 0 0; font-size: ${type.body}; line-height: 1.5; color: ${night.mute}; word-break: keep-all; max-width: ${px(760)}; }
`;

/** How much of the rules this page shows has been changed: said plainly, at the right of the title. */
const Count = styled.p`
  flex: none;
  margin: 0;
  font-size: ${type.lead};
  font-weight: 700;
  color: ${night.mute};
  > b { color: ${night.ink}; font-weight: 800; font-variant-numeric: tabular-nums; }
`;

const Cols = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${space.lg};
  align-items: start;
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
  const box = useRef<HTMLElement>(null);
  useFit(box, clipsContent, [week, paths, eventId]);
  const byType = new Map<string, Rule>(week.draft.map((r) => [r.type, r]));
  const jobs = JOBS.map((job) => ({ job, rules: job.rules.map((t) => byType.get(t)).filter((r): r is Rule => r !== undefined) }))
    .filter((j) => j.rules.length > 0);

  if (event) {
    const path = paths[event.id] ?? [];
    const changed = changesOf(event, path);
    const total = jobs.reduce((n, j) => n + j.rules.length, 0);
    return (
      <Veil>
        <Box ref={box} aria-label="현재 규칙">
          <Top>
            <div>
              <small>현재 규칙 · {event.title} · ver{path.length + 1}</small>
              <h2>이 사건에서 AI가 따르는 규칙</h2>
              <p>초안에 이 사건에서 고른 요청을 반영한 것입니다. 고친 규칙은 이 사건에만 적용되고, 다른 사건은 초안대로 돕니다.</p>
            </div>
            <Count>바뀐 규칙 <b>{changed.size}</b> / {total}</Count>
          </Top>
          <Cols>
            {jobs.map(({ job, rules }, i) => {
              const k = rules.filter((r) => changed.has(r.type)).length;
              return (
                <JobPanel key={job.title} index={i} job={job} dense ground={night.raised}
                  count={k > 0 ? `바뀐 규칙 ${k}개` : `규칙 ${rules.length}개`} hot={k > 0}>
                  {rules.map((r) => {
                    const c = changed.get(r.type);
                    return <RuleItem key={r.type} dense label={r.label} was={r.sentence}
                      now={c ? { sentence: c.change.afterSentence, version: c.version } : undefined} />;
                  })}
                </JobPanel>
              );
            })}
          </Cols>
        </Box>
      </Veil>
    );
  }

  const changedEvents = week.events.filter((e) => (paths[e.id]?.length ?? 0) > 0).length;
  return (
    <Veil>
      <Box ref={box} aria-label="현재 규칙">
        <Top>
          <div>
            <small>현재 규칙 · 초안과 이번에 고친 것</small>
            <h2>AI가 따르는 규칙</h2>
            <p>모든 사건은 초안으로 처음 돌았습니다. 고친 규칙은 그 사건에만 적용되어, 사건마다 아래처럼 다르게 돕니다.</p>
          </div>
          <Count>고친 사건 <b>{changedEvents}</b></Count>
        </Top>
        <Cols>
          {jobs.map(({ job, rules }, i) => {
            const edits = new Map(rules.map((r) => [r.type, week.events.flatMap((e) => {
              const c = changesOf(e, paths[e.id] ?? []).get(r.type);
              return c ? [{ by: e.title, version: c.version, sentence: c.change.afterSentence }] : [];
            })] as const));
            const k = [...edits.values()].filter((list) => list.length > 0).length;
            return (
              <JobPanel key={job.title} index={i} job={job} dense ground={night.raised}
                count={k > 0 ? `고친 규칙 ${k}개` : `규칙 ${rules.length}개`} hot={k > 0}>
                {rules.map((r) => <RuleItem key={r.type} dense label={r.label} was={r.sentence} edits={edits.get(r.type)} />)}
              </JobPanel>
            );
          })}
        </Cols>
      </Box>
    </Veil>
  );
}
