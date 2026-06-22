# Bloques de cierre — 21/06/2026 (sesión Estación de Tablet + Impresión automática)

Pega cada bloque en su documento. Yo no edito tus documentos del repo directamente;
estos son los textos redactados para que los apliques.

================================================================================
## 1) folvy_guion_vivo.md
================================================================================

### 1a) Reemplaza la cabecera "Última actualización" (línea 3) por esto al inicio:

> **Última actualización**: 21 jun 2026 (CIERRE 2 — ESTACIÓN DE TABLET + IMPRESIÓN FÍSICA AUTOMÁTICA. Dos hitos en producción/vivo. (A) ESTACIÓN DE TABLET (`/estacion`): terminal de cocina a pantalla completa por TOKEN de dispositivo (mismo `kds_device` que el kiosco), con 3 pestañas SIEMPRE visibles —Pedidos · Cocina · Disponibilidad/86— que abre por defecto en Pedidos. Ruta pública montada en App.tsx ANTES de los gates de sesión (hermana de `/cocina-tv`). 3 capas: contenedor `TabletStationRoute.tsx` (calcado de `KdsKioskRoute`, la pestaña Cocina monta `KdsBoard` con token); Disponibilidad/86 por token (RPC `set_product_availability_by_token` + `availability_panel_by_token` que NO delega en la versión con guard de sesión sino que replica el SELECT validando solo token, + `search_products_by_token` + `preview_scope_by_token` + `device_location_by_token`; front `tabletAvailabilityService.ts` + `TabletAvailabilityTab.tsx`); Pedidos por token (`orders_feed_by_token` + `set_order_status_by_token`; `OrdersFeed.tsx` acepta token, vive del polling 10s). EXTRAS: QR+URL de la estación en `DevicesSettings.tsx` (lib `qrcode`); `manifest-estacion.json` propio (start_url=/estacion, tema oscuro) apuntado dinámicamente → "Añadir a inicio" crea un icono que abre la estación, no la raíz con login. Commits hasta `43695e6`, todos rev-list 0. LECCIONES: el navegador no abre sockets TCP; PWA start_url global=/login y el manifest dinámico lo resuelve; una RPC con guard `auth.uid()` no se delega desde otra RPC por token (hay que replicar el SELECT); logos con texto azul se funden en fondo oscuro → isotipo+texto blanco. (B) IMPRESIÓN FÍSICA AUTOMÁTICA FUNCIONANDO EN VIVO: cadena completa validada —pedido se ACEPTA → trigger encola → agente lee por token → ESC/POS → NT311 por LAN → papel— SIN nadie con Folvy abierto. Arquitectura AGNÓSTICA multi-transporte (`printer.transport`: sunmi_cloud, escpos_network [montado hoy], epson_epos, bluetooth, browser_pdf; `printer.config` jsonb lleva ip/port/sn; NO depende de Sunmi). Modelo en BD: tablas `printer` + `print_job` (payload inmutable) con RLS calcada de `kds_device`. Agente Node.js (en `C:\folvy-print-agent`, FUERA del repo): `escpos.js` (TicketDoc→bytes, corte GS V 1, ancho 48), `ticketRenderer.js` (PORT JS del `.ts` del front; el agente DIBUJA, no la BD = no se duplica lógica), `folvy-print-agent.js` (claim → si payload.mode=by_order pide el pedido y dibuja → TCP 9100 → report). RPCs (GRANT a anon): `claim_print_jobs` (FOR UPDATE SKIP LOCKED), `report_print_job`, `enqueue_print_job` (manager), `order_for_print` (un pedido por token, espejo de `orders_feed_by_token`). Trigger `tg_auto_print_on_accept` en `sale` AFTER UPDATE: al pasar a 'accepted' (no 'new': Glovo cancela antes) encola un job ligero por impresora×doc_type; solo dispara con cambio real de estado. Impresora registrada: `0a0ada19-...` "NT311 Plaza Castilla" {ip:192.168.1.86, port:9100}. CLAVE: el proyecto usa el formato NUEVO de claves Supabase (`sb_publishable_...`; la legacy `eyJ...` da 401). La NT311 imprime en LAN sin cloud (Ethernet, puerto 9100); doble-click en el botón de pairing imprime su IP. DEUDA CRÍTICA DE ESTE CIERRE: NADA del SQL de hoy (printer/print_job + RLS, las RPC del agente, order_for_print, el trigger, y las RPC by-token de la Estación) está versionado en `supabase/migrations/` — solo vive en BD; y el agente vive fuera del repo. La PRÓXIMA SESIÓN debe empezar versionando esto. — Lo anterior (CIERRE 1 · 21/06): CATÁLOGO LLORENTE29 COMPLETO desde Last [... mantener aquí el texto del cierre anterior tal cual estaba ...])

### 1b) En la sección "AHORA", añade como nuevo frente activo (arriba del todo de AHORA, tras los OBLIGATORIOS si los mantienes):

**0. 🟠 IMPRESIÓN — AFINAR LAYOUT 3 TICKETS + BOTÓN DE REIMPRESIÓN/MANUAL.** La impresión automática FUNCIONA en vivo (pedido aceptado → sale por la NT311 sin nadie con Folvy abierto). Falta PULIR EN VIVO con foto de tickets reales (NO a ciegas): (a) el ticket de BOLSA y el de COCINA salen muy pequeños/ilegibles —los tamaños ESC/POS son bajos y no aprovechan los 80mm—; (b) las PEGATINAS no muestran alérgenos; (c) construir BOTÓN DE REIMPRESIÓN/IMPRESIÓN MANUAL a voluntad (imprescindible: papel atascado, copia extra, reimprimir un pedido antiguo) — encola con `enqueue_print_job` o un job `by_order` con source='reprint'/'manual'. ANTES DE NADA en la próxima sesión: VERSIONAR en `supabase/migrations/` todo el SQL del 21/06 (printer/print_job+RLS, claim/report/enqueue_print_job, order_for_print, trigger tg_auto_print_on_accept, y las RPC by-token de la Estación) + meter el AGENTE en el repo + regenerar `database.ts` (printer/print_job nuevas). CAPA 2 (frente aparte, después): iconos gráficos (moto, alérgenos, logo) = bitmap ESC/POS desde PNG. Sunmi partner SOLICITADA (Llorente29 Food / Spain / Folvy), en revisión, para el transporte cloud futuro (la impresora tira sola, ideal multi-cliente; el `escpos_network` con agente es el camino de hoy).

