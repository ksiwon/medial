import { useEffect, useState } from 'react';

/** How much bigger than a laptop this screen's type and labels are: 1 up to a
 *  1440 x 900 window, growing with the window's width, and never past what its
 *  height holds, so a wall screen is read from further away without anything
 *  falling off it. The opening film sizes itself in vw and ignores this. */
export function uiScale(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(2.2, Math.max(1, Math.min(window.innerWidth / 1440, window.innerHeight / 900)));
}

/** The scale, kept on the page as `--k` for the stylesheet (ui/theme `px`) and
 *  returned for what is drawn in SVG, where a CSS variable cannot reach. */
export function useUiScale(): number {
  const [k, setK] = useState(uiScale);
  useEffect(() => {
    const apply = () => {
      const next = uiScale();
      document.documentElement.style.setProperty('--k', next.toFixed(3));
      setK(next);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
  return k;
}
