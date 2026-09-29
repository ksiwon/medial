import styled from 'styled-components';
import type { GenerationDetail, SessionDetail } from '../api/iteration';
import { childFor, dayFacts, dayName, pathTo, rootsOf } from '../selectors/tree';
import { colour, font } from '../ui/theme';

// Choosing the next version, in a record whose versions branch (selectors/tree).
//
// Three moments, as the exhibition wall had them: the first setting before day
// one, the revision after each day, and the end of the third day. Every option
// on screen was run when the record was made, so choosing one opens a day that
// already happened - it starts nothing. A revision that was never run is shown
// and cannot be chosen.

const Sheet = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 40px 20px 48px;
`;

const Inner = styled.div`
  max-width: 1132px;
  margin: 0 auto;
`;

export const Eyebrow = styled.div`
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #e2542c;
`;

export const Headline = styled.h1`
  margin: 8px 0 10px;
  font-size: 32px;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: ${colour.text};
`;

export const Lead = styled.p`
  margin: 0 0 22px;
  max-width: 660px;
  font-size: 14.5px;
  line-height: 1.7;
  color: ${colour.secondary};
`;

const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
`;

const Card = styled.button`
  font: inherit;
  text-align: left;
  cursor: pointer;
  background: ${colour.surface};
  border: 1px solid ${colour.border};
  border-radius: 12px;
  padding: 20px 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: ${colour.text};
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  &:hover:not(:disabled) {
    border-color: #e2542c;
    box-shadow: 0 6px 18px rgba(29, 41, 53, 0.1);
    transform: translateY(-1px);
  }
  &:focus-visible { outline: 2px solid #e2542c; outline-offset: 2px; }
  &:disabled { cursor: default; opacity: 0.55; }
  > small { font-size: 11.5px; font-weight: 800; color: ${colour.secondary}; }
  > strong { font-size: 18px; font-weight: 800; letter-spacing: -0.02em; }
  > p { margin: 0; font-size: ${font.small}; line-height: 1.65; color: ${colour.secondary}; }
`;

const Rule = styled.div`
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid ${colour.border};
  font-size: ${font.small};
  line-height: 1.6;
  > s { display: block; color: ${colour.unknown}; }
  > b { display: block; font-weight: 700; color: ${colour.text}; }
`;

/** The three days side by side - the wall's closing table. */
const Summary = styled.table`
  width: 100%;
  margin: 0 0 24px;
  border-collapse: collapse;
  background: ${colour.surface};
  border: 1px solid ${colour.border};
  border-radius: 12px;
  overflow: hidden;
  font-size: ${font.small};
  th { text-align: left; font-weight: 700; color: ${colour.secondary}; padding: 10px 14px; background: #f4f3f0; }
  td { padding: 12px 14px; border-top: 1px solid ${colour.border}; vertical-align: top; }
  td > div { color: ${colour.secondary}; margin-top: 2px; }
`;

const Again = styled.button`
  font: inherit;
  font-weight: 800;
  font-size: 15px;
  cursor: pointer;
  border: none;
  border-radius: 999px;
  padding: 12px 22px;
  background: #15150f;
  color: #ffffff;
`;

interface Props {
  detail: SessionDetail;
  /** The version whose day was just read; null before the first choice. */
  current: GenerationDetail | null;
  onChoose: (generationId: string) => void;
  onRestart: () => void;
}

export default function ChoiceScreen({ detail, current, onChoose, onRestart }: Props) {
  if (!current) {
    return (
      <Sheet>
        <Inner>
          <Eyebrow>전시 시작 · 첫 배포 설정</Eyebrow>
          <Headline>MEDial을 어떤 규칙으로 처음 켤 것인가</Headline>
          <Lead>
            같은 마을, 같은 사건입니다. 다른 것은 MEDial이 따르는 운영 규칙뿐입니다. 사흘 동안 날마다
            하나씩 고쳐 갑니다.
          </Lead>
          <Cards>
            {rootsOf(detail).map((root, i) => (
              <Card key={root.id} onClick={() => onChoose(root.id)}>
                <small>설정 {i + 1}</small>
                <strong>{root.label}</strong>
                <p>{root.confirmationReason}</p>
              </Card>
            ))}
          </Cards>
        </Inner>
      </Sheet>
    );
  }

  if (current.changeSets.length === 0) {
    return (
      <Sheet>
        <Inner>
          <Eyebrow>사흘이 끝났습니다</Eyebrow>
          <Headline>고른 것과, 마을이 어떻게 됐는지</Headline>
          <Lead>
            27가지 경로 가운데 하나입니다. 이 결과는 미리 계산해 둔 것이고, 실시간 모델 호출은 없습니다.
          </Lead>
          <Summary>
            <thead>
              <tr><th>날</th><th>그날 고른 것</th><th>확인까지</th><th>이장이 받은 부탁</th><th>거절</th>
                <th>기관 인계</th><th>동승 주선</th></tr>
            </thead>
            <tbody>
              {pathTo(detail, current.id).map((g) => {
                const facts = dayFacts(g);
                return (
                  <tr key={g.id}>
                    <td><b>{dayName(g)}</b>{facts && <div>{facts.dayTitle}</div>}</td>
                    <td>{g.label}</td>
                    <td>{facts?.resolveMinutes != null ? `${facts.resolveMinutes}분` : '—'}</td>
                    <td>{facts ? `${facts.headAsks}번` : '—'}</td>
                    <td>{facts ? `${facts.refusals}번` : '—'}</td>
                    <td>{facts?.handoff ?? '—'}</td>
                    <td>{facts?.rideRefused ? '실패' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </Summary>
          <Again onClick={onRestart}>처음부터 다른 길로</Again>
        </Inner>
      </Sheet>
    );
  }

  const labels = new Map(current.ruleCatalog.map((r) => [r.ruleType, r.label]));
  return (
    <Sheet>
      <Inner>
        <Eyebrow>{dayName(current)} → {current.index + 2}일차 · 수정안 고르기</Eyebrow>
        <Headline>무엇을 고칠 것인가</Headline>
        <Lead>
          오늘 주민들이 겪은 일에서 나온 세 가지입니다. 하나만 고를 수 있고, 고른 것이 내일의 규칙이
          됩니다. 나머지 조건은 그대로 둡니다.
        </Lead>
        <Cards>
          {current.changeSets.map((changeSet) => {
            const child = childFor(detail, changeSet.id);
            const rule = changeSet.changes[0];
            return (
              <Card key={changeSet.id} disabled={!child} onClick={() => child && onChoose(child.id)}
                title={child ? undefined : '이 기록에서는 실행하지 않은 안입니다'}>
                <small>{(rule?.semantic && labels.get(rule.semantic.ruleType)) ?? rule?.field ?? '수정안'}</small>
                <strong>{changeSet.label}</strong>
                <p>{changeSet.mechanism}</p>
                {rule && (
                  <Rule>
                    <s>{rule.beforeRule}</s>
                    <b>{rule.afterRule}</b>
                  </Rule>
                )}
              </Card>
            );
          })}
        </Cards>
      </Inner>
    </Sheet>
  );
}
