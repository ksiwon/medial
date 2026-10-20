import styled from 'styled-components';
import logo from '../../../assets/brand/desimer-logo.svg';

// The Desimer wordmark (src/assets/brand/desimer-logo.svg, one colour: the accent orange). It stands in for the
// word "Desimer" wherever the name is the sign of the place: the waiting screen, the opening film's corner, the
// tablet's bar. The mark is 1531 x 322, so a height is all a place has to say.

const Mark = styled.img<{ $h: string }>`
  display: block;
  height: ${(p) => p.$h};
  width: auto;
  user-select: none;
  -webkit-user-drag: none;
`;

export default function Logo({ height }: { height: string }) {
  return <Mark src={logo} alt="Desimer" $h={height} draggable={false} />;
}
