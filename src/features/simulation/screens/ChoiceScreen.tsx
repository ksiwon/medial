import { useEffect, useState } from 'react';
import styled from 'styled-components';
import type { GenerationDetail, SessionDetail } from '../api/iteration';
import { childFor, dayFacts, dayName, pathCount, pathTo } from '../selectors/tree';
import { nameList, withParticle } from '../selectors/story';
import { accentA, inkA, night, px, radius, space } from '../ui/theme';
import { Inner, PageHead, Sheet } from '../ui/page';
import Portrait from '../ui/Portrait';
import { pill } from '../ui/primitives';

// Choosing the next version, in a record whose versions branch (selectors/tree).
//
// Two moments, as the exhibition wall had them: the revision after each day and
// the end of the third day. The first setting is not chosen - the opening film
// (IntroScreen) states it and day one starts. Every option
// on screen was run when the record was made, so choosing one opens a day that
// already happened - it starts nothing. A revision that was never run is shown
// and cannot be chosen.

/* The cards share their rows (subgrid): the kind, the request, its purpose, the
   reason, whose experience it came from, the rule and the way to take it start at
   one height across all three, however long any one card's title runs. */
const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(380px * var(--k, 1))), 1fr));
  column-gap: ${space.lg};
  row-gap: ${space.lg};
`;

const Take = styled.span`
  ${pill('lg')}
  align-self: end;
  justify-self: start;
  height: ${px(48)};
  padding: 0 ${space.lg};
  font-size: ${px(16)};
  font-weight: 800;
  color: ${night.ink};
  background: ${inkA(0.1)};
  transition: background 0.15s ease, color 0.15s ease;
  &::after { content: '→'; margin-left: ${px(8)}; }
`;

const Card = styled.button`
  position: relative;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: ${night.ink};
  background: ${night.panel};
  border: 1px solid ${night.line};
  border-radius: ${radius.card};
  padding: ${space.xl} ${space.xl} ${space.lg};
  display: grid;
  grid-row: span 7;
  grid-template-rows: subgrid;
  row-gap: ${space.md};
  align-content: start;
  word-break: keep-all;
  transition: border-color 0.18s ease, transform 0.18s ease;
  &:hover:not(:disabled), &:focus-visible {
    border-color: ${night.accent};
    transform: translateY(-4px);
  }
  &:hover:not(:disabled) ${Take}, &:focus-visible ${Take} { background: ${night.accent}; color: #fff; }
  &:focus-visible { outline: 2px solid ${night.ink}; outline-offset: 4px; }
  &:disabled { cursor: default; opacity: 0.5; }
  > strong { font-size: ${px(28)}; font-weight: 800; letter-spacing: -0.03em; line-height: 1.3; }
  > p { margin: 0; font-size: ${px(16)}; line-height: 1.7; color: ${night.mute}; }
`;

/** Which of the choices this is, and what kind of rule it changes. */
const Kind = styled.div`
  display: flex;
  align-items: center;
  gap: ${space.md};
  > b {
    display: grid;
    place-items: center;
    width: ${px(36)};
    height: ${px(36)};
    border-radius: ${radius.round};
    background: ${night.accent};
    color: #fff;
    font-size: ${px(16)};
    font-weight: 800;
  }
  > small { font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.06em; color: ${night.mute}; }
`;

/** 무엇을 이루려는 요청인가. 제목이 부탁이면 이것은 그 부탁의 이유가 아니라 *목적*이다. */
const Goal = styled.p`
  margin: 0;
  /* As tall as the tallest purpose in the row (the cards share rows): the
     sentence sits in the middle of that height, not at its top. */
  display: flex;
  align-items: center;
  padding: ${space.md} ${space.lg};
  border-radius: ${radius.card};
  background: ${night.accentSoft};
  border: 1px solid ${accentA(0.4)};
  color: ${night.ink} !important;
  font-size: ${px(16)} !important;
  font-weight: 700;
  &::before { content: '목적'; margin-right: ${px(12)}; font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.08em; color: ${night.accent}; }
`;

/** 이 요청이 어느 주민이 겪은 일에서 나왔는가 - 평가가 수정에 쓰인다는 연구의 연결 고리. */
const From = styled.div`
  display: flex;
  align-items: center;
  gap: ${space.md};
  font-size: ${px(16)};
  font-weight: 700;
  color: ${night.mute};
  > b { color: ${night.ink}; }
  > span { display: flex; }
  > span > div + div { margin-left: calc(-12px * var(--k, 1)); }
`;

/** The rule, as it was and as it would be: what the next day is run under. */
const Rule = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  padding-top: ${px(16)};
  border-top: 1px solid ${night.line};
  font-size: ${px(16)};
  line-height: 1.6;
  > small { font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.1em; color: ${night.faint}; }
  > s { color: ${night.faint}; text-decoration-color: ${inkA(0.35)}; }
  > i { font-style: normal; color: ${night.accent}; font-weight: 800; line-height: 1; }
  > b { font-weight: 700; color: ${night.ink}; }
`;

/** The three days, one beside the next: the wall's closing page. */
const Days = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(340px * var(--k, 1))), 1fr));
  gap: ${space.lg};
