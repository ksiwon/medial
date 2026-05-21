// src/components/layout/DescPanel.tsx — InsightPanel DR4 재설계
import styled, { keyframes } from 'styled-components';
import { color, font, border } from '../../styles/tokens';
import { ScreenDescription, DR } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { screenDescriptions } from '../../data/mockData';

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
`;

/* ── DR 정의 ──────────────────────────────────── */
const DR_INFO: Record<DR, { label: string; desc: string; color: string }> = {
  1: { label: 'DR1', desc: '학습 가능성', color: color.sage[600] },
  2: { label: 'DR2', desc: '의료 접근 보완', color: color.healthBlue },
  3: { label: 'DR3', desc: '신뢰 구축', color: color.amber.base },
  4: { label: 'DR4', desc: '능동적 공감', color: color.terra.mid },
};

/* ── 인터뷰 인용구 (affinity 데이터 기반) ──────── */
const INSIGHT_QUOTES = [
  {
    p: 'P3', cluster: '기술 접근성', affinityCode: '[Accessibility]',
    dr: [1] as DR[],
    quote: '앱 사용법을 가르쳐 줄 사람이 필요하지만 한번 가르쳐 주면 그 뒤엔 잘 씀.',
  },
  {
    p: 'P7', cluster: '디지털 리터러시', affinityCode: '[Digital Literacy]',
    dr: [1] as DR[],
    quote: '지속적으로 사용해오고 나서는 별로 사용하기 어렵지 않음.',
  },
  {
    p: 'P2', cluster: '신기술 거부감', affinityCode: '[Anxiety]',
    dr: [1, 4] as DR[],
    quote: '너무 나이를 먹어서인지 새로운 것에 두려움이 생김.',
  },
  {
    p: 'P5', cluster: '의료 자원 부족', affinityCode: '[Capability]',
    dr: [2] as DR[],
    quote: '병원 한 명의 의사가 2천 명 가까이 담당하는 실정.',
  },
  {
    p: 'P9', cluster: '시골 의료 불신', affinityCode: '[Decision]',
    dr: [2, 3] as DR[],
    quote: '시골 의사들은 실력도 없고 과잉 진료를 하려고 해서 신뢰도가 없음.',
  },
  {
    p: 'P1', cluster: '이동 시간', affinityCode: '[Transfer]',
    dr: [2] as DR[],
    quote: '대중교통의 열악함과 시간적 비용으로 이동이 힘들어 병원을 못 감.',
  },
  {
    p: 'P6', cluster: '갑을 관계', affinityCode: '[Conversation]',
    dr: [3, 4] as DR[],
    quote: '의사에게 말을 못하고 두려워하다 그냥 병원을 안 가게 됨.',
  },
  {
    p: 'P4', cluster: '전문성', affinityCode: '[Reliability]',
    dr: [3] as DR[],
    quote: 'AI가 지금보다 발전한다면 전적으로 믿고 따를 것 같다.',
  },
  {
    p: 'P10', cluster: 'AI 친밀감', affinityCode: '[Emotional]',
    dr: [3, 4] as DR[],
    quote: 'AI가 나한테 잘 봐준다면 정말 좋겠다.',
  },
  {
    p: 'P8', cluster: '음성 인터랙션', affinityCode: '[Voice Interaction]',
    dr: [1, 4] as DR[],
    quote: '스마트폰으로 말하는 것이 타이핑보다 훨씬 편함.',
  },
  {
    p: 'P11', cluster: '비언어 인식', affinityCode: '[Non-Face-to-Face]',
    dr: [4] as DR[],
    quote: '얼굴을 못 보고 진료하는 것이 아쉽지만, AI가 표정도 볼 수 있다면 좋겠다.',
  },
  {
    p: 'P3', cluster: '원활한 소통', affinityCode: '[Conversation]',
    dr: [4] as DR[],
    quote: 'AI가 내 말을 쉽게 이해해줬으면 하고, 서로 잘 통하는 느낌을 받고 싶다.',
  },
];

/* ── 화면별 DR 매핑 ──────────────────────────── */
const SCREEN_DR_MAP: Record<string, DR[]> = {
  home:        [1, 3],
  chat:        [1, 4],
  analyzing:   [2],
  photo:       [2, 4],
  decision:    [2, 3],
  emergency:   [2],
  healthCenter:[2, 3],
  selfCare:    [2, 4],
  report:      [2, 3],
};

/* ── 스타일 ────────────────────────────────────── */
const Panel = styled.div`
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 16px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: transparent;
  border-left: 1px solid rgba(0,0,0,0.07);

  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 1px; }
