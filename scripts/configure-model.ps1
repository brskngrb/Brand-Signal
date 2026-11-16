# Called by setup-agent.ps1 after the portable Ollama service is ready.
$ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$modelCandidates = if ($ramGB -ge 30) { @('qwen3.6:35b','qwen3.6:27b','qwen3.5:9b') } else { @('qwen3.5:9b','qwen3.5:4b') }
$selectedModel = $null
Write-Host "RAM: $ramGB GB. Preferred model: $($modelCandidates[0])."
foreach ($candidate in $modelCandidates) {
    $model = $candidate
    Ensure-Model (Get-Tags)
    Write-Host "Testing $model with a 32K context. Loading may take several minutes."
    try {
        $info = Invoke-RestMethod 'http://127.0.0.1:11434/api/show' -Method Post -ContentType 'application/json' -Body (@{model=$model} | ConvertTo-Json)
        if ($info.capabilities -notcontains 'vision') { throw 'Model does not support images.' }
        $body = @{model=$model;stream=$false;think=$false;messages=@(@{role='user';content='Reply only OK.'});options=@{num_ctx=32768;num_predict=8};keep_alive='1m'} | ConvertTo-Json -Depth 8
        $probe = Invoke-RestMethod 'http://127.0.0.1:11434/api/chat' -Method Post -ContentType 'application/json' -Body $body
        if (-not $probe.done -or -not $probe.message.content) { throw 'Model did not complete the loading test.' }
        $loaded = Invoke-RestMethod 'http://127.0.0.1:11434/api/ps'
        $active = $loaded.models | Where-Object { $_.name -eq $model } | Select-Object -First 1
        @{model=$model;context=32768;ramGB=$ramGB;gpuBytes=$active.size_vram;target='RX 9060 XT 16GB / Ryzen 5700X3D';testedAt=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content (Join-Path $runtime 'agent-model.json') -Encoding UTF8
        if (-not $active.size_vram) { Write-Warning 'Model loaded without detected GPU acceleration. Update the AMD driver and inspect the Ollama logs.' }
        $selectedModel=$model
        Write-Host "Selected: $model" -ForegroundColor Green
        break
    } catch { Write-Warning "$model loading failed: $($_.Exception.Message). Trying the next model." }
}
if (-not $selectedModel) { throw 'All model loading tests failed. Inspect the Ollama logs.' }
