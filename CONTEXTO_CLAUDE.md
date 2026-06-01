# CONTEXTO_CLAUDE.md

> **Documento maestro único de memoria persistente del proyecto Folvy.**
> Lectura obligatoria al inicio de cada sesión técnica.
> **Última actualización: 31/05/2026 (cierre sesión: FASE R1 RESPONSIVE cerrada en producción + NUEVO FRENTE Operaciones/Compras-Recepción-Inventario: estudio competitivo, diseño del bucle completo, y ESLABÓN 1 construido/verificado/demostrado end-to-end — el coste fluye desde la compra a los platos). Ver §1.**
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

**Última actualización: 2026-05-31 (cierre sesión: R1 responsive en producción + frente Compras-Recepción-Inventario con eslabón 1 demostrado end-to-end)**

### 1.1 — Dónde estamos HOY (31/05/2026)

> **Logro de la sesión 31/05 (dos bloques):**
> - **Bloque 1 — FASE R1 RESPONSIVE: CERRADA y en producción.** Shell de cliente responsive para móvil/tablet, verificado pantalla a pantalla a 390px. Commits R1.1–R1.4 en `main` (HEAD previo `c4b1f30`). Barra inferior móvil (Inicio·Safety·[IA héroe]·Sales·Kitchen), Team al overflow del avatar, breakpoint 768, tablas→tarjetas, rejillas→columna sticky. Escritorio (≥768px) intacto. Hallazgo: Meraki Pita 104 platos sin coste; Sales sin desarrollo. Cola comprometida tras R1: R2 voz IA, R3 home latido, R4 cámara→IA, R5 portal empleado.
> - **Bloque 2 — NUEVO FRENTE Operaciones / Compras-Recepción-Inventario.** Ver 1.1.F.

### 1.1.F — FRENTE COMPRAS-RECEPCIÓN-INVENTARIO (31/05, el grueso de la sesión)

**Estudio competitivo** (`folvy_competidores_inventario_compras.md`, en knowledge + outputs): la merma valorada (consumo teórico vs real) es **table stakes de toda la categoría** (gstock, tspoon/tSpoonLab, Supy, MarketMan, haddock, SmartBar, MarginEdge la calculan). NO es diferenciador. La goleada de Folvy está en 3 ejes: (1) sistema conectado España-native (Team+Safety+Sales+Kitchen+Ops en uno; gstock/tspoon no tienen personal ni APPCC nativo), (2) fricción de arranque casi nula vía **foto→IA** + datos ya unidos, (3) modelado multi-marca/dark-kitchen. El golpe de demo = **foto→escandallo/albarán IA** (ataca el dolor nº1: dar de alta a mano). Benchmark de coste: R365 ofrece un SELECTOR de métodos (último/medio ponderado/ventana) — confirma el diseño de Folvy. El precio se origina en la RECEPCIÓN en Apicbase y gstock (convergencia).

**El bucle (diseñado y aprobado):** Artículos+formatos (compra/stock/uso) → OC interna (+envío adapter WhatsApp, EDI diferido) → Recepción [contra OC o libre, la IA reeduca si falta OC] → Stock → Consumo teórico (ventas×escandallo, YA EXISTE) → Inventario físico → Varianza € → ↻ sugiere OC. No se puede partir; es circuito cerrado.

