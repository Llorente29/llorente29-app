# Cierre de sesión — 16 jun 2026
### Sesión de integraciones + estrategia de canal directo

> Ejecutado el ritual de `folvy_cierre_sesion.md` (7 pasos). Esta sesión fue mayormente DISEÑO + ESTRATEGIA + un fix; poco código nuevo, mucha decisión.

---

## 1. Estado técnico (¿algo peligroso a medias?)
- **Build verde, nada peligroso a medias.** El único commit de código de hoy es el fix de cambios de turno: **`9af0a0c`** (`git rev-list --left-right --count origin/main...main` = `0 0`).
- Sin despliegues a medias. El esqueleto `otter-webhook` está en el repo pero **NO desplegado** (correcto: el alta de Otter aún no está concedida; cuando se despliegue, `--no-verify-jwt`).
- `database.ts` sin cambios de esquema hoy → no requiere regeneración.

## 2. Seguridad (rotaciones pendientes — arrastradas)
- Rotar **service_role key**, **`LASTAPP_INTERNAL_KEY`** (e1f05c66) y **token Last** (247ef137).
- **www.folvy.app** devuelve NXDOMAIN.
(No se pegaron credenciales nuevas en esta sesión.)

## 3. Qué se hizo hoy

**FIX (commiteado):**
- **Cambios de turno del trabajador** — `fetchColleagues(locationIds)` en `supabaseSync.ts` (compañeros por local, la RLS filtra por cuenta; reemplaza `fetchEmployees(null)` que devolvía `[]`) + `SolicitarCambioModal` / `TablonCambiosView` / `MisCambiosView`. El "bloqueante" de login del trabajador (`El empleado no pertenece a tu cuenta`) era **FALSO**: sesión cruzada de admin cacheada en el navegador de localhost; en producción funcionaba. Commit `9af0a0c`. **Pendiente: validar la confirmación de INTERCAMBIO con un trabajador real en producción.**

**DISEÑO + ESQUELETOS (nada desplegado):**
- **Otter** — adaptador diseñado + esqueleto hasta el límite del alta. Docs `docs/folvy_adaptador_otter_diseno.md` + `supabase/functions/otter-webhook/index.ts`. Frontera valida `X-HMAC-SHA256` (base64 del body con secret); `order.create` 200/202; catálogo BIDIRECCIONAL (Menus + Menus Manager); **NO hay API de promociones**; deploy obligado `--no-verify-jwt`. Alta requiere **Application ID + Client Secret de un Account Representative** (NO credenciales de cliente como Last). **2º correo de partnership ENVIADO.**
- **HubRise** — muy avanzado (Janaina; reseller desde 6ª cuenta −28,6 %; setup 25 €/conexión, 1ª marca/local gratis, −50 % agrupado; sub 35 €→10 €/local; sin sandbox=producción, cuenta test "Folvy"; Glovo ES sin fecha). **El CLIENTE 2 (1 local, 6 marcas, Uber+JustEat, SIN Glovo) DESBLOQUEA HubRise = vía rápida sin esperar a Otter.** Correo de reactivación a Janaina preparado. Build = adaptador `hubrise` (1 API cubre Uber+JE) sobre ingesta canónica.
- **Last (hallazgo)** — no expone estado abierto/cerrado de marca/canal (ni endpoint ni evento; propuesto sin fecha). Desactivación de PRODUCTO sí, vía `catalog:updated`. ⇒ **la alarma de disponibilidad se construye sobre HORARIOS (horario declarado), no sobre Last.**

**ESTUDIO + DECISIÓN:**
- **Tienda propia = Folvy Shop** — estudio en `docs/folvy_tienda_propia_estudio.md` + maquetas (storefront de marca con modificadores; hub multimarca con carrito cruzado). Único canal directo que conoce el margen real; pedido por ingesta canónica (`external_source='folvy_shop'`) → KDS+stock+AvT; carrito CRUZADO multimarca con UNA entrega (ventaja dark-kitchen). Stripe Connect MVP; fases S1 pickup → S5. **MARKETPLACE B2C de Folvy = otro negocio, APARCADO.**
- **Motor de ofertas por plataforma** — auditado (regla deuda-0). **YA EXISTE: Pleez** (trypleez.com, Madrid, 2020, Buenavista Equity) hace ofertas por canal con push de 1 clic a Uber/Glovo/Deliveroo, guardarraíles de margen, **clima + eventos deportivos**, competitor tracker (opera vía credenciales del restaurante + scraping de escaparates). Sapaad y Nory rozan el área. **DECISIÓN: NO clonar.** Folvy se queda solo con el guardarraíl de margen real por plato×plataforma. Pleez = posible integración. Doc `docs/folvy_motor_ofertas_diseno.md`.

