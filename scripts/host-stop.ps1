# Stops the site: the "POV Secret Hitler" scheduled task, the game server and the Cloudflare tunnel.
# Games in progress are kept in data\rooms.db and resume on the next start.
# The task is also disabled, so its 5-minute watchdog does not bring the site straight back.
# Start again with:  .\scripts\host-start.ps1
Disable-ScheduledTask -TaskName 'POV Secret Hitler' -ErrorAction SilentlyContinue | Out-Null
Stop-ScheduledTask -TaskName 'POV Secret Hitler' -ErrorAction SilentlyContinue
# The supervisor loop itself (a hidden powershell running host-task.ps1).
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*host-task.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
# npm / tsx / node processes running this project's host script.
Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='cmd.exe'" |
  Where-Object { $_.CommandLine -like '*run host*' -or $_.CommandLine -like '*scripts/host.ts*' -or $_.CommandLine -like '*scripts\host.ts*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
# Whatever still listens on the game port, and the tunnel.
$p = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output 'POV Secret Hitler stopped (task disabled; run .\scripts\host-start.ps1 to start it again).'
