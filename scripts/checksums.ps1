function Get-AgentAssetChecksum($Content, [string]$AssetName) {
    $text = if ($Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($Content) } else { [string]$Content }
    $found = $null
    foreach ($line in ($text -split "`n")) {
        $normalized = $line.Trim().TrimStart([char]0xFEFF)
        if ($normalized -notmatch '^([0-9a-fA-F]{64})[ \t]+\*?(.+?)\s*$') { continue }
        $hash = $Matches[1].ToLowerInvariant()
        $name = $Matches[2].Trim().Replace('\','/')
        while ($name.StartsWith('./')) { $name=$name.Substring(2) }
        if ($name -ne $AssetName) { continue }
        if ($found -and $found -ne $hash) { throw "Conflicting official checksums for $AssetName" }
        $found=$hash
    }
    if (-not $found) { throw "Official SHA-256 list has no valid entry for $AssetName" }
    return $found
}
