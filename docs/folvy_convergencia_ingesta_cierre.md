# Convergencia de ingesta — cierre (modelo agnóstico de integrador)

Fecha: 2026-06-20. Autor: Claude Code (propone). Aplica y verifica: Julio.
Cuenta de trabajo: Folvy Interno (`xzmpnchlguibclvxyynt`).

Objetivo: dejar el modelo de ingesta/casado 100% agnóstico de integrador, sin
andamios `lastapp_*`. Este documento recoge el RECON, lo entregado, lo bloqueado
y la verificación.

> **NADA aplicado.** Todo son migraciones + parches para que Julio revise y ejecute.
> Las funciones `SECURITY DEFINER` NO se prueban en el SQL Editor (`auth.uid()` es
> null allí): se validan desde la app o con sesión simulada. Verificar siempre
> contra `information_schema`/`pg_proc`, no por "Success".

---

## 1. Estado inicial (RECON verificado en código + esquema)

- **El casado vivo YA es canónico.** `adapt_lastapp_order` vivo (fichero suelto
  `supabase/migrations/adapt_lastapp_order_v3.sql`) casa por
  `menu_item.external_source='lastapp' + external_id = matrícula`
  (organizationProductId); deduce marca del combo por sus hijos. NO usa
  `lastapp_product_map`. Las migraciones versionadas `20260611T2200` (casado por
  product_map) están **muertas** respecto a la BBDD.
- `reprocess_sale` (de `20260617T2350_hubrise_adapter`) despacha por `sale.source`
  y para `lastapp` resuelve la marca con `resolve_sale_brand_from_map`
  (`external_brand_map`) antes de adaptar.
- **Dos linajes paralelos de tablas map:**
  - Viejo: `lastapp_location_map` (6 filas), `lastapp_product_map` (112 filas).
  - Nuevo agnóstico: `external_location_map` (1 fila), `external_product_map`
    (0 filas), `external_brand_map` (vivo). `external_location_map` es
    **estructuralmente distinta** (`source`, `is_active`, unique `(source,
    external_location_id)`; sin `..._name`/`needs_review`).
- **Migración `20260620T1200_external_integration_rename.sql`**: borrador sin
  commitear (`??` en git). Intenta renombrar `lastapp_location_map →
  external_location_map` y **chocaría** con la tabla nueva. Está superada por el
  linaje `T1300`+. → **Descartar/borrar** (no aplicar).
- **Cuerpos NO versionados en el repo** (viven en prod): `migrate_brands_and_map`,
  `resolve_lastapp_line`, `seed_lastapp_catalog`. (El propio guión del 12/06 los
  lista como deuda de "versionar SQL vivo".)

### Bug latente que corrige esta convergencia
Las versiones viejas de `classify_unmapped_product`, `create_dish_from_unmapped`
y `resolve_unmapped_sales` creaban `menu_item` **sin** `external_source/external_id`.
Como el casado vivo casa por `external_id=matrícula`, **un menu_item creado por
ellas NO lo encontraría el recast**. La versión canónica **sella**
`external_source='lastapp' + external_id=matrícula` en todo `menu_item` que crea.

---

## 2. RECON de las 3 funciones profundas y su rediseño canónico

| Función | Hacía (viejo) | Hace (canónico) |
|---|---|---|
| `create_dish_from_unmapped` | Resolvía receta vía `lastapp_product_map`; leía marca/precio de `lastapp_catalog_product`; creaba `lastapp_product_map` + menu_item en TODAS las marcas. | Resuelve matrícula+marca de `sale_line.external_product_id`+`sale.brand_id`; nombre/precio/combo de `external_catalog_product`; crea recipe(dish)+menu_item **sellado** por matrícula (1 marca); recasa. Sin product_map. |
| `classify_unmapped_product` | Exigía receta preexistente (product_map); resale convertía a raw y propagaba menu_item por marca. | Resuelve **o crea** recipe+menu_item sellado por matrícula; `dish`→devuelve recipe_id; `resale`→raw+coste; `combo`→declara. Sin propagación multi-marca. |
| `resolve_unmapped_sales` | `link` resolvía vía catálogo+product_map y creaba menu_item NO sellado. | `ignore`/`delist` **sin cambios** (no tocaban product_map). `link` (legacy, hoy no cableado en el front) resuelve/crea menu_item **sellado** por matrícula. |

**Decisiones aplicadas (delegadas por Julio: "el resto lo decido yo"):**
- La marca se resuelve de la venta (`sale.brand_id`, ya canónica vía
  `external_brand_map`), con respaldo al nombre de catálogo (alias *Dirty
  Burgers→Dirty Burger*, `FOODINT` excluido). Esto arregla las **cedidas** (que el
  catálogo no resolvía por nombre).