**ESLABÓN 1 — CONSTRUIDO, VERIFICADO Y DEMOSTRADO END-TO-END:**
- **Tabla `recipe_item_purchase_format`** (BBDD): árbol de empaquetado anidado por ingrediente (parent_format_id, qty_per_parent, qty_in_base=única verdad del coste >0, is_piece, is_weighted, source/ai_confidence/needs_review). Integridad del árbol por FK compuesta declarativa (padre del mismo ingrediente, sin trigger). RLS calcado de `recipe_item_unit_conversion`. "Caja"/"Bolsa" NO van a `kitchen_unit` (error de tspoon evitado).
- **`article_supplier`**: +`purchase_format_id`, −`purchase_unit_id` (Opción A: proveedor vende UN nodo del árbol; estaba vacía, coste 0).
- **`purchaseFormatService.ts`** (app): CRUD supplier/formato/article_supplier + `setupSimplePurchase` (autocrea nodo trivial) + dispara cascada. Blindaje de conversión: recibe `qty_in_base` ya en unidad base; NO inventa 1:1 (fallo de Apicbase evitado).
- **`kitchen_recompute_raw_cost(item_id)`** (BBDD, función NUEVA, NO toca `kitchen_recompute_item`): coste del raw = `last_price / qty_in_base`. Selector de estrategia: `fixed` (manda lo tecleado, la compra no pisa) / `last_purchase` (activo) / `average_weighted` + `average_window` (DORMIDAS, caen a respaldo hasta que exista la recepción/purchase_line; nunca inventan). Si no hay precio utilizable → needs_review, conserva coste anterior.
- **Trigger `trg_article_supplier_recompute_cost`** (BBDD): AFTER INSERT/DELETE/UPDATE OF last_price,purchase_format_id,is_preferred,is_active → dispara el recálculo del ingrediente. Eje A híbrido lado BBDD.
- **`kitchen_ancestors_of(item_id)`** (BBDD): ancestros transitivos (mecánica copiada/girada de `recipe_line_prevent_cycle`, UNION corta ciclos, depth DESC).
- **`costCascadeService.ts`** (app): `cascadeFromItem` (tras cambio de precio: recalcula solo ancestros, el trigger ya hizo el ingrediente) y `recomputeItemAndAncestors` (para cambios que NO pasan por el trigger: foto→IA/import/edición fixed). Fail-safe por ítem. Eje A híbrido lado app. Reutilizable por todo el sistema.
- **`purchaseFormatService` conectado a `cascadeFromItem`** en setupSimplePurchase y updateArticleSupplier (solo si cambia lastPrice/purchaseFormatId).
- **PRUEBA END-TO-END (sesión usuario real, RLS+guards activos):** Carne mixta picada (g, en 26 platos) → puesta en last_purchase → alta proveedor+formato(Caja, qty_in_base=5000)+precio(30€) vía script con signInWithPassword → trigger recalculó carne null→**0.006 €/g** → cascada recalculó **26/26 platos**. Hallazgo de negocio: los costes de los platos BAJARON → los costes tecleados a mano estaban inflados vs precio real de compra → VALIDA la tesis "el coste fluye desde la compra". Prueba revertida (limpieza con disable trigger). Datos actuales son DESECHABLES (carga de pruebas sin continuidad).

**Decisiones de arquitectura cerradas:** propagación HÍBRIDA (recálculo del ingrediente en BBDD por trigger + cascada a platos orquestada por app + verificador pendiente + aviso didáctico de salto de precio pendiente); 4 estrategias de coste (`fixed`/`last_purchase`/`average_weighted`/`average_window`, ya existían en `kitchen.ts CostStrategy`) configurables por cuenta/ingrediente; FIFO-por-lote diferido (necesita trazabilidad de lotes).

### 1.2 — ESTADO GIT (31/05)

> **2 commits en local, SIN PUSH** (origin 2 detrás):
> - `30de3a4` feat(kitchen): formatos de compra — tipos regenerados, dominio y service (árbol + proveedor/precio)
> - `a7ec2b6` feat(kitchen): cascada de coste compra→plato + migración del esquema de compras
> Migración `supabase/migrations/20260531T1330_folvy_kitchen_compras.sql` en el repo (cierra el drift de tabla+funciones+trigger).
> R1 (R1.1–R1.4) ya estaba en `main` antes de esta tanda.
> **NO HACER PUSH hasta cerrar `.gitignore`** (hay datos de cliente sin política en el working tree). Es lo PRIMERO de la próxima sesión.

### 1.3 — DEUDA VIVA (por prioridad, 31/05)

