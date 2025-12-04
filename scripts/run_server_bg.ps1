# Start the C++ server (server.exe) in background and print PID
Set-Location 'C:\Users\computer\Desktop\FastChat'
$exe1 = Get-Item -Path .\build\server.exe -ErrorAction SilentlyContinue
if (-not $exe1) { $exe1 = Get-Item -Path .\build\broker.exe -ErrorAction SilentlyContinue }
if (-not $exe1) { Write-Error "Cannot find server executable in build\"; exit 1 }
$proc = Start-Process -FilePath $exe1.FullName -WindowStyle Hidden -PassThru
Write-Host "Started server (PID=" + $proc.Id + ")"
