[CmdletBinding()]
param(
    [switch]$Local
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SqlPath = Join-Path $PSScriptRoot "product-metrics.sql"
$Wrangler = Join-Path $RepoRoot "node_modules\.bin\wrangler.cmd"
$Target = if ($Local) { "--local" } else { "--remote" }
$Sql = (Get-Content $SqlPath) -join " "

$Output = & $Wrangler d1 execute relay-goyomi $Target --json --command $Sql
if ($LASTEXITCODE -ne 0) {
    throw "D1 metrics query failed with exit code $LASTEXITCODE"
}

$Payload = ($Output -join [Environment]::NewLine) | ConvertFrom-Json
$Row = $Payload[0].results[0]
if (-not $Row) {
    throw "D1 metrics query returned no result"
}

function Get-Percent {
    param([int]$Numerator, [int]$Denominator)
    if ($Denominator -eq 0) { return $null }
    return [Math]::Round(($Numerator / $Denominator) * 100, 1)
}

$Visitors = [int]$Row.visitors
$Creators = [int]$Row.creators
$Joiners = [int]$Row.joiners
$Reservers = [int]$Row.reservers
$Publishers = [int]$Row.publishers

[ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    service = "relay-goyomi"
    environment = if ($Local) { "local" } else { "production" }
    funnel = [ordered]@{
        visitors = $Visitors
        creators = $Creators
        joiners = $Joiners
        reservers = $Reservers
        publishers = $Publishers
        calendar_readers = [int]$Row.calendar_readers
        outbound_readers = [int]$Row.outbound_readers
        editors = [int]$Row.editors
        returned = [int]$Row.returned
        reporters = [int]$Row.reporters
        deleters = [int]$Row.deleters
    }
    depth = [ordered]@{
        active_calendars = [int]$Row.active_calendars
        hidden_calendars = [int]$Row.hidden_calendars
        calendars_with_three_reservers = [int]$Row.calendars_with_three_reservers
        calendars_with_five_slots = [int]$Row.calendars_with_five_slots
        calendars_with_three_published = [int]$Row.calendars_with_three_published
        calendars_with_two_outbound_readers = [int]$Row.calendars_with_two_outbound_readers
        qualified_calendars = [int]$Row.qualified_calendars
        calendars_updated_later = [int]$Row.calendars_updated_later
    }
    rates = [ordered]@{
        create_percent = Get-Percent $Creators $Visitors
        join_to_reserve_percent = Get-Percent $Reservers $Joiners
        reserve_to_publish_percent = Get-Percent $Publishers $Reservers
    }
} | ConvertTo-Json -Depth 4
