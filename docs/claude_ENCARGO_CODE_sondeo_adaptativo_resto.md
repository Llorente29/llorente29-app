# ENCARGO CODE — B-bis · Las TRES RPC que se me escaparon

**Fecha:** 2026-08-13 · **Rama nueva:** `fix/sondeo-adaptativo-resto`
**Antecedente:** `fix/sondeo-adaptativo-tablet` (PR #60, mergeado y **verificado en producción**).
**Causa raíz:** `claude_folvy_incidente_20260813_conexiones_causa_raiz.md`
**Prioridad:** 🔴 alta — es lo que falta para cerrar el incidente del 13/08.

---

## 0. Tu trabajo anterior FUNCIONA — medido en producción

Verificado por MCP tras aplicar el bundle 123 en las 3 tablets (11:00) y esperar 60 min de inactividad:

| RPC | Antes | Después |
|---|---|---|
| `claim_print_jobs` | 58/min | **0-1/min** ✅ |
| `orders_feed_by_token` | 18/min | **0-1/min** ✅ |
| `kds_alarms` | 18/min | **0-1/min** ✅ |
| `kitchen_day_banner_by_token` | 18/min | **0-1/min** ✅ |
| `availability_notices` | 9/min | **0/min** ✅ |

El techo de 60 s y el suelo de 5 min entran **exactamente cuando toca**. La rampa progresiva y el
`wake()` hacen lo que prometían. Nada que corregir de lo anterior.

---

## 1. 🔴 EL FALLO ES MÍO: el encargo B cubrió 5 RPC y hay 8

Al medir el residual aparecieron **tres RPC más sondeando desde las tablets a ritmo fijo**, que en la
primera medición quedaron escondidas dentro de la categoría "otras" y por eso no entraron en el
encargo:

| RPC | Peticiones en 4 min | Ritmo | User-agent |
|---|---|---|---|
| **`location_status`** | 17 | ~4/min | Android P30T + Lenovo TB-8505F |
| **`closed_brands`** | 17 | ~4/min | ídem |
| **`anomalous_brand_closures`** | 15 | ~4/min | ídem |

**~12 peticiones/min entre las tres, con la cocina cerrada y sin nada que consultar.**
Con 50 clientes × 3 tablets serían **~600/min** solo de estas tres.

Descartado que sean otra cosa: el resto del tráfico residual es legítimo — `training_is_clocked_in` y
`claim_next_image_job` son crons (user-agent `Deno/SupabaseEdgeRuntime`), y los GET de
`supplier`/`locations`/`inventory_count`/`storage_area` son navegación humana en la app web.

---

## 2. Qué hay que hacer

**Exactamente lo mismo que ya hiciste**, sobre estas tres. No hay diseño nuevo:

1. **Localiza dónde se llaman** (`git grep` de los tres nombres). Probablemente en la cabecera de
   estación / overlays de marca cerrada.
2. **Sustituye su `setInterval` por `runPollingLoop`** con techo por inactividad, igual que en
   `OrdersFeed`/`KdsBoard`.
3. **Techos propuestos** (ajusta si la naturaleza del dato pide otra cosa y dilo):

| RPC | Normal | Techo inactivo | Suelo (local cerrado) |
|---|---|---|---|
| `location_status` | actual | 60 s | 5 min |
| `closed_brands` | actual | 60 s | 5 min |
| `anomalous_brand_closures` | actual | **2 min** | 5 min |

`anomalous_brand_closures` es un vigía de anomalías, no un dato de servicio: no necesita ritmo vivo.

4. **`wake()` al despertar**, igual que el resto: si entra un pedido o alguien toca la pantalla, vuelven
   al ritmo normal al instante.

---

## 3. Guardarraíl importante

⚠️ **`closed_brands` y `location_status` afectan a lo que el operario VE sobre si puede vender.** Si
una marca se cierra desde la oficina, la tablet debe enterarse en un tiempo razonable. **Por eso el
techo es 60 s y no 5 min en horario de servicio** — y por eso el suelo de 5 min solo aplica con el
local sin actividad.

Si al leer el código ves que alguna de estas alimenta una decisión que no puede esperar 60 s, **dilo y
propón otro techo**, no lo apliques a ciegas.

---

## 4. Verificación

1. **Medida en vacío:** con las tablets encendidas y sin actividad >60 min, las tres deben quedar en
   **0-1/min** cada una. Objetivo del conjunto: **tráfico total de tablets < 5/min**.
2. **Al despertar:** cerrar una marca desde la oficina → la tablet debe reflejarlo sin esperar el
   intervalo largo.
3. **No regresión:** el semáforo de disponibilidad y el aviso de marca cerrada siguen funcionando en
   servicio normal.
4. La medida final por `edge_logs` la hago yo por MCP. Punto no ejecutable → **NO EJECUTADO**.

---

## 5. Reglas
- Worktree aislado, `tsc -b` limpio, ficheros completos, TS strict.
- **Sin migración** (esto es solo cliente). Si crees que hace falta alguna, para y dilo antes.
- **No tocar el WIP de Julio:** `ticketRenderer.ts`, `DailyCountWizard.tsx` (⚠️ este último **rompe el
  build**: `TS6133 accountId` — no lo arregles tú, es WIP suyo), migraciones `20260811T2200`/`T2201`.
- **No mergear.** Julio verifica.
- Declara el estado git al terminar.

---

## 6. La lección, para que no se repita

Mi encargo B midió cinco RPC y dio el problema por acotado. **Había ocho.** Las tres que faltaban
estaban a la vista, agregadas bajo "otras" en mi propia consulta.

> **Cuando se mide para acotar un problema, la categoría "otras" hay que abrirla SIEMPRE.**
> Un residual del 20 % no es ruido: es la parte del problema que no has mirado.
