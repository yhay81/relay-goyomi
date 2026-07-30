[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WorkerPath = Join-Path $RepoRoot "src\worker.tsx"
$MigrationPath = Join-Path $RepoRoot "migrations\0001_relay.sql"
$StylesPath = Join-Path $RepoRoot "public\styles.css"
$ServiceWorkerPath = Join-Path $RepoRoot "public\sw.js"
$PublicDirectory = Join-Path $RepoRoot "public"

$RequiredFiles = @(
    ".github\workflows\ci.yml",
    ".dev.vars.example",
    "DECISIONS.md",
    "EXPERIMENT.md",
    "METRICS.md",
    "PRIVACY.md",
    "README.md",
    "SECURITY.md",
    "STACK.md",
    "ops\product-metrics.ps1",
    "ops\product-metrics.sql",
    "ops\submit-indexnow.ps1",
    "public\app.js",
    "public\calendar.js",
    "public\common.js",
    "public\entry.js",
    "public\favicon.png",
    "public\join.js",
    "public\manage.js",
    "public\manifest.webmanifest",
    "public\og.png",
    "public\robots.txt",
    "public\sitemap.xml",
    "public\styles.css",
    "public\sw.js"
)
foreach ($RelativePath in $RequiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot $RelativePath))) {
        throw "Missing required release file: $RelativePath"
    }
}

$Worker = Get-Content -Raw -LiteralPath $WorkerPath
$Migration = Get-Content -Raw -LiteralPath $MigrationPath
$Styles = Get-Content -Raw -LiteralPath $StylesPath
$ServiceWorker = Get-Content -Raw -LiteralPath $ServiceWorkerPath
$Scripts = @(
    Get-Content -Raw (Join-Path $PublicDirectory "app.js")
    Get-Content -Raw (Join-Path $PublicDirectory "calendar.js")
    Get-Content -Raw (Join-Path $PublicDirectory "common.js")
    Get-Content -Raw (Join-Path $PublicDirectory "entry.js")
    Get-Content -Raw (Join-Path $PublicDirectory "join.js")
    Get-Content -Raw (Join-Path $PublicDirectory "manage.js")
) -join "`n"
$ProductSurface = @($Worker, $Scripts) -join "`n"

