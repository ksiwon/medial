import { api } from '../api/client';
import { FaceMark } from '../components/Marks';
import type { Fit } from './art';

// One person in a frame: their picture when one was drawn, otherwise the same
// schematic face the map uses on a plain body. The schematic figure is the
// honest fallback - it says "someone is here" without drawing a likeness nobody
// made. The picture's box is the same either way, so a frame lays out alike.

const BOX: Record<Fit, { w: number; h: number }> = {
  tall: { w: 2, h: 3 }, work: { w: 2, h: 3 }, seat: { w: 1, h: 1 }, wide: { w: 3, h: 2 },
};

export function Figure({ picture, actorId, fit, isVillageHead }: {
  picture: string | null;
  actorId: string;
  fit: Fit;
  isVillageHead: boolean;
}) {
  // Sized by the frame (SceneStage's Person box); the picture only fills it.
  if (picture) return <img src={api.artUrl(picture)} alt="" draggable={false} />;
  const { w, h } = BOX[fit];
  const shirt = ['#557f79', '#7b7895', '#b38b57', '#63819b'][(Number(actorId.replace(/\D/g, '')) || 6) % 4];
  return (
    <svg viewBox={`0 0 ${w * 100} ${h * 100}`} aria-hidden>
      {fit === 'wide' ? (
        <>
          <rect x={80} y={140} width={180} height={34} rx={17} fill={shirt} opacity={0.85} />
          <g transform="translate(64 156)"><FaceMark id={actorId} r={18} isVillageHead={isVillageHead} /></g>
        </>
      ) : (
        <>
          <path d={fit === 'seat'
            ? 'M30 100 Q31 70 50 68 Q69 70 70 100 Z'
            : `M66 ${h * 100} L70 128 Q72 100 100 98 Q128 100 130 128 L134 ${h * 100} Z`}
            fill={shirt} opacity={0.85} />
          <g transform={fit === 'seat' ? 'translate(50 52)' : 'translate(100 76)'}>
            <FaceMark id={actorId} r={fit === 'seat' ? 14 : 20} isVillageHead={isVillageHead} />
          </g>
        </>
      )}
    </svg>
  );
}