`;

/* ── DR 스트립 ──────────────────────────────────── */
const DrStrip = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 4px;
`;

const DrChip = styled.div<{ $active: boolean; $drColor: string }>`
  padding: 5px 4px;
  border-radius: 5px;
  background: ${({ $active, $drColor }) => $active ? $drColor : 'rgba(0,0,0,0.05)'};
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  transition: all 0.25s;
`;

const DrLabel = styled.div<{ $active: boolean }>`
  font-family: ${font.mono};
  font-size: 10px;
  font-weight: 700;
  color: ${({ $active }) => $active ? 'white' : 'rgba(0,0,0,0.3)'};
  letter-spacing: 0.04em;
`;

const DrDesc = styled.div<{ $active: boolean }>`
  font-size: 8.5px;
  color: ${({ $active }) => $active ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.22)'};
  text-align: center;
  line-height: 1.2;
`;

/* ── 핵심 발견 배너 ──────────────────────────────── */
const FindingBanner = styled.div`
  padding: 10px 12px;
  background: ${color.amber.pale};
  border-left: 3px solid ${color.amber.base};
  border-radius: 0 6px 6px 0;
  animation: ${fadeIn} 0.3s ease both;
`;

const FindingText = styled.div`
  font-size: 11px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[700]};
  line-height: 1.5;
`;

/* ── 섹션 제목 ──────────────────────────────────── */
const SectionHead = styled.div`
  font-size: 9.5px;
  font-weight: ${font.weight.bold};
  color: rgba(0,0,0,0.35);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: ${font.mono};
  margin-top: 4px;
`;

/* ── 화면 설명 ──────────────────────────────────── */
const ScreenTitle = styled.div`
  font-size: 14px;
  font-weight: ${font.weight.bold};
  color: ${color.ink[900]};
  line-height: 1.4;
`;

const ScreenDesc = styled.div`
  font-size: 11.5px;
  color: ${color.ink[500]};
  line-height: 1.6;
`;

/* ── 인터뷰 인용 카드 ──────────────────────────── */
const QuoteCard = styled.div<{ $delay: number }>`
  background: white;
  border: 1px solid rgba(0,0,0,0.07);
  border-radius: 6px;
  padding: 9px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  animation: ${fadeIn} 0.25s ease ${({ $delay }) => $delay * 0.06}s both;
`;

const QuoteTop = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
`;

const PNum = styled.div`
  font-family: ${font.mono};
  font-size: 9px;
  font-weight: 700;
  color: ${color.ink[300]};
  background: rgba(0,0,0,0.06);
  padding: 1px 5px;
  border-radius: 3px;
`;

const AffinityTag = styled.div`
  font-family: ${font.mono};
  font-size: 9px;
  color: ${color.sage[600]};
  background: ${color.sage[50]};
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid ${color.sage[200]};
`;

const DrTag = styled.div<{ $drColor: string }>`
  font-family: ${font.mono};
  font-size: 9px;
  font-weight: 700;
  color: white;
  background: ${({ $drColor }) => $drColor};
  padding: 1px 5px;
  border-radius: 3px;
`;

const QuoteText = styled.div`
  font-size: 11px;
  color: ${color.ink[700]};
  line-height: 1.6;
  font-style: italic;
`;

/* ── 디자인 인텐트 ──────────────────────────────── */
const IntentCard = styled.div<{ $delay: number }>`
  padding: 9px 10px;
  background: ${color.cream.base};
  border-radius: 6px;
  border-left: 2.5px solid ${color.sage[400]};
  animation: ${fadeIn} 0.25s ease ${({ $delay }) => $delay * 0.06}s both;