## 4. Documentos actualizados / nuevos (para `docs/`)
- **Nuevos:** `docs/folvy_adaptador_otter_diseno.md`, `docs/folvy_tienda_propia_estudio.md`, `docs/folvy_motor_ofertas_diseno.md`, este cierre.
- **Actualizados:** `CONTEXTO_CLAUDE.md` (§1 — bloque 16/06 al inicio), `folvy_guion_vivo.md` (cabecera + 0.bis + frente 10 Tienda propia + decisión motor de ofertas + HECHO cambios de turno), `folvy_competitive_map.md` (Área 6 — fila + nota Pleez).
- **Código:** `supabase/functions/otter-webhook/index.ts` (esqueleto, NO desplegar aún).
- Memorias actualizadas (#3 motor de ofertas/Pleez; #21 delivery+integraciones+canal directo).

## 5. Frente activo de la próxima sesión
Los **OBLIGATORIOS A–D** siguen abiertos y mandan sobre lo nuevo. El más cercano al dinero y a producción es **OBLIGATORIO D — editar precios de proveedor desde la app** (Pamela depende de SQL si no; decisión de raíz: qué es `last_price`, €/caja vs €/base). Le sigue **C** (masivo cierra `needs_review`) y el **frente 1** (cobertura de escandallos).

## 6. Deudas que se arrastran
- Versionar SQL viva: `apply_inventory_count` v3, `close_inventory_count` (saneamiento negativos), CHECK alérgenos, `materialize_recipe_session`, `run_mapping`, fixes RLS → migraciones.
- `build_inventory_count` aún rellena `system_qty` (ya no se usa, limpiar).
- Quitar puente `is_internal=true` de Llorente29 al construir aprovisionamiento de cuenta.
- Coords de Plaza Castilla y Carabanchel.
- Drift SQL en raíz del repo (`format_price_per_base.sql`, `supplier_format_prices.sql`).

---

## Prompt de arranque de la próxima sesión

```
Soy Julio Gª Colón, CEO de Folvy. Proyecto serio en desarrollo activo.

ARRANQUE:
1. Confirma que has leído CONTEXTO_CLAUDE.md (§1 estado vivo, bloque 16/06), folvy_guion_vivo.md (frente activo) y la sección del mapa competitivo del área de hoy.
2. Resume en 5 líneas dónde estamos y cuál es el frente activo.
3. Aplica el RITUAL DE 4 PASOS antes de construir: RECON (BBDD+repo) → BENCHMARK (mapa competitivo) → DISEÑO para golear (aprobado por mí) → MEDIR.
4. NO toques nada hasta que confirme.

FRENTE ACTIVO: 🔴 OBLIGATORIO D — REPARAR LA EDICIÓN DE PRECIOS DE PROVEEDOR en la ficha del ingrediente. SupplierItemsSection.tsx y PurchaseSourcesSection.tsx existen pero están muertas. Sin esto Pamela depende de SQL (no operativo). DECIDIR DE RAÍZ ANTES DE TOCAR: qué representa last_price canónicamente — PEDIDOS lo usa como €/CAJA (cantidad × last_price), Kitchen como €/BASE (last_price / qty_in_base); esa ambigüedad es la causa. Caso testigo: Delicias de Pollo Southern–COHELDI = 8,99 €/kg cargado donde el pedido lo cobra como €/caja (caja 2,2 kg → debería ser 19,78 €/caja).

FICHEROS QUE PEDIRÉ (en UN mensaje):
- src/modules/kitchen/components/SupplierItemsSection.tsx
- src/modules/kitchen/components/PurchaseSourcesSection.tsx
- src/modules/kitchen/services/purchaseFormatService.ts (updateArticleSupplier)
- src/modules/kitchen/services/costCascadeService.ts (si tocamos recálculo)

VÍA RÁPIDA EN CURSO (delivery): HubRise vía el CLIENTE 2 (sin Glovo) desbloquea el canal sin esperar a Otter — correo de reactivación a Janaina preparado; build = adaptador hubrise sobre ingesta canónica. Otter: esqueleto listo, bloqueado esperando Application ID + Client Secret. NO clonar el motor de ofertas (Pleez ya lo hace); solo el guardarraíl de margen.

SEGURIDAD PENDIENTE: rotar service_role key + LASTAPP_INTERNAL_KEY (e1f05c66) + token Last (247ef137); www.folvy.app NXDOMAIN.

REGLAS NO NEGOCIABLES (resumen):
- Archivos COMPLETOS, nunca diffs. Pide el original ANTES de modificar.
- Una instrucción operativa por turno, marcada 🖥️ (PowerShell) o 🗃️ (SQL Editor).
- Yo ejecuto, tú diseñas. Pide en UN mensaje todos los ficheros de un tramo.
- Marca SIEMPRE las operaciones (COMMIT/ROLLBACK, build, commit/push, verificar push con rev-list 0 0).
- RECON contra fuente primaria (BBDD+repo), no contra el CONTEXTO.
- SECURITY DEFINER: NO probar en SQL Editor (auth.uid() null); verificar desde la app. Al cambiar su firma, RECON pg_proc + DROP la vieja (sobrecarga duplicada).
- DEUDA 0: benchmark del mejor ANTES de diseñar; no vender empate como victoria.
- Folvy es para TODA la hostelería, no solo dark kitchens.
- Yo decido cuándo cerrar; no me sesgues a parar por duración.

Empieza por el paso 1 del arranque.
```
