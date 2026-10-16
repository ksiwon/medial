import { useUiScale } from '../ui/uiScale';
import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { api } from '../api/client';
import type { VillagePayload } from '../api/types';
import {
  clusterPoses,
  medialPoses,
  placeLabel,
  spreadOverlaps,
  type ActorPose,
  type Cluster,
  type MedialKnown,
} from '../positions';
import { mapFrame } from '../mapFrame';
import { personName } from '../selectors/story';
import { colour, font, night, radius } from '../ui/theme';
import { ActivityIcon, FaceMark, VehicleMark } from './Marks';
import PillText, { plateSize } from '../ui/PillText';
import { pill } from '../ui/primitives';

// The real map of 은점마을: the source raster turned upright - north at the top,
// the 1.15 km north-south run standing in a tall column (mapFrame.ts) - flat,
// at the source's own proportions. Nothing here invents terrain or stretches it.
// The map always fills the column's width (2026-10-07: a column narrower than the
// village's proportions used to leave a blank strip at the side); the village's
// north and south run above and below. Zooming leaves that view and 전체 comes back.
// While a scene plays, the places it is filmed in are marked on the map (spotlight),
// so the stage and the village are read as one. The map is only looked at: on the
// two-screen exhibition the wall shows it fitted to its column and nothing on it can
// be touched (the tablet has no map control; 2026-10-16).
//
// Three rules from doc 15 section 5 shape the drawing:
//
//  - the raster already carries the road network and the street names, so this
//    layer does not draw them again, and no route lines either: a marker moving
//    along the road is the route;
//  - marker sizes are screen pixels, not map units. At full extent one SVG unit
//    is about a quarter of a pixel, so a face specified in map units is two
//    pixels wide;
//  - who is grouped with whom is decided by place and vehicle in positions.ts.
//    This file only stops marks from covering each other, and draws a leader
//    line whenever it had to move one.

/** A place the stage is in: a place key, who is there, and its name. */
export interface Spot {
  place: string | null;
  who: string[];
  label: string;
}

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SPOT = night.accent;

/** Screen mapping for preserveAspectRatio="xMidYMid meet". */
function projector(view: View, box: { width: number; height: number }) {
  const scale = Math.min(box.width / view.w, box.height / view.h) || 1;
  const offsetX = (box.width - view.w * scale) / 2;
  const offsetY = (box.height - view.h * scale) / 2;
  return {
    scale,
    toScreen: (x: number, y: number) => ({
      left: offsetX + (x - view.x) * scale,
      top: offsetY + (y - view.y) * scale,
    }),
    toSvg: (px: number, py: number) => ({
      x: view.x + (px - offsetX) / scale,
      y: view.y + (py - offsetY) / scale,
    }),
  };
}

/** Marker geometry, in screen pixels, exactly as doc 15 section 5 specifies. */
const FACE_D = 24;
const FACE_R = FACE_D / 2;
// A marker for one person: a smaller face, and a pill that stops just after
// the name (이장 · P10-P12 are the widest labels) instead of a fixed 62.
const SOLO_FACE_R = 10;
const SOLO_LEFT = SOLO_FACE_R + 3;
const SOLO_W = SOLO_LEFT + SOLO_FACE_R + 4 + 20 + 4;

const Frame = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  /* The map is the one light object on the night ground; past its edges is the ground. */
  background: ${night.panel};
  overflow: hidden;
`;

const Svg = styled.svg`
  width: 100%;
  height: 100%;
  display: block;
`;

const Compass = styled.div`
  position: absolute;
  right: 12px;
  top: 12px;
  box-sizing: border-box;
  width: 36px;
  height: 36px;
  border-radius: ${radius.round};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  font-size: calc(12px * var(--k, 1));
  font-weight: 800;
  line-height: 1;
  color: ${night.ink};
  background: rgba(18, 19, 16, 0.82);
  pointer-events: none;
`;

const ModeBadge = styled.div`
  ${pill('sm')}
  position: absolute;
  left: 12px;
  top: 12px;
  background: rgba(18, 19, 16, 0.82);
  color: ${night.mute};
  pointer-events: none;
