import { useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import { api } from '../api/client';
import { deepA, inkA, night, px, space, type } from '../ui/theme';
import { tallerThanParent, useFit } from '../ui/useFit';
import { Chip, figuresOf, JOBS, JobPanel, RuleItem } from './RuleViews';
import type { Rule, Week } from './types';

// The draft the designer brought, between the film and the week: what the AI is for and the rules it runs under
// before anything is chosen. One set for the whole week (the server refuses a week whose events disagree), so every
// version the visitor reads later is this draft with their requests in force. The tablet only goes on (or the clock
// does, week/auto.ts). The rules are drawn by week/RuleViews, as they are over an event ("현재 규칙").

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
  padding: ${space.xl} ${px(96)};
  display: flex;
  flex-direction: column;
  gap: ${space.xl};
`;

const Head = styled.header`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  > small { display: flex; align-items: center; gap: ${space.sm}; font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.09em; color: ${night.accent}; }
  > small::before { content: ''; width: ${px(28)}; height: 2px; background: ${night.accent}; }
  > h1 { margin: 0; font-size: ${type.hero}; font-weight: 800; letter-spacing: -0.04em; line-height: 1.15; }
  > p { margin: 0; font-size: ${type.lead}; line-height: 1.6; color: ${night.mute}; word-break: keep-all; max-width: ${px(1100)}; }
`;

const Jobs = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${space.xl};
  align-items: stretch;
  > section { animation: ${rise} 0.7s ease both; }
  > section:nth-child(1) { animation-delay: 0.2s; }
  > section:nth-child(2) { animation-delay: 0.45s; }
`;

/** What the chips in the rules are, said once under them. */
const Legend = styled.p`
  margin: 0;
  display: flex;
  align-items: center;
  gap: ${space.sm};
  font-size: ${type.body};
  color: ${night.mute};
  > span { color: ${inkA(0.86)}; }
`;

export default function DraftScreen({ week, art }: { week: Week; art: ReadonlySet<string> }) {
  const byType = new Map<string, Rule>(week.draft.map((r) => [r.type, r]));
  const example = week.draft.flatMap((r) => figuresOf(r.sentence))[0];
  const inner = useRef<HTMLDivElement>(null);
  useFit(inner, tallerThanParent, [week]);
  return (
    <Film $src={art.has('INTRO.desk') ? api.artUrl('INTRO.desk') : null} aria-label="AI 조율자 초안">
      <Inner ref={inner}>
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
              <JobPanel key={job.title} index={i} job={job} ground={deepA(0.66)} count={`규칙 ${rules.length}개`}
                footer={i === JOBS.length - 1 && example ? <Legend><Chip>{example}</Chip><span>이런 숫자는 수정 요청으로 바뀔 수 있습니다.</span></Legend> : undefined}>
                {rules.map((r) => <RuleItem key={r.type} label={r.label} was={r.sentence} />)}
              </JobPanel>
            );
          })}
        </Jobs>
      </Inner>
    </Film>
  );
}