- Se **elimina** el bucle "crear menu_item en todas las marcas" (era del modelo
  viejo de receta compartida). Modelo canónico = 1 recipe/menu_item por
  marca×matrícula, como `seed_catalog_canonical`.
- Firmas y tipos de retorno **idénticos** (los consume `salesReliabilityService` +
  `SalesExceptionsPage`). Anti-invención intacto (EXCEPTION sin matrícula/marca o
  si es combo).

---

## 3. Entregado en esta tanda (revisar y aplicar)

### Migraciones SQL (nuevas, idempotentes, sin BEGIN/COMMIT)
1. `20260620T1700_converge_b_excepciones_canonicas.sql` — **Bloque B**: las 3
   funciones canónicas.
2. `20260620T1725_converge_a1_list_pending_external_brands.sql` — **Bloque A.1**:
   `list_pending_external_brands` lee `external_catalog_product`/`external_brand_name`
   y resuelve el local desde `external_location_map`+`locations`. **Conserva las 8
   columnas** (incl. `folvy_location_id`/`folvy_location_name`). Va DESPUÉS de E.1.
   (Reemplaza la `1710` borrada, que erróneamente quitaba 2 columnas.)

### Código
3. `src/admin/services/lastappIntegrationService.ts` — `seedAndRecast` ahora llama
   a `seed_catalog_canonical` (no `seed_lastapp_catalog`).
4. `src/types/database.ts` — añadido el tipo de `seed_catalog_canonical`.
   (Pendiente regenerar con `gen types` en Bloque F; el alta a mano mantiene el
   build verde mientras tanto.)
5. `supabase/functions/lastapp-backfill-sales/index.ts` — **edge canónico**:
   escribe venta cruda (+ `external_brand_text`/`external_location_text`) y delega
   en `reprocess_sale`. Sin `resolve_lastapp_line`, sin líneas `'manual'`. Lee
   `external_integration` + `external_location_map` (ya no las vistas puente).
6. `scripts/backfill-sales.mjs` — **script canónico**: misma estrategia
   (venta cruda + `reprocess_sale`); fuera todas las caches de resolución.

### Migraciones SQL adicionales
- `20260620T1720_converge_e1_datos_location_map.sql` — **E.1**: traslada las 6
  filas `lastapp_location_map` → `external_location_map (source='lastapp')`.
- `20260620T1740_converge_d_jubilar_residuo.sql` — **D**: DROP de
  `seed_lastapp_catalog`, `seed_catalog_from_lastapp`, `resolve_lastapp_line`
  (ya sin llamadas).

**Build:** `npm run build` → **verde** (`✓ built`). (Edge Deno y `.mjs` quedan
fuera de `tsc`; revisar al desplegar.)

### Orden de aplicación recomendado
1. `20260620T1500` y `20260620T1600` ya aplicadas (estado de partida).
2. `20260620T1700` (B — 3 funciones). Verificar firmas con `pg_proc` (§5).
3. `20260620T1715` (E.0 — columnas en external_location_map).
4. `20260620T1720` (E.1 — datos location_map). Verificar las 6 filas (§5.3).
5. `20260620T1725` (A.1 — list_pending). DESPUÉS de E.1: resuelve el local desde
   external_location_map.
6. Desplegar código (Vercel + `supabase functions deploy`):
   `lastappIntegrationService.ts`, `salesReliabilityService.ts` (comentario),
   y edges: `lastapp-webhook`, `lastapp-backfill-sales`, `order-advance`,
   `lastapp-catalog-import`, `lastapp-sync-catalog`. (Script `backfill-sales.mjs`
   se usa al lanzarlo a mano.)
7. `20260620T1740` (D — jubilar residuo) — SOLO tras (6).
8. `20260620T1730` (A.2 — migrate_brands_and_map) — tras E.1.
9. `20260620T1750` (E.2 — DROP puentes + tablas viejas) — ÚLTIMO, tras A.2 y (6).
   Correr las verificaciones del header de la migración antes.

---

## 4. Bloqueado / pendiente de decisión

### A.2 — `migrate_brands_and_map` — HECHO (`20260620T1730`)
Reescrita conservando firma (`p_source, p_dest, p_run`) y retorno. Único cambio:
el `EXISTS` del `_src_map` lee `external_location_map` (antes `lastapp_location_map`),
comparación directa de `external_location_id` (text) sin `::text`. Resto intacto
(ya era agnóstico). **Encadenada a E.1** (necesita las 6 tiendas ya en
external_location_map). No la llama código (solo herramienta de migración manual).

