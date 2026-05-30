# cierre-sesion.ps1 - Cierre EJECUTOR de sesion Folvy
# ------------------------------------------------------
# EJECUTA el cierre de un tramo de corrido: build -> chequeo .md -> add explicito
# -> commit -> push. Solo se PARA si algo falla, mostrando la causa concreta.
# Un comando -> "CIERRE OK" o "CIERRE DETENIDO: causa".  (sustituye al verificador
# interactivo anterior: ver seccion 14.10 del CONTEXTO).
#
# USO (desde la raiz del repo):
#   .\scripts\cierre-sesion.ps1 -Message "feat(escandallos): E1 cantidad editable + latido"
#   .\scripts\cierre-sesion.ps1 -Message "..." -Add @("src/modules/x/Nuevo.tsx","docs/y.md")
#   .\scripts\cierre-sesion.ps1 -Message "docs: cierre seccion 14" -SkipBuild
#   .\scripts\cierre-sesion.ps1 -Message "lo que sea" -DryRun   (ENSAYO: no commit, no push)
#
# QUE STAGEA:
#   - git add -u  -> TODAS las modificaciones/borrados de ficheros YA trackeados.
#   - -Add        -> ficheros NUEVOS (untracked) que indiques explicitamente.
#   - El resto de untracked (otra feature, datos confidenciales) QUEDA FUERA y se lista.
#
# -DryRun: hace build + stage + chequeos y te enseña que commitearia/pushearia,
#   pero NO commitea, NO pushea, y RESTAURA el index a como estaba. Para probar sin riesgo.
#
# ASCII puro a proposito (sin tildes ni guiones largos) para PS 5.1 en cualquier consola.

param(
  [Parameter(Mandatory = $true)][string]$Message,
  [string[]]$Add = @(),
  [switch]$SkipBuild,
  [switch]$DryRun
)

# Script lleno de comandos git nativos: gobernamos por exit code, no por excepciones.
$ErrorActionPreference = 'Continue'

# --- Patrones de datos confidenciales del cliente (segundo cinturon; .gitignore es el primero).
# Si un .json en stage contiene alguno de estos tokens en el nombre, el cierre PARA.
# Julio: confirma/ajusta a las rutas reales de tus JSON confidenciales.
$BLOQUEADOS_JSON = @('bills', 'catalog', 'location', 'factura', 'pedido')

# --- Utilidades de salida ---
function Write-Head($n, $txt) { Write-Host ""; Write-Host "[$n/6] $txt" -ForegroundColor Cyan }
function Ok($txt)   { Write-Host "  OK    $txt" -ForegroundColor Green }
function Info($txt) { Write-Host "  ..    $txt" -ForegroundColor DarkGray }
function Warn($txt) { Write-Host "  AVISO $txt" -ForegroundColor Yellow }

function Stop-Cierre($txt) {
  Write-Host ""
  Write-Host "=========================================" -ForegroundColor Red
  Write-Host " CIERRE DETENIDO - causa concreta:"        -ForegroundColor Red
  $txt -split "`n" | ForEach-Object { Write-Host "   $_" -ForegroundColor Red }
  Write-Host " Nada nuevo se ha pusheado. Arregla la causa y vuelve a lanzar." -ForegroundColor Red
  Write-Host "=========================================" -ForegroundColor Red
  exit 1
}

# Ejecuta git capturando salida+stderr y exit code, sin abortar el script.
function Invoke-Git([string[]]$GitArgs) {
  $out  = & git @GitArgs 2>&1
  $code = $LASTEXITCODE
  return [pscustomobject]@{ Code = $code; Out = ($out -join "`n") }
}

# --- Situarse en la raiz del repo ---
$root = (git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($root)) {
  Stop-Cierre "No estas dentro de un repositorio git."
}
Set-Location $root

$modo = if ($DryRun) { "ENSAYO (DryRun: no commit / no push)" } else { "EJECUTOR" }
Write-Host "=========================================" -ForegroundColor White
Write-Host " CIERRE DE SESION FOLVY ($modo)"           -ForegroundColor White
Write-Host " Repo: $root"                               -ForegroundColor DarkGray
Write-Host " Mensaje: $Message"                         -ForegroundColor DarkGray
Write-Host "=========================================" -ForegroundColor White

