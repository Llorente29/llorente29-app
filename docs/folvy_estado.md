# Folvy — ESTADO (leer esto primero)

> **Actualizado**: 06 ago 2026 (noche)

## 🔄 CÓMO OPERAR (esto no cambia entre sesiones)
- **APERTURA**: lee este doc (`folvy_estado.md`) → frente activo + estado. Si necesitas más: `folvy_frentes.md` (todo lo abierto) · `folvy_indice.md` (mapa de todos los docs) · **`folvy_mapa_sistema.md` (inventario técnico verificado contra BBDD)** · **el `*_estado.md` del área**. **Reglas no negociables: `folvy_reglas.md`.** Cómo golear: `folvy_competitive_map.md`.
- **CIERRE**: cuando Julio diga *"cerramos"*, sigue el ritual: actualizar este estado + el `*_estado.md` del área + `folvy_frentes.md` + `folvy_indice.md` + `folvy_mapa_sistema.md` si hubo hallazgos + entrada en el archivo mensual. NO tocar `folvy_guion_vivo.md` ni `CONTEXTO_CLAUDE.md` (archivados).
- **VERDAD TÉCNICA**: la BBDD por MCP + el repo, NUNCA un doc. RECON contra fuente primaria antes de diseñar. **Todo hallazgo de RECON que contradiga/amplíe un doc → se escribe en `folvy_mapa_sistema.md` en el momento.**
- **⚠️ REGLA (30/07): NO fiarse del "Success" del SQL editor.** Verificar cada objeto creado con query independiente. Una sentencia por Run en operaciones críticas. Guard `DO` en cada migración.
- **⚠️ REGLA NUEVA (06/08) — NO DESTRUCCIÓN**: nada se elimina, oculta ni renombra sin inventario previo y **aprobación explícita de Julio**. Lo que parece suciedad suele ser una decisión tomada. Todo encargo lleva arriba una sección **"decisiones vigentes que este encargo NO revisa"** con fecha y doc.
- **⚠️ REGLA NUEVA (06/08) — ARRANQUE CON ÍNDICE**: antes de diseñar en un área, abrir `folvy_indice.md` y leer **todos** los docs de esa sección. Esta sesión se diseñó Team sin leer sus 3 docs y se contradijeron 9 decisiones vigentes.
- **ANTES DE ABRIR UN FRENTE**: `project_search` + `conversation_search` + RECON en BBDD.

---

## ✅ RECIÉN CERRADO (07/08) — Marlón + RECON 6 áreas + F0 arrancado

- **Marlón Mafla**: quitados sus turnos de las semanas de vacaciones en la BBDD (publicada 3-9 ago +
  borrador 10-16 ago), verificado en vivo. Quedan 2 históricos de julio (Natacha borrador, Pamela
  publicado) sin tocar por ser pasado. 🔴 **Pamela debe rellenar los 9 huecos de Carabanchel (3-9 ago).**
- **RECON de las 6 áreas huérfanas** hecho y escrito en `folvy_mapa_sistema.md`
  (+ fichero `mapa_sistema_areas_huerfanas_20260807.md`): Team, app del trabajador, notificaciones,
  autoinventario, APPCC, recepciones. Hallazgo: **APPCC no está muerto** (381 ejecuciones, 214 firmas
  vivas); lo muerto son avisos, responsables y auditoría. Ancla de tenencia = `locations.account_id`;
  15 tablas del núcleo de Team sin `account_id` (no 10).
- **F0 seguridad arrancado y aplicado + verificado**: 24 triggers + 11 search_path + 15 internas c1.
  **anon-exec 361 -> 325.** Inventario clasificado en `F0_1_inventario_definer_20260807.md`.
  Lección: el EXECUTE se hereda de PUBLIC -> revocar de PUBLIC, no solo de anon. 3 migraciones para
  commitear (`20260807T12*_f0_*.sql`).

---

## ✅ RECIÉN CERRADO (06/08) — SESIÓN DOBLE: HUBRISE GO-LIVE + AUDITORÍA COMPLETA DE TEAM

