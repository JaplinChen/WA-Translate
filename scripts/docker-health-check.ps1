param(
    [int]$LogTail = 120,
    [int]$HealthWaitSeconds = 60
)

$ErrorActionPreference = "Stop"

function Write-Section($title) {
    Write-Host ""
    Write-Host "=== $title ==="
}

function Test-PathOrWarn($path, $label) {
    if (Test-Path $path) {
        Write-Host "[OK] ${label}: $path"
        return $true
    }
    Write-Host "[WARN] Missing ${label}: $path"
    return $false
}

Write-Section "Docker availability"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "[FAIL] docker command not found."
    exit 2
}

$composeVersion = docker compose version 2>$null
if (-not $composeVersion) {
    Write-Host "[FAIL] docker compose is not available."
    exit 2
}
Write-Host "[OK] $composeVersion"

Write-Section "Required files"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
$secretFile = Join-Path $root "secrets/gemini_api_keys.txt"
$hasEnv = Test-PathOrWarn $envFile ".env"
$hasSecret = Test-PathOrWarn $secretFile "gemini_api_keys.txt"

Write-Section "Container state"
$deadline = (Get-Date).AddSeconds($HealthWaitSeconds)
$services = @()
do {
    $psOutput = docker compose ps --format json 2>$null
    if (-not $psOutput) {
        Write-Host "[WARN] No compose services are running."
        exit 1
    }

    $services = $psOutput | ConvertFrom-Json
    if ($services -isnot [System.Array]) {
        $services = @($services)
    }

    $hasStarting = $false
    foreach ($svc in $services) {
        if ($svc.Health -eq "starting") {
            $hasStarting = $true
            break
        }
    }

    if ($hasStarting -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
    } else {
        break
    }
} while ($true)

$unhealthy = @()
$notRunning = @()
foreach ($svc in $services) {
    $name = $svc.Name
    $state = $svc.State
    $health = $svc.Health

    if ([string]::IsNullOrWhiteSpace($health)) {
        $health = "n/a"
    }
    Write-Host ("- {0}: state={1}, health={2}" -f $name, $state, $health)

    if ($state -ne "running") {
        $notRunning += $name
    }
    if ($health -eq "unhealthy") {
        $unhealthy += $name
    }
}

Write-Section "Log scan"
$logs = docker compose logs --tail $LogTail 2>&1
$errorPatterns = @("error", "exception", "unhandled", "fatal", "econn", "failed")
$hits = @()
foreach ($line in $logs) {
    foreach ($p in $errorPatterns) {
        if ($line -match $p) {
            $hits += $line
            break
        }
    }
}

if ($hits.Count -eq 0) {
    Write-Host "[OK] No obvious error patterns in last $LogTail log lines."
} else {
    Write-Host "[WARN] Possible error lines (showing first 20):"
    $hits | Select-Object -First 20 | ForEach-Object { Write-Host $_ }
}

Write-Section "Summary"
if ($notRunning.Count -gt 0) {
    Write-Host "[FAIL] Not running: $($notRunning -join ', ')"
    exit 1
}
if ($unhealthy.Count -gt 0) {
    Write-Host "[FAIL] Unhealthy: $($unhealthy -join ', ')"
    exit 1
}
if ($services.Where({ $_.Health -eq "starting" }).Count -gt 0) {
    $startingNames = $services.Where({ $_.Health -eq "starting" }).Name
    Write-Host "[FAIL] Health still starting after ${HealthWaitSeconds}s: $($startingNames -join ', ')"
    exit 1
}
if (-not $hasEnv) {
    Write-Host "[WARN] .env missing."
}
if (-not $hasSecret) {
    Write-Host "[WARN] gemini_api_keys secret missing."
}

Write-Host "[PASS] Docker services look healthy."
exit 0