`;

const Day = styled.li`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
  padding: ${space.xl} ${space.xl};
  border-radius: ${radius.card};
  border: 1px solid ${night.line};
  background: ${night.panel};
  > small { font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.08em; color: ${night.accent}; }
  > strong { font-size: ${px(28)}; font-weight: 800; letter-spacing: -0.03em; line-height: 1.3; word-break: keep-all; }
  > p { margin: 0; font-size: ${px(16)}; line-height: 1.6; color: ${night.mute}; word-break: keep-all; }
`;

const Facts = styled.dl`
  margin: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: ${space.sm} ${space.lg};
  padding-top: ${px(16)};
  border-top: 1px solid ${night.line};
  font-size: ${px(16)};
  > dt { color: ${night.mute}; }
  > dd { margin: 0; font-weight: 800; font-variant-numeric: tabular-nums; text-align: right; color: ${night.ink}; }
`;

const Again = styled.button`
  ${pill('lg')}
  align-self: flex-start;
  height: ${px(56)};
  padding: 0 ${space.xl};
  font: inherit;
  font-size: ${px(20)};
  font-weight: 800;
  cursor: pointer;
  border: none;
  background: ${night.accent};
  color: #ffffff;
`;

const Idle = styled.span`
  margin-left: ${px(20)};
  font-size: ${px(16)};
  color: ${night.faint};
  font-variant-numeric: tabular-nums;
