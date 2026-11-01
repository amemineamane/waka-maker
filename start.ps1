# start.ps1 — 和歌メイカーをローカルで開く
# tools/serve.mjs（ポート 5530）を別ウィンドウで起動し、ブラウザで http://localhost:5530/ を開く。
# すでに起動していれば、ブラウザを開くだけ。止めるときはサーバーのウィンドウで Ctrl+C。
$ErrorActionPreference = 'Stop'
$port = 5530
$url = "http://localhost:$port/"

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $ar = $c.BeginConnect('127.0.0.1', $p, $null, $null)
    return ($ar.AsyncWaitHandle.WaitOne(300) -and $c.Connected)
  } catch { return $false } finally { $c.Close() }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js が見つかりません。https://nodejs.org/ からインストールするか、index.html を直接ダブルクリックしてください。'
  Read-Host 'Enter で閉じます'
  exit 1
}

if (-not (Test-Port $port)) {
  Start-Process -FilePath 'node' -ArgumentList @('tools/serve.mjs', $port) -WorkingDirectory $PSScriptRoot
  for ($i = 0; $i -lt 25 -and -not (Test-Port $port); $i++) { Start-Sleep -Milliseconds 200 }
}
Start-Process $url
Write-Host "和歌メイカーを開きました: $url"
