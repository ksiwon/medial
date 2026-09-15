// Pretendard, bundled from node_modules rather than a CDN: the research tool
// runs on a laptop in the field, and a font that silently falls back offline
// changes every line break the layout was checked against. The whole variable
// font (one 2 MB file, cached after the first load) rather than the
// unicode-range subsets: subsets arrive glyph range by glyph range as new text
// appears, and each arrival reflows the screen under the pointer.
import 'pretendard/dist/web/variable/pretendardvariable.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import SimulationApp from './features/simulation/SimulationApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SimulationApp />
  </React.StrictMode>,
);
