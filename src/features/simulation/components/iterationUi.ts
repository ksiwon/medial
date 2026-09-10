import styled from 'styled-components';

// Shared atoms for the iteration screens. Kept in one place so that "this is a
// simulated review", "this is a researcher metric" and "this is unknown" look
// the same everywhere - the distinction is the point of the whole tool, and it
// stops being visible the moment two screens style it differently.

export const Panel = styled.section`
  border: 1px solid #cfd6c8;
  border-radius: 10px;
  background: #ffffff;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
`;

export const PanelTitle = styled.h2`
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: #24382c;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

export const Note = styled.p`
  margin: 0;
  font-size: 11px;
  line-height: 1.65;
  color: #5b6f5f;
`;

export const Card = styled.article<{ $tone?: 'plain' | 'warn' | 'minority' }>`
  border: 1px solid ${(p) => (p.$tone === 'warn' ? '#b5853e' : p.$tone === 'minority' ? '#23486b' : '#dfe5d8')};
  border-left-width: ${(p) => (p.$tone && p.$tone !== 'plain' ? '3px' : '1px')};
  background: ${(p) => (p.$tone === 'warn' ? '#fdf9ef' : p.$tone === 'minority' ? '#f4f7fb' : '#fbfcf9')};
  border-radius: 8px;
  padding: 9px 11px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const Row = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
`;

export const Tag = styled.span<{ $kind?: string }>`
  font-size: 10px;
  border-radius: 999px;
  padding: 1px 7px;
  border: 1px solid ${(p) => tagColour(p.$kind).border};
  color: ${(p) => tagColour(p.$kind).text};
  background: ${(p) => tagColour(p.$kind).background};
  white-space: nowrap;
`;

/** Assessment colours. ``unknown`` is deliberately grey and never red: "there
 *  was no basis to judge" is not a complaint, and colouring it as one would turn
 *  a missing answer into a bad one. */
function tagColour(kind?: string): { border: string; text: string; background: string } {
  switch (kind) {
    case 'positive':
      return { border: '#5d8f6c', text: '#2b5d3a', background: '#eef6f0' };
    case 'mixed':
      return { border: '#b5853e', text: '#7d5a17', background: '#fdf6e6' };
    case 'negative':
      return { border: '#b05a4c', text: '#8b3a2c', background: '#fbeeec' };
    case 'unknown':
      return { border: '#c3c9bd', text: '#6a7568', background: '#f4f5f1' };
    case 'blocking':
      return { border: '#b05a4c', text: '#8b3a2c', background: '#fbeeec' };
    case 'minority':
      return { border: '#23486b', text: '#23486b', background: '#eef2f8' };
    case 'human':
      return { border: '#5a3f8f', text: '#4a2f7d', background: '#f2eefa' };
    default:
      return { border: '#9fb098', text: '#2b4d3a', background: '#f0f5ef' };
  }
}

export const Button = styled.button<{ $primary?: boolean; $active?: boolean }>`
  border: 1px solid ${(p) => (p.$active ? '#447a5a' : '#cfd6c8')};
  background: ${(p) => (p.$primary ? '#2b4d3a' : p.$active ? '#edf5f0' : '#ffffff')};
  color: ${(p) => (p.$primary ? '#ffffff' : '#2b3f30')};
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11.5px;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

export const Scroll = styled.div`
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: #3d5344;
`;

export const Input = styled.input`
  border: 1px solid #cfd6c8;
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  font-family: inherit;
  color: #16241a;
  background: #ffffff;
`;

export const TextArea = styled.textarea`
  border: 1px solid #cfd6c8;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
  color: #16241a;
  background: #ffffff;
  resize: vertical;
  min-height: 52px;
`;

export const Select = styled.select`
  border: 1px solid #cfd6c8;
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  font-family: inherit;
  color: #16241a;
  background: #ffffff;
`;

export const Mono = styled.code`
  font-size: 10.5px;
  color: #46604f;
  background: #f2f5ef;
  border-radius: 4px;
  padding: 0 4px;
`;

export const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  th,
  td {
    border-bottom: 1px solid #e6ebe1;
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
  }
  th {
    color: #4c6151;
    font-weight: 600;
  }
  td.num {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
`;

/** Text for a numeric criterion, keeping "unknown" distinct from zero. */
export function showValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'unknown';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function showDelta(value: number): string {
  if (value === 0) return '±0';
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}