### Parte A — HubRise: Uber Eats migrado de LastApp a HubRise (producción)
Migración completa en caliente. **Pedidos, autoaceptación y código de pase funcionando end-to-end.**
- `hubrise-webhook` **v46**: bug crítico resuelto — `maybeAckReceived`/`maybeAutoAccept` llamaban a `pushOrderStatus` sin token, cayendo al Secret global de test → **todos los push de producción fallaban en silencio** y se perdían pedidos (F1B18, 6DAB8). Fix: `resolveHubriseToken` por conexión. v45 añadió captura de `collection_code` en `platform_order_code` (el repartidor pide "DC034", no el id interno de HubRise).
- `availability-watchdog` **v6**: estaba desplegada con `verify_jwt: true` y el cron la llamaba sin Authorization → **401 cada 15 min en silencio**. Redesplegada con `verify_jwt: false`.
- **Token escritor reconectado** por OAuth (revocado al recablear marcas el 5/08; todos los push de 86 daban 401). Primer intento fue a la cuenta de test `zy9j2`; rehecho contra producción `1b6p8`.
- **86 multiselección + lote**: migración `20260806T1700` con 10 funciones (core extraído, `set_products_availability_bulk` hasta 50 productos con un solo dispatch, búsqueda que incluye combos y excluye agotados, `_scope_preview_core` con `channelsLast` + `brandsHubrise` separados). PR #39 mergeada.
- **Fotos de combos**: `hubrise-catalog-publish` **v38** — el mapa de imágenes se indexaba por posición y solo recogía productos; ahora por `menu_item_id` y recoge también combos. Verificado en el escaparate de Uber.
- **Cron `hubrise-order-stuck-watchdog`** (jobid 36, cada 2 min, umbral 3 min).
- **Bridge de Uber no reenvía el estado**: aunque nuestro push devuelva 2xx, Uber mostraba "no aceptado". No es código nuestro. Workaround: autoaceptación en las tablets de Uber. Pendiente escribir a Antoine.

### Parte B — Team: auditoría completa + diseño + encargo
**Team no tenía doc de área. Ahora sí: `folvy_team_estado.md`.** Ahí está todo el detalle.
- Auditoría sobre datos vivos: **26 hallazgos**, de los cuales 5 son 🔴.
- **Lo más urgente (arreglo manual, no desarrollo)**: **Marlón Mafla tiene vacaciones aprobadas del 3 al 9 de agosto y 9 turnos en el cuadrante PUBLICADO de esa semana.** `generateSchedule` SÍ valida vacaciones; **la edición manual NO**.
- Bloqueante para cliente 2: **358 funciones `SECURITY DEFINER` ejecutables por `anon`**, 77 con `search_path` mutable, 19 tablas con RLS sin políticas, y **10 tablas del núcleo de Team sin `account_id`** (tenencia por 3 saltos).
- Datos sucios: 16 dobles fichajes que parten jornadas (271 turnos donde hay 207), 3 empleados duplicados, `clock_entries.scheduled` poblado en 12 de 574 y uno mal.
- Cómputo roto: `monthly_balance_closures` con 3 cierres **todos a cero**; `vacations` sin cablear a las funciones de horas; contratado sin prorrateo.
- Legal: **94% de jornadas nocturnas** (toda la plantilla es trabajadora nocturna, art. 36 ET) sin calcular plus ni límites; Johanny al 76% del tope anual de extras en un mes; no existe calendario laboral de festivos.
- **Descubrimiento de encuadre**: la app del trabajador no es "el portal de Team", es la **superficie única del trabajador para todo Folvy** — fichaje, horario, nóminas, formación, APPCC, recepciones y **autoinventario** (135 conteos, 3.868 líneas). Sesame y Bizneo no lo tienen ni lo pueden tener. Es un argumento comercial más fuerte que las pantallas de gestión.
- **Benchmark**: Sesame cobra nocturnidad y horas extra por convenio como complemento desde 13 €/empleado/mes (1.248 €/año para 8 personas) y la IA de turnos a 49 €/mes. En Folvy es el caso base.
- **Encargo vigente**: `ENCARGO_CODE_team_completo.md` (12 fases, F0 seguridad → F11 armonización).
- **⚠️ Autocrítica registrada**: se diseñó Team sin leer sus 3 docs de área y se contradijeron 9 decisiones vigentes (Opción 2 de turnos, semáforo reservado a cobertura, 12 platos/hora, clima apagado, paleta de marca…). Todas quedan listadas en `folvy_team_estado.md`. Los prototipos HTML usan paleta genérica y **hay que reconvertirlos**.

---

## 🔨 PENDIENTE INMEDIATO

1. ✅ **Marlón Mafla — turnos quitados** (3-9 ago publicado + 10-16 ago borrador) en BBDD, verificado. Falta: **Pamela rellena los 9 huecos de Carabanchel**.
2. ✅ **RECON de las 6 áreas huérfanas** hecho y escrito en `folvy_mapa_sistema.md`. (Era la causa raíz de la pérdida de contexto.)
3. **Plan/pago de HubRise** — el tramo gratuito tiene tope de 5 pedidos y puede cortar el servicio sin aviso.
4. **Republicar las 8 marcas restantes** con fotos de combos + activar "Enable automatic catalog push" en los 9 bridges.
5. **Archivar las 17 marcas muertas duplicadas** (bloquean el filtro de marca del 86).
6. **Reempujar los 16 SKU agotados** históricos que nunca llegaron a HubRise (token muerto).
7. **Reconvertir los prototipos de Team a la paleta de marca** (marino `#1E3A5F`, terracota `#D67442`, crema `#F5F4F0`).
8. **Escribir a Antoine** sobre el bridge que no reenvía el estado a Uber.
9. Reconciliar drift `PUT→PATCH` en repo (`hubrise-order-status`, `hubrisePush.ts`) sin redesplegar.
10. Verificar OTA Capa 2 en tablet física.

