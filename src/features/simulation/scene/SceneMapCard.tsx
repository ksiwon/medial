import styled from 'styled-components';
import { api } from '../api/client';
import type { VillagePayload } from '../api/types';
import { mapFrame } from '../mapFrame';
import { placeXY, type ActorPose } from '../positions';
import type { Frame } from './types';

// The map, shrunk to a card while a scene plays: the village and a pin on each
// place the scene shows, the speaking one in orange. No people - they are in
// the frames. A place the map has no coordinate for (town, the health centre,
// out at sea) is a chip on the card, never a pin guessed onto its margin.

const Card = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  background: #f8f7f4;
  > svg { position: absolute; inset: 0; width: 100%; height: 100%; }
`;

const Dot = styled.i`
  position: absolute;
  width: 7px;
  height: 7px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  background: #ffffff;
  border: 1.5px solid #596775;
`;

/** A place the scene shows: a pin whose point is on the place, and its name. */
const Pin = styled.div`
  position: absolute;
  width: 0;
  height: 0;
  > svg { position: absolute; left: -9px; top: -26px; width: 18px; height: 27px; overflow: visible; }
  > svg path { fill: #15150f; stroke: #ffffff; }
  &[data-hot] > svg path { fill: #e2542c; }
  > b {
    position: absolute;
    left: 11px;
    top: -26px;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 800;
    color: #15150f;
    text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff;
  }
  &[data-flip] > b { left: auto; right: 11px; }
`;

const Chips = styled.div`
  position: absolute;
  left: 8px;
  bottom: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  > span { font-size: 10.5px; font-weight: 800; color: #fff; background: #15150f; border-radius: 999px; padding: 2px 8px; }
  > span[data-hot] { background: #e2542c; }
`;

/** Where a frame is on the map, or null when it is not on it. */
function pointOf(frame: Frame, village: VillagePayload, poses: ActorPose[]): [number, number] | null {
  const place = frame.place;
  if (!place) return null;
  if (place.startsWith('CAR:') || place === 'ROAD') {
    const who = poses.find((p) => p.id === (place.startsWith('CAR:') ? place.slice(4) : frame.who[0]));
    return who && !who.offMap ? [who.x, who.y] : null;
  }
  if (village.places[place]?.offMap) return null;
  // A route (the head's patrol) has no point of its own: it is where the
  // person walking it is.
  const xy = placeXY(village, place);
  if (xy) return xy;
  const who = poses.find((p) => p.id === frame.who[0]);
  return who && !who.offMap ? [who.x, who.y] : null;
}

export default function SceneMapCard({ village, frames, hot, poses }: {
  village: VillagePayload;
  frames: Frame[];
  /** Index of the frame whose person is speaking, or -1. */
  hot: number;
  poses: ActorPose[];
}) {
  const turn = mapFrame(village);
  const [vx, vy, vw, vh] = turn.viewBox;
  const raster = village.mapImage;
  // Pins are drawn over the picture in screen pixels, placed by percent: the
  // card grows out of the full map and back (0.8 s), and a pin sized in map
  // units went from 2 px on the card to half the screen while it moved.
  const pct = (x: number, y: number) => ({ left: `${((x - vx) / vw) * 100}%`, top: `${((y - vy) / vh) * 100}%` });
  const pins = frames.map((frame, i) => {
    const at = pointOf(frame, village, poses);
    return { frame, i, at: at ? turn.at(at[0], at[1]) : null };
  });
  return (
    <Card>
      <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="none" aria-hidden>
        {raster && (
          <image href={api.mapImageUrl()} x={0} y={0} width={raster.sourceWidthPx} height={raster.sourceHeightPx}
            preserveAspectRatio="none"
            style={{ filter: 'saturate(0.9)' }} />
        )}
      </svg>
      {Object.values(village.places).filter((p) => !p.offMap).map((p) => (
        <Dot key={p.id} style={pct(...turn.at(p.x, p.y))} />
      ))}
      {pins.filter((p) => p.at).map(({ frame, i, at }) => {
        const [x, y] = at!;
        const flip = x > vx + vw * 0.7;
        return (
          <Pin key={frame.key} style={pct(x, y)} data-hot={i === hot ? '' : undefined} data-flip={flip ? '' : undefined}>
            <svg viewBox="-8 -23 16 24" aria-hidden>
              <path d="M0 0 C -6 -8 -7 -12 -7 -15 A 7 7 0 1 1 7 -15 C 7 -12 6 -8 0 0Z" strokeWidth={1.6} />
            </svg>
            <b>{frame.label}</b>
          </Pin>
        );
      })}
      <Chips>
        {pins.filter((p) => !p.at).map(({ frame, i }) => (
          <span key={frame.key} data-hot={i === hot ? '' : undefined}>{frame.label} · 지도 밖</span>
        ))}
      </Chips>
    </Card>
  );
}