### 1c) En la lista "HECHO", añade dos entradas:

- HECHO **ESTACIÓN DE TABLET (`/estacion`) — EN PRODUCCIÓN (21/06):** terminal de cocina a pantalla completa por token (mismo `kds_device` que el kiosco), 3 pestañas Pedidos·Cocina·Disponibilidad/86 (abre en Pedidos), montada en App.tsx antes de los gates, QR+URL de alta en Dispositivos, manifest propio (icono abre la estación, no el login). 3 capas (contenedor calca KdsKioskRoute; disponibilidad/86 por token replicando el SELECT sin guard; pedidos por token con polling 10s). Commits hasta `43695e6` (rev-list 0). DEUDA: las RPC by-token NO versionadas en migrations.
- HECHO **IMPRESIÓN FÍSICA AUTOMÁTICA — FUNCIONANDO EN VIVO (21/06):** modelo `printer`/`print_job` multi-transporte (agnóstico: sunmi_cloud/escpos_network/epson_epos/bluetooth/browser_pdf), adaptador ESC/POS, agente Node.js puente nube↔LAN, trigger `tg_auto_print_on_accept` (al aceptar el pedido sale el papel solo). Validado en vivo con la NT311 por LAN (192.168.1.86). DEUDA CRÍTICA: SQL y agente sin versionar (primero a hacer mañana). AHORA: afinar layout + botón de reimpresión.

================================================================================
## 2) CONTEXTO_CLAUDE.md (§1 ESTADO VIVO)
================================================================================

Añade en §1 (Módulos en producción) estas dos entradas, preservando head/tail
del fichero byte a byte (terminadores CRLF/LF como estén):

- **Estación de Tablet (`/estacion`) — en producción:** terminal de cocina por token (mismo `kds_device` que el kiosco) con pestañas Pedidos · Cocina (monta KdsBoard) · Disponibilidad/86, abre en Pedidos. Montada en App.tsx antes de los gates de sesión. RPC by-token: orders_feed_by_token, set_order_status_by_token, set_product_availability_by_token, availability_panel_by_token, search_products_by_token, preview_scope_by_token, device_location_by_token. Front: TabletStationRoute.tsx, TabletAvailabilityTab.tsx, tabletAvailabilityService.ts; OrdersFeed.tsx acepta token. QR de alta en DevicesSettings.tsx; manifest-estacion.json propio. Commits hasta 43695e6. DEUDA: RPC by-token sin versionar en migrations.

- **Impresión física automática — funcionando en vivo:** modelo `printer`(account_id, location_id, name, transport CHECK, doc_types text[], config jsonb) + `print_job`(sale_id, printer_id, doc_type, payload jsonb inmutable, status, source auto/manual/reprint, attempts, last_error), RLS calcada de kds_device. RPC: claim_print_jobs (FOR UPDATE SKIP LOCKED), report_print_job, enqueue_print_job (manager), order_for_print (un pedido por token). Trigger tg_auto_print_on_accept en sale (al pasar a 'accepted' encola job ligero por impresora×doc_type). Agente Node.js en C:\folvy-print-agent (escpos.js, ticketRenderer.js PORT del front, folvy-print-agent.js) — el agente dibuja y envía ESC/POS por TCP:9100. Transporte agnóstico (escpos_network montado; sunmi_cloud/epson_epos/bluetooth/browser_pdf previstos). Impresora NT311 Plaza Castilla (id 0a0ada19-..., 192.168.1.86). Clave API: formato nuevo sb_publishable_ (legacy eyJ da 401). DEUDA CRÍTICA: todo el SQL de impresión + el agente SIN versionar (vivo en BD / fuera del repo). PENDIENTE: afinar layout 3 tickets + botón reimpresión manual. Capa 2: iconos bitmap. Sunmi partner solicitada (revisión).

================================================================================
## 3) folvy_competitive_map.md (solo si tiene área de Impresión / Operación de cocina)
================================================================================

Si existe un área "Impresión de tickets / KDS / Operación de cocina", actualiza
su veredicto a algo como:

🟢 (con deuda de pulido) — Folvy imprime tickets físicos de forma AUTOMÁTICA al
aceptar el pedido, con arquitectura agnóstica multi-transporte (igual que Toast/
Square por dentro: agente o impresora cloud; el navegador no abre sockets, no es
una limitación de Folvy). Validado en vivo por LAN con Sunmi NT311. Pendiente de
pulido (layout legible de los 3 docs, iconos bitmap) y de versionado. Diferencia
frente a competidores: el ticket se DIBUJA reutilizando el mismo renderizador del
front (preview == papel), y la cola print_job es inmutable y auditable.
La Estación de Tablet unifica Pedidos+Cocina+86 en un terminal por token sin login
— equivalente operativo al "terminal de cocina" de los grandes, montado sobre el
mismo kds_device.

NOTA: si el mapa NO tiene aún un área de impresión/operación de cocina, créala con
ese veredicto.
