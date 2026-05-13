// src/components/layout/TweaksPanel.tsx
import styled from 'styled-components';
import { color, font, radius, border } from '../../styles/tokens';
import { useAppStore } from '../../store/useAppStore';
import { cases } from '../../data/mockData';

/* ── 패널 (라이트 테마) ─────────────────────────────── */
const Panel = styled.aside`
  width: 215px;
  flex-shrink: 0;
  height: 100%;
  overflow-y: auto;
  padding: 20px 14px 24px;
  background: #E0DAD0;
  border-left: 1px solid rgba(0,0,0,0.07);
  display: flex;
  flex-direction: column;
  gap: 18px;

  &::-webkit-scrollbar { width: 2px; }
  &::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 1px; }
`;

const SectionTitle = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: rgba(0,0,0,0.30);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 8px;
`;

const CaseBtn = styled.button<{ $active: boolean }>`
  width: 100%;
  padding: 9px 11px;
  text-align: left;
  border-radius: ${radius.md};
  border: 1px solid ${({ $active }) => $active ? color.sage[500] : 'rgba(0,0,0,0.09)'};
  background: ${({ $active }) => $active ? 'rgba(54,99,72,0.10)' : 'rgba(255,255,255,0.55)'};
  font-size: 11px;
  font-weight: ${({ $active }) => $active ? font.weight.semiBold : font.weight.regular};
  color: ${({ $active }) => $active ? color.sage[700] : 'rgba(0,0,0,0.50)'};
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  line-height: 1.4;
  margin-bottom: 5px;

  &:hover {
    background: rgba(54,99,72,0.06);
    color: rgba(0,0,0,0.70);
  }
`;

const InfoCard = styled.div`
  background: rgba(255,255,255,0.6);
  border: 1px solid rgba(0,0,0,0.07);
  border-radius: ${radius.md};
  padding: 10px 11px;
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 0;
`;

const InfoKey = styled.span`
  font-size: 10px;
  color: rgba(0,0,0,0.32);
`;

const InfoVal = styled.span`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: rgba(0,0,0,0.65);
`;

const ToggleRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid rgba(0,0,0,0.05);
  &:last-child { border-bottom: none; }
`;

const ToggleLabel = styled.span`
  font-size: 11px;
  color: rgba(0,0,0,0.50);
`;

const Toggle = styled.button<{ $on: boolean }>`
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: ${({ $on }) => $on ? color.sage[600] : 'rgba(0,0,0,0.14)'};
  position: relative;
  transition: background 0.2s;
  border: none;
  cursor: pointer;

  &::after {
    content: '';
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: white;
    top: 3px;
    left: ${({ $on }) => $on ? '17px' : '3px'};
    transition: left 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
`;

/* ── 컴포넌트 ──────────────────────────────────────────── */
export default function TweaksPanel() {
  const {
    currentCaseId,
    setCurrentCase,
    showFaceAnalysis,
    showEmpathy,
    showAiRecommendation,
    toggleFaceAnalysis,
    toggleEmpathy,
    toggleAiRecommendation,
    getCurrentCase,
  } = useAppStore();

  const patient = getCurrentCase().patient;

  return (
    <Panel>
      {/* 케이스 선택 */}
      <div>
        <SectionTitle>케이스 선택</SectionTitle>
        {cases.map((c) => (
          <CaseBtn
            key={c.id}
            $active={currentCaseId === c.id}
            onClick={() => setCurrentCase(c.id)}
          >
            {c.label}
          </CaseBtn>
        ))}
      </div>

      {/* 환자 정보 */}
      <div>
        <SectionTitle>환자 정보</SectionTitle>
        <InfoCard>
          <InfoRow>
            <InfoKey>이름</InfoKey>
            <InfoVal>{patient.name}</InfoVal>
          </InfoRow>
          <InfoRow>
            <InfoKey>나이</InfoKey>
            <InfoVal>{patient.age}세 / {patient.gender}</InfoVal>
          </InfoRow>
          <InfoRow>
            <InfoKey>상담 횟수</InfoKey>
            <InfoVal>{patient.sessionCount}회</InfoVal>
          </InfoRow>
          <InfoRow>
            <InfoKey>혈액형</InfoKey>
            <InfoVal>{patient.bloodType}</InfoVal>
          </InfoRow>
        </InfoCard>
      </div>

      {/* 표시 설정 */}
      <div>
        <SectionTitle>표시 설정</SectionTitle>
        <ToggleRow>
          <ToggleLabel>표정 분석 배너</ToggleLabel>
          <Toggle $on={showFaceAnalysis} onClick={toggleFaceAnalysis} />
        </ToggleRow>
        <ToggleRow>
          <ToggleLabel>공감 문구</ToggleLabel>
          <Toggle $on={showEmpathy} onClick={toggleEmpathy} />
        </ToggleRow>
        <ToggleRow>
          <ToggleLabel>AI 판단 권고</ToggleLabel>
          <Toggle $on={showAiRecommendation} onClick={toggleAiRecommendation} />
        </ToggleRow>
      </div>

      {/* 지역: 항상 농촌 */}
      <div>
        <SectionTitle>지역</SectionTitle>
        <InfoCard>
          <InfoRow>
            <InfoKey>대상 지역</InfoKey>
            <InfoVal style={{ color: color.sage[700] }}>농촌</InfoVal>
          </InfoRow>
        </InfoCard>
      </div>
    </Panel>
  );
}
