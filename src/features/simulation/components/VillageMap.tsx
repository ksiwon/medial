import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ActivityIcon, FaceChip, FaceMark, VehicleMark } from './Marks';
import PillText, { plateSize } from '../ui/PillText';
import { pill } from '../ui/primitives';

// The real map of 은점마을: the source raster turned upright - north at the top,
// the 1.15 km north-south run standing in a tall column (mapFrame.ts) - flat,
// at the source's own proportions. Nothing here invents terrain or stretches it.
// The map always fills the column's width (2026-10-07: a column narrower than the
// village's proportions used to leave a blank strip at the side); the village's
// north and south run above and below. Zooming leaves that view and 전체 comes back.
// While a scene plays, the places it is filmed in are marked on the map (spotlight),
// so the stage and the village are read as one.
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

const SPOT = '#e2542c';

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
  bottom: 30px;
  flex-direction: row;
  background: rgba(18, 19, 16, 0.82);
  border-radius: 999px;
  padding: 3px 6px;
`;

const ToolButton = styled.button`
  ${pill('md')}
  border: none;
  background: transparent;
  color: ${night.ink};
  font-family: inherit;
  font-weight: 700;
  cursor: pointer;
  &:hover {
    background: rgba(246, 241, 232, 0.14);
  }
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: -1px;
  }
`;

const Compass = styled.div`
  position: absolute;
  right: 12px;
  top: 10px;
  box-sizing: border-box;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  font-size: 10px;
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
  top: 10px;
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
  bottom: 6px;
  max-width: 60%;
  text-align: right;
  font-size: 9px;
  line-height: 1.3;
  color: ${night.mute};
  background: rgba(18, 19, 16, 0.6);
  border-radius: 3px;
  padding: 0 4px;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  font-size: ${font.small};
  line-height: 1.5;
  color: ${colour.text};
