# Keeps `npm run host` running (server + Cloudflare tunnel), restarting it if it ever exits.
# Started hidden by the "POV Secret Hitler" Task Scheduler task at logon. Output goes to logs\host.log.
$ErrorActionPreference = 'Continue'
# Windows can deliver a Ctrl+C / console-close signal to hidden console processes (it took the site down
# once). Treat Ctrl+C as plain input so this supervisor survives it and simply restarts the server.
try { [Console]::TreatControlCAsInput = $true } catch {}
Set-Location (Split-Path $PSScriptRoot -Parent)
New-Item -ItemType Directory -Force logs | Out-Null
$log = Join-Path (Get-Location) 'logs\host.log'

while ($true) {
  # Keep the log from growing forever: start fresh once it passes 5 MB.
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Move-Item -Force $log "$log.old" }
  "[$(Get-Date -Format s)] starting npm run host" | Out-File -Append -Encoding utf8 $log
  # cmd's redirection keeps the log plain UTF-8 (PowerShell 5.1's would write UTF-16).
  & cmd.exe /c "npm run host >> `"$log`" 2>&1"
  "[$(Get-Date -Format s)] host exited (code $LASTEXITCODE); restarting in 10s" | Out-File -Append -Encoding utf8 $log
  # Clean up a tunnel left behind by a crash so the next start gets a fresh one.
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 10
}
