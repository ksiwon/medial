// src/screens/companion/InfoTab.tsx
// 정보 탭 — 오늘의 건강 숏폼(유튜브) + 동네·보건소 소식(AI 큐레이션).
// 소식의 injectToChat 항목은 메디가 일상 대화에 자연스럽게 녹인다.
import { useState } from 'react';
import styled from 'styled-components';
import { color, font, border, ts, touch } from '../../styles/tokens';
import { useAppStore } from '../../store/useAppStore';
import { useCompanion } from '../../components/companion/CompanionContext';
import { HEALTH_SHORTS, EXTRA_ADVISORY, HealthShort } from '../../data/communityFeed';
import { CommunityEvent } from '../../types/health';

const Wrap = styled.div`
  padding: 16px 14px 24px;
  display: flex;
  flex-direction: column;
  gap: 22px;
`;
const SecTitle = styled.h2`
  font-size: ${ts(19)};
  font-weight: ${font.weight.bold};
  color: ${color.text.strong};
  margin-bottom: 10px;
`;
const SecNote = styled.p`
  font-size: ${ts(15)};
  color: ${color.text.muted};
  margin: -4px 0 12px;
`;

const ShortCard = styled.div`
  border-radius: 14px;
  background: ${color.white};
  border: 1px solid rgba(0,0,0,0.06);
  margin-bottom: 12px;
  overflow: hidden;
`;
const Media = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
`;
const Thumb = styled.button<{ $src: string }>`
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  border: none; cursor: pointer; padding: 0;
  background: #000 url(${({ $src }) => $src}) center/cover no-repeat;
  /* 가운데 재생 배지(반투명 원 + 흰 삼각형) */
  &::before {
    content: ''; position: absolute; top: 50%; left: 50%;
    width: 56px; height: 56px; transform: translate(-50%,-50%);
    border-radius: 50%; background: rgba(0,0,0,0.5);
    border: 2px solid rgba(255,255,255,0.9);
  }
  &::after {
    content: ''; position: absolute; top: 50%; left: 50%;
    transform: translate(-40%,-50%);
    border-style: solid; border-width: 9px 0 9px 15px;
    border-color: transparent transparent transparent #fff;
  }
  &:active { filter: brightness(0.92); }
`;
const Frame = styled.iframe`
  position: absolute; inset: 0; width: 100%; height: 100%; border: 0;
`;
const ShortMeta = styled.div`display: flex; flex-direction: column; gap: 3px; padding: 10px 12px 12px;`;
const ShortTitle = styled.div`
  font-size: ${ts(17)}; font-weight: ${font.weight.semiBold};
  color: ${color.text.strong}; line-height: 1.4;
`;
const ShortChannel = styled.div`font-size: ${ts(15)}; color: ${color.text.muted};`;

const EventCard = styled.div<{ $advisory: boolean }>`
  padding: 12px 14px;
  border-radius: 12px;
  background: ${({ $advisory }) => ($advisory ? color.amber.pale : color.white)};
  border: ${({ $advisory }) => ($advisory ? border.amber : '1px solid rgba(0,0,0,0.06)')};
  margin-bottom: 10px;
`;
const EvtTop = styled.div`display: flex; align-items: center; gap: 7px; margin-bottom: 5px;`;
const SrcBadge = styled.span<{ $hc: boolean }>`
  font-size: 10.5px; font-weight: ${font.weight.bold};
  padding: 2px 8px; border-radius: 999px;
  background: ${({ $hc }) => ($hc ? color.healthBlueDim : color.sage[100])};
  color: ${({ $hc }) => ($hc ? color.healthBlue : color.sage[700])};
`;
const EvtTitle = styled.div`font-size: ${ts(17)}; font-weight: ${font.weight.bold}; color: ${color.text.strong};`;
const EvtBody = styled.div`font-size: ${ts(16)}; color: ${color.text.body}; line-height: 1.55; margin-top: 4px;`;

const DemoBtn = styled.button`
  align-self: flex-start;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: ${font.weight.semiBold};
  background: ${color.sage[600]};
  color: white;
  &:disabled { opacity: 0.5; }
  &:active { transform: scale(0.98); }
`;

const Composer = styled.div`
  background: ${color.sage[50]};
  border: 1px solid ${color.sage[200]};
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;
const Field = styled.input`
  min-height: ${touch.min}px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid ${color.cream.dark};
  font-size: ${ts(17)};
  font-family: ${font.family};
  &:focus { outline: 2px solid ${color.sage[400]}; }
`;
const Area = styled.textarea`
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid ${color.cream.dark};
  font-size: ${ts(17)};
  font-family: ${font.family};
  resize: vertical;
  min-height: 64px;
  &:focus { outline: 2px solid ${color.sage[400]}; }
`;
const PostRow = styled.div`display: flex; gap: 8px;`;
const PostBtn = styled.button<{ $primary?: boolean }>`
  flex: 1; min-height: ${touch.min}px; padding: 12px 0; border-radius: 12px;
  font-size: ${ts(17)}; font-weight: ${font.weight.bold};
  background: ${({ $primary }) => ($primary ? color.role.positive : color.white)};
  color: ${({ $primary }) => ($primary ? 'white' : color.text.muted)};
  border: ${({ $primary }) => ($primary ? 'none' : `1px solid ${color.cream.dark}`)};
  &:disabled { opacity: 0.5; }
  &:active { transform: scale(0.98); }
`;
const OpenComposerBtn = styled.button`
  align-self: flex-start; margin-bottom: 12px;
  min-height: ${touch.min}px;
  padding: 10px 18px; border-radius: 999px;
  font-size: ${ts(17)}; font-weight: ${font.weight.semiBold};
  background: ${color.white}; color: ${color.role.positive};
  border: 1px solid ${color.sage[300]};
  &:active { transform: scale(0.98); }
`;

