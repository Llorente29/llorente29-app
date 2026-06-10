# CIERRE SESIÓN 2026-06-10 — Folvy

Este fichero contiene las tres piezas del ritual de cierre:
1. Bloque a INSERTAR al principio de §1 ESTADO VIVO de `CONTEXTO_CLAUDE.md`
2. Prompt de arranque de la próxima sesión
3. Resumen de lo cerrado hoy (para verificación)

---

## 1. BLOQUE PARA `CONTEXTO_CLAUDE.md` §1 ESTADO VIVO

> Insertar como bloque nuevo al PRINCIPIO de la §1 (encima del bloque del 09/06),
> preservando todo lo anterior byte a byte. Actualizar también la fecha de la
> cabecera del documento (línea 5).

**Última actualización: 2026-06-10 (CIERRE jornada). Lo último — INVENTARIO PERPETUO avanzó tres frentes + ARREGLO CRÍTICO de webhook.**

**(A) T1 INVENTARIO DE APERTURA — HECHO y en producción (commit 9898d4c).** Nuevo `movement_type='apertura'` (7º tipo) + `inventory_count.is_opening`. Un conteo es apertura si el local no tiene movimiento `apertura` previo (detección automática en `build_inventory_count`). `apply_inventory_count` escribe `apertura` en vez de `ajuste` si is_opening. El AvT excluirá `apertura` de la variación. Front: `InventoryCountSheet` con banner de apertura (oculta Sistema/Variación/Motivo). Migración `20260610T1200`.

**(B) T2 REGISTRO DE MERMA PROACTIVO — HECHO y en producción (commit 2e02f69, build verde).** `movement_type='merma'` + `source_type='waste'` + tabla `stock_waste` (causa, qty_base, unidades de uso preparadas para frente 7, unit_cost, cost_eur, foto opcional, lote, caducidad) + RPC `register_waste` (SECURITY DEFINER; cualquiera registra, decisión Julio). Front: pestaña "Merma" en Inventario (`WasteSection.tsx` + `wasteService.ts`): alta rápida (artículo→cantidad base→causa→foto opcional) + listado del periodo con €. Catálogo de causas curado. Migraciones `20260610T1500` (esquema) + `20260610T1600` (RPC). RECON corrigió: `listInventoryItems(accountId)` recibe solo cuenta; `InventoryItem` no trae unidad (se resuelve por join en el listado vía `recipe_item.base_unit_id`→`kitchen_unit.abbreviation`).

**(C) AUTOINVENTARIO IA — DISEÑO APROBADO + A1 ESQUEMA HECHO (commit 5f9cb7d).** Diseño completo en `docs/folvy_autoinventario_diseno.md`. Motor 2 capas anidadas: **QUÉ contar** = valor (consumo rotación×coste + `stock_value` refuerzo) + rotación + riesgo (`variance_*` + `stock_waste`; el riesgo PROMOCIONA un barato a clase alta); **CUÁNTO contar** = por COBERTURA de valor en riesgo, NO cadencia fija (el "3-5/día" era inventado, DESCARTADO), NO p-valor (inventario sesgado; honesto = "cobertura", no "estadística"). **CRITICIDAD OPERATIVA** (override, diferenciador): consumible barato e invisible cuyo fallo CIERRA la marca (ej. bolsas de envío — no van en escandallo, ABC las pondría en C, pero sin ellas no sale un pedido). Atributo MARCABLE (no deducible): `recipe_item.is_operational_critical` + `operational_min_qty` opcional (decisión Julio: opción 2 = flag + mínimo opcional; alarma proactiva al bajar del mínimo, sin esperar al conteo). HECHO en esquema (migración `20260610T1700`, versionada). QUIÉN cuenta = trabajador FICHADO, rota, no su zona. Variaciones → food cost (merma real no explicada por ventas se suma al coste real) + explicación REAL (`stock_waste`) / TEÓRICA (IA propone, no afirma). Configurable el OBJETIVO, no el motor. Didáctico en 2 idiomas (cocinero/gerente). Benchmark hecho (MarketMan/NetSuite/SAP: todos cadencia fija por ABC, nadie dimensiona por fiabilidad ni explica ni cierra a food cost → Folvy golea). RECON completo: rotación sale de `stock_movement` (`movement_type='consumo'`, `qty_base*unit_cost`); coste de `recipe_item.computed_cost`; stock de `recipe_item_location_stock`. **PRÓXIMO: A1-función (ABC/score AL VUELO, no persistido) + A2 (cola priorizada visible).**

