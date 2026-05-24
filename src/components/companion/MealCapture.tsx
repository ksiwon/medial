// src/components/companion/MealCapture.tsx
// 식사 사진 촬영 → /api/meal/analyze(Gemini 비전) → store.addMeal + ws.sendMeal.
import { useRef, useState } from 'react';
import styled from 'styled-components';
import { color, font, ts, touch } from '../../styles/tokens';
import { CameraIcon } from '../icons';
import { useAppStore } from '../../store/useAppStore';
import { useCompanion } from './CompanionContext';
import { MealRecord, MealType, MealFlag } from '../../types/health';

const Btn = styled.button<{ $large?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: ${touch.min}px;
  width: ${({ $large }) => ($large ? '100%' : 'auto')};
  font-size: ${({ $large }) => ($large ? ts(18) : ts(15))};
  font-weight: ${font.weight.semiBold};
  color: ${({ $large }) => ($large ? color.white : color.role.positive)};
  background: ${({ $large }) => ($large ? color.role.positive : color.white)};
  padding: ${({ $large }) => ($large ? '14px 16px' : '8px 14px')};
  border: 1px solid ${color.sage[300]};
  border-radius: ${({ $large }) => ($large ? '14px' : '999px')};
  &:active { transform: scale(0.98); }
  &:disabled { opacity: 0.5; }
`;

function httpBase(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`;
  } catch {
    return 'http://localhost:8000';
  }
}

function mealTypeNow(): MealType {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function MealCapture({ large }: { large?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { ws } = useCompanion();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const mealType = mealTypeNow();
      const base = httpBase(useAppStore.getState().wsUrl);
      let summary = '식사를 기록했어요.';
      let flags: MealFlag[] = ['균형'];
      let mt: MealType = mealType;
      try {
        const res = await fetch(`${base}/api/meal/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_b64: dataUrl, mime_type: file.type || 'image/jpeg', meal_type: mealType }),
        });
        if (res.ok) {
          const data = await res.json();
          summary = data.aiSummary ?? summary;
          flags = (data.flags ?? flags) as MealFlag[];
          mt = (data.mealType ?? mealType) as MealType;
        }
      } catch {
        // 오프라인 — 로컬 기본값으로 기록
      }
      const meal: MealRecord = {
        timestamp: Date.now(), mealType: mt, aiSummary: summary, flags,
      };
      useAppStore.getState().addMeal(meal);
      useAppStore.getState().logEvent('meal', mt);
      ws.sendMeal(meal);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        style={{ display: 'none' }}
      />
      <Btn $large={large} disabled={busy} onClick={() => inputRef.current?.click()}>
        <CameraIcon size={large ? 20 : 16} color={large ? color.white : color.role.positive} />
        {busy ? '분석 중...' : '식사 사진 찍기'}
      </Btn>
    </>
  );
}
