# Run Node.js gateway (install deps if missing)
Set-Location -Path (Split-Path -Path $PSScriptRoot -Parent)
Push-Location .\web
if (-not (Test-Path .\node_modules)) {
    Write-Host "Installing Node dependencies..."
    npm install
}
Write-Host "Starting web gateway (HTTP+WebSocket) on port 3000"
node server.js
Pop-Location
