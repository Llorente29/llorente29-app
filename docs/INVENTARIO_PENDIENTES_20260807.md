# INVENTARIO MAESTRO DE PENDIENTES (07/08/2026 · v2)

> Objetivo: que **nada quede indefinido ni se pierda**. Cada item tiene DUEÑO y SIGUIENTE ACCIÓN.
> v2 corrige v1: el "empleado duplicado" NO era un bug (era copia sandbox), y marca F0.5 + F1 como hechos.

---

## ✅ CERRADO HOY (07/08) — aplicado y verificado en vivo
- Marlón fuera de sus semanas de vacaciones (publicada + borrador).
- RECON de las 6 áreas huérfanas escrito en el mapa.
- **F0.1** triggers (24) sin anon · **F0.2** search_path (11) · **c1 piloto** (15 internas) sin anon.
- **F0.4** huecos de tablas sin RLS cerrados (`social_n2_usage`, `football_team_city`).
- **F0.5 COMPLETO** — viga maestra: `account_id` directo (columna + backfill + trigger de auto-relleno +
  NOT NULL + índice) en las 15 tablas núcleo de Team, y **RLS reescrita a `account_id` directo** en las 44
  políticas. Verificado en front (6 pantallas de Team cargan). Team es multi-cliente de raíz.
- **F1.1 COMPLETO** — dobles fichajes: saneados 18 pares glitch (voided + auditoría, reversible) **y guard
  preventivo** (`trg_clock_debounce`, probado) para que no vuelvan a ocurrir.
- **F1.3 COMPLETO** — `real_datetime` como verdad legal: corregido el bug del alta manual (grababa
  `now()`), tapadas las 3 funciones de escritura, y `team_worked_shifts` computa sobre `real_datetime`.
- **F1.4 COMPLETO** — `team_worked_shifts` ancla la jornada a la entrada (robusto al borde de periodo).
- anon-exec DEFINER: **361 → 325**. Docs al día. ~14 migraciones para el repo (rama `chore/f0-...`).

---

## 🔵 TUYO (Julio) — externo, decisión o físico. No lo puede cerrar Claude.

| # | Item | Siguiente acción |
|---|---|---|
| 1 | **HubRise — plan/pago** 🔴 | Entrar al panel y pagar. Tope gratuito 5 pedidos, corta sin aviso |
| 2 | HubRise — auditoría Antoine + bridge que no reenvía estado a Uber | Responder a Antoine (`amonnier@hubrise.com`) |
| 3 | Glovo — contacto Linda Liang | Vía Janaina |
| 4 | **Pamela — 9 huecos de Carabanchel (3–9 ago)** | Que rellene el cuadrante |
| 5 | Borrar 11 tablas `_backup_*` (inventario listo, deny-all seguras) | Tu OK → Claude ejecuta el DELETE |
| 6 | **Logins fantasma de Folvy Interno** (borrar del todo o dejar) | Decisión: los 3 logins del sandbox (`zz.foodint1@`, `natacha.foodint@`, `pamela.alcala@`) — borrarlos es irreversible; dejarlos es inofensivo. Los de Llorente29 intactos. |
| 7 | Qué tipos de ausencia descuentan horas (F2.1) | Decisión de convenio |
| 8 | Qué `shift_templates` de Alcalá conservar (F7.2) | Decisión operativa |
| 9 | Dimensionamiento: aplicar Carabanchel / decidir viernes Alcalá | Decisión |
| 10 | Reparto legal + CFG-9 autofactura | Consultar laboralista |
| 11 | **Backup de `folvy-release.jks`** (2 sitios) | Irreemplazable |
| 12 | Verificar OTA Capa 2 en tablet física | Prueba en tablet |
| 13 | Permiso para tocar `App.tsx` (sidebar no colapsa en móvil) | Tu autorización |
| 14 | PR de la rama `chore/f0-seguridad-docs-0708` a `main` | Cuando cierres el frente |

> ❌ ELIMINADO de v1: "Fusionar 3 empleados duplicados". **No era un bug.** Johanny/Natacha/Pamela
> aparecen dos veces porque hay una copia en **Llorente29 (Foodint)** y otra en **Folvy Interno (sandbox)**
> — cuentas distintas, UNA fila por cuenta. Cero duplicados reales en toda la base (verificado). No hay
> nada que fusionar. (Un intento de fusión el 07/08 cruzó cuentas por error y se revirtió por completo.)

