[CmdletBinding()]
param([switch]$InstallOnly)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$root = $PSScriptRoot
. (Join-Path $root 'scripts/checksums.ps1')
. (Join-Path $root 'scripts/resource-profile.ps1')
. (Join-Path $root 'scripts/python-runtime.ps1')
$resourceProfile=Get-AgentResourceProfile $root
$runtime = Join-Path $root '.runtime'
$downloads = Join-Path $runtime 'downloads'
$nodeDir = Join-Path $runtime 'node'
$ollamaDir = Join-Path $runtime 'ollama'
$model = 'qwen3.5:4b'
$env:OLLAMA_VULKAN = '1'
$env:OLLAMA_NUM_PARALLEL = '1'
$env:OLLAMA_MAX_LOADED_MODELS = '1'
New-Item -ItemType Directory -Force -Path $downloads | Out-Null

function Assert-RuntimeChild([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    $boundary = [IO.Path]::GetFullPath($runtime).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)) { throw 'Installation path escaped the Agent runtime directory.' }
}

function Install-Node {
    $exe = Join-Path $nodeDir 'node.exe'
    if ((Test-Path $exe) -and (& $exe --version 2>&1) -match '^v?(2[4-9]|[3-9]\d)\.') {
        Write-Host 'Agent 內已有合用的 Node.js，略過。'
        return
    }
    . (Join-Path $root 'scripts/node-release.ps1')
    $releaseIndex = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
    $release = Select-AgentNodeRelease $releaseIndex
    if (-not $release) { throw '找不到 Node.js 24 以上的 LTS 版本。' }

    $v = $release.version.TrimStart('v')
    $name = "node-v$v-win-x64.zip"
    $base = "https://nodejs.org/dist/v$v"
    $sum = (Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content
    $hash = Get-AgentAssetChecksum $sum $name
    if (-not $hash) { throw 'Node.js 校驗清單不完整。' }
    $zip = Join-Path $downloads $name
    Invoke-WebRequest "$base/$name" -OutFile $zip -UseBasicParsing
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $hash) { throw 'Node.js SHA-256 校驗失敗。' }

    $stage = Join-Path $runtime 'node-stage'
    Expand-Archive $zip $stage -Force
    Assert-RuntimeChild $nodeDir
    if (Test-Path $nodeDir) { Move-Item $nodeDir (Join-Path $runtime ("node-backup-" + (Get-Date -Format 'yyyyMMddHHmmss'))) }
    Move-Item (Get-ChildItem $stage -Directory | Select-Object -First 1).FullName $nodeDir
    Remove-Item $zip -Force
    Assert-RuntimeChild $stage
    Remove-Item -LiteralPath $stage -Recurse -Force
    Write-Host "Node.js $v 已安裝在 Agent 內。"
}

function Install-Ollama {
    $exe = Join-Path $ollamaDir 'ollama.exe'
    if ((Test-Path $exe) -and ((& $exe --version 2>&1 | Out-String).Trim())) {
        Write-Host 'Agent 內已有 Ollama，略過。'
        return
    }
    $headers = @{ 'User-Agent' = 'BrandSignal-Agent-Setup' }
    $release = Invoke-RestMethod -Headers $headers 'https://api.github.com/repos/ollama/ollama/releases/latest'
    $asset = $release.assets | Where-Object name -eq 'ollama-windows-amd64.zip' | Select-Object -First 1
    $checks = $release.assets | Where-Object name -eq 'sha256sum.txt' | Select-Object -First 1
    if (-not $asset -or -not $checks) { throw 'Ollama 官方發行檔或校驗清單不存在。' }
    $text = (Invoke-WebRequest -Headers $headers $checks.browser_download_url -UseBasicParsing).Content
    $hash = Get-AgentAssetChecksum $text $asset.name
    if ($asset.digest -match '^sha256:([0-9a-fA-F]{64})$' -and $hash -ne $Matches[1]) { throw 'Ollama release metadata and checksum list disagree.' }
    if (-not $hash) { throw 'Ollama 校驗清單不完整。' }
    $zip = Join-Path $downloads $asset.name
    Invoke-WebRequest -Headers $headers $asset.browser_download_url -OutFile $zip -UseBasicParsing
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $hash) { throw 'Ollama SHA-256 校驗失敗。' }

    $stage = Join-Path $runtime 'ollama-stage'
    Expand-Archive $zip $stage -Force
    $exeInZip = Get-ChildItem $stage -Filter 'ollama.exe' -File -Recurse | Select-Object -First 1
    if (-not $exeInZip) { throw 'Ollama 壓縮檔缺少執行檔。' }
    Assert-RuntimeChild $ollamaDir
    if (Test-Path $ollamaDir) { Move-Item $ollamaDir (Join-Path $runtime ("ollama-backup-" + (Get-Date -Format 'yyyyMMddHHmmss'))) }
    Move-Item $exeInZip.Directory.FullName $ollamaDir
    Remove-Item $zip -Force
    if (Test-Path $stage) { Assert-RuntimeChild $stage; Remove-Item -LiteralPath $stage -Recurse -Force }
    Write-Host "Ollama $($release.tag_name) 已安裝在 Agent 內。"
}

