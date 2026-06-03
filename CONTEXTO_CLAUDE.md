# CONTEXTO_CLAUDE.md

> **Documento maestro único de memoria persistente del proyecto Folvy.**
> Lectura obligatoria al inicio de cada sesión técnica.
> **Última actualización: 02/06/2026.** Tras el 31/05 (R1 + frente Compras eslabón 1) se anexaron: **01/06** (jornada técnica intensa — portal del trabajador, R1 cerrado del todo, sistema de diseño Kitchen, **dashboard Kitchen construido sin commit**, y **Economía de Plataformas de Delivery descubierta y diseñada**) y **02/06** (marca/comunicaciones — web pública folvy.app, correo @folvy.app, contacto HubRise; corrección del nombre del CEO a Julio Gª Colón). Ver §1 (Estado Vivo) y las secciones "SESIÓN 01/06 (CIERRE 5)" y "SESIÓN 02/06" al final.
>
> Este es el ÚNICO documento de contexto. `CONTEXTO_ESTADO.md` y `CONTEXTO_REGLAS.md`
> quedaron retirados el 25/05/2026: estaban desincronizados. Toda su información
> viva se absorbió aquí. NO volver a subirlos al Project Knowledge.
---
0. CÓMO USAR ESTE DOCUMENTO
Lo único que cambia cada sesión es §1 (ESTADO VIVO). Va arriba a propósito: al
arrancar, leer §1 dice dónde estamos sin tropezar con datos antiguos. El resto (§2–§10)
es referencia estable que cambia poco.
Al cierre de cada sesión técnica: regenerar §1 y, si hubo cambios estructurales,
las secciones afectadas. Claude ofrece esta actualización al final (regla §6.1.10).
REGLA CERO (antes de responder cualquier pregunta técnica)
Leer este documento + los documentos maestros relevantes del Knowledge.
Si la respuesta requiere conocer el estado de la BBDD, ejecutar query a
`information_schema` ANTES de proponer. La BBDD es la verdad; este documento puede
estar desactualizado.
Si Julio (CEO) no se identifica explícitamente, asumir Julio.
Si entra un refuerzo técnico distinto, su primera línea debe ser declaración explícita
("Soy [Nombre], refuerzo técnico de Julio").
Verificación de identidad mid-sesión: si alguien cambia de rol durante la
conversación, hacer una pregunta de contexto vivido (no buscable en el Knowledge)
antes de aceptar el cambio.

Reglas operativas confirmadas en sesión (vigentes, ampliadas 31/05)
Una instrucción por turno. Si hay error al ejecutar algo, lo más probable es que Claude amontonara pasos en lugar de uno solo.
Marcar SIEMPRE el contexto operativo con prefijo explícito: 🖥️ PowerShell vs 🗃️ SQL Editor.
NO insistir en cerrar la sesión. Julio decide cuándo. Recomendar cierre solo si hay RIESGO TÉCNICO real (build roto, algo a medias peligroso), nunca por duración/fatiga.
Las preguntas con botones (`ask_user_input`) no le llegan bien a Julio. Preguntar siempre en prosa.
Indicar SIEMPRE de forma explícita cada acción operativa: cuándo COMMIT/ROLLBACK, build, git grep/commit/push, reiniciar dev server. Responsabilidad de Claude.
**Reparto Claude/Code (fijado 31/05):** lectura de un fichero CONCRETO que Claude ya identifica → lo sube Julio (rápido, barato). Búsqueda/descubrimiento (`git grep`, "¿existe X?") o ejecución en el repo → Claude Code.
**Regla migraciones (fijada 31/05):** al tocar esquema, `src/types/database.ts` regenerado va SIEMPRE en el MISMO commit que los tipos/services que lo usan (unidad atómica que compila en aislamiento). Y todo DDL aplicado en sesión debe quedar como migración en `supabase/migrations/` (formato `YYYYMMDD'T'HHmm_descripcion.sql`, transaccional, con cabecera `Aplicada:`) antes del push — si no, hay DRIFT entre BBDD y repo.
**Regla SQL SECURITY DEFINER (reconfirmada en vivo 31/05):** estas funciones revientan en SQL Editor (`auth.uid()` null). NUNCA probar dentro de la tx que las crea; verificar aparte; probar funcionalmente DESDE LA APP (con sesión) o desde script con `signInWithPassword`. Corolario demostrado: cualquier escritura que dispare un trigger que llame a una de estas funciones también revienta sin sesión de usuario (p.ej. DELETE en `article_supplier` desde SQL Editor) → para mantenimiento, `disable trigger` dentro de la tx.
CIERRE DE SESIÓN (sistema obligatorio): `.\scripts\cierre-sesion.ps1` hasta CIERRE OK. Pasos en docs/CIERRE_SESION.md.

PRINCIPIOS RECTORES DEL PRODUCTO (innegociables, fijados 31/05, por encima de Julio y de Claude)
1. **Deuda 0**: ninguna deuda en silencio. Toda deuda se declara por escrito con su disparador. Un empate NO se vende como victoria — aplica también a las afirmaciones de Claude sobre sí mismo.
2. **Benchmark top-del-mundo antes de diseñar cada pieza** y medición contra él al cerrarla. Solo vale golear; "ser los mejores" se mide sobre DATOS REALES, no de laboratorio. Una demo que solo empata con el incumbente (gstock/tspoon) puede ser NEGATIVA.
3. **Folvy guía/reeduca al operador** para hacer las cosas bien sin bloquearle (calibrado fino: oportuno, con beneficio visible, nunca plasta).
4. **Cada paso de UI es didáctico** con el cocinero/empleado/cliente: enseña mientras captura.
Cadencia: en cada paso, antes de cerrarlo, Claude para SOLO y aplica el control "¿somos los mejores aquí?"; si no lo es, busca cómo serlo o lo declara deuda explícita. Julio no tiene que pedirlo.
---
1. ESTADO VIVO ⟵ se regenera cada sesión