**(D) ARREGLO CRÍTICO — WEBHOOK perdía ventas de local no mapeado (CTB).** El `lastapp-webhook` hacía `throw` ante local no mapeado → la venta se perdía (solo log). ARREGLADO de fondo y DEPLOYADO (`--no-verify-jwt`): ahora guarda como `note='pendiente-local-no-mapeado'` en `lastapp_webhook_log`, sin throw → NINGUNA venta se pierde. Las 3 tiendas CTB (Cloudtown, org Last `b7bc4753`) mapeadas a mano a sus Foodint en `lastapp_location_map` (misma cocina física: 2 `lastapp_location_id` → 1 `location`; cruce confirmado por API Last `/locations` con dirección, NO por la fiscal de Barcelona del payload). Token integrador Folvy/Cloudtown = `247ef137-...`. **PENDIENTE (anotado, memoria #21): las ventas CTB entran pero NO casan** porque falta importar el CATÁLOGO CTB (`lastapp_catalog_product=0` → `resolveSaleBrand` da null) + marcas/menús cedidas, igual que se hizo con las propias (herramienta `lastapp-catalog-import` apuntada a org Cloudtown). Diseño del frente onboarding en `docs/folvy_onboarding_integraciones_diseno.md`. Lección de método: el camino de ALTA DE LOCAL NUEVO EN VIVO (onboarding) es distinto del backfill histórico y hay que probarlo como tal — el webhook asumía "local ya mapeado".

---

## 2. PROMPT DE ARRANQUE — próxima sesión

```
Soy Julio Gª Colón, CEO de Folvy. Proyecto serio en desarrollo activo.

REGLA CERO: lee SIEMPRE CONTEXTO_CLAUDE.md (§1 ESTADO VIVO) y los docs relevantes
del knowledge ANTES de responder cualquier pregunta técnica. La BBDD es la verdad
(verifica information_schema antes de decisiones de esquema); el CONTEXTO va por detrás.

Arranque:
1. Confirma que has leído CONTEXTO_CLAUDE.md (§1).
2. Resume en 5-10 líneas dónde estamos.
3. Pregúntame qué quiero hacer hoy.
4. NO toques nada hasta que confirme.

Reglas no negociables:
- Archivos COMPLETOS descargables, nunca diffs. Pide el original ANTES de modificarlo.
  Yo NO edito archivos: los descargo y los coloco en la ruta que me digas.
- Una instrucción por turno, marcada 🖥️ (PowerShell) o 🗃️ (SQL Editor, navegador — NO PowerShell).
- Marca SIEMPRE las operaciones: COMMIT/ROLLBACK, npm run build, git commit/push.
  Verifica push con git rev-list --count origin/main..main (espera 0).
- PowerShell NO acepta && para encadenar: comandos en líneas separadas.
- Pega el SQL en el SQL Editor del navegador, no en PowerShell.
- DDL sin BEGIN/COMMIT problemático en una sola tx solo si NO hay SECURITY DEFINER dentro.
  SECURITY DEFINER: NO probar en SQL Editor (auth.uid() null) — verificar desde la app.
  El SQL Editor solo devuelve la salida de la ÚLTIMA consulta → una consulta por turno.
- Esquema: tras CUALQUIER cambio, regenerar database.ts con:
  npx supabase gen types typescript --project-id xzmpnchlguibclvxyynt --yes > src/types/database.ts
  y reconvertir a UTF-8 sin BOM. Y dejar el DDL como migración versionada en supabase/migrations/.
- Webhooks externos: deploy SIEMPRE con --no-verify-jwt.
- RECON DE ÁREA antes de diseñar: fuente primaria (BBDD+repo: tablas, columnas, funciones
  pg_proc.prosrc, triggers, git grep, conteos), NO el CONTEXTO. No duplicar lógica existente.
- BENCHMARK del mejor del mercado ANTES de diseñar cada pieza; auditoría tspoon (dump
  tspoon_dump/) obligatoria antes de decisiones importantes. No vender empate como victoria.
- Deuda 0: cerrar problemas, no rodearlos. Si discrepas, dilo (sin pelotismo).
- NO deduzcas datos que no son: una deducción que mete ventas/datos en el sitio equivocado
  corrompe todo. Lee el dato de la fuente. Pero SÍ deduce cuando los datos lo permiten.
- Mide la info que escribes: como la que recibe un trabajador. Si es buena se lee; si es
  mucha, ni se mira. Conciso.
- Yo decido cuándo cerrar. No me sesgues a parar por duración; solo recomienda parar si
  hay riesgo técnico real.

Stack: React19/Vite8/TS6 strict/Tailwind3/Supabase Pro (xzmpnchlguibclvxyynt, eu-west-1).
Repo C:\dev\llorente29-app, rama main, deploy Vercel a app.folvy.app. Edge Functions vía CLI.
Cuentas: trabajar SIEMPRE en Folvy Interno (00000000-0000-0000-0000-000000000001);
Llorente29 (51ad1792-...) vacío hasta migrar. Producción objetivo: 7 sept 2026.

FRENTE DE HOY (continúa el autoinventario IA, diseño aprobado en
docs/folvy_autoinventario_diseno.md):
- A1-FUNCIÓN: función SQL de ABC/score AL VUELO (no persistida) que devuelve la cola
  priorizada de artículos de un local. Combina: valor (consumo de stock_movement
  movement_type='consumo' qty_base*unit_cost + stock_value de refuerzo) + rotación +
  riesgo (variance_* de inventory_count_line + stock_waste; el riesgo promociona un barato
  a clase alta) + override de criticidad operativa (is_operational_critical, ya en esquema).
  Será SECURITY DEFINER → crear con BEGIN/CREATE/COMMIT sola, verificar desde la app.
- A2: cola priorizada VISIBLE (servicio + vista mínima que muestra qué contar hoy y por qué).
- Construir A1-función + A2 juntas (la función sola no se puede verificar sin consumidor).

OTROS PENDIENTES (anotados, no urgentes):
- Importar CATÁLOGO CTB (lastapp-catalog-import a org Cloudtown b7bc4753) para que las
  ventas CTB entren COMPLETAS (hoy entran pero no casan: lastapp_catalog_product=0).
  Diseño en docs/folvy_onboarding_integraciones_diseno.md.
- Frente onboarding integraciones genérico (alta integración + pantalla alta guiada local +
  RPC reproceso del log + import marcas/menús cedidas).

Empieza por el paso 1 del arranque.
```

---

## 3. RESUMEN DE LO CERRADO HOY (verificación)

Commits en producción hoy:
- `9898d4c` — T1 inventario de apertura
- `2e02f69` — T2 registro de merma proactivo
- `5f9cb7d` — Autoinventario A1 esquema (criticidad operativa) + diseño + onboarding doc

Deploy: `lastapp-webhook` v17+ con `--no-verify-jwt` (arreglo local no mapeado).

Mapeo manual: 3 filas en `lastapp_location_map` (tiendas CTB → Foodint).

Estado: build verde, git al día (rev-list 0), sin nada a medias.

Memorias actualizadas: #19 (autoinventario, estado real) + #21 (onboarding CTB pendiente).

Docs generados: folvy_autoinventario_diseno.md, folvy_onboarding_integraciones_diseno.md,
folvy_t2_merma_diseno.md (todos versionados en commits de hoy).
