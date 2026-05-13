// src/components/phone/OptionButton.tsx
import styled, { keyframes } from 'styled-components';
import { color, font, radius, border } from '../../styles/tokens';

const appear = keyframes`
  from { opacity: 0; transform: translateX(-4px); }
  to   { opacity: 1; transform: translateX(0); }
`;

const Btn = styled.button<{ $selected: boolean }>`
  width: 100%;
  padding: 10px 13px;
  text-align: left;
  font-size: ${font.size.appMd};
  font-weight: ${({ $selected }) => $selected ? font.weight.semiBold : font.weight.medium};
  color: ${({ $selected }) => $selected ? color.white : color.ink[700]};
  background: ${({ $selected }) => $selected ? color.sage[600] : color.white};
  border: ${border.thin};
  border-left: 3px solid ${({ $selected }) => $selected ? color.sage[500] : 'transparent'};
  border-radius: ${radius.lg};
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-left-color 0.12s;
  animation: ${appear} 0.2s ease;
  line-height: 1.3;
  display: flex;
  align-items: center;
  justify-content: space-between;

  &:active {
    background: ${({ $selected }) => $selected ? color.sage[700] : color.sage[50]};
  }

  &::after {
    content: '→';
    font-size: 12px;
    color: ${({ $selected }) => $selected ? 'rgba(255,255,255,0.6)' : color.sage[300]};
    flex-shrink: 0;
    margin-left: 8px;
  }
`;

interface Props {
  label: string;
  selected: boolean;
  onClick: () => void;
}

export default function OptionButton({ label, selected, onClick }: Props) {
  return (
    <Btn $selected={selected} onClick={onClick}>
      {label}
    </Btn>
  );
}
