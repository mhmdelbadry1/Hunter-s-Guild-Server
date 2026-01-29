# duckdns.ps1
$domain = "huntersguild"     
$token  = "ceda8a0c-382e-41a0-82eb-090f976b5d66"            
$logFile = "$PSScriptRoot\duckdns.log"

try {
    # Try to get public IP but don't let it block the update
    $currentIp = "Unknown"
    try {
        $currentIp = (Invoke-RestMethod -Uri "https://icanhazip.com" -TimeoutSec 10).Trim()
    } catch { 
        # Skip IP log if provider is down
    }

    # The actual DuckDNS update
    $url = "https://www.duckdns.org/update?domains=$domain&token=$token"
    $resp = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 20
    
    $time = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logMsg = "[$time] Detected IP: $currentIp | DuckDNS Response: $resp"
    Add-Content -Path $logFile -Value $logMsg
    
    if ($resp -eq "OK") {
        Write-Host "Success: $domain.duckdns.org updated (Detection: $currentIp)" -ForegroundColor Green
    } else {
        Write-Warning "DuckDNS returned: $resp"
    }
} catch {
    $time = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Add-Content -Path $logFile -Value "[$time] TOTAL FAILURE: $($_.Exception.Message)"
    Write-Error "Update failed: $($_.Exception.Message)"
}