`;

/** Required source credit. Small type is allowed here and only here. */
/* Required attribution, under the zoom tools in the bottom-right corner and as
   small as it is allowed to be. It was a strip along the bottom-left, where it
   sat on top of the village. */
const Credit = styled.div`
  position: absolute;
  right: 12px;
  bottom: 8px;
  max-width: 60%;
  text-align: right;
  font-size: calc(8px * var(--k, 1));
  line-height: 1.3;
  color: ${night.mute};
  background: rgba(18, 19, 16, 0.6);
  border-radius: ${radius.xs};
  padding: 0 4px;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

/** Everyone who has no coordinate on this map, as one row of names under it. */
/* One height whoever is out: the map above it must not jump as people leave
   and come back. Three rows of chips fit; more scroll inside. */
const Outside = styled.div`
  flex: none;
  max-height: 148px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  font-size: ${font.small};
  color: ${night.mute};
  > strong { font-size: calc(12px * var(--k, 1)); font-weight: 800; letter-spacing: 0.08em; color: ${night.faint}; }
  /* One line a place: "읍내: P2, P3". */
  > p { margin: 0; line-height: 1.45; word-break: keep-all; }
  > p > b { color: ${night.ink}; font-weight: 800; }
`;

/** Place names worth a label, at every zoom now that the map lies along the
 *  screen and has the room (as on the exhibition wall). Houses are never
 *  labelled: which named resident lives in which building is not put on screen. */
const LABELLED_PLACES = new Set(['HALL', 'PORT', 'EXP', 'FOOD', 'MIGA', 'FARM', 'TOWNEXIT', 'SEA']);

interface Props {
  village: VillagePayload;
  poses: ActorPose[];
  viewMode: 'researcher' | 'medial';
  medialKnown: Map<string, MedialKnown>;
  seatsPerVehicle: number;
  /** Colour per still-running request: the ring on whoever is doing it. */
  taskColours?: Map<string, string>;
  /** The places the stage is showing now, marked on the map. Empty between scenes. */
  spotlight?: Spot[];
  /** The column width at which the whole village fills the frame exactly, for
   *  the frame's present height: the screen sizes the column to it. */
  onFitWidth?: (px: number) => void;
}

