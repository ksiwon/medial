import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { api } from '../api/client';
import type { Reservation, VillagePayload } from '../api/types';
import {
  clusterPoses,
  medialPoses,
  placeLabel,
  spreadOverlaps,
  type ActorPose,
  type Cluster,
  type MedialKnown,
} from '../positions';
import { personName } from '../selectors/story';
import { colour, font, radius } from '../ui/theme';
import { ActivityIcon, FaceChip, FaceMark, VehicleMark } from './Marks';

// The real map of 은점마을: the source raster, north up, flat, at the source's
// own proportions. Nothing here invents terrain, and nothing stretches the
// 1.15 km north-south strip sideways. Default cover crops to fill the column;
// All explicitly fits the whole village, preserving geographic proportions.
//
// Three rules from doc 15 section 5 shape the drawing:
//
//  - the raster already carries the road network and the street names, so this
//    layer does not draw them again. Roads appear only as the highlighted route
//    of the request being read;
//  - marker sizes are screen pixels, not map units. At full extent one SVG unit
//    is about a quarter of a pixel, so a face specified in map units is two
//    pixels wide;
//  - who is grouped with whom is decided by place and vehicle in positions.ts.
//    This file only stops marks from covering each other, and draws a leader
//    line whenever it had to move one.

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

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

const Frame = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  background: #f8f7f4;
  border-bottom: 1px solid ${colour.border};
  overflow: hidden;
  touch-action: none;
`;

const Svg = styled.svg`
  width: 100%;
  height: 100%;
  display: block;
`;

const Corner = styled.div`
  position: absolute;
  display: flex;
  align-items: center;
  gap: 4px;
`;

const Tools = styled(Corner)`
  right: 12px;
  bottom: 34px;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid ${colour.border};
  border-radius: ${radius.control};
  padding: 3px;
`;

const ToolButton = styled.button`
  border: none;
  background: transparent;
  color: ${colour.text};
  font-family: inherit;
  font-size: ${font.small};
  min-width: 28px;
  height: 32px;
  padding: 0 7px;
  border-radius: 4px;
  cursor: pointer;
  &:hover {
    background: ${colour.selected};
  }
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: -1px;
  }
`;

const Compass = styled.div`
  position: absolute;
  right: 14px;
  top: 10px;
  font-size: ${font.small};
  color: ${colour.secondary};
  text-align: center;
  pointer-events: none;
  line-height: 1.2;
`;

const ModeBadge = styled.div`
  position: absolute;
  left: 12px;
  top: 10px;
  background: ${colour.surface};
  border: 1px solid ${colour.border};
  color: ${colour.secondary};
  border-radius: 999px;
  padding: 3px 10px;
  font-size: ${font.small};
  pointer-events: none;
`;

/** Required source credit. Small type is allowed here and only here. */
const Credit = styled.div`
  position: absolute;
  left: 12px;
  bottom: 12px;
  font-size: ${font.micro};
  color: ${colour.secondary};
  background: rgba(255, 255, 255, 0.86);
  border-radius: 4px;
  padding: 1px 6px;
  pointer-events: none;
`;

/* Flips above/below and clamps to the frame, with 16 px of clearance so it
   never covers the marker it belongs to. */
const Popover = styled.div<{ $left: number; $top: number; $below: boolean }>`
  position: absolute;
  left: ${(p) => p.$left}px;
  top: ${(p) => p.$top}px;

  width: 250px;
  max-width: calc(100% - 16px);
  background: ${colour.surface};
  border: 1px solid ${colour.border};
  border-radius: ${radius.panel};
  box-shadow: 0 4px 14px rgba(29, 41, 53, 0.14);
  z-index: 5;
  overflow: hidden;
`;

/** The people in this group, as a single horizontal strip. Long groups scroll
 *  sideways inside the card rather than turning it into twelve profiles. */
const PopPeople = styled.div`
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 8px 34px 8px 10px;
  border-bottom: 1px solid ${colour.border};
`;

const PersonPick = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  border: 1px solid ${(p) => (p.$active ? colour.primary : 'transparent')};
  background: ${(p) => (p.$active ? colour.selected : 'transparent')};
  border-radius: ${radius.control};
  padding: 4px 6px;
  cursor: pointer;
  font-size: ${font.small};
  color: ${colour.text};
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: 1px;
  }
`;

const PopBody = styled.div`
  padding: 8px 12px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: ${font.small};
  line-height: 1.5;
  color: ${colour.text};
`;

