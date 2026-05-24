// src/components/companion/TabBar.tsx
// MEDial 3.0 in-phone 하단 3탭. DR1·WCAG2.2: 큰 글씨·큰 터치(≥64px 높이).
import styled from 'styled-components';
import { color, font, ts, touch } from '../../styles/tokens';
import { useAppStore } from '../../store/useAppStore';
import { CompanionTab } from '../../types';

const Bar = styled.nav`
  flex-shrink: 0;
  display: flex;
  border-top: 1px solid rgba(54,99,72,0.16);
  background: ${color.white};
`;
const Item = styled.button<{ $active: boolean }>`
  flex: 1;
  min-height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 0 10px;
  background: ${({ $active }) => ($active ? color.role.positiveBg : 'transparent')};
  color: ${({ $active }) => ($active ? color.role.positive : color.text.muted)};
  transition: background 0.12s, color 0.12s;
  &:active { background: ${color.sage[100]}; }
`;
const Label = styled.span<{ $active: boolean }>`
  font-size: ${ts(15)};
  font-weight: ${({ $active }) => ($active ? font.weight.bold : font.weight.medium)};
  letter-spacing: 0.01em;
`;

function Icon({ id, c }: { id: CompanionTab; c: string }) {
  const s = 26;
  if (id === 'talk') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M4 5h16v11H8l-4 4V5Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
  if (id === 'health') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5C19 15.5 12 20 12 20Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 12h2l1.2-2.2L13 14l1-2h2" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="2" stroke={c} strokeWidth="1.8" />
      <path d="M8 9h8M8 12.5h8M8 16h5" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const TABS: Array<{ id: CompanionTab; label: string }> = [
  { id: 'talk', label: '소통' },
  { id: 'health', label: '내 건강' },
  { id: 'info', label: '정보' },
];

export default function TabBar() {
  const { companionTab, setCompanionTab } = useAppStore();
  return (
    <Bar role="tablist">
      {TABS.map(({ id, label }) => {
        const active = companionTab === id;
        const c = active ? color.role.positive : color.text.muted;
        return (
          <Item key={id} $active={active} role="tab" aria-selected={active}
            style={{ minWidth: touch.min }} onClick={() => setCompanionTab(id)}>
            <Icon id={id} c={c} />
            <Label $active={active}>{label}</Label>
          </Item>
        );
      })}
    </Bar>
  );
}
