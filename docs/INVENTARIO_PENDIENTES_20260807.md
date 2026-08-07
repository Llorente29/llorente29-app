# INVENTARIO MAESTRO DE PENDIENTES (07/08/2026)

> Objetivo: que **nada quede indefinido ni se pierda**. Cada item tiene DUEÑO y SIGUIENTE ACCIÓN.
> Fuentes: `folvy_estado.md`, `folvy_frentes.md`, `ENCARGO_CODE_team_completo.md` + RECON de hoy.
> "Terminar todo" no cabe en una sesión: gran parte es código (Code), decisión tuya, externo o físico.
> Esto lo convierte en tareas ejecutables.

---

## ✅ CERRADO HOY (07/08) — aplicado y verificado en vivo
- Marlón fuera de sus semanas de vacaciones (publicada + borrador).
- RECON de las 6 áreas huérfanas escrito en el mapa.
- **F0.1** triggers (24) sin anon · **F0.2** search_path (11) · **c1 piloto** (15 internas) sin anon.
- **F0.4** huecos de tablas sin RLS cerrados (`social_n2_usage`, `football_team_city`).
- anon-exec DEFINER: **361 → 325**. Docs (mapa/estado/team) al día. 4 migraciones para el repo.

---

## 🔵 TUYO (Julio) — externo, decisión o físico. No lo puede cerrar Claude.

| # | Item | Siguiente acción |
|---|---|---|
| 1 | **HubRise — plan/pago** 🔴 | Entrar al panel y pagar. Tope gratuito 5 pedidos, corta sin aviso |
| 2 | HubRise — auditoría Antoine + bridge que no reenvía estado a Uber | Responder a Antoine (`amonnier@hubrise.com`, hilo `partners@`) |
| 3 | Glovo — contacto Linda Liang | Vía Janaina |
| 4 | **Pamela — 9 huecos de Carabanchel (3–9 ago)** | Que rellene el cuadrante |
| 5 | Borrar 11 tablas `_backup_*` (inventario listo, deny-all seguras) | Tu OK → Claude ejecuta el DELETE |
| 6 | Fusionar/desactivar 3 empleados duplicados (Johanny, Natacha, Pamela) | Tu OK → Claude ejecuta (F1.2) |
| 7 | Qué tipos de ausencia descuentan horas (F2.1) | Decisión de convenio |
| 8 | Qué `shift_templates` de Alcalá conservar (F7.2) | Decisión operativa |
| 9 | Dimensionamiento: aplicar Carabanchel / decidir viernes Alcalá | Decisión |
| 10 | Reparto legal + CFG-9 autofactura | Consultar laboralista |
| 11 | **Backup de `folvy-release.jks`** (2 sitios) | Irreemplazable |
| 12 | Verificar OTA Capa 2 en tablet física | Prueba en tablet |
| 13 | Permiso para tocar `App.tsx` (sidebar no colapsa en móvil) | Tu autorización |
| 14 | Prueba de humo del front tras cada lote de revokes anon | Abrir pantallas de gestión |

---

## 🟣 CLAUDE CODE — código / repo. Encargo especificado, ejecuta Code.

**Team (cimiento, encargo `ENCARGO_CODE_team_completo.md`):**
- Commitear fix de vacaciones del generador (`scheduleGenerator.ts` + `CalendarioPage.tsx`) + gemelo en `scheduler.ts`.
- **F1.1** guard anti-doble-fichaje (16 pares <30s) + void retroactivo con rastro.
- **F1.3** invertir redondeo (`real_datetime` = verdad legal) · **F1.4** jornada anclada a la entrada · **F1.5** registro de pausas.
- **⚠️ Guardado manual del cuadrante NO valida vacaciones** (F7.1) — el bug de Marlón de raíz.
- Reconvertir los prototipos de Team a paleta de marca.

**Drift repo↔producción (reconciliar sin redesplegar salvo que se indique):**
- `hubrise-order-status` PUT→PATCH · `hubrisePush.ts` PUT→PATCH · `catcher-dispatch` flip staging→api · `ClosureAnomalyAlarm variant="fixed"` (push) · `sales_dashboard` RPC versionar · `bag_on_ready` versionar · `create_dish_from_unmapped`/`run_mapping`/`auto_map_exact_sales`/`warehouse_reliability_queue`/`sales_mapping_reliability`.

**Seguridad (código):**
- **c1 externo + c2 — GREP del front/edge** para construir la allowlist pública (place_shop_order, customer_*, lectura de carta del shop, `resolve_delivery_zone`…) → luego Claude revoca anon del resto. *(Este grep es lo que desbloquea terminar F0.1.)*
- `x-order-advance-secret` hardcodeado en `trg_sale_push_status` → `internal_secret()`.
- Barrido de hardcodes de marca (Fase 0) antes de cliente 2.

**Bugs de núcleo (sesión dedicada, reproducir antes):**
- Bloqueo por unidad no convertible (línea de escandallo se salta en silencio).
- "Eliminar no elimina" (plato borrado sigue vivo).
- Enlazado catálogo↔escandallo: 107 `menu_item.recipe_item_id` a recetas vacías → no descuenta stock/AvT.
- Anomalía 141 `menu_item.is_available=false` (mass-set 4-jul).
- Dashboard ventas: quitar `slice(0,8)` + resolver `brand_id` NULL.
- Nivel 3 del ticket (combo→item→modificador) · Check de horarios que miente (`AvailabilityConfigSection.tsx`) · Combos con slots omitidos · `adapt_hubrise_order` prefijos `marca:`/`shr_`.

**Obligatorios 12/06:**
- Acceso trabajador reentrada por PIN · PWA instalar directo Android · completado masivo no retira `needs_review`.

---

## 🟢 BBDD (Claude, próximas sesiones — seguro, requiere orden)

- **F0.1 resto**: revocar anon de c1 externo (~38) + c2 (148 helpers), **tras** la allowlist del grep. Patrón: bloquear anon, mantener authenticated/service_role. Yo aplico + verifico.
- **F0.3**: dar política explícita a las 8 tablas reales con RLS-sin-política (o documentar deny-all intencional): `customer_otp`, `customer_session`, `employee_formations`, `external_webhook_log`, `hubrise_oauth_state`, `hubrise_writer_connection`, `platform_api_token`, `weather_poll`. (Hoy en deny-all = seguras; es higiene.)
- **F0.5**: `account_id` denormalizado + trigger + backfill + RLS directa en las 15 tablas de Team sin cuenta + **test de aislamiento entre cuentas**. Migración de esquema grande — sesión dedicada, con red (PITR).
- **Auditoría de los 30 `*_by_token`**: verificar que cada una valida el token y lo ata a su cuenta/local.
- **Grants globales a anon**: `anon` tiene DML en muchísimas tablas (protegidas por RLS). Auditar el GRANT global; RLS lo tapa, es higiene.

---

## 🟡 DISEÑO / NEGOCIO (decisiones, no ejecución)
- Incentivos (RECON+benchmark hechos, falta diseño) · CRM F5–F9 · Visión de cocina (hardware ~160€) · i18n EN/FR (aparcado) · demo client · Ofertas/RRSS (robot Uber, pantalla unificada, 2x1, Glovo v4) · Migrar Shop a estilo B + publicar 17 marcas.

---

## Realidad
De todo esto, lo que **Claude puede cerrar solo** es la columna verde (BBDD, por lotes con verificación).
Lo verde grande (F0.5) necesita sesión dedicada con red. Lo morado necesita Code. Lo azul te necesita a ti.
**Prioridad única con reloj: #1 (pagar HubRise).** El resto no corre, pero ahora está todo con dueño.
