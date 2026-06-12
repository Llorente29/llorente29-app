# Completado masivo de ingredientes (Modo lote IA) — DISEÑO

> **Fecha:** 2026-06-12 · **Rama:** `saneamiento/auditoria-ui` · **Estado:** PROPUESTA
> (no ejecutar hasta visto bueno de Julio **y** redeploy del Edge `enrich-ingredient`).
> **Cuenta objetivo (ÚNICA):** Llorente29 Food `51ad1792-6629-4ef7-833a-b57b09a86710`.
> **NUNCA** Folvy Interno `00000000-…-0001`.

## Objetivo

Dejar el máximo de los **76 ingredientes** de Llorente29 lo más completos posible,
reduciendo los "sin terminar" (`needs_review`), **sin inventar** y **sin tocar datos
económicos** (precio/proveedor jamás los toca la IA).

## Dependencias (deben estar antes de ejecutar)

1. **Edge `enrich-ingredient` redeployado** con el cambio del Frente 2 (propone familia).
   Sin esto, el lote no asigna familia → no deriva IVA → no cierra "sin terminar".
2. **Familias de Llorente29 sembradas** con nombres AECOC que casen con
   `family_vat_default` (de ahí sale el IVA). Verificar (ver Fase 0).

## Benchmark

MarketMan / Apicbase / xtraCHEF hacen "bulk AI enrichment" SIEMPRE contra una **cola de
revisión**: la IA propone en masa, el humano aprueba en bloque lo de alta confianza y
revisa el resto. Ninguno auto-aplica a ciegas datos sensibles. Folvy ya tiene medio
camino hecho (sesión IA `recipe_item_ai_session` pending_review; panel de familias
`map-products`). El diseño sigue ese patrón y lo SUPERA atando familia→IVA→"terminado"
en una sola pasada y siendo explícito sobre qué queda a revisión y por qué.

## Principio de seguridad (deuda 0)

- **Dos carriles**, nunca uno solo "a ciegas":
  - **Carril AUTO (determinista, motor de por medio):** solo familia que **casa exacta**
    con una existente + IVA **derivado** por `propose_vat_category` (queda `proposed`, no
    `confirmed` → el humano aún confirma el tipo en la ficha). Esto retira "sin terminar".
  - **Carril REVISIÓN:** todo lo demás (familia no casada, confianza baja, familia sin
    mapeo de IVA o `is_mixed`, alérgenos/merma/conservación/nutrición). Queda como
    propuesta visible; NO se aplica solo.
- **Económico intocable:** el lote no escribe nunca precio, proveedor ni coste.
- **Alérgenos:** aunque la ficha quede "terminada" (familia+IVA), los alérgenos
  propuestos por IA quedan SIEMPRE a revisión (seguridad alimentaria = el cocinero
  confirma). "Terminado" = ficha clasificada y con IVA, no "validado para etiqueta legal".
- **Dry-run primero:** se genera el resumen (cuántos auto, cuántos a revisión, por qué)
  ANTES de aplicar nada. Julio aprueba y entonces se aplica el carril AUTO.

## Fases

### Fase 0 — Verificación contra BBDD (antes de nada)

Ejecutar (SQL Editor, cuenta Llorente29) y pegar resultados:

```sql
-- ¿Cuántos ingredientes y en qué estado?
select
  count(*) filter (where type='raw' and is_active) as total_raws,
  count(*) filter (where type='raw' and is_active and family_id is null) as sin_familia,
  count(*) filter (where type='raw' and is_active and vat_category_id is null) as sin_iva,
  count(*) filter (where type='raw' and is_active and needs_review) as sin_terminar
from recipe_item
where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';

-- ¿Las familias de la cuenta casan con el motor de IVA (family_vat_default)?
select rf.name,
       (fvd.vat_category_id is not null) as tiene_iva,
       fvd.is_mixed
from recipe_family rf
left join family_vat_default fvd on fvd.family_name = rf.name
where rf.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
  and rf.scope='ingredient' and rf.is_active
order by rf.position;
```

Si hay familias que NO casan con `family_vat_default`, decidir con Julio: renombrar a la
AECOC equivalente, o añadir el mapeo. (No se inventa el IVA.)

### Fase 1 — Generación de propuestas (dry-run, sin aplicar)

Función de servicio nueva `enrichBatchIngredients(accountId, opts)`:
- Itera los raws activos `needs_review` (o los que falte familia/IVA) de la cuenta.
- Por cada uno llama a `enrichIngredient` (Edge ya arreglado). Queda registrado en
  `recipe_item_ai_session` (pending_review) — traza y coste por ingrediente.
- **Concurrencia baja** (p.ej. 3 a la vez) y **reanudable** (idempotente: si ya hay
  sesión enrich reciente, no repite). Rate-limit para no disparar coste IA.
- Clasifica cada propuesta en AUTO vs REVISIÓN (criterios arriba) y devuelve un
  **resumen**: `{ total, autoAplicables, aRevision, motivos: {...} }`. NO aplica nada.

### Fase 2 — Aplicación del carril AUTO (tras visto bueno de Julio)

- Para los AUTO: `applyEnrichment(itemId, { familyId })` (Frente 2) → asigna familia,
  deriva IVA, retira "sin terminar". (Opcional: aplicar también merma/conservación de
  confianza alta; alérgenos NO en auto.)
- Idempotente y por lotes; log por ingrediente (ok / saltado / error + motivo).

### Fase 3 — Revisión del resto

- Los de REVISIÓN se ven en una pantalla de cola (reutilizar el patrón de
  `FamilyReviewPanel` / banner de `KitchenItemsPage`, ampliado a "ficha" no solo familia):
  ingrediente + familia propuesta (editable) + alérgenos/merma propuestos, con
  "Aplicar" / "Rechazar". Pamela/Julio aprueban en bloque o uno a uno.

## Entregable de reporte (tras ejecutar)

> Se rellena DESPUÉS de Fase 1–2 (no ahora): de los 76 — **N** quedaron terminados
> (familia+IVA), **M** a revisión y el desglose de motivos (familia no casó / IVA sin
> mapeo / familia `is_mixed` / confianza baja). Con counts reales de BBDD, no de "Success".

## Alternativa considerada (y por qué no)

- **Reusar solo `map-products` (clasificador de familia existente) + `approveAllAuto`:**
  resuelve familia, pero NO el resto de la ficha (alérgenos/merma/conservación/nutrición)
  ni ata el IVA en la misma pasada. Sirve como atajo SOLO-familia si urge, pero el lote
  `enrich` deja la ficha más completa de una vez. Recomendado: `enrich` en lote.
- **Auto-aplicar todo lo que proponga la IA:** descartado (viola anti-invención y mete
  alérgenos sin revisar en un dato de seguridad alimentaria).

## Qué falta para poder ejecutar

1. Redeploy del Edge `enrich-ingredient` (Julio).
2. Verificar Fase 0 (familias ↔ IVA).
3. Implementar `enrichBatchIngredients` + la pantalla/cola de revisión de Fase 3
   (pendiente de tu visto bueno a este diseño; no construido aún).
