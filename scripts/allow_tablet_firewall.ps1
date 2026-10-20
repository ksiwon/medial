# iPad가 이 Windows 노트북의 화면 서버(기본 5180)에 붙도록 방화벽을 연다. 관리자 PowerShell에서 한 번만.
#   powershell -ExecutionPolicy Bypass -File scripts/allow_tablet_firewall.ps1 [-Port 5180] [-Remove]
# 와이파이가 "공용" 네트워크이면 Windows가 들어오는 연결을 막는다. 이 규칙은 그 포트 하나만,
# 같은 서브넷(LocalSubnet)에서 오는 연결만 허용한다. 연구 기록을 읽는 서버(8020)는 열지 않는다.
param([int]$Port = 5180, [switch]$Remove)

$name = "Desimer tablet ($Port)"
$old = "MEDial tablet ($Port)"   # 이전 이름으로 만든 규칙도 함께 정리한다
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host "관리자 권한이 필요합니다. 시작 메뉴에서 PowerShell을 '관리자 권한으로 실행'한 뒤 다시 하세요."; exit 1 }

foreach ($rule in @($name, $old)) { Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
if ($Remove) { Write-Host "규칙을 지웠습니다: $name"; exit 0 }

New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port `
  -RemoteAddress LocalSubnet -Profile Any | Out-Null
Write-Host "허용했습니다: TCP $Port, 같은 서브넷에서 오는 연결만 (전시가 끝나면 -Remove 로 지우세요)"
