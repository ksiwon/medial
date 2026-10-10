import { useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import type { AttemptDetail, DomainEvent, VillagePayload } from '../api/types';
import DayTimeline from '../components/DayTimeline';
import MedialDashboard from '../components/MedialDashboard';
import VillageMap from '../components/VillageMap';
import { formatClock, medialKnowledge, placeLabel, posesAt } from '../positions';
import { openRequests, requestColour } from '../scene/colours';
import { judgmentOf } from '../scene/judgment';
import { DAY_START_MS, usePlayback } from '../scene/playback';
import { PACES, REVEAL_STEP_S, REVEAL_STEPS } from '../scene/reel';
import SceneStage from '../scene/SceneStage';
import type { Beat, Episode } from '../scene/types';
import { ledgerAt, routineAt, timelineAt } from '../selectors/dayLedger';
import { dayChangeLines, dayLabel } from '../selectors/words';
import { IconButton, Select, Sub, pill } from '../ui/primitives';
import { accentA, night, radius } from '../ui/theme';

// 사례와 서비스 경험 - watching one run.
//
// Three columns (2026-10-07). The village map stands upright on the left and never
// moves or shrinks: it is the one thing that is always there. In the middle, the
// stage over the playback bar. On the right, the day's timeline down a rail:
// what has happened, what is happening, and what was scheduled - nothing else
// ahead (components/DayTimeline).
//
// The stage is a request's scene when it has one - a frame per place, the people
// there, their words as bubbles, and MEDial, which has no body, as its judgement
// panel - and MEDial's dashboard when it does not, so it is never empty. The
// ledger is one line per request up to the playhead.
//
// Before this the day's ledger sat under the stage and the playback track drew
// every scene of the day as a coloured bar, which showed the evening's emergency
// at five in the morning. Both are gone; the timeline is the one record.

const Screen = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  /* The map column is as wide as the village at its height (VillageMap onFitWidth),
     within sensible bounds; the stage takes the rest. */
  grid-template-columns: var(--map-w, minmax(280px, 24%)) minmax(0, 1fr) minmax(252px, 19%);
  gap: 12px;
  padding: 12px;
  background: ${night.ground};
  color: ${night.ink};

  /* A narrow window cannot hold the village and the timeline beside a filmed
     scene. They stack: the map above, shorter, then the stage, then the timeline. */
  @media (max-width: 1100px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 36%) minmax(520px, 1fr) minmax(320px, auto);
    overflow-y: auto;
  }
`;

const MapColumn = styled.div`
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: ${night.panel};
  border-radius: ${radius.panel};
