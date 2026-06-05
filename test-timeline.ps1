$apiKey = 'baby-monitor-service-api-key-dev-2024'

function Test-Endpoint {
    param([string]$Url, [string]$Name)

    Write-Host "===== $Name ====="
    Write-Host "URL: $Url"

    try {
        $resp = Invoke-WebRequest -Uri $Url -Method GET -Headers @{'X-Service-API-Key' = $apiKey} -UseBasicParsing
        Write-Host "Status: $($resp.StatusCode)"
        # Pretty print JSON
        try {
            $json = $resp.Content | ConvertFrom-Json
            Write-Host ($json.data | ConvertTo-Json -Depth 10)
        } catch {
            Write-Host $resp.Content
        }
    } catch {
        $ex = $_.Exception
        if ($ex.Response) {
            Write-Host "Status: $($ex.Response.StatusCode.value__)"
            try {
                $stream = $ex.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
                Write-Host $reader.ReadToEnd()
            } catch {
                Write-Host "Error: $($_.Exception.Message)"
            }
        } else {
            Write-Host "Error: $($ex.Message)"
        }
    }
    Write-Host ""
}

# 1. 时间轴 - 全部数据
Test-Endpoint -Url 'http://localhost:6005/api/storage/recordings/device/test-device-001/timeline' -Name '1. Timeline (all data)'

# 2. 时间轴 - 指定日期范围 (2026-04-14)
Test-Endpoint -Url 'http://localhost:6005/api/storage/recordings/device/test-device-001/timeline?startDate=2026-04-14&endDate=2026-04-14' -Name '2. Timeline (single day: 2026-04-14)'

# 3. 时间轴 - 包含未完成录像
Test-Endpoint -Url 'http://localhost:6005/api/storage/recordings/device/test-device-001/timeline?startDate=2026-04-14&endDate=2026-04-14&includeIncomplete=true' -Name '3. Timeline (include incomplete)'

# 4. 连续片段
Test-Endpoint -Url 'http://localhost:6005/api/storage/recordings/device/test-device-001/continuous' -Name '4. Continuous Segments'

# 5. 断点统计
Test-Endpoint -Url 'http://localhost:6005/api/storage/recordings/device/test-device-001/gaps?startDate=2026-04-14&endDate=2026-04-14' -Name '5. Gap Statistics (2026-04-14)'
