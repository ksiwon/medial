// src/screens/live/LiveIdleScreen.tsx — SCREEN 01 (Idle / Touch to Start)
//
// DR3 (신뢰 구축, 연속성): shows recent prior visits fetched from /api/visits
// DR3 (데이터 보호): explicit reassurance about voice/data handling
// DR1 (학습 가능성): single touch CTA, large legible text
import { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { color, font, border } from '../../styles/tokens';
import VirtualDoctor from '../../components/phone/VirtualDoctor';
import { useAppStore } from '../../store/useAppStore';
import { useWebSocket } from '../../hooks/useWebSocket';

interface PriorVisit {
  session_code: string;
  started_at: number;
  chief_complaint: string;
  symptoms: string[];
  triage: string;
}

const breathePulse = keyframes`
  0%, 100% { opacity: 0.55; transform: scale(1); }
  50%       { opacity: 0.85; transform: scale(1.012); }
`;
const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Screen = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background: ${color.cream.light};
  position: relative;
  overflow: hidden;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
`;

const TopAccent = styled.div`
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, ${color.sage[600]}, ${color.sage[400]}, ${color.sage[600]});
`;

const AvatarZone = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 16px 0;
  gap: 8px;
`;
const AvatarGlow = styled.div`
  position: relative;
  display: flex; align-items: center; justify-content: center;
`;
const GlowRing = styled.div`
  position: absolute;
  width: 110px; height: 110px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(54,99,72,0.12) 0%, transparent 70%);
  animation: ${breathePulse} 3.5s ease-in-out infinite;
`;
const MediName = styled.div`
  font-size: 16px;
  font-weight: ${font.weight.bold};
  color: ${color.sage[700]};
  letter-spacing: -0.02em;
  animation: ${fadeUp} 0.5s ease both;
`;
const MediRole = styled.div`
  font-size: 10.5px;
  color: ${color.ink[300]};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-family: ${font.mono};
  margin-top: 2px;
  animation: ${fadeUp} 0.5s ease 0.05s both;
`;

const TouchCard = styled.div`
  margin: 10px 14px 6px;
  background: ${color.white};
  border: 2px solid ${color.sage[300]};
  border-radius: 14px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  box-shadow: 0 2px 10px rgba(54,99,72,0.08);
  animation: ${fadeUp} 0.5s ease 0.1s both;
`;
const TouchHint = styled.div`
  font-size: 14px;
  font-weight: ${font.weight.semiBold};
  color: ${color.sage[700]};
  text-align: center;
  line-height: 1.35;
`;
const TouchSub = styled.div`
  font-size: 10.5px;
  color: ${color.ink[300]};
  text-align: center;
`;
const PulseBtn = styled.div`
  width: 46px; height: 46px;
  border-radius: 50%;
  background: ${color.sage[600]};
  border: 2.5px solid ${color.sage[700]};
  display: flex; align-items: center; justify-content: center;
  margin: 2px 0;
  animation: ${breathePulse} 2.2s ease-in-out infinite;
`;

const PrevSection = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 14px 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  animation: ${fadeUp} 0.5s ease 0.15s both;
  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); }
`;
const PrevHead = styled.div`
  font-size: 9.5px;
  font-weight: ${font.weight.bold};
  color: ${color.ink[300]};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-family: ${font.mono};
  padding: 4px 0 2px;
`;
const PrevCard = styled.div<{ $urgent: boolean }>`
  background: ${color.white};
  border: ${border.thin};
  border-left: 2.5px solid ${({ $urgent }) => $urgent ? color.terra.base : color.sage[300]};
  border-radius: 6px;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
`;
const PrevTitle = styled.div`
  font-size: 11px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[700]};
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const PrevDate = styled.div`
  font-family: ${font.mono};
  font-size: 9px;
  color: ${color.ink[100]};
  flex-shrink: 0;
`;
const EmptyHint = styled.div`
  font-size: 10.5px;
  color: ${color.ink[100]};
  text-align: center;
  padding: 8px;
`;