function Get-Tags {
    try { Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 } catch { $null }
}

function Has-Model($Tags) {
    return (@($Tags.models | Where-Object { $_.name -eq $model -or $_.name -like "$model-*" }).Count -gt 0)
}

function Ensure-Model($Tags) {
    if (Has-Model $Tags) { Write-Host "$model 已存在，略過下載。"; return }

    if ($Tags) {
        $exe = [IO.Path]::GetFullPath((Join-Path $ollamaDir 'ollama.exe'))
        $localProcess = Get-CimInstance Win32_Process -Filter "Name='ollama.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $exe } | Select-Object -First 1
        if (-not $localProcess) { throw '另一個 Ollama 服務正使用 11434 埠。請先停止它，腳本才會將 Qwen 安裝到 Agent 內。' }
    }

    $env:OLLAMA_HOST = '127.0.0.1:11434'
    $env:OLLAMA_MODELS = Join-Path $ollamaDir 'models'
    $env:OLLAMA_NO_CLOUD = '1'
    New-Item -ItemType Directory -Force -Path $env:OLLAMA_MODELS | Out-Null
    Write-Host "自動下載預設模型 $model（需要數 GB 磁碟空間）…" -ForegroundColor Cyan
    & (Join-Path $ollamaDir 'ollama.exe') pull $model
    if ($LASTEXITCODE -ne 0 -or -not (Has-Model (Get-Tags))) { throw "$model 下載或確認失敗，可重跑本腳本續作。" }
}

try {
    Install-AgentPython $root
    Install-Node
    Install-Ollama

    $tags = Get-Tags
    if (-not $tags) {
        $env:OLLAMA_HOST = '127.0.0.1:11434'
        $env:OLLAMA_MODELS = Join-Path $ollamaDir 'models'
        $env:OLLAMA_NO_CLOUD = '1'
        New-Item -ItemType Directory -Force -Path $env:OLLAMA_MODELS | Out-Null
        $null = Start-Process (Join-Path $ollamaDir 'ollama.exe') 'serve' -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $ollamaDir 'ollama.stdout.log') -RedirectStandardError (Join-Path $ollamaDir 'ollama.stderr.log')
        for ($i = 0; $i -lt 60 -and -not $tags; $i++) { Start-Sleep 1; $tags = Get-Tags }
        if (-not $tags) { throw 'Ollama 啟動失敗，請查看 Agent/.runtime/ollama/ollama.stderr.log。' }
    }
    . (Join-Path $root 'scripts/configure-model.ps1')

    if (-not (Test-Path (Join-Path $root 'node_modules/sharp/package.json')) -or -not (Test-Path (Join-Path $root 'node_modules/undici/package.json'))) {
        Push-Location $root
        try { & (Join-Path $nodeDir 'npm.cmd') install --omit=dev; if ($LASTEXITCODE -ne 0) { throw '圖片處理依賴安裝失敗，請確認網路後重試。' } } finally { Pop-Location }
    }
    if ($InstallOnly) { Write-Host '安裝完成。執行 start-local.cmd 啟動 Agent。'; return }
    & (Join-Path $root 'scripts/start-agent.ps1')
} catch {
    Write-Error $_
    exit 1
}
