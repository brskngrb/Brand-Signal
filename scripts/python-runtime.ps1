function Install-AgentPython([string]$AgentRoot) {
 $ErrorActionPreference='Stop'
 $runtime=[IO.Path]::GetFullPath((Join-Path $AgentRoot '.runtime'))
 $destination=Join-Path $runtime 'python'
 $exe=Join-Path $destination 'python.exe'
 if(Test-Path -LiteralPath $exe){
  $existingPaths=Join-Path $destination 'python313._pth'
  if(Test-Path -LiteralPath $existingPaths){@('python313.zip','.','..\..') | Set-Content -LiteralPath $existingPaths -Encoding ASCII}
  $result=& $exe -X utf8 (Join-Path $AgentRoot 'agent.py') --check
  if($LASTEXITCODE -eq 0 -and ($result | ConvertFrom-Json).ready){$env:AGENT_PYTHON=$exe;return}
 }
 $name='python-3.13.12-embed-amd64.zip'
 $expected='76f238f606250c87c6beac75dccd35ee99070a13490555936abb6cb64ecce3d0'
 $zip=Join-Path $AgentRoot ('vendor/'+$name)
 if(-not (Test-Path -LiteralPath $zip)){
  $downloads=Join-Path $runtime 'downloads'
  New-Item -ItemType Directory -Force -Path $downloads | Out-Null
  $zip=Join-Path $downloads $name
  [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest ('https://www.python.org/ftp/python/3.13.12/'+$name) -OutFile $zip -UseBasicParsing
 }
 if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $expected){throw 'Python SHA-256 verification failed. Extract a fresh package.'}
 New-Item -ItemType Directory -Force -Path $runtime | Out-Null
 $stage=Join-Path $runtime ('python-stage-'+[guid]::NewGuid())
 Expand-Archive -LiteralPath $zip -DestinationPath $stage
 # Embedded Python isolates imports; explicitly include the Agent root for tools.py/database.py.
 $paths=Join-Path $stage 'python313._pth'
 @('python313.zip','.','..\..') | Set-Content -LiteralPath $paths -Encoding ASCII
 if(Test-Path -LiteralPath $destination){Move-Item -LiteralPath $destination -Destination (Join-Path $runtime ('python-backup-'+[guid]::NewGuid()))}
 Move-Item -LiteralPath $stage -Destination $destination
 $result=& $exe -X utf8 (Join-Path $AgentRoot 'agent.py') --check
 if($LASTEXITCODE -ne 0 -or -not ($result | ConvertFrom-Json).ready){throw 'Python Agent runtime self-check failed.'}
 $env:AGENT_PYTHON=$exe
 Write-Host 'Python Agent installed inside Agent/.runtime/python.' -ForegroundColor Green
}
