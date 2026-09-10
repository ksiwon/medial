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

const SKIN = ['#F0D3B4', '#E4BD98', '#D5A67F', '#C79067'];
const HAIR = ['#3A3A3A', '#6B5A46', '#9A9A9A', '#D8D8D8', '#54402C'];

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export interface FaceTraits {
  skin: string;
  hair: string;
  hairStyle: 0 | 1 | 2 | 3;
  glasses: boolean;
  beard: boolean;
}

export function traitsFor(id: string): FaceTraits {
  const h = hash(id);
  return {
    skin: SKIN[h % SKIN.length],
    hair: HAIR[(h >> 3) % HAIR.length],
    hairStyle: ((h >> 6) % 4) as 0 | 1 | 2 | 3,
    glasses: ((h >> 9) & 1) === 1,
    beard: ((h >> 11) & 1) === 1,
  };
}

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
  const t = traitsFor(id);
  const eyeY = -r * 0.12;
  const eyeX = r * 0.34;
  return (
    <g>
      <circle cx={0} cy={0} r={r} fill={t.skin} stroke="#4A4034" strokeWidth={r * 0.11} />
      {/* hair: four silhouettes, enough to separate twelve people together with
          the beard/glasses flags */}
      {t.hairStyle === 0 && (
        <path
          d={`M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0 L ${r * 0.78} ${-r * 0.24} A ${r * 0.8} ${r * 0.7} 0 0 0 ${-r * 0.78} ${-r * 0.24} Z`}
          fill={t.hair}
        />
      )}
      {t.hairStyle === 1 && (
        <path d={`M ${-r} ${-r * 0.15} A ${r} ${r} 0 0 1 ${r} ${-r * 0.15} Z`} fill={t.hair} />
      )}
      {t.hairStyle === 2 && (
        <>
          <path d={`M ${-r} ${-r * 0.1} A ${r} ${r} 0 0 1 ${r} ${-r * 0.1} Z`} fill={t.hair} />
          <rect x={-r} y={-r * 0.16} width={r * 0.42} height={r * 0.9} rx={r * 0.2} fill={t.hair} />
          <rect
            x={r * 0.58}
            y={-r * 0.16}
            width={r * 0.42}
            height={r * 0.9}
            rx={r * 0.2}
            fill={t.hair}
          />
        </>
      )}
      {t.hairStyle === 3 && (
        <path
          d={`M ${-r * 0.85} ${-r * 0.45} Q 0 ${-r * 1.15} ${r * 0.85} ${-r * 0.45} Q 0 ${-r * 0.72} ${-r * 0.85} ${-r * 0.45} Z`}
          fill={t.hair}
        />
      )}
      <circle cx={-eyeX} cy={eyeY} r={Math.max(0.6, r * 0.11)} fill="#2A2320" />
      <circle cx={eyeX} cy={eyeY} r={Math.max(0.6, r * 0.11)} fill="#2A2320" />
      {t.glasses && (
        <g stroke="#37556B" strokeWidth={r * 0.09} fill="none">
          <circle cx={-eyeX} cy={eyeY} r={r * 0.26} />
          <circle cx={eyeX} cy={eyeY} r={r * 0.26} />
          <line x1={-eyeX + r * 0.26} y1={eyeY} x2={eyeX - r * 0.26} y2={eyeY} />
        </g>
      )}
      {t.beard ? (
        <path
          d={`M ${-r * 0.5} ${r * 0.24} Q 0 ${r * 0.92} ${r * 0.5} ${r * 0.24}`}
          fill={t.hair}
          opacity={0.85}
        />
      ) : (
        <path
          d={`M ${-r * 0.3} ${r * 0.36} Q 0 ${r * 0.6} ${r * 0.3} ${r * 0.36}`}
          stroke="#7A5C48"
          strokeWidth={r * 0.11}
          fill="none"
          strokeLinecap="round"
        />
      )}
      {isVillageHead && (
        // The village head is the same person as resident P6; the band marks the
        // role he also holds, not a different actor.
        <path
          d={`M ${-r * 0.95} ${-r * 0.62} L ${r * 0.95} ${-r * 0.62} L ${r * 0.72} ${-r * 0.95} L ${-r * 0.72} ${-r * 0.95} Z`}
          fill="#23486B"
          stroke="#16304A"
          strokeWidth={r * 0.07}
        />
      )}
      {ring && <circle cx={0} cy={0} r={r + r * 0.34} fill="none" stroke={ring} strokeWidth={r * 0.26} />}
    </g>
  );
}

/** The same face for HTML contexts (popover rows, lists). */
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
