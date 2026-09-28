import styled from 'styled-components';
import type { IterationSession } from '../api/iteration';
import { Body, Button, Callout, Mono, PageTitle, Sub, Tag } from '../ui/primitives';
import { colour, font, radius } from '../ui/theme';

// The sim version's first screen, in place of 새 사례 준비.
//
// The sim version starts nothing, so there is nothing to set up: what it has is
// the sessions the real version ran, frozen by scripts/freeze_sim.py. This
// lists them and opens one. Whether a recording's words came from a model or
// from the rules is said on its row, because "pre-run" says nothing about how.

const Sheet = styled.div`
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 24px 48px;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Item = styled.li<{ $current: boolean }>`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  background: ${colour.surface};
  border: 1px solid ${(p) => (p.$current ? colour.primary : colour.border)};
  border-radius: ${radius.panel};
`;

const Text = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Name = styled.div`
  font-size: ${font.body};
  font-weight: 600;
  color: ${colour.text};
`;

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: ${font.small};
  color: ${colour.secondary};
`;

/** Who produced this recording's behaviour and words. */
export function madeBy(session: IterationSession): string {
  const layers = [session.behaviourAdapter, session.institutionAdapter,
                  session.reviewAdapter, session.improvementAdapter];
  if (layers.every((a) => a === 'llm')) return '모델로 생성';
  if (layers.some((a) => a === 'llm')) return '일부 모델로 생성';
  return '규칙으로 계산';
}

/** A recording that did not get as far as its evaluations says so. */
export function stoppedEarly(session: IterationSession): string | null {
  if (session.status === 'failed') return '중간에 멈춘 기록';
  if (session.status === 'cancelled') return '중지한 기록';
  return null;
}

function day(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

interface Props {
  sessions: IterationSession[];
  currentId: string | null;
  onOpen: (id: string) => void;
  /** Back to where the reader was in the recording already open. */
  onReturn: () => void;
}

export default function RecordingsScreen({ sessions, currentId, onOpen, onReturn }: Props) {
  const newestFirst = [...sessions].reverse();
  return (
    <Sheet>
      <div>
        <PageTitle>미리 돌려 둔 기록</PageTitle>
        <Body style={{ marginTop: 8 }}>
          sim 버전은 real 버전에서 돌려 둔 실험을 그대로 다시 보여 줍니다. 모델을 부르지 않고,
          새 실행이나 수정안 확정은 하지 않습니다.
        </Body>
      </div>

      {newestFirst.length === 0 ? (
        <Callout>
          <div>
            <strong>아직 얼려 둔 기록이 없습니다.</strong>
            <div style={{ marginTop: 4 }}>
              real 버전에서 실험을 돌린 뒤 <Mono>python scripts/freeze_sim.py</Mono> 로 얼리면
              여기에 나타납니다.
            </div>
          </div>
        </Callout>
      ) : (
        <List aria-label="미리 돌려 둔 기록">
          {newestFirst.map((session) => {
            const current = session.id === currentId;
            const made = madeBy(session);
            return (
              <Item key={session.id} $current={current}>
                <Text>
                  <Name>{session.label}</Name>
                  {/* The label defaults to the question; say it once. */}
                  {session.coreItem !== session.label && (
                    <Sub style={{ margin: 0 }}>{session.coreItem}</Sub>
                  )}
                  <Meta>
                    <Tag $kind={made === '규칙으로 계산' ? 'unknown' : 'neutral'}>{made}</Tag>
                    {stoppedEarly(session) && <Tag $kind="warn">{stoppedEarly(session)}</Tag>}
                    <span>버전 {session.currentGenerationIndex + 1}개까지</span>
                    <span aria-hidden>·</span>
                    <span>{day(session.createdAt)}</span>
                  </Meta>
                </Text>
                {current ? (
                  <Button onClick={onReturn}>보던 자리로</Button>
                ) : (
                  <Button $primary onClick={() => onOpen(session.id)}>이 기록 보기</Button>
                )}
              </Item>
            );
          })}
        </List>
      )}
    </Sheet>
  );
}