`;

/** Who is in the chip row; who they are, where they are and what they are doing
 *  below it. This card is the person's page now - the observe screen has no
 *  person column - so it carries the registry's age, job and group too. */
const Facts = styled.dl`
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 8px;
  row-gap: 2px;
  > dt {
    color: ${colour.unknown};
    white-space: nowrap;
  }
  > dd {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

/** Everyone who has no coordinate on this map, as one row of names under it. */
/* One height whoever is out: the map above it must not jump as people leave
   and come back. Three rows of chips fit; more scroll inside. */
const Outside = styled.div`
  flex: none;
  height: 92px;
  overflow-y: auto;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  align-items: center;
  gap: 6px 8px;
  padding: 12px 14px;
  font-size: ${font.small};
  color: ${night.mute};
  > strong { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; color: ${night.faint}; margin-right: 4px; }
`;

const OutChip = styled.span`
  ${pill('sm')}
  font-weight: 700;
  color: ${night.ink};
  background: ${night.raised};
  > span { font-weight: 400; color: ${night.mute}; }
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
  selectedCluster: string | null;
  /** Colour per still-running request: the ring on whoever is doing it. */
  taskColours?: Map<string, string>;
  selectedActor: string | null;
  /** The places the stage is showing now, marked on the map. Empty between scenes. */
  spotlight?: Spot[];
  /** The column width at which the whole village fills the frame exactly, for
   *  the frame's present height: the screen sizes the column to it. */
  onFitWidth?: (px: number) => void;
  onSelectCluster: (key: string | null, actorId?: string | null) => void;
}

export default function VillageMap({
  village,
  poses,
  viewMode,
  medialKnown,
  seatsPerVehicle,
  selectedCluster,
  taskColours,
  selectedActor,
  onSelectCluster,
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
  const [view, setView] = useState<View>(home);
  // The column is as wide as the village is, at the frame's height: then the map
  // fills its frame both ways, with no strip at the side and nobody cut off the
  // top or bottom (the village runs 1.2 km north-south; at a fixed width someone
  // was always off the map).
  useEffect(() => {
    if (onFitWidth && box.height > 1) onFitWidth(Math.round(box.height * (extent.w / extent.h)));
  }, [onFitWidth, box.height, extent]);
  // Zooming leaves the fitted view; 전체 returns.
  const [fitMode, setFitMode] = useState<'all' | null>('all');
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

  useEffect(() => { setMapBroken(false); setFitMode('all'); }, [extent]);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (box.width > 1 && box.height > 1 && fitMode) setView(home);
  }, [home, box, fitMode]);

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
  // Grouped north-up, then placed where the turned map draws them.
  const clusters = useMemo(
    () => clusterPoses(shown).map((cluster) => {
      const [x, y] = frame.at(cluster.x, cluster.y);
      return { ...cluster, x, y };
    }),
    [shown, frame],
  );
  const outside = shown.filter((p) => p.offMap);

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

  // A card opened by hover closes when the pointer is no longer over its marker or
  // the card. The browser sends `mouseenter` for a marker that was drawn *under* a
  // pointer that did not move (a new day opens, markers are redrawn), but never the
  // matching `mouseleave` - so the card stayed open with the pointer far away
  // (found recording the demo, 2026-10-06). Only a hover is closed this way: a card
  // the reader pinned (clicked) stays until they close it.
  useEffect(() => {
    if (!hovered || selectedCluster) return;
    const onMove = (event: PointerEvent) => {
      if (!pointerIsOver(event.target as Element | null, hovered)) onHover(null);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered, selectedCluster]);

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

  const selectedMember =
    active?.members.find((m) => m.id === selectedActor) ?? active?.members[0] ?? null;
  const resident = (id: string) => village.residents.find((r) => r.id === id) ?? null;
  const popWhere = selectedMember
    ? selectedMember.moving
      ? '이동 중'
      : (placeLabel(village, selectedMember.place, selectedMember.id) ?? '자택')
    : '';

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
          <div style={{ fontSize: 10, lineHeight: 1, transform: `rotate(${frame.northDeg}deg)` }}>▲</div>
          <div>북</div>
        </Compass>

        <Credit>
          {hasRaster
            ? '© OpenStreetMap 기여자'
            : '지도 이미지 없음 · 원자료 좌표만 표시'}
        </Credit>

        <Tools data-overlay>
          <ToolButton onClick={() => { setFitMode(null); setView((v) => zoomBy(v, 1 / 1.2, home)); }} title="확대">
            ＋
          </ToolButton>
          <ToolButton onClick={() => { setFitMode(null); setView((v) => zoomBy(v, 1.2, home)); }} title="축소">
            －
          </ToolButton>
          <ToolButton onClick={() => setFitMode('all')} title="마을 전체 보기">전체</ToolButton>
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
                <Facts>
                  {resident(selectedMember.id) && (
                    <>
                      <dt>누구</dt>
                      <dd>{[resident(selectedMember.id)!.age != null ? `${resident(selectedMember.id)!.age}세` : null,
                            resident(selectedMember.id)!.job,
                            village.groups[resident(selectedMember.id)!.group]?.label].filter(Boolean).join(' · ')}</dd>
                    </>
                  )}
                  <dt>어디서</dt>
                  <dd>{popWhere}</dd>
                  <dt>무엇을</dt>
                  <dd>
                    {/* A stay's activity is the place's own name ("자택"), which
                        would repeat the line above. */}
                    {selectedMember.activity === popWhere ? '머무는 중' : selectedMember.activity}
                    {selectedMember.ridingWith && ' · 차량 동승'}
                  </dd>
                </Facts>
              </PopBody>
            )}
          </Popover>
        )}
      </Frame>

      {/* Who is not on the map, always in view (the exhibition wall's strip):
          a place without a coordinate is a name here, never a guessed point. */}
      <Outside aria-live="polite"
        title={outside.length > 0 ? '마을 밖은 이 지도에 좌표가 없어 목록으로만 적습니다. 지도 여백에 임의로 놓지 않습니다.' : undefined}>
        <strong>{outside.length ? '지금 마을 밖에 있는 사람' : '마을 밖에 나가 있는 사람 없음'}</strong>
        {outside.map((pose) => (
          // P-number and where: the full name made three chips a row too wide
          // for a column sized to the village, and the fourth row was hidden.
          <OutChip key={pose.id} title={personName(pose.id)}>
            {pose.id}
            <span>{pose.activity === '알 수 없음' ? (placeLabel(village, pose.place, pose.id) ?? '마을 밖') : pose.activity}</span>
          </OutChip>
        ))}
        {projected && (
          <OutChip>
            MEDial이 위치를 모르는 사람<span>{projected.unlocated.length}명</span>
          </OutChip>
        )}
      </Outside>
    </>
  );
}

/** Is the pointer on the marker `key`, or on an overlay (its card, the zoom tools)? */
export function pointerIsOver(target: Element | null, key: string): boolean {
  return Boolean(target?.closest?.(`[data-marker="${CSS.escape(key)}"], [data-overlay]`));
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
  taskColours,
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
  taskColours?: Map<string, string>;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHover: (key: string | null) => void;
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
      tabIndex={0}
      role="button"
      aria-label={`${lead.displayName} ${lead.activity}${
        cluster.members.length > 1 ? ` 외 ${cluster.members.length - 1}명` : ''
      }`}
      style={{ cursor: 'pointer', outline: 'none' }}
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

      <rect x={x - (alone ? SOLO_LEFT : 28) * k} y={y - (alone ? 13 : 16) * k}
        width={(alone ? SOLO_W : 56) * k} height={(alone ? 26 : 32) * k}
        rx={(alone ? 13 : 16) * k}
        fill={taskRing ? `${taskRing}14` : selected || hovered ? '#edf5ec' : '#fffffff5'}
        stroke={taskRing ?? (selected || hovered ? '#8eaf98' : '#d6e1d3')}
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
        fontWeight={selected || hovered ? 650 : 500}
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
