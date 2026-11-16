param([string]$AgentPath,[switch]$ResolveOnly)
$ErrorActionPreference='Stop'
$payload=Join-Path $PSScriptRoot 'Agent'
if(-not (Test-Path -LiteralPath (Join-Path $payload 'package.json'))){throw 'Agent payload is missing. Extract the entire ZIP first.'}
if(-not $AgentPath){
 Add-Type -AssemblyName System.Windows.Forms
 $picker=New-Object System.Windows.Forms.FolderBrowserDialog
 $picker.Description='選擇原本 Agent 或它的外層安裝資料夾（不要選這次更新包）。'
 if($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK){return}
 $AgentPath=$picker.SelectedPath
}

function Get-NormalPath([string]$Value) {
 return [IO.Path]::GetFullPath($Value).Replace('/','\').TrimEnd('\')
}
function Test-AgentFolder([string]$Folder) {
 $manifest=Join-Path $Folder 'package.json'
 if(-not (Test-Path -LiteralPath $manifest -PathType Leaf)){return $false}
 try{$metadata=Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json}catch{return $false}
 foreach($required in @('scripts/dev.mjs','scripts/local-library.mjs','src/app.js','worker/index.js')){
  if(-not (Test-Path -LiteralPath (Join-Path $Folder $required) -PathType Leaf)){return $false}
 }
 if($metadata.name -eq 'brand-signal'){return $true}
 # Older installations may have renamed package metadata. Check the actual application.
 $app=Get-Content -LiteralPath (Join-Path $Folder 'src/app.js') -Raw -Encoding UTF8
 return ($app -match 'signal\.settings' -and $app -match 'probeLocalModel')
}
$selected=(Get-Item -LiteralPath $AgentPath -ErrorAction Stop)
if(-not $selected.PSIsContainer){$selected=$selected.Directory}
$selectedPath=Get-NormalPath $selected.FullName
$payload=Get-NormalPath $payload
$target=$null
if(Test-AgentFolder $selectedPath){$target=$selectedPath}
elseif(Test-AgentFolder (Join-Path $selectedPath 'Agent')){$target=Get-NormalPath (Join-Path $selectedPath 'Agent')}
else{
 $candidates=@()
 foreach($child in (Get-ChildItem -LiteralPath $selectedPath -Directory -ErrorAction SilentlyContinue)){
  foreach($candidate in @($child.FullName,(Join-Path $child.FullName 'Agent'))){
   if(Test-AgentFolder $candidate){$candidates+=Get-NormalPath $candidate}
  }
 }
 $candidates=@($candidates | Sort-Object -Unique)
 if($candidates.Count -eq 1){$target=$candidates[0]}
 elseif($candidates.Count -gt 1){throw "此資料夾包含多套 Agent，請選你實際使用的安裝資料夾：`n$($candidates -join "`n")"}
}
if(-not $target){throw "找不到原本的 Agent 程式。你選擇的是：$selectedPath`n請選原本含 start.bat、package.json 和 scripts 的資料夾，或其外層安裝資料夾。請先完整解壓縮，不要從壓縮檔內直接執行。"}
if($target -ieq $payload){throw "你選到這次更新包內的 Agent。請選原本存有資料與模型的 Agent；全新安裝請執行本包 Agent/setup.bat。"}
Write-Host "已找到原本 Agent：$target" -ForegroundColor Cyan
if($ResolveOnly){Write-Output $target;return}

# Only release-listed application files are eligible. Runtime/database folders in
# a previously launched payload are ignored without even traversing them.
$releaseManifest=Join-Path $PSScriptRoot 'payload-manifest.json'
if(-not (Test-Path -LiteralPath $releaseManifest -PathType Leaf)){throw '更新清單遺失：請完整解壓修正版更新包，保留 payload-manifest.json 與 Agent 資料夾。'}
$listed=Get-Content -LiteralPath $releaseManifest -Raw -Encoding UTF8 | ConvertFrom-Json
if(-not $listed.Count){throw '更新清單為空，未更新任何檔案。'}
$files=@()
$seen=@{}
foreach($item in $listed){
 $relative=[string]$item.path
 if([string]::IsNullOrWhiteSpace($relative) -or [IO.Path]::IsPathRooted($relative) -or $relative -match '[:\x00-\x1f]' -or ($relative -split '[/\\]') -contains '..'){throw '更新清單含有無效路徑。'}
 $relative=$relative.Replace('/','\')
 if($relative -match '^(?:data|\.runtime|node_modules|\.updates|\.git)(?:\\|$)' -or $relative -ieq '.env'){throw '更新清單不可包含模型、資料庫或個人設定。'}
 $source=Get-NormalPath (Join-Path $payload $relative)
 $destination=Get-NormalPath (Join-Path $target $relative)
 if(-not $source.StartsWith($payload+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $destination.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw '更新清單路徑超出 Agent 範圍。'}
 if($seen.ContainsKey($destination)){throw '更新清單有重複路徑。'}
 $seen[$destination]=$true
 foreach($pair in @(@($source,$payload),@($destination,$target))){
  $check=$pair[0]
  while($check.Length -gt $pair[1].Length){
   if(Test-Path -LiteralPath $check){$entryItem=Get-Item -LiteralPath $check -Force;if($entryItem.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "更新檔案路徑包含連結，未更新：$check"}}
   $check=Split-Path $check -Parent
  }
 }
 if(-not (Test-Path -LiteralPath $source -PathType Leaf)){throw "更新包缺少程式檔：$relative。請重新完整解壓。"}
 if([string]$item.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ine [string]$item.sha256){throw "程式檔校驗失敗：$relative。請重新完整解壓更新包，不需刪除原本模型。"}
 $files+=@{source=$source;relative=$relative;target=$destination}
}
Write-Host "已核對 $($files.Count) 個程式檔；更新來源內的模型、資料庫、依賴與設定會略過。" -ForegroundColor Cyan
$entry=Join-Path $target 'scripts/dev.mjs'
$stateFile=Join-Path $target '.runtime/web-session.json'
if(Test-Path -LiteralPath $stateFile){
 $saved=Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
 $previous=Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
 if($previous -and $previous.StartTime.ToUniversalTime() -eq ([datetime]$saved.startedAt).ToUniversalTime()){
  $details=Get-CimInstance Win32_Process -Filter "ProcessId=$($previous.Id)"
  if($details.CommandLine -match [regex]::Escape($entry)){Stop-Process -Id $previous.Id; $null=$previous.WaitForExit(10000)}
 }
}
$backup=Join-Path $target ('.updates/v8.2-upgrade-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff'))

$copied=@()
foreach($file in $files){
 $destination=$file.target
 $old=Join-Path $backup $file.relative
 if(Test-Path -LiteralPath $destination){New-Item -ItemType Directory -Force -Path (Split-Path $old -Parent) | Out-Null; Copy-Item -LiteralPath $destination -Destination $old}
 $copied+=@{source=$file.source;target=$destination;old=$old;existed=(Test-Path -LiteralPath $destination)}
}

try{
 foreach($file in $copied){New-Item -ItemType Directory -Force -Path (Split-Path $file.target -Parent) | Out-Null; Copy-Item -LiteralPath $file.source -Destination $file.target -Force}
}catch{
 foreach($file in $copied){if(Test-Path -LiteralPath $file.old){Copy-Item -LiteralPath $file.old -Destination $file.target -Force}}
 throw
}
Write-Host 'Agent v8.2 updated (V7 upgrade supported). Your database, models, installed dependencies and .env were preserved.' -ForegroundColor Green
Write-Host "Code backup: $backup"
Write-Host 'Run start.bat to install bundled Python and activate Agent. Resource controls are on the API settings page.'
