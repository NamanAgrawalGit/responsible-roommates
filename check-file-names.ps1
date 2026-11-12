# check-file-names.ps1
#
# Catches the "works on my computer, 404 on GitHub Pages" mistake.
# Windows ignores upper/lower case in file names, but GitHub Pages does not,
# so a page that says src="balanceCalc.js" breaks online if Git stored the
# file as Balancecalc.js. This script compares every local file a page
# refers to against the exact names Git tracks.
#
# Run it from anywhere inside the project, BEFORE you push:
#   powershell -ExecutionPolicy Bypass -File .\check-file-names.ps1
#
# It reports, and exits with code 1 if anything is wrong:
#   CASE MISMATCH : referenced name differs from the tracked name only by case
#   NOT TRACKED   : the file exists but Git does not track it (run git add)
#   MISSING       : no file with that name exists at all
# It only reads files. It never changes anything.

$ErrorActionPreference = 'Stop'

$root = (git rev-parse --show-toplevel).Trim()
Set-Location $root

# Names exactly as Git stores them (this is what GitHub Pages will serve).
$tracked = @(git ls-files) | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
# New files that have not been added to Git yet.
$untracked = @(git ls-files --others --exclude-standard) | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }

$trackedExact = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
$untrackedExact = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
$trackedByLower = @{}
$untrackedByLower = @{}
foreach ($t in $tracked) { [void]$trackedExact.Add($t); $trackedByLower[$t.ToLowerInvariant()] = $t }
foreach ($u in $untracked) { [void]$untrackedExact.Add($u); $untrackedByLower[$u.ToLowerInvariant()] = $u }

$extPattern = 'html|js|css|png|jpe?g|svg|ico|gif|webp'
$attrRegex = '(?:src|href)\s*=\s*["'']([^"'']+)["'']'
$stringRegex = '["'']([A-Za-z0-9_./\-]+\.(?:' + $extPattern + '))["'']'
$cssUrlRegex = 'url\(\s*["'']?([^)"'']+)["'']?\s*\)'

function Get-References([string]$path) {
    $text = Get-Content -LiteralPath $path -Raw
    if ($null -eq $text) { return @() }
    $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
    $found = @()
    if ($ext -eq '.html') {
        foreach ($m in [regex]::Matches($text, $attrRegex)) { $found += $m.Groups[1].Value }
        foreach ($m in [regex]::Matches($text, $stringRegex)) { $found += $m.Groups[1].Value }
    } elseif ($ext -eq '.js') {
        foreach ($m in [regex]::Matches($text, $stringRegex)) { $found += $m.Groups[1].Value }
    } elseif ($ext -eq '.css') {
        foreach ($m in [regex]::Matches($text, $cssUrlRegex)) { $found += $m.Groups[1].Value }
    }
    return $found
}

# Turn a reference into a project-relative path with forward slashes.
function Resolve-Reference([string]$fromFile, [string]$ref) {
    if ($ref -match '^(?i:https?:|//|#|mailto:|tel:|data:|javascript:)') { return $null }
    $ref = ($ref -replace '[?#].*$', '').Trim()
    if ($ref -eq '') { return $null }
    $last = ($ref -split '/')[-1]
    if ($last -notmatch ('\.(?i:' + $extPattern + ')$')) { return $null }

    if ($ref.StartsWith('/')) {
        $combined = $ref.TrimStart('/')
    } else {
        # JavaScript runs inside pages at the project root; HTML and CSS
        # resolve from their own folder.
        $dir = ''
        if ($fromFile -notmatch '\.js$') {
            $slash = $fromFile.LastIndexOf('/')
            if ($slash -ge 0) { $dir = $fromFile.Substring(0, $slash) }
        }
        if ($dir -eq '') { $combined = $ref } else { $combined = $dir + '/' + $ref }
    }

    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($seg in ($combined -split '/')) {
        if ($seg -eq '' -or $seg -eq '.') { continue }
        if ($seg -eq '..') {
            if ($parts.Count -gt 0) { $parts.RemoveAt($parts.Count - 1) }
            continue
        }
        $parts.Add($seg)
    }
    return ($parts -join '/')
}

$scanFiles = @($tracked + $untracked) | Where-Object { $_ -match '\.(html|js|css)$' } | Sort-Object -Unique

$problems = New-Object System.Collections.Generic.List[string]
$seen = New-Object System.Collections.Generic.HashSet[string]
$checked = 0

foreach ($file in $scanFiles) {
    if (-not (Test-Path -LiteralPath $file)) { continue }
    foreach ($ref in (Get-References $file)) {
        $target = Resolve-Reference $file $ref
        if ($null -eq $target) { continue }

        $key = $file + '|' + $target
        if (-not $seen.Add($key)) { continue }
        $checked++

        if ($trackedExact.Contains($target)) { continue }

        $lower = $target.ToLowerInvariant()
        if ($trackedByLower.ContainsKey($lower)) {
            $problems.Add("CASE MISMATCH  $file refers to '$target' but Git tracks it as '" + $trackedByLower[$lower] + "'")
        } elseif ($untrackedExact.Contains($target)) {
            $problems.Add("NOT TRACKED    $file refers to '$target', which Git does not track yet (run: git add $target)")
        } elseif ($untrackedByLower.ContainsKey($lower)) {
            $problems.Add("CASE MISMATCH  $file refers to '$target' but the file on disk is '" + $untrackedByLower[$lower] + "' (and not tracked yet)")
        } else {
            $problems.Add("MISSING        $file refers to '$target', but no such file exists")
        }
    }
}

Write-Host ("Checked {0} file reference(s) in {1} file(s)." -f $checked, $scanFiles.Count)

if ($problems.Count -gt 0) {
    Write-Host ''
    foreach ($p in $problems) { Write-Host $p }
    Write-Host ''
    Write-Host ("{0} problem(s) found. Fix them before you push." -f $problems.Count)
    exit 1
}

Write-Host 'All file names match exactly. Safe for GitHub Pages.'
exit 0