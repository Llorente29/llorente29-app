# cierre-sesion.ps1 - Sistema de cierre de sesion Folvy
# ------------------------------------------------------
# Verifica los 7 pasos de cierre (ver docs/CIERRE_SESION.md).
# Uso, desde la raiz del repo:   .\scripts\cierre-sesion.ps1
# Opcional:                      .\scripts\cierre-sesion.ps1 -SkipBuild   (solo si NO tocaste codigo)
#
# Codigo de colores:
#   VERDE = paso superado automaticamente.
#   AMBAR = requiere tu confirmacion consciente (el script no puede saber tu intencion).
#   ROJO  = bloquea el cierre. Arreglalo y vuelve a pasar el script.
#
# El script NO modifica nada del repo: solo lee, ejecuta build, y te pregunta.
# IMPORTANTE: este fichero es ASCII puro a proposito (sin tildes ni guiones largos),
# para correr identico en cualquier consola Windows PowerShell 5.1.

param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

# --- Utilidades de salida ---
function Write-Head($n, $txt) { Write-Host ""; Write-Host "[$n/7] $txt" -ForegroundColor Cyan }
function Ok($txt)    { Write-Host "  OK    $txt" -ForegroundColor Green }
function Warn($txt)  { Write-Host "  AVISO $txt" -ForegroundColor Yellow }
function Fail($txt)  { Write-Host "  FALLO $txt" -ForegroundColor Red }

# Pregunta s/n y devuelve $true si responde s. Fuerza una respuesta consciente.
function Confirm-Step($pregunta) {
  while ($true) {
    $r = Read-Host "  > $pregunta (s/n)"
    if ($r -match '^[sS]') { return $true }
    if ($r -match '^[nN]') { return $false }
    Write-Host "    Responde s o n." -ForegroundColor DarkGray
  }
}

$fails = New-Object System.Collections.ArrayList
$warns = New-Object System.Collections.ArrayList

# Situarse en la raiz del repo
try {
  $root = (git rev-parse --show-toplevel 2>$null)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($root)) { throw "no es un repo git" }
  Set-Location $root
} catch {
  Write-Host "No estas dentro del repositorio git. Abortando." -ForegroundColor Red
  exit 1
}

Write-Host "========================================="  -ForegroundColor White
Write-Host " CIERRE DE SESION FOLVY - 7 pasos"          -ForegroundColor White
Write-Host " Repo: $root"                                -ForegroundColor DarkGray
Write-Host "========================================="  -ForegroundColor White

# ---------------------------------------------------------------------------
# PASO 1 - Working tree limpio o pendientes anotados
# ---------------------------------------------------------------------------
Write-Head 1 "Working tree limpio / pendientes anotados"
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
  Ok "No hay cambios sin commitear. Working tree limpio."
} else {
  Warn "Hay cambios sin commitear:"
  $status -split "`n" | ForEach-Object { if ($_ -ne "") { Write-Host "        $_" -ForegroundColor Yellow } }
  if (Confirm-Step "Cada uno de estos pendientes es INTENCIONAL y esta anotado en CONTEXTO 14?") {
    Ok "Pendientes reconocidos y anotados."
  } else {
    [void]$fails.Add("Paso 1: hay cambios sin commitear no reconocidos. Commitea o anota antes de cerrar.")
    Fail "Hay pendientes sin reconocer."
  }
}

