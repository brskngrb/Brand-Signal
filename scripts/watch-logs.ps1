$Host.UI.RawUI.WindowTitle='AI Agent - Backend Logs'
$runtime=Join-Path $PSScriptRoot '../.runtime'
$offsets=@{}
while($true){
 foreach($name in @('web.stdout.log','web.stderr.log','ollama.stdout.log','ollama.stderr.log')){
  $path=Join-Path $runtime $name
  if(Test-Path -LiteralPath $path){
   $lines=@(Get-Content -LiteralPath $path -ErrorAction SilentlyContinue)
   $start=0;if($offsets.ContainsKey($name) -and $offsets[$name] -le $lines.Count){$start=$offsets[$name]}
   for($i=$start;$i -lt $lines.Count;$i++){Write-Host "[$name] $($lines[$i])"}
   $offsets[$name]=$lines.Count
  }
 }
 Start-Sleep -Milliseconds 500
}
