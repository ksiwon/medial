import { useLayoutEffect, type RefObject } from 'react';
import { uiScale } from './uiScale';

/**
 * A page that must not run off the wall: when what it holds is taller than the room it has, its own scale (`--k`, the
 * one every length goes through, ui/theme `px`) is stepped down until it fits, and set back up when the window grows.
 * It happens only where the amount of text is not the designer's to choose (how many events the visitor changed, how
 * many rules an event changed), so the usual page is untouched and a crowded one is smaller rather than cut off.
 *
 * `over` says whether the element is taller than its room; it is asked after every step.
 */
export function useFit(ref: RefObject<HTMLElement>, over: (el: HTMLElement) => boolean, deps: readonly unknown[]): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      let k = uiScale();
      el.style.setProperty('--k', k.toFixed(3));
      for (let i = 0; i < 20 && k > 0.5 && over(el); i += 1) {
        k *= 0.95;
        el.style.setProperty('--k', k.toFixed(3));
      }
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** The page's own height against the room its parent gives it. */
export const tallerThanParent = (el: HTMLElement): boolean => el.offsetHeight > (el.parentElement?.clientHeight ?? Infinity);
/** A box that clips its content (max-height, overflow hidden) against what it holds. */
export const clipsContent = (el: HTMLElement): boolean => el.scrollHeight > el.clientHeight + 1;
