function Select-AgentNodeRelease($ReleaseIndex) {
    $selected = $null
    $selectedVersion = [version]'0.0.0'
    # Windows PowerShell 5.1 emits a JSON root array as ONE pipeline object.
    # Enumerate explicitly before accessing each release's scalar fields.
    foreach ($candidate in $ReleaseIndex) {
        if ($candidate.version -isnot [string]) { continue }
        $parsedVersion = $null
        if (-not [version]::TryParse($candidate.version.TrimStart('v'), [ref]$parsedVersion)) { continue }
        if (-not $candidate.lts -or $candidate.files -notcontains 'win-x64-zip' -or $parsedVersion.Major -lt 24) { continue }
        if ($parsedVersion -gt $selectedVersion) {
            $selected=$candidate
            $selectedVersion=$parsedVersion
        }
    }
    if (-not $selected) { throw 'No compatible Node.js 24+ Windows x64 LTS release was found.' }
    return $selected
}
