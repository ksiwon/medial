// 전시장 두 화면 도우미 (Mac Studio · Windows 노트북 공통, node만 쓴다).
//   node scripts/two_screens.cjs urls [포트]      iPad가 열 주소와 모니터 주소를 적는다
//   node scripts/two_screens.cjs wall [포트]      모니터 창을 키오스크로 연다 (소리 자동 재생 허용)
//   node scripts/two_screens.cjs check [포트]     iPad가 붙을 수 있는지 이 기계에서 확인한다
// 포트는 생략하면 .run/sim/ports 에 적힌 화면 포트, 그것도 없으면 5180.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

function webPort(arg) {
  if (arg) return Number(arg);
  try {
    return Number(fs.readFileSync(path.join(ROOT, '.run', 'sim', 'ports'), 'utf8').trim().split(/\s+/)[1]) || 5180;
  } catch { return 5180; }
}

// 가상 어댑터(VirtualBox · VMware · WSL · Docker · 터널)의 주소는 iPad가 갈 수 없다.
const VIRTUAL = /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|tailscale|zerotier|loopback|utun|awdl|llw|bridge|vmnet/i;
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
// VirtualBox 호스트 전용(192.168.56.x) · Docker(172.17.x) · WSL(172.2x.x) 같은 기계 안쪽 대역. 어댑터 이름에 가상이라고 안 적힌 경우가 있어 주소로도 거른다.
const INTERNAL = /^(192\.168\.56\.|192\.168\.99\.|172\.17\.|172\.18\.|172\.2\d\.|169\.254\.)/;

function lanAddresses() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && PRIVATE.test(a.address) && !INTERNAL.test(a.address)) found.push({ name, address: a.address });
    }
  }
  return found;
}

function urls(port) {
  const lan = lanAddresses();
  return {
    wall: `http://localhost:${port}/?role=wall`,
    pad: lan.map((a) => ({ ...a, url: `http://${a.address}:${port}/?role=pad` })),
  };
}

function printUrls(port) {
  const u = urls(port);
  console.log(`모니터(이 기계)  ${u.wall}`);
  if (u.pad.length === 0) {
    console.log('iPad 주소       (이 기계의 사설 IP를 찾지 못했습니다 — 와이파이나 랜선이 연결됐는지 확인하세요)');
  }
  for (const p of u.pad) console.log(`iPad(${p.name})  ${p.url}`);
  if (u.pad.length > 1) console.log('주소가 둘 이상이면 iPad가 붙은 와이파이와 같은 대역(앞 세 자리)인 것을 고르세요.');
}

function chromePath() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : process.platform === 'win32'
      ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap((base) => [
          path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe')])
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function openWall(port) {
  const exe = chromePath();
  const url = urls(port).wall;
  if (!exe) {
    console.log('Chrome이나 Edge를 찾지 못했습니다. 브라우저로 직접 여세요:', url);
    return 1;
  }
  // 별도 프로필: 이미 떠 있는 브라우저 창에 붙어 버리면 키오스크 옵션이 먹지 않는다.
  const profile = path.join(os.tmpdir(), 'medial-wall-profile');
  const child = spawn(exe, [
    '--kiosk', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--disable-pinch',
    '--overscroll-history-navigation=0', `--user-data-dir=${profile}`, url,
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log('모니터 창을 열었습니다(전체 화면). 닫으려면 Alt+F4 (Mac은 Cmd+Q).');
  return 0;
}

async function check(port) {
  const u = urls(port);
  let bad = 0;
  const get = async (url) => {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(4000) }); return r.status; } catch { return null; }
  };
  const local = await get(`http://127.0.0.1:${port}/`);
  console.log(`화면 서버(이 기계)   ${local === 200 ? '정상' : '응답 없음 — run-sim 이 떠 있는지 확인'}`);
  if (local !== 200) bad += 1;
  const api = await get(`http://127.0.0.1:${port}/api/sim/health`);
  console.log(`API 중계(프록시)     ${api === 200 ? '정상' : `이상 (${api})`}`);
  if (api !== 200) bad += 1;
  for (const p of u.pad) {
    const status = await get(`http://${p.address}:${port}/`);
    console.log(`${p.name} ${p.address}  ${status === 200 ? '이 기계에서는 열림' : `열리지 않음 (${status})`}`);
  }
  console.log('주의: 이 검사는 이 기계 안에서만 돌아서 방화벽이 iPad를 막는지는 알 수 없습니다.');
  if (process.platform === 'win32') {
    console.log('Windows: 첫 접속이 안 되면 관리자 PowerShell에서  powershell -ExecutionPolicy Bypass -File scripts/allow_tablet_firewall.ps1');
  } else if (process.platform === 'darwin') {
    console.log('Mac: 시스템 설정 > 네트워크 > 방화벽이 켜져 있으면 node를 "수신 연결 허용"으로 두세요.');
  }
  return bad ? 1 : 0;
}

const [cmd, arg] = process.argv.slice(2);
const port = webPort(arg);
if (cmd === 'urls') { printUrls(port); }
else if (cmd === 'wall') { process.exit(openWall(port)); }
else if (cmd === 'check') { check(port).then((c) => process.exit(c)); }
else { console.log('사용법: node scripts/two_screens.cjs urls|wall|check [포트]'); process.exit(2); }