### C (edge) — HECHO (Julio eligió opción (a): convertir a canónico)
`lastapp-backfill-sales` + `scripts/backfill-sales.mjs` reescritos: escriben la
venta cruda y delegan en `reprocess_sale`; sin `resolve_lastapp_line`; líneas
NORMALES (nunca `'manual'`). Razón (Julio): el backfill se necesita para meter el
histórico de Llorente29 y del cliente 2; unifica el casado en un solo sitio.

### D — HECHO (migración `20260620T1740`)
`DROP` de `seed_lastapp_catalog`, `seed_catalog_from_lastapp`,
`resolve_lastapp_line`. Aplicar tras desplegar el código de C/seed.

### E.2 — retirar vistas puente + tablas viejas (CÓDIGO CONVERGIDO; DROP gated A.2)
Código convergido a `external_*` (todos los lectores vivos):
- `lastapp-webhook/index.ts` → `external_catalog_product` (caché de marca) +
  `external_location_map` (resolver cuenta/local).
- `lastappIntegrationService.ts` → `external_integration` / `external_location_map`
  / `external_catalog_product` (nombres de campo TS conservan "lastapp": cosmético).
- `order-advance`, `lastapp-catalog-import`, `lastapp-sync-catalog` →
  `external_integration` (+ `external_catalog_product` en el upsert de sync).
- E.0 (`20260620T1715`) enriquece `external_location_map` con
  `external_location_name` + `needs_review` (los necesita el panel).

DROP escrito en `20260620T1750_converge_e2_...sql` (views + tablas viejas).
**Gated a A.2**: `migrate_brands_and_map` aún lee `lastapp_location_map` hasta
reescribirla. Aplicar E.2 como ÚLTIMO paso, tras A.2 y tras desplegar el código.

**Residuo declarado:** scripts one-shot (`import-platos`, `import-escandallos`,
`diagnose-needs-review`, `tspoon-extract-puente`, `probe-webhook-synth`) aún
nombran `lastapp_product_map`/`lastapp_location_map`; quedan obsoletos tras E.2
(rehacer canónicos si se reusan). `lastapp_webhook_log` se CONSERVA como deuda
declarada explícita (log de frontera Last; gemelo agnóstico `external_webhook_log`
ya existe — convergerlo = otro frente). **Excepción consciente aprobada por Julio.**

---

## 5. Verificación (queries para Julio — la BBDD es la verdad)

```sql
-- 5.1 Firmas reales tras aplicar el Bloque B (deben coincidir con database.ts)
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS returns
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('classify_unmapped_product','create_dish_from_unmapped',
                    'resolve_unmapped_sales','list_pending_external_brands',
                    'seed_catalog_canonical');

-- 5.2 Dump del cuerpo vivo de migrate_brands_and_map (pégamelo para reescribirla)
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'migrate_brands_and_map';

-- 5.3 Realidad de los datos de location_map (no asumir transparencia)
SELECT 'lastapp' AS tabla, count(*) FROM public.lastapp_location_map
UNION ALL SELECT 'external', count(*) FROM public.external_location_map;
SELECT * FROM public.lastapp_location_map ORDER BY 1;
SELECT * FROM public.external_location_map ORDER BY 1;

-- 5.4 Casado intacto tras Bloque B (≈98% en Folvy Interno). Desde la app o sesión
--     simulada (SECURITY DEFINER): SELECT * FROM recast_lastapp_sales('<account>');
--     comparar lineas_casadas/lineas_total antes y después.

-- 5.5 Residuo: ¿quién llama aún a las funciones a jubilar?
--     (grep en repo + revisar dependencias en pg_proc/pg_depend antes de DROP)
```

### Checklist de cierre (objetivo del encargo)
- [x] Casado canónico sellado en las 3 funciones de excepciones (B).
- [x] `seedAndRecast` → `seed_catalog_canonical` (C).
- [x] Backfill (edge + script) canónico, líneas normales, vía `reprocess_sale` (C).
- [x] Código convergido a `external_*` (webhook + servicio + 3 edges).
- [x] `npm run build` verde.
- [ ] Cero `lastapp_*` en el ESQUEMA — tras aplicar D (1740) + A.2 + E.2 (1750).
      Excepción consciente declarada: `lastapp_webhook_log` (log de frontera).
- [x] A.2 (`migrate_brands_and_map`) reescrita canónica (migración 1730).
- [ ] `gen types` regenerado (tras aplicar el SQL).
- [ ] Casado ≈98% verificado tras aplicar (§5.4).
- [ ] Scripts one-shot que nombran `lastapp_product_map`/`_location_map`:
      residuo, rehacer canónicos si se reusan (no bloquea).
