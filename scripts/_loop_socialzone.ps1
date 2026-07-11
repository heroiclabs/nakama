$payloadPath = "C:\Office\Backend\nakama\scripts\_loop_socialzone_payload.json"
while ($true) {
  Start-Sleep -Seconds 300
  $p = Get-Content -Raw $payloadPath
  Write-Output ("AGENT_LOOP_TICK_socialzone_deploy " + $p.Trim())
}