const Privacy = styled.div`
  flex-shrink: 0;
  padding: 10px 16px 14px;
  text-align: center;
  font-size: 9.5px;
  color: ${color.ink[100]};
  line-height: 1.6;
  border-top: 1px solid ${color.cream.mid};
  background: ${color.cream.base};
`;
const PrivacyHead = styled.div`
  font-weight: ${font.weight.bold};
  color: ${color.sage[600]};
  margin-bottom: 2px;
`;

const WsStatus = styled.div<{ $ok: boolean }>`
  position: absolute;
  top: 8px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: ${font.mono};
  font-size: 8.5px;
  color: ${({ $ok }) => $ok ? color.sage[500] : color.terra.mid};
`;
const StatusDot = styled.div<{ $ok: boolean }>`
  width: 5px; height: 5px;
  border-radius: 50%;
  background: ${({ $ok }) => $ok ? color.sage[500] : color.terra.mid};
`;

function relTime(ts: number): string {
  const days = Math.floor((Date.now() - ts * 1000) / (1000 * 60 * 60 * 24));
  if (days === 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  return `${Math.floor(days / 7)}주 전`;
}

function deriveWsBase(wsUrl: string): string {
  // ws(s)://host:port/path → http(s)://host:port
  try {
    const u = new URL(wsUrl);
    const scheme = u.protocol === 'wss:' ? 'https:' : 'http:';
    return `${scheme}//${u.host}`;
  } catch {
    return 'http://localhost:8000';
  }
}

export default function LiveIdleScreen() {
  const { setLiveScreen, setLiveDoctorState, wsConnected, wsUrl } = useAppStore();
  const { startSession } = useWebSocket();
  const [visits, setVisits] = useState<PriorVisit[]>([]);

  // DR3: fetch recent visit history when the server is reachable
  useEffect(() => {
    if (!wsConnected) return;
    const base = deriveWsBase(wsUrl);
    fetch(`${base}/api/visits?limit=3`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setVisits(data.visits || []))
      .catch(() => {});
  }, [wsConnected, wsUrl]);

  const handleTouch = () => {
    setLiveDoctorState('speaking');
    setLiveScreen('live-chat');
    startSession();
  };

  return (
    <Screen onClick={handleTouch}>
      <TopAccent />
      <WsStatus $ok={wsConnected}>
        <StatusDot $ok={wsConnected} />
        {wsConnected ? 'LIVE' : 'OFFLINE'}
      </WsStatus>

      <AvatarZone>
        <AvatarGlow>
          <GlowRing />
          <VirtualDoctor state="idle" size={72} showHalo />
        </AvatarGlow>
        <MediName>닥터 메디</MediName>
        <MediRole>어르신 전담 AI 의료 도우미</MediRole>
      </AvatarZone>

      <TouchCard>
        <PulseBtn>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <path d="M10 1a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4Z" fill="white"/>
            <path d="M5 10a5 5 0 0 0 10 0" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            <line x1="10" y1="15" x2="10" y2="18" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </PulseBtn>
        <TouchHint>화면을 터치하면 시작돼요</TouchHint>
        <TouchSub>편하게 말씀만 하시면 됩니다</TouchSub>
      </TouchCard>

      <PrevSection onClick={(e) => e.stopPropagation()}>
        <PrevHead>이전 상담 기록</PrevHead>
        {visits.length === 0 ? (
          <EmptyHint>{wsConnected ? '아직 기록이 없어요' : '서버 연결 시 표시됩니다'}</EmptyHint>
        ) : (
          visits.map((v) => (
            <PrevCard key={v.session_code} $urgent={v.triage === 'emergency'}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <PrevTitle>{v.chief_complaint || '(기록 없음)'}</PrevTitle>
              </div>
              <PrevDate>{relTime(v.started_at)}</PrevDate>
            </PrevCard>
          ))
        )}
      </PrevSection>

      <Privacy>
        <PrivacyHead>개인정보 보호</PrivacyHead>
        음성은 저장되지 않고, 문진 내용은 보건소 의사만 봅니다.<br />
        KAIST 연구 데모 · KAISTIRB-2026-56 · 실제 진단 아님
      </Privacy>
    </Screen>
  );
}