# Snapshot del index ANTES de tocar nada (para poder restaurarlo en DryRun).
$preStaged = @(git diff --cached --name-only | Where-Object { $_ -ne "" })

# ---------------------------------------------------------------------------
# PASO 1/6 - Build
# ---------------------------------------------------------------------------
Write-Head 1 "Build (npm run build)"
if ($SkipBuild) {
  Warn "Build OMITIDO por -SkipBuild (declaras sesion solo-docs)."
} else {
  Info "Ejecutando npm run build (puede tardar)..."
  $buildLog = Join-Path $env:TEMP "folvy_build.log"
  cmd /c "npm run build > `"$buildLog`" 2>&1"
  $buildExit = $LASTEXITCODE
  if ($buildExit -ne 0) {
    $tail = ""
    if (Test-Path $buildLog) { $tail = (Get-Content $buildLog -Tail 25) -join "`n" }
    Stop-Cierre "El build FALLA (exit $buildExit). Log: $buildLog`n--- ultimas lineas ---`n$tail"
  }
  Ok "Build limpio (exit 0)."
}

# ---------------------------------------------------------------------------
# PASO 2/6 - Stage explicito y seguro
# ---------------------------------------------------------------------------
Write-Head 2 "Stage explicito (modificaciones trackeadas + -Add)"

# 2a) Modificaciones/borrados de ficheros ya trackeados.
$r = Invoke-Git @('add', '-u')
if ($r.Code -ne 0) { Stop-Cierre "git add -u fallo (exit $($r.Code)):`n$($r.Out)" }

# 2b) Ficheros nuevos indicados explicitamente.
foreach ($f in $Add) {
  if ([string]::IsNullOrWhiteSpace($f)) { continue }
  if (-not (Test-Path $f)) { Stop-Cierre "-Add: el fichero no existe: $f" }
  $r = Invoke-Git @('add', '--', $f)
  if ($r.Code -ne 0) { Stop-Cierre "git add de '$f' fallo (exit $($r.Code)):`n$($r.Out)" }
}

# 2c) Que ha quedado en stage.
$staged = @(git diff --cached --name-only | Where-Object { $_ -ne "" })
if ($staged.Count -eq 0) {
  Stop-Cierre "Nada en stage: ni modificaciones de ficheros trackeados ni -Add. No hay tramo que cerrar."
}

# 2d) Guard anti-confidencial sobre lo stageado.
foreach ($f in $staged) {
  $name = Split-Path $f -Leaf
  if ($name -match '\.json$') {
    foreach ($tok in $BLOQUEADOS_JSON) {
      if ($name -match [regex]::Escape($tok)) {
        Stop-Cierre "Fichero potencialmente CONFIDENCIAL en stage: $f (coincide '$tok'). No se sube. Si es legitimo, edita BLOQUEADOS_JSON en el script o quitalo de -Add."
      }
    }
  }
}

Ok "$($staged.Count) fichero(s) en stage para este tramo:"
$staged | ForEach-Object { Write-Host "        + $_" -ForegroundColor Green }

# 2e) Untracked que se quedan fuera (otra feature / datos no incluidos).
$untracked = @(git ls-files --others --exclude-standard | Where-Object { $_ -ne "" })
$leftOut = @($untracked | Where-Object { $staged -notcontains $_ })
if ($leftOut.Count -gt 0) {
  Warn "$($leftOut.Count) untracked QUEDAN FUERA (no se suben). Si alguno era de este tramo, relanza con -Add:"
  $leftOut | Select-Object -First 30 | ForEach-Object { Write-Host "        - $_" -ForegroundColor Yellow }
  if ($leftOut.Count -gt 30) { Write-Host "        ... (+$($leftOut.Count - 30) mas)" -ForegroundColor DarkGray }
}

