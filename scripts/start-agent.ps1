$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$entry = Join-Path $PSScriptRoot 'dev.mjs'
$runtime = Join-Path $projectRoot '.runtime'
$stateFile = Join-Path $runtime 'web-session.json'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
. (Join-Path $PSScriptRoot 'resource-profile.ps1')
$resources=Get-AgentResourceProfile $projectRoot
. (Join-Path $PSScriptRoot 'python-runtime.ps1')
Install-AgentPython $projectRoot
$lastPort = 4173
if (Test-Path -LiteralPath $stateFile) {
    $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $lastPort = [int]$saved.port
    $previous = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
    if ($previous -and $previous.StartTime.ToUniversalTime().ToString('o') -eq $saved.startedAt) {
        $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($previous.Id)"
        if ($details.CommandLine -like "*$entry*") { Stop-Process -Id $previous.Id; $previous.WaitForExit(10000) | Out-Null }
    }
} else {
    $listener = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        if ($details.Name -eq 'node.exe' -and $details.CommandLine -match 'scripts[/\\]dev\.mjs') {
            $matchesAgent = $false
            try { $source = (Invoke-WebRequest 'http://127.0.0.1:4173/app.js' -UseBasicParsing -TimeoutSec 3).Content; $matchesAgent = $source -match 'signal\.use-web-data' -and $source -match 'autoRecognizeOfficialImages' } catch { }
            if ($matchesAgent) { Stop-Process -Id $listener.OwningProcess }
        }
    }
}
$newPort = 59935
$zeroTierHost = '172.23.78.81'
$zeroTierAddress = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $zeroTierHost -ErrorAction SilentlyContinue |
    Where-Object InterfaceAlias -Like 'ZeroTier One*'
if ($zeroTierAddress) { $env:BAKERY_ZEROTIER_HOST = $zeroTierHost }
else { Remove-Item Env:BAKERY_ZEROTIER_HOST -ErrorAction SilentlyContinue }
$env:PORT = [string]$newPort
$candidates = @((Join-Path $projectRoot '.runtime/node/node.exe'), (Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'))
$nodeExecutable = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $nodeExecutable) { $nodeExecutable = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $nodeExecutable) { throw 'Node.js not found. Run setup-agent.ps1 first.' }
$portableOllama = Join-Path $projectRoot '.runtime/ollama/ollama.exe'
$env:AGENT_MANAGED_OLLAMA='0'
if (Test-Path -LiteralPath $portableOllama) {
    $env:OLLAMA_HOST='127.0.0.1:11434'
    $env:OLLAMA_MODELS=Join-Path $projectRoot '.runtime/ollama/models'
    $env:OLLAMA_NO_CLOUD='1'
    $env:OLLAMA_VULKAN='1'
    $env:OLLAMA_NUM_PARALLEL='1'
    $env:OLLAMA_MAX_LOADED_MODELS='1'
    $listener=Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if($listener){
        $details=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        if($details.ExecutablePath -and $details.ExecutablePath -ieq [IO.Path]::GetFullPath($portableOllama)){
            $ownedRoot=[IO.Path]::GetFullPath((Split-Path $portableOllama -Parent)).TrimEnd('\')+'\'
            $all=@(Get-CimInstance Win32_Process);$owned=@([int]$listener.OwningProcess)
            do{$children=@($all | Where-Object { $owned -contains $_.ParentProcessId -and $owned -notcontains $_.ProcessId -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($ownedRoot,[StringComparison]::OrdinalIgnoreCase) });foreach($child in $children){$owned+=[int]$child.ProcessId}}while($children.Count)
            foreach($id in ($owned | Sort-Object -Descending)){Stop-Process -Id $id -ErrorAction SilentlyContinue}
            $process=Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
            if($process){$null=$process.WaitForExit(10000)}
        }else{Write-Warning 'An external Ollama is already running. Agent will limit its own requests, but cannot apply the VRAM reserve to that external service. Restart it with your preferred settings if needed.'}
    }
    $ollamaReady=$false
    try { $null=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2; $ollamaReady=$true } catch { }
    if (-not $ollamaReady) {
        $ollamaService=Start-Process -FilePath $portableOllama -ArgumentList serve -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'ollama.stdout.log') -RedirectStandardError (Join-Path $runtime 'ollama.stderr.log')
        $env:AGENT_MANAGED_OLLAMA='1'
        Set-AgentProcessResources $ollamaService $resources.affinityMask
        $guardScript=Join-Path $PSScriptRoot 'resource-guard.ps1'
        $guardArgs=@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$guardScript+'"'),'-ServerPid',[string]$ollamaService.Id,'-StartedAt',$ollamaService.StartTime.ToUniversalTime().ToString('o'),'-AgentRoot',('"'+$projectRoot+'"'),'-CpuMask',[string]$resources.affinityMask)
        Start-Process -FilePath 'powershell.exe' -ArgumentList $guardArgs -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'resource-guard.stdout.log') -RedirectStandardError (Join-Path $runtime 'resource-guard.stderr.log') | Out-Null
        for($i=0;$i -lt 60 -and -not $ollamaReady;$i++) { Start-Sleep -Milliseconds 500; try { $null=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 1; $ollamaReady=$true } catch { } }
        if (-not $ollamaReady) { throw 'Ollama failed to start. Inspect .runtime/ollama.stderr.log.' }
    }
} else {
    $ollamaStarter = Join-Path $projectRoot '../ollama-local/start-ollama.ps1'
    if (Test-Path -LiteralPath $ollamaStarter) { & $ollamaStarter }
}
$service = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $entry + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'web.stdout.log') -RedirectStandardError (Join-Path $runtime 'web.stderr.log')
Set-AgentProcessResources $service
Write-Host "Headroom mode: Ollama uses $($resources.logicalProcessors) logical processors, $($resources.settings.cpuThreads) inference threads, and a $($resources.settings.gpuReserveMiB) MiB VRAM reserve request." -ForegroundColor Cyan
@{pid=$service.Id;startedAt=$service.StartTime.ToUniversalTime().ToString('o');port=$newPort} | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
for ($attempt=0; $attempt -lt 60; $attempt++) {
    if ($service.HasExited) { throw "Agent failed to start. Check $runtime/web.stderr.log" }
    try { $null = Invoke-WebRequest "http://127.0.0.1:$newPort/api/health" -UseBasicParsing -TimeoutSec 1; Write-Host "Agent ready: http://localhost:$newPort/" -ForegroundColor Green; return } catch { Start-Sleep -Milliseconds 500 }
}
throw "Startup timed out. Check $runtime/web.stderr.log"
