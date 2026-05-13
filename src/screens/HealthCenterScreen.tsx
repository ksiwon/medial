// src/screens/HealthCenterScreen.tsx
import styled, { keyframes } from 'styled-components';
import { color, font, radius, border } from '../styles/tokens';
import { PhoneIcon, MessageIcon } from '../components/icons';
import { useAppStore } from '../store/useAppStore';

const blink = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.25; }
`;

const slideIn = keyframes`
  from { opacity: 0; transform: translateY(5px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Screen = styled.div`
  min-height: 100%;
  background: ${color.cream.light};
  display: flex;
  flex-direction: column;
`;

/* 의사 정보 헤더 */
const DocHeader = styled.div`
  background: ${color.sage[800]};
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 13px;
  flex-shrink: 0;
`;

const DocAvatarWrap = styled.div`
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: ${color.sage[600]};
  border: 2px solid rgba(255,255,255,0.2);
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
`;

const DocInfo = styled.div`
  flex: 1;
`;

const DocName = styled.div`
  font-size: ${font.size.appLg};
  font-weight: ${font.weight.bold};
  color: white;
`;

const DocTitle = styled.div`
  font-size: 10px;
  color: rgba(255,255,255,0.5);
  margin-bottom: 7px;
`;

const ConnectBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: ${radius.xxl};
`;

const BlinkDot = styled.div`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4ade80;
  animation: ${blink} 1.2s ease-in-out infinite;
`;

const ConnectText = styled.span`
  font-size: 10px;
  color: rgba(255,255,255,0.65);
  font-weight: ${font.weight.medium};
`;

/* 바디 */
const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  &::-webkit-scrollbar { width: 2px; }
`;

const SectionLabel = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[300]};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 5px;
`;

const InfoBlock = styled.div`
  background: ${color.white};
  border: ${border.thin};
  border-radius: ${radius.xl};
  overflow: hidden;
  animation: ${slideIn} 0.3s ease;
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 8px 13px;
  border-bottom: ${border.rule};

  &:last-child { border-bottom: none; }
`;

const InfoKey = styled.span`
  font-size: ${font.size.appSm};
  color: ${color.ink[300]};
  flex-shrink: 0;
  margin-right: 8px;
`;

const InfoVal = styled.span`
  font-size: ${font.size.appSm};
  font-weight: ${font.weight.medium};
  color: ${color.ink[700]};
  text-align: right;
  max-width: 62%;
`;

const SummaryBlock = styled.div`
  background: ${color.white};
  border: ${border.thin};
  border-radius: ${radius.xl};
  overflow: hidden;
`;

const SummaryItem = styled.div`
  font-size: ${font.size.appSm};
  color: ${color.ink[700]};
  line-height: 1.5;
  padding: 8px 13px;
  border-bottom: ${border.rule};
  display: flex;
  gap: 7px;
  align-items: flex-start;

  &:last-child { border-bottom: none; }

  &::before {
    content: '·';
    color: ${color.sage[400]};
    flex-shrink: 0;
    font-size: 14px;
    line-height: 1.3;
  }
`;

/* 버튼 행 */
const BtnRow = styled.div`
  display: flex;
  gap: 8px;
  padding: 8px 14px 0;
  flex-shrink: 0;
  background: ${color.cream.light};
  position: sticky;
  bottom: 0;
  z-index: 5;
  padding-bottom: 14px;
  border-top: ${border.thin};
`;

const ActionBtn = styled.button<{ $primary?: boolean }>`
  flex: 1;
  padding: 13px 10px;
  border-radius: ${radius.xl};
  border: ${({ $primary }) => $primary ? 'none' : border.mid};
  background: ${({ $primary }) => $primary ? color.healthBlue : color.white};
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.semiBold};
  color: ${({ $primary }) => $primary ? 'white' : color.ink[500]};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  transition: opacity 0.1s;
  box-shadow: ${({ $primary }) => $primary ? '0 2px 10px rgba(29,82,150,0.25)' : 'none'};

  &:active { opacity: 0.82; }
`;

/* 의사 SVG */
const DoctorSvg = () => (
  <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
    <circle cx="26" cy="19" r="10" fill="#F5DEB3" />
    <path d="M10 52 Q26 42 42 52" fill={color.sage[600]} />
    <ellipse cx="21" cy="18" rx="1.8" ry="2" fill="#3A2A1A" />
    <ellipse cx="31" cy="18" rx="1.8" ry="2" fill="#3A2A1A" />
    <path d="M22 23 Q26 26 30 23" stroke="#B06040" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    <path d="M16 11 Q26 5 36 11 Q34 21 26 21 Q18 21 16 11Z" fill="#3D3020" />
  </svg>
);

export default function HealthCenterScreen() {
  const { getCurrentCase, setCurrentScreen, setCurrentCase, currentCaseId } = useAppStore();
  const caseData = getCurrentCase();
  const { patient, reportData } = caseData;

  return (
    <Screen>
      <DocHeader>
        <DocAvatarWrap><DoctorSvg /></DocAvatarWrap>
        <DocInfo>
          <DocName>김민준 선생님</DocName>
          <DocTitle>관할 보건소 · 가정의학과</DocTitle>
          <ConnectBadge>
            <BlinkDot />
            <ConnectText>리포트 전송 완료 · 연결 대기 중</ConnectText>
          </ConnectBadge>
        </DocInfo>
      </DocHeader>

      <Body>
        <div>
          <SectionLabel>전달된 환자 정보</SectionLabel>
          <InfoBlock>
            <InfoRow>
              <InfoKey>이름 / 나이</InfoKey>
              <InfoVal>{patient.name} {patient.age}세 {patient.gender}</InfoVal>
            </InfoRow>
            <InfoRow>
              <InfoKey>기저질환</InfoKey>
              <InfoVal>{patient.conditions.join(', ')}</InfoVal>
            </InfoRow>
            <InfoRow>
              <InfoKey>알레르기</InfoKey>
              <InfoVal>{patient.allergies.join(', ')}</InfoVal>
            </InfoRow>
            <InfoRow>
              <InfoKey>주요 투약</InfoKey>
              <InfoVal>{patient.medications.map(m => m.name).join(', ')}</InfoVal>
            </InfoRow>
          </InfoBlock>
        </div>

        <div>
          <SectionLabel>오늘 증상 요약</SectionLabel>
          <SummaryBlock>
            {reportData.todaySummary.map((line, i) => (
              <SummaryItem key={i}>{line}</SummaryItem>
            ))}
          </SummaryBlock>
        </div>
      </Body>

      <BtnRow>
        <ActionBtn onClick={() => setCurrentScreen('report')}>
          <MessageIcon size={14} color={color.ink[500]} />
          리포트 보기
        </ActionBtn>
        <ActionBtn $primary>
          <PhoneIcon size={14} color="white" />
          전화 연결
        </ActionBtn>
      </BtnRow>
      <button
        onClick={() => setCurrentCase(currentCaseId)}
        style={{
          margin: '0 14px 14px',
          padding: '8px',
          border: 'none',
          background: 'none',
          fontSize: '11px',
          color: 'rgba(54,99,72,0.5)',
          cursor: 'pointer',
          textAlign: 'center',
          width: 'calc(100% - 28px)',
        }}
      >
        처음으로 돌아가기
      </button>
    </Screen>
  );
}