---

## 🟣 CLAUDE CODE — código / repo.

**Team (cimiento):**
- Commitear fix de vacaciones del generador (`scheduleGenerator.ts` + `CalendarioPage.tsx`) + gemelo en `scheduler.ts`.
- **⚠️ Guardado manual del cuadrante NO valida vacaciones** (F7.1) — el bug de Marlón de raíz.
- **F1.5** registro de pausas/descansos (feature: capturar el descanso en kiosko + restarlo de horas).
- UX del guard anti-doble-fichaje: capturar `DOBLE_FICHAJE_MUY_RAPIDO` y debounce visual del botón (ver `ENCARGO_CODE_f1_guard_fichaje_y_bolsa_horas.md`).
- Verificar que **Bolsa de horas** computa vía `team_worked_shifts` y no por su cuenta con `datetime`.
- Reconvertir los prototipos de Team a paleta de marca.

> ✅ HECHO (ya no es de Code): F1.1 guard + void, F1.3 invertir redondeo, F1.4 jornada anclada — todo aplicado en BBDD hoy.

**Drift repo↔producción:** `hubrise-order-status` PUT→PATCH · `hubrisePush.ts` PUT→PATCH · `catcher-dispatch` staging→api · `ClosureAnomalyAlarm variant="fixed"` · versionar `sales_dashboard`/`bag_on_ready`/`create_dish_from_unmapped`/`run_mapping`/`auto_map_exact_sales`/`warehouse_reliability_queue`/`sales_mapping_reliability`.

**Seguridad (código):**
- **c1 externo + c2 — GREP del front/edge** para la allowlist pública (place_shop_order, customer_*, carta del shop, `resolve_delivery_zone`…) → luego Claude revoca anon del resto. *(Desbloquea terminar F0.1.)*
- `x-order-advance-secret` hardcodeado en `trg_sale_push_status` → `internal_secret()`.
- Barrido de hardcodes de marca (Fase 0) antes de cliente 2.

**Bugs de núcleo (sesión dedicada):** unidad no convertible · "eliminar no elimina" · 107 `menu_item.recipe_item_id` a recetas vacías · 141 `is_available=false` (4-jul) · dashboard ventas `slice(0,8)`+`brand_id` NULL · nivel 3 del ticket · check de horarios que miente · combos con slots omitidos · `adapt_hubrise_order` prefijos.

**Obligatorios 12/06:** acceso trabajador reentrada por PIN · PWA instalar directo Android · completado masivo no retira `needs_review`.

---

## 🟢 BBDD (Claude, próximas sesiones — seguro, requiere orden)
- **F0.1 resto**: revocar anon de c1 externo (~38) + c2 (148 helpers), **tras** la allowlist del grep.
- **F0.3**: política explícita a las 8 tablas con RLS-sin-política (o documentar deny-all): `customer_otp`, `customer_session`, `external_webhook_log`, `hubrise_oauth_state`, `hubrise_writer_connection`, `platform_api_token`, `weather_poll`. (`employee_formations` ya tiene política desde F0.5.)
- **F0.6**: permisos por rol (va con las pantallas).
- **Auditoría de los 30 `*_by_token`**: que cada una valide el token y lo ate a su cuenta/local.
- **Grants globales a anon**: auditar el GRANT global de DML (RLS lo tapa; es higiene).

> ✅ HECHO: **F0.5** (denormalización account_id + RLS directa en las 15 de Team). Falta solo el **test de aislamiento entre cuentas** formal (cuando haya un cliente 2 o un arnés de prueba).

---

## 🟡 DISEÑO / NEGOCIO
Incentivos · CRM F5–F9 · Visión de cocina · i18n EN/FR (aparcado) · demo client · Ofertas/RRSS · Migrar Shop a estilo B + publicar 17 marcas de formación.

---

## Realidad
Hoy se cerró **F0.5 entero** (multi-tenencia de Team) y **F1.1/F1.3/F1.4** (datos de fichaje limpios y
robustos). Lo que queda de F1 es F1.5 (pausas, feature). **Prioridad única con reloj: #1 (pagar HubRise).**
