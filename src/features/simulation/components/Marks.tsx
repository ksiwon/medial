import { useId } from 'react';
// Small drawn faces, and a vehicle mark that is its own object.
//
// The faces exist so twelve people are telling apart at a glance without reading
// a number. They are generated from the resident id, so the same person always
// looks the same, and they are deliberately schematic: no photograph, no
// likeness, nothing that could be read as a picture of a real resident. The map
// legend says so out loud.
//
// The vehicle is drawn separately from the person rather than as an icon on top
// of them, because "who is driving" and "who is riding" are different facts and
// the seat marks have to be able to show both.

/**
 * One face, drawn in a 20x20 box centred on (0,0) at scale 1.
 * Rendered inside SVG on the map and inside HTML popovers alike.
 */
export function FaceMark({
  id,
  r = 7,
  isVillageHead = false,
  ring = null,
}: {
  id: string;
  r?: number;
  isVillageHead?: boolean;
  ring?: string | null;
}) {
  // Original HTML portrait palette and silhouette; symbolic, not a real likeness.
  const clip = useId();
  const n = Number(id.replace(/\D/g, '')) || 6;
  const bg = ['#dce8e3', '#e5e1ed', '#f0e1cb', '#dae4ed'][n % 4];
  const shirt = ['#557f79', '#7b7895', '#b38b57', '#63819b'][n % 4];
  const hair = ['#726b63', '#c3bbb0', '#584f48'][n % 3];
  return (
    <g>
      <circle r={r + r * .16} fill="#ffffff" stroke={ring ?? '#cedbd1'} strokeWidth={r * .12} />
      <g transform={`scale(${r / 20}) translate(-20 -20)`}>
        <defs><clipPath id={clip}><circle cx="20" cy="20" r="20" /></clipPath></defs>
        <g clipPath={`url(#${clip})`}>
          <rect width="40" height="40" fill={bg} />
          <path d="M8 40 Q9 27 20 27 Q32 27 33 40" fill={shirt} />
          <ellipse cx="20" cy="19" rx="10" ry="12" fill="#d9b899" />
          <path d="M10 19 Q7 4 20 5 Q33 5 30 20 L27 12 Q18 15 12 11Z" fill={hair} />
          <circle cx="16" cy="20" r="1" fill="#343831" />
          <circle cx="24" cy="20" r="1" fill="#343831" />
          <path d="M17 26 Q20 28 23 25" fill="none" stroke="#9d7260" />
          {n % 2 === 1 && <path d="M11 18 H18 V23 H12Z M22 18 H29 V23 H22Z M18 20 H22" fill="none" stroke="#65706d" />}
          {isVillageHead && <path d="M10 11 Q20 3 30 11" fill="none" stroke="#6b7970" strokeWidth="2" />}
        </g>
      </g>
    </g>
  );
}

export function FaceChip({
  id,
  size = 20,
  isVillageHead = false,
}: {
  id: string;
  size?: number;
  isVillageHead?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-10 -10 20 20"
      style={{ flexShrink: 0, display: 'block' }}
      aria-hidden="true"
    >
      <FaceMark id={id} r={8} isVillageHead={isVillageHead} />
    </svg>
  );
}

/**
 * A vehicle, drawn as its own object next to the people it is carrying.
 *
 * Sized so it reads as a car and not as a dot: the body is 28x16 px at
 * ``scale`` 1, which is the floor doc 15 section 5 sets. ``seats`` is the
 * experiment assumption from the resource revision and the filled dots are the
 * seats actually held, so an empty seat on the way home is visible rather than
 * implied.
 */
