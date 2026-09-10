import { useMemo } from 'react';
import styled from 'styled-components';
import type { DomainEvent, ViewMode, VillagePayload } from '../api/types';
import { placeLabel, type ActorPose, type MedialKnown } from '../positions';
import { personName } from '../selectors/story';
import { Panel, PanelHead, PanelTitle, Scroll, Sub, Tag } from '../ui/primitives';
import { colour, font } from '../ui/theme';
import { FaceChip } from './Marks';

// The third column's resting state: everyone at once, at the replay cursor.
//
// Before this, the column always showed one person - whoever the screen had
// guessed - and a reader who wanted to know "who is this happening to" had to
// step through a select twelve times. A board answers that in one look, and the
// detail view opens from it.
//
// Two boundaries it keeps, the same two the person panel keeps:
//
//  - in 'MEDial이 아는 것' this shows what MEDial was told, not where people
//    actually are. A board that leaked positions would undo the view mode the
//    map beside it obeys;
//  - counts are of events *at or before the cursor*. Nothing here is a
//    whole-day total dressed as a current state.

const Row = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: none;
  border-bottom: 1px solid ${colour.border};
  background: ${(p) => (p.$active ? colour.selected : 'transparent')};
  padding: 9px 16px;
  cursor: pointer;
  font-family: inherit;
  color: ${colour.text};
  &:hover {
    background: ${colour.selected};
  }
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: -2px;
  }
`;

const Who = styled.div`
  flex: none;
  min-width: 52px;
  font-size: ${font.body};
  font-weight: 600;
`;

const What = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: ${font.small};
  color: ${colour.secondary};
  > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

/* Kept a shade lighter than the activity, so a place label that contains its own
   middot ("평야 · 밭") does not read as two more fields. */
const Where = styled.span`
  color: ${colour.unknown};
`;

const Marks = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
`;

const Count = styled.span`
  font-size: ${font.small};
  font-variant-numeric: tabular-nums;
  color: ${colour.secondary};
  min-width: 26px;
  text-align: right;
`;

interface Props {
  actorIds: string[];
  village: VillagePayload;
  poses: ActorPose[];
  events: DomainEvent[];
  cursorSeq: number;
  viewMode: ViewMode;
  medialKnown: Map<string, MedialKnown>;
  /** Everyone taking part in the request the middle column is reading. */
  involved: Set<string>;
  isVillageHead: (actorId: string) => boolean;
  onOpen: (actorId: string) => void;
  selected: string | null;
}

export default function PeopleBoard({
  actorIds,
  village,
  poses,
  events,
  cursorSeq,
  viewMode,
  medialKnown,
  involved,
  isVillageHead,
  onOpen,
  selected,
}: Props) {
  const medial = viewMode === 'medial';
  const poseOf = useMemo(() => new Map(poses.map((p) => [p.id, p])), [poses]);

  /** How many events at or before the cursor this person could read or caused. */
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const event of events) {
      if (event.seq > cursorSeq) continue;
      if (medial && !event.visibility.includes('MEDial')) continue;
      for (const id of new Set([event.actorId, ...event.visibility])) {
        if (id === 'MEDial' || id === 'researcher') continue;
        out.set(id, (out.get(id) ?? 0) + 1);
      }
    }
    return out;
  }, [events, cursorSeq, medial]);

  const changed = actorIds.filter((id) => poseOf.get(id)?.divergesFromBaseline).length;

  return (
    <Panel>
      <PanelHead style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <PanelTitle>마을 사람들</PanelTitle>
        <Sub as="span">
          {medial
            ? 'MEDial이 보고받은 것만'
            : changed > 0
              ? `원래 일과와 다른 사람 ${changed}명`
              : '모두 원래 일과대로'}
        </Sub>
      </PanelHead>

      <Sub style={{ padding: '8px 16px 0' }}>
        한 사람을 누르면 그 사람의 하루가 열립니다. 지금은 이 시점의 상태입니다.
      </Sub>

      <Scroll>
        {actorIds.map((id) => {
          const pose = poseOf.get(id);
          const known = medialKnown.get(id) ?? null;
          const where = placeLabel(village, pose?.place, id);
          const doing = medial
            ? known
              ? known.confidence === 'reported'
                ? '보고받은 추정'
                : '보고된 관측'
              : '아직 관측이 없습니다'
            : !pose
              ? '이 실행에 일과 기록이 없습니다'
              : pose.offMap
                ? '마을 밖'
                : pose.moving
                  ? '이동 중'
                  : pose.activity;
          const at = medial
            ? known
              ? (placeLabel(village, known.place, id) ?? '위치 미상')
              : null
            : pose && !pose.moving
              ? where
              : (where ?? null);
          const count = counts.get(id) ?? 0;
          return (
            <Row key={id} $active={id === selected} onClick={() => onOpen(id)}>
              <FaceChip id={id} size={24} isVillageHead={isVillageHead(id)} />
              <Who>{personName(id)}</Who>
              <What title={at ? `${doing} · ${at}` : doing}>
                <span>{doing}</span>
                {at && <Where>{at}</Where>}
              </What>
              <Marks>
                {involved.has(id) && <Tag $kind="neutral">이 요청</Tag>}
                {!medial && pose?.divergesFromBaseline && <Tag $kind="warn">일과 바뀜</Tag>}
              </Marks>
              <Count>{count > 0 ? count : ''}</Count>
            </Row>
          );
        })}
      </Scroll>

      <Sub style={{ padding: '8px 16px 12px', borderTop: `1px solid ${colour.border}` }}>
        오른쪽 숫자는 이 시점까지 그 사람이 겪거나 전달받은 사건 수입니다. 만족도 점수가
        아닙니다.
      </Sub>
    </Panel>
  );
}
