// src/components/layout/DescPanel.tsx — light theme
import styled from 'styled-components';
import { color, font, radius, border } from '../../styles/tokens';
import { ScreenDescription, ThemeCategory } from '../../types';

/* ── 패널 ──────────────────────────────────────────────── */
const Panel = styled.div`
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 24px 22px 32px;
  border-right: 1px solid rgba(0,0,0,0.07);
  border-left: 1px solid rgba(0,0,0,0.07);
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: transparent;

  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 1px; }
`;

/* ── 화면 제목 ─────────────────────────────────────────── */
const ScreenLabel = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: ${color.sage[500]};
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 5px;
`;

const Title = styled.h2`
  font-size: 20px;
  font-weight: ${font.weight.bold};
  color: ${color.ink[900]};
  line-height: 1.3;
  margin-bottom: 7px;
`;

const Desc = styled.p`
  font-size: 12px;
  color: ${color.ink[500]};
  line-height: 1.7;
`;

/* ── 연구 주제 태그 ─────────────────────────────────────── */
const ResearchTopicRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
`;

const TopicTag = styled.span`
  font-size: 10px;
  font-weight: ${font.weight.medium};
  color: ${color.sage[700]};
  background: rgba(54,99,72,0.08);
  border: 1px solid rgba(54,99,72,0.18);
  border-radius: ${radius.md};
  padding: 2px 8px;
  line-height: 1.5;
`;

/* ── 구분선 ─────────────────────────────────────────────── */
const Rule = styled.div`
  height: 1px;
  background: rgba(0,0,0,0.08);
  flex-shrink: 0;
`;

/* ── 섹션 헤더 ──────────────────────────────────────────── */
const SectionHead = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: rgba(0,0,0,0.28);
  letter-spacing: 0.09em;
  text-transform: uppercase;
`;

/* ── 인터뷰 코드 카드 ────────────────────────────────────── */
const CodeCard = styled.div<{ $category: ThemeCategory }>`
  background: ${color.white};
  border: 1px solid ${({ $category }) => {
    switch ($category) {
      case 'barrier':   return 'rgba(176,48,32,0.18)';
      case 'behavior':  return 'rgba(54,99,72,0.18)';
      case 'condition': return 'rgba(212,150,10,0.22)';
      case 'insight':   return 'rgba(54,99,72,0.14)';
    }
  }};
  border-left: 3px solid ${({ $category }) => {
    switch ($category) {
      case 'barrier':   return color.terra.base;
      case 'behavior':  return color.sage[500];
      case 'condition': return color.yellow;
      case 'insight':   return color.sage[300];
    }
  }};
  border-radius: ${radius.xl};
  padding: 12px 13px;
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const CodeTopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

const CodeEn = styled.span`
  font-size: 10px;
  font-weight: ${font.weight.medium};
  color: ${color.ink[300]};
  letter-spacing: 0.02em;
  flex: 1;
  min-width: 0;
`;

const CategoryPill = styled.span<{ $category: ThemeCategory }>`
  font-size: 9px;
  font-weight: ${font.weight.semiBold};
  padding: 1px 6px;
  border-radius: ${radius.md};
  flex-shrink: 0;
  background: ${({ $category }) => {
    switch ($category) {
      case 'barrier':   return 'rgba(176,48,32,0.10)';
      case 'behavior':  return 'rgba(54,99,72,0.10)';
      case 'condition': return 'rgba(212,150,10,0.12)';
      case 'insight':   return 'rgba(54,99,72,0.08)';
    }
  }};
  color: ${({ $category }) => {
    switch ($category) {
      case 'barrier':   return color.terra.base;
      case 'behavior':  return color.sage[600];
      case 'condition': return color.yellow;
      case 'insight':   return color.sage[500];
    }
  }};
`;

const CATEGORY_KR: Record<ThemeCategory, string> = {
  barrier:   '장벽',
  behavior:  '행동',
  condition: '조건',
  insight:   '인사이트',
};

const CodeKr = styled.div`
  font-size: 12px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[700]};
  line-height: 1.3;
`;

const Finding = styled.p`
  font-size: 11px;
  color: ${color.ink[300]};
  line-height: 1.65;
`;

const QuoteBlock = styled.p`
  font-size: 11px;
  color: ${color.yellow};
  font-style: italic;
  border-left: 2px solid rgba(212,150,10,0.22);
  padding-left: 8px;
  margin-top: 2px;
  line-height: 1.55;
`;

