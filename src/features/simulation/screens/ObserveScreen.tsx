import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import type { AttemptDetail, DomainEvent, VillagePayload } from '../api/types';
import VillageMap from '../components/VillageMap';
import { formatClock, medialKnowledge, posesAt } from '../positions';
import { MEDIAL } from '../scene/beats';
import { openRequests, requestColour } from '../scene/colours';
import { judgmentOf } from '../scene/judgment';
import { DAY_START_MS, usePlayback } from '../scene/playback';
import { PACES, REVEAL_STEP_S, REVEAL_STEPS } from '../scene/reel';
import SceneMapCard from '../scene/SceneMapCard';
import SceneStage from '../scene/SceneStage';
import type { Beat, Episode } from '../scene/types';
import { dayChangeLines, dayLabel } from '../selectors/words';
import { IconButton, Select, Sub } from '../ui/primitives';
import { colour, font, radius } from '../ui/theme';

// 사례와 서비스 경험 - watching one run.
//
// Two shots. When nothing is being said the village map fills the stage and
// the day runs fast. When a request has a scene, the map shrinks into a card at
// the top left with a pin on each place involved, and the stage films the
// scene at eye level: a frame per place, the people there, their words as
// bubbles, and MEDial - which has no body - as its judgement panel. One scene
// at a time, in the order they began.
//
// This replaced the three-column arrangement (map · events + orchestrator ·
// people/person) on 2026-09-28. Its panels are gone rather than hidden: the
// scene carries what happened, the panel what MEDial made of it, and the map
// card a person's facts.

const Screen = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 16px 12px;
  gap: 8px;
`;

const Stage = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 360px;
`;

const SceneLayer = styled.div<{ $on: boolean }>`
  position: absolute;
  inset: 0;
  opacity: ${(p) => (p.$on ? 1 : 0)};
  transform: ${(p) => (p.$on ? 'none' : 'scale(1.035)')};
  transition: opacity 0.7s ease, transform 0.8s cubic-bezier(0.2, 0.7, 0.2, 1);
  pointer-events: ${(p) => (p.$on ? 'auto' : 'none')};
`;

/** The map. Its box is measured, so going to and from the card is one move. */
const MapLayer = styled.div<{ $card: boolean }>`
  position: absolute;
  z-index: 5;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: ${colour.surface};
  border: 1px solid ${(p) => (p.$card ? 'rgba(255,255,255,0.5)' : colour.border)};
  border-radius: ${radius.panel};
  box-shadow: ${(p) => (p.$card ? '0 10px 30px rgba(0,0,0,0.35)' : 'none')};
  transition: left 0.8s cubic-bezier(0.65, 0, 0.35, 1), top 0.8s cubic-bezier(0.65, 0, 0.35, 1),
    width 0.8s cubic-bezier(0.65, 0, 0.35, 1), height 0.8s cubic-bezier(0.65, 0, 0.35, 1), box-shadow 0.8s;
`;

const Transport = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: ${colour.surface};
  border: 1px solid ${colour.border};
  border-radius: ${radius.panel};
`;

const Clock = styled.span`
  font-variant-numeric: tabular-nums;
  font-size: ${font.section};
  font-weight: 700;
  min-width: 58px;
`;

/** The day's track: a bar per scene, coloured by its request, over the clock. */
const Track = styled.div`
  flex: 1;
  min-width: 120px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  > input { width: 100%; margin: 0; accent-color: ${colour.primary}; }
`;

const Bars = styled.div`
  position: relative;
  height: 8px;
  > i { position: absolute; top: 0; height: 6px; border-radius: 999px; opacity: 0.85; }
`;

const Ticks = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: ${font.micro};
  color: ${colour.unknown};
  font-variant-numeric: tabular-nums;
  > span:last-child { color: ${colour.primary}; }
`;

const Paces = styled.div`
  display: flex;
  gap: 4px;
  flex: none;
`;

const Pace = styled.button<{ $on: boolean }>`
  font: inherit;
  font-size: ${font.small};
  font-weight: 700;
  padding: 4px 9px;
  border-radius: 999px;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$on ? colour.text : colour.border)};
  background: ${(p) => (p.$on ? colour.text : 'transparent')};
  color: ${(p) => (p.$on ? '#ffffff' : colour.secondary)};
`;

/** Everything secondary to watching - the MEDial-only view, scene by scene, a
 *  new case - behind one gear. */
