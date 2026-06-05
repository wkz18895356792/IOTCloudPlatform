$token = 'baby-monitor-webhook-token-2024'
$baseUrl = 'http://localhost:6005/api/storage/webhooks/events'

function Test-Webhook {
    param([string]$Name, [string]$Url, [object]$Body, [string]$Method = 'POST')

    Write-Host "===== $Name ====="
    Write-Host "URL: $Url"
    $jsonBody = $Body | ConvertTo-Json -Depth 10
    Write-Host "Body: $jsonBody"

    try {
        $resp = Invoke-WebRequest -Uri $Url -Method $Method -Body $jsonBody -Headers @{'Content-Type'='application/json'} -UseBasicParsing
        Write-Host "Status: $($resp.StatusCode)"
        Write-Host $resp.Content
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

# ========== Test 1: Invalid token ==========
Test-Webhook -Name "1. Invalid token (should 401)" -Url "$baseUrl`?token=wrong-token" -Body @{}

# ========== Test 2: S3 Event - create new recording ==========
$s3Event = @{
    Records = @(
        @{
            eventName = "ObjectCreated:Put"
            eventTime = "2026-04-14T16:00:00.000Z"
            s3 = @{
                bucket = @{ name = "video-storage" }
                object = @{
                    key = "recordings/device-webhook-001/2026/04/14/16/20260414T160000_300.ts"
                    size = 8388608
                    eTag = "abc123def456"
                }
            }
            responseElements = @{
                "x-amz-request-id" = "REQ-WH-001"
            }
        }
    )
}
Test-Webhook -Name "2. S3 Event - create new recording" -Url "$baseUrl`?token=$token" -Body $s3Event

# ========== Test 3: S3 Event - same file (idempotent) ==========
Test-Webhook -Name "3. S3 Event - duplicate (idempotent)" -Url "$baseUrl`?token=$token" -Body $s3Event

# ========== Test 4: COS Event ==========
$cosEvent = @{
    Records = @(
        @{
            eventTime = "2026-04-14T17:00:00.000Z"
            eventName = "cos:ObjectCreated:Put"
            cos = @{
                bucket = @{ name = "video-storage-1234567890" }
                object = @{
                    key = "recordings/device-cos-001/2026/04/14/17/20260414T170000_600.ts"
                    size = 16777216
                    eTag = "cos-etag-001"
                }
            }
            requestId = "COS-REQ-001"
        }
    )
}
Test-Webhook -Name "4. COS Event - create new recording" -Url "$baseUrl/tencent_cos`?token=$token" -Body $cosEvent

# ========== Test 5: OSS Event ==========
$ossEvent = @{
    events = @(
        @{
            eventName = "ObjectCreated:PutObject"
            eventTime = "2026-04-14T18:00:00.000Z"
            oss = @{
                bucket = @{ name = "video-storage" }
                object = @{
                    key = "recordings/device-oss-001/2026/04/14/18/20260414T180000_120.ts"
                    size = 2097152
                    eTag = "oss-etag-001"
                }
            }
            requestId = "OSS-REQ-001"
        }
    )
}
Test-Webhook -Name "5. OSS Event - create new recording" -Url "$baseUrl/aliyun_oss`?token=$token" -Body $ossEvent

# ========== Test 6: Non-recording file (should ignore) ==========
$nonRecordingEvent = @{
    Records = @(
        @{
            eventName = "ObjectCreated:Put"
            eventTime = "2026-04-14T19:00:00.000Z"
            s3 = @{
                bucket = @{ name = "video-storage" }
                object = @{
                    key = "thumbnails/device-001/2026/04/14/thumb.jpg"
                    size = 102400
                    eTag = "thumb-001"
                }
            }
        }
    )
}
Test-Webhook -Name "6. Non-recording file (should ignore)" -Url "$baseUrl`?token=$token" -Body $nonRecordingEvent

# ========== Test 7: Auto-detect provider ==========
$autoDetectEvent = @{
    Records = @(
        @{
            eventName = "ObjectCreated:Put"
            eventTime = "2026-04-14T20:00:00.000Z"
            s3 = @{
                bucket = @{ name = "video-storage" }
                object = @{
                    key = "recordings/device-auto-001/2026/04/14/20/20260414T200000.ts"
                    size = 4194304
                    eTag = "auto-etag-001"
                }
            }
        }
    )
}
Test-Webhook -Name "7. Auto-detect S3 provider" -Url "$baseUrl`?token=$token" -Body $autoDetectEvent

# ========== Test 8: Verify recordings via timeline API ==========
Write-Host "===== 8. Verify created recordings ====="
try {
    $resp = Invoke-WebRequest -Uri 'http://localhost:6005/api/storage/recordings/device-webhook-001/timeline' -Method GET -Headers @{'X-Service-API-Key'='baby-monitor-service-api-key-dev-2024'} -UseBasicParsing
    Write-Host "Status: $($resp.StatusCode)"
    $json = $resp.Content | ConvertFrom-Json
    Write-Host ($json.data | ConvertTo-Json -Depth 5)
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
