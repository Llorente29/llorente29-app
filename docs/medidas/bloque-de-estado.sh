#!/usr/bin/env bash
# docs/medidas/bloque-de-estado.sh
#
# LA MITAD DE GIT DEL BLOQUE DE ESTADO · 15/09/2026
# La otra mitad --el Pase, la migración, las tablets, el reloj de Madrid-- es
# `bloque-de-estado.sql`, y se ejecuta contra la base.
#
# Existe porque el 15/09 escribí «empujado a la rama, NO a main» sin mirarlo, y
# el commit estaba en `main`. El push había devuelto éxito --empujó la rama, que
# no tenía cambios-- y leí ese éxito como prueba de dónde había ido el commit.
# Son dos cosas distintas, y aquí se preguntan por separado.

set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

rama="$(git branch --show-current)"
echo "RAMA ACTUAL                  $rama"

for b in main "$rama"; do
  git show-ref --verify --quiet "refs/heads/$b" || continue
  up="$(git rev-parse --abbrev-ref "$b@{u}" 2>/dev/null || echo SIN_REMOTO)"
  if [ "$up" = SIN_REMOTO ]; then
    echo "SIN EMPUJAR · $b            no tiene remoto asociado"
  else
    n="$(git rev-list --count "$up..$b")"
    m="$(git rev-list --count "$b..$up")"
    echo "SIN EMPUJAR · $b            $n por delante de $up, $m por detrás"
  fi
done

# 🔴 La pregunta que fallé: no «¿empujé?», sino «¿DÓNDE está el último commit?».
echo "ÚLTIMO COMMIT DE LA RAMA     $(git log -1 --format='%h %s' "$rama")"
echo "ÚLTIMO COMMIT DE main        $(git log -1 --format='%h %s' main)"
echo "¿main == origin/main?        $([ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ] && echo SÍ || echo '🔴 NO')"
echo "ÁRBOL                        $(test -z "$(git status --porcelain)" && echo limpio || echo 'con cambios sin commitear')"