**Última actualización: 2026-06-03 (continuación 2). Hoy además: (e) FRENTE COSTE REAL / Artículos-Proveedores (§1.7) — RECON DE ÁREA reveló que TODO el cimiento ya estaba construido (modelo compras + 6 funciones + triggers + UI v1 + cascada a platos), no estaba verde sino VACÍO de datos; validado E2E en la app (Cebolla Morada → MAKRO Saco 5000g 8,50€ → 0,0017€/g → 36 platos recalculados solos); reconciliado coste de raw a UNA verdad (commit bc28560); nueva REGLA DE MÉTODO recon de área (memoria #18). Commits 27e093d (contexto monitor) y bc28560 (reconciliación). Build verde, 0 0.**

> **NOTA DE MANTENIMIENTO:** el fichero VERDADERO es `C:\dev\llorente29-app\CONTEXTO_CLAUDE.md` (git). Al regenerar, partir del repo.

### 1.0 — CORRECCIÓN DE DATO (vigente)
CEO: **Julio Gª Colón (García Colón)**, NO "Gascón". Admin Google: `jgcolon@idasal.com`. Correo partners/integraciones: `partners@folvy.app`.

### 1.0.bis — DECISIÓN ESTRATÉGICA MAYOR (02/06) — NO PERDER
**Folvy es INTEGRADOR DIRECTO de las plataformas de delivery (Glovo primero), sin intermediarios.** Razones de Julio: (1) coste (Last 525€/mes estrangula la propuesta Folvy+cliente); (2) concepto 360 (Folvy es el centro); (3) control del flujo de datos (materia prima de todo Folvy — quien controla el grifo controla Folvy); (4) fidelización estructural (si Folvy ES la integración, el cliente no se va sin romper su operación). Ningún intermediario (HubRise/KitchenHub/Otter/Deliverect) resuelve el punto 3. Confirmado VIABLE: Glovo y Uber tienen programa de partners con staging, sin cobrar por la API.

### 1.0.ter — CORRECCIÓN DE DATO MAYOR (03/06) — Llorente29 SÍ tiene reparto propio
**El CONTEXTO decía "Llorente29 = 0% reparto propio". ES FALSO.** Realidad confirmada por Julio (03/06): en Llorente29 **toda venta de Glovo y Just Eat es REPARTO PROPIO**, gestionado vía **Catcher o Jelp**. **Solo Uber lo reparte Uber** (y es variable según decida el propietario). Implicación: el coste real de reparto (Catcher/Jelp) entra YA, no es estructura futura; y la decisión propio-vs-plataforma (§1.5) es operativa hoy. **Jelp** es proveedor nuevo (no estaba en el CONTEXTO) — su API/webhook aún sin estudiar, como Catcher.

### 1.1 — Dónde estamos HOY (estado construido)

**MÓDULO DE INTEGRACIONES "Folvy Connect" — TERMINADO y en producción:**
- **I1 (modelo):** tablas `connector` + `account_connector` + RLS + tipos + `connectorService`. Catálogo sembrado: glovo (sort 5), lastapp (10), catcher (20).
- **I2 (pantallas):** módulo `src/modules/integrations/module.tsx` (id 'integrations', basePath 'integraciones', icono Cable, topBarOrder 5, gating manager) + línea en `moduleRegistry.ts` (SIN tocar App.tsx ni Shell — arquitectura modular: añadir módulo = añadir línea). Pantallas: `IntegrationsPage` (Tus integraciones), `IntegrationsMarketplacePage` (Marketplace, patrón lista+detalle), `ConnectorDetailPage` (configuración).
- **Logos de marca:** bucket Storage `connector-logos` (público) con glovo/ubereats/justeat/catcher/lastapp.png (256×256, fondo blanco). `connector.logo_url` poblado (glovo/lastapp/catcher). Componente `ConnectorAvatar` (logo + fallback a inicial sobre color de marca). Procesados por Claude desde los originales de Julio.
- **D2 (cifrado de credenciales con Vault) — COMPLETO y verificado end-to-end:**
  - `account_connector.config jsonb` (campos NO sensibles: store_ids, auto_accept, verify_signature).
  - Funciones wrapper `public.connector_secret_save/status/clear` + `connector_assert_manager` (SECURITY DEFINER, search_path public+vault, REVOKE a anon/authenticated, GRANT solo service_role). Migración `20260602T2200`.
  - Edge Function `connector-credentials` (desplegada): valida JWT del usuario (saca user_id real), llama a los wrappers con service_role. Doble gating. Secreto NUNCA vuelve al front ni se loguea. Cada Edge Function necesita su `deno.json` con import map (`jsr:@supabase/supabase-js@^2`).
  - `connectorCredentialsService.ts` (front, patrón functions.invoke tipado de accountsAdminService).
  - **Verificado en prod:** save (token de prueba cifrado en `vault.secrets` como `connector:<uuid>`, solo referencia en `credentials_ref`), status, clear (borra el secreto de Vault de verdad → 0 secretos). Conexión de prueba borrada, todo limpio.

**CONECTOR GLOVO — preparado, esperando acceso de Glovo:**
- Diseño completo (`docs/folvy_conector_glovo_diseno.md`) con 8 hallazgos de mercado y 5 decisiones cerradas (D1 modificadores tras G2; D2 cifrado Vault; D3 auto-aceptar por defecto configurable; D4 desglose a raw_products primero; D5 verificar firma Glovo-Signature desde G1).
- Sembrado en catálogo (`connector` glovo, config_schema: shared_token/store_ids/auto_accept/verify_signature).
- **ACCESO SOLICITADO:** email a `partner.integrationseu@glovoapp.com` enviado → Glovo creó **ticket INTSUPPO-1382** ("We're on it", en cola). Acceso vía Glovo Internal Service Desk (Jira). Plazo ref. 3-5 días lab.
- API oficial: `definition.yaml` (OpenAPI 3.0). Stage `stageapi.glovoapp.com`. Auth: shared token + firma Glovo-Signature opcional. Webhooks dispatched/cancelled + ciclo de vida (accept/ready/out_for_delivery/picked_up) + push de menú + LAAS. Endpoint sólido decidido: `api.folvy.app/glovo/orders/*` (dominio propio, no Supabase directo — montar en G1).
- Dato superior a Last para EP1: order_type nativo, detailed_fees, glovo_discounts vs restaurant_discounts separados.

### 1.2 — INTEGRADORES (evaluación cerrada)
- **Last.app:** 525€/mes, tiene Glovo+Uber+JustEat-España hoy. A sustituir por integración directa.
- **HubRise:** middleware white-label barato, pero Glovo-España incierto + sigue siendo intermediario. Rebajado a segunda fila (puente o clientes sin Glovo). Respuesta de Janaina ya recibida y registrada.
- **KitchenHub** (USA, sin plataformas europeas), **Otter** (compite), **Deliverect** (compite + caro): descartados.

### 1.3 — DEUDA VIVA / FRENTES (por prioridad)
1. **CONECTOR GLOVO G1** (recepción real): BLOQUEADO esperando acceso al stage (ticket INTSUPPO-1382). Al llegar: Edge Function `glovo-webhook` → `sale` (service_type/fees/descuentos) → dedup por order_id → multi-tenant por store_id. + montar dominio `api.folvy.app/glovo/*`. + leer el secreto de Vault (vía D2) para verificar el token.
2. **RPC `menu_item_economics`** — HECHA el 03/06 (commit 4ab3788). Lee la comisión SOLO de `brand_channel_rate` por `service_type` (param `p_service_type` DEFAULT 'platform_delivery'), respeta `commission_base` (pvp_con_iva|pvp_sin_iva), NULL honesto sin tarifa. Eliminadas las 3 columnas residuales (brand.commission_pct, brand_channel.commission_pct/fixed, sales_channel.default_commission_pct) + sus mapeos front. Pendiente de feature (NO deuda): pantalla **Canales** (escritor de brand_channel_rate; el service brandChannelRateService.ts ya existe, falta UI). Hasta que exista, la economía muestra comisión/margen NULL (correcto).
3. **G2 push catálogo Glovo** (tras G1): mapear menu_item→árbol Glovo. H1 (tras upload, re-enviar disponibilidad) + H2 (IDs exactos en external_codes). Dependencia: modelo de MODIFICADORES (no existe aún).
4. **Catcher I3**: Edge Function `catcher-webhook`, captura transportPrice, cruce externalId. Espera credenciales. Sandbox `staging-api.catcher.es`.
5. **Bandeja de solicitudes superadmin** (conectores request/managed_by superadmin).
6. **Pantalla "Canales"** (comisiones brand_channel_rate por marca×canal×reparto).
7. **APUNTE menor (pulir en G1):** el desplegable `auto_accept` de ConnectorDetailPage muestra "Sí" por defecto pero guardó `false` en la prueba → alinear el valor visible inicial con el que se persiste.
8. Seguridad: rotación service_role/webhook tokens. Code-splitting (~677KB gzip). 34 platos needs_review.

### 1.3.HALLAZGOS técnicos (vigentes)
- **Añadir módulo al Shell = añadir línea en `moduleRegistry.ts`** + crear su `module.tsx`. CERO cambios en App.tsx/Shell.tsx (arquitectura modular G-8).
- **Edge Functions:** cada una necesita su `deno.json` con `{"imports":{"@supabase/supabase-js":"jsr:@supabase/supabase-js@^2"}}`. Deploy: `npx supabase functions deploy <nombre>` (CLI enlazado).
- **⚠️ REGLA CRÍTICA WEBHOOKS (03/06): los Edge Functions que reciben webhooks externos (lastapp-webhook, futuros glovo/catcher) SE DESPLIEGAN SIEMPRE con `--no-verify-jwt`.** Sin la flag, el deploy reactiva `verify_jwt` del gateway de Supabase → rechaza con `401 UNAUTHORIZED_INVALID_JWT_FORMAT` ANTES de ejecutar el código → corta TODA entrega del proveedor y EN SILENCIO (ni siquiera escribe en `lastapp_webhook_log`, porque el gateway corta antes que el código). La seguridad real la hace el token dentro del código (`LASTAPP_WEBHOOK_TOKEN`). Un deploy sin la flag tumbó el webhook el 03/06 y se perdieron pedidos del 01–03/06.
- **⚠️ TRAMPA SQL EDITOR (BEGIN/COMMIT) (03/06): un bloque `BEGIN; … COMMIT;` pegado entero en el SQL Editor de Supabase puede DESCARTAR la transacción y NO aplicar los cambios, mostrando un "Success" ENGAÑOSO** (las tablas de monitorización no se crearon la 1ª vez por esto). Para puro DDL ejecutar SIN envoltorio (el editor ya es atómico por sentencia) y SIEMPRE VERIFICAR con information_schema justo después, sin fiarse del "Success". Coincide con §6.1.
- **`npx supabase gen types ... > database.ts`** en PowerShell genera UTF-16 → git lo ve binario y rompe build. Reconvertir a UTF-8 sin BOM: `[System.IO.File]::WriteAllText(path, (Get-Content -Raw path), (New-Object System.Text.UTF8Encoding $false))`. Y siempre `--yes`.
- **Supabase Vault** (v0.3.1, activo): `vault.create_secret(secret,name,desc)` / `vault.update_secret(id,...)` / `vault.decrypted_secrets` (vista). NUNCA INSERT crudo en vault.secrets (se loguea). Acceso solo server-side (service_role) vía wrappers en `public`.
- **Roles:** `user_profiles` (user_id, account_id, role, active). admin/manager = gestión. Gating de credenciales valida rol en el wrapper con p_user_id (no auth.uid(), porque la Edge Function corre con service_role).
- **P1 (base comisión) = PVP CON IVA.** La RPC `menu_item_economics` HOY usa `price` (sin IVA) → corregir.

### 1.4 — Próximos pasos priorizados
1. **MONITORIZACIÓN de ingesta — capas 2+3 HECHAS (03/06, commit c5dc9ad).** Ver §1.6. Capa 1 (frescura por horario) = DEUDA OBLIGATORIA enganchada al módulo de Horarios.
2. **Verificación en vivo** del primer pedido real post-fix (que entre con service_type/tax poblados).
3. **Reproceso** de pedidos 28/05–03/06 desde `lastapp_webhook_log` con el function nuevo (los viejos tienen service_type/tax null; los del 01–03/06 puede que no llegaran — ver si Last reintenta/reenvía).
4. **Módulo de HORARIOS del cliente** (NUEVO frente, prerrequisito de Capa 1 y de la decisión propio-vs-plataforma): variables por estudiar — por marca / por local, DÓNDE vive (¿brand o location? probablemente el horario base es del local y la marca acota dentro), festivos, excepciones, edición por el cliente. Al construirlo, CERRAR Capa 1 "sin excusas".
5. **FRENTE COSTE REAL / Artículos-Proveedores (§1.7) — ABIERTO, cimiento validado.** Lo que queda: cargar datos (162 raws con proveedor+formato+precio; hoy solo 1), clasificar raws en familias (55 familias existen, 0 raws clasificados → con IA), IA factura→coste, catálogo estándar (plantillas ya sembradas), + mejoras UI (ver qué platos al cambiar coste; bug coste '–/g' cuando estrategia=fixed).
6. **Motor de margen real** (§1.5): tramo grande. Requiere dato fiable (en marcha §1.7) + integración Catcher/Jelp + pantalla Canales.
7. **Glovo G1** al recibir acceso (ticket INTSUPPO-1382). Pantalla Canales. Bandeja superadmin. Apunte auto_accept.
8. **Producción Llorente29 objetivo: 7 sept 2026.**

### 1.5 — MOTOR DE MARGEN REAL (concepto afilado con Julio 03/06) — NO PERDER
Tesis: el diferenciador de Folvy NO es la matriz de ingeniería de menús (eso lo copian todos: meez/Apicbase/R365 plotean Estrellas/Caballos/Puzzles/Perros sobre popularidad×rentabilidad). El diferenciador es el DATO que nadie tiene y QUÉ se hace con él. Folvy tiene la línea de ticket real, por canal, con promo y modificador, en vivo, y ES la tubería (integrador directo).
De ahí, lo que golea:
1. **Margen REALIZADO, no teórico.** Precio − coste receta − comisión real − transporte real − promo atribuida, a nivel de línea de ticket. Un plato "Estrella" de carta puede estar sangrando si el 70% se vendió con 2x1. Nadie lo ve porque nadie tiene la línea con la promo atribuida.
2. **Decisión propio-vs-plataforma (clave, Julio).** Glovo cobra 30% si reparte Glovo, 15% si repartes tú. Si repartes tú: ahorras 15%·PVP de comisión Y te quedas el cargo de envío al cliente (3–4,5€, que con reparto de plataforma es de Glovo y desaparece de tu lado). **Límite de coste de reparto propio = 15%·PVP + cargo de envío al cliente.** Por debajo, conviene repartir tú; por encima, mejor que reparta la plataforma. Varía POR PEDIDO (PVP y coste Catcher/Jelp variables). KPI estrella: "X pedidos repartidos por ti superaron el límite → te costó N€ repartir cuando debías dejar a la plataforma". Imposible sin dato a nivel pedido + integración Catcher/Jelp.
3. **Reparto del transporte entre platos:** el coste de transporte es POR PEDIDO; se guarda crudo a nivel `sale` (intocable, trazable). El reparto por plato (prorrateo por PVP facturado — Opción B) es una VISTA de análisis, no un dato escrito. Dos lentes: margen por PEDIDO (verdad pura) y por PLATO (prorrateado). Spread estimado-vs-real de transporte = alerta de oro.
4. **Config por HERENCIA (clave, Julio — "si no, muere la primera semana"):** con 17 marcas × canales × cientos de artículos, configurar plato a plato es inviable. Comisión a nivel canal, objetivo food cost a nivel categoría, solo excepciones a nivel plato. 1000 artículos = 5 reglas. Cambias comisión de Glovo → tocas UNA regla → recalcula todo; con vigencia temporal el histórico queda intacto.
5. **Vigencia temporal de tarifas** (recomendado deuda 0): sin "válida-desde/hasta", cambiar una comisión corrompe el cálculo histórico. `brand_channel_rate` hoy NO la tiene → decisión de modelo antes de construir.
6. **Fees extensibles:** modelo de conceptos, no columnas fijas (Glovo puede añadir tasas nuevas).
7. **Trazabilidad abrible:** cada cifra de margen se abre agregado→plato→pedido→cargo real de Catcher. La IA LEE ese desglose y lo explica en lenguaje de cocinero (anti-invención: no fabrica el número, traduce el que la BBDD calculó).
Las tres patas del dato: coste receta + comisión real (config) + transporte real (Catcher/Jelp, integración pendiente). El cargo de envío al cliente es INGRESO y solo existe en reparto propio.

### 1.6 — INCIDENTE 03/06 (caída silenciosa) + VIGILANTE DE INGESTA (capas 2+3 CONSTRUIDAS)
Qué pasó: el webhook de Last.app dejó de entregar ventas (cero desde el 01/06). Causa: el deploy reactivó `verify_jwt` del gateway → 401 antes del código → corte total y SIN log. Resuelto con redeploy `--no-verify-jwt`. Ver regla en §1.3.HALLAZGOS.
**Respuesta (Julio): "una inconsistencia tan grave no disparó ninguna alarma; en producción es una ruina".** Benchmark (dead-man's-switch / heartbeat; pg_cron+pg_net nativos de Supabase Pro): vigilar la AUSENCIA exige un actor activo y defensa POR CAPAS. Diseño aprobado y CONSTRUIDO 03/06 (commit c5dc9ad):
- **Capa 2 — ping sintético (HECHA):** Edge Function `ingestion-synthetic-ping` (deploy --no-verify-jwt). pg_cron job `ingestion-synthetic-ping` (jobid 5, `*/10 * * * *`) hace POST con token al `lastapp-webhook` y comprueba 200+ok:true. Si falla y fuera de cooldown (180 min) → email. Es la capa que caza el fallo de hoy aunque no fluya ni un pedido. Validada E2E (ping real ok; `?simulate=fail` dispara email; cooldown ok).
- **Capa 3 — watchdog externo (HECHA):** la function hace check-in a Healthchecks.io (`HEALTHCHECKS_PING_URL` en secrets; check Period 10m/Grace 5m, email a jgcolon@idasal.com) en cada ejecución. Si cron/Supabase mueren, Healthchecks avisa = guardián del guardián.
- **Canal de alarma (HECHO):** Edge Function `system-alert` (deploy --no-verify-jwt, gating `CRON_SECRET`) manda email vía Resend (de no-reply@folvy.app a SYSTEM_ALERT_TO=jgcolon@idasal.com), SEPARADO del correo de clientes. Reutilizable por Capa 1.
- **Modelo:** tablas `ingestion_monitor_config` (por cuenta: enabled, timezone, service_windows jsonb, freshness_threshold_minutes, alert_cooldown_minutes) + `ingestion_monitor_state` (salud + antifuego). RLS: lectura admin/manager, escritura solo platform admin. Seed Llorente29 (`51ad1792-...`) enabled=true, service_windows VACÍO. Migración `20260603T1600_ingestion_monitor.sql`.
- **Secrets nuevos:** `CRON_SECRET`, `SYSTEM_ALERT_TO`, `HEALTHCHECKS_PING_URL` (CRON_SECRET inline en el cron job a propósito: baja sensibilidad, evita lectura de Vault que podría enmudecer el vigilante en silencio).
- **DEUDA OBLIGATORIA — Capa 1 (frescura por horario):** PENDIENTE, cerrar "sin excusas" al construir el módulo de Horarios (§1.4 punto 4). Derivar ventanas del histórico de ventas es un PROXY que da falsas alarmas cuando el cliente cierra/libra/cambia temporada; fuente honesta = horario declarado. Por eso `service_windows` va vacío y Capa 1 no se construyó con el proxy. Multi-cliente: cada cuenta su horario (refuerza usar el módulo, no el proxy).
**Datos diagnóstico (vigentes):** histórico hasta 27/05 = backfill de Excel (ruido en importes: descuento/total dudosos → FUERA del motor de margen; quizá válido solo para popularidad, a decidir). Webhook real desde 28/05 (created_at≈sold_at). El `raw_products` guarda SOLO el array de productos; el desglose económico (tax/taxableBase/deliveryFee/discountTotal/pickupType) llega en el payload del webhook y desde el 03/06 se captura entero. courier.name NO lo rellena Last (da igual: pickupType ya separa delivery vs ownDelivery).

### 1.7 — FRENTE COSTE REAL / Artículos-Proveedores (03/06) — CIMIENTO YA CONSTRUIDO, FALTAN DATOS
Objetivo del frente: que el coste de cada escandallo salga de PRECIO REAL de proveedor, no de `fixed_cost` andamiaje (pata 1 del motor de margen §1.5). El RECON DE ÁREA (memoria #18) reveló que el CONTEXTO iba MUY por detrás: casi todo el cimiento YA ESTABA, solo vacío de datos y sin clasificar. Lo verificado contra fuente primaria:

**Modelo de datos (existe, completo y bien diseñado):**
- `supplier` (name, tax_id, email, phone, address, notes, health_registry_no, is_active…).
- `article_supplier` (recipe_item_id, supplier_id, supplier_code, last_price, is_preferred, purchase_format_id) = precio por proveedor en un formato.
- `recipe_item_purchase_format` (name, parent_format_id, qty_per_parent, qty_in_base, is_piece, is_weighted, source, ai_confidence, needs_review…) = formatos ANIDADOS caja→bolsa→unidad; `qty_in_base` = puente al escandallo.
- `purchase` + `purchase_line` (cabecera/líneas de compra; hoy vacías = aún no hay recepción real, por eso average_weighted cae a last_price).
- `dish_family` (name, color, icon, position, template_id) + `recipe_item.family_id` + `recipe_item.category`; `tag`+`recipe_item_tag`; y PLANTILLAS `dish_family_template`/`tag_template` (= base del catálogo estándar de cliente nuevo).

**Funciones del área (existían, NO estaban en CONTEXTO):** `kitchen_recompute_raw_cost` (costea raw desde proveedor+formato: last_price/qty_in_base, estrategias fixed/last_purchase/average_*; fallback honesto conserva coste + needs_review), `kitchen_recipe_breakdown`, `kitchen_recipe_cost_by_location` (¡coste por LOCAL!), `location_economics`, `materialize_recipe_session`, `kitchen_dish_state_for_ai`, `kitchen_similar_dishes_for_ai`, `run_mapping` (x2 — el CONTEXTO la daba "pendiente, la más diferenciadora": YA EXISTE). Triggers sanos: `trg_article_supplier_recompute_cost` (recostea raw al tocar proveedor), `recipe_line_prevent_cycle`, `set_folvy_code`, varios `set_updated_at`.

**UI v1 (existe, reciente 31/05–01/06):** `pages/SuppliersPage.tsx`, `pages/KitchenItemsPage.tsx`, `pages/KitchenItemDetailPage.tsx`, `components/PurchaseSourcesSection.tsx`, `components/SupplierItemsSection.tsx`, `services/purchaseFormatService.ts` (482 líneas, maduro), `services/costCascadeService.ts` (la propagación a platos que el CONTEXTO daba pendiente: HECHA). Lenguaje de cocinero ("¿Cómo viene?/¿Cuánto trae?/¿Cuánto te cuesta?"), cálculo en vivo (latido).

**RECONCILIACIÓN deuda 0 (commit bc28560):** se había duplicado la rama `last_purchase` en `kitchen_recompute_item` → dos verdades del coste. Corregido: `kitchen_recompute_item`, para raw/tool, DELEGA en `kitchen_recompute_raw_cost`. Una sola verdad. Lógica de recetas/dishes intacta. CHECK `recipe_item_cost_strategy_valid` = {fixed, last_purchase, average_weighted, average_window} (NO inventar 'purchase').

**VALIDACIÓN E2E en la app (no en SQL Editor — el trigger usa guard de tenancy y auth.uid() es null allí):** Cebolla Morada (`33d794b6-...`, base g, antes fixed 0,00173€/g) → añadido MAKRO DISTRIBUCION MAYORISTA SA, formato "Saco" 5000 g, 8,50€ → coste pasó a **0,0017 €/g**, "Origen del coste: Desde la compra", y **"36 platos recalculados"** (cascada viva). Es el PRIMER dato real del frente (se deja, no se revierte).

**Estado de datos (lo que de verdad falta):** 162 raws (147 con fixed_cost), 1 ya con compra real (Cebolla Morada en last_purchase), resto en fixed. supplier: MAKRO + 1 prueba. 55 familias sembradas, 0 raws clasificados. purchase/purchase_line vacías.

**Plan del frente (recolocado sobre la verdad):** (1) cargar los 162 con proveedor+formato+precio — a mano es inviable → IA factura/albarán→coste (modelo trae source/ai_confidence/needs_review; benchmark: MarketMan/xtraCHEF hacen foto→OCR→casa→actualiza coste, pero SIN capa de revisión humana = nuestro hueco a ganar; ellos cobran escaneos caros, visión Anthropic = céntimos). (2) clasificar raws en familias con IA (revisable). (3) buscador por texto (útil ya) + filtro por familia (tras clasificar). (4) catálogo de ingredientes estándar español como semilla de cliente nuevo (las *_template ya existen) — diferenciador SMB que nadie ofrece. Mejoras UI pendientes: mostrar QUÉ platos se recalcularon al cambiar un coste (petición Julio); arreglar ficha que muestra "–/g" cuando computed_cost null pese a tener fixed_cost.

### 1.11 — NOTA HISTÓRICA
> **02/06 (técnica AM):** EP1 + módulo Integraciones I1 + Catcher API. **02/06 (tarde):** evaluación integradores, DECISIÓN integrador directo, API Glovo (definition.yaml), correo Glovo enviado. **02/06 (noche/cierre):** módulo Folvy Connect I2 (pantallas) + logos de marca + seed Glovo + D2 completo (Vault + Edge Function connector-credentials + pantalla configuración, verificado end-to-end) + Glovo respondió (ticket INTSUPPO-1382 en cola).

---
2. PROYECTO Y EQUIPO
Empresa: Foodint (rebrand en curso a Folvy SL).
CEO: Julio Gª Colón (García Colón) (`jgcolon@idasal.com`). [Corregido 02/06: era "Julio Gascón Colón", error arrastrado.]
Refuerzo técnico: José (junior, autoridad delegada total cuando opera identificado).
Producto: Folvy V1 — SaaS multi-tenant modular para hostelería.
Cliente activo: Llorente29 (3 locales: Alcalá, Pza Castilla, Carabanchel + Pamela como
empleada). Firmado, sin uso real todavía (0 fichajes en BBDD). Romper Llorente29 =
pérdida de ingreso.
Cartera comercial: pendiente de actualizar (hubo discrepancia "Solo Llorente29" vs
"+1 esperando + cartera"). Revisar con Julio.
Fecha producción objetivo Llorente29: domingo 7 septiembre 2026.
Organización de trabajo (equipo de tres)
Claude del chat = COORDINADOR. Supervisa estrategia, revisa SQL y código ANTES de
ejecutar, decide el plan, detecta riesgos. NO ejecuta: da a Julio las instrucciones
exactas para Claude Code o para él. Marca SIEMPRE cada acción operativa de forma
explícita (cuándo COMMIT/ROLLBACK, `npm run build`, `git commit`/`push`, deploy,
restart del dev server, `git grep`). No asume que Julio ya las hizo.
Julio = PUENTE Y DECISOR. Ejecuta en Claude Code lo que el coordinador indica y trae
la salida. SQL en Supabase, deploy con CLI y manejo de credenciales/JWT reales los hace
él. Aprueba cada paso. Decide cuándo cerrar.
Claude Code = EJECUTOR EN EL REPO. Acceso directo a `C:\dev\llorente29-app`. Lee,
escribe y edita ficheros. NO se le pasan a mano ficheros que ya están en el repo —
los lee del disco.
---
3. STACK E INFRAESTRUCTURA
Frontend
React 19 + Vite 8 + TypeScript 6 strict + Tailwind 3.
`react-router-dom@7.15.1` (D-S2.6), usando API v6 (`<Routes>`/`<Route>`).
`@supabase/supabase-js`, `lucide-react`.
`react-markdown ^10.1.0` (añadida 27/05 para Folvy AI; 50KB justificado).
Build/deploy: push a `main` → Vercel automático.
Backend (Supabase)
Plan Pro, proyecto `xzmpnchlguibclvxyynt`, región `eu-west-1` (Ireland).
(La región NO se puede cambiar; verificada en dashboard el 25/05. El `eu-west-3` que
aparecía en una nota de la Fase B.4 era un typo, ya corregido.)
PostgreSQL 15+ con RLS. Auth Hook activo: `custom_access_token_hook` (Postgres Function).
PITR NO activado (add-on ~+100$/mes). Solo scheduled backups diarios (retención ~7d).
Riesgo aceptado por Julio (D5). Revisar antes de Sprint 14 / producción Llorente29.
Edge Function `folvy-ai` desplegada (v2 streaming SSE). Secret `ANTHROPIC_API_KEY` en dashboard.
Email transaccional (Resend)
Proveedor Resend. Dominio `folvy.app` Verified (DKIM+SPF+DMARC+MX en OVH).
Remitente `no-reply@folvy.app`. `reply_to: jgcolon@idasal.com`.
API key como secret de Supabase (`RESEND_API_KEY`), NUNCA en repo. Se lee en runtime
(cambiar el secret NO requiere re-deploy).
🟡 Pendiente CEO: 2FA en Resend; confirmar key nueva guardada en Bitwarden.
Dominios / Hosting (Vercel)
`folvy.app` apex → proyecto `folvy-landing`.
`app.folvy.app` → proyecto `folvy-app-staging` (la app real). SSL Let's Encrypt auto.
`folvy.es` registrado, sin configurar.
2FA GitHub activo (backup codes guardados por Julio).
⚠️ Documentos viejos mencionan `folvy.com` — ya no aplica.
Variables de entorno
```
VITE_SUPABASE_URL=https://xzmpnchlguibclvxyynt.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...  (real, NO redactar en código)
VITE_APP_URL=http://localhost:5173    (local)
VITE_APP_URL=https://app.folvy.app    (Vercel)
ANTHROPIC_API_KEY=...  (secret de Supabase, NO en .env del front)
FOLVY_AI_MODEL=claude-sonnet-4-6  (env opcional Edge Function; default si no se pasa)
```
Tooling local
Supabase CLI v2.100.1 (login vía Access Token; bug del navegador, mayo 2026).
Node.js v18+. Git Windows con `core.autocrlf` activo. PowerShell 5.1.
---
4. ESTADO DE LA BBDD
4.1 — Conteo de tablas (VERIFICADO 27/05/2026, vía information_schema)
100 tablas totales en schema `public` (BASE TABLE).
Subió de 93 (al 26/05) a 98 al añadir las 5 tablas de Capa 2 + ventas (`menu_item`,
`brand_channel`, `brand_licensing_agreement`, `sale`, `sale_line`).
Subió de 98 a 100 al añadir las 2 tablas de la plataforma Folvy AI (`ai_memory`, `ai_interaction`).
Incluye aún ~10 backups (`_backup_20260516_*` / `_backup_20260517_*`) del Bloque S,
pendientes de limpiar (confirmar con Julio).
RLS activo en todas las tablas operativas.
> Histórico: 40 (inicial) → 87 (77+10, 25/05) → 93 (83+10, 26/05, +6 Kitchen) →
> 98 (27/05 mediodía, +5 Capa 2/ventas) → **100 (27/05 madrugada, +2 Folvy AI)**.
> **Citar 100** salvo verificación posterior.
4.2 — Tablas auth creadas en Sprint 1 (18-19/05)
`platform_admins` (1 fila: Julio CEO), `platform_admin_permissions` (1), `platform_admin_2fa`
(0), `auth_rate_limits` (0), `impersonation_sessions` (0), `platform_audit_log` (1),
`platform_settings` (1), `permission_sets` (4 sets system globales, `account_id=NULL`),
`permission_set_assignments` (0).
4.3 — Columnas y constraints añadidos (Sprint 1)
[Sin cambios desde la última versión. Ver historial Git si se necesita.]
4.7 — Auth/Edge Functions / Gateway
[Sin cambios desde la última versión. Ver §5.3 para los patrones de auth.]
4.8 — RPCs y datos
RPCs `create_account_tx`, `delete_account_tx` (SECURITY DEFINER). OJO con
`delete_account_tx(p_account_id, p_admin_user_id)`: el 2º arg es el user_id del admin
DE LA CUENTA a borrar (hace `DELETE FROM auth.users WHERE id = p_admin_user_id`). Pasar
el del CEO lo bloquea `protect_last_admin`.
Cuentas hoy: Llorente29 + "Folvy Interno". RLS puede dar falsos "0 filas" en el SQL
Editor para borrados → verificar con SELECT aparte.
4.9 — Función de coste de Folvy Kitchen (26/05, 2ª sesión)
`kitchen_recompute_item(p_item_id uuid) → numeric`. SECURITY DEFINER, `search_path=public`.
Calcula y GUARDA el coste de UN item (raw/recipe/dish), devolviéndolo. Lógica:
Si `type IN ('raw','tool')`: coste desde su estrategia (hoy solo `fixed` calculable → `fixed_cost`).
Si `type IN ('recipe','dish')`: suma de líneas (`recipe_line`). Por línea: coste del hijo
(lee `computed_cost` cache, NO recursa hacia abajo) × cantidad convertida × (bruto si existe).
Conversión: misma dimensión → `kitchen_unit.factor_to_base` (universal); distinta dimensión
→ busca `recipe_item_unit_conversion` (por-ingrediente); sin vía → NO inventa, marca
`needs_review=true` y esa línea aporta 0 (diseño honesto).
GUARD de tenancy (imprescindible porque SECURITY DEFINER salta RLS):
`IF NOT (current_user_is_admin() OR current_user_is_admin_or_manager_of(v_item.account_id)) THEN RAISE EXCEPTION`. Acepta admin de plataforma (CEO) o admin/manager de la cuenta.
Versionada en `supabase/migrations/20260526_folvy_kitchen_capa1_3.sql`. Tipada en
`database.ts` como `kitchen_recompute_item: { Args: { p_item_id: string }; Returns: number }`.
PROBADA en producción (Folvy Interno) con 3 casos: harina 500g a 2€/kg → 1.00€; solomillo
300g brutos a 20€/kg → 6.00€ (merma usa bruto); huevo 2ud sin conversión → 0 + needs_review.
NOTA de diseño futura (NO bug): el guard bloquea llamadas SIN sesión (auth.uid() null —
cron/OCR/IA/propagación). Correcto para el frontend hoy. El acceso de procesos de sistema
se resolverá al construir la propagación `kitchen_recompute_dependents` (ver §7.9). Opciones
apuntadas: (A) Edge Function con service_role JWT —verificar cómo lo trata
current_user_is_admin()—; (B) tercer canal en el guard —más complejo, riesgo de bypass—.
4.10 — Función de desglose de coste por línea (26/05, 2ª sesión)
`kitchen_recipe_breakdown(p_item_id uuid) → TABLE(line_id, child_item_id, child_name, quantity, unit_abbr, line_cost, needs_review)`. SECURITY DEFINER, `search_path=public`,
MISMO guard de tenancy que kitchen_recompute_item. Solo lectura (no muta nada).
Devuelve una fila por línea del plato con el coste de esa línea, calculado con LA MISMA
lógica de conversión que kitchen_recompute_item (copiada, NO reinventada). INVARIANTE clave:
`SUM(line_cost) == recipe_item.computed_cost`. Test de regresión: si alguien toca una función
sin la otra, el invariante se rompe → `SELECT SUM(line_cost) FROM kitchen_recipe_breakdown(id)`
debe igualar `SELECT computed_cost FROM recipe_item WHERE id=...`.
needs_review por línea = true si esa línea no se pudo convertir (coste 0). La pantalla la
marca en rojo con "sin coste" (patrón meez).
El % de cada línea lo calcula la PANTALLA (line_cost / suma), división simple sin
conversiones → no compromete la honestidad (a diferencia de calcular el coste en cliente).
Versionada en `supabase/migrations/20260526_folvy_kitchen_capa1_4.sql`. Tipada en database.ts
(Args { p_item_id: string }; Returns array de 7 campos). Consumida por recipeLineService.getRecipeBreakdown.
VERIFICADA en producción: hamburguesa → carne 0,9265€ (60,7%) + pan 0,42€ (27,5%) + queso
0,18€ (11,8%) = 1,5265€ = computed_cost del plato. Cuadra al céntimo, en SQL y en pantalla.
NOTA: el guard también bloquea el SQL Editor (auth.uid() null), igual que kitchen_recompute_item.
Para verificar el cuadre desde el editor sin sesión se usó una query SELECT equivalente (sin
guard) que replica la lógica — confirmó el cuadre. La función real funciona desde la app (con sesión).
4.11 — Tablas de la plataforma Folvy AI (27/05, sesión madrugada)
Migration: `supabase/migrations/20260527T2000_folvy_ai_platform.sql`.
`ai_memory` — key-value por cuenta con scope.
Columnas: `id`, `account_id` (FK accounts ON DELETE CASCADE), `scope` (CHECK in 'vocabulary','preference','fact','snapshot'), `key`, `value` (text), `created_at`, `updated_at`.
UNIQUE(account_id, scope, key) — una entrada por (cuenta, scope, clave).
RLS: read = `account_id = ANY(current_user_account_ids())` (cualquier miembro lee), write = `current_user_is_admin_of(account_id)` (solo admin del account).
Hoy SIN uso (estructura puesta para v1.1, cuando Folvy AI empiece a recordar vocabulario y preferencias del usuario).
`ai_interaction` — log de cada turno con la IA.
Columnas: `id`, `account_id` (FK accounts), `user_id` (FK auth.users), `session_id` (text para agrupar turnos de una conversación), `surface` ('chat'|'aicard'|'background'|'opening'), `module` (text nullable), `message` (text, mensaje del usuario), `response` (text, respuesta del assistant), `tokens_in`, `tokens_out`, `duration_ms`, `tools_used` (text[]), `status` ('ok'|'error'|'partial'), `error_message` (text nullable), `created_at`.
RLS: read = miembros del account; write = service-role (la Edge Function escribe vía service-role para tener visibilidad incluso si el JWT del usuario cambia entre tools).
Base para métricas de coste por cuenta (§9.3 deuda 3: dashboard de uso + alertas).
4.12 — Unidades base kitchen_unit (IDs reales, semilla GLOBAL account_id=null, verificados vs BBDD 30/05)
Semilla global (account_id null) → listUnits({}) las trae para cualquier cuenta. Modelo: la base de cada dimensión se marca con is_base=true (NO existe columna base_unit_id; el baseUnitId del tipo cliente se deriva en el servicio). factor_to_base convierte a la unidad base de su dimensión.
- Gramo `8fc3baae-04cc-4b2c-83cc-7fa0181e74e4` (`g`, weight, factor 1, **base**)
- Kilogramo `2fb97155-28e7-4f1f-9776-101366467bc1` (`kg`, weight, factor 1000 → g)
- Mililitro `953c626f-146b-484f-b3f5-47c42eeacc0e` (`ml`, volume, factor 1, **base**)
- Litro `c4826b0d-73f1-4bd2-9f7f-fcf833f1b310` (`L`, volume, factor 1000 → ml)
- Unidad `869711c3-eabd-4e95-92f2-555efaaba6b0` (`ud`, unit, factor 1, **base**)
---
5. DECISIONES ARQUITECTÓNICAS CERRADAS
5.1 — Sprint 1 (D1-D5, aprobadas 18-19/05 por Julio CEO)
D1 — Permisos (Opción B): `manager_permissions` (columnas legacy) + `permission_sets`
`permission_set_assignments` jsonb. Cascada en `has_permission()`: admin → override
legacy → permission_set jsonb → DENY. Migración gradual.
D2 — Feature flags / plan_id: tabla `feature_flags` separada + `subscriptions.plan_id`
como fuente única. NO añadir `accounts.feature_flags` ni `accounts.plan_id`.
D3 — Platform admin (Opción C2): tabla `platform_admins` separada;
`current_user_is_admin()` refactorizada; Julio migrado a fila con `role='ceo'`.
`accounts.is_internal` mantenida por compat — pendiente decidir DROP.
D4 — CASCADE legal (Opción α): ver §4.4.
D5 — PITR NO activado: ver §3.
5.2 — Sprint 2 (D-S2.x) — RESCATADAS de los docs retirados
Cerradas:
D-S2.1 flowType `pkce` (commit `02b6f3e`).
D-S2.2 Magic link deprecation gradual (`@deprecated` Sprint 2, borrado físico Sprint 3).
D-S2.4 Persistencia `current_account_id` con prioridad JWT. Fresh login: JWT gana,
escribe localStorage. Navegación: lee localStorage, fallback JWT. Logout: borra.
Clave `folvy.activeAccountId`.
D-S2.5 Host de emails desde `VITE_APP_URL` (`getRedirectBaseUrl()`), NUNCA hardcoded.
D-S2.6 `react-router-dom@7.15.1`, API v6 en Sprint 2; migración a `createBrowserRouter`
se valora Sprint 3.
D-S2.7 `resolveCurrentAccount` por `created_at DESC`, desempate `id DESC`. En el hook.
D-S2.8 `session_max_age` emitido pero NO aplicado hasta Sprint 4.
D-S2.9 Tests integration con Vitest, NO Playwright (Playwright V1.1+).
D-S2.14 Password policy: lower+upper+digits, min 8, símbolos NO requeridos (NIST 2020),
leaked passwords ON.
D-S2.16 Claims sin `account_name`; JWT lleva `current_account_slug`; nombre vía query.
D-S2.18 `account_id` en `permission_set_assignments` vía JOIN con `user_profiles`.
D-S2.19 Hook defensivo: sin profile activo ni platform_admin → emite `folvy.*` neutros,
NO falla.
D-S2.20 Un solo proyecto Supabase hasta Sprint 14.
D-S2.24 Hook como Postgres Function (NO Edge Function): 10-20× más rápido, cero deploy.
D-S2.25 Pantalla "Crear cuenta cliente" en Sprint 4 (hasta entonces SQL ad-hoc).
(Superada: la portería con wizard ya está en producción.)
D-S2.29 LoginPage Foodint archivado como `LoginPageMagicLink.tsx`, no importado.
D-S2.30 (Opción B) AuthRouter separado en `src/auth/AuthRouter.tsx`; App.tsx renderiza
`<AuthRouter />` cuando `!authUserId`.
D-S2.31 UI tokens auth Sprint 2 = reusar Foodint, rebrand Sprint 3.
Modelo welcome — A (active-by-default): profile con `active=true`; welcome trackeado
por `welcome_completed_at IS NOT NULL`; CHECK `user_profiles_welcome_requires_terms`.
Pendientes (sin sprint asignado):
D-S2.3 `/select-account` stub → diseño final pendiente.
D-S2.13 caducidad tokens invite (7d) vs reset (24h).
D-S2.15 crear `.env.example` formal.
D-S2.22 bucket `employee-documents` PUBLIC vs PRIVATE (Sprint 14).
D-S2.28 cada modificación de App.tsx requiere nueva autorización explícita.
5.3 — Bloque Comunicación (Fase B, verificadas contra BBDD)
Auth: `supabase.auth.getUser(jwt)`, 401 si falla. NO `decodeJwtSub`. Dos clientes:
anon para `getUser`, `service_role` para queries (bypass RLS).
`accountId` en el PAYLOAD (requerido), validado contra las cuentas del caller. NO
`profiles[0]`. `callerEmployeeId` se resuelve del profile concreto de esa cuenta.
Pertenencia empleado→cuenta vía `employees.location_id → locations.account_id`
(Opción A). `assigned_locations` NO se usa.
`reply_to` snake_case (fetch directo a Resend, no el SDK).
Rate limit estricto: `currentCount + batchSize > LIMIT` (50/h, 200/día por cuenta).
`to_email` recalculado server-side desde `employees.email`. Fail-closed si falta.
PATRÓN AUTH (regla general): NUNCA debilitar la query de decisión para conseguir más
info de logging. La query estricta DECIDE fail-closed; si hace falta logging rico, query
de diagnóstico SEPARADA, solo en el camino de rechazo, solo alimenta `console.error`.
5.4 — Patrones del módulo Personal (no son deuda)
`Employee.vacations/documents/formations` viven siempre `[]` desde
`supabaseSync.rowToEmployee`. Cada pantalla que los necesite los carga vía service
dedicado (`vacationsService`, `documentsService`, formaciones). `supabaseSync.rowToEmployee`
es zona consolidada, no se toca.
5.5 — Patrones de Folvy AI (cerradas 27/05)
Edge Function con dos modos (legacy JSON / streaming SSE) seleccionados por `body.stream`. Permite uso desde clientes que NO soportan SSE (testing con curl) Y desde el chat real con UX viva.
Auth con JWT del usuario (NO service-role) en todas las llamadas a tools que leen datos del cliente. RLS aplica naturalmente. La Edge Function solo usa service-role para escribir en `ai_interaction` (logging propio, no datos del cliente).
Bucle tool-use con MAX_TOOL_LOOPS=5 para evitar bucles infinitos.
Reglas anti-invención integradas en el system prompt: prohibición explícita de mencionar canales/integraciones/productos no observados; frase canónica si una tool devuelve `data_access='empty_or_forbidden'`. Reducción medida de tokens_out 50-60%.
Streaming SSE con eventos discretos (text/tool_start/tool_end/done/partial_end/error) parseados client-side por el service. El `partial_end` con razón (`timeout`/`network`/`aborted`) permite mostrar lo recibido aunque la conexión se rompa — patrón de robustez.
`FolvyAISurface` es tipo manual en el front (`'chat'|'aicard'|'background'|'opening'`). Espejo del enum del backend. Drift posible no detectado automáticamente — ver §10.5 deuda de proceso.
react-markdown con allowedElements restringido (`'p','strong','em','ol','ul','li','br'`). Defensa en profundidad: el prompt prohíbe ciertos elementos, el render bloquea por si la IA los emite igual.
El saludo proactivo (`greet`) es idempotente: no se dispara si ya hay mensajes o está streaming. Doble protección: flag `hasGreeted` en el componente + check `messages.length > 0` en el hook.
`regenerate` envía historial sin el último user message (patrón ChatGPT). Evita que el backend interprete que el usuario repitió la pregunta.
Modelo claude-sonnet-4-6 default, configurable por env `FOLVY_AI_MODEL`. Coste medido en producción: ~0,7 céntimos por turno con tool, ~0,4 céntimos sin tool.
---
6. REGLAS DE TRABAJO
6.1 — No negociables
Archivos completos cuando aplique, no diffs sueltos sin contexto.
Pedir el fichero original (o que Claude Code lo lea) ANTES de modificarlo. No
inventar sobre suposiciones.
NO modificar `App.tsx` sin permiso explícito de Julio (D-S2.28).
NO sobrescribir `notificationsService.ts` (firma posicional v17.1 consolidada: los 5
parámetros originales no se mueven; lo nuevo va al final).
Antes de cualquier decisión arquitectónica, verificar BBDD vía `information_schema`.
La BBDD es la verdad; este documento puede estar desactualizado.
SQL transaccional (BEGIN/COMMIT) solo con varios cambios relacionados. Para un cambio
único en el SQL Editor de Supabase, INSERT/UPDATE directo (el BEGIN/COMMIT separado en el
editor descarta la transacción — aprendido a las malas).
SQL y código revisables ANTES de ejecutar. El coordinador propone/revisa, Julio
ejecuta y verifica.
Julio decide cuándo cerrar. Si el coordinador detecta riesgo o fatiga, lo recomienda
con argumentos UNA vez; si Julio insiste, sigue y registra la reserva como nota técnica.
Directo, sin pelotismo. Si el coordinador discrepa, lo dice UNA vez con argumentos;
si Julio insiste, ejecuta y registra reserva.
NUNCA "don't ask again" en Claude Code para `git`/`curl`/comandos sensibles: cada
uno se aprueba a mano.
Al final de cada sesión técnica, ofrecer actualizar este documento.
6.2 — Técnicas
TypeScript strict, camelCase en cliente, snake_case en BBDD.
Doble cast `as unknown as Json` para columnas jsonb.
`tsconfig.app.json`: `verbatimModuleSyntax + erasableSyntaxOnly` → NO enums, NO parameter
properties.
Oxc parser Vite 8: NO mezclar `??` con `&&` sin paréntesis.
Patrón canónico de services CRUD multi-tenancy: ver `brandsService.ts` del Knowledge.
Edge Functions corren en Deno, NO en el toolchain Vite del cliente: `npm run build`
NO las compila. Su check real es que el deploy no falle.
D-S2.26 (encoding archivos config): UTF-8 SIN BOM, LF. En PowerShell:
```powershell
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
```
NUNCA `Set-Content -Encoding UTF8` (añade BOM) ni `Out-File` (puede UTF-16 LE).
D-S2.27: verificar hooks existentes (`Get-ChildItem -Recurse src -Filter "use*.ts"`)
antes de crear uno nuevo.
D-S2.21: NUNCA cargar PII reales como datos de prueba sin consentimiento firmado.
6.3 — SQL aprendidas (Sprint 1)
❌ Subqueries (`NOT EXISTS`, `SELECT`) en CHECK constraints.
❌ Funciones volátiles (`now()`, `random()`) en `WHERE` de índice parcial.
❌ `jsonb_build_object()` con más de 50 pares (>100 args) — usar literal `'{...}'::jsonb`.
✅ Preview SELECT antes de cada migration / DELETE.
✅ Verificación post-ejecución obligatoria.
D-S2.23 (limpieza): DELETE topológico manual en orden inverso de dependencias. NO
TRUNCATE CASCADE. NO soft delete si el objetivo es limpieza física.
6.4 — Protocolo de refuerzo
Identificación obligatoria al inicio ("Soy [Nombre], el refuerzo técnico de Julio").
Si no se sabe quién está al teclado, asumir Julio.
El refuerzo tiene autoridad delegada total en su turno.
Decisiones que cambian planos documentales aprobados se escalan a Julio aunque el refuerzo
tenga autoridad delegada.
Autorizaciones vía otro canal (WhatsApp, oral): exigir trazabilidad escrita en chat.
6.5 — Seguridad operativa
No ejecutar SQL en producción sin red de seguridad confirmada (PITR o staging).
No ejecutar SQL borrador no probado sin auditoría preview-antes.
Verificar identidad ante decisiones de impacto presupuestario o de producción.
Parar inmediatamente ante cualquier output inesperado durante migrations.
---
7. DEUDA TÉCNICA Y PENDIENTES
7.1 — Infraestructura / producción
404 SPA en Vercel — RESUELTO 22/05 y verificado 25/05: `vercel.json` (raíz del repo)
con rewrite catch-all `/(.*)` → `/index.html`.
PITR antes de Sprint 14 (§3, D5).
Limpiar 10 tablas backup del Bloque S (`_backup_*`) — confirmar con Julio.
`accounts.is_internal`: decidir DROP COLUMN o mantener tras auditar uso en frontend.
7.2 — Comunicación / emails
Tabla de audit de emails de PLATAFORMA (`platform_email_log` o similar) sin crear.
Las tablas APPCC (`appcc_audit_log`, `appcc_notifications`) son de dominio cliente, NO usar.
Hoy `send-email` solo deja `console.log` + log de Resend.
`GRACE_PERIOD_DAYS = 7` duplicado en `accountsService.ts` y `AccountStatusGate.tsx`.
Unificar en constante compartida.
Fase C: `user_notification_preferences`, webhooks Resend bounce/complaint, reply-to
dinámico, broadcast a cuenta entera. Fase D: chat 1-a-1 (`threads`, `messages`), V1.1.
7.3 — Portería / cuentas
Catálogo de submódulos hardcodeado en `NuevaCuentaPage.tsx` (el alta); la edición ya
lee de BBDD (`getCatalog()`). Migrar el alta.
Nomenclatura `status` `trial` vs `trialing`: verificar que `create-account` no escribe
`trialing` (el CHECK usa `trial`).
Nombre CEO: `platform_admins.full_name` dice "Julio Gascón"; correcto **"Julio Gª Colón"**
(García Colón). UPDATE de 1 línea pendiente en BBDD.
Posible "Foodint" residual en `billing_plans.description` (no verificado).
Slug en URL (al abrir raíz redirige a /folvy, sin resolver).
7.4 — Personal (deudas menores)
EXIF rotation en `loadAndResizeImage` (PDF CAPA): fotos verticales de móvil pueden
salir rotadas.
Uploader/reportador en captions/notificaciones sin resolver id→nombre.
Cruce medianoche / domingo→lunes en detector de solape y `rest_12h`: diferido.
`manager_permissions.show_prediccion_personal` ornamental (página oculta); retirar al
migrar a `permission_sets`.
Fase 2.C (Personal): rename-then-drop de `weekly_plans`/`shift_assignments`/
`shift_minimums` tras observación. Fase 2.D: destino de `AvisosSettingsPage` (mientras
viva, `shift_types` y `calendarService.ts` se conservan).
Punto 2 (schema cuadrante duplicado): RESUELTO/verificado 25/05. `AhoraMismoPage`
reescrita sobre `schedulerService`; `no_scheduled` es ahora un estado legítimo del tipo
discriminado en `horasComputo.ts` ("no le toca hoy"), no el bug latente. Pendiente solo la
Fase 2.C (rename-then-drop de tablas legacy del cuadrante, ver arriba).
7.5 — Pendientes operativos CEO
2FA Bitwarden; password CEO en gestor + master en papel; 2FA Resend; archivar repo GitHub
staging; guardar nueva API key Resend en Bitwarden.
Decidir modelo de cobro (Holded / Stripe / manual) — condiciona ficha (IBAN) y
facturación. Hoy módulos `unit_price_eur=0` (precio desacoplado).
7.6 — Documentación
Auditar docs sueltos (deuda acotada, sesión futura). El repo tiene 18 `.md`
trackeados. Prioridad de revisión por riesgo de envenenar el contexto de arranque:
`CLAUDE.md` (raíz) — lo lee Claude Code automáticamente al arrancar. Si está
desactualizado, parte de contexto fósil cada sesión. Revisar primero.
`docs/legacy/` (3 ficheros: `CLAUDE.md` antiguo, `PROMPT_ARRANQUE_NUEVA_SESION.md`,
`arquitectura_plataforma_2026-05-16.md`) — pre-rebrand, candidatos a borrar o archivar.
`src/docs/` mezcla manual de usuario (`MANUAL.md`, `gestor/`, `trabajador/`) con docs
técnicos históricos (`ESTADO_AUTH_FASE1_COMPLETA.md`, `PLAN_AUTH_ROLES.md`). Separar
públicos.
Los 5 maestros `docs/folvy_*` existen todos y son correctos (el addendum Sesión 2 ya está
en el repo; el doc viejo lo marcaba erróneamente como "pendiente de subir").
**Añadido 28/05 noche: `folvy_v1_editor_escandallos_diseno.md` (nuevo documento maestro)** — contiene el diseño UX completo del editor de escandallos V1: layouts ASCII de las 5 solapas, vista lista, catálogo raws, pantalla de incidencias, 4 modos de creación, auditoría visual, modo noche cocina, comportamiento mobile, comparador V1.1, 3 prompts sistema en texto literal, schema total acumulado para S1. Lectura obligatoria al construir S3-S10.
Notas de proceso: mantener confirmación manual en cada `git commit`/`curl` (no "don't
ask again"). Revisar piezas sensibles código-a-código antes de commitear.
7.7 — FRENTE: Acceso del trabajador / Portal del empleado (BLOQUEANTE producción)
[Sin cambios desde la última versión. Resumen: portal del empleado existe pero no es
usable end-to-end. Modelo C1 decidido (usuario+contraseña prefijada, email sintético
interno). Plan de construcción C1 con orden por dependencias en versión previa del
documento. BLOQUEANTE para producción Llorente29 (7/09/2026).]
7.8 — FRENTE: Permisos del encargado (estado y deudas)
ESTADO: el frente está FUNCIONAL y verificado en producción. El control de permisos por checkboxes funciona de punta a punta (modal → manager_permissions → get_effective_permissions → usePermissions → gating de menús/pestañas/engranaje). Deudas vivas:
[IMPORTANTE — prioridad alta] Guard de ruta por URL. El gating oculta los menús pero NO bloquea el acceso por URL directa. Un encargado podría ver páginas fuera de su menú tecleando la dirección. Falta un guard en el router que valide el permiso antes de renderizar cada página. NO dar acceso a más encargados (más allá de Pamela, de confianza) hasta cerrar esto. Primera tarea de la próxima sesión.
Refrescar permisos en vivo. Hoy, cambiar los permisos de un encargado requiere que él salga y vuelva a entrar. Mejora futura: refrescar sin re-login.
4 items de APPCC sin clave granular elevados temporalmente a requiredRole: 'admin' (appcc_audits, appcc_reports, appcc_templates). Si se quiere que un encargado los vea sin ser admin, añadir claves nuevas a manager_permissions y cambiar requiredRole por requiredPermission en appcc/module.tsx.
permission_sets quedó sin uso. Las tablas existen con 4 sets de sistema sembrados, pero NO se usan. has_permission y get_effective_permissions ya NO los leen. Candidatos a limpieza futura. El assignment de Julio (admin) a gerente_total quedó en permission_set_assignments — inocuo, limpiable.
show_prediccion_personal sigue ornamental (página oculta). Sin acción.
Notas técnicas (referencia rápida):
Funciones SQL: has_permission(p_account_id uuid, p_permission_key text) y get_effective_permissions(p_account_id uuid). Ambas SECURITY DEFINER, leen manager_permissions, admin → bypass.
Service: src/services/effectivePermissionsService.ts (getEffectivePermissions, tipo EffectivePermissions = Record<string,boolean>).
Hook: src/modules/multitenancy/hooks/usePermissions.ts (diccionario dinámico, isFullAccess por rol real).
Gating: requiredPermission?: string y requiredRole?: ShellRole en ModuleSidebarItem (shell/types.ts), filtrado en ModuleSidebar.tsx; pestañas+engranaje en ShellTopBar.tsx (helper isModuleVisible).
Modal: src/components/ManagerPermissionsModal.tsx (escribe en manager_permissions).
Commits de la sesión 2026-05-26 (todos en origin/main, HEAD=3ab55e4):
Acceso C1: 70aeb89, 614eef3, 1793111, 5a35e0e, b370816, 1346b20, dba7b3a.
Permisos: d12c886, d7f0b3c, 6609593, 822a5a8, cb46299, 3ab55e4.
Limpieza pendiente de pruebas: borrar zz.foodint (6b687b5d), zz.foodint1 (ad32b762), ZZ Prueba Worker C1/C2, ZZ_PRUEBA_E2E_B8. Pamela NO se borra.
7.9 — FRENTE: FOLVY KITCHEN (escandallo / coste de recetas) — Capa 1 y 2 EN PRODUCCIÓN
[Sin cambios estructurales desde la última versión. Capa 1 (recipe_item, recipe_line,
kitchen_unit, kitchen_cut_type, kitchen_settings, recipe_item_unit_conversion) + función
de coste + función de desglose ya están EN PRODUCCIÓN y verificadas (§4.9-4.10). Capa 2
(menu_item, brand_channel, brand_licensing_agreement, menu_item_economics) construida en
esta sesión (§1.1.A). Sin cambios en arquitectura. Detalles preservados en versión
previa del documento.]
**Diseño UX V1 del editor de escandallos cerrado el 28/05 noche.** Detalle completo en `folvy_v1_editor_escandallos_diseno.md`. Construcción en sesiones S3-S10. Schema acumulado para S1 documentado en §13 del documento de diseño.
Commits del frente Capa 1 (todos en origin/main, HEAD pre-Capa-2=827d3e0): 2cf3cb7, 559660e, f13e1a8, 5a82b6f, ce123ed, 0c6ff54, aa520af, 827d3e0.
Commits del frente Capa 2 (origin/main): 2b756f8, 0be2aeb, c38dc57, dda4873, bd9053b, 2c829c0, 0320021.
7.10 — FRENTE: FOLVY AI (plataforma transversal) — v1++ EN PRODUCCIÓN
Qué está construido y en producción (27/05/2026 madrugada):
Plataforma BBDD (2 tablas con RLS: `ai_memory`, `ai_interaction`) — ver §4.11.
Edge Function `folvy-ai` v2 streaming SSE — ver §1.1.B y §5.5.
Front: 7 archivos en `src/modules/folvy-ai/` (types, service, hook, 4 componentes UI) + integración Shell.tsx.
Catálogo de tools: 1 implementada (`catalog_health`), 5 pendientes — ver §9.
Voz Folvy AI v1 (constitución firme en §9.1).
Constitución de Folvy AI (decisión firme 27/05/2026, ver §9.1 para detalle):
Capa transversal, NO módulo con pestaña.
Voz: profesional pero cercana, tutea, frases cortas, propone acción, sin emojis.
Principios innegociables: NUNCA inventa, NUNCA actúa sin confirmación, respeta RLS, solo Folvy.
Frase canónica si data_access='empty_or_forbidden': "No veo movimientos en tu cuenta — puede ser que esté vacía o que no tenga permiso para leerla. ¿Has subido ya datos?".
Deudas honestas registradas (§10.5): dependencia de Anthropic, bundle grande, falta observabilidad/alertas de coste, voz no validada con clientes reales.
Commits del frente (todos en origin/main, HEAD=5b62d4e):
`4d43b7c`, `7fe80e8` — plataforma base (tablas + function v1 sin streaming).
`24b2c0f` — react-markdown + audit fix.
`0487dee` — Edge Function v2 streaming + anti-invención.
`78670ec` — chat flotante v1++ (7 archivos nuevos, +1.115 líneas).
`5b62d4e` — montaje en Shell.
Próximos pasos del frente (orden por dependencia):
Validación visual en local (`npm run dev`).
Tool 2: `run_mapping` (la más diferenciadora, asiste al motor de mapeo IA).
Tools 3-6: `validate_food_cost`, `appcc_today_summary`, `team_overtime_check`, `predict_purchase_list` (esta última bloqueada por importación de histórico anual).
AICards proactivas en editores de recetas / menu_items (v1.1).
Pantalla "qué sabe Folvy AI de mí" (v1.1).
Foto → receta (v1.1, cimientos ya puestos en recipe_item). **NOTA 28/05 noche: la pieza foto→receta está cubierta como parte del modo "Por imagen" del editor de escandallos V1 — el cocinero sube foto/PDF/URL y Claude Opus 4.7 visión extrae la receta estructurada con cruce automático contra catálogo de raws. Ver `folvy_v1_editor_escandallos_diseno.md` §6.2 y §12.2.**
Persistencia de feedback de thumbs (v1.1).
Persistencia de conversación entre recargas (v1.1, localStorage).
Code splitting para bajar el bundle (§10.5 deuda 2).
Dashboard de uso + alertas de coste (§10.5 deuda 3).
Abstracción de proveedor IA (§10.5 deuda 1). **NOTA 28/05 noche: prioridad SUBE — el modo voz V1 del editor (Whisper + Haiku) introduce dependencia de OpenAI Whisper además de Anthropic. Salvaguarda explícita en decisión 7.**
---
8. HISTORIAL DE SESIONES (arqueología — rara vez se consulta)
P1-P3: construcción inicial app cliente Llorente29 (APPCC, employees, locations, brands).
P4 (16/05): Bloque C Fase 1 (URL slug + BrowserRouter). Bloque S blindó RLS en las
40 tablas iniciales + 4 funciones auxiliares.
P5-P6 (17/05): preparación Bloque C; catálogo APPCC seed + locales Llorente29 + Pamela.
Sesión 0 (18/05): reconciliación arquitectónica, rebrand Folvy, 4 documentos maestros.
Sesiones 1-3 (18/05): Sprint 0.1, pre-requisitos CEO cerrados.
Sesión 4 (18/05): auditoría BBDD; decisiones D1-D4; 19 migrations en borrador.
Sesión 5 (18-19/05): Sprint 1 ejecutado (19 migrations en producción, 5 bugs SQL en
vivo, D5).
Sesión 6 (Sprint 2): decisiones D-S2.x (auth: PKCE, AuthRouter, hook, password policy…).
Portería (Ses 15-17): alta/listado/detalle/estado de cuentas, bloqueo efectivo, edición
de módulos, borrado, motor de emails `send-email` + Capa C (4 avisos automáticos).
Sesión Personal T8 + APPCC + Comunicación (22/05): onboarding sin password temporal;
export gestoría CSV; config gestoría por cuenta; auditoría Personal T1-T8 y APPCC; PDF CAPA
con fotos; notificación de correctiva; despachador Fase A completa + Fase B (B.1, B.2, B.4).
Frente B — consolidación documental (25/05): verificado nº real de tablas (87=77+10);
consolidados los tres docs de contexto en este maestro único; retirados ESTADO y REGLAS.
Fase B pasos B.5/B.6/B.7 (25/05): wrapper `accountEmailService` (B.5, `85e84aa`),
canal email real en el dispatcher con `accountId` en `DispatchEvent` (B.6, `f1cab56`),
y UI manager `SendMessageModal` + botón en StaffPage (B.7, `4b577c0`). Build verde en
cada paso. B.6+B.7 sin push. Pendiente B.8 (prueba E2E real + push de cierre).
Folvy Kitchen Capa 1 (26/05, 2ª sesión): 6 tablas Kitchen, función de coste, 2/4
pantallas (catálogo ingredientes + ficha escandallo con coste/% por línea). HEAD `827d3e0`.
Sesión maratónica 27/05 — Capa 2 + Ventas + Catálogo + Piloto Smash + Folvy AI v1++:
Frente A: construida y verificada la Capa 2 económica (menu_item, brand_channel comisión
variable, menu_item_economics, licensing); modelo de ventas + import de 2.271 tickets
reales (8.202 líneas); 17 marcas sembradas; analizados 17 catálogos oficiales (493
prod) y escandallo profesional (267 platos/137 ingr); PILOTO SMASH BROTHERS validada
end-to-end (escandallo→ingredientes con conversión/merma→recipe_line→coste al céntimo→
menu_item por canal→food cost 15,8-26,1%). Frente B: FOLVY AI v1++ DESPLEGADA —
plataforma BBDD (ai_memory + ai_interaction) + Edge Function v2 streaming SSE +
anti-invención + 7 archivos front + montaje en Shell. 100 tablas. Casos especiales
resueltos (conversión unidad, merma bruto/neto, incompatibilidad dimensión, casado por
texto que falla, drift de tipos back/front, bug de regenerate cazado antes de teclear).
HEAD=`5b62d4e`. Ver §1, §9 y §10.
**Sesión maratónica 28/05 — TRES PARTES (AM/PM1/PM2):**
**AM (Parte 1)**: conector Last.app construido y desplegado (3 edge functions, 5 tablas SQL directo), 11.894 ventas reales backfilled (99,3% mapeado), carta sembrada 9 marcas (205 dish + 820 menu_items + 205 vínculos). HEAD pre-PM1=?.
**PM1 (Parte 2)**: puente determinista tspoon↔Folvy resuelto (vía plu sin prefijo `o.`, 3 centros extraídos), motor de coste validado al céntimo en 3 platos (Smash 0.01%, Bocadillo 0.03%, Milanesa 0.04%), 160 ingredientes raw importados + 4 conversiones Uni→g (Carne 85g, Solomillo 45g, Feta 20g, Falafel 25g) + 5 raws migrados ml→g (Aceite, Mayonesa, Sweet Chilli, Salsa Yogur, Vinagre), y **94 dish con escandallo real IMPORTADOS** (860 recipe_line + 94 computed_cost, 60 al céntimo, 34 needs_review). Folvy tiene por primera vez food cost REAL de Llorente29.
**PM2 (Parte 3, este cierre)**: DISEÑO COMPLETO V1 EDITOR DE ESCANDALLOS — 8 decisiones de producto cerradas (auditoría visual, pasos, versionado, familias, etiquetas, conversacional, voz, sub-recetas), 5 catálogos semilla diseñados (48 familias + 26 etiquetas + 14 alérgenos UE + 16 cortes + settings), reconocimiento real de BBDD (5 tablas Kitchen + sales), diagnóstico real de 34 needs_review con CSV generado (sesgo unidireccional confirmado), 12 hallazgos de competencia mundial integrados (Galley, Apicbase, Crunchtime, Toast, Choco, Winnow, Notion/Linear), diseño UX completo (lienzo + 5 solapas + vista lista + catálogo raws + pantalla incidencias + 4 modos de creación foto/voz/conversacional/manual + auditoría visual en pase + panel conversacional + modo noche cocina + mobile), 3 prompts sistema completos para modos IA, **decisión completa de Modificadores M1-M4 con confirmación operativa de Last.app** (envía modificadores estructurados en `sale.raw_products jsonb`). Schema total acumulado para S1 documentado. Plan revisado de sesiones. Documento maestro nuevo creado: `folvy_v1_editor_escandallos_diseno.md`.
Migrations Sprint 1 (19/19) y bugs corregidos en vivo
M01-M19 ejecutadas. Bugs: M01 (`accounts_slug_format` ya existía), M02 (`valid_role` ya
existía), M05 (subquery en CHECK → operador `<@`), M06 (`now()` en índice parcial → eliminar
índice), M18 (`jsonb_build_object` >100 args → literal `::jsonb`).
---
9. FOLVY AI — Capa transversal de IA (creada 27/05/2026)
> Sección creada el 27/05 para que todo lo decidido sobre Folvy AI quede como referencia
> estable. Lo que sucede en cada sesión va a §1.1.B; lo que se decide para siempre, aquí.
9.1 — Constitución Folvy AI v1 (decisiones firmes)
Qué es Folvy AI:
Capa de inteligencia transversal de Folvy. NO módulo con pestaña; plataforma común que
vive en el Shell y se consume de dos formas: asistente conversacional flotante (botón
"✨ Folvy AI") + tarjetas proactivas (AICard) dentro de cada módulo. Misma plataforma,
misma memoria, misma voz.
Vive en `src/modules/folvy-ai/` (front) + Edge Function `folvy-ai` (back) + 2 tablas con
RLS (`ai_memory`, `ai_interaction`).
**Añadido 28/05 noche**: 3 modos IA del editor de escandallos V1 (foto/voz/conversacional) vienen con sus 3 prompts sistema cerrados conceptualmente (texto literal en `folvy_v1_editor_escandallos_diseno.md` §12). Reutilizan los principios de Folvy AI v1 (NUNCA inventa, RLS, frase canónica). Schema helper SQL pendiente para S1: `kitchen_dish_state_for_ai(uuid)` y `kitchen_similar_dishes_for_ai(uuid, int)`.
Voz Folvy AI (Julio definió, validada técnicamente, NO validada con clientes reales aún
— ver §10.5 deuda 4):
Profesional pero cercana. Tutea. Frases cortas. Termina con propuesta de acción.
Sin emojis en cuerpo (los iconos visuales van en la UI, no en el texto).
Tono de socio que sabe del negocio, no chatbot ni consultor.
Principios innegociables:
NUNCA inventa datos. Si no sabe, dice "no tengo ese dato".
NUNCA actúa sin confirmación en operaciones que cambian datos de negocio.
Solo habla de Folvy y el negocio del cliente. No hace de chatbot generalista.
Respeta los permisos del usuario vía RLS. La function usa JWT del usuario en todas las tools que leen datos del cliente, NO service-role.
Si una tool devuelve `data_access='empty_or_forbidden'`, NO especula sobre causas — usa frase canónica: "No veo movimientos en tu cuenta — puede ser que esté vacía o que no tenga permiso para leerla. ¿Has subido ya datos?".
NUNCA menciona por nombre productos, integraciones, canales o funcionalidades que no aparezcan literalmente en los datos consultados o en el prompt.
Catálogo de tools v1 (prioridad de construcción):
✅ `catalog_health` (Kitchen) — IMPLEMENTADA y validada contra 8.202 sale_line.
⏳ `run_mapping` (Kitchen) — pendiente. La más diferenciadora.
⏳ `predict_purchase_list` (Kitchen+Sales) — bloqueada por importación de histórico anual de ventas.
⏳ `validate_food_cost` (Kitchen) — pendiente.
⏳ `appcc_today_summary` (APPCC) — pendiente.
⏳ `team_overtime_check` (Team) — pendiente.
9.2 — Roadmap Folvy AI
v1.1 (próxima ola, sin fecha):
Pantalla "qué sabe Folvy AI de mí" (editar memoria por scope: vocabulary, preference, fact).
Foto → receta (cimientos ya en recipe_item). **NOTA 28/05 noche: cubierta en V1 como parte del editor de escandallos, no se espera a v1.1.**
AICards proactivas en editor de recetas y editor de menu_item.
Predicción avanzada con estacionalidad/tendencia/eventos.
Importar histórico año completo de Llorente29.
Persistencia de thumbs feedback.
Persistencia de conversación entre recargas.
Refactor de `showRetry`.
v2+ (visión):
Cruce ventas × compras (mermas, robos, errores de inventario vía escandallo).
Asistente por voz.
IA proactiva sin abrir app.
Generación de imágenes de plato.
Multi-idioma automático.
Memoria que cruza módulos (Team × APPCC × Kitchen).
Auto-86 por stock.
Asesoría operativa proactiva.
IA escribe APPCC del día.
IA en Folvy Team.
Predicción a turno.
IA reordena carta por marca/canal.
**Añadido 28/05 noche v2+**: AvT (Actual vs Theoretical) real ponderado por modificadores vendidos. Cruce escandallo × `sale_line_modifier` × catálogo de modificadores. Folvy sería el único en el mercado en dar coste real al céntimo por venta concreta. Requiere S_MODIFIERS completado.
9.3 — Decisiones de arquitectura diferidas (Folvy AI)
Cuándo extraer Folvy AI a capa pública consumible por terceros.
Modelo de cobro de IA.
Opus/Sonnet por tool. **Añadido 28/05 noche: el modo Foto del editor V1 usa Claude Opus 4.7 visión por necesidad de OCR multi-formato + razonamiento de cruce de raws. Es la primera tarea Folvy que escala a Opus.**
Coste operativo Folvy AI por cuenta/mes.
Validación de history adversarial.
Aprendizaje empírico anti-invención.
Code-splitting del bundle principal.
Abstracción de proveedor IA — ver §10.5 deuda 1.
Observabilidad y alertas de coste por cuenta — ver §10.5 deuda 3.
9.4 — Regla de mantenimiento
Toda idea de IA que surja en una sesión y no se construya en ese momento aterriza en §9.2 antes de cerrar sesión. No en post-its, no en la memoria de Julio. Si se construye, sube de §9.2 a §9.1 o se documenta en §7.10.
---
10. IDEAS Y MEJORAS DE PRODUCTO + DATOS DE SIEMBRA (registro vivo — NO perder)
> Sección creada el 27/05 por petición explícita de Julio: "que queden registradas las
> conversaciones de mejoras y no se pierdan las ideas". Aquí va el conocimiento estratégico
> de producto (no código) y los IDs de la siembra de pruebas.
10.1 — Visión de producto: el hueco de Folvy
El mercado está PARTIDO en dos mundos que no se hablan, y Folvy los une sobre cocina fantasma multi-marca:
Mundo 1 — gestión de carta multi-plataforma (Otter, Deliverect, Last.app). Techo: NO tienen escandallo, food cost.
Mundo 2 — escandallos/food cost (Parker, Gastrokaizen, Yurest, tSpoonLab). Techo: NO gestionan carta multi-marca/canal ni cruzan con ventas reales.
FOLVY = único que une ambos + cruza con ventas reales + multi-marca sobre cocina compartida + IA que entiende la ECONOMÍA del plato.
**Actualizado 28/05 noche**: escaneo serio de Galley, Apicbase, Crunchtime, MarketMan, Toast, R365, Backbar, Meez, app Chef iPhone, Paper Chef, Winnow Vision, Choco+OpenAI, Notion/Linear. **Folvy V1 es objetivamente el mejor en 4 dimensiones: entrada multi-modal con IA, latido económico (300ms anim coste), auditoría visual en pase (Winnow lo hace en cubo, nadie en plato), UX cocina (Vista cocina + modo noche).** Detalle en `folvy_v1_editor_escandallos_diseno.md` §1.2.
PRINCIPIO INNEGOCIABLE (Julio): Folvy toma la usabilidad de Otter/Last.app PERO escandallo, libro de recetas, alérgenos y capa económica son OBLIGATORIOS y NO renunciables.
10.2 — Funcionalidades a construir (extraídas de competencia + ideas Julio)
De Otter/Last.app (usabilidad a igualar): display name vs nombre interno, precio por canal, toggle disponibilidad por canal, categorías visuales, edición en bloque, publicar/versionar catálogo, "generar con IA" descripción.
De Parker/Gastrokaizen (lo obligatorio): escandallo bruto/neto/merma (✅ validado); ALÉRGENOS por ingrediente (**NOTA 28/05 noche: catálogo `allergen` (14 entries UE 1169) + tabla `recipe_item_allergen` con 4 estados cerrados conceptualmente para S1**); banco de elaboraciones; coste vivo; libro de recetas con foto; modificadores como grupos reutilizables (**NOTA 28/05 noche: cerrados al 100% en M1-M4 con confirmación operativa de Last.app**).
IA — el frente más diferenciador:
Asistente IA de recetas (**NOTA 28/05 noche: cubierto en V1 como Modo "Hablando con Folvy"**).
Motor de mapeo IA. Tool `run_mapping`.
"Foto de cuaderno → receta" (**NOTA 28/05 noche: cubierto en V1 como Modo "Por imagen", multi-formato foto+PDF+URL+manuscrito**).
Auto-86 por stock (idea Julio 27/05). DEPENDE del módulo ALMACÉN.
**Añadido 28/05 noche — Auditoría visual en pase**: cocinero saca foto del plato emplatado, IA compara con foto de referencia, devuelve semáforo + issues. Modo `shadow` durante 14 capturas mínimas. UX cocinero (tablet) + dashboard encargado. **Nadie en el mercado lo tiene en plato** (Winnow lo hace en cubo = merma). Exclusivo Folvy V1.
10.3 — Siembra de pruebas en Folvy Interno (IDs reales, account `00000000-...-0001`)
Canales (4): Glovo `e9783d94`, Uber `07cbfd3c`, JustEat `dcf7d2c4`, Shop `3f144c83`.
Marcas OWN (8): Meraki Pita, Milanesa House, Mila's Sandwiches, Smash Brothers, Scandal Burgers, Bendito Burrito, The Urban Kebab, Dirty Burger.
Marcas LICENSED (9): Milanesa Haus, Koreans Do It Better, Dos Coyotes, Birria Burrito, Big Mike's, Ay Mamita Bowls, Chivuos, Lobbers, Deep Pizza.
> Milanesa Haus (licensed) ≠ Milanesa House (own): DOS marcas distintas.
Unidades globales: Unidad/ud `869711c3`, Gramo/g `8fc3baae`, Kilogramo/kg `2fb97155`, Mililitro/ml `953c626f`, Litro/L `c4826b0d`.
**NOTA 28/05 noche**: el piloto Smash del 27/05 fue REEMPLAZADO el 28/05 AM por datos reales de Last.app. El piloto Smash se borró de la BBDD el 28/05 mañana. Las marcas y canales sí están vivos en la cuenta Llorente29 real.
10.4 — Deudas/tensiones de modelo registradas
Flujo CEDIDO mal modelado: brand_licensing_agreement (revenue_share % único) INSUFICIENTE. Liquidación real Cloudtown revela complejidad mayor. REDISEÑO pendiente.
Dos niveles de análisis: "por plato" vs "por pedido/mes". Folvy necesitará ambos.
Persistencia de coste: kitchen_recipe_breakdown calcula on-demand pero NO persiste computed_cost; sin trigger.
15 productos candidatos a compartir entre marcas.
Combos: recipe_item dish que compone otros platos. Modelo lo soporta. Dejados para después.
Integración Last.app: **NOTA 28/05: ya implementado en el conector Last.app (Parte 1 del 28/05 AM)**.
**Añadido 28/05 noche**: deudas/tensiones del editor de escandallos V1: (a) `recipe_item.needs_review` existe en BBDD pero no en migration del repo → migration retroactiva crítica en S1; (b) `type='preparation'` no poblado en BBDD, hay 5 raws-fantasma que deberían ser preparaciones — Pamela los corrige en S2; (c) formato de compra (caja↔stock↔uso) cerrado conceptualmente para V1 pero NO editable hasta V1.1 — campos preparados en `recipe_item`.
10.5 — Deudas honestas de Folvy AI (registradas tras opinión técnica franca 27/05)
> Julio pidió explícitamente: "Lo que NO me ha gustado de tu solución, sin pelotismo".
Deuda 1 — Dependencia excesiva de Anthropic.
Plan: abstraer la capa de modelo. Interfaz `LLMProvider` con implementaciones `AnthropicProvider`, `OpenAIProvider`, etc.
Prioridad: media-alta. **ACTUALIZADO 28/05 noche: SUBE A ALTA. El modo voz V1 del editor introduce dependencia de OpenAI Whisper además de Anthropic. Ya no es ejercicio teórico, es necesidad real.**
Deuda 2 — Bundle grande (628KB gzipped).
Plan: code splitting con `React.lazy()`. Bajaría a ~200-300KB gzipped.
Prioridad: media.
Deuda 3 — Sin observabilidad operativa: no medimos coste por cuenta ni alertas.
Plan: vista SQL `v_ai_usage_by_account` + Edge Function `folvy-ai-metrics` + dashboard interno CEO + alerta email si una cuenta supera umbral.
Prioridad: ALTA. Prerrequisito para abrir a un segundo cliente.
Deuda 4 — Voz Folvy AI no validada con clientes reales.
Plan: primer feedback explícito cuando Llorente29 abra el chat.
Prioridad: media-baja, pero PRIMERA prioridad en feedback de cliente.
Deuda implícita: Feedback de thumbs en mensajes sin persistencia. V1.1.
10.6 — Deuda de proceso a vigilar
`FolvyAISurface` (front) es tipo manual; drift posible no detectado automáticamente.
`react-markdown ^10.1.0` versiones nuevas con breaking changes — gestionar con cuidado.
Bundle principal supera 500KB gzipped — ver §10.5 deuda 2.
**Añadido 28/05 noche**: `recipe_item.needs_review` existe en BBDD pero NO en ninguna migration del repo (drift confirmado por `git grep`). Migration retroactiva crítica en S1: `ALTER TABLE recipe_item ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false`.
13. PLAN DE CONSTRUCCIÓN DEL EDITOR (hoja de ruta viva) — añadido 30/05/2026

> Anclado por petición explícita de Julio ("no quiero perder B, y si cambio de
> conversación se pierden cosas"). El chat es volátil; esto no. Objetivo declarado:
> NO solo igualar a la competencia (Apicbase, Meez, tSpoonLab, R365) sino GANAR POR
> GOLEADA en este módulo. Cero deudas: ningún botón queda de adorno; cada tramo se
> termina y se valida en build+navegador antes del siguiente.

13.1 — FASE A: cimiento sólido (paridad + ventaja económica)

- **E1** · Editar cantidad inline + borrar línea + LATIDO (coste héroe y FC%/margen
  por canal pulsan en vivo al tocar un gramaje). ← tramo en curso 30/05.
- **E2** · Añadir ingrediente con buscador inteligente (desambiguación proveedor/formato
  estilo Apicbase) + crear raw nuevo al vuelo.
- **E3** · Unidad editable + BRUTO/NETO + MERMA por línea (ver §13.3, la "Opción B").
- **E4** · Arrastrar para reordenar líneas (recipe_line.position).
- **E5** · Subir foto real del plato (Supabase Storage → kitchenPhotoUrl). Cablear el
  botón de foto, hoy muerto. Aquí también se engancha la entrada FOTO→IA ya existente.
- **E6** · Archivar plato (borrado lógico reversible vía archiveRecipeItem; NUNCA borrado
  duro de un dish con menu_item/ventas). Esto es el "eliminar" hecho bien.
- **E7** · line-clamp-2 en nombres largos + semáforos de completitud por línea
  (precio/medida, estilo Apicbase) + pulido final.

13.2 — FASE B: la goleada (lo que NADIE tiene bien resuelto)

- **G1** · IA CONVERSACIONAL EN EL LIENZO. Hablarle al escandallo abierto ("sube la carne
  a 90 g", "¿por qué está al 28% de FC?", "sustituto más barato del queso sin pasar de
  25%") y verlo reconstruirse con el coste latiendo. EL GOLPE PRINCIPAL. Depende de E1-E2.
  Prompts ya diseñados en §6.4 y §12.
- **G2** · LATIDO PREDICTIVO. Umbral por canal + aviso "a pérdida en Glovo" mientras editas
  + sugerencia de PVP que recupera el margen objetivo. Edición con consecuencia, no solo
  reactiva.
- **G3** · MODIFICADORES FÁCILES para cocinero no técnico, con coste/margen ponderado por
  el MIX REAL vendido (bills / sale.raw_products). Depende de E1-E3. Supera a tSpoonLab/R365
  (rígidos y técnicos). Deuda estratégica ya registrada en CONTEXTO §10.2.
- **G4** · AUDITORÍA VISUAL EN PASE enganchada al plato (foto del emplatado → semáforo IA
  contra referencia). Nadie lo tiene EN PLATO (Winnow lo hace en cubo de merma). Diseño en §7.
- **G5** · SUB-RECETAS/PREPARACIONES con coste vivo encadenado (cambiar "Salsa Birria" sube
  solo en los N platos que la usan). El modelo recipe_line (parent/child) ya lo soporta.
- **G6** · BARNIZ CHEF: modo noche cocina (§9), vista pase a pantalla completa (§5.7), voz
  manos libres.

**Lectura honesta del competitivo (registrada para no engañarnos):** E1-E7 nos pone a la
PAR en lo funcional y ya POR DELANTE en lo económico (latido multi-canal) y en la entrada
FOTO→IA. La GOLEADA real sale de G1 (IA en lienzo) y G3 (modificadores fáciles); G2/G4/G5
son refuerzos potentes; G6 es el barniz. E1-E7 es el CIMIENTO de la goleada, no una
alternativa a ella: G1/G3/G4 no se pueden construir sobre un editor con botones muertos.

13.3 — DECISIÓN A/B sobre la cantidad editable (CRÍTICA, 30/05) — NO PERDER

**Hallazgo (leído de la BBDD, no supuesto):** las funciones `kitchen_recompute_item` y
`kitchen_recipe_breakdown` calculan el coste con BRUTO: `COALESCE(quantity_gross,
quantity_net)`. PERO `kitchen_recipe_breakdown` DEVUELVE EN PANTALLA EL NETO
(`quantity := v_line.quantity_net`). Datos reales: 869 líneas, 860 con quantity_gross,
134 con gross ≠ net (merma real). Es decir: hoy el cocinero VE el neto pero el coste sale
del BRUTO → si E1 editara el neto, el coste no se movería (latido muerto) y el número
visible divergiría del coste real.

**Decisión tomada (Julio confirmó A, con B garantizada en E3):**
- **E1 = Opción A:** el número editable es la CANTIDAD QUE CUESTA (bruto efectivo). Editar
  escribe en `quantity_gross` (si no existía, lo crea). Lo que ves = lo que cuesta = lo que
  editas. El latido funciona de verdad. Requiere ajustar `kitchen_recipe_breakdown` para que
  devuelva el bruto efectivo (y deje el neto disponible para E3).
- **E3 = Opción B (COMPROMETIDA, no opcional):** capa completa de merma — bruto + neto + %
  merma acoplados (decidir el "ancla" al editar), con mockup propio y contraste Apicbase/Meez.
  B NO es una versión mejor de A; A es el cimiento sobre el que B se construye bien. Saltarse
  el orden daría una merma peor y un latido frágil.

**Garantía:** B (merma completa) se ejecuta en E3 sí o sí. Queda escrita aquí para que
ninguna sesión futura la pierda.

14. ESTADO DE CIERRE — Sesión 30/05/2026

> Fuente de verdad del estado actual. La próxima sesión la lee primero (junto a §0).
> Sustituye a la antigua "§14 ESTADO DE EJECUCIÓN" de la mañana (commit 7cba703):
> donde solapaban, esta actualiza (lo que allí era PENDIENTE, aquí está HECHO).
> Complementa a §13 (hoja de ruta: QUÉ se va a construir); §14 dice QUÉ está YA
> construido. El histórico anterior (§1 en 28/05) está pendiente de regenerar y
> arrastra sobre-escapado — sanearlo es un tramo aparte, no se toca al cerrar.
> folvy_v1_editor_escandallos_diseno.md NO está en el repo (Project Knowledge/local);
> DEUDA: meterlo a /docs y versionarlo.

14.1 — Construido y desplegado en FASE A del editor (origin/main)

- Pantalla del editor RecipeEditorPage.tsx (reemplaza KitchenRecipePage, en desuso):
  cabecera con foto + 5 solapas (solo Escandallo construida), composición con barras
  de coste, panel económico azul multi-marca colapsable (FC/margen por canal). Backend
  de escandallo por FOTO (Edge Function extract-recipe, Opus visión) construido 29/05.
- L1 lista de platos KitchenRecipesPage.tsx: contenedor LISTA+DETALLE por estado.
  Ruta 'recetas' monta el contenedor; el editor se monta dentro con onBack.
- E1 editar cantidad inline (BRUTO EFECTIVO, Opción A de §13.3) + borrar línea + LATIDO
  (coste héroe pulsa, panel FC refresca vía econReloadTick). Optimista con reversión.
- E2a añadir ingrediente EXISTENTE: buscador ordenado por USO REAL (kitchen_raw_usage_counts)
  + preview exacto de impacto + búsqueda por TOKENS sin acentos en ambos buscadores
  ("milanesa pol" -> "Milanesa de Pollo").
- E2b crear ingrediente NUEVO al vuelo desde el buscador (sin coincidencia -> "Crear «X»";
  con coincidencias -> "¿No está? Crear «X»"): mini-form (nombre + unidad base agrupada +
  coste opcional) -> createRecipeItem(raw, source='manual', needs_review=true, con autoría).
- CAPA needs_review COMPLETA (commit 13a7874, lo nuevo de esta sesión, validado en navegador):
  * Editor: por línea, badges diferenciados "sin terminar" (ingrediente needs_review, vía
    childNeedsReview) y "no costeable" (línea sin conversión). Propagación a cabecera:
    el plato sale "Revisar" si él mismo o cualquier línea lo requiere. Banner de motivo de
    revisión (flag propio del plato) con texto GENÉRICO desde campos (kind + deltaPct),
    matizado por magnitud, SIN nombrar la fuente. Botón "Dar por revisado" (dismissReview).
  * Lista de platos: semántica de 4 estados (ver 14.3).
  * Lista de ingredientes (KitchenItemsPage): badge "sin terminar" en raws needs_review.
  * recipeItemService.ts: getDishesIncomplete + dismissReview con fallback (ver 14.4).
  * recipeLineService.ts: childNeedsReview propagado desde el breakdown.

14.2 — Funciones SQL (en Supabase, COMMIT aplicado)

- kitchen_recipe_breakdown(uuid) — MODIFICADA dos veces el 30/05:
  (a) E1/Opción A: devuelve quantity = BRUTO EFECTIVO COALESCE(quantity_gross, quantity_net)
      (lo que cuesta y lo que se edita) + columna quantity_net (neto, reservado para E3).
      Resuelve la divergencia de §13.3 (antes mostraba neto pero costeaba con bruto). Motor
      de coste intacto.
  (b) needs_review: añadida columna de retorno child_needs_review boolean (= needs_review del
      ingrediente hijo, distinto del needs_review de línea que = línea no costeable).
- kitchen_dishes_incomplete(p_account_id uuid) — NUEVA. SECURITY DEFINER + guard
  current_user_is_admin_or_manager_of. Devuelve SOLO los platos incompletos (HAVING bool_or):
  un plato es incompleto si alguna línea tiene ingrediente needs_review O es no costeable
  (dimensiones distintas sin conversión en recipe_item_unit_conversion). Mismo criterio que
  kitchen_recipe_breakdown -> coherencia editor/listado. CRÍTICO: la primera versión SIN
  having devolvía TODOS los platos (true y false) y el cliente los metía todos en el Set ->
  95 platos "Revisar" (bug resuelto). Devuelve 15 platos incompletos.
- kitchen_raw_usage_counts(p_account_id uuid) — uso de cada ingrediente (nº de platos donde
  aparece), alimenta el orden "más usados" del buscador de alta (E2a). Verificado (Envoltorio
  54, Cebolla 36, Tomate 34…).

Hallazgo de implementación: al llamar un RPC no incluido en los tipos autogenerados, castear
PERO llamando como member-access de supabase!.rpc (no asignar a variable suelta) o se pierde
el this y el RPC devuelve vacío sin error. No silenciar con .catch(()=>({})). DEUDA:
regenerar tipos de Supabase y quitar los 3 casts (getRawUsageCounts, getDishesIncomplete,
child_needs_review en getRecipeBreakdown).

14.3 — Modelo de 4 estados del listado (decisión Julio 30/05)

"Revisar" debe ser SEÑAL, no ruido. Pintar todo needs_review en rojo encendería 145/215
platos (Coca-Cola incluida). Estados:
- validado (verde): tiene coste, sin sospecha activa, sin incompletos.
- revisar (ámbar) = ALARMA REAL: reviewNotes.kind='cost_suspect' Y needsReview sigue true
  (la nota se conserva como traza tras el dismiss, así que el kind por sí solo no basta),
  O el plato está en getDishesIncomplete.
- sin_validar (gris neutro): needsReview true sin diagnóstico accionable. Hoy no se ve (esos
  platos no tienen coste -> caen en sin_escandallo); queda como red de seguridad.
- sin_escandallo (gris): computed_cost null.
Recuento real (215 dishes activos): 34 cost_suspect, 60 validados, 121 sin escandallo
(incluye bebidas/combos sin coste). De 145 que habrían salido "Revisar" con la lógica vieja
-> 34 con señal real.

14.4 — Botón "Dar por revisado" + identidad operativa

dismissReview(id, reason, actorId): baja needs_review, registra review_dismissed_at/by/reason
(auditable), CONSERVA review_notes como traza. review_dismissed_by tiene FK a user_profiles.id.
La cuenta de pruebas "Folvy Interno" (00000000-...-0001) NO tiene fila en user_profiles (es el
id de cuenta/tenant, no de usuario) -> la FK rechazaba el UPDATE. Solución: dismissReview
reintenta con autor null si la FK falla. En PRODUCCIÓN Julio (bde73591...) y Pamela
(443422de...) SÍ tienen perfil -> review_dismissed_by se rellena bien. El fallback a null es la
conducta correcta para actores sin perfil (pruebas, sistema), no un parche temporal.

14.5 — Principios de producto NUEVOS (a respetar siempre)

1. SIEMPRE la mejor opción. No plantear alternativas inferiores; proponer directamente la
   correcta y explicar por qué.
2. NO mostrar la fuente de referencia (tspoon) ni referenceSource en la UI. Es un detalle de
   ESTA migración (Llorente29 venía de tspoon). Folvy es multi-cliente; los mensajes se
   construyen desde campos estructurados.
3. Los datos importados (sales, dishes, escandallos del 27-28/05) son ANDAMIAJE DE
   CONFIGURACIÓN: reales pero ya desfasados, sirven para montar y validar. Antes de producción
   se reemplazarán por una carga definitiva (manual o import más fiel). NO invertir esfuerzo en
   sanear datos que van a desaparecer.

14.6 — TRAMO PENDIENTE: 9 platos duplicados del import (NO tocar aún)

9 nombres de plato tienen DOS filas recipe_item (source=manual 27/05 vacía + source=import
28/05), y AMBAS tienen menu_item enlazados con ventas repartidas entre marcas distintas. NO es
basura archivable simple: consolidarlo bien exige reapuntar menu_items preservando ventas.
PERO, por el principio 14.5.3 (datos de configuración a reemplazar), NO merece cirugía fina
ahora. Documentado para resolver/descartar cuando llegue la carga definitiva. Platos:
Alitas Crispy Spicy, Double Smash Bacon Cheeseburger, Double Smash Cheeseburger, Falafel con
salsa de yogur (3 unidades), La Smash Brothers, La Triple, Smash Bacon Cheeseburger, Smash
Cheeseburger, Truffled Smash. (3 de ellos —Double Smash Cheeseburger, Smash Bacon, Smash
Cheeseburger— tienen las dos filas SIN escandallo pero CON ventas: les falta montar la receta.)

14.7 — Mejoras menores anotadas (no bloqueantes)

- La lista de platos NO se auto-refresca al volver del editor: tras "dar por revisado" hace
  falta F5 para ver el cambio en el listado. Mejora de UX pequeña.
- Tipos Supabase sin regenerar -> 3 casts acotados (ver 14.2).
- Bundle index > 500 KB (deuda conocida, code-splitting diferido).
- Aviso ACTIVO al "responsable de catálogo": el rol no existe (deuda de roles);
  notificationsService.ts actual es solo empleados. needs_review se marca pero no notifica.
  Apagado a propósito, no fingir que avisa.
- COMISIONES POR CANAL sin configurar: los 4 canales de un plato muestran FC/margen idénticos
  (incl. Shop/local, que no debería llevar comisión de delivery). Prerrequisito del latido
  predictivo G2.

14.8 — Commits de referencia (origin/main)

5c70fc2 pantalla escandallo · c80f097 lista L1 + navegación + panel responsive · 3aafe12 E1 ·
1dde910 E2a (RPC this + búsqueda tokens) · 7e301d2 docs §13 · 7cba703 §14-ejecución + bruto/neto
· 80b0a91 sistema de cierre · b39fde4 cierre.ps1 ASCII · b533db6 doc arranque ·
13a7874 capa needs_review completa + E2b.

14.9 — PASO 1 de la próxima sesión

Leer esta §14 + §0 (REGLA CERO) + folvy_v1_editor_escandallos_diseno.md.
Estado: FASE A del editor con E1, E2a, E2b y capa needs_review COMPLETAS.
Siguiente tramo natural: E3 = capa de merma completa (bruto + neto + % merma acoplados, Opción
B comprometida; ver bloque E1/E3 al final de la sección 1). Confirmar el orden con Julio antes
de arrancar.

Sección de estado — actualizada 30/05/2026. Mantener al día y COMMITEAR al cierre de cada tramo.

14.10 — PASO 1 REAL de la próxima sesión (PRIORITARIO, antes que E3)

PROBLEMA detectado al cerrar el 30/05: el cierre de sesión tardó ~1 hora. Inaceptable
si se hacen 2-3 cierres/día. Causas: (1) CONTEXTO desincronizado que estalló al cerrar
(reconciliar dos §14); (2) demasiadas rondas de elección A/B/C; (3) cierre paso-a-paso
con Julio de intermediario en cada commit/push (~10 turnos). El cierre en sí son 3
acciones / 5 min; el resto fue deuda y deliberación.

OBJETIVO: cierre en ~5 min, no 60. Acciones (hacer ANTES de arrancar E3):

1. Mejorar scripts/cierre-sesion.ps1 para que EJECUTE el cierre completo, no solo
   verifique. Que de corrido: detecte ficheros del tramo, npm run build, git add
   explícito, git commit (mensaje pasado como parámetro), git push — y solo se PARE si
   algo falla, mostrando el problema concreto. Julio lanza UN comando -> "CIERRE OK" o
   parada con causa. Convierte ~10 turnos en 1. Mantener los untracked de otra feature
   fuera automáticamente.
2. Regla nueva: el §14 del CONTEXTO se actualiza INCREMENTALMENTE al cerrar cada tramo
   pequeño (no acumular todo para el cierre final). Así el cierre no descubre sorpresas
   de desincronización.
3. Claude entrega el bloque §14 YA RESUELTO (mejor opción, sin rondas A/B/C) en cuanto
   se cierra el último tramo técnico. Julio solo revisa de un vistazo.

Tras esto (y solo tras esto), seguir con E3 (capa de merma bruto/neto completa,
Opción B; ver §14.9 y bloque E1/E3 al final de la sección 1).

14.11 - SESION 30/05 (tarde). Hecho:
- cierre-sesion.ps1 -> ejecutor con -DryRun (commit c0a1ef2, ya pusheado).
- E3 escandallos: columna recipe_item.default_waste_pct (NULL=desconocida,
  0=sin merma, >0=conocida) + 9 mermas reales sembradas (Tomate 4, Lechuga 24,
  Cilantro 20, Zanahoria 27.3, Parmesano 5, Albahaca 15, Pepinillos 10,
  Jamon Dulce 4, Calabacin 4). Cebolla/Lima NULL a proposito (merma por corte).
  kitchen_recipe_breakdown ampliada: +unit_id +child_default_waste_pct.
  RecipeEditorPage: neto editable + chip merma + override por receta +
  sugerencia IA (folvy-ai) + boton global "Sugerir mermas con IA" (1 llamada
  batch, solo huecos, guarda default, se apaga solo, coste decreciente).
- E5 foto plato: recipePhotoService.ts nuevo. Sube a recipe-uploads/
  {accountId}/dishes/, comprime cliente 1200px, guarda PATH (no URL) en
  kitchen_photo_url, URL firmada al render, borra anterior al cambiar.
- Last.app webhook Fase 2 DESPLEGADO: escucha tab:closed (venta definitiva),
  no llama API (products/bills embebidos), resuelve en memoria (logica
  backfill: orgProductId->catalogProductId->nombre), inserta sale+sale_line
  idempotente por external_ref=bill.id, valida token LASTAPP_WEBHOOK_TOKEN
  (secret creado). --no-verify-jwt. Responde 200 siempre.

PENDIENTE INMEDIATO (proxima sesion, primer punto):
- E5 visual: la foto sube/persiste OK pero el encuadre recorta el plato
  (h-150px + object-cover sobre foto 1:1). Decidir altura cabecera (simulador
  se quedo a medias). Solo CSS en el render, no toca servicio.
- Verificar webhook end-to-end: query sale source=lastapp,
  map_source='webhook', created_at>16:50 (estaba vacio, esperando tab:closed
  nuevo). 8 tab:closed del 30/05 (15:22-16:44) en log SIN procesar.

DEUDA ABIERTA:
- Regenerar src/types/database.ts (quita casts default_waste_pct +
  child_needs_review).
- resolve_lastapp_line fuera de control de versiones (reconstruir en migracion).
- Reprocesar los 8 tab:closed de hoy desde el log.
- Medidor coste IA por cuenta (prerequisito 2o cliente).
- Seguridad webhook: token va en authorization fijo, firma HMAC null
  (Last no firma). Token ya validado; revisar si pedir HMAC a Last.
- Corregir 1.1.A: el "Pending" NO era la causa (integracion privada, segun
  Last). El bug era de Last en eventos bill:*; tab:closed llega bien.
- code-splitting bundle 2.3MB.

COMMIT PENDIENTE (no bloquea, ficheros en disco y compilan):
.\scripts\cierre-sesion.ps1 -Message "feat(kitchen): E3 merma+IA, E5 foto plato; feat(lastapp): webhook Fase 2 tab:closed" -Add @("src/modules/kitchen/services/recipePhotoService.ts")

ROADMAP FIJADO: Bloque1 editor E4-E7 (E5 hecho, falta encuadre + E4/E6/E7) ->
Bloque2 dashboards margen -> Bloque3 motor consumo (venta x escandallo) ->
Bloque4 inventario teorico + formatos compra -> Bloque5 compras. G7 (foto->IA)
tramo estrella. G3 modificadores tras Bloque2. Metodo: benchmark antes de
disenar, paquete ficheros de entrada, BBDD primero, sin boton muerto, cierre
incremental. Principio rector: golear en cada campo o deuda explicita.

14.12 - SESION 30/05 (noche). COMMIT 18b24e5 pusheado (15 ficheros, 3624 ins).
Front desplegado a produccion via push (Vercel app.folvy.app). Webhook ya
estaba corregido en prod desde la tarde.

HECHO:
- E5 VISUAL CERRADO (funcional): cabecera del editor rehecha. Fuera la banda
  hero de 150px (decapitaba foto 1:1). Ahora cabecera COMPACTA con vida: foto
  96px (w-24 h-24) sobre bg-terracota-bg (toque calido), titulo + tipo/codigo +
  chips (IA/Revisar/Validado) al lado y legibles sobre claro, boton visible
  "Ver / cambiar foto", lightbox al pulsar la foto (estado photoLightbox, cierra
  con X o clic fuera). Decision de criterio (experto): no hero permanente en
  pantalla de costes (Apicbase pone la foto en pestana "Image" propia, no domina
  el area de trabajo); ni miniatura muerta sobre blanco. Punto medio.
- E5 ARREGLO LISTADO: KitchenRecipesPage mostraba la miniatura ROTA (hacia
  <img src={path}> con el path crudo; el bucket es privado -> no servible). Bug
  introducido por E5 (guardar PATH no URL). Arreglado: useEffect resuelve URLs
  firmadas en lote (getDishPhotoUrl, misma fuente de verdad del bucket) solo
  para platos con foto; estado photoUrls Record<id,url>.
- DEUDA VISUAL anotada (Julio, decidida posponer): la banda de cabecera sigue
  "sosa, sin alegria". NO retocar aislada -> hacerlo en la pasada de pulido de
  plantilla (E7) o cuando se toque la plantilla por otra cosa.
- LAST.APP webhook map_source: bug del CHECK constraint corregido (admitia
  'pos' ademas de unmapped/manual/ai/fuzzy; la funcion escribia 'webhook' que
  violaba el constraint). mapSourceFromVia(via): 'pos' (match id determinista),
  'fuzzy' (nombre), 'unmapped'. VERIFICADO en prod: 2 ventas nuevas entraron
  solas (Glovo 12,11; Uber 19,50), todas las lineas por_id. Julio decidio NO
  recuperar los 13 tab:closed perdidos del rato del bug (datos inutiles). NO se
  usaron API keys de Last/tspoon (innecesarias: el evento trae todo embebido).
  reprocess-webhook-log.mjs commiteado pero NO usado.
- E8 PASOS INTELIGENTES (tramo nuevo, absorbe E4). Diseno completo aprobado en
  folvy_e8_pasos_inteligentes_diseno.md. Es GOLEADA real: benchmark verifica que
  meez/Apicbase tienen los pasos como TEXTO MUERTO (no reconocen ingredientes,
  no avisan faltantes, no ordenan por elaboracion). El sector premium converge
  hacia "Cook Mode" con per-step ingredients = justo nuestro puente. Casi toda
  la inteligencia es GRATIS (matching de texto local), no IA.
  * E8.1 HECHO: tabla puente recipe_item_step_line (N:N paso<->linea). Cols:
    id, account_id (FK accounts CASCADE), step_id (FK recipe_item_step CASCADE),
    line_id (FK recipe_line CASCADE), created_at. UNIQUE(step_id,line_id).
    3 indices. RLS = patron EXACTO de recipe_line (belongs_to_account select;
    current_user_is_admin_or_manager_of insert/update/delete). 4 politicas. La
    tabla puente lleva account_id propio (recipe_item_step NO tiene account_id,
    cuelga de recipe_item_id) -> al insertar vinculo se aporta desde recipe_line.
  * E8.2 HECHO: types:gen regenerado (recipe_item_step_line tipada, deuda de
    database.ts SALDADA). Tipos en kitchen.ts: RecipeItemStep (+Insert/Update,
    SIN accountId; campo calculado lineIds:string[]) + Row* del paso y del
    puente. recipeStepService.ts nuevo: listStepsByRecipe (pasos+lineIds via
    join al puente, no N+1), createStep, updateStep, deleteStep, reorderSteps
    (reescribe position 0..n-1), setStepLines(stepId,lineIds,accountId)
    (sincroniza puente, idempotente por UNIQUE). Patron calcado de
    recipeLineService.
  * E8.3 HECHO: solapa "Receta" del editor deja de ser placeholder. Componente
    NUEVO RecipeStepsTab.tsx (la UI vive aqui, NO infla RecipeEditorPage; este
    solo cambia 2 lineas: import + render de la solapa). CRUD de pasos: crear,
    editar (texto/tiempo min/temp C, guarda onBlur), borrar (confirm inline),
    reordenar (flechas up/down, cero dependencias). DOS MODOS: VER (lectura,
    receta de corrido, mobile-first) y EDITAR (formularios). Por defecto: VER si
    hay pasos, EDITAR si vacio. Verificado en prod con 7 pasos reales.

PENDIENTE INMEDIATO (proxima sesion). ORDEN INNEGOCIABLE (Julio: que no se
pierda manana). Julio elige cual de los dos primero al abrir:
- R1 - RESPONSIVE DEL SHELL (PRIORITARIO). Capturas en movil/tablet (390-712px)
  muestran que el contenido se sale por la derecha y el SIDEBAR (Folvy Kitchen:
  Ingredientes/Recetas/Rentabilidad/Ingenieria) NO se colapsa. NO es de la
  solapa Receta: es el LAYOUT GLOBAL (Shell) el que no es responsive. Regla de
  Julio: toda la app debe verse en cualquier dispositivo (tablet = caso general
  de cocina, no un cliente concreto). TOCA EL SHELL/LAYOUT -> requiere PERMISO
  EXPLICITO de Julio (posible App.tsx, que NO se toca sin permiso). Diseno
  propio: colapso del sidebar, boton hamburguesa, breakpoints, verificar pantalla
  por pantalla. Pedir los ficheros de layout y verlos antes de tocar.
- E8.4 - RESALTADO EN VIVO + VINCULO (pieza central, CERO IA). Al escribir el
  texto del paso, matching de texto local (reusar normalize/matchesTokens de
  KitchenRecipesPage) detecta los ingredientes del escandallo (childName de
  RecipeLineBreakdown) y los resalta; al detectarlos crea/actualiza el vinculo
  via setStepLines. El resaltado PROPONE, Pamela MANDA (vinculo editable, chip
  con X). Esto LLENA el puente y desbloquea E8.5/E8.6.

ORDEN E8 (tras E8.4): E8.5 aviso faltantes (gratis, comparar 2 listas) ->
E8.6 orden-por-elaboracion del escandallo (absorbe E4: manual gana, luego
elaboracion, luego coste) -> E8.7 foto por paso (recipe_item_step.photo_url ya
existe; reusar recipePhotoService con subcarpeta {accountId}/steps/) -> E8.8
borrador IA de pasos (UNA llamada al pulsar boton, guardada, nunca en bucle) ->
G9 COOK MODE (slideshow servicio pantalla completa, un paso a la vez, timer por
paso, ingredientes por paso) - va DESPUES de E8.4 para nacer con ingredientes
por paso (no es deuda aparcada, es secuencia para no nacer cojo).

DEUDA VIVA (30/05 noche):
- ROTAR/REVOCAR: la service_role key y tokens que Julio pego en el chat hoy
  (seguridad). Aun pendiente.
- Barniz visual banda cabecera editor (con E7 / pulido plantilla).
- Medidor coste IA por cuenta (prerequisito 2o cliente, HIGH).
- code-splitting bundle ~2.4MB gzip 645KB (React.lazy).
- AI provider abstraction (dependencia total de Anthropic).
- processed=true del webhook = "handler corrio", no "inserto venta" (cosmetica).
- resolve_lastapp_line fuera de control de versiones.

DOCS NUEVOS: folvy_e8_pasos_inteligentes_diseno.md (diseno completo E8, aprobado).

---
Documento actualizado: 28 de mayo de 2026 (noche) — DISEÑO COMPLETO V1 EDITOR DE ESCANDALLOS cerrado conceptualmente (8 decisiones de producto + 5 catálogos semilla + reconocimiento BBDD + diagnóstico real de 34 needs_review con CSV + 12 hallazgos competencia mundial integrados + diseño UX completo del lienzo y todas las pantallas + 3 prompts sistema modos IA + decisión Modificadores M1-M4 al 100% con confirmación operativa de Last.app). Próximo: saneamiento de commits + S1 (schema migration) + S2 (UI banner needs_review) + S_MODIFIERS (parsing histórico + actualizar conector). Detalle UX completo en documento maestro nuevo `folvy_v1_editor_escandallos_diseno.md`. Esta es la sesión más densa del proyecto hasta la fecha en términos de decisiones de diseño.
Único documento de contexto. Próxima actualización: al cierre de la próxima sesión técnica (regenerar §1).

---

## SESIÓN 01/06/2026 — Portal del trabajador: acceso por enlace/QR + reskin home + inicio adaptativo + Drawer

Sesión de construcción real (no diseño). 4 commits, todos subidos a origin/main. Repo confirmado PRIVADO. Working tree limpio al cierre (sin nada a medias por primera vez en varias sesiones).

### PIEZA 1 — Acceso del trabajador por enlace/QR, SIN email (commit 17ec37c)
Objetivo de Julio (cumplido): el trabajador recibe su acceso por enlace/QR, sin depender de email, entra SIN teclear nada, y el encargado puede reenviarlo si lo pierde o cambia de móvil. Resuelve el bloqueo histórico "no sé entrar por no dejarlo bien al principio".
- `manage-employee/index.ts`: acción nueva `generate_access_link` (solo admin, CON verificación cross-tenant vía `location_id -> account_id`, igual patrón que grant_access). Llama a `admin.generateLink({type:'magiclink'})` SIN enviar correo y devuelve `hashed_token` (campo `tokenHash` en la respuesta). El token no se audita (es credencial).
- `employeeAuthService.generateAccessLink(employeeId)` (cliente).
- `AccesoTrabajadorPanel.tsx` (NUEVO, en components/personal): arma `${origin}/acceso?token_hash=...&type=magiclink`, lo pinta como QR (lib `qrcode`) + copiar enlace + reenviar. Enganchado en StaffPage en DOS sitios: tarjeta de éxito del alta + ficha del empleado.
- `AccesoClaimPage.tsx` (NUEVO, ruta pública `/acceso`): canjea con `verifyOtp({token_hash})` y navega a `/` (App.tsx enruta por rol).
- `App.tsx`: ruta pública `/acceso` (con permiso explícito de Julio).

### APRENDIZAJE CLAVE (acceso): magic link de servidor + PKCE
El cliente Supabase está en `flowType: 'pkce'`. Un magic link generado en SERVIDOR no tiene `code_verifier` en el navegador del trabajador → el canje estándar (detectSessionInUrl/exchange) FALLA y la app cae al login (pide email). SOLUCIÓN: la Edge Function devuelve el `token_hash` (no el action_link), y la pantalla `/acceso` lo canjea con `verifyOtp({token_hash, type})`, que NO depende de PKCE. BONUS: este método evita tener que tocar la allowlist de Redirect URLs de Auth.

### Decisiones de acceso (mercado + caso real)
- Modelo C1 sigue por debajo (usuario+contraseña, email sintético `@empleado.folvy.app`). El enlace es la vía CÓMODA de entrega; la contraseña sigue siendo credencial duradera; reenviar = regenerar token (`set_password` ya existía).
- Entrega MULTICANAL: QR para escanear + copiar-enlace para WhatsApp/SMS. EMAIL NO es canal (decisión de Julio: población de hostelería sin email o que no lo da).
- Mercado consultado (Factorial, 7shifts): el estándar es invitación por enlace donde el empleado fija contraseña. Se DESCARTÓ "que el trabajador cree usuario/contraseña" (rompe para hostelería: sin email, contraseñas olvidadas) y "que elija su usuario" (colisiones + el username está incrustado en el email sintético C1). El enlace mágico es MÁS simple que el estándar.
- PIN de kiosko intacto (vía rápida en dispositivo compartido del local; convive con el enlace al móvil personal).

### PIEZA 2a — Reskin del home del trabajador (commit 085a192)
`HomeEmpleado.tsx`: cabecera -> banda superior NAVY (`bg-accent`), saludo crema + nombre blanco Fraunces, campana y salir en círculos translúcidos. FUERA los gradientes (`from-emerald-*`, `from-accent`). Botones de módulo -> tarjetas planas (`bg-card` + borde) con icono en círculo de color (APPCC oliva, Mi Portal navy) + chevron. Sin tocar lógica/props/navegación.

### PIEZA 2b — Inicio adaptativo + fichar de primera clase (commit 3ea5b84)
El home "sigue el día del trabajador":
- `HomeEmpleado.tsx`: bloque de fichaje bajo la banda. SIN jornada -> botón terracota grande "Fichar entrada". CON jornada abierta -> tarjeta "Jornada en curso" + CRONÓMETRO VIVO (setInterval 60s + cleanup; `openSince` derivado de la entrada abierta más reciente via clockEntries) + "Entrada a las HH:MM" + "Fichar salida". Quitado el aviso redundante de la banda.
- `TrabajadorApp.tsx`: navegación home->fichar con estado `ficharOrigin: 'home'|'portal'`; el back del fichaje vuelve al origen correcto (preserva el flujo viejo portal->fichar->portal). `WorkerModule` ampliado a `'appcc'|'portal'|'fichar'`.
- Verificado en app: estado "sin fichar" se ve correcto (un solo bloque). El estado "fichado/cronómetro" NO se pudo ver en vivo por tres protecciones legítimas que se interpusieron (permiso GPS denegado, geofencing 200m fuera de zona, ventana de turno "faltan 44 min"). El render del cronómetro es código simple typecheck-verde; se verá el primer fichaje real. NO es deuda.

### DRAWER — ficha de proveedor en panel lateral (commit 42e8656)
`Drawer.tsx` (NUEVO, primer componente UI compartido): panel lateral derecho, overlay, cierre X/Esc/clic-fuera, scroll interno, bloqueo body scroll, full-screen en móvil, NO toca el Shell. `SuppliersPage.tsx` usa el Drawer para la ficha (patrón primary-detail, estándar de mercado: PatternFly/Linear/Notion/Stripe). Julio lo APROBÓ visualmente. Cierra una deuda que arrastraba varias sesiones.

### exitLabel "Volver a gestión" — NO era bug (deuda tachada)
Pamela es MANAGER (encargada dual). Escanea el QR -> entra a Gestión (correcto por rol) -> desde ahí accede como trabajador -> ve "Volver a gestión". Flujo correcto confirmado por Julio. La "deuda exitLabel" era falsa alarma. Idea futura NO comprometida: conmutador Gestión <-> Trabajador para encargados duales.

### Correcciones de suposiciones (verificadas contra código real)
- Geolocalización/GPS del fichaje YA EXISTÍA (`FichajeEmpleado.tsx`: radio 200m `RADIUS_M`, auto-selección de local más cercano, distingue entrada/salida via `nextClockType`, detecta jornada abierta). El diseño previo que la daba por "construcción nueva" estaba MAL.
- La MARCA del portal YA estaba aplicada (tokens reales); solo el home arrastraba gradientes.
- El manual `src/docs/trabajador/01-app-trabajador.md` (10/05) estaba DESACTUALIZADO; no es fuente fiable, el código manda.

### Git / repo
- `.gitignore` YA existía y bien hecho (cubre `*.xlsx`, `bills_*.json`, `catalogo_*.json`, `location_*.json`, `tspoon_*.csv`, `data/`, imports SQL). Verificado con `git check-ignore` + revisión de ficheros pesados: NINGÚN dato de cliente trackeado. El "bloqueante .gitignore + push" de notas viejas estaba YA resuelto.
- PUSH DESBLOQUEADO y hecho. Commits en origin/main: 17ec37c, 46adf56 (docs), 085a192, 3ea5b84, 42e8656. Local y remoto en sync.
- Dependencia nueva: `qrcode` + `@types/qrcode` (entró limpia). La vulnerabilidad high de `npm audit` es de `xlsx` (SheetJS), PREEXISTENTE, no de qrcode.

### Docs
- `docs/folvy_portal_trabajador_diseno.md`: reescrito contra código real (Pieza 1 cerrada; geolocalización ya existía; marca ya aplicada; mensajería = bandeja de avisos no chat; biometría NO por AEPD).
- `folvy_e8_pasos_inteligentes_diseno.md`: movido de raíz a `docs/`.

### DEUDA VIVA al cierre de esta sesión
- `.vite/` debería ir al `.gitignore` (caché regenerable que está trackeada).
- `xlsx` (SheetJS): vulnerabilidad high preexistente (Prototype Pollution + ReDoS), sin fix upstream. Migrar/aislar.
- Resto del portal del trabajador (no construido aún): navegación por bottom-tabs, bandeja de avisos (verificar lógica missed-punch antes), PWA instalable.
- ROTAR/REVOCAR service_role key y tokens pegados en chats (seguridad; sigue pendiente de antes).
- De antes, no tocado hoy: E8.4 (resaltado en vivo + vínculo), R1 (responsive del Shell), medidor coste IA por cuenta, code-splitting, AI provider abstraction.

DOCS NUEVOS/ACTUALIZADOS esta sesión: docs/folvy_portal_trabajador_diseno.md (actualizado), docs/folvy_e8_pasos_inteligentes_diseno.md (movido).

---

## SESIÓN 01/06/2026 (CIERRE) — Bottom-tab bar completa + seguridad cerrada

Continuación de la sesión del portal del trabajador. Cierre de dos cosas que quedaban abiertas.

### Bottom-tab bar del portal del trabajador — COMPLETA (Parte A + Parte B)
Navegación móvil por pestañas, modelo HIG/Material sin compromisos. 4 destinos: **Inicio · Fichar · Tareas · Más**.
- **Parte A (commit ff6ac68):** componente `src/components/trabajador/BottomTabBar.tsx` (NUEVO, barra inferior fija, max-w-md centrada, `safe-area-inset-bottom`, tab activo en navy, componente "tonto" que emite `onSelect`; prop `showTareas` para ocultar el tab). Montado en el home con `goToTab` + `pb-20`.
- **Parte B (commit 08c0354):** la barra PERSISTE en los destinos de primer nivel.
- **CONTRATO definitivo (regla única, sin casos especiales):** destino navegable = barra abajo + SIN flecha-atrás (Inicio, Tareas, Más); pantalla de foco = flecha-atrás + SIN barra (ejecutar checklist, subpáginas del portal, bolsa). Nunca conviven flecha y barra.
- **Implementación limpia:** la flecha de `PortalEmpleado` y `MisChecklistsPage` solo se renderiza si reciben `onBack` (ahora opcional). El orquestador monta los destinos raíz SIN `onBack` (-> sin flecha, con barra) y los profundos CON `onBack` (-> flecha, sin barra). El contrato es el propio prop, sin flags ad-hoc.
- **Fichar = tab de ACCIÓN** (no sección navegable): se abre a pantalla completa, con flecha para cancelar, sin barra; al terminar vuelve a Inicio (patrón cámara/compose de Instagram/WhatsApp). Por eso `FichajeEmpleado` NO se tocó.
- `showAppccTab`: `TrabajadorApp` consulta `appcc_schedules` activos (mismo criterio que HomeEmpleado) para ocultar el tab "Tareas" si el local no tiene APPCC. Sustituye el provisional `appccPendingCount >= 0` del home.
- Ficheros: `BottomTabBar.tsx` (nuevo), `TrabajadorApp.tsx`, `PortalEmpleado.tsx`, `MisChecklistsPage.tsx`. Verificado en app los 4 estados (Inicio/Tareas/Más con barra sin flecha; Fichar y subpáginas con flecha sin barra; pb-20 no tapa la lista larga del portal).
- APRENDIZAJE: `appccPendingCount` (ejecuciones del día) y `showAppcc` (¿local tiene APPCC?) son señales DISTINTAS. Para ocultar el tab hay que usar `appcc_schedules`, no el contador.

### Seguridad — service_role key ROTADA (deuda CERRADA)
Julio rotó la service_role key. Verificado que las Edge Functions siguen funcionando con la nueva (el enlace de acceso de trabajador se sigue generando -> `manage-employee` coge la clave nueva del entorno automáticamente). No hay más tokens vivos por revocar. La deuda recurrente "ROTAR/REVOCAR service_role y tokens pegados en chats" queda CERRADA el 01/06.

### .vite/ des-trackeado (commit d4d334f)
`.vite/` (caché de Vite, regenerable) estaba trackeado -> añadido al `.gitignore` + `git rm -r --cached .vite` (14 ficheros fuera, ~71k líneas de caché; siguen en disco). Higiene de repo.

### Estado git al cierre
Todos los commits de la jornada subidos a origin/main: 17ec37c (acceso QR), 46adf56 (docs), 085a192 (reskin home), 3ea5b84 (adaptativo), 42e8656 (Drawer), 45e2007 (contexto 01/06), d4d334f (.vite/), ff6ac68 (bottom-bar A), 08c0354 (bottom-bar B). Local y remoto en sync. Working tree limpio.

### DEUDA VIVA tras el cierre
- `xlsx` (SheetJS) vulnerabilidad high preexistente sin fix upstream. Migrar/aislar.
- Resto del portal: bandeja de avisos (verificar lógica missed-punch antes), PWA instalable.
- De antes, no tocado: E8.4 (resaltado en vivo + vínculo, pieza central editor escandallos), R1 (responsive del Shell, PRIORITARIO), medidor coste IA por cuenta (HIGH, prerequisito 2º cliente), code-splitting, AI provider abstraction, 34 platos needs_review.

NOTA DE MANTENIMIENTO DEL CONTEXTO: la copia de CONTEXTO_CLAUDE.md del proyecto (knowledge) puede ir por detrás del fichero real del repo. El fichero VERDADERO es `C:\dev\llorente29-app\CONTEXTO_CLAUDE.md` (versionado en git). Al regenerar, partir del repo, no de la copia del knowledge.
---

## SESIÓN 01/06/2026 (CIERRE 4) — R1 cerrado + SISTEMA DE DISEÑO de Folvy Kitchen

Dos partes: (A) se cerró R1 responsive de verdad; (B) sesión larga de diseño que fija el
lenguaje visual y de información de TODO el módulo Kitchen, con benchmark mundial.

### A — R1 RESPONSIVE: CERRADO Y EN PRODUCCIÓN
Quedaban dos defectos de contenido (el marco del Shell ya era responsive desde el 31/05):
- `KitchenItemsPage.tsx`: la tabla de Ingredientes a <768px metía scroll horizontal y ocultaba
  "Coste computado". Arreglo: `useIsMobile()` → en móvil **tarjetas apiladas** (patrón clonado de
  `KitchenProfitabilityPage` R1.4), escritorio idéntico.
- `RecipeEditorPage.tsx` (9 ediciones puntuales ancladas): nombre de línea **envuelve** en móvil
  (no se aplasta), **barra decorativa de coste oculta** en móvil, **papelera y "+merma" visibles
  en táctil** (no dependen de hover), **solapas con scroll horizontal** (Histórico/Más no se
  cortan), **badge Validado/Revisar** no se corta (cabecera con flex-wrap + min-w-0).
- Commit `b1f72cf` en `origin/main` (push hecho, `5bc27e1..b1f72cf`). `tsc -b` + Vite limpios.
- ENCUADRE HONESTO (regla nº2): R1 = **paridad** (dejar de perder por desbordamiento), NO goleada.
  La goleada va encima (editar en tablet donde meez solo deja ver, estados didácticos, Cook Mode G9).
- Deuda cosmética menor: `pl-[88px]` del panel de merma queda algo metido en móvil estrecho.

### B — SISTEMA DE DISEÑO Y BENCHMARK DEL MÓDULO KITCHEN

**Doc nuevo:** `folvy_kitchen_benchmark_y_plan.md` (en outputs; subir a knowledge + docs/).
Benchmark verificado el 01/06 en webs/docs oficiales de Apicbase, meez, R365, Galley + gstock/tspoon
del proyecto. Tesis de goleada (resuelve la tensión del 16/05 "Cocina suficientemente buena"):
NO se gana out-featureando a gstock en back-office clásico; se gana **cambiando el eje** — toda la
categoría calcula coste TEÓRICO / varianza AvT; Folvy ya tiene **11.894 tickets reales + escandallo
validado al céntimo + comisiones por marca×canal (Capa 2)** → vende **margen REAL por mezcla de
ventas real, a nivel de modificador, por marca y canal**, con **fricción de arranque casi-cero**
(foto→IA sobre datos ya unidos) y **honestidad** (no inventa costes). Plan en 8 fases K1–K8 con gate
de benchmark por pieza. Table stake que HOY falta: **alérgenos + nutrición automáticos** (K6).

**Análisis de tspoon (10 pantallas reales del incumbente de Llorente29):**
- RESPETAR: el modelo mental español (Productos → Herramientas → Elaboraciones Intermedias →
  Finales → Agrupaciones) y el idioma del operador. Validan la arquitectura de coste de Folvy:
  "Cálculo del precio = Último precio de compra" (= `last_purchase`), conversión "1 Bote = 0,85 Kg"
  (= `recipe_item_unit_conversion`), "Cálculo del coste = Del detalle".
- SUPERAR: sobrecarga (15+ acordeones, formularios de edición de 20+ campos en modales gigantes),
  estados vacíos desperdiciados (tutoriales de YouTube en el panel principal), listas planas.

**SISTEMA DE DISEÑO FIJADO (patrón único, válido para TODO Kitchen):**
1. **Shell**: top nav (Inicio/Team/Safety/Sales/Kitchen) + **sidebar izquierdo** del módulo
   (Resumen/Ingredientes/Proveedores/Recetas/Rentabilidad/Ingeniería).
2. **Hero cálido** (`bg-terracota-bg`) = identidad de la entidad: foto/icono + nombre (Fraunces) +
   tipo + estado (Validado/Estrella) + acción.
3. **Pestañas** = divulgación progresiva (Escandallo/Receta/Etiquetado/Histórico). Adiós a los
   modales de 20 campos de tspoon: el alta serán 3 campos + foto→IA.
4. **Dos columnas**: izquierda = el trabajo (composición / proveedores / artículos); **derecha =
   PANEL NAVY "EN VIVO"** = verdad económica de la entidad, siempre en el mismo sitio. Es el SELLO
   del módulo (viene del editor real ya en producción).
   - Receta → coste total + food cost + distribución + margen real por canal (con semáforo).
   - Artículo → coste por unidad base + estrategia + "usado en N platos" + última compra.
   - Proveedor → compras del mes/año + último pedido + próxima entrega.
5. **Honestidad** ("sin terminar"), **IA donde aporta** ("Sugerir mermas IA"), **didáctica**.

**REGLA DE INTERACCIÓN (todo el módulo):** TODO es clicable → lleva a su sección ya filtrada.
Ver un dato y profundizar a un clic (KPIs, filas, chips, segmentos de barra, marcas, canales).

**ÁMBITO / FILTRADO (jerarquía de Julio):** selector **Negocio → Ubicaciones → Marcas** en la
cabecera (Llorente29 → Alcalá/Pza Castilla/Carabanchel → Smash Brothers/Lobbers/Cloudtown). Scopea
toda la app de forma consistente y persiste entre sesiones. Distinción clave a mostrar en UI:
- COMPARTIDO del negocio (no cambia al filtrar por ubicación): definición de receta/escandallo,
  catálogo de ingredientes, "recetas sin terminar", coste (salvo que el proveedor cobre distinto
  por local).
- POR UBICACIÓN/MARCA (sí cambia): ventas, margen real, food cost, ingeniería de menús.
- PENDIENTE (golpe multi-local): vista "comparar ubicaciones" (los locales lado a lado, marcando
  el que se desvía). Ningún incumbente español lo enseña bien.

**FICHA DE RECETA — PATRÓN DEFINITIVO (validado por Julio):**
- Hero cálido: foto + nombre + chips Estrella (con popularidad "1.240 uds/mes · +8%" que la gana)
  + Validado.
- Banner "Importar receta (foto/PDF)": una subida → la IA rellena **ingredientes (pestaña
  Escandallo) Y pasos (pestaña Receta)**, todo como borrador `needs_review`. La IA PROPONE, el
  cocinero MANDA.
- Estado honesto arriba ("1 ingrediente sin coste → tu coste real podría ser mayor").
- Izquierda: composición con **% de coste por línea**, top primero, "+N más" plegado, "sin
  terminar" honesto, enlace "Receta · 7 pasos", alérgenos (recuperados, legal).
- Derecha: **PANEL NAVY COSTE EN VIVO** = coste total + chip food cost (semáforo) + barra de
  distribución del coste + MARGEN REAL POR CANAL (Local/Glovo/JustEat/Uber con € y % semaforizados)
  + insight accionable ("Local rinde casi el doble que delivery — promociona retirada").

**DASHBOARD DE KITCHEN ("Resumen", primer ítem del sidebar) — PATRÓN FIJADO:**
- Barra de ámbito Negocio→Ubicaciones→Marcas + periodo.
- Empuje didáctico arriba ("Empieza por aquí: 12 ingredientes sin coste...").
- Tira navy de KPIs: food cost medio, margen medio, **margen del mes en €** (sobre ventas reales),
  platos·ingredientes.
- "Necesita tu atención" (el corazón): ingredientes sin coste, recetas sin terminar, platos sobre
  food cost objetivo, subidas de precio (con nº de platos afectados = cascada visible), platos sin
  alérgenos, sin foto. Ordenado por severidad. Cada fila → su lista filtrada.
- Salud del food cost (verde/ámbar/rojo), ingeniería de menús (estrellas/puzzles/vacas/perros),
  margen por canal, por marca (dark kitchen nativa), movimientos de precio 7 días.
- **Lenguaje de color ÚNICO con leyenda**: verde=sano · ámbar=ajustado · rojo=pierde ·
  azul=oportunidad. Mismo significado en todo el módulo.
- Nota de ámbito (compartido vs por ubicación/marca).

### DEUDA DE DISEÑO DECLARADA (autocrítica honesta, no esconder)
- Las maquetas son a **680px (el visualizador), NO especificaciones**. El Kitchen real es pantalla
  ancha con sidebar izquierdo; proporciones, ancho del panel navy y grid del dashboard hay que
  **rehacerlos a los breakpoints reales**. El lenguaje vale; las medidas no se dan por buenas.
- **Datos mock**: margen por canal, "Estrella", 18.400 €/mes, etc. son placeholder. NO anclarse:
  el margen real por canal a nivel de modificador es **K7, pendiente**. Marcar mock agresivamente.
- **Contraste en navy (modo oscuro)**: vigilar el texto secundario y los % de color sobre navy en
  el build real con los tokens Folvy.
- **Validar con usuario real (Pamela) con datos reales ANTES de más maquetas.** Una séptima
  maqueta vale menos que ver si "entra por los ojos" a quien la va a usar. (Principio rector nº2:
  se mide sobre datos reales, no de laboratorio.)
- Posible exceso de densidad en el dashboard: si pesa, plegar los bloques inferiores (canal/marca/
  precio) en un "ver más".

### PENDIENTE DE DISEÑO (próximas pantallas)
- Flujo **Importar receta → foto → IA** (ingredientes + pasos) — mayor golpe de comodidad.
- **Lista de Recetas** (catálogo con foto + coste + margen + Estrella de un vistazo).
- **Alta de ingrediente en 3 pasos** (matar el formulario gigante de tspoon).
- Vista **comparar ubicaciones** del dashboard.

DOCS NUEVOS: `folvy_kitchen_benchmark_y_plan.md` (benchmark + plan K1–K8 + sistema de diseño).
---

## SESIÓN 01/06/2026 (CIERRE 5) — Dashboard de Kitchen + ECONOMÍA DE PLATAFORMAS DE DELIVERY

> Continuación tras el CIERRE 4. Dos frentes que NO quedaron registrados en su momento (recuperados
> el 02/06 al revisar los transcripts): (A) el dashboard "Resumen" de Kitchen construido; (B) el
> descubrimiento y diseño completo de la Economía de Plataformas de Delivery. El segundo es el frente
> estratégico más grande abierto del proyecto.

### A — DASHBOARD "RESUMEN" DE KITCHEN (construido, EN PROD LOCAL, SIN COMMIT)

**D1 — `kitchenDashboardService.ts`:** agregador a nivel cuenta, SOLO LECTURA. Reutiliza los services
reales (`menuEngineeringService`, `costCascadeService`, `recipeItemService`, `menuItemService`); NO
reinventa el cálculo. Declara honestamente lo que aún no tiene fuente. `costCascadeService` es
recálculo de coste, NO histórico de precios (confirmado al leer el fichero).

**D2 (a/b) — `KitchenDashboardPage.tsx` + ítem en `module.tsx`:** la página "Resumen", primer ítem del
sidebar de Kitchen. Tira navy de KPIs (food cost medio, margen medio, margen del mes €, platos·
ingredientes) + "Necesita tu atención" + salud food cost + ingeniería de menús + margen por canal/marca.
Construido sobre el sistema de diseño del CIERRE 4.

**Contrato de color (todo Kitchen):** navy de marca = token **`accent`** (#1E3A5F). Verde=sano,
ámbar=ajustado, rojo=pierde, azul=oportunidad. Leyenda única en todo el módulo.

**Diagnóstico K1 (cerrado):** el motor de coste está SANO. Los ~120 platos sin coste son **cáscaras
vacías** (sin `recipe_line`), NO un bug del motor; cero platos con líneas que den coste 0. El invariante
`SUM(line_cost)=computed_cost` se mantiene. Los 144 needs_review / 120 sin coste son datos desechables
que se resuelven solos al cargar los datos definitivos. No se tocó nada (rellenar a mano = tirar trabajo).

**Hallazgo del periodo:** las ventas reales van de **nov-2025 a may-2026**; junio (mes en curso) está
vacío → el KPI "margen del mes" salía 0 € por mirar el mes natural actual. El mapeo venta→`menu_item`
es >99% sano (líneas sin `menu_item_id`: 6/38/36 frente a miles). La cadena venta→margen SÍ cierra;
solo el periodo por defecto caía en un mes vacío. DECISIÓN PENDIENTE: periodo por defecto del dashboard
(ventana móvil de 30 días en vez de mes natural).

**⚠️ ESTADO GIT:** D1 NO se commiteó (criterio: un service sin consumidor no aporta valor verificable;
mejor un commit que cierre unidad con sentido = service + página). Se iba a commitear D1+D2 juntos al
ver el dashboard funcionando, pero la sesión saltó al descubrimiento del margen falso y la economía.
**El dashboard quedó EN PROD LOCAL, SIN COMMIT.** Verificar al retomar si se consolidó después.

### B — ECONOMÍA DE PLATAFORMAS DE DELIVERY (descubierta y diseñada — gran frente estratégico)

**El disparador:** el dashboard mostraba **81,2% de margen IDÉNTICO en los 4 canales** = falso. Causa raíz
verificada en BBDD: (1) `brand_channel` **VACÍA** (0 filas; `default_commission_pct` de `sales_channel`
también null en los 4 canales Glovo/JustEat/Uber/Shop) → la RPC no tiene comisión que restar → margen
bruto idéntico; (2) `menu_item`↔`recipe_item` sin enlazar en estos datos → coste "—". **Las RPC funcionan;
falta el dato.** Julio rechazó la salida fácil ("dejarlo honesto y ya") y exigió CERRAR el tema
construyendo la herramienta de gestión de comisiones, no metiendo datos desechables. Y advirtió: "una
comisión marca-plataforma es mucho más que el 30%".

**Análisis con FACTURA REAL de Glovo** (Meraki Pita, 01–15 may 2026; PDF + Excel `invoice-200342777943.XLSX`,
48 pedidos), cruzada al céntimo (cuadran: tasa de acceso 99,44 € · recargo Prime 18,00 € · Productos
1.190,40 €). **La comisión NO es un % plano.** Tiene DOS naturalezas que no se deben mezclar:
- **Por PEDIDO** (varían pedido a pedido): comisión % sobre productos, servicio de entrega (−3,00/−4,50 €),
  recargo Prime (0,75 € en pedidos Prime), promoción producto asumida por partner (en 8 de 48 pedidos),
  promoción oferta flash a cargo del partner, coste de incidencias (−32,27 € total), recargo por mínimo.
- **Mensual del CANAL** (no por pedido): tasa de acceso a plataforma (99,44 €), tarifa recurrente (10 €),
  tarifas de oferta flash (162,07 €), + **IVA 21 % aparte** (60,79 €).

**Mapa de fuentes DEFINITIVO (verificado contra `sale`/`raw_products` reales):**

| Dato | Fuente | Cómo |
|---|---|---|
| Venta, PVP, productos, modificadores, combos | **Last** (`sale` + `raw_products`) | ya se lee |
| Descuento/oferta por línea + concepto + promotionId | **Last** (`raw_products`) | ya está, hay que parsearlo |
| Transporte cobrado al cliente | **Last** (`delivery_cost`) | ya está |
| Incidencias/devoluciones | **Last** (`refund_amount`) | ya está |
| **Comisión de plataforma (fija)** | **Capa A** (configurar) | el único config manual de verdad |
| **Comisión oferta flash (Glovo)** | **Deducción/cálculo** | regla de plataforma, no dato a meter |
| **Prime / tarifa de uso / acceso** | **Factura mensual (Capa B)** | importar |
| **Coste real transporte propio** | **Catcher** (4ª integración) | integración futura, por distancia |

Cruce confirmado entre fuentes: pedido `ca666b7e` → `discount_amount`=6,54 € en Last = "Promoción producto
asumida por partner" 6,54 € en Excel; otro pedido `delivery_cost`=4,5 = "Servicio de entrega −4,5" en factura.

**FÓRMULAS DEMOSTRADAS al céntimo con el pedido real `101643741487` (abierto en el portal de Glovo):**
- Subtotal 21,80 € · envío +3,00 € · descuento financiado por ti −6,54 € · **comisión −2,29 €** · impuestos
  −0,48 € · **ganancias 15,49 €** · método "Entrega gestionada por el Partner" (= reparto propio).
- **Comisión = % × (PVP − descuento financiado por ti)**, NO sobre PVP bruto: 2,29 = 15% × 15,26, donde
  15,26 = 21,80 − 6,54. ⚠️ CORRIGE el cálculo del margen — es regla general, no solo flash.
- El envío que la plataforma cobra/abona es **NEUTRO** (te lo abonan): +3,00 € entra; tu coste real de
  reparto propio es **Catcher**. No confundir (evita doble conteo).
- "Impuestos −0,48 €" = IVA 21% de la comisión (0,48 = 21% × 2,29). El portal lo resta, pero **se compensa**
  (soportado↔repercutido) → FUERA del margen real.
- Cuadre: 21,80 − 6,54 − 2,29 − 0,48 + 3,00 = **15,49 €** ✓✓.

**IVA (decisión de Julio):** el margen se calcula SIEMPRE sobre bases SIN IVA. Tipos que conviven: venta
de comida 10% (tipo reducido hostelería, `menu_item.vat_rate` default 10), comisión/tasas de plataforma 21%.
Repercutes al 10%, soportas al 21% — no se anulan al mismo tipo, pero ambos van a la liquidación y el neto
se compensa en caja → para el MARGEN el IVA es neutro y desaparece; para TESORERÍA (Capa B) se registra por
su tipo. Pregunta abierta P1: ¿la comisión % se aplica sobre PVP con o sin IVA?

**OFERTA FLASH Glovo (regla del portal, parcialmente cerrada):** para clientes nuevos o inactivos +60 días;
modelo coste-por-pedido; Glovo aplica su **comisión normal (15%) DESPUÉS de quitar el 30% de descuento al
cliente**. ⚠️ **HILO A MEDIAS (aquí se cortó la sesión 01/06):** la factura de mayo NO tiene flash desglosado
por pedido (columnas "Tarifas de oferta flash" y "Promoción flash a cargo del partner" a 0 en las 48 filas;
solo aparecen agregadas en el PDF: 162,07 € + 283,71 €). Los 8 pedidos con promo de esa factura son
"Promoción producto asumida por partner" (descuento cofinanciado normal, NO flash). Julio iba a subir OTRA
factura que SÍ tiene flash desglosado (la última: 260,13 € tarifas flash + 472,23 € promo flash partner) y
Claude iba a localizar los pedidos flash concretos (Código de Glovo) para cerrar la mecánica al céntimo
cruzándolos con Last. **PENDIENTE: retomar con esa factura.**

**MODELO EN 3 CAPAS** (documento de diseño `folvy_economia_plataformas_diseno.md`, v1, en outputs — subir a
knowledge + docs/). Mismo método que el editor de escandallos: diseño aprobado antes de tocar BBDD.
- **Capa A — config de comisiones → margen teórico por plato.** Tarifa por **(marca × canal × tipo de
  reparto)**. Tabla NUEVA `brand_channel_rate` (hija de `brand_channel`): `service_type` CHECK
  ('platform_delivery'|'own_delivery'|'pickup'), `commission_pct`, `commission_fixed`, `commission_base`
  ('pvp_con_iva'|'pvp_sin_iva'), `est_delivery_fee`, RLS, UNIQUE(brand_channel_id, service_type).
  `brand_channel` se mantiene como cabecera. **Es lo que ENCIENDE el margen real del dashboard hoy.** La RPC
  `menu_item_economics` (SECURITY DEFINER) ya devuelve `commission_pct/amount/fixed`, `delivery_fee`,
  `revenue_share_pct`, `net_margin` — fue diseñada para esto; solo le falta el dato y leer por tipo de reparto.
- **Capa B — economía del canal → P&L real desde la factura.** Tablas NUEVAS `channel_invoice` +
  `channel_invoice_line` (concept/concept_kind/amount_base/amount_vat/`external_order_id`/meta jsonb).
  Importar la factura (manual → IA/parser). `external_order_id` = llave que enlaza con `sale` para Capa C.
- **Capa C — reconciliación AvT (la corona).** Función/vista que cruza margen teórico (Capa A × ventas
  reales) contra pago real (Capa B) → "dónde se fuga el margen" por concepto. "Nadie lo tiene" (a verificar
  con benchmark web: Deliverect/Otter/Nory/MarginEdge — marcado como afirmación a auditar, no vendida como
  goleada sin comprobar).
- **Plan:** EP1 (Capa A) → EP2 (Capa B) → EP3 (Capa C) → EP4 (visión).
- **Las cedidas (Cloudtown):** `brand_licensing_agreement` ya cubre revenue share + reembolso de consumos;
  la RPC ya ramifica por `flow_type='licensed'`. Preguntas P2/P3/P4 abiertas (quién asume la comisión, base
  del revenue share, cómo entra el reembolso de consumos).

**VISIÓN (Julio, EP4, no en este cierre):** el envío propio depende de la distancia y lo hace **Catcher**;
las ofertas son variables y compuestas (2x1, 30% en un plato, flash 50%=30% cliente+comisión Glovo). La
forma realista NO es configurar tarifas a mano sino **conectarse y EXTRAER** de Glovo/Uber/JE/Catcher, y el
gol definitivo es **hacer las ofertas EN Folvy y publicarlas a las plataformas** (Fase 2 bidireccional del
conector TPV). La config manual (Capa A) queda como fallback. Esto reescribe la tesis: de "tabla de
comisiones" a "conector de economía de plataformas + logística".

**PREGUNTAS ABIERTAS P1–P6** (cerrar antes de construir EP1, en el doc): P1 base de comisión con/sin IVA ·
P2 quién asume la comisión en cedidas · P3 revenue share sobre qué base · P4 reembolso de consumos · P5 tipos
de reparto y % por plataforma · P6 alcance del cierre (¿EP1 solo?).

DOCS NUEVOS: `folvy_economia_plataformas_diseno.md` (modelo 3 capas, v1).

---

## SESIÓN 02/06/2026 — Marca y comunicaciones (web pública + correo + HubRise). NO toca repo/BBDD.

> Jornada NO técnica. Tres entregables cerrados + corrección del nombre del CEO. La app no se tocó:
> sigue en el estado del 01/06 (dashboard sin commit, economía en diseño). Detalle autónomo en el doc
> `CIERRE_SESION_2026-06-02.md` (outputs).

### CORRECCIÓN DE DATO
El CEO es **Julio Gª Colón (García Colón)**, no "Julio Gascón" (error arrastrado desde el inicio).
Corregido en §2 y §1.0. Usar en firmas/correos/documentos formales.

### 1 — WEB PÚBLICA folvy.app (PUBLICADA Y OPERATIVA)
- 7 páginas HTML bilingües EN/ES, logos reales, mismo sistema de diseño (navy #1E3A5F / terracota #D67442 /
  cream #F5F4F0, Fraunces + Plus Jakarta Sans): **index** (home, mercado partido, "Profundiza" con 5
  tarjetas), **margen-real** (waterfall 81%→58%, economía por canal, 4 audiencias), **kitchen** ("del
  albarán al margen", stepper, escandallo, matriz ingeniería), **compras-inventario** (Disponible +
  Próximamente), **ia-equipo** ("un día con Pamela"), **auditoria-visual** (exclusivo: foto plato→IA→
  semáforo), **plataforma** (roadmap).
- **Repo `Llorente29/folvy-landing`** — SEPARADO de `llorente29-app`. 8 ficheros (7 .html + `vercel.json`)
  en la raíz. **Proyecto Vercel `folvy-landing`** (Root raíz, Framework Other, auto-deploy). Dominio
  `folvy.app` apex ya estaba ahí. `vercel.json`: `{"cleanUrls":true,"trailingSlash":false}` → sirve
  `/kitchen`, `/margen-real`… sin `.html`. Enlaces internos sin `.html`.
- BUG arreglado: hero a medio animar (título cortado/solapado) → fix global en las 7 páginas
  `.phero .reveal,.hero .reveal{opacity:1!important;transform:none!important}`. Stepper kitchen a fondo claro.
- Navegación arreglada: nav con dropdown "Producto ▾" (6 páginas) + hamburguesa móvil (#mobileMenu) +
  "Profundiza" (5 tarjetas). Ninguna página huérfana.
- **Cifras de escaparate** (MARKETING, defendibles, NO extracción 1:1 de BBDD): 312.000 €/mes (Alcalá 118k/
  Pza Castilla 104k/Carabanchel 90k); canal Sala 96k/Glovo 82k/Uber 71k/JustEat 63k; ~16.800 pedidos, ticket
  18,40 €; contribución 108.000 € (34,6%); FC medio 29,4%, margen 62%; margen real por canal Local 68/JustEat
  52/Glovo 41/Uber 38; marca Smash 64/Lobbers 58/Cloudtown 44; waterfall 81% − 18 comisión − 4 promos − 1
  packaging = 58%.
- CABO SUELTO: **`www.folvy.app` → DNS_PROBE_FINISHED_NXDOMAIN** (subdominio www sin registro; `folvy.app` a
  secas SÍ funciona). Arreglo: Vercel → folvy-landing → Settings → Domains → Add `www.folvy.app` → redirección
  al apex. (Opcional) optimizar peso (logos base64 → archivos).

### 2 — CORREO @folvy.app (OPERATIVO)
- Dominio en **OVH**. El MX Plan gratuito solo hacía redirecciones. Google Workspace DESCARTADO: la cuenta
  `jgcolon@idasal.com` es **G Suite legacy free** (edición antigua gratuita) → no deja añadir folvy.app ni
  como dominio secundario ni alias, ni "Enviar como" SMTP externo por defecto. [Callejón sin salida: no repetir.]
- SOLUCIÓN: contratado **OVH MXPLAN 5** (Activo 02/06, ~5 €+IVA = **6,05 €/AÑO**, 5 cuentas, webmail Roundcube,
  DKIM). Buzones reales: **`hello@folvy.app`** y **`partners@folvy.app`** (contraseñas las tiene Julio).
  `postmaster@folvy.app`→`jgcolon@idasal.com` se deja intacto.
- Servidores OVH (Gmail/móvil): SMTP `ssl0.ovh.net:465 SSL` · IMAP `:993 SSL` · POP3 `:995 SSL` · usuario =
  dirección completa.
- Julio reportó "ya funciona" (envío). PENDIENTE: confirmar prueba real (enviar+recibir test) y, si quiere
  todo en su bandeja de Gmail, terminar config (recibir POP3 / "Enviar como" SMTP).
- NO confundir con Resend (§3): Resend con `no-reply@folvy.app` es el correo TRANSACCIONAL de la app; los
  buzones `hello@`/`partners@` son correo humano/comercial. Conviven (MX del dominio en OVH, correcto para ambos).

### 3 — CORREO A HUBRISE (ENVIADO)
- HubRise (middleware FR, Sophia Antipolis): conecta TPV/online ordering/plataformas; programa de partners
  marca blanca, modelo reventa (el partner crea/gestiona cuentas a nombre del cliente y factura con margen),
  precio por local/mes + descuento volumen + tarifa multimarca. Candidato a capa multi-POS / catálogo-pedidos
  de Folvy (frente TPV bidireccional Fase 2).
- **Enviado a `contact@hubrise.com`** desde `partners@folvy.app`, en inglés, firma "Julio Gª Colón / Folvy —
  folvy.app / partners@folvy.app". Sin llamada (Julio no conversa en inglés fluido; todo por email).
- 4 puntos: (1) **LA CRÍTICA — convivencia/dual-running de la misma marca en Last.app + HubRise durante la
  transición; y plan B: si no es posible en producción, ¿hay sandbox/entorno test?**; (2) modelo reventa marca
  blanca; (3) precio 5/7/10 marcas/local; (4) cobertura España Glovo/Uber/JustEat ingesta + publicación.
- PENDIENTE: esperar respuesta. Lo crítico a leer = la pregunta nº1 (de ello depende cómo migrar Llorente29
  sin romper producción).

### CONTEXTO ESTRATÉGICO (recordatorio TPV/integración)
Integración TPV bidireccional en 2 fases: Fase 1 = Folvy LEE del TPV (Last.app webhook ya en producción);
Fase 2 = Folvy PUBLICA catálogo+precios. Dirección del catálogo configurable por marca (`catalog_source`
'folvy'|'pos'), no global. Llorente29 mixto: marcas propias en Folvy, cedidas (Cloudtown) en Last.app.
Conector = capa genérica multi-POS; Last.app primer adaptador; HubRise candidato a segundo adaptador/capa.

DOCS NUEVOS (02/06, en outputs): `CIERRE_SESION_2026-06-02.md` (cierre autónomo de la jornada).


---

## SESIÓN 02/06/2026 (TÉCNICA) — Economía de Plataformas EP1 + Módulo de Integraciones I1 + Catcher

> Sesión técnica larga, posterior a la de marca/comunicaciones del mismo día. 8 commits, todo en `origin/main`, build verde, nada a medias. Resumen vivo en §1; aquí el detalle.

### Método y disciplina (lecciones reforzadas en vivo por Julio)
- **Cerrar problemas, no rodearlos.** Cuando falta un dato (coste de Catcher), se consigue el dato; no se construye un cálculo "a medias" ni se mete deuda con otro nombre. Un cálculo con info incompleta es info errónea.
- **No sesgar hacia cerrar la sesión.** Julio decide cuándo parar; recomendar cierre SOLO por riesgo técnico real, nunca por duración. (Corregido en vivo: Claude tiraba a cerrar de más.)
- **Benchmark antes de diseñar cada pieza** (economía, forma de salida de la RPC, módulo de integraciones).
- **Informarse (web/doc) antes de preguntar a Julio** lo que es averiguable (Catcher).

### FRENTE A — Economía de Plataformas, Capa A (EP1)
- **Doc v2** (`folvy_economia_plataformas_diseno.md`): P1 (comisión sobre PVP CON IVA), P2 (cedidas las paga el dueño), P3 (revenue share sobre ventas netas sin IVA), Cloudtown 25% editable + reembolso materiales, reparto propio (fee − Catcher, NO neutro), "un motor, tres vistas" (por pedido / ponderada A / por reparto B), benchmark honesto (Otter/Deliverect/MarginEdge/R365: su AvT es de ingrediente, no de canal → Capa C diferenciador defendible).
- **`brand_channel_rate`**: id, account_id, brand_channel_id FK, service_type CHECK, commission_pct, commission_fixed, commission_base default 'pvp_con_iva', own_customer_fee, own_courier_cost, is_active, archived_at, timestamps, created_by/name, UNIQUE(brand_channel_id, service_type). RLS `bcr_read`/`bcr_write`.
- **`sale.service_type`** poblado por el webhook desde `pickupType`. Históricos en null.
- **RPC pendiente** (ver §1.3 deuda 1): diseño cerrado, espera coste de Catcher para hacerse completa de una vez.

### FRENTE B — Módulo de Integraciones (I1)
- Cara visible del conector multi-fuente que Folvy ya es por dentro (Last, Catcher, futuros Glovo/Uber/JE, HubRise). Disparado por observación de Julio sobre el panel de Last.app.
- **`connector`** (catálogo global, estilo `submodules`): code, category, connection_type, managed_by, direction, config_schema jsonb, features, is_available, status, sort_order. RLS: lectura autenticada, escritura `current_user_is_admin()`.
- **`account_connector`** (conexión por cuenta, RLS calcada de `brand_channel`): estados available→requested→connecting→connected→paused→error, scope account/brand/location, `credentials_ref` = referencia cifrada NUNCA en claro, external_account_id, UNIQUE por cuenta+conector+alcance.
- **Seed:** `lastapp` (POS, inbound, credentials/superadmin) + `catcher` (logistics, bidirectional, credentials/either, config_schema app_id/app_secret/location_id).
- **`connectorService`** + `types/integrations.ts` en módulo nuevo `src/modules/integrations/`.

### CATCHER (API confirmada, integración pendiente de credenciales)
- Marketplace B2B de última milla (no tarifa fija; coste por match repartidor↔precio máximo + stacking 2,5€/pedido extra).
- API `staging-api.catcher.es`, auth `appId`/`appSecret`/`client_secret` → token 24h cacheable.
- **Coste real = `transportPrice`** en `Webhook - Orders` (campo `courier`); también `payment` en `Get Order Detail` (presetPrice/matchedPrice/pitcherDeliveryPrice).
- Llave de cruce: **`externalId`** ↔ venta `sale`. `locationId` por local.
- `Order Create` → VISIÓN futura: Folvy podría publicar repartos a Catcher. No ahora.
- Integración = frente propio (como Last): Edge Function `catcher-webhook` + captura coste + cruce. Arranca al recibir credenciales.

DOCS NUEVOS (02/06 técnica): `folvy_economia_plataformas_diseno.md` v2 (reescrito), `folvy_integraciones_modulo_diseno.md` v1.


---

## SESIÓN 02/06/2026 (TARDE — DECISIÓN INTEGRADOR DIRECTO)

> Continuación de la jornada técnica. Foco: evaluación de integradores de delivery y decisión estratégica de arquitectura. NO se tocó código (salvo lo ya commiteado por la mañana). Trabajo de investigación, negociación y diseño estratégico. Resumen vivo en §1.0.bis, §1.2, §1.2.bis.

### El problema que disparó todo
Julio detectó que depender de Last.app (o de cualquier intermediario) es insostenible por 4 razones: coste (525€/mes estrangula la propuesta Folvy+cliente), pérdida del concepto 360, pérdida de control del flujo de datos (materia prima de todo Folvy), y que el integrador propio fideliza estructuralmente (cambiar de integrador que funciona es casi imposible). Ver §1.0.bis.

### Evaluación de integradores (ver §1.2)
Last.app (actual, caro, dueño del dato), HubRise (middleware puro, white-label, barato, pero Glovo-España incierto e incompatible con Last), KitchenHub (modelo ideal para revendedores pero USA, sin plataformas europeas), Otter (producto final que compite), Deliverect (tiene Glovo-España pero compite y caro). Conclusión: ningún intermediario resuelve el control del dato → ir DIRECTO.

### HubRise — negociación (a la espera)
Pricing: estándar 35€/local, dark kitchen por pedidos (3 locales de Llorente29 caen en tramo 35€ → ~105€/mes), partner desde 6ª cuenta (−28,6%), setup 25€/marca/plataforma/local. Negociado a 450€ (descuento agrupación 50%, primera marca gratis). Glovo-España sin fecha ni certeza. Correo enviado a Janaina (ES+EN) pidiendo: agrupación, hacer Folvy las configs (rechazado: alta JustEat/Glovo la hace HubRise), camino partner. NO hay sandbox (cuenta test "Folvy" en producción con cuota exenta).

### Glovo API directa (ver §1.2.bis) — PRIORIDAD Nº1
API oficial `glovoapp.com` (definition.yaml, OpenAPI 3.0). Staging `stageapi.glovoapp.com`. Acceso por email a partner.integrationseu@glovoapp.com. Auth por shared token + firma Glovo-Signature opcional. Recepción (Order Dispatched/Cancelled) + ciclo de vida completo (accept/ready/out_for_delivery/picked_up) + push de menú bidireccional + LAAS (repartidores de Glovo). El dato de pedido es MEJOR que Last para EP1 (order_type nativo, fees y descuentos desglosados y separados por pagador).

### Plan conector Glovo (frente mayor próxima sesión)
Diseñar doc primero (mapeo Glovo↔recipe_item/menu_item). Fases: G1 recepción (glovo-webhook→sale), G2 push menú, G3 ciclo estados, G4 LAAS. Vive en módulo Integraciones (I1 ya construido). Primer paso real: pedir acceso a Glovo por email.

DATO CLAVE: Llorente29 = 0% reparto propio hoy → RPC EP1 cerrable entera ya (100% platform_delivery), sin esperar a Catcher.


---

## SESIÓN 02/06/2026 (NOCHE — CIERRE: Módulo Folvy Connect completo + D2 Vault)

> Continuación de la jornada. Foco: terminar el módulo de Integraciones y avanzar el conector Glovo todo lo posible sin el acceso (que se solicitó y entró en cola: ticket INTSUPPO-1382). Resumen vivo en §1.1.

### Lo construido (commits del tramo)
- **Seed conector Glovo** en catálogo (`20260602T0300`).
- **Módulo Folvy Connect (I2):** module.tsx + moduleRegistry (línea, sin tocar App.tsx) + IntegrationsPage + IntegrationsMarketplacePage. Verificado en producción (aparece en TopBar, lista los 3 conectores).
- **Logos de marca:** bucket `connector-logos`, ConnectorAvatar (logo + fallback color/inicial). Logos procesados por Claude (256×256 fondo blanco) desde los originales de Julio. `connector.logo_url` poblado.
- **D2 cifrado de credenciales (completo):**
  - D2.1: columna `account_connector.config jsonb` + tipos regenerados.
  - D2.2a: funciones wrapper Vault (`20260602T2200`), SECURITY DEFINER, solo service_role.
  - D2.2b: Edge Function `connector-credentials` desplegada (valida JWT + wrappers, doble gating).
  - D2.3: ConnectorDetailPage (formulario dinámico desde config_schema) + connectorCredentialsService + enganche en Marketplace.
  - **Verificado end-to-end en prod:** save (token cifrado en Vault), status, clear (borra de Vault). Conexión de prueba creada y luego borrada → todo limpio (0 conexiones, 0 secretos).

### Glovo respondió
Email a partner.integrationseu@glovoapp.com → Glovo creó ticket **INTSUPPO-1382** vía su Internal Service Desk (Jira). "We're on it" (en cola). Esto desbloqueará G1 cuando entreguen credenciales de stage.

### Aprendizajes técnicos del tramo
Ver §1.3.HALLAZGOS: arquitectura modular del Shell (línea en registry), deno.json por Edge Function, gen types UTF-16→UTF-8, patrón Vault (wrappers en public, service_role, nunca INSERT crudo), gating de rol con p_user_id en el wrapper.

### Pendiente declarado
G1 Glovo (espera acceso), RPC EP1 (cerrable ya), Catcher I3 (espera credenciales), apunte del auto_accept por defecto, pantalla Canales, bandeja superadmin.
