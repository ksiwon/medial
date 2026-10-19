import { api } from '../api/client';
import { shirts } from '../ui/theme';
import type { Fit } from '../week/art';

// One person in a frame: their picture when one was drawn, otherwise a plain silhouette with their number.
// The schematic figure is the honest fallback - it says "someone is here" without drawing a likeness nobody
// made. The picture's box is the same either way, so a frame lays out alike.

const BOX: Record<Fit, { w: number; h: number }> = {
  tall: { w: 2, h: 3 }, work: { w: 2, h: 3 }, seat: { w: 1, h: 1 }, wide: { w: 3, h: 2 },
};

export function Figure({ picture, actorId, fit }: { picture: string | null; actorId: string; fit: Fit }) {
  // Sized by the frame (SceneView's Person box); the picture only fills it.
  if (picture) return <img src={api.artUrl(picture)} alt="" draggable={false} />;
  const { w, h } = BOX[fit];
  const shirt = shirts[(Number(actorId.replace(/\D/g, '')) || 6) % 4];
  return (
    <svg viewBox={`0 0 ${w * 100} ${h * 100}`} aria-hidden>
      {fit === 'wide' ? (
        <rect x={80} y={h * 50} width={180} height={34} rx={17} fill={shirt} opacity={0.85} />
      ) : (
        <>
          <path d={`M66 ${h * 100} L70 128 Q72 100 100 98 Q128 100 130 128 L134 ${h * 100} Z`} fill={shirt} opacity={0.85} />
          <circle cx={100} cy={76} r={26} fill={shirt} opacity={0.95} />
        </>
      )}
    </svg>
  );
}