const Quote = styled.div`
  margin-top: 6px;
  padding-left: 8px;
  border-left: 2px solid ${colour.border};
  font-size: ${font.small};
  color: ${colour.secondary};
`;

const MoreButton = styled.button`
  margin: 0;
  flex: none;
  white-space: nowrap;
  border: 1px solid ${colour.border};
  background: ${colour.surface};
  border-radius: ${radius.control};
  min-height: 26px;
  padding: 2px 6px;
  font-family: inherit;
  font-size: ${font.small};
  cursor: pointer;
  color: ${colour.text};
  &:hover {
    border-color: ${colour.primary};
  }
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: 1px;
  }
`;

/** Everyone who has no coordinate on this map, as one folded list under it. */
const Outside = styled.details`
  flex: none;
  border-bottom: 1px solid ${colour.border};
  font-size: ${font.small};
  color: ${colour.secondary};
  > summary {
    cursor: pointer;
    list-style: none;
    padding: 10px 16px;
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  > summary::-webkit-details-marker {
    display: none;
  }
  > summary::before {
    content: '▸';
    color: ${colour.primary};
  }
  &[open] > summary::before {
    content: '▾';
  }
  > :not(summary) {
    padding: 0 16px 12px;
  }
`;

const OutRow = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: none;
  border-top: 1px solid ${colour.border};
  background: none;
  padding: 8px 0;
  font-family: inherit;
  font-size: ${font.small};
  color: ${colour.text};
  cursor: pointer;
  &:hover {
    color: ${colour.primary};
  }
  &:focus-visible {
    outline: 2px solid ${colour.primary};
  }