1. **[SEGURIDAD/CONFIRMADO EN VIVO] Guard `auth.uid()` + escrituras sin sesión:** cualquier escritura en `article_supplier` desde contexto sin sesión de usuario (SQL Editor hoy; **webhook de recepción `service_role` mañana**) revienta por el trigger → la función con guard lanza EXCEPTION. RESOLVER antes de construir la recepción por webhook.
2. **`.gitignore` sin cerrar + 2 commits sin push** → cerrar `.gitignore` (datos cliente: JSON bills/catalogos/locations + artefactos) y hacer push. PRIMERO de la próxima sesión.
3. **[SEGURIDAD ALTA, heredada]** rotar service_role key + tokens que se pegaron en chats; activar PITR Supabase.
4. **Aviso didáctico de salto de precio** (sin construir): si el precio recibido salta >X% sobre histórico, avisar en vez de pisar en silencio.
5. **Verificador de platos obsoletos** (sin construir): job que detecta plato cuyo cost_updated_at < cost_updated_at de algún hijo.
6. **`average_weighted`/`average_window`** se completan cuando exista la recepción (hoy dormidas).
7. **Default de ingrediente nuevo `fixed`→`last_purchase`** (decisión de producto de Julio: dirección confirmada, ejecutar cuando convenga). Los 161 ingredientes actuales son desechables → NO migrar/preservar.
8. Code-splitting (~646KB gzip); abstracción proveedor IA; medidor coste IA por cuenta (prerequisito 2º cliente).

### 1.4 — Próximos pasos priorizados (31/05)

1. **`.gitignore` + push** (desbloquea todo el trabajo de hoy en remoto). Primero, cabeza fresca.
2. **UI del alta de compras** (proveedor+formato+precio): el siguiente frente. Con el principio didáctico — el cocinero aprende el modelo de tres unidades mientras Folvy se lo rellena. La goleada real aquí es **foto→IA del albarán** (foto → artículo+formato+proveedor+precio+conversión sugeridos, con needs_review). Listón: "acierta con fotos reales malas", no "tiene la feature".
3. **Resolver el checkpoint del guard** (deuda 1) antes de construir la recepción por webhook.
4. **Siguientes eslabones del bucle:** OC interna (no existe tabla aún) → recepción (purchase/purchase_line ya existen vacías, soportan recepción libre) → con la recepción se activan `average_*` y se construye el verificador.
5. **Pendientes heredados del editor de escandallos** (S1–S10, ver `folvy_v1_editor_escandallos_diseno.md`): schema migration V1, UI needs_review, modificadores, UI editor completa.
6. **Módulo Sales/dashboards** (datos listos: coste real + 11.894 ventas mapeadas).
7. **Webhook fase 2** (bloqueado por paso a Production de Last).
8. **Producción Llorente29 objetivo: 7 sept 2026.**

### 1.11 — NOTA HISTÓRICA

> **27/05**: ensayo con CSV ruidosos. Reemplazado el 28/05 AM por datos reales de Last.app.
> **28/05 AM**: conector Last, backfill 11.894 ventas, carta 9 marcas, 160 raw.
> **28/05 PM1**: puente determinista, motor de coste validado al céntimo, 94 dish importados.
> **28/05 PM2**: diseño UX completo V1 editor + Modificadores M1-M4 (detalle en `folvy_v1_editor_escandallos_diseno.md`).
> **31/05 Bloque 1**: R1 responsive cerrada en producción.
> **31/05 Bloque 2 (este cierre)**: frente Compras-Recepción-Inventario — estudio competitivo, diseño del bucle, ESLABÓN 1 (formatos de compra + coste que fluye desde la compra + cascada a platos) construido, verificado y DEMOSTRADO end-to-end con datos y sesión reales.
>
> **Lo NO superado por hoy:** modelo BBDD escandallo, `kitchen_recompute_item`/`kitchen_recipe_breakdown` (§4.9/§4.10), Folvy AI, Capa 2 económica, conector Last.app, 11.894 ventas, 94 dish con coste real.

---
---
2. PROYECTO Y EQUIPO
Empresa: Foodint (rebrand en curso a Folvy SL).
CEO: Julio Gascón Colón (`jgcolon@idasal.com`).
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
Nombre CEO: `platform_admins.full_name` dice "Julio Gascón"; correcto "Julio G. Colón"
(UPDATE 1 línea).
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