const SourceLabel = styled.div`
  font-size: 9px;
  color: ${color.ink[100]};
  letter-spacing: 0.04em;
  margin-top: 1px;
`;

/* ── 디자인 의도 ─────────────────────────────────────────── */
const IntentCard = styled.div`
  background: rgba(54,99,72,0.06);
  border: 1px solid rgba(54,99,72,0.14);
  border-radius: ${radius.xl};
  padding: 13px 14px;
  display: flex;
  flex-direction: column;
  gap: 9px;
`;

const IntentHead = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: ${color.sage[600]};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const IntentRow = styled.div`
  display: flex;
  gap: 9px;
  align-items: flex-start;
`;

const IntentNum = styled.div`
  width: 17px;
  height: 17px;
  border-radius: ${radius.md};
  background: rgba(54,99,72,0.14);
  font-size: 10px;
  font-weight: ${font.weight.bold};
  color: ${color.sage[600]};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
`;

const IntentText = styled.div`
  font-size: 11px;
  color: ${color.ink[500]};
  line-height: 1.65;

  strong {
    color: ${color.ink[700]};
    font-weight: ${font.weight.semiBold};
  }
`;

/* ── 범례 ─────────────────────────────────────────────────── */
const LegendRow = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  color: ${color.ink[300]};
`;

const LegendDot = styled.div<{ $category: ThemeCategory }>`
  width: 6px;
  height: 6px;
  border-radius: 1px;
  flex-shrink: 0;
  background: ${({ $category }) => {
    switch ($category) {
      case 'barrier':   return color.terra.base;
      case 'behavior':  return color.sage[500];
      case 'condition': return color.yellow;
      case 'insight':   return color.sage[300];
    }
  }};
`;

const CATEGORIES: ThemeCategory[] = ['barrier', 'behavior', 'condition', 'insight'];

/* ── 컴포넌트 ─────────────────────────────────────────────── */
interface Props {
  screen: ScreenDescription;
}

export default function DescPanel({ screen }: Props) {
  return (
    <Panel>
      {/* 화면 헤더 */}
      <div>
        <ScreenLabel>{screen.label}</ScreenLabel>
        <Title>{screen.title}</Title>
        <Desc>{screen.desc}</Desc>
      </div>

      {/* 연구 주제 태그 */}
      {screen.researchTopics && screen.researchTopics.length > 0 && (
        <div>
          <SectionHead style={{ marginBottom: 7 }}>관련 인터뷰 연구 주제</SectionHead>
          <ResearchTopicRow>
            {screen.researchTopics.map((t) => (
              <TopicTag key={t}>{t}</TopicTag>
            ))}
          </ResearchTopicRow>
        </div>
      )}

      <Rule />

      {/* 범례 */}
      <LegendRow>
        {CATEGORIES.map((cat) => (
          <LegendItem key={cat}>
            <LegendDot $category={cat} />
            {CATEGORY_KR[cat]}
          </LegendItem>
        ))}
      </LegendRow>

      {/* 인터뷰 코드 */}
      <SectionHead>인터뷰 주제 코딩</SectionHead>

      {screen.themeCodes.map((code) => (
        <CodeCard key={code.code} $category={code.category}>
          <CodeTopRow>
            <CodeEn>{code.code}</CodeEn>
            <CategoryPill $category={code.category}>{CATEGORY_KR[code.category]}</CategoryPill>
          </CodeTopRow>
          <CodeKr>{code.codeKr}</CodeKr>
          <Finding>{code.finding}</Finding>
          {code.quote && <QuoteBlock>"{code.quote}"</QuoteBlock>}
          {code.sourceTree && (
            <SourceLabel>출처 트리: {code.sourceTree}</SourceLabel>
          )}
        </CodeCard>
      ))}

      <Rule />

      {/* 디자인 의도 */}
      <IntentCard>
        <IntentHead>디자인 의도</IntentHead>
        {screen.designIntent.map((item, i) => (
          <IntentRow key={i}>
            <IntentNum>{i + 1}</IntentNum>
            <IntentText>
              <strong>{item.point}</strong> — {item.rationale}
            </IntentText>
          </IntentRow>
        ))}
      </IntentCard>
    </Panel>
  );
}
