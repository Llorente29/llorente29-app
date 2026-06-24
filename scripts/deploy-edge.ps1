<#
.SYNOPSIS
  Despliega una Edge Function a Supabase sorteando el problema conocido de McAfee
  (cuarentena de node_modules\@supabase\cli-windows-x64\bin\supabase.exe -> ENOENT).

.DESCRIPTION
  Si supabase.exe no existe pero sí supabase-go.exe (el binario real del CLI),
  fija SUPABASE_CLI_BINARY_OVERRIDE apuntando a supabase-go.exe y lanza el deploy.
  Si supabase.exe existe, usa el flujo normal.

  El Edge se despliega SIN --no-verify-jwt (lo invoca un usuario con sesion, no es webhook).

.PARAMETER FunctionName
  Nombre de la funcion a desplegar. Por defecto: hubrise-catalog-publish.

.PARAMETER ProjectRef
  Project ref de Supabase. Por defecto: xzmpnchlguibclvxyynt.

.EXAMPLE
  pwsh scripts\deploy-edge.ps1
  pwsh scripts\deploy-edge.ps1 -FunctionName otra-funcion
#>
param(
  [string]$FunctionName = "hubrise-catalog-publish",
  [string]$ProjectRef   = "xzmpnchlguibclvxyynt"
)

$ErrorActionPreference = "Stop"

# Raiz del repo = carpeta padre de /scripts
$repoRoot = Split-Path -Parent $PSScriptRoot
$binDir   = Join-Path $repoRoot "node_modules\@supabase\cli-windows-x64\bin"
$exe      = Join-Path $binDir "supabase.exe"
$goExe    = Join-Path $binDir "supabase-go.exe"

if (-not (Test-Path $exe)) {
  if (Test-Path $goExe) {
    Write-Host "[deploy-edge] supabase.exe ausente (McAfee?). Usando override -> supabase-go.exe" -ForegroundColor Yellow
    $env:SUPABASE_CLI_BINARY_OVERRIDE = $goExe
  } else {
    Write-Error "No se encuentra ni supabase.exe ni supabase-go.exe en $binDir. Reinstala: npm install --save-dev supabase@latest --force"
    exit 1
  }
}

Write-Host "[deploy-edge] Desplegando '$FunctionName' en project $ProjectRef (sin --no-verify-jwt)..." -ForegroundColor Cyan
npx supabase functions deploy $FunctionName --project-ref $ProjectRef
exit $LASTEXITCODE