`;

/** Place names worth a label at all. Houses are never labelled: which named
 *  resident lives in which building is not put on screen. */
const LABELLED_PLACES = new Set(['HALL', 'PORT', 'EXP', 'FOOD', 'MIGA', 'FARM', 'TOWNEXIT', 'SEA']);
/** …and at low zoom, only these few. */
const ALWAYS_LABELLED = new Set(['HALL', 'PORT', 'TOWNEXIT']);

export interface MapHighlight {
  /** People involved in the request being read. Everyone else stays quiet. */
  actorIds: Set<string>;
  /** The route(s) of that request, in map coordinates. */
  routes: [number, number][][];
}

interface Props {
  village: VillagePayload;
  poses: ActorPose[];
  viewMode: 'researcher' | 'medial';
  medialKnown: Map<string, MedialKnown>;
  reservations: Reservation[];
  seatsPerVehicle: number;
  highlight: MapHighlight | null;
  selectedCluster: string | null;
  selectedActor: string | null;
  /** One short line from the current scene for the selected person, or null.
   *  Never invented: the observe screen passes an actual event's words. */
  quoteFor: (actorId: string) => string | null;
  onSelectCluster: (key: string | null, actorId?: string | null) => void;
  onOpenDetail: (actorId: string) => void;
}

export default function VillageMap({
  village,
  poses,
  viewMode,
  medialKnown,
  reservations,
  seatsPerVehicle,
  highlight,
  selectedCluster,
  selectedActor,
  quoteFor,
  onSelectCluster,
  onOpenDetail,
}: Props) {
  const [vx, vy, vw, vh] = village.geometry.viewBox;
  const home: View = useMemo(() => ({ x: vx, y: vy, w: vw, h: vh }), [vx, vy, vw, vh]);
  const [view, setView] = useState<View>(home);
  const [fitMode, setFitMode] = useState<'fill' | 'all' | null>('fill');
  const [box, setBox] = useState({ width: 1, height: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  /** The card Escape just closed. The marker keeps focus and often the pointer
   *  too, and both of those open a card, so without this the card reopens in
   *  the same tick and Escape appears to do nothing. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [mapBroken, setMapBroken] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [popSize, setPopSize] = useState({ width: 250, height: 138 });
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ px: number; py: number; view: View } | null>(null);

  useEffect(() => { setMapBroken(false); setFitMode('fill'); }, [home]);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Cover the map column without deforming geography; All is an explicit fit.
  const fillView = useMemo(() => {
    const raster = village.mapImage;
    const m = raster?.northUpMatrix;
    const corners = raster && m ? [[0,0],[raster.sourceWidthPx,0],[0,raster.sourceHeightPx],[raster.sourceWidthPx,raster.sourceHeightPx]]
      .map(([x,y]) => [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]]) : null;
    const x = corners ? Math.min(...corners.map(p => p[0])) : home.x;
    const y = corners ? Math.min(...corners.map(p => p[1])) : home.y;
    const w = corners ? Math.max(...corners.map(p => p[0])) - x : home.w;
    const h = corners ? Math.max(...corners.map(p => p[1])) - y : home.h;
    const scale = Math.max(box.width / w, box.height / h);
    const width = box.width / scale, height = box.height / scale;
    return { x: x + (w-width)/2, y: y + (h-height)/2, w: width, h: height };
  }, [home, village.mapImage, box]);
  useEffect(() => {
    if (box.width > 1 && box.height > 1 && fitMode) setView(fitMode === 'fill' ? fillView : home);
  }, [fillView, home, box, fitMode]);

  const project = useMemo(() => projector(view, box), [view, box]);

  const onWheel = useCallback(
    (event: WheelEvent) => {
      if ((event.target as Element).closest('[data-overlay]')) return;
      event.preventDefault();
      setFitMode(null);
      const node = frameRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const anchor = project.toSvg(event.clientX - rect.left, event.clientY - rect.top);
      const factor = Math.exp(Math.max(-120, Math.min(120, event.deltaY)) * 0.0015);
      setView((current) => {
        const w = Math.min(home.w * 1.2, Math.max(home.w / 24, current.w * factor));
        const ratio = w / current.w;
        return {
          w,
          h: current.h * ratio,
          x: anchor.x - (anchor.x - current.x) * ratio,
          y: anchor.y - (anchor.y - current.y) * ratio,
        };
      });
    },
    [home.w, project],
  );

  useEffect(() => {
    const node = frameRef.current;
    node?.addEventListener('wheel', onWheel, { passive: false });
    return () => node?.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const onPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('g[data-marker]')) return;
    // Panning captures the pointer on the frame, and a captured pointer
    // retargets the click that follows: pressing a button that sits *inside*
    // the frame - the popover's 더 알아보기, the zoom controls - never
    // produced a click at all. Overlays opt out of the drag entirely.
    if ((event.target as HTMLElement).closest('[data-overlay]')) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovered(null); onSelectCluster(null, null);
    setFitMode(null);
    drag.current = { px: event.clientX, py: event.clientY, view };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const start = drag.current;
    if (!start) return;
    const dx = (event.clientX - start.px) / project.scale;
    const dy = (event.clientY - start.py) / project.scale;
    setView({ ...start.view, x: start.view.x - dx, y: start.view.y - dy });
  };

  const endDrag = () => {
    drag.current = null;
  };

  const medial = viewMode === 'medial';
  const projected = useMemo(
    () => (medial ? medialPoses(medialKnown, village, poses) : null),
    [medial, medialKnown, village, poses],
  );
  const shown = projected ? projected.located : poses;
  const clusters = useMemo(() => clusterPoses(shown), [shown]);
  const outside = shown.filter((p) => p.offMap);

  // Where each group's mark is actually drawn, after nudging overlapping ones
  // apart. The anchor itself never moves; a nudged mark keeps a leader line.
  const layout = useMemo(() => {
    const marks = clusters.map((cluster) => {
      const point = project.toScreen(cluster.x, cluster.y);
      return { key: cluster.key, left: point.left, top: point.top };
    });
    return spreadOverlaps(marks, FACE_D + 22);
  }, [clusters, project]);

  const anchors = useMemo(() => {
    const out = new Map<string, { left: number; top: number }>();
    for (const cluster of clusters) out.set(cluster.key, project.toScreen(cluster.x, cluster.y));
    return out;
  }, [clusters, project]);

  // Hover and keyboard focus open the same card a click does. Only one is ever
  // open, and a pinned one wins over a hover elsewhere.
  const openKey = selectedCluster ?? hovered;
  const active =
    openKey && openKey !== dismissed ? (clusters.find((c) => c.key === openKey) ?? null) : null;
  const activeAt = active ? (layout.get(active.key) ?? anchors.get(active.key)!) : null;
  const below = activeAt ? activeAt.top < popSize.height + 24 : false;
  const clampedLeft = activeAt
    ? Math.max(8, Math.min(activeAt.left - popSize.width / 2, box.width - popSize.width - 8)) : 0;
  const popTop = activeAt ? Math.max(8, Math.min(
    below ? activeAt.top + 26 : activeAt.top - popSize.height - 26,
    box.height - popSize.height - 8)) : 0;
  useEffect(() => {
    const node = popRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setPopSize({width: node.offsetWidth, height: node.offsetHeight}));
    observer.observe(node);
    return () => observer.disconnect();
  }, [active?.key]);

  /** Leaving a marker, or moving to another one, forgets an Escape: the key
   *  hides the card that is open, it does not make a marker permanently mute. */
  const onHover = (key: string | null) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (key === null) {
      hoverTimer.current = setTimeout(() => setHovered(null), 260);
      return;
    }
    setHovered(key);
    // Functional, because Escape focuses the marker in the same batch: the
    // focus handler lands here while `dismissed` still reads as its old value,
    // and a plain read would immediately undo the dismissal it just caused.
    setDismissed((current) => (key !== null && key === current ? current : null));
  };

  // Escape closes whichever card is open, and the open one is usually *not* the
  // pinned one: the card itself says 누르면 고정, so hovering is the common way
  // to see it. Keying this on `selectedCluster` meant Escape did nothing at all
  // for a hover-opened card, including one the pointer had moved into.
  useEffect(() => {
    if (!openKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      setDismissed(openKey);
      if (selectedCluster) onSelectCluster(null, null);
      // Focus goes back to the marker the card belonged to, not to the body.
      frameRef.current
        ?.querySelector<SVGGElement>(`g[data-marker="${CSS.escape(openKey)}"]`)
        ?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openKey, selectedCluster, onSelectCluster]);

  const mapImage = village.mapImage;
  const hasRaster = Boolean(mapImage) && !mapBroken;
  /** SVG units per screen pixel. */
  const k = 1 / (project.scale || 1);
  const zoomedIn = view.w < home.w * 0.55;

  const selectedMember =
    active?.members.find((m) => m.id === selectedActor) ?? active?.members[0] ?? null;
  const quote = selectedMember ? quoteFor(selectedMember.id) : null;

  return (
    <>
      <Frame
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <Svg
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <rect x={vx - vw} y={vy - vh} width={vw * 3} height={vh * 3} fill="#f8f7f4" />

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
              transform={`matrix(${mapImage!.northUpMatrix.join(' ')})`}
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
                points={points.map((p) => `${p[0]},${p[1]}`).join(' ')}
                fill="none"
                stroke="#d9dee3"
                strokeWidth={Math.max(3.2, 1.4 * k)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

          {/* The route of the request being read, and nothing else. The full
              road graph and every actor's path stay hidden by default. */}
          {highlight?.routes.map((route, index) => (
            <polyline
              key={`route-${index}`}
              points={route.map((p) => `${p[0]},${p[1]}`).join(' ')}
              fill="none"
              stroke={colour.primary}
              strokeOpacity={0.75}
              strokeWidth={3 * k}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Confirmed residences, at the source coordinates, kept quiet: a
              small outline, no label, no cartoon roof. */}
          {Object.entries(village.homes).map(([id, h]) => (
            <rect
              key={id}
              x={h.x - 3 * k}
              y={h.y - 3 * k}
              width={6 * k}
              height={6 * k}
              rx={1.2 * k}
              fill="#ffffff"
              stroke="#9aa5b0"
              strokeWidth={1.1 * k}
              style={{ pointerEvents: 'none' }}
            />
          ))}

          {Object.values(village.places)
            .filter((place) => !place.offMap)
            .map((place) => {
              const label =
                LABELLED_PLACES.has(place.id) &&
                (zoomedIn || ALWAYS_LABELLED.has(place.id) || isInHighlight(place.id, highlight));
              return (
                <g key={place.id} style={{ pointerEvents: 'none' }}>
                  <circle
                    cx={place.x}
                    cy={place.y}
                    r={3.6 * k}
                    fill={colour.surface}
                    stroke={colour.secondary}
                    strokeWidth={1.4 * k}
                  />
                  {label && (
                    <text
                      x={place.x + 7 * k}
                      y={place.y + 3.6 * k}
                      fontSize={10 * k}
                      fill={colour.text}
                      stroke="#ffffff"
                      strokeWidth={2.6 * k}
                      paintOrder="stroke"
                    >
                      {place.label}
                    </text>
                  )}
                </g>
              );
            })}

          {clusters.map((cluster) => {
            const at = layout.get(cluster.key);
            const anchor = anchors.get(cluster.key);
            if (!at || !anchor) return null;
            const drawn = project.toSvg(at.left, at.top);
            const dim =
              highlight != null && !cluster.members.some((m) => highlight.actorIds.has(m.id));
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
                dim={dim}
                selected={cluster.key === selectedCluster}
                hovered={cluster.key === hovered}
                onSelect={() =>
                  onSelectCluster(
                    cluster.key === selectedCluster ? null : cluster.key,
                    cluster.members[0]?.id ?? null,
                  )
                }
                onHover={onHover}
              />
            );
          })}
        </Svg>

        {medial && <ModeBadge>MEDial이 보고받은 위치만 표시 중</ModeBadge>}

        <Compass>
          <div style={{ fontSize: 14, lineHeight: 1 }}>▲</div>
          <div>북</div>
        </Compass>

        <Credit>
          {hasRaster
            ? '지도 © OpenStreetMap 기여자 · 원자료 시뮬레이터에서 추출'
            : '지도 이미지 없음 · 원자료 좌표만 표시'}
        </Credit>

        <Tools data-overlay>
          <ToolButton onClick={() => { setFitMode(null); setView((v) => zoomBy(v, 1 / 1.2, home)); }} title="확대">
            ＋
          </ToolButton>
          <ToolButton onClick={() => { setFitMode(null); setView((v) => zoomBy(v, 1.2, home)); }} title="축소">
            －
          </ToolButton>
          <ToolButton onClick={() => setFitMode(fitMode === 'all' ? 'fill' : 'all')}
            title={fitMode === 'all' ? '지도 칸 채우기' : '마을 전체 보기'}>{fitMode === 'all' ? '채움' : '전체'}</ToolButton>
        </Tools>

        {active && activeAt && (
          <Popover
            ref={popRef}
            data-overlay
            $left={clampedLeft}
            $top={popTop}
            $below={below}
            role="dialog"
            aria-label={`${placeName(active, village)} · ${active.members.length}명`}
            onMouseEnter={() => onHover(active.key)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(active.key)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onHover(null); }}
          >
            <ToolButton aria-label="팝오버 닫기"
              style={{position:'absolute',right:8,top:10,height:24,minWidth:20,padding:0}}
              onClick={() => { setDismissed(active.key); onSelectCluster(null, null); setHovered(null); }}>×</ToolButton>
            {active.members.length > 0 && (
              <PopPeople>
                {active.members.map((member) => (
                  <PersonPick
                    key={member.id}
                    $active={member.id === selectedMember?.id}
                    aria-pressed={member.id === selectedMember?.id}
                    onClick={() => onSelectCluster(active.key, member.id)}
                  >
                    <FaceChip id={member.id} size={26} isVillageHead={member.isVillageHead} />
                    {member.isVillageHead ? '이장' : member.id}
                  </PersonPick>
                ))}
              </PopPeople>
            )}

            {selectedMember && (
              <PopBody>
                <span>{selectedMember.activity}
                  {selectedMember.ridingWith && ' · 차량 동승'}
                  {quote && <Quote>“{quote}”</Quote>}
                </span>
                <MoreButton onClick={() => { onOpenDetail(selectedMember.id); setDismissed(active.key); onSelectCluster(null, null); }}>더 알아보기 ↗</MoreButton>
              </PopBody>
            )}
          </Popover>
        )}
      </Frame>

      <Outside>
        <summary>
          <span>마을 밖 · {outside.length}명</span>
          <span>
            {outside.length === 0
              ? '이 시각에 마을을 벗어난 사람 없음'
              : outside
                  .map(
                    (p) =>
                      `${personName(p.id)} · ${placeLabel(village, p.place, p.id) ?? '마을 밖'}`,
                  )
                  .join(' / ')}
          </span>
        </summary>
        <div>
          {outside.map((pose) => (
            <OutRow key={pose.id} onClick={() => onOpenDetail(pose.id)}>
              <FaceChip id={pose.id} size={22} isVillageHead={pose.isVillageHead} />
              <span style={{ flex: 1 }}>
                <strong>{personName(pose.id)}</strong> ·{' '}
                {placeLabel(village, pose.place, pose.id) ?? '마을 밖'}
              </span>
              <span style={{ color: colour.secondary }}>{pose.activity}</span>
            </OutRow>
          ))}

          {projected && (
            <>
              <OutRow as="div" style={{ cursor: 'default' }}>
                <span style={{ flex: 1 }}>
                  MEDial이 위치를 모르는 사람 {projected.unlocated.length}명 —{' '}
                  {projected.unlocated.map(({ pose }) => pose.displayName).join(', ') || '없음'}
                </span>
              </OutRow>
              <div style={{ paddingTop: 6 }}>
                이 목록이 대부분인 것이 정상입니다. MEDial은 보고받은 것 외에는 위치를 알지
                못합니다.
              </div>
            </>
          )}

          {reservations.length > 0 && (
            <OutRow as="div" style={{ cursor: 'default', display: 'block' }}>
              <strong>진행 중인 동승 {reservations.length}건</strong>
              {reservations.map((r) => (
                <div key={r.id} style={{ marginTop: 2 }}>
                  {r.driverId}의 차 · {r.riderId} 좌석 {r.seatIndex + 1} · {r.pickupPlace} →{' '}
                  {r.destination} ({r.status})
                </div>
              ))}
            </OutRow>
          )}

          <div style={{ paddingTop: 8, color: colour.secondary }}>
            마을 밖 위치는 이 지도에 좌표가 없어 목록으로만 표시합니다. 지도 여백에 임의로 놓지
            않습니다.
          </div>
        </div>
      </Outside>
    </>
  );
}

function isInHighlight(placeId: string, highlight: MapHighlight | null): boolean {
  return highlight != null && highlight.actorIds.has(placeId);
}

function placeName(cluster: Cluster, village: VillagePayload): string {
  if (cluster.reason === 'vehicle') return '이동 중인 차 안';
  if (!cluster.placeId) return '이동 중';
  return placeLabel(village, cluster.placeId) ?? '이동 중';
}

function zoomBy(view: View, factor: number, home: View): View {
  const w = Math.min(home.w * 1.2, Math.max(home.w / 24, view.w * factor));
  const ratio = w / view.w;
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  const h = view.h * ratio;
  return { w, h, x: cx - w / 2, y: cy - h / 2 };
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
  dim,
  selected,
  hovered,
  onSelect,
  onHover,
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
  dim: boolean;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHover: (key: string | null) => void;
}) {
  const lead = cluster.members[0];
  const driver = cluster.members.find((m) => m.mode === 'drive' || m.mode === 'boat');
  const r = FACE_R * k;
  const faces = cluster.members.slice(0, 3);
  const extra = cluster.members.length - faces.length;
  const icon = activityKind(lead);
  const ring = cluster.members.some((m) => m.onTask)
    ? colour.primary
    : cluster.members.some((m) => m.divergesFromBaseline)
      ? colour.warn
      : null;

  return (
    <g
      data-marker={cluster.key}
      tabIndex={0}
      role="button"
      aria-label={`${lead.displayName} ${lead.activity}${
        cluster.members.length > 1 ? ` 외 ${cluster.members.length - 1}명` : ''
      }`}
      style={{ cursor: 'pointer', outline: 'none', opacity: dim && !selected && !hovered ? 0.85 : 1 }}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => onHover(cluster.key)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(cluster.key)}
      onBlur={() => onHover(null)}
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

      <rect x={x - (faces.length > 1 ? 28 : 16) * k} y={y - 16*k}
        width={(faces.length > 1 ? 56 : 53)*k} height={32*k} rx={16*k}
        fill={selected || hovered ? '#edf5ec' : '#fffffff5'}
        stroke={selected || hovered ? '#8eaf98' : '#d6e1d3'} strokeWidth={1.2*k}
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
          <g key={member.id} transform={`translate(${x + (i - (faces.length - 1) / 2) * r} ${y})`}>
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
            cx={x + (faces.length / 2) * r + 3 * k}
            cy={y - r * 0.6}
            r={7.5 * k}
            fill={colour.text}
          />
          <text
            x={x + (faces.length / 2) * r + 3 * k}
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
        <g transform={`translate(${x + r * 1.05} ${y - r * 0.9}) scale(${k})`}>
          <circle cx={0} cy={0} r={7} fill="#ffffff" stroke={colour.border} />
          <ActivityIcon kind={icon} />
        </g>
      )}

      {cluster.members.length === 1 && <text
        x={x + 17*k} y={y + 3.5*k} fontSize={10*k}
        textAnchor="start" fill="#496054"
        fontWeight={selected || hovered ? 650 : 500}
        style={{pointerEvents:'none'}}>
        {lead.isVillageHead ? '이장' : lead.id}
      </text>}

      {medial && (
        <text
          x={x}
          y={y - r - 6 * k}
          fontSize={10 * k}
          textAnchor="middle"
          fill={colour.secondary}
          stroke="#ffffff"
          strokeWidth={2.4 * k}
          paintOrder="stroke"
          style={{ pointerEvents: 'none' }}
        >
          보고받은 위치
        </text>
      )}
    </g>
  );
}
