import styled from 'styled-components';
import { api } from '../api/client';
import type { VillagePayload } from '../api/types';
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
  return placeXY(village, place);
}

export default function SceneMapCard({ village, frames, hot, poses }: {
  village: VillagePayload;
  frames: Frame[];
  /** Index of the frame whose person is speaking, or -1. */
  hot: number;
  poses: ActorPose[];
}) {
  const [vx, vy, vw, vh] = village.geometry.viewBox;
  const unit = vw / 90;
  const raster = village.mapImage;
  const pins = frames.map((frame, i) => ({ frame, i, at: pointOf(frame, village, poses) }));
  return (
    <Card>
      <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        {raster && (
          <image href={api.mapImageUrl()} x={0} y={0} width={raster.sourceWidthPx} height={raster.sourceHeightPx}
            transform={`matrix(${raster.northUpMatrix.join(' ')})`} preserveAspectRatio="none"
            style={{ filter: 'saturate(0.9)' }} />
        )}
        {Object.values(village.places).filter((p) => !p.offMap).map((p) => (
          <circle key={p.id} cx={p.x} cy={p.y} r={unit * 0.35} fill="#fff" stroke="#596775" strokeWidth={unit * 0.12} />
        ))}
        {pins.filter((p) => p.at).map(({ frame, i, at }) => {
          const [x, y] = at!;
          const tint = i === hot ? '#e2542c' : '#15150f';
          const flip = x > vx + vw * 0.8;
          return (
            <g key={frame.key}>
              <circle cx={x} cy={y} r={unit * 1.4} fill={tint} opacity={0.18} />
              <path transform={`translate(${x} ${y}) scale(${unit / 7})`}
                d="M0 0 C -6 -8 -7 -12 -7 -15 A 7 7 0 1 1 7 -15 C 7 -12 6 -8 0 0Z" fill={tint} stroke="#fff" strokeWidth={1.6} />
              <text x={flip ? x - unit * 1.4 : x + unit * 1.4} y={y - unit * 1.4} fontSize={unit * 1.6} fontWeight={800}
                textAnchor={flip ? 'end' : 'start'} fill="#15150f" stroke="#fff" strokeWidth={unit * 0.4} paintOrder="stroke">
                {frame.label}
              </text>
            </g>
          );
        })}
      </svg>
      <Chips>
        {pins.filter((p) => !p.at).map(({ frame, i }) => (
          <span key={frame.key} data-hot={i === hot ? '' : undefined}>{frame.label} · 지도 밖</span>
        ))}
      </Chips>
    </Card>
  );
}
