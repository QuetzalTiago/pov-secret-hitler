# Starts the site again after host-stop.ps1: re-enables the "POV Secret Hitler" task (logon + 5-minute
# watchdog triggers) and starts it now. Games saved in data\rooms.db resume.
Enable-ScheduledTask -TaskName 'POV Secret Hitler' | Out-Null
Start-ScheduledTask -TaskName 'POV Secret Hitler'
Write-Output "POV Secret Hitler started (task: $((Get-ScheduledTask -TaskName 'POV Secret Hitler').State)). It takes ~20s to go live."
