import styled, { keyframes } from 'styled-components';
import { api } from '../api/client';
import type { Village } from '../api/types';
import Portrait from '../ui/Portrait';
import { pill } from '../ui/primitives';
import { accentA, inkA, night, px, space } from '../ui/theme';
import type { Frame } from './types';

// The village beside the scene: the source's own map, north up, and where the scene on screen is happening.
//
// The map is a way to read the scene's context - where the farm is from the house, that the clinic is out of the
// village - and never more than that (AGENTS.md: the map does not come before the evaluations). It does not move
// anyone: a frame's people are drawn at the place the frame is set in, the AI is not drawn at all (it has no body;
// its panel is on the other side), and a place out of the village (the clinic, the town) is an arrow off the top
// edge. Without the map file the column says so; it never draws an invented village.

export interface Spot {
  key: string;
  label: string;
  /** Where on the map, or null for a place out of the village. */
  at: { x: number; y: number } | null;
  who: string[];
  /** A patrol is a route, not a point: the route is lit. */
  patrol: boolean;
}

/** Out of the village: the town and its clinic, and the road to them. */
const AWAY = new Set(['TOWN', 'CLINIC', 'CAR']);
/** A frame's backdrop that is a place on the map under another key. */
const PLACE_KEY: Record<string, string> = { SHOP: 'MIGA' };

/** Where each frame of a scene is on the map. A house is the home of the person it is named after ("한상덕 댁"). */
export function spotsOf(frames: Frame[], village: Village, people: Record<string, string>): Spot[] {
  const homes = village.homes ?? {};
  const places = village.places ?? {};
  const patrol = village.patrol ?? [];
  return frames.map((f, i) => {
    const who = Object.keys(f.who);
    const label = f.label ?? f.place;
    let at: { x: number; y: number } | null = null;
    if (f.place === 'HOME') {
      const owner = Object.keys(people).find((id) => people[id] && label.startsWith(people[id])) ?? who[0];
      at = (owner && homes[owner]) || null;
    } else if (f.place === 'PATROL') {
      const mid = patrol[Math.floor(patrol.length / 2)];
      at = mid ? { x: mid[0], y: mid[1] } : null;
    } else if (!AWAY.has(f.place)) {
      at = places[PLACE_KEY[f.place] ?? f.place] ?? null;
    }
    return { key: `${i}:${f.place}`, label, at, who, patrol: f.place === 'PATROL' };
  });
}

const Column = styled.section`
  flex: none;
  width: ${px(240)};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  padding: ${space.lg} ${space.md};
  background: ${night.panel};
  border-right: 1px solid ${night.line};
  overflow: hidden;
  > header { display: flex; flex-direction: column; gap: ${space.xs}; }
  > header > small { font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.09em; color: ${night.accent}; }
  > header > b { font-size: ${px(20)}; font-weight: 800; letter-spacing: -0.02em; }
  > footer { font-size: ${px(12)}; line-height: 1.45; color: ${night.faint}; word-break: keep-all; }
`;

const Fit = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
`;

/** The map at its own proportions: the overlay's % positions are the map's own. */
const Sheet = styled.div<{ $ratio: number }>`
  position: relative;
  height: 100%;
  max-width: 100%;
  aspect-ratio: ${(p) => p.$ratio};
  > svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
`;

const glow = keyframes`0%, 100% { box-shadow: 0 0 0 0 ${accentA(0.55)}; } 50% { box-shadow: 0 0 0 ${px(8)} ${accentA(0)}; }`;

const Pin = styled.div`
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${px(4)};
  z-index: 2;
  > i { width: ${px(16)}; height: ${px(16)}; border-radius: 50%; background: ${night.accent}; border: ${px(4)} solid #fff; animation: ${glow} 1.8s ease-in-out infinite; }
  > span { ${pill('xs')} font-weight: 800; color: #fff; background: rgba(21, 21, 15, 0.86); }
  > div { display: flex; gap: ${px(2)}; }
`;

const Away = styled.div`
  position: absolute;
  top: ${px(4)};
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${px(4)};
  > b { font-size: ${px(20)}; color: ${night.accent}; line-height: 1; }
  > span { ${pill('xs')} font-weight: 800; color: #fff; background: ${night.accent}; }
`;

const Missing = styled.div`
  margin: auto;
  font-size: ${px(16)};
  line-height: 1.5;
  color: ${night.faint};
  text-align: center;
  word-break: keep-all;
`;

export default function VillageMap({ village, frames, people, art }: {
  village: Village; frames: Frame[]; people: Record<string, string>; art: ReadonlySet<string>;
}) {
  const spots = spotsOf(frames, village, people);
  const box = village.viewBox;
  return (
    <Column aria-label="마을 지도">
      <header>
        <small>지금 장면이 있는 곳</small>
        <b>은점마을</b>
      </header>
      <Fit>
        {!village.available || !box ? <Missing>마을 지도 파일이 없어 지도를 그리지 않습니다</Missing> : (
          <Sheet $ratio={box[2] / box[3]}>
            <svg viewBox={box.join(' ')} preserveAspectRatio="xMidYMid meet" aria-hidden>
              {village.raster
                ? <image href={api.villageMapUrl()} width={village.raster.width} height={village.raster.height}
                    transform={`matrix(${village.raster.matrix.join(' ')})`} opacity={0.82} />
                : <rect x={box[0]} y={box[1]} width={box[2]} height={box[3]} fill={inkA(0.06)} />}
              {/* A dark veil, so the lit places are what the eye finds. */}
              <rect x={box[0]} y={box[1]} width={box[2]} height={box[3]} fill="rgba(18, 19, 16, 0.32)" />
              {(village.patrol?.length ?? 0) > 1 && (
                <polyline points={village.patrol!.map((p) => p.join(',')).join(' ')} fill="none"
                  stroke={spots.some((s) => s.patrol) ? night.accent : inkA(0.35)}
                  strokeWidth={spots.some((s) => s.patrol) ? 6 : 3} strokeDasharray="10 8" strokeLinecap="round" />
              )}
              {Object.entries(village.homes ?? {}).map(([id, h]) => (
                <circle key={id} cx={h.x} cy={h.y} r={7} fill="#fff" opacity={0.55} />
              ))}
            </svg>
            {spots.filter((s) => s.at).map((s) => (
              <Pin key={s.key} style={{ left: `${((s.at!.x - box[0]) / box[2]) * 100}%`, top: `${((s.at!.y - box[1]) / box[3]) * 100}%` }}>
                {s.who.length > 0 && <div>{s.who.map((id) => <Portrait key={id} actorId={id} art={art} size={32} />)}</div>}
                <i />
                <span>{s.label}</span>
              </Pin>
            ))}
            {spots.filter((s) => !s.at).slice(0, 1).map((s) => (
              <Away key={s.key}><b>↑</b><span>{s.label} · 마을 밖</span></Away>
            ))}
          </Sheet>
        )}
      </Fit>
      <footer>원본 시뮬레이터의 지도이며 측량도가 아닙니다. 사람은 장면이 일어난 곳에만 표시합니다.</footer>
    </Column>
  );
}