export default function VillageMap({
  village,
  poses,
  viewMode,
  medialKnown,
  seatsPerVehicle,
  taskColours,
  spotlight = [],
  onFitWidth,
}: Props) {
  const frame = useMemo(() => mapFrame(village), [village]);
  const [vx, vy, vw, vh] = frame.viewBox;
  // The land the map shows: the raster's own edges when there is one (the
  // village's viewBox reaches past it on one side and short of it on the other),
  // the viewBox otherwise.
  const extent: View = useMemo(() => {
    const image = village.mapImage;
    if (!image?.northUpMatrix) return { x: vx, y: vy, w: vw, h: vh };
    const [a, b, c, d, e, f] = image.northUpMatrix;
    const corners = [[0, 0], [image.sourceWidthPx, 0], [0, image.sourceHeightPx], [image.sourceWidthPx, image.sourceHeightPx]]
      .map(([px, py]) => [a * px + c * py + e, b * px + d * py + f]);
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }, [village.mapImage, vx, vy, vw, vh]);
  const [box, setBox] = useState({ width: 1, height: 1 });
  // Edge to edge across, centred along: the view takes the column's shape.
  const home: View = useMemo(() => {
    const h = box.width > 1 && box.height > 1 ? extent.w * (box.height / box.width) : extent.h;
    return { x: extent.x, w: extent.w, h, y: extent.y + extent.h / 2 - h / 2 };
  }, [extent, box]);
  // The whole village, always: nothing here zooms or pans.
  const view = home;
  // The column is as wide as the village is, at the frame's height: then the map
  // fills its frame both ways, with no strip at the side and nobody cut off the
  // top or bottom (the village runs 1.2 km north-south; at a fixed width someone
  // was always off the map).
  useEffect(() => {
    if (onFitWidth && box.height > 1) onFitWidth(Math.round(box.height * (extent.w / extent.h)));
  }, [onFitWidth, box.height, extent]);
  const [mapBroken, setMapBroken] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setMapBroken(false); }, [extent]);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const ui = useUiScale();
  const project = useMemo(() => projector(view, box), [view, box]);

  const medial = viewMode === 'medial';
  const projected = useMemo(
    () => (medial ? medialPoses(medialKnown, village, poses) : null),
    [medial, medialKnown, village, poses],
  );
  const shown = projected ? projected.located : poses;
  // Grouped north-up, then placed where the turned map draws them.
  const clusters = useMemo(
    () => clusterPoses(shown).map((cluster) => {
      const [x, y] = frame.at(cluster.x, cluster.y);
      return { ...cluster, x, y };
    }),
    [shown, frame],
  );
  const outside = shown.filter((p) => p.offMap);
  // Who is away, a line a place, in the order the places first appear.
  const outsideByPlace: { where: string; ids: string[] }[] = [];
  for (const pose of outside) {
    const where = pose.activity === '알 수 없음' ? (placeLabel(village, pose.place, pose.id) ?? '마을 밖') : pose.activity;
    const line = outsideByPlace.find((l) => l.where === where);
    if (line) line.ids.push(pose.id); else outsideByPlace.push({ where, ids: [pose.id] });
  }

  // A scene's frame is drawn where its place is: a named place, a home, or
  // else where the people in it stand (a car, the road). A frame MEDial cannot
  // place (its view, place unknown) is not drawn.
  const spots = useMemo(() => {
    const out: { key: string; x: number; y: number; label: string }[] = [];
    for (const spot of spotlight) {
      if (!spot.place) continue;
      const named = village.places[spot.place]
        ?? (spot.place.startsWith('HOME:') ? village.homes[spot.place.slice(5)] : undefined);
      let point: [number, number] | null = named ? [named.x, named.y] : null;
      if (!point) {
        const there = shown.filter((p) => spot.who.includes(p.id) && !p.offMap && p.x != null && p.y != null);
        if (there.length) point = [there.reduce((n, p) => n + p.x!, 0) / there.length, there.reduce((n, p) => n + p.y!, 0) / there.length];
      }
      if (!point) continue;
      const [x, y] = frame.at(point[0], point[1]);
      if (!out.some((o) => Math.hypot(o.x - x, o.y - y) < 20)) out.push({ key: spot.place, x, y, label: spot.label });
    }
    return out;
  }, [spotlight, village, shown, frame]);

  // Where each group's mark is actually drawn, after nudging overlapping ones
  // apart. The anchor itself never moves; a nudged mark keeps a leader line.
  const layout = useMemo(() => {
    const marks = clusters.map((cluster) => {
      const point = project.toScreen(cluster.x, cluster.y);
      return { key: cluster.key, left: point.left, top: point.top };
    });
    return spreadOverlaps(marks, FACE_D + 22,
      box.width > 1 ? { left: 34, top: 20, right: box.width - 44, bottom: box.height - 20 } : undefined,
      // A lone person's mark is a pill about twice as wide as it is tall.
      1.35);
  }, [clusters, project, box]);

  // Where each place's name goes: beside its dot on the right, else the left,
  // below or above - the first side where it covers no one's marker and stays in
  // the frame. A name with no free side is not drawn (its dot still is): a name
  // under a face could not be read and hid the face (2026-10-07 audit).
  const placeLabels = useMemo(() => {
    const out = new Map<string, { x: number; y: number; anchor: 'start' | 'middle' | 'end' }>();
    const marks = clusters.map((cluster) => {
      const at = layout.get(cluster.key);
      if (!at) return null;
      const alone = cluster.members.length === 1;
      const left = at.left - (alone ? SOLO_LEFT : 28);
      return { l: left, t: at.top - (alone ? 13 : 16), r: left + (alone ? SOLO_W : 56), b: at.top + (alone ? 13 : 16) };
    }).filter((m): m is { l: number; t: number; r: number; b: number } => m !== null);
    // The map's own controls sit over its corners: a name goes around them too.
    const controls = [
      { l: box.width - 52, t: 0, r: box.width, b: 52 },                          // north
      { l: box.width - 150, t: box.height - 76, r: box.width, b: box.height },   // zoom tools, credit
    ];
    const taken = [...marks, ...controls];
    for (const place of Object.values(village.places)) {
      if (place.offMap || !LABELLED_PLACES.has(place.id)) continue;
      const [px, py] = frame.at(place.x, place.y);
      const p = project.toScreen(px, py);
      const { w, h } = plateSize(place.label, 10);
      const gap = 8;
      const sides = [
        { l: p.left + gap, t: p.top - h / 2, anchor: 'start' as const, tx: p.left + gap + 8.2, ty: p.top + 3.4 },
        { l: p.left - gap - w, t: p.top - h / 2, anchor: 'end' as const, tx: p.left - gap - 8.2, ty: p.top + 3.4 },
        { l: p.left - w / 2, t: p.top + gap, anchor: 'middle' as const, tx: p.left, ty: p.top + gap + h / 2 + 3.4 },
        { l: p.left - w / 2, t: p.top - gap - h, anchor: 'middle' as const, tx: p.left, ty: p.top - gap - h / 2 + 3.4 },
      ];
      const free = sides.find((side) => {
        const r = { l: side.l, t: side.t, r: side.l + w, b: side.t + h };
        const inside = r.l >= 2 && r.t >= 2 && r.r <= box.width - 2 && r.b <= box.height - 2;
        return inside && !taken.some((m) => r.l < m.r && r.r > m.l && r.t < m.b && r.b > m.t);
      });
      if (!free) continue;
      taken.push({ l: free.l, t: free.t, r: free.l + w, b: free.t + h });
      const at = project.toSvg(free.tx, free.ty);
      out.set(place.id, { x: at.x, y: at.y, anchor: free.anchor });
    }
    return out;
  }, [clusters, layout, village.places, frame, project, box]);

  const anchors = useMemo(() => {
    const out = new Map<string, { left: number; top: number }>();
    for (const cluster of clusters) out.set(cluster.key, project.toScreen(cluster.x, cluster.y));
    return out;
  }, [clusters, project]);

  const mapImage = village.mapImage;
  const hasRaster = Boolean(mapImage) && !mapBroken;
  /** SVG units per screen pixel. */
  const k = ui / (project.scale || 1);

  return (
    <>
      <Frame ref={frameRef}>
        <Svg
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
        >
          

          {/* The land, light, on the dark ground: the raster's own edges, or the
              village's frame when there is no raster. */}
          <rect x={extent.x} y={extent.y} width={extent.w} height={extent.h} fill="#f8f7f4" />

          {/* The source's own map. Research material, fetched from the local API
              and never bundled. Desaturated so the people on top of it are the
              part that carries the eye. */}
          {hasRaster && (
            <image
              href={api.mapImageUrl()}
              x={0}
              y={0}
              width={mapImage!.sourceWidthPx}
              height={mapImage!.sourceHeightPx}
              transform={frame.rasterTransform ?? undefined}
              opacity={medial ? 0.72 : 1}
              style={{ filter: 'saturate(0.92)' }}
              onError={() => setMapBroken(true)}
              preserveAspectRatio="none"
            />
          )}

          {/* Without the raster there is no drawn terrain at all, so - and only
              then - the registry polylines stand in for it. Drawing them on top
              of the raster would be a second road network over the first. */}
          {!hasRaster &&
            Object.entries(village.roads).map(([name, points]) => (
              <polyline
                key={name}
                points={points.map((p) => frame.at(p[0], p[1]).join(',')).join(' ')}
                fill="none"
                stroke="#d9dee3"
                strokeWidth={Math.max(3.2, 1.4 * k)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

          {/* Confirmed residences, at the source coordinates, kept quiet: a
              small outline, no label, no cartoon roof. */}
          {Object.entries(village.homes).map(([id, home]) => {
            const [hx, hy] = frame.at(home.x, home.y);
            return (
            <rect
              key={id}
              x={hx - 3 * k}
              y={hy - 3 * k}
              width={6 * k}
              height={6 * k}
              rx={1.2 * k}
              fill="#ffffff"
              stroke="#9aa5b0"
              strokeWidth={1.1 * k}
              style={{ pointerEvents: 'none' }}
            />
            );
          })}

          {Object.values(village.places)
            .filter((place) => !place.offMap)
            .map((place) => {
              const [px, py] = frame.at(place.x, place.y);
              const spot = placeLabels.get(place.id);
              return (
                <g key={place.id} style={{ pointerEvents: 'none' }}>
                  <circle
                    cx={px}
                    cy={py}
                    r={3.6 * k}
                    fill={colour.surface}
                    stroke={colour.secondary}
                    strokeWidth={1.4 * k}
                  />
                  {spot && (
                    <PillText
                      x={spot.x}
                      y={spot.y}
                      anchor={spot.anchor}
                      size={10 * k}
                      weight={600}
                      fill={colour.text}
                      plate="rgba(255, 255, 255, 0.86)"
                      text={place.label}
                      within={view}
                    />
                  )}
                </g>
              );
            })}

          {/* Where the scene on the stage is happening: a pulsing ring and its name. */}
          {spots.map((spot) => (
            <g key={spot.key} pointerEvents="none">
              <circle cx={spot.x} cy={spot.y} r={34 * k} fill="rgba(226, 84, 44, 0.16)" stroke={SPOT} strokeWidth={3 * k} />
              <circle cx={spot.x} cy={spot.y} r={34 * k} fill="none" stroke={SPOT} strokeWidth={2 * k}>
                <animate attributeName="r" values={`${34 * k};${58 * k}`} dur="1.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.9;0" dur="1.4s" repeatCount="indefinite" />
              </circle>
              <PillText x={spot.x} y={spot.y - 46 * k} anchor="middle" size={13 * k} weight={800}
                fill="#fff" plate={SPOT} text={`지금 대화 · ${spot.label}`} within={view} />
            </g>
          ))}

          {clusters.map((cluster) => {
            const at = layout.get(cluster.key);
            const anchor = anchors.get(cluster.key);
            if (!at || !anchor) return null;
            const drawn = project.toSvg(at.left, at.top);
            return (
              <ClusterMark
                key={cluster.key}
                cluster={cluster}
                x={drawn.x}
                y={drawn.y}
                anchorX={cluster.x}
                anchorY={cluster.y}
                leader={at.moved}
                k={k}
                seats={seatsPerVehicle}
                medial={medial}
                taskColours={taskColours}
              />
            );
          })}
        </Svg>

        {medial && <ModeBadge>MEDial이 보고받은 위치만 표시 중</ModeBadge>}

        <Compass>
          <div style={{ fontSize: `calc(12px * var(--k, 1))`, lineHeight: 1, transform: `rotate(${frame.northDeg}deg)` }}>▲</div>
          <div>북</div>
        </Compass>

        <Credit>
          {hasRaster
            ? '© OpenStreetMap 기여자'
            : '지도 이미지 없음 · 원자료 좌표만 표시'}
        </Credit>
      </Frame>

      {/* Who is not on the map, always in view (the exhibition wall's strip):
          a place without a coordinate is a name here, never a guessed point. */}
      <Outside aria-live="polite"
        title={outside.length > 0 ? '마을 밖은 이 지도에 좌표가 없어 목록으로만 적습니다. 지도 여백에 임의로 놓지 않습니다.' : undefined}>
        <strong>{outside.length ? '마을 밖' : '마을 밖에 나가 있는 사람 없음'}</strong>
        {outsideByPlace.map(({ where, ids }) => (
          // P-numbers only: a full name made the line too wide for a column
          // sized to the village.
          <p key={where} title={ids.map(personName).join(', ')}><b>{where}</b>: {ids.join(', ')}</p>
        ))}
        {projected && <p><b>MEDial이 위치를 모르는 사람</b>: {projected.unlocated.length}명</p>}
      </Outside>
    </>
  );
}

function activityKind(pose: ActorPose): 'travel' | 'waiting' | 'task' | 'boat' | null {
  if (pose.mode === 'boat') return 'boat';
  if (pose.moving) return 'travel';
  if (pose.onTask) return 'task';
  if (pose.divergesFromBaseline) return 'waiting';
  return null;
}

function ClusterMark({
  cluster,
  x,
  y,
  anchorX,
  anchorY,
  leader,
  k,
  seats,
  medial,
  taskColours,
}: {
  cluster: Cluster;
  /** Where the mark is drawn, after de-collision. */
  x: number;
  y: number;
  /** Where the people actually are. */
  anchorX: number;
  anchorY: number;
  leader: boolean;
  /** SVG units per screen pixel, so a face stays 22 px at any zoom. */
  k: number;
  seats: number;
  medial: boolean;
  taskColours?: Map<string, string>;
}) {
  const lead = cluster.members[0];
  const driver = cluster.members.find((m) => m.mode === 'drive' || m.mode === 'boat');
  const faces = cluster.members.slice(0, 3);
  const alone = cluster.members.length === 1;
  // A lone face is smaller and the pill ends just after the name; a group's
  // faces spread to the same edges whether there are two of them or three.
  const r = (alone ? SOLO_FACE_R : FACE_R) * k;
  const step = faces.length === 2 ? 2 * FACE_R * k : FACE_R * k;
  const extra = cluster.members.length - faces.length;
  const icon = activityKind(lead);
  // Whoever is on a running task is ringed in that task's colour - the same
  // colour its lines carry in the event log and its row in MEDial's panel.
  const taskRing = cluster.members
    .map((m) => (m.onTask && m.requestId ? (taskColours?.get(m.requestId) ?? null) : null))
    .find((c) => c !== null);
  const ring = taskRing
    ? taskRing
    : cluster.members.some((m) => m.onTask)
      ? colour.primary
      : cluster.members.some((m) => m.divergesFromBaseline)
        ? colour.warn
        : null;

  return (
    <g
      data-marker={cluster.key}
      role="img"
      aria-label={`${lead.displayName} ${lead.activity}${
        cluster.members.length > 1 ? ` 외 ${cluster.members.length - 1}명` : ''
      }`}
      style={{ pointerEvents: 'none' }}
    >
      {/* A mark that had to move keeps a thread back to where these people
          really are, so the nudge cannot be read as a different location. */}
      {leader && (
        <>
          <line
            x1={anchorX}
            y1={anchorY}
            x2={x}
            y2={y}
            stroke={colour.secondary}
            strokeWidth={k}
            strokeDasharray={`${2 * k} ${2 * k}`}
          />
          <circle cx={anchorX} cy={anchorY} r={1.8 * k} fill={colour.secondary} />
        </>
      )}

      <rect x={x - (alone ? SOLO_LEFT : 28) * k} y={y - (alone ? 13 : 16) * k}
        width={(alone ? SOLO_W : 56) * k} height={(alone ? 26 : 32) * k}
        rx={(alone ? 13 : 16) * k}
        fill={taskRing ? `${taskRing}14` : '#fffffff5'}
        stroke={taskRing ?? '#d6e1d3'}
        strokeWidth={(taskRing ? 1.8 : 1.2) * k}
        style={{filter:'drop-shadow(0 1px 2px #304c3926)'}} />

      {driver && (
        <g transform={`translate(${x} ${y + (FACE_R + 16) * k}) scale(${k})`}>
          <VehicleMark
            mode={driver.mode === 'boat' ? 'boat' : 'drive'}
            occupied={1 + driver.riders.length}
            seats={seats}
          />
        </g>
      )}

      {/* Up to three faces, stacked; the rest become a count. */}
      {faces
        .map((member, i) => (
          <g key={member.id} transform={`translate(${x + (i - (faces.length - 1) / 2) * step} ${y})`}>
            <FaceMark
              id={member.id}
              r={r}
              isVillageHead={member.isVillageHead}
              ring={i === faces.length - 1 ? ring : null}
            />
          </g>
        ))
        .reverse()}

      {extra > 0 && (
        <>
          <circle
            cx={x + (faces.length / 2) * step + 3 * k}
            cy={y - r * 0.6}
            r={7.5 * k}
            fill={colour.text}
          />
          <text
            x={x + (faces.length / 2) * step + 3 * k}
            y={y - r * 0.6 + 3.6 * k}
            fontSize={9 * k}
            textAnchor="middle"
            fill="#ffffff"
            style={{ pointerEvents: 'none' }}
          >
            +{extra}
          </text>
        </>
      )}

      {icon && (
        <g transform={`translate(${x + r * (alone ? 0.85 : 1.05)} ${
          y - (alone ? r + 2 * k : r * 0.9)
        }) scale(${k})`}>
          <circle cx={0} cy={0} r={7} fill="#ffffff" stroke={colour.border} />
          <ActivityIcon kind={icon} />
        </g>
      )}

      {alone && <text
        x={x + (SOLO_FACE_R + 4) * k} y={y + 3.5*k} fontSize={10*k}
        textAnchor="start" fill="#496054"
        fontWeight={500}
        style={{pointerEvents:'none'}}>
        {lead.isVillageHead ? '이장' : lead.id}
      </text>}

      {medial && (
        <PillText x={x} y={y - r - 6 * k} anchor="middle" size={10 * k} weight={600}
          fill={colour.secondary} plate="rgba(255, 255, 255, 0.86)" text="보고받은 위치" />
      )}
    </g>
  );
}