`;

interface Props {
  detail: SessionDetail;
  /** The version whose day was just read. */
  current: GenerationDetail;
  onChoose: (generationId: string) => void;
  onRestart: () => void;
  /** Which pictures were drawn, for the faces on the cards. */
  art?: ReadonlySet<string>;
}

const NO_ART: ReadonlySet<string> = new Set();

/**
 * How long the three days' summary stays when nobody touches it, in seconds. In a hall the
 * next visitor does not press "again" for the last one: the screen goes back to the opening
 * film by itself. Long enough to read a three-row table, short enough that a visitor who
 * walks up to a screen that has been left does not find the end of someone else's story.
 */
export const SUMMARY_IDLE_S = 60;

/** The end of the walk: the days taken, and the way back - by itself, if nobody takes it. */
function Ending({ detail, current, onRestart }: { detail: SessionDetail; current: GenerationDetail; onRestart: () => void }) {
  const [left, setLeft] = useState(SUMMARY_IDLE_S);
  useEffect(() => {
    // Any touch or key starts the wait over: someone is still reading.
    const reset = () => setLeft(SUMMARY_IDLE_S);
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    const tick = window.setInterval(() => setLeft((n) => n - 1), 1000);
    return () => {
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
      window.clearInterval(tick);
    };
  }, []);
  useEffect(() => { if (left <= 0) onRestart(); }, [left, onRestart]);
  return (
    <Sheet>
      <Inner>
        <PageHead eyebrow="사흘이 끝났습니다" title="고른 것과, 마을이 어떻게 됐는지">
          첫 설정에서 갈라지는 {pathCount(detail, pathTo(detail, current.id)[0]?.id ?? '')}가지 경로 가운데 하나입니다. 이 결과는 미리 계산해 둔 것이고, 실시간 모델 호출은 없습니다.
        </PageHead>
        <Days>
          {pathTo(detail, current.id).map((g) => {
            const facts = dayFacts(g);
            return (
              <Day key={g.id}>
                <small>{dayName(g)}</small>
                <strong>{g.label}</strong>
                {facts && <p>{facts.dayTitle}</p>}
                <Facts>
                  <dt>확인까지</dt><dd>{facts?.resolveMinutes != null ? `${facts.resolveMinutes}분` : '—'}</dd>
                  <dt>이장이 받은 부탁</dt><dd>{facts ? `${facts.headAsks}번` : '—'}</dd>
                  <dt>거절</dt><dd>{facts ? `${facts.refusals}번` : '—'}</dd>
                  <dt>기관 인계</dt><dd>{facts?.handoff ?? '—'}</dd>
                  <dt>동승 주선</dt><dd>{facts?.rideRefused ? '실패' : '—'}</dd>
                </Facts>
              </Day>
            );
          })}
        </Days>
        <div>
          <Again onClick={onRestart}>처음부터 다른 길로</Again>
          <Idle aria-live="off">{left}초 뒤 처음으로 돌아갑니다</Idle>
        </div>
      </Inner>
    </Sheet>
  );
}

export default function ChoiceScreen({ detail, current, onChoose, onRestart, art = NO_ART }: Props) {
  if (current.changeSets.length === 0) return <Ending detail={detail} current={current} onRestart={onRestart} />;

  const labels = new Map(current.ruleCatalog.map((r) => [r.ruleType, r.label]));
  return (
    <Sheet>
      <Inner>
        <PageHead eyebrow={`${dayName(current)} → ${current.index + 2}일차 · 수정안 고르기`} title="무엇을 고칠 것인가">
          오늘 주민들이 겪은 일에서 나온 세 가지입니다. 하나만 고를 수 있고, 고른 것이 내일의 규칙이
          되어 내일의 시뮬레이션이 여러분의 선택대로 달라집니다. 나머지 조건은 그대로 둡니다.
        </PageHead>
        <Cards>
          {current.changeSets.map((changeSet, index) => {
            const child = childFor(detail, changeSet.id);
            const rule = changeSet.changes[0];
            return (
              <Card key={changeSet.id} disabled={!child} onClick={() => child && onChoose(child.id)}
                title={child ? undefined : '이 기록에서는 실행하지 않은 안입니다'}>
                <Kind>
                  <b>{index + 1}</b>
                  <small>{(rule?.semantic && labels.get(rule.semantic.ruleType)) ?? rule?.field ?? '수정안'}</small>
                </Kind>
                <strong>{changeSet.label}</strong>
                {/* Every card keeps all seven rows, empty or not, so the rows line up. */}
                {changeSet.expectedEffects[0] ? <Goal>{changeSet.expectedEffects[0]}</Goal> : <span />}
                <p>{changeSet.mechanism}</p>
                {changeSet.affectedActors.length > 0 ? (
                  <From>
                    <span>
                      {changeSet.affectedActors.slice(0, 3).map((id) => (
                        <Portrait key={id} actorId={id} art={art} size={36} />
                      ))}
                    </span>
                    <div><b>{withParticle(nameList(changeSet.affectedActors), 'subject')}</b> 겪은 일에서 나온 요청</div>
                  </From>
                ) : <span />}
                {rule ? (
                  <Rule>
                    <small>지금</small>
                    <s>{rule.beforeRule}</s>
                    <i>↓</i>
                    <small>고치면</small>
                    <b>{rule.afterRule}</b>
                  </Rule>
                ) : <span />}
                <Take as="span">{child ? '이걸로 내일을 돌린다' : '이 기록에서는 돌리지 않은 안'}</Take>
              </Card>
            );
          })}
        </Cards>
      </Inner>
    </Sheet>
  );
}