# ---------------------------------------------------------------------------
# PASO 2 - El build pasa
# ---------------------------------------------------------------------------
Write-Head 2 "El build pasa (npm run build)"
if ($SkipBuild) {
  if (Confirm-Step "Has usado -SkipBuild. Confirmas que esta sesion NO toco codigo (solo docs)?") {
    Warn "Build omitido a peticion (sesion solo-docs)."
  } else {
    [void]$fails.Add("Paso 2: -SkipBuild usado pero hubo cambios de codigo. Ejecuta el build.")
    Fail "No se puede omitir el build si tocaste codigo."
  }
} else {
  Write-Host "  Ejecutando npm run build (puede tardar)..." -ForegroundColor DarkGray
  $buildLog = Join-Path $env:TEMP "folvy_build.log"
  # Robusto en PS 5.1: NO usar *> (vite escribe avisos por stderr y eso abortaria el
  # script con ErrorActionPreference=Stop). Lanzamos via cmd y decidimos SOLO por exit code.
  $prevEAP = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  cmd /c "npm run build > `"$buildLog`" 2>&1"
  $buildExit = $LASTEXITCODE
  $ErrorActionPreference = $prevEAP
  if ($buildExit -eq 0) {
    Ok "Build limpio (exit 0)."
  } else {
    [void]$fails.Add("Paso 2: el build FALLA (exit $buildExit). Revisa $buildLog. No se cierra con el build roto.")
    Fail "El build falla (exit $buildExit). Log en $buildLog"
  }
}

# ---------------------------------------------------------------------------
# PASO 3 - Todo commiteado y con push a origin/main
# ---------------------------------------------------------------------------
Write-Head 3 "Todo commiteado y con push a origin/main"
git fetch origin main -q 2>$null
$counts = git rev-list --left-right --count origin/main...main 2>$null
if ([string]::IsNullOrWhiteSpace($counts)) {
  Warn "No se pudo comparar con origin/main (sin red o rama distinta). Verifica manualmente."
  [void]$warns.Add("Paso 3: no se pudo verificar push automaticamente; comprueba a mano.")
} else {
  $parts  = $counts -split "\s+"
  $behind = [int]$parts[0]
  $ahead  = [int]$parts[1]
  if ($ahead -eq 0 -and $behind -eq 0) {
    Ok "main sincronizado con origin/main (nada por subir)."
  } elseif ($ahead -gt 0) {
    [void]$fails.Add("Paso 3: hay $ahead commit(s) local(es) SIN PUSH. Ejecuta git push.")
    Fail "$ahead commit(s) sin push."
  }
  if ($behind -gt 0) {
    Warn "main esta $behind commit(s) por detras de origin/main. Revisa antes de cerrar."
    [void]$warns.Add("Paso 3: main detras de origin/main en $behind commit(s).")
  }
}

# ---------------------------------------------------------------------------
# PASO 4 - CONTEXTO_CLAUDE.md actualizado y commiteado
# ---------------------------------------------------------------------------
Write-Head 4 "CONTEXTO_CLAUDE.md actualizado y commiteado"
$ctxFile = "CONTEXTO_CLAUDE.md"
if (-not (Test-Path $ctxFile)) {
  [void]$fails.Add("Paso 4: no se encuentra CONTEXTO_CLAUDE.md en la raiz.")
  Fail "No existe CONTEXTO_CLAUDE.md"
} else {
  $ctxDirty = git status --porcelain -- $ctxFile
  if (-not [string]::IsNullOrWhiteSpace($ctxDirty)) {
    [void]$fails.Add("Paso 4: CONTEXTO tiene cambios SIN COMMITEAR. Commitea y pushea.")
    Fail "CONTEXTO tiene cambios sin commitear."
  } else {
    $today = (Get-Date).ToString("yyyy-MM-dd")
    $lastCtx = git log -1 --format="%cd" --date=short -- $ctxFile 2>$null
    if ($lastCtx -eq $today) {
      Ok "CONTEXTO commiteado hoy ($today)."
    } else {
      Warn "El ultimo commit de CONTEXTO es de $lastCtx, no de hoy."
    }
    if (Confirm-Step "CONTEXTO refleja DE VERDAD lo construido/decidido en esta sesion?") {
      Ok "CONTEXTO confirmado al dia."
    } else {
      [void]$fails.Add("Paso 4: CONTEXTO no refleja la sesion. Actualizalo, commitea y pushea.")
      Fail "CONTEXTO no refleja la sesion."
    }
  }
}

# ---------------------------------------------------------------------------
# PASO 5 - Cambios de BBDD reflejados en CONTEXTO
# ---------------------------------------------------------------------------
Write-Head 5 "Cambios de BBDD reflejados en CONTEXTO"
if (Confirm-Step "Hubo cambios de BBDD esta sesion (funciones SQL, schema, RPCs)?") {
  $a = Confirm-Step "Estan TODOS descritos en CONTEXTO 14.2 (firma + que hacen)?"
  $b = Confirm-Step "Se hizo COMMIT en Supabase de cada cambio (no quedan en transaccion abierta)?"
  if ($a -and $b) {
    Ok "Cambios de BBDD reflejados y commiteados en Supabase."
  } else {
    [void]$fails.Add("Paso 5: cambios de BBDD sin reflejar en CONTEXTO o sin COMMIT en Supabase.")
    Fail "Cambios de BBDD sin documentar o sin commitear."
  }
} else {
  Ok "No hubo cambios de BBDD esta sesion."
}

# ---------------------------------------------------------------------------
# PASO 6 - Sin corrupcion / sobre-escapado en los .md
# ---------------------------------------------------------------------------
Write-Head 6 "Sin corrupcion / sobre-escapado en los .md"
$mdFiles = git ls-files '*.md'
$patterns = @('\\\*', '\\_', '&#x20;', '\\{3,}')   # \* , \_ , &#x20; , 3+ barras invertidas
$hits = @()
foreach ($f in $mdFiles) {
  if ([string]::IsNullOrWhiteSpace($f)) { continue }
  foreach ($p in $patterns) {
    $m = Select-String -Path $f -Pattern $p -AllMatches -ErrorAction SilentlyContinue
    if ($m) { foreach ($line in $m) { $hits += "$($line.Path):$($line.LineNumber): $($line.Line.Trim())" } }
  }
}
if ($hits.Count -eq 0) {
  Ok "0 firmas de sobre-escapado en los .md trackeados ($($mdFiles.Count) ficheros)."
} else {
  Warn "Posible sobre-escapado en $($hits.Count) linea(s):"
  $hits | Select-Object -First 20 | ForEach-Object { Write-Host "        $_" -ForegroundColor Yellow }
  if ($hits.Count -gt 20) { Write-Host "        ... (+$($hits.Count - 20) mas)" -ForegroundColor DarkGray }
  if (Confirm-Step "Has revisado estas lineas y son ejemplos LEGITIMOS (no corrupcion)?") {
    Ok "Coincidencias revisadas y aceptadas como legitimas."
  } else {
    [void]$fails.Add("Paso 6: hay sobre-escapado real en .md. Limpialo antes de cerrar.")
    Fail "Sobre-escapado sin limpiar."
  }
}

# ---------------------------------------------------------------------------
# PASO 7 - Prompt de arranque de la proxima sesion escrito
# ---------------------------------------------------------------------------
Write-Head 7 "Prompt de arranque de la proxima sesion escrito"
if (Confirm-Step "Esta escrito en CONTEXTO cual es el PASO 1 de la proxima sesion?") {
  Ok "Arranque de la proxima sesion documentado."
} else {
  [void]$fails.Add("Paso 7: falta el paso 1 de la proxima sesion en CONTEXTO. Escribelo antes de cerrar.")
  Fail "Falta el arranque de la proxima sesion."
}

# ---------------------------------------------------------------------------
# VEREDICTO
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "========================================="  -ForegroundColor White
if ($fails.Count -eq 0) {
  Write-Host " CIERRE OK - la sesion esta cerrada de verdad." -ForegroundColor Green
  if ($warns.Count -gt 0) {
    Write-Host " (con $($warns.Count) aviso(s) que revisaste):" -ForegroundColor Yellow
    $warns | ForEach-Object { Write-Host "   - $_" -ForegroundColor Yellow }
  }
  Write-Host " La proxima sesion arranca sin perdida." -ForegroundColor Green
  Write-Host "========================================="  -ForegroundColor White
  exit 0
} else {
  Write-Host " NO CERRAR - faltan $($fails.Count) cosa(s):" -ForegroundColor Red
  $fails | ForEach-Object { Write-Host "   - $_" -ForegroundColor Red }
  Write-Host " Arreglalo y vuelve a pasar el script." -ForegroundColor Red
  Write-Host "========================================="  -ForegroundColor White
  exit 1
}
