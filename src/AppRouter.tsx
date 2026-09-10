import { Suspense, lazy, useEffect, useState } from 'react';

// The active product of this repository is the research simulator.
//
//   #/            the research simulator (server/app/simulation)
//   #/companion   the earlier MEDial companion demo - archived, off by default
//
// The companion demo is kept in the tree because the working copy contains
// uncommitted changes to it (see local-archive/companion/ for a copy, the diffs
// and the file hashes). Nothing here deletes or reverts it. It is simply no
// longer part of the active build: without the flag its chunk is not emitted, so
// the shipped bundle cannot pull in the voice / triage / RAG modules that doc 06
// asks us to keep out of the new domain.
//
// To look at it again:  VITE_INCLUDE_COMPANION=1 npm run dev   then open #/companion

const INCLUDE_COMPANION = import.meta.env.VITE_INCLUDE_COMPANION === '1';

const SimulationApp = lazy(() => import('./features/simulation/SimulationApp'));
const CompanionApp = INCLUDE_COMPANION ? lazy(() => import('./App')) : null;

function currentRoute(): 'companion' | 'simulation' {
  return window.location.hash.startsWith('#/companion') ? 'companion' : 'simulation';
}

function Archived() {
  return (
    <div style={{ padding: 24, fontSize: 13, lineHeight: 1.7, maxWidth: 620 }}>
      <strong>이 경로는 활성 제품이 아닙니다.</strong>
      <p>
        기존 MEDial 컴패니언 데모는 보관 상태이며 기본 빌드에 포함되지 않습니다. 소스는 지운 적이
        없고 <code>src/App.tsx</code> 이하에 그대로 있습니다. 미커밋 변경 사본과 diff는{' '}
        <code>local-archive/companion/</code> 에 있습니다.
      </p>
      <p>
        다시 열려면: <code>VITE_INCLUDE_COMPANION=1 npm run dev</code>
      </p>
      <p>
        <a href="#/">연구 시뮬레이터로 이동</a>
      </p>
    </div>
  );
}

export default function AppRouter() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return (
    <Suspense fallback={<div style={{ padding: 24, fontSize: 13 }}>불러오는 중…</div>}>
      {route === 'companion' ? (
        CompanionApp ? (
          <CompanionApp />
        ) : (
          <Archived />
        )
      ) : (
        <SimulationApp />
      )}
    </Suspense>
  );
}