`;

/** What the header used to say, now a strip on top of the map column: which day
 *  this is, and that every person here is invented (the way back to the start is in the foot). */
const MapStrip = styled.div`
  flex: none;
  padding: 12px 16px;
  font-size: calc(12px * var(--k, 1));
  color: ${night.mute};
  > div { display: flex; align-items: center; gap: 8px; }
  > div > b { font-size: calc(16px * var(--k, 1)); font-weight: 800; color: ${night.ink}; letter-spacing: 0.02em; }
  > div > em { ${pill('xs')} font-style: normal; font-weight: 800; color: #fff; background: ${night.accent}; }
`;

const MapBody = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const Right = styled.div`
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Stage = styled.div`
  position: relative;
  flex: 1 1 0;
  min-height: 300px;
`;

/* The two layers take turns, never share the stage: whichever is leaving goes
   at once and the one arriving waits for it. Cross-faded, a scene's captions and
   the dashboard's numbers sat on top of each other and neither could be read. */
const SceneLayer = styled.div<{ $on: boolean }>`
  position: absolute;
  inset: 0;
  opacity: ${(p) => (p.$on ? 1 : 0)};
  transform: ${(p) => (p.$on ? 'none' : 'scale(1.02)')};
  transition: opacity ${(p) => (p.$on ? '0.5s ease 0.25s' : '0.2s ease')},
    transform 0.8s cubic-bezier(0.2, 0.7, 0.2, 1);
  pointer-events: ${(p) => (p.$on ? 'auto' : 'none')};
`;

const DashLayer = styled.div<{ $on: boolean }>`
  position: absolute;
  inset: 0;
  opacity: ${(p) => (p.$on ? 1 : 0)};
  transition: opacity ${(p) => (p.$on ? '0.5s ease 0.25s' : '0.2s ease')};
  pointer-events: ${(p) => (p.$on ? 'auto' : 'none')};
`;

const DayEnd = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px 12px 20px;
  border-radius: ${radius.panel};
  background: ${night.accentSoft};
  box-shadow: inset 0 0 0 1px ${accentA(0.5)};
  font-size: calc(16px * var(--k, 1));
  color: ${night.ink};
  > span > span { margin-left: 12px; color: ${night.mute}; }
  > button { font: inherit; ${pill('md')} font-weight: 800; cursor: pointer; border: none;
             background: ${night.accent}; color: #fff; }
`;

interface Props {
  village: VillagePayload;
  detail: AttemptDetail;
  events: DomainEvent[];
  art: ReadonlySet<string>;
  /** What the strip says at 22:00, and its button; `note` is a line of facts. */
  dayEnd: { text: string; action: string; note?: string | null };
  /** The day is over: the evaluations are the next thing to read. */
  onReadEvaluations: () => void;
  /** Which day this is and the way back, for a record that is walked day by day. */
  strip?: { day: string };
}

export default function ObserveScreen({ village, detail, events, art, dayEnd: ending, onReadEvaluations, strip }: Props) {
  const p = usePlayback();
  const [mapWidth, setMapWidth] = useState<number | null>(null);
  const reel = p.reel;
  const position = p.position;

  const atMs = position?.atMs ?? DAY_START_MS;
  const cursorSeq = position?.cursorSeq ?? 0;
  const poses = useMemo(() => posesAt(detail.timeline ?? null, atMs), [detail.timeline, atMs]);
  const medialKnown = useMemo(() => medialKnowledge(events, cursorSeq), [events, cursorSeq]);
  const colours = useMemo(() => {
    const all = requestColour(reel?.episodes ?? []);
    const open = openRequests(events, cursorSeq);
    return new Map([...all].filter(([id]) => open.has(id)));
  }, [reel, events, cursorSeq]);

  const segment = position?.segment ?? null;
  const inScene = segment !== null && segment.kind !== 'map';
  // The last scene stays mounted while it fades out into the map.
  const last = useRef<{ episode: Episode; beat: Beat; e: number; b: number } | null>(null);
  if (reel && segment && segment.kind !== 'map') {
    const episode = reel.episodes[segment.episode];
    last.current = { episode, beat: episode.beats[segment.beat], e: segment.episode, b: segment.beat };
  }
  const scene = last.current;

  // Where the stage is: its frames, marked on the map while the scene is on.
  const spotlight = useMemo(
    () => (inScene && scene ? scene.beat.frames.map((f) => ({ place: f.place, who: f.who, label: f.label })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inScene, scene?.e, scene?.b],
  );

  const line = segment?.kind === 'line' ? segment.line : null;
  const typing = segment?.kind === 'line' && position!.offset < segment.typing;
  // A record that carries its scenes carries MEDial's panel for each Task too.
  // Its verdicts stay "묻는 중" until the Task's last line has been said: the
  // answer is known when the call ends, not when it starts.
  const stored = scene ? detail.scenes?.panels[scene.episode.requestId] ?? null : null;
  const lastOfTask = scene && reel
    ? !reel.episodes.slice(scene.e + 1).some((ep) => ep.requestId === scene.episode.requestId)
      && scene.b === scene.episode.beats.length - 1
    : false;
  const resolved = lastOfTask && scene !== null
    && (segment?.kind === 'hold' || (line !== null && line >= scene.beat.lines.length - 1 && !typing));
  const judgment = useMemo(() => {
    if (!scene) return null;
    if (stored) {
      return resolved ? stored.judgment : {
        ...stored.judgment,
        asked: stored.judgment.asked.map((a) => ({ ...a, verdict: 'asking' as const, heard: null })),
      };
    }
    return judgmentOf(scene.episode.requestId, cursorSeq, events, detail.decisions, detail.rules ?? []);
  }, [scene?.episode.requestId, stored, resolved, cursorSeq, events, detail.decisions, detail.rules]);
  const beatSeconds = useMemo(() => {
    if (!reel || !scene) return 1;
    return reel.segments.filter((s) => s.kind !== 'map' && s.episode === scene.e && s.beat === scene.b)
      .reduce((sum, s) => sum + s.dur, 0);
  }, [reel, scene?.e, scene?.b]);

  const lit = segment?.kind === 'lead' && segment.reveal
    ? Math.max(0, Math.min(REVEAL_STEPS, Math.floor((position!.offset - segment.enter) / (REVEAL_STEP_S * p.pace)) + 1))
    : REVEAL_STEPS;
  const dayEnd = reel?.dayEndMs ?? DAY_START_MS;
  const dayOver = reel !== null && p.rt >= reel.total;
  const tint = scene ? (requestColour(reel?.episodes ?? []).get(scene.episode.requestId) ?? night.accent) : night.accent;

  // What the stage says between scenes: the day so far, read off the playhead.
  const subtitleOf = (requestId: string) => detail.scenes?.panels[requestId]?.subtitle ?? null;
  // Who a Task asked for help: the people its panel says MEDial asked, less the
  // person the request is about (calling someone to check on them is not asking
  // them to help). Without this the dashboard's "asked today" was always empty.
  const askedOf = (requestId: string) => {
    const subject = reel?.episodes.find((e) => e.requestId === requestId)?.subjectId ?? null;
    return (detail.scenes?.panels[requestId]?.judgment.asked ?? []).map((a) => a.actorId).filter((id) => id !== subject);
  };
  const ledger = useMemo(
    () => ledgerAt(reel?.episodes ?? [], atMs, subtitleOf, askedOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reel, atMs, detail.scenes],
  );
  // What MEDial held about a request: its stored panel's facts, and what the
  // record says it did not and could not know (unknown stays unknown).
  const holdsOf = (requestId: string) => {
    const j = detail.scenes?.panels[requestId]?.judgment;
    if (!j) return null;
    const unknown = (j.knows ?? []).filter((k) => /모른다|알 수 없|불명/.test(k));
    return { knows: (j.knows ?? []).filter((k) => !unknown.includes(k)), unknown };
  };
  const routine = useMemo(
    () => routineAt(poses, (place, id) => placeLabel(village, place, id)),
    [poses, village],
  );
  // Only what was scheduled is known ahead: the dashboard's "다음은" and the
  // timeline's faint lines both read this set (the record's `scheduled`).
  const scheduled = useMemo(() => new Set(detail.scenes?.scheduled ?? []), [detail.scenes]);
  const next = useMemo(() => {
    const episode = reel?.episodes.find((e) => e.startMs > atMs && scheduled.has(e.requestId)) ?? null;
    return episode ? { startMs: episode.startMs, title: episode.title } : null;
  }, [reel, atMs, scheduled]);
  const timeline = useMemo(
    () => timelineAt(reel?.episodes ?? [], atMs, scheduled, subtitleOf, p.viewMode === 'researcher'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reel, atMs, scheduled, detail.scenes, p.viewMode],
  );

  return (
    <Screen style={mapWidth ? ({ '--map-w': `clamp(200px, ${mapWidth}px, 34%)` } as React.CSSProperties) : undefined}>
      <MapColumn>
        {/* The column's head: which day, the way back, the village's name and the
            requests chosen so far. The name used to be a badge on the map's corner,
            where it covered the people who live in the village's north end. */}
        <MapStrip>
          <div>
            <b>MEDial</b>
            {strip && <em>{strip.day}</em>}
          </div>
        </MapStrip>
        <MapBody>
        <VillageMap
          village={village}
          poses={poses}
          viewMode={p.viewMode}
          medialKnown={medialKnown}
          seatsPerVehicle={detail.timeline?.reservations?.seatsPerVehicle ?? detail.resources.assumedVehicleSeats ?? 0}
          taskColours={colours}
          selectedCluster={p.selectedCluster}
          selectedActor={p.selectedActor}
          onSelectCluster={p.selectCluster}
          spotlight={spotlight}
          onFitWidth={setMapWidth}
        />
        </MapBody>
      </MapColumn>

      <Right>
        <Stage>
          {/* Not mounted behind a scene: an invisible layer would still be read out,
              and would say twice what the judgement panel says once. */}
          <DashLayer $on={!inScene}>
            {!inScene && (
              <MedialDashboard ledger={ledger} next={next} holdsOf={holdsOf}
                routine={p.viewMode === 'researcher' ? routine : null} />
            )}
          </DashLayer>
          <SceneLayer $on={inScene} aria-hidden={!inScene}>
            {scene && judgment && (
              <SceneStage
                beat={scene.beat}
                beatKey={`${scene.e}:${scene.b}`}
                village={village}
                art={art}
                line={line}
                typing={typing}
                seconds={beatSeconds}
                panel={{ title: scene.episode.title, subtitle: stored?.subtitle ?? null, tint, judgment, lit }}
              />
            )}
          </SceneLayer>
        </Stage>

      {dayOver && (
        <DayEnd>
          <span>
            <strong>{formatClock(dayEnd)} · {ending.text}</strong>
            {ending.note && <span>{ending.note}</span>}
          </span>
          <button type="button" onClick={onReadEvaluations}>{ending.action} →</button>
        </DayEnd>
      )}

      </Right>

      <DayTimeline
        items={timeline}
        atMs={atMs}
        dayStartMs={DAY_START_MS}
        dayEndMs={dayEnd}
        playing={p.playing}
        onTogglePlay={() => void (p.playing ? p.pause() : p.play())}
        onSeek={(ms) => p.seekTime(ms)}
        onCommit={() => void p.commit()}
        paces={PACES}
        pace={p.pace}
        onPace={p.setPace}
        settings={
          <>
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          보기
          <Select aria-label="관찰 시점" value={p.viewMode}
            onChange={(e) => p.setViewMode(e.target.value as typeof p.viewMode)}>
            <option value="researcher">연구자 전체</option>
            <option value="medial">MEDial이 아는 것</option>
          </Select>
        </label>
        {/* Only a record that names its story scenes offers the choice. */}
        {(detail.scenes?.featured?.length ?? 0) > 0 && (
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            장면
            <Select aria-label="재생할 장면" value={p.length}
              onChange={(e) => p.setLength(e.target.value as typeof p.length)}>
              <option value="story">핵심 장면만</option>
              <option value="all">모든 장면</option>
            </Select>
          </label>
        )}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <IconButton onClick={() => void p.jumpScene(-1)}>← 앞 장면</IconButton>
          <IconButton onClick={() => void p.jumpScene(1)}>다음 장면 →</IconButton>
          <IconButton onClick={() => void p.restart()}>하루 다시 보기</IconButton>
        </div>
        <Sub as="span">
          장면 {reel ? new Set(reel.segments.flatMap((x) => (x.kind === 'map' ? [] : [x.episode]))).size : 0}개 재생 · 요청 {reel?.episodes.length ?? 0}건 · {village.isSynthetic ? '합성 지도' : '원자료 지형'}
        </Sub>
        {/* Which day this run happened on: as recorded, or nudged. The
            edits themselves are in the tooltip, one per person. */}
        {detail.metrics.dayRealization && (
          <Sub as="span" title={dayChangeLines(detail.metrics.dayRealization).join('\n') || '기록된 일과를 그대로 썼습니다.'}>
            {dayLabel(detail.metrics.dayRealization)}
          </Sub>
        )}
          </>
        }
      />
    </Screen>
  );
}