foreach ($VisualClass in @(
    'class="relay-scene"',
    'class="date-card scene-open"',
    'class="date-card scene-held"',
    'class="date-card scene-live"',
    'class="demo-board theme-berry"',
    'class="calendar-board"'
)) {
    if (-not $Worker.Contains($VisualClass)) {
        throw "Missing product visual: $VisualClass"
    }
}
if ($ProductSurface -match '(?i)public validation|success criteria|experiment|仮説|成功条件|市場スコア|移行候補|収益性') {
    throw "Research copy must not appear on the product surface"
}
if ($Styles -match '(?s)h1\s*\{[^}]*font-size:\s*(?:[4-9]\d|[1-9]\d{2})px' -or
    -not $Styles.Contains("clamp(1.75rem, 3.2vw, 2rem)")) {
    throw "Primary heading must remain at or below 32px"
}
if ($ProductSurface -match '(?i)innerHTML|eval\(|new Function') {
    throw "User content must not be interpreted as markup or code"
}
if ($Scripts -match 'fetch\(\s*["'']https?://') {
    throw "Browser scripts must not call third-party endpoints"
}
foreach ($ExpectedFetch in @(
    'fetch("/api/events"',
    'fetch(`/api/calendars/${slug}/report`',
    'fetchJson(`/api/calendars/${slug}/slots`',
    'fetchJson(`/api/calendars/${slug}/manage`',
    'fetchJson(`/api/slots/${id}`'
)) {
    if (-not $Scripts.Contains($ExpectedFetch)) {
        throw "Missing expected same-origin request: $ExpectedFetch"
    }
}
if (-not $Worker.Contains('const slugPattern = /^[A-Za-z0-9_-]{12}$/') -or
    -not $Worker.Contains('const capabilityPattern = /^[A-Za-z0-9_-]{43}$/') -or
    -not $Worker.Contains("randomBase64Url(32)") -or
    -not $Worker.Contains("crypto.subtle.digest")) {
    throw "Expected random public slugs and hashed 256-bit capabilities"
}
foreach ($CapabilityHeader in @(
    "x-relay-goyomi-organizer",
    "x-relay-goyomi-invite",
    "x-relay-goyomi-entry"
)) {
    if (-not $ProductSurface.Contains($CapabilityHeader)) {
        throw "Missing capability boundary: $CapabilityHeader"
    }
}
if (-not $Worker.Contains('url.protocol === "https:"') -or
    -not $Worker.Contains("!url.username") -or
    -not $Worker.Contains('hostname !== "localhost"') -or
    -not $Worker.Contains('!hostname.endsWith(".local")') -or
    -not $Worker.Contains("!hostname.includes")) {
    throw "Expected strict HTTPS and local-network URL boundaries"
}
if (-not $Worker.Contains("count >= 7 && count <= 31") -or
    -not $Worker.Contains("parseJson(c.req.raw, 8192)") -or
    -not $Worker.Contains("createdToday") -or
    -not $Worker.Contains(">= 3")) {
    throw "Expected bounded calendar content and daily creation limit"
}
if (-not $Worker.Contains('c.header("X-Robots-Tag", "noindex, nofollow")') -or
    -not $Worker.Contains("noindex") -or
    $Worker.Contains('app.get("/api/calendars"')) {
    throw "Expected noindex shared calendars and no public directory endpoint"
}
if (-not $Worker.Contains("COUNT(DISTINCT session_id)") -or
    -not $Worker.Contains("reports?.count ?? 0") -or
    -not $Worker.Contains("DELETE FROM calendar_reports WHERE calendar_id = ?") -or
    -not $Worker.Contains('request.headers.get("cf-connecting-ip")') -or
    -not $Worker.Contains("crypto.subtle.sign") -or
    -not $Worker.Contains("c.env.REPORT_HASH_KEY") -or
    -not $Worker.Contains("status = 'hidden'") -or
    -not $Worker.Contains("hiddenCalendarLifetime")) {
    throw "Expected independent reporting, safe reactivation, and hidden-calendar expiry"
}
if ($Worker -match 'style=\{' -or
    $Worker -match "'unsafe-inline'" -or
    -not $Worker.Contains("styleSrc: [""'self'""]")) {
    throw "Expected a strict style CSP without inline styles"
}
if (-not $ServiceWorker.Contains('const cacheName = "relay-goyomi-v1"') -or
    -not $ServiceWorker.Contains('"/common.js"') -or
    -not $ServiceWorker.Contains("cacheablePaths.has(url.pathname)") -or
    $ServiceWorker.Contains('"/c/"') -or
    $ServiceWorker.Contains('"/join/"') -or
    $ServiceWorker.Contains('"/manage/"') -or
    $ServiceWorker.Contains('"/entry/"')) {
    throw "Expected a bounded cache that excludes shared and capability pages"
}
foreach ($Table in @("calendars", "slots", "calendar_reports", "product_events")) {
    if (-not $Migration.Contains("CREATE TABLE $Table")) {
        throw "Database contract is missing: $Table"
    }
}
foreach ($EventName in @(
    "visited",
    "calendar_created",
    "calendar_updated",
    "calendar_opened",
    "join_opened",
    "slot_reserved",
    "slot_updated",
    "slot_published",
    "slot_cancelled",
    "slot_released",
    "outbound_opened",
    "calendar_reported",
    "calendar_deleted",
    "returned"
)) {
    if (-not $Migration.Contains("'$EventName'") -or -not $Worker.Contains("""$EventName""")) {
        throw "Event contract is missing: $EventName"
    }
}
if (-not $Migration.Contains("is_qa") -or
    -not $Migration.Contains("CHECK(name IN") -or
    -not $Migration.Contains("UNIQUE(calendar_id, session_id)") -or
    -not $Migration.Contains("UNIQUE(calendar_id, reporter_hash)") -or
    -not $Worker.Contains('Object.keys(value).sort()')) {
    throw "Expected exact-shape events, independent reports, and a QA boundary"
}
if ($Worker -match '(?i)better-auth|betterAuth') {
    throw "Account authentication is not needed for this capability-based release"
}
if (-not $Worker.Contains("camera=(), geolocation=(), microphone=(), payment=()") -or
    $ProductSurface -match 'navigator\.geolocation|getCurrentPosition|watchPosition|Notification\.requestPermission|getUserMedia') {
    throw "The release must not request sensitive permissions"
}
if (-not $Styles.Contains("@media print")) {
    throw "Expected a readable print layout"
}

$OgPath = Join-Path $PublicDirectory "og.png"
if ((Get-Item -LiteralPath $OgPath).Length -lt 50000) {
    throw "Expected a product-specific raster social card"
}

$KeyFiles = @(
    Get-ChildItem -LiteralPath $PublicDirectory -File |
        Where-Object { $_.Name -match "^[a-zA-Z0-9-]{8,128}\.txt$" }
)
if ($KeyFiles.Count -ne 1) {
    throw "Expected exactly one generated IndexNow key file, found $($KeyFiles.Count)"
}
$Key = (Get-Content -Raw -LiteralPath $KeyFiles[0].FullName).Trim()
if ($Key -ne $KeyFiles[0].BaseName) {
    throw "IndexNow key file name and content do not match"
}

Write-Output "Product release contract is satisfied"