export function VehicleMark({
  mode,
  occupied,
  seats,
  scale = 1,
}: {
  mode: 'drive' | 'boat' | 'offmap';
  occupied: number;
  seats: number;
  scale?: number;
}) {
  const s = scale;
  if (mode === 'boat') {
    return (
      <g>
        <path
          d={`M ${-6 * s} 0 L ${6 * s} 0 L ${4 * s} ${3.4 * s} L ${-4 * s} ${3.4 * s} Z`}
          fill="#2F5D7C"
          stroke="#1C3A50"
          strokeWidth={0.8 * s}
        />
        <line x1={0} y1={0} x2={0} y2={-5 * s} stroke="#1C3A50" strokeWidth={0.9 * s} />
        <path d={`M 0 ${-5 * s} L ${4 * s} ${-1.4 * s} L 0 ${-1.4 * s} Z`} fill="#EDF2F5" />
      </g>
    );
  }
  const dots = Array.from({ length: Math.max(seats, occupied) });
  return (
    <g>
      {/* 28 x 16 px body: cabin, bonnet, two wheels. */}
      <rect
        x={-14 * s}
        y={-5 * s}
        width={28 * s}
        height={11 * s}
        rx={3 * s}
        fill="#7A2618"
        stroke="#3E120B"
        strokeWidth={1.4 * s}
      />
      <path
        d={`M ${-8 * s} ${-5 * s} L ${-6 * s} ${-9.5 * s} L ${5 * s} ${-9.5 * s} L ${8 * s} ${-5 * s} Z`}
        fill="#7A2618"
        stroke="#3E120B"
        strokeWidth={1.4 * s}
        strokeLinejoin="round"
      />
      <rect x={-6 * s} y={-8.6 * s} width={12 * s} height={3.4 * s} rx={0.8 * s} fill="#F3DDD6" />
      <circle cx={-8 * s} cy={6 * s} r={3 * s} fill="#1F1210" stroke="#FFFFFF" strokeWidth={s} />
      <circle cx={8 * s} cy={6 * s} r={3 * s} fill="#1F1210" stroke="#FFFFFF" strokeWidth={s} />
      {/* One dot per seat the resource revision assumes; filled = held. */}
      {dots.map((_, i) => (
        <circle
          key={i}
          cx={(-4 + i * 4) * s}
          cy={-13.5 * s}
          r={1.7 * s}
          fill={i < occupied ? '#7A2618' : '#FFFFFF'}
          stroke="#7A2618"
          strokeWidth={s}
        />
      ))}
    </g>
  );
}

/**
 * One 8-10 px glyph for what a person is doing, and only one. A marker carries
 * at most a single activity icon; anything more turns twelve people into a
 * legend nobody reads.
 */
export function ActivityIcon({
  kind,
  size = 9,
}: {
  kind: 'travel' | 'waiting' | 'task' | 'boat';
  size?: number;
}) {
  const r = size / 2;
  if (kind === 'travel') {
    return (
      <path
        d={`M ${-r} 0 L ${r * 0.4} 0 M ${r * 0.4} ${-r * 0.6} L ${r} 0 L ${r * 0.4} ${r * 0.6}`}
        stroke="#1D2935"
        strokeWidth={size * 0.18}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  if (kind === 'boat') {
    return (
      <path
        d={`M ${-r} ${r * 0.3} L ${r} ${r * 0.3} L ${r * 0.6} ${r} L ${-r * 0.6} ${r} Z M 0 ${r * 0.3} L 0 ${-r}`}
        stroke="#1D2935"
        strokeWidth={size * 0.16}
        fill="none"
        strokeLinejoin="round"
      />
    );
  }
  if (kind === 'waiting') {
    return (
      <g stroke="#9A651D" strokeWidth={size * 0.16} fill="none">
        <circle cx={0} cy={0} r={r * 0.85} />
        <path d={`M 0 ${-r * 0.45} L 0 0 L ${r * 0.4} ${r * 0.2}`} strokeLinecap="round" />
      </g>
    );
  }
  return (
    <path
      d={`M ${-r * 0.7} 0 L ${-r * 0.15} ${r * 0.6} L ${r * 0.75} ${-r * 0.6}`}
      stroke="#25665B"
      strokeWidth={size * 0.2}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}