`;

const IntentPoint = styled.div`
  font-size: 11px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[700]};
  margin-bottom: 2px;
`;

const IntentRationale = styled.div`
  font-size: 10.5px;
  color: ${color.ink[300]};
  line-height: 1.5;
`;

/* ── IRB footer ──────────────────────────────────── */
const IrbFooter = styled.div`
  margin-top: 8px;
  padding: 10px;
  background: rgba(0,0,0,0.04);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const IrbLine = styled.div`
  font-family: ${font.mono};
  font-size: 9px;
  color: rgba(0,0,0,0.32);
  line-height: 1.5;
`;

/* ── 컴포넌트 ─────────────────────────────────────── */
interface Props {
  screen: ScreenDescription;
}

export default function DescPanel({ screen }: Props) {
  const { currentScreen } = useAppStore();
  const activeDRs = SCREEN_DR_MAP[currentScreen] ?? [];

  // 현재 화면과 관련된 DR에 해당하는 인용구만 필터
  const relevantQuotes = INSIGHT_QUOTES.filter(q =>
    q.dr.some(d => activeDRs.includes(d))
  ).slice(0, 5);

  return (
    <Panel>
      {/* DR 스트립 */}
      <div>
        <SectionHead style={{ marginBottom: 6 }}>Design Requirements</SectionHead>
        <DrStrip>
          {([1, 2, 3, 4] as DR[]).map((dr) => {
            const info = DR_INFO[dr];
            const active = activeDRs.includes(dr);
            return (
              <DrChip key={dr} $active={active} $drColor={info.color}>
                <DrLabel $active={active}>{info.label}</DrLabel>
                <DrDesc $active={active}>{info.desc}</DrDesc>
              </DrChip>
            );
          })}
        </DrStrip>
      </div>

      {/* 핵심 발견 배너 3개 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <SectionHead>Core Findings</SectionHead>
        <FindingBanner>
          <FindingText>No more Digital Divide,<br />Just Accessibility &amp; Learnability Issue</FindingText>
        </FindingBanner>
        <FindingBanner>
          <FindingText>주된 신뢰는 경험과 소통으로부터</FindingText>
        </FindingBanner>
        <FindingBanner>
          <FindingText>친밀감 · 맞춤형 · 지속형 · 전문성이 신뢰로 이어짐</FindingText>
        </FindingBanner>
      </div>

      {/* 화면 설명 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <SectionHead>{screen.label}</SectionHead>
        <ScreenTitle>{screen.title}</ScreenTitle>
        <ScreenDesc>{screen.desc}</ScreenDesc>
      </div>

      {/* 인터뷰 인용 */}
      {relevantQuotes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SectionHead>Interview Evidence</SectionHead>
          {relevantQuotes.map((q, i) => (
            <QuoteCard key={i} $delay={i}>
              <QuoteTop>
                <PNum>{q.p}</PNum>
                <AffinityTag>{q.affinityCode}</AffinityTag>
                {q.dr.map(d => (
                  <DrTag key={d} $drColor={DR_INFO[d].color}>{DR_INFO[d].label}</DrTag>
                ))}
              </QuoteTop>
              <QuoteText>"{q.quote}"</QuoteText>
            </QuoteCard>
          ))}
        </div>
      )}

      {/* 디자인 인텐트 */}
      {screen.designIntent.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SectionHead>Design Intent</SectionHead>
          {screen.designIntent.map((d, i) => (
            <IntentCard key={i} $delay={i}>
              <IntentPoint>{d.point}</IntentPoint>
              <IntentRationale>{d.rationale}</IntentRationale>
            </IntentCard>
          ))}
        </div>
      )}

      {/* IRB footer */}
      <IrbFooter>
        <IrbLine>KAIST IRB-2026-56 승인</IrbLine>
        <IrbLine>N=11 · M=64.6세 · SD=7.9 · 농촌 시니어</IrbLine>
        <IrbLine>Beyer &amp; Holtzblatt (1999) Affinity Diagramming</IrbLine>
      </IrbFooter>
    </Panel>
  );
}