const Settings = styled.details`
  position: relative;
  flex: none;
  > summary {
    cursor: pointer;
    list-style: none;
    color: ${colour.secondary};
    font-size: 16px;
    padding: 6px;
    border-radius: ${radius.control};
  }
  > summary::-webkit-details-marker { display: none; }
  > summary:focus-visible { outline: 2px solid ${colour.primary}; }
  > div {
    position: absolute;
    right: 0;
    bottom: 36px;
    width: 240px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: ${colour.surface};
    border: 1px solid ${colour.border};
    border-radius: ${radius.control};
    padding: 12px;
    box-shadow: 0 4px 14px rgba(29, 41, 53, 0.14);
    z-index: 8;
    font-size: ${font.small};
  }
`;

const DayEnd = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 14px;
  border-radius: ${radius.panel};
  background: ${colour.selected};
  font-size: ${font.small};
  color: ${colour.primary};
`;

interface Props {
  village: VillagePayload;
  detail: AttemptDetail;
  events: DomainEvent[];
  art: ReadonlySet<string>;
  /** Leave this run for another: set a new case up (real), or pick another
   *  recording (sim). The run stays stored either way. */
  caseAction: { label: string; onClick: () => void };
  /** The day is over: the evaluations are the next thing to read. */
  onReadEvaluations: () => void;
}

export default function ObserveScreen({ village, detail, events, art, caseAction, onReadEvaluations }: Props) {
  const p = usePlayback();
  const reel = p.reel;
  const position = p.position;
  const stage = useStageBox();

  const atMs = position?.atMs ?? DAY_START_MS;
  const cursorSeq = position?.cursorSeq ?? 0;
  const poses = useMemo(() => posesAt(detail.timeline ?? null, atMs), [detail.timeline, atMs]);
  const medialKnown = useMemo(() => medialKnowledge(events, cursorSeq), [events, cursorSeq]);
  const colours = useMemo(() => {
    const all = requestColour(reel?.episodes ?? []);
    const open = openRequests(events, cursorSeq);
    return new Map([...all].filter(([id]) => open.has(id)));
  }, [reel, events, cursorSeq]);
  const reservations = useMemo(
    () => (detail.timeline?.reservations?.reservations ?? []).filter((r) => r.departMs <= atMs && r.status !== 'cancelled'),
    [detail.timeline, atMs],
  );

  const segment = position?.segment ?? null;
  const inScene = segment !== null && segment.kind !== 'map';
  // The last scene stays mounted while it fades out into the map.
  const last = useRef<{ episode: Episode; beat: Beat; e: number; b: number } | null>(null);
  if (reel && segment && segment.kind !== 'map') {
    const episode = reel.episodes[segment.episode];
    last.current = { episode, beat: episode.beats[segment.beat], e: segment.episode, b: segment.beat };
  }
  const scene = last.current;

  const judgment = useMemo(
    () => (scene ? judgmentOf(scene.episode.requestId, cursorSeq, events, detail.decisions, detail.rules ?? []) : null),
    [scene?.episode.requestId, cursorSeq, events, detail.decisions, detail.rules],
  );
  const beatSeconds = useMemo(() => {
    if (!reel || !scene) return 1;
    return reel.segments.filter((s) => s.kind !== 'map' && s.episode === scene.e && s.beat === scene.b)
      .reduce((sum, s) => sum + s.dur, 0);
  }, [reel, scene?.e, scene?.b]);

  const lit = segment?.kind === 'lead' && segment.reveal
    ? Math.max(0, Math.min(REVEAL_STEPS, Math.floor((position!.offset - segment.enter) / (REVEAL_STEP_S * p.pace)) + 1))
    : REVEAL_STEPS;
  const line = segment?.kind === 'line' ? segment.line : null;
  const typing = segment?.kind === 'line' && position!.offset < segment.typing;
  const speaker = scene && line !== null ? scene.beat.lines[line]?.speaker : null;
  const hot = scene && speaker
    ? scene.beat.frames.findIndex((f) => (speaker === MEDIAL ? !!f.device : f.who.includes(speaker)))
    : -1;

  const dayEnd = reel?.dayEndMs ?? DAY_START_MS;
  const dayOver = reel !== null && p.rt >= reel.total;
  const tint = scene ? (requestColour(reel?.episodes ?? []).get(scene.episode.requestId) ?? colour.primary) : colour.primary;

  // The card: top left, at the map's own proportions, inside a box of about a
  // quarter of the frames' width and two fifths of the stage's height - the
  // source village is a tall strip, so its height is what has to be capped.
  const [, , vw, vh] = village.geometry.viewBox;
  const maxW = Math.max(200, Math.min(360, (stage.width - Math.max(300, stage.width * 0.26)) * 0.24));
  const maxH = Math.max(160, Math.min(300, stage.height * 0.42));
  const cardScale = Math.min(maxW / vw, maxH / vh);
  const mapBox = inScene
    ? { left: 14, top: 14, width: vw * cardScale, height: vh * cardScale }
    : { left: 0, top: 0, width: stage.width, height: stage.height };

  return (
    <Screen>
      <Stage ref={stage.ref}>
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
              panel={{ title: scene.episode.title, tint, judgment, lit }}
            />
          )}
        </SceneLayer>
        <MapLayer $card={inScene} style={mapBox}>
          {inScene && scene ? (
            <SceneMapCard village={village} frames={scene.beat.frames} hot={hot} poses={poses} />
          ) : (
            <VillageMap
              village={village}
              poses={poses}
              viewMode={p.viewMode}
              medialKnown={medialKnown}
              reservations={reservations}
              seatsPerVehicle={detail.timeline?.reservations?.seatsPerVehicle ?? detail.resources.assumedVehicleSeats ?? 0}
              taskColours={colours}
              selectedCluster={p.selectedCluster}
              selectedActor={p.selectedActor}
              title={village.isSynthetic ? '합성 마을' : '은점마을'}
              onSelectCluster={p.selectCluster}
            />
          )}
        </MapLayer>
      </Stage>

      {dayOver && (
        <DayEnd>
          <span>{formatClock(dayEnd)} · 하루가 끝났습니다</span>
          <IconButton onClick={onReadEvaluations}>주민 평가 읽기 →</IconButton>
        </DayEnd>
      )}

      <Transport>
        {/* This plays back a stored log. Stopping it stops nothing on the
            server, whose own controls live in the progress strip. */}
        <IconButton onClick={() => void (p.playing ? p.pause() : p.play())}>
          {p.playing ? '⏸ 정지' : '▶ 재생'}
        </IconButton>
        <Clock>{formatClock(atMs)}</Clock>
        <Track>
          <Bars aria-hidden>
            {(reel?.episodes ?? []).map((episode, i) => (
              <i key={i} style={{
                left: `${((episode.startMs - DAY_START_MS) / (dayEnd - DAY_START_MS)) * 100}%`,
                width: `max(4px, ${((episode.endMs - episode.startMs) / (dayEnd - DAY_START_MS)) * 100}%)`,
                background: requestColour(reel!.episodes).get(episode.requestId),
              }} />
            ))}
          </Bars>
          <input
            type="range"
            min={DAY_START_MS}
            max={dayEnd}
            step={60_000}
            value={Math.min(Math.max(atMs, DAY_START_MS), dayEnd)}
            onChange={(e) => p.seekTime(Number(e.target.value))}
            onPointerUp={() => void p.commit()}
            onKeyUp={() => void p.commit()}
            aria-label="시각"
          />
          <Ticks aria-hidden>
            <span>05:00</span>
            <span>12:00</span>
            <span>17:00</span>
            <span>{formatClock(dayEnd)} 주민 평가</span>
          </Ticks>
        </Track>
        <Paces role="group" aria-label="대사 속도">
          {PACES.map((option) => (
            <Pace key={option.value} $on={p.pace === option.value} aria-pressed={p.pace === option.value}
              onClick={() => p.setPace(option.value)}>
              {option.label}
            </Pace>
          ))}
        </Paces>
        <Settings>
          <summary aria-label="재생 설정" title="재생 설정">⚙</summary>
          <div>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              보기
              <Select aria-label="관찰 시점" value={p.viewMode}
                onChange={(e) => p.setViewMode(e.target.value as typeof p.viewMode)}>
                <option value="researcher">연구자 전체</option>
                <option value="medial">MEDial이 아는 것</option>
              </Select>
            </label>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <IconButton onClick={() => void p.jumpScene(-1)}>← 앞 장면</IconButton>
              <IconButton onClick={() => void p.jumpScene(1)}>다음 장면 →</IconButton>
              <IconButton onClick={() => void p.restart()}>처음으로</IconButton>
            </div>
            <Sub as="span">
              장면 {reel?.episodes.length ?? 0}개 · {village.isSynthetic ? '합성 지도' : '원자료 지형'}
            </Sub>
            {/* Which day this run happened on: as recorded, or nudged. The
                edits themselves are in the tooltip, one per person. */}
            {detail.metrics.dayRealization && (
              <Sub as="span" title={dayChangeLines(detail.metrics.dayRealization).join('\n') || '기록된 일과를 그대로 썼습니다.'}>
                {dayLabel(detail.metrics.dayRealization)}
              </Sub>
            )}
            <IconButton onClick={caseAction.onClick}>{caseAction.label}</IconButton>
          </div>
        </Settings>
      </Transport>
    </Screen>
  );
}

/** The stage's size, so the map can move between filling it and the card. */
function useStageBox() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 1200, height: 640 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, ...box };
}