# ---------------------------------------------------------------------------
# PASO 3/6 - Sin sobre-escapado en los .md stageados
# ---------------------------------------------------------------------------
Write-Head 3 "Sin corrupcion / sobre-escapado en los .md del tramo"
$stagedMd = @($staged | Where-Object { $_ -match '\.md$' })
$patterns = @('\\\*', '\\_', '&#x20;', '\\{3,}')   # \* , \_ , &#x20; , 3+ barras invertidas
$hits = @()
foreach ($f in $stagedMd) {
  if (-not (Test-Path $f)) { continue }
  foreach ($p in $patterns) {
    $m = Select-String -Path $f -Pattern $p -AllMatches -ErrorAction SilentlyContinue
    if ($m) { foreach ($line in $m) { $hits += "$($line.Path):$($line.LineNumber): $($line.Line.Trim())" } }
  }
}
if ($hits.Count -gt 0) {
  Write-Host "  Sobre-escapado en $($hits.Count) linea(s) de .md del tramo:" -ForegroundColor Red
  $hits | Select-Object -First 20 | ForEach-Object { Write-Host "        $_" -ForegroundColor Red }
  if ($hits.Count -gt 20) { Write-Host "        ... (+$($hits.Count - 20) mas)" -ForegroundColor DarkGray }
  Stop-Cierre "Hay sobre-escapado en .md stageados. Limpialo (o saca ese .md del tramo) y vuelve a lanzar."
}
if ($stagedMd.Count -eq 0) { Ok "No hay .md en este tramo." } else { Ok "$($stagedMd.Count) .md limpios." }

# ---------------------------------------------------------------------------
# DRY RUN - parar aqui, restaurar el index, no commitear ni pushear
# ---------------------------------------------------------------------------
if ($DryRun) {
  Invoke-Git @('reset', '-q') | Out-Null
  foreach ($f in $preStaged) {
    if (-not [string]::IsNullOrWhiteSpace($f)) { Invoke-Git @('add', '--', $f) | Out-Null }
  }
  Write-Host ""
  Write-Host "=========================================" -ForegroundColor Yellow
  Write-Host " DRY RUN OK - esto es lo que HABRIA hecho:" -ForegroundColor Yellow
  Write-Host "   commit -m: $Message"                     -ForegroundColor Yellow
  Write-Host "   ficheros:  $($staged.Count)"             -ForegroundColor Yellow
  Write-Host "   push:      origin (rama actual)"         -ForegroundColor Yellow
  Write-Host " Index restaurado. No se ha commiteado ni pusheado nada." -ForegroundColor Yellow
  Write-Host "=========================================" -ForegroundColor Yellow
  exit 0
}

# ---------------------------------------------------------------------------
# PASO 4/6 - Commit
# ---------------------------------------------------------------------------
Write-Head 4 "Commit"
$r = Invoke-Git @('commit', '-m', $Message)
if ($r.Code -ne 0) { Stop-Cierre "git commit fallo (exit $($r.Code)):`n$($r.Out)" }
$hash = (git rev-parse --short HEAD 2>$null)
Ok "Commit creado: $hash"

# ---------------------------------------------------------------------------
# PASO 5/6 - Push
# ---------------------------------------------------------------------------
Write-Head 5 "Push a origin"
$r = Invoke-Git @('push')
if ($r.Code -ne 0) { Stop-Cierre "git push fallo (exit $($r.Code)):`n$($r.Out)" }
Ok "Push correcto."

# ---------------------------------------------------------------------------
# PASO 6/6 - Verificar sincronizacion
# ---------------------------------------------------------------------------
Write-Head 6 "Verificar que HEAD == origin"
git fetch origin -q 2>$null
$branch = (git rev-parse --abbrev-ref HEAD 2>$null)
$counts = git rev-list --left-right --count "origin/$branch...HEAD" 2>$null
if (-not [string]::IsNullOrWhiteSpace($counts)) {
  $parts  = $counts -split "\s+"
  $ahead  = [int]$parts[1]
  if ($ahead -eq 0) { Ok "HEAD sincronizado con origin/$branch." }
  else { Warn "Quedan $ahead commit(s) sin reflejar en origin/$branch. Revisa." }
} else {
  Warn "No se pudo verificar sincronizacion (sin red?). El push reporto exito."
}

# ---------------------------------------------------------------------------
# VEREDICTO
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host " CIERRE OK - tramo cerrado y pusheado." -ForegroundColor Green
Write-Host "   commit:   $hash" -ForegroundColor Green
Write-Host "   ficheros: $($staged.Count)" -ForegroundColor Green
Write-Host "   mensaje:  $Message" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
exit 0