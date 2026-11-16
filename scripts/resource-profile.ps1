function Get-AgentResourceProfile([string]$AgentRoot) {
 $settingsFile=Join-Path $AgentRoot '.runtime/resource-settings.json'
 $defaults=[ordered]@{cpuThreads=6;cpuAffinityPercent=50;numBatch=128;gpuReserveMiB=2048;cooldownMs=1500;keepAliveSeconds=60}
 if(-not (Test-Path -LiteralPath $settingsFile)){
  New-Item -ItemType Directory -Force -Path (Split-Path $settingsFile -Parent) | Out-Null
  $defaults | ConvertTo-Json | Set-Content -LiteralPath $settingsFile -Encoding UTF8
 }
 $inputSettings=Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
 $logicalCount=[Math]::Min(62,[Environment]::ProcessorCount)
 $limits=@{cpuThreads=@(1,[Math]::Max(1,$logicalCount-2));cpuAffinityPercent=@(10,90);numBatch=@(32,256);gpuReserveMiB=@(256,8192);cooldownMs=@(0,30000);keepAliveSeconds=@(10,600)}
 foreach($key in @($defaults.Keys)){
  $value=$defaults[$key]
  if($inputSettings.PSObject.Properties.Name -contains $key){$value=$inputSettings.$key}
  $parsed=0
  if(-not [int]::TryParse([string]$value,[ref]$parsed)){throw "Invalid resource setting: $key"}
  $defaults[$key]=[Math]::Min($limits[$key][1],[Math]::Max($limits[$key][0],$parsed))
 }
 $allowedMask=(Get-Process -Id $PID).ProcessorAffinity.ToInt64()
 $allowed=@(for($index=0;$index -lt $logicalCount;$index++){if(($allowedMask -band ([long]1 -shl $index)) -ne 0){$index}})
 $count=[Math]::Max(1,[Math]::Floor($allowed.Count*$defaults.cpuAffinityPercent/100))
 $mask=[long]0
 foreach($index in ($allowed | Select-Object -Last $count)){$mask=$mask -bor ([long]1 -shl $index)}
 $env:OLLAMA_GPU_OVERHEAD=[string]([long]$defaults.gpuReserveMiB*1024*1024)
 $env:OLLAMA_NUM_PARALLEL='1';$env:OLLAMA_MAX_LOADED_MODELS='1'
 $env:UV_THREADPOOL_SIZE='2'
 return [pscustomobject]@{settings=$defaults;affinityMask=$mask;logicalProcessors=$count}
}
function Set-AgentProcessResources($Process,[long]$AffinityMask=0) {
 try{$Process.PriorityClass=[Diagnostics.ProcessPriorityClass]::BelowNormal;if($AffinityMask){$Process.ProcessorAffinity=[IntPtr]$AffinityMask}}catch{Write-Warning "Resource priority could not be applied to process $($Process.Id)."}
}
