import styled, { keyframes } from 'styled-components';
import { api } from '../api/client';
import { deepA, inkA, night, px, radius, space, type } from '../ui/theme';
import type { Rule, Week } from './types';

// The draft the designer brought, between the film and the week: what the AI is for and the rules it runs under
// before anything is chosen. One set for the whole week (the server refuses a week whose events disagree), so every
// version the visitor reads later is this draft with their requests in force. The tablet only goes on (or the clock
// does, week/auto.ts).

/** The AI's two jobs (AGENTS.md: the unanswered check-in, the ride to the clinic), and which rules belong to each. */
export const JOBS: { title: string; gist: string; rules: string[] }[] = [
  {
    title: '안부가 닿지 않을 때',
    gist: '어르신이 안부에 답하지 않으면, 다시 묻고 이웃과 기관에 알립니다.',
    rules: ['retry_before_help', 'quiet_period', 'contact_order', 'disclosure_scope', 'institution_deadline'],
  },
  {
    title: '이웃에게 부탁할 때',
    gist: '확인이나 병원 길을 이웃에게 부탁합니다. 한 사람에게 몰리지 않게 나눕니다.',
    rules: ['helper_daily_cap', 'neighbour_ask_limit', 'ride_candidate_order', 'ride_detour_limit'],
  },
];

const rise = keyframes`from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; }`;

const Film = styled.div<{ $src: string | null }>`
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  background: ${night.deep} ${(p) => (p.$src ? `url(${p.$src})` : 'none')} center / cover no-repeat;
  &::before { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, ${deepA(0.9)} 0%, ${deepA(0.8)} 60%, ${deepA(0.55)} 100%); }
  > * { position: relative; }
`;

const Inner = styled.div`
  width: 100%;
  box-sizing: border-box;
  padding: ${space.xxl} ${px(96)};
  display: flex;
  flex-direction: column;
  gap: ${space.xxl};
`;

const Head = styled.header`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  > small { font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.09em; color: ${night.accent}; }
  > h1 { margin: 0; font-size: ${type.hero}; font-weight: 800; letter-spacing: -0.04em; line-height: 1.15; }
  > p { margin: 0; font-size: ${type.lead}; line-height: 1.6; color: ${night.mute}; word-break: keep-all; max-width: ${px(1100)}; }
`;

const Jobs = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${space.xl};
  align-items: start;
`;

const Job = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
  padding: ${space.xl};
  border-radius: ${radius.card};
  background: ${deepA(0.66)};
  border: 1px solid ${night.line};
  animation: ${rise} 0.7s ease both;
  > header > h2 { margin: 0; font-size: ${type.heading}; font-weight: 800; letter-spacing: -0.03em; line-height: 1.2; }
  > header > p { margin: ${space.xs} 0 0; font-size: ${type.body}; line-height: 1.55; color: ${night.mute}; word-break: keep-all; }
  > ol { list-style: none; margin: 0; padding: ${space.md} 0 0; border-top: 1px solid ${night.line}; display: flex; flex-direction: column; gap: ${space.lg}; }
  > ol > li { display: flex; flex-direction: column; gap: ${space.xs}; }
  > ol > li > b { font-size: ${type.title}; font-weight: 800; letter-spacing: -0.02em; }
  > ol > li > span { font-size: ${type.body}; line-height: 1.55; color: ${inkA(0.86)}; word-break: keep-all; }
`;

export default function DraftScreen({ week, art }: { week: Week; art: ReadonlySet<string> }) {
  const byType = new Map<string, Rule>(week.draft.map((r) => [r.type, r]));
  return (
    <Film $src={art.has('INTRO.desk') ? api.artUrl('INTRO.desk') : null} aria-label="AI 조율자 초안">
      <Inner>
        <Head>
          <small>서비스 디자이너가 들고 온 초안 · ver1</small>
          <h1>AI 조율자 초안</h1>
          <p>어르신의 안부를 살피고 이웃과 병원을 이어 주는 AI입니다. 한 주의 모든 사건이 이 규칙으로 처음 돌았습니다. 주민의 피드백을 읽고, 사건마다 규칙을 하나씩 고쳐 봅니다.</p>
        </Head>
        <Jobs>
          {JOBS.map((job, i) => {
            const rules = job.rules.map((t) => byType.get(t)).filter((r): r is Rule => r !== undefined);
            if (rules.length === 0) return null;
            return (
              <Job key={job.title} style={{ animationDelay: `${0.2 + i * 0.25}s` }}>
                <header><h2>{job.title}</h2><p>{job.gist}</p></header>
                <ol>{rules.map((r) => <li key={r.type}><b>{r.label}</b><span>{r.sentence}</span></li>)}</ol>
              </Job>
            );
          })}
        </Jobs>
      </Inner>
    </Film>
  );
}
