# Inventario de Edge Functions · 19/08/2026

Comparación entre lo **desplegado** en Supabase y las **carpetas del repositorio**.
Guion reutilizable: `scripts/edge-functions-inventario.sh`.

## Por qué existe

El 19/08, `last-catalog-sync` llevaba desplegada desde el 12/08 **sin una línea
en el repositorio**. Buscando por qué el espejo de catálogos de Last no
reflejaba los catálogos de Glovo de Alcalá, se leyó el repo, se encontró sólo
la función vieja, y se razonó dos horas sobre la equivocada. Salieron de ahí
tres afirmaciones falsas al CEO y 35 filas del espejo corrompidas.

Ese mismo día había pasado dos veces más, en pequeño: `hubriseSku.ts` y
`lastapp-set-price` tenían desplegado distinto del repo. Tres veces en una
mañana. El guion es media hora.

## Estado hoy

| | |
|---|---|
| Desplegadas | **62** |
| Carpetas en el repo | **62** |
| **Vivas sin código** | **1** |
| Código sin desplegar | 1 |

### Vivas sin código

- **`catcher-probe`** — sonda del diagnóstico de Catcher. Según
  `CONTEXTO_CLAUDE.md` se dejó *«desplegada e inertizada (v3, 410)»*. Coherente
  con estar retirada, pero **sigue viva y nadie puede leerla**. Decidir: traerla
  al repo como se ha hecho con `last-catalog-sync`, o borrarla de verdad.

`last-catalog-sync` ya **no** aparece aquí: se recuperó a
`supabase/functions/last-catalog-sync/` en este mismo commit. Antes de eso el
recuento era **2**.

### Código sin desplegar

- **`otter-webhook`** — carpeta en el repo, sin desplegar. O es trabajo a medias
  o es una integración abandonada. Revisar y decidir.

## Lo que este inventario NO detecta

Coincidir de nombre **no** garantiza que el código desplegado sea el del repo.
La deriva byte a byte necesita `supabase functions download <slug>` + md5, y la
CLI de Supabase **no está instalada** en el entorno de trabajo. Instalarla es lo
que cierra el agujero del todo; hoy sólo se cubre el hueco grande.

Casos conocidos de deriva byte a byte a 19/08:

| Función / fichero | Estado |
|---|---|
| `_shared/hubriseSku.ts` | Alineado en la v48 tras tres intentos (el escape `̀` no sobrevivía al transporte JSON del desplegador; se pasó a códigos numéricos). |
| `lastapp-set-price` | **Desplegado ≠ repo.** El desplegado devuelve `payload_sent`, que la copia del repo no rellena. Sin resolver. |
| `_shared/cors.ts` | El bundle de `lastapp-sync-catalog` lo llevaba con CRLF; el repo usa LF. Cosmético. |

## Cómo repetirlo

```sh
supabase functions list --output json | ./scripts/edge-functions-inventario.sh
```

Sin CLI, un fichero con un slug por línea:

```sh
./scripts/edge-functions-inventario.sh slugs.txt
```

Conviene que corra en CI y falle si «vivas sin código» > 0.