---

## 🎯 FRENTE ACTIVO — FOLVY TEAM (salida al mercado / cliente 2)
HubRise queda operativo; Team pasa a ser el frente. **Doc de área: `folvy_team_estado.md`. Encargo: `ENCARGO_CODE_team_completo.md`.**

**Orden**: F0 seguridad y multi-tenencia → F1 saneado del dato → F2 cableado → F3 contrato y festivos → F4 pantallas → F5 artefactos legales → F6 cumplimiento → F7 cuadrante → F8 app del trabajador → F9 kiosko → F10 generador → F11 armonización.

**F0 y F1 son cimiento y no se paralelizan bien. De F4 en adelante sí.**

---

## ⏭️ SIGUIENTES
1. **Entorno paralelo** — decidido explorar: rama git + preview de Vercel (ya disponible) · ramas de Supabase para esquema · semilla anonimizada o validación de solo lectura contra producción para lo analítico · cuenta **Folvy Interno** como inquilino de ensayo. **Aviso: la APK empaqueta la web, así que un deploy de Vercel NO llega a las tablets** — hace falta el canal OTA dual ya diseñado.
2. **Sistema de incentivos** — RECON y BENCHMARK hechos; falta DISEÑO.
3. **Recalibrar umbrales del KPI** de cocina.
4. **Capa 5 — reconciliación Catcher.**
5. **i18n (EN/FR)** — aparcado.

## 🔭 FRENTE DE I+D — Visión en cocina (diseñado 26/07, sin construir)

## 🚧 BLOQUEOS EXTERNOS
- **HubRise**: plan/pago pendiente (tope 5 pedidos). Auditoría de Antoine pendiente de respuesta. Bridge que no reenvía estado a Uber.
- **HubRise / Glovo**: contacto Linda Liang.
- **Ingesta de reseñas** — sin feed vivo.

## 🔧 DEUDA / PENDIENTES MENORES
- **🔴 Seguridad (bloquea cliente 2)**: 325 funciones DEFINER ejecutables por `anon` (tras F0.1/F0.2 el 07/08; plan por lotes en `F0_1_inventario_definer_20260807.md`) · 14 DEFINER sin `search_path` (11 corregidas 07/08; 3 PostGIS excepción) · 19 tablas con RLS sin políticas · 10 tablas de Team sin `account_id` · rotación del secreto `fv_avl_…` (valor en git history) · `HUBRISE_ACCESS_TOKEN` global · `external_integration.access_token` en texto plano · bucket `delivery-proof` PÚBLICO.
- **🔴 Drift repo↔producción**: `hubrise-webhook` v45/v46, `availability-watchdog` v6, `hubrise-catalog-publish` v38, `tg_auto_dispatch`, `dispatch_watchdog_scan`, `auto_map_exact_sales`, `warehouse_reliability_queue`, `sales_mapping_reliability`, `create_dish_from_unmapped`, `hubrise-order-status` PUT→PATCH, `hubrisePush.ts` PUT→PATCH, `sales_dashboard` RPC no versionada.
- **🟠 SKU compartidos con namespacing** — decisión de negocio pendiente (15 external_ids compartidos entre marcas).
- **🟠 `adapt_hubrise_order`**: los refs vienen con prefijo `marca:`/`shr_` → no casan producto → sin alérgenos ni escandallo en pedidos HubRise.
- **🟠 Nivel 3 del ticket** (combo → item → modificador) no se pinta.
- **🟠 Check de horarios que miente** (`AvailabilityConfigSection.tsx`).
- **🟠 Combos con slots omitidos**: Milanesa House, Meraki Pita, Lovers Burgers.
- **🟠 Dashboard de ventas**: ranking truncado a 8 (`slice(0,8)`) + ventas sin `brand_id`.
- **Cinco "estructuras sin combustible"**: `delivery_assignment`, `channel_review`/`channel_incident`, `handed_to_courier_at`, `clock_entries.scheduled`, `recipe_item_production_check`. **Añadir**: `employee_availability` (0), `open_shifts` (0), `appcc_notifications` (0), `appcc_schedule_responsibles` (0).
- **Impresión — 17% de fallo histórico.** Nadie mira `print_job.last_error`.
- **🔑 Backup de `folvy-release.jks`** — Julio: 2 sitios. Irreemplazable.
- Barrido de hardcodes de marca antes de cliente 2.

---
_Tablero: `folvy_frentes.md`. Inventario técnico: `folvy_mapa_sistema.md`. Reglas: `folvy_reglas.md`. Mapa de docs: `folvy_indice.md`. Área Team: `folvy_team_estado.md`._
