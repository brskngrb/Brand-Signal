param([int]$ServerPid,[string]$StartedAt,[string]$AgentRoot,[long]$CpuMask)
$ErrorActionPreference='Stop'
. (Join-Path $AgentRoot 'scripts/resource-profile.ps1')
$ollamaRoot=[IO.Path]::GetFullPath((Join-Path $AgentRoot '.runtime/ollama')).TrimEnd('\')+'\'
while($true){
 $server=Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
 if(-not $server -or $server.StartTime.ToUniversalTime() -ne ([datetime]$StartedAt).ToUniversalTime()){break}
 try{$profile=Get-AgentResourceProfile $AgentRoot;$CpuMask=$profile.affinityMask}catch{Write-Warning 'Unable to refresh resource profile; keeping previous CPU limits.'}
 $all=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
 $owned=@($ServerPid)
 do{
  $children=@($all | Where-Object { $owned -contains $_.ParentProcessId -and $owned -notcontains $_.ProcessId -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($ollamaRoot,[StringComparison]::OrdinalIgnoreCase) })
  foreach($child in $children){$owned+= [int]$child.ProcessId}
 }while($children.Count)
 foreach($id in $owned){$process=Get-Process -Id $id -ErrorAction SilentlyContinue;if($process){Set-AgentProcessResources $process $CpuMask}}
 Start-Sleep -Seconds 2
}