function ShortPlayer({ s }: { s: HealthShort }) {
  const [playing, setPlaying] = useState(false);
  return (
    <ShortCard>
      <Media>
        {playing ? (
          <Frame
            src={`https://www.youtube-nocookie.com/embed/${s.youtubeId}?autoplay=1&playsinline=1&rel=0`}
            title={s.title}
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
          />
        ) : (
          <Thumb
            $src={`https://img.youtube.com/vi/${s.youtubeId}/hqdefault.jpg`}
            onClick={() => setPlaying(true)}
            aria-label={`${s.title} 재생`}
          />
        )}
      </Media>
      <ShortMeta>
        <ShortTitle>{s.title}</ShortTitle>
        <ShortChannel>{s.channel}</ShortChannel>
      </ShortMeta>
    </ShortCard>
  );
}

export default function InfoTab() {
  const events = useAppStore((s) => s.healthContext.events);
  const { ws } = useCompanion();
  const [extraSent, setExtraSent] = useState(false);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const sendExtra = () => {
    if (extraSent) return;
    const evt = { ...EXTRA_ADVISORY, timestamp: Date.now() };
    useAppStore.getState().addEvent(evt);
    ws.sendEvent(evt);
    setExtraSent(true);
  };

  const postNews = () => {
    if (!title.trim()) return;
    const evt: CommunityEvent = {
      id: `evt-user-${Date.now()}`,
      timestamp: Date.now(),
      source: 'neighbor',
      kind: 'news',
      title: title.trim(),
      body: body.trim(),
      injectToChat: true,   // 메디가 동네에 전해드림
      injected: false,
      priority: 0,
    };
    useAppStore.getState().addEvent(evt);
    useAppStore.getState().logEvent('post', evt.title);
    ws.sendEvent(evt);
    setTitle(''); setBody(''); setComposing(false);
  };

  // 보건소 공지(신뢰·실행가능)를 위로, 그 다음 우선순위·최신순.
  const sortedEvents = [...events].sort((a, b) => {
    const w = (e: CommunityEvent) => (e.source === 'health_center' ? 10 : 0) + e.priority;
    return w(b) - w(a) || b.timestamp - a.timestamp;
  });

  return (
    <Wrap>
      {/* 신뢰도 높고 실행가능한 동네·보건소 정보를 최상단에 (DR3 신뢰 채널). */}
      <section>
        <SecTitle>동네·보건소 소식</SecTitle>
        <SecNote>메디가 대화 중에 이 소식들을 자연스럽게 전해드려요.</SecNote>

        {composing ? (
          <Composer>
            <Field
              placeholder="무슨 소식인가요? (예: 우리 손주 돌잔치)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Area
              placeholder="이웃에게 전하고 싶은 이야기를 적어 주세요."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <PostRow>
              <PostBtn $primary disabled={!title.trim()} onClick={postNews}>이웃에게 전하기</PostBtn>
              <PostBtn onClick={() => { setComposing(false); setTitle(''); setBody(''); }}>취소</PostBtn>
            </PostRow>
          </Composer>
        ) : (
          <OpenComposerBtn onClick={() => setComposing(true)}>＋ 내 소식 올리기</OpenComposerBtn>
        )}

        {sortedEvents.length === 0 && <EvtBody>아직 새 소식이 없어요.</EvtBody>}
        {sortedEvents.map((e) => {
          const advisory = e.kind === 'advisory';
          const hc = e.source === 'health_center';
          return (
            <EventCard key={e.id} $advisory={advisory}>
              <EvtTop>
                <SrcBadge $hc={hc}>{hc ? '보건소' : '동네소식'}</SrcBadge>
                <EvtTitle>{e.title}</EvtTitle>
              </EvtTop>
              <EvtBody>{e.body}</EvtBody>
            </EventCard>
          );
        })}
        <DemoBtn disabled={extraSent} onClick={sendExtra}>
          {extraSent ? '한파 주의보 전달됨' : '새 공지 받기 (한파 주의보)'}
        </DemoBtn>
      </section>

      {/* 영상은 보조 콘텐츠로 하단 배치. 끝없는 자동 피드가 아니라 큐레이션된
          탭-재생 카드 — 60대 숏폼 이용률 54.3%/70대 40%(KOCCA)이나 고령일수록
          낮고 자동 스크롤은 부담되므로. */}
      <section>
        <SecTitle>오늘의 건강 영상</SecTitle>
        <SecNote>눌러서 바로 볼 수 있는 짧은 건강 영상이에요.</SecNote>
        {HEALTH_SHORTS.map((s) => (
          <ShortPlayer key={s.youtubeId} s={s} />
        ))}
      </section>
    </Wrap>
  );
}
