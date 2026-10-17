import { useLayoutEffect, useRef, useState } from 'react';

// A label in SVG that stays readable over a map or a line: the text on a rounded
// plate of its own, never an outline drawn around the letters (2026-10-07: outlined
// letters looked cheap, and are not used anywhere in the app).
//
// The plate follows the same rule as every HTML pill (ui/primitives `pill`): its
// height is 1.82 times the font size, centred on the text's own box, and the side
// padding is 0.82 times the font size. The text box is measured once drawn
// (getBBox), so the plate is centred on what was actually drawn, not on an
// estimate of how wide the letters might be. Until it is measured the label is
// not shown, so a first frame never shows a plate in the wrong place.

const HEIGHT = 1.82;
const SIDE = 0.82;

interface Props {
  x: number;
  /** The text's baseline. */
  y: number;
  text: string;
  size: number;
  anchor?: 'start' | 'middle' | 'end';
  fill: string;
  plate: string;
  weight?: number;
  /** The visible area: a label that would cross its edge is moved inside it
   *  (a map's place near the frame's edge), never cut. */
  within?: { x: number; y: number; w: number; h: number };
}

export default function PillText({ x, y, text, size, anchor = 'start', fill, plate, weight = 700, within }: Props) {
  const ref = useRef<SVGTextElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof node.getBBox !== 'function') return;
    try {
      const b = node.getBBox();
      setBox({ x: b.x, y: b.y, w: b.width, h: b.height });
    } catch {
      // Not laid out (a hidden tree, a test DOM): the label stays as text alone.
    }
  }, [x, y, text, size, weight, anchor]);

  const h = size * HEIGHT;
  const pad = size * SIDE;
  const plateRect = box ? { x: box.x - pad, y: box.y + box.h / 2 - h / 2, w: box.w + pad * 2, h } : null;
  let dx = 0;
  let dy = 0;
  if (plateRect && within) {
    const m = size * 0.3;
    dx = Math.max(within.x + m - plateRect.x, Math.min(0, within.x + within.w - m - (plateRect.x + plateRect.w)));
    dy = Math.max(within.y + m - plateRect.y, Math.min(0, within.y + within.h - m - (plateRect.y + plateRect.h)));
  }
  return (
    <g pointerEvents="none" opacity={box ? 1 : 0} transform={dx || dy ? `translate(${dx} ${dy})` : undefined}>
      {plateRect && (
        <rect x={plateRect.x} y={plateRect.y} width={plateRect.w} height={plateRect.h} rx={h / 2} fill={plate} />
      )}
      <text ref={ref} x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} fill={fill}
        textRendering="geometricPrecision">{text}</text>
    </g>
  );
}
