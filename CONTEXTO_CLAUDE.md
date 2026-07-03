# CONTEXTO_CLAUDE.md

> **Documento maestro único de memoria persistente del proyecto Folvy.**
> Lectura obligatoria al inicio de cada sesión técnica.
> **Última actualización: 2026-07-03 (CIERRE · CRM F4 COMPLETO + GESTOR DE CAMPAÑAS G1 + MOTOR DE OFERTAS v2 G2a+ — TODO EN PRODUCCIÓN Y VERIFICADO EN VIVO + G2c (BOGO + PLATO DE REGALO) CERRADO Y VERIFICADO EN LA MISMA SESIÓN).** Sesión mayor del CRM/ofertas — con G2c el CATÁLOGO DE TIPOS DE OFERTA queda COMPLETO contra Uber Eats Offers/Glovo Promotool. **(F4 "Mi cuenta" COMPLETO, T1+T2+FIX+T3):** ruta `/cuenta` dentro de ShopHubRoute (App.tsx intacto), histórico con fotos/marca/estado + REORDER EXACTO por payload de `raw_tab` revalidado con dry-run, `customer_address` con siembra silenciosa en `place_shop_order` + CRUD con autocomplete Mapbox, baja RGPD 7.3 en un toggle (log `revoked/account_page` verificado), tarjetero "Mis bonos" (dorada/verde/atenuada con motivo, réplica exacta de la cascada T2100, badge contador, "Usar ahora" precarga checkout vía sessionStorage), FIX CRÍTICO destapado por el tarjetero: **canjes de ventas CANCELADAS ya no consumen cupón** (filtro `join sale <> 'cancelled'` en place_shop_order Y customer_coupons + delete del canje muerto pre-insert; tapaba fuga real: pagos Stripe abandonados quemaban bienvenidas), y T3 = **motor de recompensa por FRECUENCIA** (coupon.kind 'frequency'+threshold, progreso CALCULADO no guardado, flag is_cycle esquiva el índice por-cliente, config con impacto de margen real en ShopDesignPage, barra de sellos goal-gradient + mini-línea en cabecera). HITO: primer ciclo real del CRM ejecutado (pedido FS39838 con bienvenida canjeada −2,97€, barra 0/5→1/5, bienvenida transicionó sola a Usado). Migraciones 20260703T1000/1010/1020/2000/2010/2200/2300; commits 0e80704/946d3ba/13032ae/69a5a96. **(G1 GESTOR DE CAMPAÑAS):** página Campañas (lista Sistema/Código con estado derivado en SQL + rendimiento real con canjes vivos y margen medio de margin_after; crear/editar/pausar/clonar cupones de código con preview_coupon_impact en vivo; coupon += origin manual/rule/agent [costura automatización] + paused_at). 3 fixes de F3 cazados usándolo: campo "¿Tienes un cupón?" NUNCA montado (gateado tras !isWelcome), rechazo mudo (applied:false sin reason no pintaba nada), y protagonismo+VOZ HUMANA (fila con ticket movida al RESUMEN entre envío y Total patrón Uber/Glovo, rechazo en ámbar cálido). **DECISIÓN NUEVA de Julio: la voz del cliente (copys cálidos) es REQUISITO de diseño desde la maqueta, no parche.** Migraciones 20260703T2400/2410; commits cabeff7/7eb6f48/947f0ff/9800406. **(AUDITORÍA + CORRECCIÓN DE PROCESO):** Julio cazó que "lo básico" del mercado (2x1, % por plato, envío gratis) estaba sin tratar pese a pedir benchmark a fondo → auditoría exhaustiva del CATÁLOGO de tipos de oferta (Uber Eats Offers/Glovo Promotool/Cheerfy/Pleez) con veredicto por fila; REGLA REFORZADA: el paso BENCHMARK produce enumeración exhaustiva de capacidades, no lista de rivales; tablero versionado como ÁREAS 10/11/12 nuevas de folvy_competitive_map.md (CRM-Loyalty-Ofertas · Adquisición pagada · Radar competitivo). Escalera de automatización explícita: G1 manos manuales → G2d reglas (clima Open-Meteo/eventos/demanda/marca floja contra histórico PROPIO, ventaja vs scraping Pleez) → F9 agente (contrato B3). **(G2a+ MOTOR DE OFERTAS v2, lote 1 COMPLETO en 7 sub-lotes):** MODELO 20260703T2500 (coupon += weekdays/time_from/time_to franjas + budget_max presupuesto que apaga sola + channels[shop] costura F8 + kinds item_percent/free_delivery; campaign_scope marca/categoría/plato; **menu_item_price_history** con trigger+backfill = ventana Ómnibus contando desde 03/07 09:38 + omnibus_ref_price(30d); ESPEJO: menu_item.mirror_of_item_id + create_mirror_item + swap_mirror). MOTOR 2510: item_percent reprecia en _shop_reprice_line vía **_shop_item_offer (fuente única carta=cobro)**, tachado SOLO si legal (wasPrice de la referencia 30d, si ref < precio-dto → sin tachado), letra pequeña "Precio más bajo últimos 30 días"; canje por venta con is_cycle para presupuesto. ESCAPARATE B2+C4 (badge de marca en hub vía _shop_brand_best_offer, banner de carta, tarjetas resaltadas, píldora de categoría; franja verde envío gratis + tag por marca + **barrita "Te faltan X€ para el envío gratis"** en carrito; LECCIÓN: todo cambio visual del Shop exige bump de SW_VERSION o los instalados no lo ven — un SW sin bump escondió B2). ENVÍO GRATIS C+C2: kind free_delivery en la cascada (auto o código; pickup→rechazo amable), **COEXISTE con la bienvenida** (lanes separados: subtotal vs envío; índice coupon_account_one_auto pasó a único POR KIND, 2540); verificado en vivo Bienvenida −10% + envío ¡Gratis! a la vez. FIX Mapbox: 403 en subdominios de tienda = URL restrictions del token → añadir `folvy.app` (domain-only cubre subdominios; comodín no soportado); FIX autofill Chrome pisando las sugerencias (C3). GESTOR D+D4+D5 (2560/2570/2580): modal con selector de tipo → picker de alcance con CHIPS DE MARCA + BUSCADOR con "Seleccionar los N" (caso coca-cola multi-marca) + chip resumen persistente → franja → presupuesto → **impacto de margen POR PLATO del alcance (nombra los bajo suelo, cuenta sin escandallo) + validación Ómnibus visible + oferta de espejo si el tachado sería ilegal**; buscador+filtros en la lista; delete_campaign (guard canjes: con canjes solo pausa, histórico es dato); mirror_state + botón swap en ficha (verificación latente); 2 tropiezos de firma en 2560 → **REGLA NUEVA DEL PLAYBOOK: DROP y GRANT de migración con cambio de firma se generan COPIANDO la lista de tipos del CREATE del propio fichero, contándolos** (el 42883 del GRANT con 16 tipos vs CREATE de 17). PARTE 4 (motor de dinero saneado antes de BOGO): base de la bienvenida congelada (dependencia cart.lines.length no re-disparaba el dry-run al subir cantidades → cartSig con cantidades) + carrito-viejo (el resumen pinta las líneas del DRY-RUN cuando está alineado, no el localStorage). ESPEJO ESTRENADO en vivo (plato TEST: baile 10→6→10 → aviso tachado ilegal → "Crear versión promo" → swap → carta limpia → borrado sin rastro); campañas de prueba ELIMINADAS con el botón nuevo. Commits del lote: a8a86f4→977f3e1 (18 migraciones 20260703T1000..T2580, todas aplicadas y push rev-list 0 0). **CONTRA EL BENCHMARK: paridad Uber/Glovo en % por plato + envío gratis + gestor, MÁS margen real por plato antes de activar + Ómnibus por construcción + artículo espejo (nadie los tiene).** **(G2c BOGO + PLATO DE REGALO — CERRADO EL MISMO DÍA, commits 06a8c95→10785e9, migraciones T2590/T2600/T2610v2/T2620/T2630/T2640/T2660):** BOGO en 3 sub-lotes (A1 modelo+gestor con nota de coste por par; A2 MOTOR con codificación discountUnit=discountLine/qty para NO tocar place_shop_order, verificado en vivo con la ESCALERA DE PARES al céntimo 2 uds→1,90 / 3→3,80 / 4→3,80 del AGUA 50CL; A3+A3.2+A3.3+A3.4 escaparate COMPLETO en las 7 pantallas — regla "lo que ve es lo que paga EN CADA PANTALLA" tras capturas de Julio: badge negro/amarillo GRANDE patrón Glovo en tarjeta+hub, banner, modal con total por pares espejo del motor, carrito con tachado+chip "ahorras X", resumen del checkout con chip; _shop_item_promo unifica bogo>pct; _shop_brand_best_offer ampliada a bogo con prioridad). FREE_ITEM (B1 gestor con chip "🎁 Regalo: X · coste" + B2 motor con DECISIÓN DE PRODUCTO confirmada: el regalo es LÍNEA REAL a 0€ —la cocina la ve y la prepara; descuento equivalente = regalo que nunca se hace = cliente enfadado— insertada tras adapt, canje is_cycle con el precio del regalo para presupuesto, VERIFICADO por respuesta del servidor: línea AGUA a 0 con offer free_item en el dry-run; B3 barrita dorada "Te faltan X€ para tu [plato] de regalo"→"¡añadido!" patrón envío-gratis + render "🎁 Regalo · Gratis" en resumen/recap + realineado del gate freshLines ===→>= porque el server añade una línea). VERIFICACIÓN FINAL en vivo: barrita llenándose, regalo apareciendo solo, bienvenida −10% sobre base SIN el regalo (correcta), total al céntimo; campañas de prueba eliminadas. TÉCNICA NUEVA de Code para funciones de cobro de 23k: la migración REGENERA del texto VIVO (pg_get_functiondef) + replace() anclados en strings únicos con GUARDAS que abortan si un ancla falta — patrón anti-drift. 2 INCIDENTES DE LITURGIA cazados: (a) Code editó la 2610 YA APLICADA (drift BBDD/repo) → REGLA NUEVA: una migración aplicada no se edita JAMÁS, cambios en migración nueva; (b) la 2620 se creyó aplicada sin estarlo (badge del hub null) → verificar el CUERPO VIVO de la función (position('bogo' in pg_get_functiondef)) cuando algo no cuadre; Code retiró su 2650 redundante al aclararse. MARCA DUPLICADA "Bendito Burrito" detectada (2 filas brand, una sin uso) = higiene menor anotada. PENDIENTES: G2e dashboard rendimiento, G2d motor de reglas, ciclo real con cocina abierta (chip dirección T1 + ganar→canjear→reset T3), KPI "Agotados" con espejo, normalizar scope categoría+hijos del picker, precio Tequeños 9,91 (¿céntimo arriba tras la prueba?), regenerar database.ts, F8 RECON de publicación (API vs credenciales de partner), decisión cashback (F6, de Julio). — Lo anterior: **2026-07-01 (CIERRE · REBRAND SHOP + IDENTIDAD FOODINT).** Sesión de IMAGEN del Folvy Shop (lado cliente) + creación de la marca Foodint. HUB Opción C (identidad grande sobre el héroe, logo directo sin placa) + slogans configurables por cuenta (shop_tagline titular con resalte ámbar tras el 1er punto + shop_subtitle nuevo) editables en Diseño; RPCs acotadas set_account_shop_logo/set_account_shop_text (SECURITY DEFINER: la RLS de accounts solo deja escribir a admin, el UPDATE directo se descartaba en silencio). CABECERA PROPIA POR MARCA (decisión: "marca dueña de su cabecera, Foodint dueño de la acción" — su portada shop_theme.hero_url o su acento de fondo + logo/nombre encima; botones Añadir/carrito/pagar siguen coral). Storefront más fresco (carta con hover+píldora, carrito/añadido/modal con iconos SVG); CHECKOUT dejado NEUTRO a propósito (Stripe intacto). LOGO FOODINT nuevo a medida = campana (cloche) + "f●○dint" (las oo = relleno + aro = variedad, MONOCROMO-SAFE por forma → vale para etiqueta térmica); sistema SVG+PNG (color claro/oscuro + mono) vectorizado + mark + favicon. Migraciones 20260630T2200/T2230/T2300 (accounts.shop_logo_url/shop_subtitle + RPCs) + 20260701T0900 (brand hero en el feed). Commits del Shop rev-list 0 0. PENDIENTE del frente imagen: pantallas de gestión (no-Shop) + móvil/responsive (sidebar App.tsx, requiere permiso) + logo mono en etiquetas (sesión NT311). — Lo anterior: 2026-06-28 (noche, CIERRE 8 · ESCANDALLOS: B2 DE RAÍZ + UNIDADES + DUPLICAR + 2 FRENTES DE NÚCLEO DECLARADOS).** Sesión larga sobre el módulo de escandallos. **(1) B2 ARREGLADO DE RAÍZ (corrige el cierre anterior).** El primer arreglo de B2 (la "adopción de propuestas" que reapuntaba mapping_proposal) NO era la solución: en producción seguía DUPLICANDO ingredientes nuevos (caso real: 3 "Olivada" creadas en importaciones del "Cuatro Queso"). RAÍZ verdadera, hallada leyendo `materialize_recipe_session` + la consola del navegador: la decisión del humano vivía SOLO en `mapping_proposal`, y la RPC la leía de ahí; pero cuando el Edge NO crea la propuesta de una línea (choca con el índice único `mapping_proposal_uq`, que no incluye source_ref), `resolveImportProposal` hace un UPDATE que afecta a 0 filas SIN error → la decisión se pierde en silencio → materialize no la encuentra → crea ingrediente nuevo (duplica). Por el camino se cazó además un bug del parche: la adopción ponía `method=null` y la columna es NOT NULL → UPDATE 400 → adopción no corría. **SOLUCIÓN DEFINITIVA (commits hasta a0b0ca7):** la decisión se pasa DIRECTAMENTE a la RPC vía nuevo parámetro `p_decisions jsonb` ({source_normalized: target_id|null}); `materialize_recipe_session(p_session_id, p_decisions DEFAULT NULL)` la usa con PRIORIDAD ABSOLUTA (clave presente con uuid→usa existente; con null→crea nuevo a propósito; ausente→fallback a mapping_proposal; p_decisions NULL→comportamiento viejo). El modal (`handleFinish`) construye el objeto completo para las 7 líneas y lo pasa; se retiró el parche de adopción frágil de `extractRecipeSession`. Migración `20260628T1700_materialize_session_decisions.sql`. VERIFICADO EN VIVO en app.folvy.app (cuenta correcta Foodint Alcalá) con la prueba de fuego que antes fallaba: importar "Cuatro Queso" de cero (crea solo los que NO existen) + REIMPORTAR el mismo (enlaza a existentes, `veces=1`, 0 duplicados). DEUDA RAÍZ del Edge SIGUE viva pero ahora IRRELEVANTE para el casado (mapping_proposal ya no es la fuente de verdad): limpiarla = arreglar el índice único en el Edge `extract-recipe` y retirar el fallback; frente futuro, NO corrompe nada. **(2) UNIDADES NO CONVERTIBLES — FUGA SILENCIOSA DE STOCK (saneada en datos, frente de núcleo declarado).** Al costear platos importados aparecía "no costeable"; Julio lo diagnosticó como fallo de control de costes: un ingrediente que entra al escandallo en una unidad NO convertible a su unidad base ni costea NI descuenta stock, pero la venta "se da por buena" → fuga. RECON de los 3 motores (`_qty_in_base`, `explode_recipe_to_raws`, `generate_sale_consumption`, `compute_sale_line_cost`): la conversión vive en `_qty_in_base` (devuelve NULL si no hay conversión); `explode_recipe_to_raws` hace `IF v_qb IS NULL THEN CONTINUE` → SALTA la línea EN SILENCIO → no descuenta basura (bueno) pero tampoco avisa (malo: el AvT miente por omisión). 26 líneas afectadas (3,6% de 729), 4 ingredientes: Hamburguesa Smash (23 líneas), Pasta Trufada, Queso Gouda Loncheado, Queso Rulo de Cabra. **SANEADO HOY (datos, riesgo 0, 26→0 líneas no convertibles):** conversiones `recipe_item_unit_conversion` (qty_in_base = cuántas unidades BASE son 1 from_unit): Hamburguesa 1 ud=85 g (from_unit=g, qty_in_base=0.0117647), Gouda 1 ud=20 g, Rulo 1 ud=40 g; Pasta Trufada estaba MAL MONTADA (base=ud cuando va por peso) → corregida base_unit_id a 'g' (computed_cost=0 y last_price=0 → cambio limpio sin reconvertir coste). **FRENTE DE NÚCLEO DECLARADO (sesión dedicada, NO tocar en caliente): BLOQUEAR la línea con unidad no convertible** (decisión de Julio: bloquear, no avisar). 6 piezas aprobadas: (1) la línea no convertible nace needs_review "falta conversión", visible/bloqueante en el escandallo; (2) coste "incompleto", no 0€ disfrazado; (3) `generate_sale_consumption`: registra "consumo pendiente/no medible" en vez de saltar en silencio (protege stock+AvT); (4) UX de corrección con retorno: del aviso → ficha del ingrediente (unidades) → de vuelta al escandallo donde estaba; (5) prevención en la importación: la IA no crea líneas no convertibles en silencio; (6) saldar datos (ya hecho hoy). Disparador: antes de producción/7-sept. Toca `explode_recipe_to_raws`+`compute_sale_line_cost`+`generate_sale_consumption` (de ellos dependen las 729 líneas de coste y TODO el inventario → máxima cautela). **PRINCIPIO "unidades de uso amigables" reforzado (Julio):** la UI de conversiones debe dejar escribir "1 ud = 85 g" (legible) y calcular el qty_in_base por dentro; nadie debe teclear 0,0117 ni "25000 ml" en vez de "1 garrafa de 25 L". Casos Hamburguesa/Pasta quedaron con qty_in_base feo porque están montados al revés (base=ud cuando van por peso) — la UI debe evitarlo. **(3) DUPLICAR RECETA (EN PRODUCCIÓN, commits a0b0ca7→).** Pedido por Julio: botón para copiar un escandallo y cambiar 1-2 ingredientes. RPC `duplicate_recipe_item(p_source_id, p_new_name DEFAULT NULL)` SECURITY DEFINER (guard `belongs_to_account`) copia ATÓMICO plato + todas las líneas + pasos (`recipe_item_step`) + enlace paso↔línea (`recipe_item_step_line`, reconstruido con mapa id_viejo→nuevo) + HEREDA la foto (`kitchen_photo_url`); copia nace needs_review, source='manual', folvy_code nuevo por trigger; NO copia menu_item ni modifier impacts. Migración `20260628T1900_duplicate_recipe_item.sql`. Botón "Duplicar" en el header del editor + prop `onOpenRecipe` (abre la copia) cableada en KitchenRecipesPage. Además: TÍTULO DEL PLATO EDITABLE (click en el nombre → input → Enter/blur guarda con updateRecipeItem; lápiz al hover) — resuelve "falta UI para editar nombre". Cast puntual en `duplicateRecipeItem` porque database.ts no se pudo regenerar (CLI supabase ENOENT en la máquina). **(4) FRENTE DE NÚCLEO DECLARADO: "ELIMINAR NO ELIMINA" (sesión dedicada).** Hallazgo: "Milanesa de Ternera Cuatro Quesos" que Julio creía borrada seguía viva con archived_at=NULL, is_active sin tocar, 0 dependencias. RECON: `kitchen_delete_or_archive_item` (DELETE físico si deletable, si no UPDATE archived_at) + `kitchen_item_delete_check` (calcula deletable contra 8 tablas; guard `current_user_is_admin()/current_user_is_admin_or_manager_of()`). `confirmDelete` del editor NO traga el error (setea deleteError, no llama onBack en catch). SÍNTOMA CONTRADICTORIO: Julio confirmó el borrado, sin error, volvió a la lista, y el plato sigue → ni borró ni archivó ni dio error. Datos incompatibles entre sí → NO diagnosticable sin REPRODUCIR con la consola abierta (ver qué devuelve la RPC: deleted/archived/error). Posible: el plato que ve no es el que borró, o borrado en otra sesión/condición. SIGUIENTE PASO: reproducir con DevTools, NO tocar la lógica de DELETE+CASCADE en caliente. La Ternera huérfana (0 dependencias) se borró a mano hoy (DELETE con guardas NOT EXISTS, riesgo 0). **DEUDA TÉCNICA del día:** regenerar `database.ts` cuando se reinstale el CLI de Supabase (quitar los 2 casts puntuales: materialize y duplicate). **Lo anterior (2026-06-28, CIERRE B2):** Frente del enlazado catálogo↔escandallo, lado IMPORTACIÓN. PROBLEMA: importar una ficha (foto/PDF/Excel/Word) MATERIALIZABA A CIEGAS y DUPLICABA ingredientes (creaba "Salsa de tomate" nuevo aunque ya existiera "Tomate Frito"). RAÍZ: el Edge `extract-recipe` deja la sesión `pending_review` + una `mapping_proposal` por línea (status 'pending'), pero `recipeImportService` llamaba a `materialize_recipe_session` de inmediato SIN paso humano → las propuestas 'pending' no están en la lista de estados que `materialize` lee (`auto_confirmed/needs_review/human_confirmed`) → cae al ELSE y crea ingrediente nuevo. CONSTRUIDO (B2, EN PRODUCCIÓN, verificado en vivo Llorente29/Foodint Alcalá con la Milanesa de Pollo Napolitana: 7 ingredientes enlazados a EXISTENTES, COSTE 2,69€, 0 duplicados): flujo de 3 pasos extract→REVISIÓN→materialize. **(1)** `recipeImportService.ts` partido: `extractRecipeSession` (sube+extrae, NO materializa) + `findIngredientMatches` (similares vía `run_mapping`, umbral bajo 0.20/límite 6 para ver todos los gemelos; run_mapping NO devuelve coste→se cruza contra `recipe_item` en cliente) + `resolveImportProposal` (UPDATE mapping_proposal SET chosen_target_id + status='human_confirmed' + method='human', casa por source_ref+source_normalized; patrón calcado de `approveFamilyProposal`) + `materializeRecipeSession`; `importRecipeFromFile` conservado por compat. **(2)** `RecipeImportReviewModal.tsx` NUEVO (ventana sobre la pantalla principal, calcada a maqueta aprobada por Julio EXACTA en colores/formas/tamaños — terracota/verde-success/ámbar/azul-core): por ingrediente leído muestra TODOS los similares de la despensa con su coste + BUSCADOR LIBRE que **combina literal (`listRecipeItems({search})` ilike) + difuso (run_mapping) sin duplicar** — clave para el 0%: "patat" encuentra "PATATAS HOME STYLE CON PIEL" aunque el parecido difuso no lo case + "Crear nuevo" apartado (última opción, fricción a propósito); preselección **(a) UMBRAL ALTO `PRESELECT_CONFIDENCE=0.85`** (constante visible/ajustable); "Terminar y crear" DESHABILITADO hasta resolver TODAS las líneas (no se cierra a medias); el modal carga sus propios datos (raws+recipes+unidades) para que el cableado de las páginas sea mínimo. **(3)** Cableado en LOS DOS puntos de entrada: `KitchenRecipesPage` ("Importar ficha" → crea plato nuevo) Y `RecipeEditorPage` ("Importar ficha" dentro de escandallo abierto, `targetRecipeId` — el que de verdad usaba el cocinero; al terminar refresca reloadTick+econReloadTick). El SQL `materialize_recipe_session` y el Edge `extract-recipe` NO se tocaron: solo se ALIMENTA la decisión (`chosen_target_id`) que materialize ya sabe leer. Commits 49f5070/12dadc1/3abd4eb (rev-list 0). **REEMPLAZO DE ESCANDALLO confirmado:** importar sobre un plato que YA tiene escandallo lo SUSTITUYE entero (materialize hace `DELETE recipe_line WHERE parent_item_id` y reemplaza; el plato es el mismo, no se duplica; los ingredientes del maestro que quedan huérfanos NO se borran). **DEUDA DE RAÍZ DECLARADA (frente futuro; disparador = reproceso de fichas con ingredientes ya importados; HOY CUBIERTO por parche):** el índice único `mapping_proposal_uq` es por (account_id, source_kind, source_normalized, target_kind, COALESCE(context_brand_id,uuid-cero)) y **NO incluye `source_ref`** → al reimportar, el Edge no puede recrear las propuestas (chocan con las de una sesión anterior) y quedan huérfanas atadas a la sesión vieja en 'pending' → se duplica. SORTEADO con **"adopción de propuestas"** dentro de `extractRecipeSession` (reapunta a la sesión nueva las propuestas existentes de esa cuenta+textos, status 'pending', chosen_target_id NULL). Lo limpio (deuda 0) sería arreglarlo EN EL EDGE (opción B: upsert que maneje el choque dentro de `extract-recipe`), retirando el parche del cliente. **No corrompe recetas:** afecta SOLO a `mapping_proposal` (material de trabajo de la importación), NUNCA a `recipe_item`/`recipe_line`/costes (el motor de coste no lee mapping_proposal). LECCIÓN reforzada (vivida hoy): en local Julio estaba en cuenta **'Folvy Interno' (00000000-...0001)** creyendo estar en Llorente29 → la regla "verificar SIEMPRE la cuenta antes de operar" volvió a saltar; toda la depuración previa fue sobre datos sucios + dudas de despliegue Vercel (probar contra el bundle viejo cuando el deploy no había acabado) hasta hacer UNA prueba limpia en local con la cuenta correcta y verificación SQL del `chosen_target_id` paso a paso. **DEUDAS del frente ENLAZADO que SIGUEN abiertas:** (i) **repuntar los 107 menu_item viejos a sus escandallos reales** (enlazado venta→coste, lo que destapó este frente — `menu_item.recipe_item_id` apunta a recipe_items VACÍOS/cascarones); (ii) arreglar el importador de Last para que NUNCA cree cascarones vacíos (NULL+badge en vez de dish de 0 líneas); (iii) pantalla "qué escandallar primero" dentro de Folvy (filtro más-vendido + sin-escandallo) para que el cocinero no dependa de una query SQL de Julio; (iv) borrar el fichero zombi `KitchenRecipePage.tsx` (singular, reemplazado, nadie lo monta) en commit de limpieza; (v) la deuda de raíz del Edge (arriba). **El cocinero ya puede reanudar** (meter sus 15 platos más vendidos sin duplicar). **Lo anterior (2026-06-27, noche-2, CIERRE 7):** FOLVY SHOP — NÚCLEO TRANSACCIONAL COMPLETO Y VERIFICADO EN VIVO: pago Stripe Connect (direct charges + application_fee + onboarding real desde panel + Payment Element con tarjeta 4242 probada) + métodos de pago configurables por cuenta (online/efectivo recogida/efectivo entrega; efectivo nace aceptado, online espera webhook) + caducidad de abandonados (cron 5min) + fix selector de locales (timing) + tablet+impresión verificadas con hardware real (NT311, 3 tickets) + consumo stock/AvT motor OK pero bloqueado por datos (catálogo↔escandallo sin enlazar) + notificaciones cliente diseñadas/aparcadas (dependencia WhatsApp) + hallazgo CRM (teléfono lastapp es proxy de plataforma). Build verde, rev-list 0 0. Commits e2de5bc/baf9b08/75ea725/638ed8d (+ pago previos b117c8b/ce5bc5e/1254de3). **Lo anterior (noche-1):** FOLVY SHOP de escaparate a CASI-COBRA + HORARIO COMERCIAL (módulo nuevo). **(1) HORARIO COMERCIAL = MÓDULO COMPLETO (pieza transversal que NO existía en BD; `schedules` es cuadrante de PERSONAL, distinto).** Tablas `business_hours`(location_id, brand_id NULL=defecto del local, weekday, open_time, close_time, soporta cruce de medianoche) + `business_hours_exception`(por día, abierto/cerrado, rango expandido). Función canónica `is_brand_open(location_id, brand_id, ts)` (mira excepción del día primero, luego horario; herencia: marca sin horario propio usa el del local). Editor reutilizable `src/modules/multitenancy/components/hours/BusinessHoursEditor.tsx` + `businessHoursService.ts` + `BrandHoursTab.tsx` + sección en ficha de local (`OtherPages.tsx`). FEATURES: copiar horario entre marcas/locales (`copyHoursTo`); excepciones/festivos POR RANGO de fechas (`HoursExceptions.tsx`, agrupa días en rangos); vista gráfica (rejilla 7d×24h, conmutador Lista/Gráfico); aviso "comercial abierto sin personal" en ficha de local Y en cuadrante (`CalendarioPage`), vía `hours_staffing_gaps(location_id)` que cruza horario general (brand NULL) vs cobertura del cuadrante VIGENTE (week_start≤hoy<+7d). **BUG GRAVE cazado y resuelto (lección):** el cuadrante de personal usa convención **0=Lunes…6=Domingo**, Postgres dow usa **0=Domingo**; el cruce de Claude interpretaba mal TODOS los días → fix `clave_cuadrante=(dow+6)%7`. El cuadrante de personal NUNCA tuvo bug; era el cruce. Estructura `schedules.cells` = `{shiftId:{weekday:[employeeIds]}}`; `shift_templates` con coverage_mon..sun. Migraciones `20260626T1500_exception_unique` (índice único con COALESCE(brand_id,uuid-cero)), `T1600_hours_staffing_gaps`. Commits 65869c7/3c3a8d1/d8c9a85/fa406bb/81f64ab (rev-list 0). **PENDIENTE (frente futuro): "alarma de personal productiva"** — el aviso debe ser ACCIONABLE (resolver el hueco desde el aviso) y llegar a la persona responsable en 3 sitios (cuadrante=hecho, dashboard=no, campana). BLOQUEO campana-admin: los 3 admin tienen `employee_id` NULL → el sistema `employee_notifications` (por employee_id) no les llega → canal de notificaciones admin = frente propio. **(2) FOLVY SHOP — estado ABIERTO/CERRADO en Hub y carta** (la "puerta honesta", vía `is_brand_open` en algún local activo de la marca cruzando `brand_location_availability`; tarjetas cerradas atenuadas en grayscale + pastilla "Cerrado ahora"). RPC `shop_hub_by_slug` y `shop_brand_menu_by_slug` devuelven `is_open` (y la 2ª también `location_ids` de la marca). Migraciones T1700/T1800. **(3) MODAL DE CONFIGURACIÓN DE PLATO** (`DishConfigModal.tsx` + `dishConfigService.ts`): RPC `shop_item_config(slug, menu_item_id)` (migración T1900) devuelve el árbol — combo con slots (combo_slot/combo_slot_option, price_impact) + modificadores ANIDADOS (cada opción de slot que es menu_item arrastra sus modifier_group) + **ALÉRGENOS REALES por opción** (recipe_item→recipe_item_allergen→allergen, 14 oficiales). Modal panel partido tipo Last, precio EN VIVO recursivo, validación min/max que bloquea Añadir, alérgenos agregados de la selección. **GOLEA a Last** (que pone "contiene alérgenos" genérico). NOTA: opciones con `allergens:[]` = deuda de DATOS del cliente (faltan declarar en escandallo), no de código; **el Shop no debe cobrar hasta tener alérgenos completos (RGPD/RD 126/2015/Reglamento UE 1169/2011).** **(4) CARRITO CROSS-BRAND COMPLETO** (`src/modules/shop/cart/`): `ShopCartContext.tsx` (contexto + persistencia localStorage por slug + **REGLA MISMO LOCAL=una entrega**: el carrito fija el local con el primer plato, solo admite marcas que operen en él — patrón Otter/Glovo; marcas de Llorente29 en 3-6 locales, la regla es crítica), `CartPanel.tsx` (botón flotante 🛒 + panel "Tu pedido" agrupado por marca, líneas con config desplegada, cantidad editable), `AddedToCartSheet.tsx` (mini-panel tras añadir, jerarquía Pagar primario / **Ver otras marcas secundario destacado** / Seguir discreto — equilibrio comercial+conversión Baymard). ShopHubRoute envuelto en `ShopCartProvider`. **ANCLAS previstas (no construidas, para no rehacer):** descuentos/promos (line.discount+CartTotals.discount), pago multi-método (Bizum vía Stripe), cliente opcional (invitado→cuenta/fidelización vía Stripe customer), "te faltan X€ envío gratis" (necesita umbral+coste de zona, se activa en checkout). **(5) CHECKOUT — pasos ENTREGA y HORA, ESTILO B** (`src/modules/shop/checkout/`): Julio eligió **estilo B** (moderno tipo Glovo/Uber 2026, blanco+aire, coral solo acento) sobre el coherente-con-Hub, tras ver maquetas de ambos + maqueta del Hub en B (dijo "posiblemente se cambie TODO a ese estilo"). UNA sola página, secciones apiladas, responsive (timeline lateral→barra de progreso arriba en móvil; resumen sticky→barra inferior fija desplegable). `checkoutService.ts` reutiliza `geocodeAddress` de Mapbox del editor de zonas (mismo sistema, no se reinventa). **ENTREGA:** modo domicilio/recoger, **AUTOCOMPLETE con debounce** (sin botón Buscar, que Julio rechazó por anticuado), validación de zona `shop_check_delivery(slug, location_id, lat, lng)` (PostGIS `ST_DWithin` por radio; migración T1000 del 27), pedido mínimo con aviso. **HORA:** "Lo antes posible" como tarjeta protagonista con ETA real + "Programar" con **DESPLEGABLE nativo** (no parrilla de botones, que Julio rechazó por anticuada; en móvil = picker nativo), franjas de 30 min SOLO hoy que respetan el horario comercial vía `shop_delivery_slots(slug, location_id, eta, step)` (migración T1100; usa is_brand_open contra el local). **Selección en TINTA (negro), coral SOLO en el botón final** (decisión Julio: gastar el coral donde importa). Commits 6c31b35/3f78333/3b0dbfe/3ca455a/18b3744/486abf7/334843e (rev-list 0). RPC versionadas. **RECON Stripe (27/06):** el Stripe del repo (`stripe_customer_id`/`subscription_id` en `pricing_layer`, `platform/types.ts`) es del **SaaS de Folvy** (suscripciones de restaurantes), NO del cobro al comensal; para el Shop partimos de CERO (sin Edge de Stripe, sin claves). **AHORA (frente activo): checkout paso PAGO (Stripe Connect) — decisiones de negocio de Julio antes de construir (Connect vs cobro directo, cuenta Stripe test); luego INGESTA del pedido `folvy_shop`→KDS+stock+AvT+Catcher (trigger ya listo).** **DECISIÓN DE DISEÑO en cola:** migrar TODO el Shop a estilo B (Julio lo usa unos días; si confirma, frente propio con maqueta por superficie). **Lo anterior (2026-06-25, noche).** REPARTO A CATCHER + HUB PÚBLICO DE FOLVY SHOP. **(A) CATCHER (reparto last-mile) COMPLETO Y VALIDADO EN SANDBOX.** Folvy despacha el reparto a Catcher (broker last-mile de Llorente29) de forma TRANSVERSAL a cualquier canal, solo donde Last NO lo hace (guardarraíl anti-doble-aviso). Edge `catcher-dispatch` (recibe {sale_id, dry_run?, internal?}: lee venta→local de recogida→account_connector de Catcher del local→`connector_secret_read` del Vault→auth POST `staging-api.catcher.es/auth/v1/authorize` {appId,appSecret,grant_type:client_secret}→token→POST `staging-api.catcher.es/pitcher/v1/order` **v1, body OBJETO PLANO** con `orderCode` REQUERIDO+`externalId`=sale.id→guarda carrier_order_id de `data.response.orderId`, delivery_state='pending'; idempotente=no re-despacha si ya hay carrier_order_id; frontera interna por header `x-catcher-dispatch-secret`; desplegada `--no-verify-jwt`). **VALIDADA REAL en sandbox** (sale e9038182, Catcher aceptó status:true + orderId). Edge `catcher-webhook` (2 eventos: Orders cruza por externalId/carrier_order_id→guarda delivery_state/rider_name/phone/transport_price; HD home_delivery_status_changed solo loguea; `--no-verify-jwt`); URL pendiente de registrar en Catcher (panel sandbox roto→email a it@catcher.delivery). Disparo automático: trigger `tg_auto_dispatch_catcher` AFTER UPDATE ON sale WHEN order_status cambia, guardarraíl CUÁDRUPLE (source='folvy_shop' AND order_status='accepted' AND carrier_order_id IS NULL AND modo='auto'); usa `net.http_post` a catcher-dispatch con secreto interno (patrón de trg_sale_push_status). Conector Catcher CONECTADO en producción (local Alcalá, account_connector ebc967ba, config location_id de Catcher). **Fix colateral:** activación de conectores tipo `credentials` (antes no creaba account_connector→botón Guardar gris; ahora lo crea al guardar credenciales — desbloquea TODOS los conectores). BD: `sale` ganó carrier_code/dispatch_mode/delivery_state/carrier_order_id/transport_price/rider_name/rider_phone/eta_pickup/eta_delivery/dispatch_error (migración 20260625T1800). `connector_secret_read(uuid)` SECURITY DEFINER lee el Vault (REVOKE public, GRANT service_role; migración T1900). Commits adbb393/309387f/84be66c/933d05d/0f63c06 (rev-list 0). **DEUDA:** hoy el disparo solo es `folvy_shop`; al entrar Llorente29 en HubRise → pasar a configurable por canal. CREDENCIALES SANDBOX en Vault (rotar al pasar a prod): app_id LF0aacd66e + secret + location_id 458e437e...; secreto interno del trigger `fv_catdisp_...` (anotado para rotación). **(B) HUB PÚBLICO DE FOLVY SHOP (`/t/:slug`).** Escaparate público multi-marca (la tienda online propia de un cliente, multimarca con carrito cruzado). Diseño "FRESCO URBANO tipo Glovo modo claro" APROBADO por Julio tras varias maquetas HTML (rechazó la versión oscura plana y una primera fresca genérica). Ruta montada en `App.tsx` ANTES de los gates de sesión (hermana de /cocina-tv, /estacion): `if pathname.startsWith('/t/') return <ShopHubRoute />`. RPC `shop_hub_by_slug(p_slug)` v3 SECURITY DEFINER (GRANT anon): devuelve account_name+slug+hero_url+tagline (de `accounts.shop_hero_url`/`shop_tagline`), brands[] (brand_id, name, **logo_url de brand.logo_url**, hero_url+accent_color+rating=seed_rating+rating_count de `shop_theme` WHERE hub_visible AND is_published, ordenadas por hub_position), delivery_info (eta_min/delivery_fee_min/min_order mínimos de `delivery_zone` activas — son por LOCAL no por marca, comunes a las marcas que comparten cocina). Front `src/modules/shop/ShopHubRoute.tsx` (estilos inline, iconos SVG inline NO librería, paleta crema/coral/amarillo): top bar sticky, HERO con imagen real de portada (`shop_hero_url`) + capa oscura + slogan configurable (`shop_tagline`, parte tras el punto con subrayado amarillo rotado), franja de info 4 items, chips de categoría, fila "Lo más pedido hoy", rejilla de marcas con LOGO REAL en chip rectangular + badges (tiempo/Gratis) + valoración + categoría + tags, carrito lateral sticky 380px. `shopHubService.ts` mapea snake→camel. **SLUG de Llorente29 = "foodint"** (su marca pública de cara al cliente, NO "llorente29"). Imagen de portada subida a Storage (bucket account-logos, `portada foodint.jpg`). Migraciones 20260625T2100/T2150(seed_rating)/T2200(v2)/T2250(accounts shop fields)/T2300(v3) — árbol autosuficiente con if-not-exists. Commit 2f6e17c (rev-list 0). **DEUDA HUB (Julio cerró "muy a su pesar", a retomar como frente propio):** muchísimo dato es de MUESTRA por conectar a real — chips de categoría no filtran (no hay tipo de cocina por marca en BD), "lo más pedido" 6 platos fijos (falta catálogo de platos por marca), badge "Gratis"/valoración cuando rating null/categoría derivada del nombre/tags = inventados, corazón fav + buscar + entrar + dirección + carrito = NO funcionales; solo 8 de 17 marcas con is_published; layout no convence (Julio: "hemos ido para atrás", "cualquier parecido es casualidad"). Siguiente ladrillo natural = carta de marca `/t/:slug/:brandId` (el href ya está)→carrito funcional cross-brand→checkout+pago (Stripe Connect)→pedido Shop entra por ingesta canónica (`external_source='folvy_shop'`)→KDS+stock+AvT+**dispara Catcher** (el trigger ya está listo). **MODELO VALORACIONES aprobado (frente futuro):** semilla = importar la nota real de Glovo/Uber por marca a `shop_theme.seed_rating`/`seed_rating_count` (campos ya creados), mostrar como "valoración del restaurante" (no engañar sobre origen), media ponderada que con reseñas propias entrantes pasa a 100% propia; sistema de reseñas propio = frente aparte. **HORARIO COMERCIAL DE TIENDA** (abierto/cerrado al cliente, "Abierto ahora·cierra a las X") NO EXISTE en BD — `schedules` es el cuadrante de PERSONAL, distinto; frente futuro: crear horario comercial de tienda. BENCHMARK del Hub: Zuppler (multi-marca supercart con entrega única), ChowNow/BentoBox (mono-marca DTC), Glovo/Uber (patrón UX que el cliente final ya conoce — fusilar el patrón, no la marca). **Lo anterior (2026-06-24, noche).** TICKET DE FACTURA/BOLSA v2 = MOTOR DE IMAGEN (clon de Last, EN VIVO). Frente: el ticket de texto ESC/POS tenía techo de calidad (fuente matricial pobre, 3 tamaños, € y acentos que la NT311 CORROMPE por codepage — probado CP858/WPC1252/0xD5, todos fallan: la NT311 borra bytes altos). DECISIÓN (Julio, innegociable): el ticket de Folvy debe ser INDISTINGUIBLE de uno de Last (tipografía, tamaños, orden, logo protagonista) — diferencia de imagen = 0. SOLUCIÓN: renderizar la factura/bolsa como IMAGEN (canvas) y mandarla como RÁSTER ESC/POS (GS v 0 en tiras de 128px). Así € y acentos perfectos, tipografía real, y AGNÓSTICO de impresora (cualquier térmica imprime bitmap). **CONSTRUIDO Y VALIDADO EN PAPEL (Milanesa House reparto propio):** logo protagonista (~80% ancho, autocrop del margen + escalado PROPORCIONAL sin deformar, tope alto 190px para logos cuadrados; el logo es sagrado, NUNCA se estira), razón social/CIF/dirección, banda del código, **dirección de cliente DESGLOSADA en campos** (Dirección/Detalles de dirección/Código postal/Número de teléfono, mapeados de `raw_tab.delivery` {address,details,postalCode}), productos con tachado de descuento, **tabla IVA (10% hostelería, legal — verificado: comida elaborada por delivery va al 10% sea cual sea el canal/agregador; la comisión del agregador es factura aparte al 21%, NO va en el ticket)**, Total grande, QR de la marca (brand.shop_url+qr_caption) y **PIE PUBLICITARIO Folvy** (logo isotipo+"Hecho con Folvy · folvy.app"; soporte de marketing en el ticket). **PIEZAS NUEVAS:** (SQL, vivas en BD, SIN versionar=DEUDA) `sale_line.original_unit_price`+`discount_label` (descuento por línea CANÓNICO multi-TPV); `fill_line_discounts(sale_id)` (Last: `raw_products[].fullPrice`/`finalPrice`/`discountAmount` céntimos→corrige unit_price/line_total al final pagado + original al tachar; HubRise: `raw_tab.items[].full_price`/`price` vía `hubrise_money`; casa por `external_product_id`, solo product+parent NULL); `order_for_print` ahora llama `fill_line_discounts` just-in-time + devuelve original_unit_price/discount_label/`delivery_detail` (raw_tab.delivery); `fiscal_for_print(token,sale_id)` (legal_name/cif/billing_address de `accounts` + número de `raw_tab.bills[0].number`, p.ej. LS3-1698, provisional hasta VeriFactu). **AGENTE v3** en `C:\folvy-print-agent` (FUERA del repo): NUEVO `ticketImage.js` (renderiza la factura con `@napi-rs/canvas`, fuentes DejaVu INCRUSTADAS=idéntico en cualquier PC, QR con lib `qrcode`, autocrop+escala del logo); `folvy-print-agent.js` v3 (la factura/bolsa va por IMAGEN→`canvasToEscpos`→ráster; cocina y pegatinas SIGUEN por texto ESC/POS `renderForType`; carga logo de marca por URL con cache + logo Folvy del pie local). Dependencias nuevas en la carpeta del agente: `@napi-rs/canvas`+`qrcode` (npm install). Ficheros nuevos a colocar: ticketImage.js, folvy-print-agent.js, DejaVuSans.ttf, DejaVuSans-Bold.ttf, folvy_pie.png. **MÉTODO de prueba (sin botón aún):** INSERT directo en `print_job` (status 'pending', payload `{mode:by_order,sale_id}`) salta la guarda SECURITY DEFINER de `enqueue_print_job` (que en SQL Editor da \"sin acceso\" por `auth.uid()` null). **DEUDA declarada:** (1) TODO el SQL de impresión sigue SIN versionar (printer/print_job + RLS, claim/report/enqueue, order_for_print, fiscal_for_print, fill_line_discounts, tg_auto_print_on_accept) y el agente fuera del repo — sesión dedicada. (2) **BOTÓN DE REIMPRESIÓN/MANUAL** desde la app (hoy se encola a mano por SQL; Julio lo pidió, imprescindible). (3) Cocina y pegatinas TODAVÍA por texto ESC/POS (no por imagen) — pasarlas al mismo motor de imagen queda pendiente. (4) Numeración fiscal propia VeriFactu (hoy el número es el de Last, provisional) — frente fiscal aparte. (5) Tabla IVA hoy 10% fijo (correcto para Llorente29; el motor de IVA versionado por fecha cubriría una eventual subida). (6) `database.ts` (printer/print_job) sin regenerar. **Lo anterior (2026-06-21, CIERRE 3 · noche).** ESTACIÓN DE TABLET + IMPRESIÓN FÍSICA AUTOMÁTICA — dos hitos en producción/vivo. **(A) ESTACIÓN DE TABLET (`/estacion`):** terminal de cocina a pantalla completa por TOKEN de dispositivo (mismo `kds_device` que el kiosco), 3 pestañas SIEMPRE visibles —Pedidos · Cocina · Disponibilidad/86— abre por defecto en Pedidos; ruta pública montada en `App.tsx` ANTES de los gates de sesión (hermana de `/cocina-tv`). 3 capas: (1) `TabletStationRoute.tsx` (calca `KdsKioskRoute`; la pestaña Cocina monta `KdsBoard` con token); (2) Disponibilidad/86 por token (RPC `set_product_availability_by_token` + `availability_panel_by_token` que NO delega en la versión con guard de sesión sino que REPLICA el SELECT validando solo token, + `search_products_by_token` + `preview_scope_by_token` + `device_location_by_token`; front `tabletAvailabilityService.ts` + `TabletAvailabilityTab.tsx`, panel oscuro táctil agotar/reactivar con alcance); (3) Pedidos por token (`orders_feed_by_token` + `set_order_status_by_token`; `OrdersFeed.tsx` acepta token, vive del polling 10s sin realtime). EXTRAS: QR+URL de la estación en `DevicesSettings.tsx` (lib `qrcode`); `manifest-estacion.json` propio (start_url=/estacion, tema oscuro) apuntado dinámicamente por la ruta → "Añadir a inicio" crea un icono que abre la estación, no la raíz con login. Commits hasta `43695e6` (rev-list 0). LECCIONES: el navegador NO abre sockets TCP; PWA `start_url` global=/login y el manifest dinámico lo resuelve; una RPC con guard `auth.uid()` NO se delega desde otra RPC por token (replicar el SELECT); logos con texto azul se funden en fondo oscuro → isotipo+texto blanco. **DEUDA: las RPC by-token de la estación NO están versionadas en `supabase/migrations/` (solo vivas en BD).** **(B) IMPRESIÓN FÍSICA AUTOMÁTICA FUNCIONANDO EN VIVO:** cadena completa validada —pedido se ACEPTA → trigger `tg_auto_print_on_accept` encola → agente lee por token → ESC/POS → NT311 por LAN → papel— SIN nadie con Folvy abierto. Arquitectura AGNÓSTICA multi-transporte (`printer.transport`: sunmi_cloud, escpos_network [montado hoy], epson_epos, bluetooth, browser_pdf; `printer.config` jsonb lleva ip/port/sn; NO depende de Sunmi). **Modelo en BD (sin migración aún):** `printer`(account_id, location_id, name, transport CHECK, doc_types text[], config jsonb, is_active) + `print_job`(account_id, location_id, printer_id, sale_id, doc_type, payload jsonb INMUTABLE, status pending/sent/done/error/cancelled, source auto/manual/reprint, attempts, last_error, sent_at, done_at) con RLS calcada de `kds_device` (SELECT `belongs_to_account`, escritura `current_user_is_admin_or_manager_of`). Impresora registrada: `0a0ada19-f82a-4d77-857d-9d1707d1f490` "NT311 Plaza Castilla" config `{ip:192.168.1.86,port:9100}`, doc_types [bag,kitchen,labels]. **AGENTE Node.js en `C:\folvy-print-agent` (FUERA del repo):** `escpos.js` (TicketDoc→bytes ESC/POS, corte GS V 1, WIDTH 48, acentos→ASCII en capa 1), `ticketRenderer.js` (PORT JS del `ticketRenderer.ts` del front; el agente DIBUJA, no la BD = Camino 2: reutiliza la lógica del front, no se duplica en SQL), `folvy-print-agent.js` (claim → si `payload.mode=by_order` pide `order_for_print` y dibuja → TCP `ip:9100` → report; rpc() robusto ante respuesta vacía; carga `.env` sin deps). **RPCs (GRANT EXECUTE a anon las del agente):** `claim_print_jobs(token, limit)` (FOR UPDATE SKIP LOCKED, marca 'sent'), `report_print_job(token, job, ok, err)`, `enqueue_print_job(account, location, sale, doc_type, payload, source)` (guard manager, encola por impresora del local cuyo doc_types contiene el tipo), `order_for_print(token, sale_id)` (un pedido completo por token, espejo de `orders_feed_by_token`). **Trigger `tg_auto_print_on_accept`** en `sale` AFTER UPDATE: al pasar `order_status`→'accepted' (no 'new': Glovo puede cancelar antes) encola un job ligero `{sale_id, mode:'by_order'}` por cada impresora×doc_type del local; solo dispara con cambio real (`old IS DISTINCT FROM new`) — para reimprimir hay que pasar por otro estado y volver a accepted. **CLAVE API:** el proyecto usa el formato NUEVO de claves Supabase (`sb_publishable_...` pública para el agente; la legacy `eyJ...` da 401; `sb_secret_...` jamás en el agente distribuido). La NT311 imprime en LAN sin cloud (Ethernet, puerto 9100); doble-click en el botón de pairing imprime su IP. **DEUDA CRÍTICA (primero a hacer al retomar): TODO el SQL de impresión (printer/print_job + RLS, claim/report/enqueue_print_job, order_for_print, tg_auto_print_on_accept) y el AGENTE están SIN versionar — vivos en BD / fuera del repo. Regenerar `database.ts` (printer/print_job).** **PENDIENTE/AHORA:** afinar layout de los 3 tickets (bolsa y cocina muy pequeños/ilegibles, tamaños ESC/POS bajos no aprovechan los 80mm; pegatinas sin alérgenos) — pulir EN VIVO con foto de tickets reales; **BOTÓN DE REIMPRESIÓN/MANUAL a voluntad** (Julio lo pidió, imprescindible). **CAPA 2:** iconos gráficos (moto, alérgenos, logo) = bitmap ESC/POS desde PNG. Sunmi partner SOLICITADA (Company "Llorente29 Food", Spain, Brand "Folvy") en revisión, para el transporte cloud futuro (la impresora tira sola, ideal multi-cliente sin tocar las tablets). El código de plataforma YA estaba resuelto (deuda anterior saldada): `sale.platform_order_code` poblado al 100% (Glovo nº largo, Uber corto), `pickupCode()`+`platformRef()` en `ticketRenderer`. **Lo anterior (2026-06-21, CIERRE 2):** CATÁLOGO LLORENTE29 COMPLETO desde Last — frente que Julio declaró BLOQUEANTE de todo ("sin cartas fiables no se avanza a HubRise/86/escandallos"). Build verde, commit 24f7961, push 0 0. **IMPORTADOR `scripts/import-last-catalog.mjs`** (genérico `--account`+`--org`; dry-run por defecto, `--run` escribe; idempotente por matrícula `organizationProductId`↔`menu_item.external_id`; `--catalog-overrides file.json` fuerza catálogo base por marca; `--debug` vuelca árbol+JSON crudo). Trae de Last: categorías (emoji a columna), productos (foto Cloudinary directa, descripción, vat, precio), precios por canal→`menu_item_override`, modificadores, combos+slots+opciones. NO crea `recipe_item` (es la carta, no el escandallo; `recipe_item_id` NULL). **4 BUGS cazados y arreglados:** (1) **cruce de marcas + sin categoría** — el "paso de componentes de combo" inyectaba productos del ORG catalog (`/organizations/{org}/catalog`, `course` genérico que MEZCLA marcas, ej "La Doble by Chivuos" en Dos Coyotes) con `catExtId=null` → ELIMINADO; la categoría sale SIEMPRE de la membresía del catálogo BASE (`/catalogs/{id}` `categories[].products[]`), NUNCA del `course` del org catalog. (2) **PRODUCTO COMPARTIDO entre marcas** — bebidas/postres (Coca Cola `d1116bc9`, Fanta, Tres Leches) tienen la MISMA matrícula en N marcas; el script keyaba por matrícula sola→colisión→solo se creaba en la 1ª marca (Big Mike's), dejando BEBIDAS/POSTRES vacías en las demás → clave compuesta `pkey(marca,matrícula)` en TODO el flujo (`inUseProducts`/`exItem` vía `loadExistingByBrandExt` por brand_id+external_id/`channelPrices`/`itemMapFolvy`); un producto físico→N `menu_items` (uno por marca con su nombre/precio), `external_id`=matrícula común (casado intacto); `recipe_item` compartido = eslabón siguiente; modelo nuclear Julio "desconectar Coca Cola una vez la apaga en TODAS las marcas" (requisito del 86); trampa cazada: separador de clave NUL vs espacio. (3) **combos vacíos `slot opciones:0`** — en `oc.categories[].products[]` el campo `p.productId` YA ES la matrícula; el código la convertía vía `orgProductById`→∅ → usar `p.productId` directo. (4) **app no mostraba combos en su categoría** (los ponía en sección "Combos" aparte, sin foto, no editables) — `brandCatalogService.listCategoriesWithProducts` filtraba `product_type='item'`; quitado→combos viven en su `menu_category_id` como un item más, foto, click→`CatalogProductDetailPage` editable, chip "combo"+N slots (`KitchenMenuPage`+`brandCatalogService`, build verde). **MÉTODO validado y aplicado a ESCALA por org:** por marca borrar (transacción: `sale_line.menu_item_id=NULL` conserva venta; delete `menu_item_override`/`modifier_group_assignment`/`combo_slot[combo_item_id]`/`combo_slot_option`/`external_product_map`; delete `menu_item` — SIN temp table, el SQL Editor ejecuta statement a statement) → `--run` org → verificar `sin_categoria=0` → recast. (App NO filtra `archived_at` en página Menú → archivar no limpia visualmente → se usa borrado físico; el menú es de hoy, sin histórico valioso; el dato de venta nunca se pierde, solo el puntero, reversible por recast.) **RESULTADO: 17 marcas Llorente29 completas y fiables, idénticas a Last** (8 cedidas Cloudtown `b7bc4753`: Big Mike's 42, Chivuos 41, Dos Coyotes 36, Milanesa Haus 33, Koreans 34, Deep Pizza 23, Birria 22, Ay Mamita 20; 9 propias Foodint `31f13f35`: Meraki 31, Urban Kebab 27, Bendito 27, Scandal 27 [override Glovo `a8315f2a` en `catalog-overrides.json`], Lobbers 22, Smash 23, Mila's 23, Milanesa House 29, Dirty Burger 21). **TODAS `sin_categoria=0`.** 12 cedidas sin catálogo extraíble se ignoran (Llorente29 no las opera; incluir solo si futuro tienen catálogo). Marcas técnicas descartadas: FOODINT, Tienda Pza Castilla, Chivuos/Koreans propias (0 prod). **Casado 93,8%→87,8% (estable)** porque ventas de productos descatalogados (matrícula vieja) quedan descasadas tras recrear; el DATO de venta se conserva (importe/fecha/plataforma, para comisiones da igual), solo falta el vínculo a producto, recuperable con mapeo matrículas viejas→nuevas si interesa el margen histórico. **CLAVE descubierta:** el token de Folvy SÍ ve Cloudtown (cedidas) — el problema nunca fue el token, era pasar bien el `organizationID`. **DESBLOQUEA 86 + HubRise cliente 2 + escandallos faltantes.** Para cliente 2: mismo importador sirve para sus cedidas CTB (misma org Cloudtown, mismo molde) verificando token+que las brand existan; sus propias (Otter) NO van por aquí. **PENDIENTE:** el detalle del combo no lista aún sus componentes (la ficha dice "sin modificadores"; follow-up fácil sobre `CatalogProductDetailPage` leyendo `combo_slot`+`combo_slot_option`). **Lo anterior (2026-06-19, CIERRE 2 · noche):** FRENTE DE IMPRESIÓN DE TICKETS — primera fase en producción (build verde, push 0 0). **Diseño aprobado** en `docs/folvy_impresion_diseno.md`: capa agnóstica ESC/POS + adaptadores de transporte (como TPV/canales); 3 documentos (bolsa/cliente con logo+QR, cocina por categoría SIN alérgenos, pegatinas opción (c)=una por artículo de comida + una agrupada bebidas/postres). Benchmark: Last (referencia de los 3 docs, capturas validadas), Toast/Square (estándar ESC/POS multi-transporte), Sunmi. **DEPENDENCIAS HECHAS:** **D1 logo por marca** (`brand.logo_url` ya existía; bucket `brand-logos`+RLS calcada de account-logos, path `{accountId}/{brandId}/`; `brandLogoService.ts`+`BrandLogoUploader.tsx`+montado en `BrandDetailView`; verificado en vivo con Mila's; commit cc9a944). **D2 URL shop+caption QR por marca** (`brand.shop_url`+`brand.qr_caption`; tipos+`brandsService`+campos editables en `BrandDataTab`; commit 963ffbd). **D3 iconos oficiales de alérgeno UE** (14 PNG en `public/allergens/allergen-{code}.png`, set MAKRO-style icono+nombre = cumple "icono+leyenda" que pide la ley, NO existe set "oficial" único; `AllergenIcon.tsx`; **FIX `soybeans`→`soy`** en `allergens.ts`: el front declaraba 'soybeans' pero la BBDD usa 'soy', no casaban; commit 963ffbd). **NÚCLEO:** **paso 1** = `orders_feed` ampliado (cabecera de marca: `brand_logo_url/color/shop_url/qr_caption/ownership_type`; líneas: `family` vía **`recipe_family`** —NO `dish_family`, verificado contra BBDD tras romper el feed una vez—; combo_item con su familia; migraciones `20260619T1600`+`T1700`; commits 30f2e49+59dc419). **RENDERIZADOR capa 1** (`src/modules/orders/lib/ticketRenderer.ts`): modelo intermedio `TicketBlock` → 3 documentos (texto+estructura+QR); `renderLabels` **aplana combos** (cada componente = artículo físico) y **expande qty** (2 pitas = 2 pegatinas), bebidas/postres por familia a su bolsa, cuenta N de M real. **PREVIEW** (`TicketPreviewModal.tsx`): pinta los 3 docs como papel térmico 80mm en pantalla, QR vía lib `qrcode`; botón impresora en `OrderCard`. Validado en vivo con pedidos reales (Combo DÚO Meraki Pita = 4 pegatinas correctas; multiplicador 2x pita = 2 pegatinas). **DEUDAS DECLARADAS (frente siguiente):** (1) **CÓDIGO DE PLATAFORMA REAL** — el código grande del ticket (#XXXXX) es un RECORTE de UUID, NO el G406 de Glovo / código Uber-JE que el rider pide; está enterrado en `raw_tab` sin extraer; hay que sacarlo a columna `sale.platform_order_code` (adaptador `lastapp-webhook`) + exponerlo en feed + ticket; OJO: G406 es formato Glovo, Uber/JE usan códigos largos distintos (no uniforme). (2) **CAPA 2 = imágenes** (logo de marca + iconos de alérgeno rasterizados a bitmap ESC/POS; hoy salen en texto). (3) **MODELO `printer`/`print_job`** + (4) **ADAPTADOR SUNMI NT311 Cloud Partner** (transporte decidido: la impresora cloud tira de Folvy vía MQTT+HTTPS; requiere registro en partner.sunmi.com, APP_ID/APP_KEY, activar región EU, exponer URL de Folvy, vincular SN; tiene fricción real — sesión dedicada). **Lo anterior (2026-06-19, CIERRE 1):** MÓDULO FOLVY ORDERS — CIERRE MAYOR: feed operativo multi-canal (propias+cedidas) en producción, validado en vivo con Glovo. Fusión Orders+KDS (ba89312); A1 feed canónico (d70dae4+63d2c54); Last como ADAPTADOR del feed (87c1a4e); ruta completa+empuje a Last vía toggle `push_status_enabled` (b885e48); escandallo al pulsar = Cook Mode del KDS (0492702); marcar línea sincronizada con KDS vía `kds_line_state` (ae88d20); **#7 PUENTE KDS→FEED = ARQUITECTURA DEFINITIVA DEL EMPUJE (Opción A): mover `order_status` → trigger `trg_sale_push_status` → `net.http_post` fire-and-forget a Edge `order-advance` → Last → Glovo; FUNCIONA DESDE EL KIOSCO DE COCINA sin usuario** (0f6cce8); 7a CICLO DE VIDA POR TIPO DE REPARTO (plataforma se cierra al recoger el rider y NO empuja el cierre = evita INVALID_STATUS_CHANGE; pickup/propio con sus botones) (6c1d80d). DECISIONES: UNA tablet Folvy para propias+cedidas; escandallo de cedidas OBLIGATORIO (Folvy controla su stock); toggle de empuje POR ORGANIZACIÓN; migración de escandallos cedidos = frente pendiente. **Lo anterior (2026-06-18, 2ª sesión):** OVERRIDES (precio/margen por canal) CONSTRUIDOS + CICLO DE VIDA DEL PEDIDO fase 1 EN PRODUCCIÓN (validado en vivo) + diseño en papel de la pestaña Pedidos. Todo en producción, build verde, esquema con UNA columna nueva (`sale.order_status`). **(1) OVERRIDES:** el motor `menu_item_economics` estaba MUERTO (INNER JOIN por `channel_id` con todos los productos en canal NULL → no devolvía nada; `service_type` global imposible con canales mixtos). Reescrito server-side `menu_item_channel_economics(p_menu_item_id, p_overrides)` (una fila POR CANAL; service_type por canal; precio efectivo preview‖override‖base; comisión `brand_channel_rate`‖`channel_rate`; reproduce `baseFromGross` al céntimo → `contribution_margin`+`net_margin`); `set/clear_menu_item_override` (DEFINER con guard, ON CONFLICT sobre la expresión exacta del índice único). `menuOverrideService.ts`+`EditPricesModal.tsx` (precio por defecto + fila por canal con 86 toggle y **margen neto en vivo** al teclear)+`CatalogProductDetailPage` jubila el cálculo cliente. Validado al céntimo (Glovo 8,12€/JustEat 7,79€/Shop 10,65€/Uber 7,11€). Migración `20260618T2300_menu_item_channel_economics.sql`, commit c1b6d4a. **86 automático por stock** y **precio por LOCAL** = capas declaradas sobre el mismo motor. **(2) CICLO DE VIDA DEL PEDIDO fase 1 EN PRODUCCIÓN, validado en vivo (#RP65P received→accepted en HubRise + `order_status='accepted'` local):** `sale.order_status` = estado del PEDIDO DE PLATAFORMA (new/received/accepted/in_preparation/awaiting_collection/in_delivery/completed/rejected/cancelled/delivery_failed), **separado del `sale.status` contable** (open/closed/cancelled, intacto) + CHECK + siembra desde `raw_tab.status` (migración `20260618T2400_sale_order_status.sql`). Webhook `hubrise-webhook` espeja `order_status` en update/cierre/cancelación (`mapOrderStatus`, solo valores del CHECK). Edge de SALIDA `hubrise-order-status` (PUT `/location/orders/:id` a HubRise con cabecera **`X-Access-Token`** —verificado en la doc de HubRise, NO Bearer—; autoriza por RLS leyendo la venta con el JWT del usuario; espeja `order_status` SOLO si HubRise da 2xx; deploy SIN `--no-verify-jwt` por ser de cara a la app). Token OAuth de la location `zy9j2-0` en Secret `HUBRISE_ACCESS_TOKEN` vía flujo **`oob`** (`location[orders.write]`; el cliente "Folvy" exige redirect → `oob` muestra el code en pantalla; canje con Basic client_id:client_secret). Commit 5f78aa7; `database.ts` regenerado. **(3) Investigación HubRise volcada a `docs/folvy_catalogo_publicador_diseno.md`** (§10 operación API: ciclo de vida + reglas por plataforma [Uber<10min auto-cancela y soporta auto-aceptación / Glovo no cancela tras aceptar / JustEat min=accepted], pausa `order_acceptance`+`resume_at`, 86=inventario por sku/opción, precio/86 por canal=variants; §11 benchmark Order Manager de Last [feed+semáforo+detalle+Catcher]; §12 desbloqueado vs P-A). Commit a19b232. **(4) DISEÑO EN PAPEL pestaña Pedidos (fase 2)** `docs/folvy_pedidos_pestana_diseno.md` (commit 042a506): feed cuadrícula/lista+filtro+semáforo (realtime), detalle con contenido completo (líneas+modificadores+combos+**ALÉRGENOS de escandallo**, que las plataformas no muestran), acciones del ciclo de vida con reglas por plataforma, **AUTO-ACEPTACIÓN configurable por canal/marca** (Uber lo soporta; Folvy empuja `accepted` al recibir; guardarraíl horario+stock). Maquetas mostradas. **DEUDA declarada:** token multi-location = tabla `hubrise_integration` (P-A/CP2; hoy 1 Secret cubre la location de pruebas; el Edge ya lee `external_location_text` para enchufarla sin reescribir). **P-A (¿una conexión por marca? + ¿pausa por canal?) esperando a Janaina** (borrador de 2º correo de seguimiento preparado). **CORRECCIÓN del cierre anterior:** la "DEUDA NUEVA: versionar SQL de HubRise" YA estaba saldada (`adapt_hubrise_order`/`hubrise_money`/`reprocess_sale` en `20260617T2350`; `close_sale`/`cancel_sale` en `20260613T1900`). **SEGURIDAD:** rotación pendiente de `service_role`+tokens de webhook (arrastre); el access token de HubRise vive en Secrets, no en chat. **Frente activo = construir la pestaña Pedidos (fase 2)** (4 decisiones del §9 + RECON del §8 antes de UI). **Lo anterior (2026-06-18, 1ª sesión):** HUBRISE VIVO DE PUNTA A PUNTA + MÓDULO DE GESTIÓN DE CARTA POR MARCA (crear · organizar · reordenar · ficha-cockpit) + MODELO base+override CONFIRMADO POR DATOS + HALLAZGO: el motor de margen por canal está muerto. Todo en producción/build verde, esquema **intacto** (cero migraciones esta sesión). **(1) HUBRISE de punta a punta:** corregido el bug HMAC (la frontera validaba base64 cuando HubRise firma en **hex**) en `supabase/functions/hubrise-webhook/index.ts`; cuenta de pruebas "Folvy Test" (zy9j2), location zy9j2-0, catalog mm92j; 2 clientes OAuth ("Folvy" 598759333895 lectura + "Folvy Injector" 155453763266 inyección de pedidos de prueba); pedido de prueba entra por la ingesta canónica (`external_source='hubrise'`)→KDS+stock+AvT. Diseño aprobado del **Publicador de Catálogo** (`docs/folvy_catalogo_publicador_diseno.md`). **(2) MÓDULO DE GESTIÓN DE CARTA** (sobre `menu_category`+`menu_item`, sin tocar esquema): crear categorías/productos, organizar (mover/recategorizar uno o en bloque con Deshacer), reordenar/plegar/borrar categorías y productos (flechas ↑/↓, no drag&drop), y **FICHA-COCKPIT** = el mismo producto en **varias marcas** + su categoría sin salir de la ficha (clave para marcas virtuales: una receta de la cuenta, un `menu_item` por marca con su PVP — 33 recetas ya están en >1 marca, el modelo ya era el correcto, faltaba la herramienta). **(3) MODELO base+override CONFIRMADO POR DATOS:** los `menu_item` viven con `channel_id` NULL (fila base, precio por defecto) y el precio por canal vive en `menu_item_override` (producto×canal×local); NO existe junction N:N de categorías ni `menu_item_location`. **(4) HALLAZGO CRÍTICO:** `menu_item_economics` hace INNER JOIN por `channel_id` y NO lee `menu_item_override` → con todos los productos en canal NULL **no devuelve nada**: el margen por canal server-side está MUERTO; la ficha lo calcula en cliente pero con el MISMO precio base para todos los canales (solo varía la comisión). → define el frente siguiente: **Overrides** = reescribir el motor en SQL (fila por producto×canal con precio override‖base + comisión del canal) + servicio de overrides + modal "Editar precios" con margen real al teclear + jubilar el cálculo cliente. **DECISIÓN registrada:** precios de sala/terraza/barra (cuando llegue el TPV propio) NO son modelo nuevo — son **canales** (`sales_channel` type 'dine_in') y su precio vive en el MISMO `menu_item_override`; el recargo de terraza será una **regla** (% o fijo sobre base, estilo `channel_rate`), no plato a plato. **DEUDA NUEVA:** versionar en `supabase/migrations/` el SQL de HubRise aplicado-no-versionado (`adapt_hubrise_order`, `close_sale`, `cancel_sale` + migración HubRise); añadir `catalog_source` ('folvy'|'pos') a `brand` en CP2. **Lo anterior (2026-06-17, 2ª sesión):** MÓDULO ALMACÉN COMPLETADO + AvT (TEÓRICO VS REAL) + FRENTE ② NIVELES (BASE MRP II) + FICHAJE RESUELTO EN DOS CAPAS. Todo en producción, build verde, rev-list 0. (1) **AvT — EL GRAN DIFERENCIADOR** en dos formas: PUNTUAL (lee el último `inventory_count` aprobado: teórico vs real vs € perdido, con SALUD DEL DATO y CAUSA PROBABLE por línea; % silenciado si teórico≤0) y POR PERIODO CONSOLIDADO (RPC `avt_period`: inicial[último conteo antes del periodo o apertura del ledger "estimado" avisando]+compras−consumo=teórico; merma=teórico−real final; universo=artículos con conteo final en el periodo; SOLO medibles suman = honestidad; pivota en Local/Almacén/Familia/Artículo + filtro de periodo). Cierra el frente 5 (inventario perpetuo cierra el AvT). Doc `docs/folvy_avt_diseno.md`. Migración `20260617T2000_avt_period_engine.sql`. (2) **FRENTE ② NIVELES min/par = BASE DEL MRP II**: tabla `stock_level` (item×local; UI activa min/par + reorder_point/lead_time_days/safety_qty LISTOS sin usar para el nivel vivo futuro); RPC `stock_levels_overview`+`set_stock_level` (gestiona solo min/par sin pisar campos MRP); pestaña Niveles (bajo-mínimo arriba, "repón X"=par−stock que alimenta el To-Par del order builder) + min/par en la ficha del artículo por local. Migraciones `20260617T2100_stock_levels.sql`+`T2200_set_stock_level_fix.sql`. (3) **FICHAJE RESUELTO EN DOS CAPAS**: (a) MANUAL FIABLE del manager — `handleClock` en StaffPage reescrito: antes solo tocaba estado local (no escribía BD); ahora escribe vía `addClockEntry`, `source='manual'`+MOTIVO obligatorio+autor (en `address`=rastro legal), sin GPS del manager ni bloqueo por horario; (b) DE RAÍZ — `locations` gana `clock_radius_m`(200) y `clock_geofence_mode`('block'|'warn'); `FichajeEmpleado` lee radio/modo del local (no el 1000 fijo); modo 'warn' deja fichar con GPS caprichoso marcando "Fuera de zona · Xm" → resuelve a Natacha (GPS la sitúa a 1.848m estando dentro) SIN manual, y cubre Plaza Castilla/Carabanchel que NO tienen coords. UI en LocationsPage. Migración `20260617T2300_clock_geofence_config.sql`. Commits e829260, 1e21e53, 748db53, 7e86e25, 699dec1, b176bf3, 8cdb558 (todos rev-list 0); database.ts regenerado. **Tarjetas del Resumen "Bajo mínimo" y "Desviación·AvT" ya encendidas** (eran "Próximamente"). **IDEA JULIO (SIGUIENTE): NIVELES VIVOS por consumo** (par=consumo medio×días entre pedidos; min=consumo×lead time+seguridad) sobre la tabla `stock_level` ya lista — faltan frecuencia de pedido + lead time fiables. **PENDIENTE validación: Julio pone Foodint Alcalá en 'warn' y verifica que Natacha ficha sola; salida de Natacha de hoy con el botón manual.** OBLIGATORIOS A-C del 12/06 siguen abiertos. **Lo anterior (2026-06-17, 1ª sesión): MÓDULO ALMACÉN ESTRUCTURADO (5 secciones) + AL1 + AUTOINVENTARIO REPARTO VISIBLE + MOVIMIENTOS (LIBRO MAYOR) + FICHA VIVA** (ver §1). **Lo anterior (2026-06-14):** MOTOR DE INVENTARIO ARREGLADO DE RAÍZ Y VERIFICADO EN PRODUCCIÓN. Bug: `apply_inventory_count` calculaba el ajuste como `delta = counted_qty − system_qty`, y `system_qty` llegaba NULL en cuenta nueva (anterior al `COALESCE` de `build_inventory_count`) → `45000 − NULL = NULL` → el filtro `<> 0` no se cumplía → NO insertaba el asiento de apertura/ajuste → el stock quedaba SOLO con los `consumo` de ventas → negativos absurdos (Patatas −5.340). PRINCIPIO RECTOR (Julio): un conteo NO suma ni resta, SUSTITUYE — fija el stock a lo contado EN SU INSTANTE; las ventas posteriores restan encima. **`apply_inventory_count` v3:** `delta = contado − SUM(qty_base del ledger con occurred_at < instante_del_conteo)`; asiento anclado en `occurred_at = COALESCE(started_at, closed_at, created_at)` (NO `now()`); idempotente (borra asientos previos del conteo antes de recalcular → re-aplicar no duplica, resuelve el caso Arroz que tenía 12.000 de recepciones). **APERTURA (is_opening) NO aplica chequeo de tolerancia** (es punto de partida, no hay stock previo): backend v3 + front `InventoryCountSheet.tsx` (`missingReasons = isOpening ? 0 : …` — destraba botón, guard de `handleApprove` y texto a la vez). Re-aplicado INV-00002 como Julio vía `set_config` jwt (98 asientos; Patatas 43.530 = 45.000 contado − 1.470 ventas posteriores; Arroz 27.000 sin duplicar). Apertura INV-00003 aprobada DESDE LA APP con sesión real (Aceite 780, resto intacto) = flujo verificado de punta a punta. **STOCK REAL en pantalla de pedidos:** `supplierCatalogService.getSupplierCatalog` recibe `locationId` y lee `recipe_item_location_stock`; helper `formatStockForOrder` convierte base→cajas (Patatas 43.530 g ÷ 10.000 = 4,4 caja, como tspoon); `SupplyOrderBuilder` pasa locationId + recarga al cambiar local. **FEATURE-GATE → cuenta real:** `featureGateService.ts` ya no fuerza a admin al sandbox `00000000-…0001` (usaba `ACCOUNT_ID_FOLVY` → Julio caía al sandbox, 406 RLS, React #300); ahora usa `profileData.account_id`. PUENTE TEMPORAL: `accounts.is_internal=true` en Llorente29 porque es la PRIMERA cuenta no-interna y el gating de módulos (account_modules/G-7) no está construido — DEUDA con disparador. **FICHAJES** operativos (3 trabajadoras; coords reales Foodint Alcalá 40.4345672/-3.6528093; radio 200→1000m en `FichajeEmpleado.tsx`+`fichajeKiosko.ts`; el radio del kiosko vivía en localStorage del admin, no llegaba al móvil → DEUDA mover a `locations`). **LocationsPage** (`OtherPages.tsx`): geolocalización siempre visible + botón GPS + lat/lng editables (campos `lat`/`lng`). Commits cca7905, 7732a6b, 1b9b30d, 540393f (todos rev-list 0). **OBLIGATORIO NUEVO (guion AHORA D):** editar precios de proveedor desde la app está MUERTO (`SupplierItemsSection`/`PurchaseSourcesSection`) → Pamela depende de SQL; reparar + decidir si `last_price` es €/caja o €/base (pedido lo usa como €/caja, Kitchen como €/base; caso Delicias-COHELDI 8,99€/kg cobrado como €/caja). **DEUDA PRINCIPAL: versionar `apply_inventory_count` v3 en `supabase/migrations/`** (vive solo en BBDD); `build_inventory_count` aún rellena `system_qty` (ya no se usa). **Lo anterior (2026-06-12):** FUNCIÓN ESTRELLA EN PRODUCCIÓN: importar escandallo por FOTO/PDF/EXCEL/WORD. El motor (Edge `extract-recipe` + RPC `materialize_recipe_session` + `run_mapping`) ya existía vivo; faltaba la UI ('G7' nunca cableado). Construido: `recipeImportService.ts` (detecta formato — imagen comprime+sube y PDF sube tal cual → `kind:'photo'` visión, PDF como bloque document+header beta pdfs-2024-09-25; Excel→SheetJS sheet_to_csv y Word→mammoth extractRawText → texto → `kind:'conversational'`); Edge reescrito para distinguir visión/texto; botón 'Importar ficha' en `KitchenRecipesPage` (accept img+pdf+xlsx+xls+csv+docx). Probado foto en vivo (American Fries, 3 ingr, 0,29€). Diferenciador: meez/Apicbase obligan a teclear. COMPLETADO MASIVO IA de ingredientes pendientes: botón en `KitchenItemsPage` + `recipeBulkEnrichService.ts` (serie con pausa+backoff, reutiliza `enrichIngredient`+`applyEnrichment`); 76→31 terminados. FIXES de raíz: `extractJson` robusto en `enrich-ingredient` (extrae {...} aunque la IA añada prosa); CHECK de `recipe_item_allergen` alineado al código (state `contains/may_contain/free/unknown`, source +`ai_enrich` — antes 400 masivo por vocabulario desalineado, MIGRACIÓN SIN VERSIONAR); `applyEnrichment` reordenado (familia/IVA primero, alérgenos delete+insert no bloqueantes — antes 400/409 cortaba el cierre). PWA INSTALABLE: iconos PNG (192/512+maskable+apple-touch), `manifest.json` corregido (era SVG → iOS no instalaba), `sw.js`+registro en `main.tsx`, `InstallAppButton` en `HomeEmpleado`. ACCESO TRABAJADOR: arreglo mínimo (worker puro sin botón 'salir' → no queda atrapado por QR de un solo uso + signOut). Commits 67dd3f3, 1b3080c (+ fix trabajador). **3 OBLIGATORIOS abiertos (ver guion AHORA):** (A) acceso-trabajador-completo (salir→LoginEmpleado PIN, no email; doc `docs/OBLIGATORIO_acceso_trabajador_reentrada.md`; reenviar QR a atrapados); (B) PWA botón instalar directo en Android (`beforeinstallprompt` no salta → cae a instrucciones); (C) masivo no cierra `needs_review` porque `review_notes != null` (los crea la función estrella). **DEUDA: versionar SQL** (sales_dashboard, fixes RLS superadmin, materialize_recipe_session, run_mapping, CHECK alérgenos). **Lo anterior (12/06 mañana):** migración Kitchen a Llorente29, SWITCH 6 tiendas Last (ventas reales 100%), BUG RLS superadmin arreglado (~50 tablas vía `current_user_account_ids`+`belongs_to_account`+`is_admin_or_manager_of`), DASHBOARD VENTAS en producción (RPC `sales_dashboard`). **Lo anterior (11/06):**  CASADO DE VENTAS a 98,6% en Folvy Interno con MARCA ESTABLE POR UUID (external_brand_map validado por Julio: 42 UUID Last→16 marcas→3 locales físicos; cada local 2 cuentas Last propia+CTB cedidas). RAW EVENT STORE: el ticket completo se guarda (sale.raw_tab); el webhook ya no descarta la cabecera con la marca. Catálogo de cedidas Cloudtown descargado (686 prod). Índice uq_menu_item_external con brand_id (matrícula por marca). adapt_lastapp_order v3 (combos por marca deducida de hijos). Selector de local DESBLOQUEADO (era texto muerto). Pantalla por marca×local DISEÑADA (validada), encargada a Code junto al scope de local en toda la app. Commit 4493071 (0 0). Detalle en §1. **Lo anterior (10/06):** AUTOINVENTARIO IA A1+A2 EN PRODUCCIÓN (cola priorizada por valor+rotación+riesgo, cobertura de valor en riesgo, criticidad operativa override; `autoinventory_queue` + front, commit 94719c6; verificado en vivo). ONBOARDING INTEGRACIONES Last.app como herramienta interna en ficha de cliente (alta+vincular+importar+sembrar/recasar; commits d7ebc7a, 0347bb0). **DIAGNÓSTICO + DISEÑO MAYOR: la fiabilidad del casado de ventas es ~87%; el frente CTB (marcas cedidas Cloudtown) destapó que el catálogo de Last falla cuando está organizado POR CANAL sin "default", y que el problema es de ENFOQUE, no de bug.** → Diseñada la INGESTA CANÓNICA (`docs/folvy_ingesta_canonica_diseno.md`, corona a fiabilidad): Folvy es la verdad del catálogo, TPV/plataformas = adaptadores reconciliados por id estable (`organizationProductId`), cola de excepciones = 100%; regímenes propias (Folvy manda) / cedidas (Folvy espeja sin tocar pero costea); 8 decisiones cerradas; contratos de Last verificados con su OpenAPI v2.0.0. **ESTRATEGIA DELIVERY** (`docs/folvy_estrategia_delivery.md`): research a fondo del mercado ES → **Otter** es el candidato líder (Glovo España verificado + NO compite con Folvy + API de partner camuflable bajo Folvy); **correo de partnership a Otter ENVIADO**. Glovo directo (DH API) en cola sin fecha. Motivo urgente (Julio): Llorente29 quiere dejar Last (caro), riesgo competitivo de "delivery integrado" ajeno. **Lo anterior (10/06, 1ª sesión):** INVENTARIO PERPETUO T1 apertura (9898d4c), T2 merma proactiva (2e02f69), autoinventario diseño + A1 criticidad (5f9cb7d), webhook ya no pierde ventas de local no mapeado (3 tiendas CTB mapeadas). Detalle en §1. **Lo anterior (09/06):** Consumo teórico VIVO (ventas×escandallo→ledger), identidad del recast jubilada y `reprocess_sale` unificado, capa 4 de fiabilidad verificada (95,02%); bug del router (F5) corregido + crear plato desde venta huérfana (commit 3bc2705). **RECEPCIÓN REDISEÑADA (noche 09/06, commits 5230ff4..62a225e):** espejo del albarán — recibido a ciegas, foto del albarán a la IZQUIERDA, formato en una línea con árbol de pack real (`ensurePackTree`, total derivado), «→ X al almacén» visible, rojo+motivo si no cuadra; tarjeta con jerarquía. Build verde. PENDIENTE validar con varios albaranes (Julio, 10/06); si cuadra → recepción a HECHO. Detalle en §1 / §1.3. Lo anterior (07/06): CASADO DE VENTAS lastapp arreglado y desplegado (cache por `brand_id|recipe_item_id`, marca vía `catalogProductId`→catálogo; `--no-verify-jwt`). SUBSISTEMA DE FIABILIDAD DEL CASADO iniciado: capa 1 (`sale_line.unmapped_reason`) + capa 2 (webhook escribe la razón) hechas; capa 3 (`recast_lastapp_sales`) CREADA, pendiente de ejecutar (decisión A/B). Diseño completo en `docs/folvy_fiabilidad_casado_diseno.md` (alarmas + impacto stock/compras MRP II). Antes (mismo día): RECEPCIÓN "qué entra al almacén" en producción (commit a0e678e). Ver §1.1 para detalle.
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
NO insistir en cerrar la sesión, Y NO MENCIONARLO SIQUIERA. Julio decide cuándo cerrar; Claude NO informa de esa situación, ni ofrece "parada", ni dice "cerramos aquí", ni marca puntos de cierre — SALVO ante RIESGO TÉCNICO real (build roto, algo a medias peligroso). Fuera de ese caso, Claude sigue trabajando sin aludir al cierre. (Reforzado 07/06: Claude ofreció parada repetidamente al cerrar cada capa; corregido por Julio.)
Las preguntas con botones (`ask_user_input`) no le llegan bien a Julio. Preguntar siempre en prosa.
Indicar SIEMPRE de forma explícita cada acción operativa: cuándo COMMIT/ROLLBACK, build, git grep/commit/push, reiniciar dev server. Responsabilidad de Claude.
**Reparto Claude/Code (fijado 31/05):** lectura de un fichero CONCRETO que Claude ya identifica → lo sube Julio (rápido, barato). Búsqueda/descubrimiento (`git grep`, "¿existe X?") o ejecución en el repo → Claude Code.
**Regla migraciones (fijada 31/05):** al tocar esquema, `src/types/database.ts` regenerado va SIEMPRE en el MISMO commit que los tipos/services que lo usan (unidad atómica que compila en aislamiento). Y todo DDL aplicado en sesión debe quedar como migración en `supabase/migrations/` (formato `YYYYMMDD'T'HHmm_descripcion.sql`, transaccional, con cabecera `Aplicada:`) antes del push — si no, hay DRIFT entre BBDD y repo.
**Regla SQL SECURITY DEFINER (reconfirmada en vivo 31/05):** estas funciones revientan en SQL Editor (`auth.uid()` null). NUNCA probar dentro de la tx que las crea; verificar aparte; probar funcionalmente DESDE LA APP (con sesión) o desde script con `signInWithPassword`. Corolario demostrado: cualquier escritura que dispare un trigger que llame a una de estas funciones también revienta sin sesión de usuario (p.ej. DELETE en `article_supplier` desde SQL Editor) → para mantenimiento, `disable trigger` dentro de la tx.
CIERRE DE SESIÓN (sistema obligatorio): `.\scripts\cierre-sesion.ps1` hasta CIERRE OK. Pasos en docs/CIERRE_SESION.md.

PRINCIPIOS RECTORES DEL PRODUCTO (innegociables, fijados 31/05, por encima de Julio y de Claude)
1. **Deuda 0**: ninguna deuda en silencio. Toda deuda se declara por escrito con su disparador. Un empate NO se vende como victoria — aplica también a las afirmaciones de Claude sobre sí mismo.
2. **Benchmark top-del-mundo antes de diseñar cada pieza** y medición contra él al cerrarla. Solo vale golear; "ser los mejores" se mide sobre DATOS REALES, no de laboratorio. Una demo que solo empata con el incumbente (gstock/tspoon) puede ser NEGATIVA.
2.bis **AUDITORÍA COMPLETA DE TSPOON OBLIGATORIA antes de CUALQUIER decisión importante de diseño o creación.** El benchmark del incumbente NO es opcional ni se sustituye por memoria o por una captura suelta: hay que consultar el DUMP real (`tspoon_dump/`, fichero relevante por área) ANTES de diseñar/crear. (Reforzado 07/06: en una misma sesión se tomaron 2 decisiones importantes de diseño/creación —arreglo del casado del webhook y subsistema de excepciones— SIN consultar la auditoría completa de tspoon; solo se cazó porque Julio lo exigió. No debe repetirse.)
3. **Folvy guía/reeduca al operador** para hacer las cosas bien sin bloquearle (calibrado fino: oportuno, con beneficio visible, nunca plasta).
4. **Cada paso de UI es didáctico** con el cocinero/empleado/cliente: enseña mientras captura.
5. **FRONTERA ÚNICA — autorización en el borde, motor puro (fijado 08/06, arquitectónico).** Toda entrada externa (webhook de cada TPV con su token, app con sesión de usuario, batch/scripts con admin) AUTORIZA en su FRONTERA. El MOTOR (adaptadores que traducen formato→canónico, y el cálculo: coste/consumo/etc.) NO lleva guard de usuario: asume que quien llama ya pasó por una frontera, y solo calcula. Imagen: edificio con un control en la entrada; los despachos están abiertos por dentro. POR QUÉ aguanta años: añadir un TPV/integrador (Otter, Glovo, Uber, Deliverect) = 1 frontera nueva (su webhook + su token) + 1 adaptador nuevo (su formato → MISMO canónico); el motor y el modelo canónico NO se tocan NUNCA, y NUNCA se vuelve a decidir "dónde va el guard" (siempre en la frontera). Patrón estándar de la industria (Deliverect/Otter/Toast) y ya presente en el repo (create-account valida y delega a create_account_tx). HECHO: adapt_lastapp_order y compute_sale_line_cost son motor puro (migración 20260608T2800); lastapp-webhook es frontera que valida token y delega; probado end-to-end en vivo. DEUDA DECLARADA (no urgente): las RPC que la app llama directo y exponen/deciden (sales_mapping_reliability, preview_modifier_impact_cost) aún llevan guard; norte = migrarlas a Edge cuando se toquen, hasta que la regla sea universal. REGLA FUTURA: ninguna función de motor nueva lleva guard de usuario; toda entrada nueva trae su propia frontera.
Cadencia: en cada paso, antes de cerrarlo, Claude para SOLO y aplica el control "¿somos los mejores aquí?"; si no lo es, busca cómo serlo o lo declara deuda explícita. Julio no tiene que pedirlo.
---
1. ESTADO VIVO ⟵ se regenera cada sesión

**Última actualización: 2026-07-03 (CIERRE · noche). CRM F4 "MI CUENTA" COMPLETO + G1 GESTOR + G2a+ MOTOR DE OFERTAS v2 + G2c (BOGO + PLATO DE REGALO) — TODO EN PRODUCCIÓN Y VERIFICADO EN VIVO. EL CATÁLOGO DE TIPOS DE OFERTA QUEDA COMPLETO CONTRA UBER/GLOVO.** Sesión mayor: ~30 commits (0e80704→10785e9, todos push rev-list 0 0), 25 migraciones (20260703T1000..T2660, todas aplicadas), 10+ bugs/huecos cazados EN VIVO por usar el sistema de verdad. `database.ts` SIN regenerar (deuda arrastrada). Sin credenciales pegadas.

> **(F4 "Mi cuenta" — T1+T2+FIX+T3, commits 0e80704/946d3ba/13032ae/69a5a96, migraciones T1000/T1010/T1020/T2000/T2010/T2200/T2300).** Vista `/cuenta` DENTRO de ShopHubRoute (patrón URL-driven de /seguir; App.tsx intacto; topbar "Hola, Julio" navega). **T1:** `customer_orders` (histórico con foto de plato/marca/estado/descuento), **reorder exacto** = `customer_reorder_payload` devuelve {locationId,mode,lines} del `raw_tab` (STRIP de customer/payment/coupon) → replaceCart → dry-run revalida 86/precios de HOY con aviso "N platos ya no disponibles"; `customer_address` (única default por cliente) + **siembra silenciosa** al final de place_shop_order (exception when others then null — jamás tumba una venta) + chips de dirección en checkout; `customer_set_consent` = **baja RGPD 7.3 en un toggle** (verificado: log `revoked/account_page` + marketing_email=false; re-alta `granted`); `customer_update_profile` (email NO editable a propósito — cambiarlo pedirá OTP, frente futuro). **T2:** `customer_coupons` replica EXACTA de la cascada T2100 (needs_consent/not_first/exhausted/per_customer) → tarjetero dorada disponible / verde usada / atenuada con motivo honesto (literales de couponText.ts, fuente única con el checkout); badge contador en pestaña; "Usar ahora" → autoApply banner en hub / código → sessionStorage `folvy-shop-pending-coupon:${slug}` → checkout precarga; cabecera cálida (avatar coral iniciales + "Miembro del Club" + ←Foodint); brandById en el reorder puebla la marca del carrito; autocomplete Mapbox en alta manual de direcciones. **FIX canjes cancelados (T2200, destapado por el tarjetero):** coupon_redemption se inserta al crear el pedido y contaba aunque la venta se cancelara (prueba Stripe sin pagar / cron expire 30min) → un comensal que abandona el pago QUEMABA su bienvenida. Regla de Julio: canje de venta cancelada NO consume. Counts con `join sale coalesce(status,'')<>'cancelled'` en place_shop_order Y customer_coupons + DELETE del canje muerto pre-insert (el índice único (coupon_id,customer_id) intacto sigue cerrando la carrera entre canjes VIVOS). **T3 — recompensa por FRECUENCIA (una migración T2300 de 738 líneas):** coupon += kind ('standard'/'frequency') + frequency_threshold (>=2), índice único 1 frequency activo/cuenta; el índice once_per_customer se esquiva con flag `is_cycle` (hallazgo RECON de Code: sin él la recurrencia era imposible); **progreso SE CALCULA, no se guarda** (count de sales no canceladas desde el último canje VIVO — el fix 2200 protege el reset gratis); prioridad si bienvenida y frequency aplican a la vez = el de mayor descuento; `save_frequency_reward` + `FrequencyRewardSettings` en ShopDesignPage con impacto de margen real (verificado: 90,2%→89,1%, peor plato 53,6%); barra de sellos segmentada en Mis bonos + mini-línea "N de M hacia tu próximo bono" en cabecera; sin motor activo NO se pinta nada (cero decorado). **HITO: primer ciclo REAL del CRM** — pedido FS39838 "Recibido" con bienvenida canjeada (−2,97€), barra 0/5→1/5, la bienvenida transicionó sola a "Usado" en el tarjetero. VERIFICACIÓN PENDIENTE ligada a ciclo real con cocina abierta: chip de dirección por siembra automática + ciclo completo ganar→canjear→reset del frequency.
>
> **(G1 GESTOR DE CAMPAÑAS, commits cabeff7 + fixes 7eb6f48/947f0ff/9800406, migraciones T2400/T2410).** coupon += **origin ('manual'/'rule'/'agent')** [la costura de la escalera de automatización: G2d reglas → F9 agente] + paused_at (pausar = active false + paused_at, el motor no cambia). `list_campaigns` (estado DERIVADO en SQL: active/scheduled/expired/paused; rendimiento real = canjes VIVOS del filtro 2200 + € descontado + **margen medio real de margin_after**, el dato que nadie explotaba) + `save_campaign` (solo código estándar; guards code_taken/system) + `toggle_campaign`. Página Campañas en el módulo Shop admin (ruta 'campanas', SIN tocar App.tsx): Sistema (bienvenida/frecuencia → "Configurar" en su casa canónica) vs Código (editar/clonar/pausar), modal con preview_coupon_impact en vivo. Verificado con SEMANA10: nace Programada → rechazada por ventana → editada a hoy → aplica −4,54€ → pausada deja de aplicar → reactivada. **3 huecos de F3 cazados en vivo:** (1) el campo "¿Tienes un cupón?" NUNCA estuvo montado (JSX gateado tras !coupon?.isWelcome — con bienvenida auto no se renderizaba jamás); (2) rechazo MUDO (código fuera de ventana → {applied:false} SIN reason → nada se pintaba; fallback añadido con guard couponCode&& que protege al anónimo); (3) protagonismo + voz: la fila del cupón (icono ticket) vive ahora en el RESUMEN entre envío y Total (patrón Uber/Glovo, aside+móvil), y el rechazo pasó de rojo-triste a **ámbar cálido "Hmm, ese código no funciona…"**. **DECISIÓN de Julio (nueva, vigente): la VOZ DEL CLIENTE (copys cálidos, de persona) es requisito de diseño desde la maqueta — se revisa en la maqueta, no se parchea después.**
>
> **(AUDITORÍA CRM/Loyalty/Ofertas + corrección de proceso).** Julio señaló (con razón) que pese a pedir 2+ veces benchmark a fondo, "lo básico" del mercado estaba sin tratar: 2x1, % por plato, envío gratis — lo que Glovo/Uber dan de serie a cualquier partner. Raíz: los benchmarks auditaron PLATAFORMAS de CRM, nadie enumeró el CATÁLOGO de tipos de oferta. Auditoría exhaustiva hecha contra fuente primaria (Uber Eats Offers: BOGO/free item/% off item/basket %-£/£0 delivery/combinables/audiencia/weekly budget/All Campaigns · Glovo Promotool: 2x1/% producto/campañas de entrega · Cheerfy/Punchh/Thanx/Pleez) → **tablero con veredicto por fila versionado como ÁREAS 10/11/12 nuevas de folvy_competitive_map.md**. REGLA REFORZADA del ritual: el paso BENCHMARK produce ENUMERACIÓN EXHAUSTIVA de capacidades del área con veredicto; lo que no está en el mapa no existe; lo 🔴 está declarado, no invisible. Piezas destapadas sin fase que quedaron ANOTADAS: referidos, cumpleaños, upselling inteligente (→F5/F6), decisión cashback (estratégica de Julio, F6), Ads de plataforma + social (Meta/TikTok APIs públicas; Uber/Glovo ads = RECON F8), radar competitivo de precios/ofertas (F8, cruce con margen que Pleez no puede hacer).
>
> **(G2a+ MOTOR DE OFERTAS v2 — lote 1 COMPLETO, commits a8a86f4→977f3e1, migraciones T2500/T2510/T2520/T2530/T2540/T2550/T2560/T2570/T2580).** **MODELO (T2500):** coupon += weekdays smallint[] + time_from/time_to (franjas, TZ Europe/Madrid) + budget_max (presupuesto en € que APAGA la campaña sola, patrón Uber weekly budget) + channels text[] default '{shop}' (costura F8: la campaña nace multi-canal) + kinds item_percent/free_delivery; **campaign_scope** (coupon→brand|categoría|plato, exactamente uno); **menu_item_price_history** (trigger en cambio de precio + backfill → **la ventana Ómnibus RD-Ley 24/2021 cuenta desde 03/07 09:38**; omnibus_ref_price = min 30 días); **ARTÍCULO ESPEJO** (decisión 05/06 materializada): menu_item.mirror_of_item_id + create_mirror_item (duplica con historial VIRGEN) + swap_mirror (original y espejo nunca conviven) — matiz legal documentado: el espejo vende a precio agresivo SIN tachado (sin historial no hay referencia que tachar). **MOTOR (T2510):** `_shop_item_offer` = FUENTE ÚNICA (la carta y el cobro leen la misma función: lo que ves es lo que pagas); item_percent reprecia en _shop_reprice_line (scope más específico gana; ventana+franja+canal+presupuesto), tachado SOLO si legal (wasPrice NULL si ref<precio-dto), letra "Precio más bajo últimos 30 días: X€"; canje POR VENTA con is_cycle → presupuesto por suma de canjes vivos. **ESCAPARATE (B2 T2520 + C4 T2550):** badge de marca en el hub (_shop_brand_best_offer "Hasta −20%"), banner de carta tappable con scroll, tarjetas resaltadas (borde coral + precio grande), píldora en cabecera de categoría; envío gratis VENDIDO en 4 puntos: franja verde bajo topbar, tag 🛵 por tarjeta de marca, banner combinado, y **barrita de progreso en el carrito "Te faltan X€ para el envío gratis" → "¡Conseguido! 🛵"**. **LECCIÓN DE PLATAFORMA (costó una verificación fantasma): todo cambio visual del Shop exige bump de SW_VERSION** — el service worker sin bump siguió sirviendo el bundle viejo a los instalados aunque git/Vercel estuvieran al día. **ENVÍO GRATIS (C T2530 + C2 T2540):** kind free_delivery en la cascada de place_shop_order (auto o código; descuento=envío; pickup→pickup_only amable; margin_after NULL); **COEXISTE con la bienvenida** (lanes separados subtotal/envío; el índice coupon_account_one_auto pasó a único POR KIND — nació en F3 cuando la única auto era la bienvenida); verificado en vivo: Bienvenida −2,06 + envío ¡Gratis! + −20% de carta en los precios de línea, TRES capas a la vez cuadrando al céntimo. **FIX Mapbox (producción real):** 403 Forbidden en subdominios de tienda = URL restrictions del token → añadir `folvy.app` SIN protocolo (domain-only cubre subdominios; `https://*.folvy.app` NO soportado); + fix autofill de Chrome pisando las sugerencias (C3, técnica anti-autofill; el gestor de direcciones de Chrome tapaba la lista de Mapbox → clientes elegían texto sin coordenadas → sin envío). **GESTOR (D T2560 + D4 T2570 + D5 T2580):** save_campaign ampliado (17 args: kinds+scope+franja+presupuesto, transaccional; item_percent exige scope, free_delivery nace auto) + campaign_menu_tree (marcas→categorías→platos con price/cost/refPrice/floorPct) + modal: selector de tipo → **picker con CHIPS DE MARCA + BUSCADOR con "Seleccionar los N resultados"** (caso literal coca-cola en todas las marcas de golpe; posible por el modelo de producto compartido del importador) + chip resumen persistente con ✕ → franja (días/horas) → presupuesto → **impacto de margen POR PLATO del alcance (nombra los que quedan bajo suelo, cuenta los sin escandallo) + validación Ómnibus visible ("✓ Tachado legal verificado" / aviso) + oferta de "Crear versión promo (espejo)" cuando el tachado sería ilegal**; buscador + filtros (tipo/estado) en la lista; **delete_campaign** con triple guard (cuenta/sistema/canjes: con canjes solo pausa — el histórico de rendimiento es dato); mirror_state + botón de swap en la ficha del plato (distingue "oculto por espejo" ámbar de "agotado" 86 — Julio tropezó con las capas y el botón nace de ese tropiezo; verificación latente al primer espejo real). **2 tropiezos de firma en la T2560 → REGLA NUEVA DEL PLAYBOOK: en migraciones con cambio de firma, DROP y GRANT se generan COPIANDO la lista de tipos del CREATE del propio fichero, CONTÁNDOLOS** (1º: DROP apuntaba a la firma nueva inexistente; 2º: GRANT con 16 tipos vs CREATE de 17 — faltaba un text — y un DROP IF EXISTS de firma inexistente da NOTICE, nunca 42883: el que exige existencia es el GRANT). **PARTE 4 — motor de dinero saneado ANTES de apilar BOGO (deuda-0):** (4a) base de la bienvenida CONGELADA al subir cantidades (el dry-run dependía de cart.lines.length, que no cambia con 1→2 uds → descuento calculado sobre 1 ud; fix: cartSig con cantidades en las dependencias) — era el "−2,06€ que no cubría el 2º Tequeño"; (4b) carrito-viejo: el resumen pintaba unitPrice del localStorage (viejo si cambió precio/oferta) → ahora **las líneas del DRY-RUN mandan** cuando está alineado (verdad del servidor en pantalla y en cobro). **ESPEJO ESTRENADO Y LIMPIADO:** plato TEST (10→6→10 = referencia envenenada a propósito) → el modal avisó tachado ilegal → "Crear versión promo" → swap → carta con precio limpio → TODO borrado sin rastro (campañas de prueba eliminadas con el botón nuevo de D4; su primer uso real). **MEDICIÓN contra benchmark: paridad Uber/Glovo en % por plato + envío gratis + gestor de campañas, MÁS tres capas que NADIE tiene: margen real por plato antes de activar, Ómnibus por construcción (historial+validación+letra legal), y artículo espejo.** Queda de paridad: BOGO/2x1 + free_item (=G2c, encargado a Code con spec completa), combinable item+cesta ya de serie (coexistencia construida).
>
> **(G2c BOGO + PLATO DE REGALO — CERRADO Y VERIFICADO, commits 06a8c95→10785e9, migraciones T2590..T2660).** **BOGO:** A1 modelo+gestor (kind bogo, value=% de la 2ª unidad, 100=2x1; modal con "coste por par" en cálido) · A2 MOTOR (BOGO muerde en la línea qty≥2 del mismo plato, floor(qty/2) unidades con %; codificado como discountUnit=discountLine/qty para NO tocar la acumulación de place_shop_order — 1 sola línea cambiada; BOGO GANA a item_percent si coinciden; **verificado en vivo con la ESCALERA DE PARES al céntimo**: AGUA 1,90€ · 2 uds→1,90 · 3→3,80 · 4→3,80, bienvenida encima cuadrando) · A3 completo tras DOS ampliaciones por capturas de Julio (**regla: lo que ve es lo que paga EN CADA PANTALLA**): badge negro/amarillo (#FFC400) GRANDE patrón Glovo en tarjeta+HUB (_shop_brand_best_offer ampliada, bogo>pct), banner, modal con total por pares (espejo documentado del motor), carrito con tachado+chip "2x1 ahorras X", y chip en el resumen del checkout; _shop_item_promo = feed unificado (bogo gana). **FREE_ITEM (plato de regalo desde X€):** B1 gestor (picker de UN plato + chip "🎁 Regalo: AGUA 50 CL · 1,90€" = el coste delante) · B2 motor con **DECISIÓN DE PRODUCTO** (confirmada por Julio a propuesta de Code): el regalo es **LÍNEA REAL a 0€** — la cocina la ve y la prepara, el ticket la imprime; el "descuento equivalente" habría sido money-OK pero producto-MAL (regalo que nunca se hace = cliente enfadado). Insertada tras adapt_folvy_shop_order, canje is_cycle con discount_amount=precio del regalo (presupuesto), coupon_json.giftItem. **Verificado por respuesta del servidor** (dry-run con línea AGUA a 0, offer{kind:free_item, giftValue:1.90}) ANTES de existir el pintado — separó motor de render. · B3: **barrita dorada** "Te faltan X€ para tu [plato] de regalo 🎁"→"¡añadido!" (patrón envío gratis) + render "🎁 Regalo · Gratis" en resumen/recap + realineado del gate freshLines (===→>=: el server añade una línea que el carrito no tiene). VERIFICACIÓN FINAL: ciclo completo en vivo, bienvenida −10% sobre base SIN el regalo, campañas de prueba eliminadas con el botón D4. **TÉCNICA NUEVA (Code) para tocar funciones de cobro de 23k:** la migración regenera del texto VIVO (pg_get_functiondef) + replace() anclados en strings únicos verificados count=1, con guardas que ABORTAN si un ancla falta e idempotencia — patrón anti-drift para place_shop_order. **2 INCIDENTES DE LITURGIA (reglas nuevas):** (a) Code editó la 2610 ya aplicada → drift BBDD/repo cazado por git diff → **una migración APLICADA no se edita jamás; cambios = migración nueva**; (b) la 2620 se creyó aplicada sin estarlo (badge del hub null que parecía bug) → cuando una función no hace lo esperado, **verificar su CUERPO VIVO** (position('...' in pg_get_functiondef)) antes de encargar el bug. HIGIENE anotada: marca duplicada "Bendito Burrito" (2 filas brand, una sin uso). **MEDICIÓN FINAL DEL MÓDULO: el catálogo de tipos de oferta de Folvy queda COMPLETO contra Uber Eats Offers y Glovo Promotool** — % pedido, € pedido, % por plato (Ómnibus), 2x1/2ª unidad, plato de regalo, envío gratis; combinables, con franja, presupuesto auto-apagado, y las 3 capas únicas (margen delante, Ómnibus por construcción, espejo).
>
> **SIGUIENTE (orden acordado):** G2e dashboard de rendimiento de campañas (canjes/inversión/ventas atribuidas/ticket con-sin/margen real generado/ROI — semilla margin_after ya se guarda) → G2d motor de reglas (campaign_rule + evaluador cron; disparadores franja/valle, caída de demanda y marca floja contra histórico PROPIO, clima Open-Meteo, eventos; origin='rule') → deuda catálogo↔escandallo (420/582 sin coste, lo que convierte el impacto de margen de parcial a total) → F5 post-pedido (email Resend sin esperar WhatsApp; absorbe cumpleaños+referidos). **PENDIENTES menores:** ciclo real con cocina abierta (chip dirección T1 + ganar→canjear→reset T3), KPI "Agotados" cuenta el espejo en espera como agotado, normalizar el scope del picker (categoría marcada no debe persistir también los hijos), precio Tequeños quedó 9,91€ (¿céntimo arriba tras la prueba del historial? revisar), regenerar database.ts, estilos muertos del checkout (couponToggle/couponError/welcomeBanner), F8 RECON de mecanismos de publicación (API vs credenciales de partner) antes de prometer push/ads de plataforma, decisión cashback (F6, de Julio). SEMANA10 queda Programada 6–12 jul (campaña real de Julio).

> **Lo anterior (2026-07-02, CIERRE 2 · noche):** CRM — A2 (BIENVENIDA SOLO CON EMAIL+CONSENTIMIENTO) + F3 SUB-PASO 5 (CONFIG DE BIENVENIDA CON MARGEN REAL) + CAPTURA ANTICIPADA DE CONSENTIMIENTO, TODO EN PRODUCCIÓN Y VERIFICADO EN VIVO.** Continuación del CRM. Tres tramos cerrados, los tres con build verde + commit + push rev-list 0 0. `database.ts` NO requiere regeneración (solo funciones nuevas/modificadas, sin columnas ni tablas nuevas). Sin Edge Functions nuevas. Sin credenciales pegadas esta sesión.

> **(A2) La bienvenida ya solo aplica con email + consentimiento marcado (en producción).** Bug de diseño que Julio cazó: el cupón de bienvenida (`auto_apply`+`first_order_only`) se regalaba a cualquiera sin email/consentimiento, contradiciendo el golpe nº1. **Decisión A2:** el descuento COMPRA el contacto con permiso (el activo del CRM), así que solo aplica con email Y consentimiento. Migración `20260702T2100_place_shop_order_welcome_needs_contact.sql` (CREATE OR REPLACE de `place_shop_order`): nueva validación en cascada tras 'min' → si es bienvenida y (email NULL O consent marketing false) → reason `needs_contact`, descuento 0; el dry-run devuelve además `discountType`/`discountValue`. Julio quitó el `min_subtotal=20€` de la bienvenida (→ NULL): captación universal, una vez por cliente (el mínimo quemaba la bienvenida al que pedía pequeño en su primer pedido por first_order_only). Aclaración legal (válida RGPD): atar el descuento al consentimiento es legítimo porque rechazarlo NO penaliza — el guest checkout a precio completo sigue disponible; lo ilegal sería obligar a marcar para comprar. **Pieza de bienvenida rediseñada** (`CheckoutRoute.tsx`+`checkoutService.ts`): tarjeta de regalo a dos niveles (chip blanco con aro de color + emoji, etiqueta pequeña + premio grande + sub-línea), color DORADO/ámbar = regalo esperándote / VERDE = ya del Club (Julio rechazó el coral, que parece alarma); valor **dinámico** vía `promoValue(coupon)` (10%/4€, se adapta si cambia el valor); estados: 🎁 sin correo (captación) · ✨ correo sin casilla (\"ya casi es tuyo\") · 🎉 casilla marcada (verde, aplicado) · nota gris para not_first/per_customer/exhausted. **Precarga F2** (`getSessionCustomer`): al cliente logueado se le rellenan nombre/correo/teléfono (solo campos vacíos) y no se le re-pide el correo. Verificado en vivo: 73,30€→65,97€ (−7,33 = 10%). Commit `4001c25`.
>
> **(F3 sub-paso 5) Config de la bienvenida por cuenta con IMPACTO DE MARGEN REAL (en producción — golpe nº1).** RECON confirmó: `coupon` tiene todos los campos, `accounts.shop_coupon_margin_floor_pct` existe, NO existía `preview_coupon_impact`, motores de coste `compute_sale_line_cost`/`menu_item_channel_economics`; `menu_item.price`/`packaging_cost`/`recipe_item_id`; `recipe_item.computed_cost`. Migración `20260702T2200_welcome_offer_config.sql`: **`preview_coupon_impact(account, discount_type, value)`** (read-only, SECURITY DEFINER, guard `current_user_account_ids()`, GRANT authenticated) devuelve, sobre la carta vendible, margen medio ahora→después por plato, nº de platos bajo el suelo, nº sin escandallo, y el **descuento efectivo** que el valor supone sobre el **pedido medio REAL** del Shop (para comparar \"20% vs 4€\" peras con peras: 4€ sobre un ticket medio de ~25€ ≈ 15,7%). Modelo unificado por fracción efectiva f (percent = v/100; fixed = min(v, pedido_medio)/pedido_medio); margen BRUTO (precio−coste)/precio, IDÉNTICO al guardarraíl que aplica `place_shop_order` (no netea IVA) para que el preview no mienta. **`save_welcome_offer(account, active, discount_type, value, floor_pct)`** (upsert del cupón de bienvenida canónico + fija el suelo en `accounts`, atómico, respeta el índice único de un-solo-auto-por-cuenta). Front: `couponAdminService.ts` (getWelcomeOffer/previewCouponImpact/saveWelcomeOffer) + `WelcomeOfferSettings.tsx` (sección autocontenida inline-styled, presets 10/20/4/5, impacto en vivo con debounce 350ms, suelo, guardar) montada en `ShopDesignPage.tsx` tras \"Identidad del hub\" (usa `useActiveAccount()`). Verificado en vivo: 10% → 79,9%/77,7%; 4€ ≈ 15,7% sobre pedido medio; aviso honesto \"420 de 582 platos no tienen escandallo y no cuentan en el margen\" (= dato real, deuda catálogo↔escandallo; ningún competidor da ese aviso). Commit `e70d5e9`. **DEUDA declarada:** A/B REAL servido (mostrar 2 variantes + medir conversión) = frente propio; esto es config + decisión con margen visible.
>
> **(Captura anticipada de consentimiento) El permiso se registra al MARCAR la casilla, sin esperar al pago (en producción).** Idea de Julio: no perder consentimientos en carritos abandonados (el permiso es el activo, no el correo — un correo sin consentimiento no sirve para crecer). RECON: `customer` (dedup por índices únicos parciales `(account_id, lower(email))` y `(account_id, phone)`), `customer_consent` (PK=customer_id), `customer_consent_log` (append-only, CHECK action∈{granted,revoked}, channel∈{email,sms,whatsapp,all}). Migración `20260702T2300_shop_early_consent.sql`: **`register_shop_consent(slug, email, name, phone, consent, terms_version)`** pública (GRANT anon+authenticated) — reglas de hierro RGPD: sin email válido no hace nada; **consent=false y cliente inexistente → NO crea nada** (solo la acción afirmativa —marcar— crea registro; teclear el correo sin marcar no debe crear cliente); marcar crea/actualiza customer + upsert consent + log `granted`; desmarcar un consentimiento existente → false + log `revoked`; loguea SOLO cambios; source `shop_checkbox`. **`customer_session_me` ampliada** devuelve `consented` (marketing_email actual). Front: `customerAuthService.ts` (SessionCustomer += `consented`; `registerShopConsent`) + `CheckoutRoute.tsx` (estado `alreadyConsented` + `consentTouchedRef`; efecto debounced que dispara al marcar/desmarcar con correo válido; la casilla se **oculta en el acto** cuando el registro confirma `consented:true` —el que acaba de consentir ya está en el Club— y a quien ya venía consentido de F2; un cliente nuevo o que la desmarcó sí la ve = acción afirmativa preservada). Nota de privacidad: en invitado NO se consulta por correo si alguien ya consintió (filtrar dato ajeno); solo se oculta con sesión F2 o tras marcar aquí y ahora. Verificado en vivo: log `granted / shop_checkbox` con marketing_email=true SIN pedido; casilla desaparece tras marcar. Commit `11d85d9`. **Pendiente natural (F4): baja fácil del consentimiento** (RGPD art. 7.3: retirar tan fácil como dar).
>
> **SIGUIENTE del CRM: F4 \"Mi cuenta\"** (histórico + reorder a un toque + mis bonos como tarjetas + progreso visual + baja fácil del consentimiento + editar datos). Luego F5 ciclo post-pedido, F6+ según plan. **Deuda cruzada que hoy se hizo visible:** enlazar catálogo↔escandallo (los 420/582 platos sin coste) — bloquea que el margen real y el ciclo cerrado sean 100% completos.

**Lo anterior (2026-07-02, CIERRE 1 · noche): MOTOR DE CRECIMIENTO (CRM) — F1 IDENTIDAD+CONSENTIMIENTO + F2 LOGIN DE CLIENTE + F3 MOTOR DE CUPONES, TODO EN PRODUCCIÓN Y VERIFICADO.** Sesión larga dedicada a arrancar el CRM/Motor de Crecimiento de Folvy (la joya comercial: la cara que el cliente ve para ganar dinero). Decisión estratégica de Julio (INNEGOCIABLE, corrigió a Claude a mitad): NO construir en pasos mínimos/descafeinados; el CRM más potente del mercado, el más automatizado, goleada vs Cheerfy/todos, nada a medias, verificando cada paso importante. Deuda 0 = hacer lo potente ENTERO y bien, no hacer menos.

> **DOCUMENTO NORTE: `docs/folvy_crm_diseno.md` (v2, reemplaza v1).** El cliente registrado es el CORAZÓN del CRM (no un anexo). 4 GOLPES (diferenciadores que nadie tiene): (1) **margen real al céntimo** en toda oferta/recompensa (escandallo delante; Cheerfy/Thanx/Pleez estiman); (2) **sistema unificado** (nace DENTRO: ventas/cocina/escandallo/Shop/stock/economía reconciliada, cero integraciones frágiles); (3) **agente-marketer** (columna vertebral, propone+ejecuta con confirmación contrato B3, abre el CRM al hostelero sin marketer; se construye AL FINAL pero cada pieza se diseña desde ya operable por él); (4) **ciclo cerrado oferta→resultado→margen real** (único que dice si una campaña GANÓ dinero de verdad). ARQUITECTURA: **motor de ofertas ÚNICO** compartido por CRM (ofertas al cliente propio) y plataforma (Pleez-style push a Glovo/Uber/JE, fase aislada futura); Ómnibus-aware (RD-Ley 24/2021, técnica del artículo espejo) + margen real, 100% server-side. **PLAN 10 FASES:** F1 identidad+consentimiento [HECHO] · F2 login+email a comensal [HECHO] · F3 motor ofertas+cupones [HECHO núcleo; falta UI admin + ciclo post-pedido] · F4 área \"Mi cuenta\" (histórico+reorder+mis bonos+progreso) · F5 ciclo post-pedido (encuesta/valoración con recompensa + win-back) · F6 comportamiento+personalización · F7 BI agregado · F8 Salida 2 Pleez+scraping · F9 agente-marketer · F10 sala/reservas. BENCHMARK hecho a fondo: Cheerfy (rival directo ES, cashback+multicanal pero ciego al coste, cliente ideal 5+ locales con marketer), CoverManager (reservas/sala, ref futura), Punchh/Paytronix/Thanx (US enterprise, caros, estiman), Toast IQ Grow (agente+humano 499$/mes porque su agente no ve margen), Pleez (push ofertas a plataformas, scraping competitor tracking). UX área cliente 2026: reorder 1-toque, guest checkout SIEMPRE (forzar registro = +23% abandono), progreso visual, win-back nombrando plato favorito. Imán de registro (Shein): popup primera visita ~10-15s UNA vez + banner persistente + provocar en confirmación + NUNCA forzar.
>
> **(A) F1 — IDENTIDAD + CONSENTIMIENTO (en producción).** Migraciones `20260702T1200_crm_customer_consent.sql` (tablas `customer`[id, account_id, phone, email, name, first_brand/location_id, first/last_seen_at; constraint phone OR email; índices únicos parciales (account_id,phone) y (account_id,lower(email)); RLS por `user_profiles` donde user_id=auth.uid()], `customer_consent`[marketing_email/sms/whatsapp], `customer_consent_log`[append-only prueba legal: action/channel/source/terms_version/ts/ip/ua], + `sale.customer_id` FK) y `20260702T1300_place_shop_order_customer.sql` (place_shop_order crea/vincula customer por dedup email/phone tras insertar la venta, escribe consent+log con terms_version='shop-privacy-v1'; **REGLA DE HIERRO: pedidos de plataforma dejan customer_id NULL**, solo el Shop lo rellena). Checkout: input email opcional + casilla de consentimiento (aparece al teclear email, **SIN marcar por defecto — obligatorio por RGPD/AEPD/Planet49, Claude se negó firmemente a marcarla**) + modal de privacidad. Commits `0ca7d0a`+`36c4d23`+`578b465`. **Nombre comercial corregido:** `accounts.name` de Llorente29 era \"Llorente29 Food\" (razón social en campo comercial); `fiscal_for_print` usa `legal_name` → seguro → UPDATE a **\"Foodint\"**; toda la tienda muestra Foodint. DEUDA: texto de privacidad a validar por abogado; datos fiscales completos (NIF) en el modal.
>
> **(B) F2 — LOGIN DE CLIENTE por código mágico + sesión persistente + email white-label (en producción, verificado en vivo).** DECISIÓN ARQUITECTÓNICA (RECON de Code): **sesión de cliente PROPIA por token, NO Supabase Auth para comensales** — calca el patrón ya en producción de `shop_order_status(p_token)` (RPC SECURITY DEFINER que lee por token no adivinable). El comensal NUNCA es `auth.users` → aislado del personal, sin tocar la RLS existente; encaja con el modelo por cuenta (customer es per-account, login por tienda). Login por **CÓDIGO OTP 6 dígitos** (no magic link: mejor en móvil, no depende de que el email no rompa el enlace). Migración `20260702T1600_customer_login.sql`: `customer` += email_verified/last_login_at; tablas `customer_otp`(code_hash sha256, expira 10min, attempts) + `customer_session`(token único, expires_at 90d, revoked_at); RPCs SECURITY DEFINER `customer_request_login(slug,email)` (acuña OTP, devuelve el código para que la Edge lo envíe) + `customer_verify_login(slug,email,code,ttl_days=90)` (valida, crea/vincula customer email_verified, crea sesión, devuelve sessionToken) + `customer_session_me(token)` + `customer_logout(token)`. **BUG cazado y arreglado** (migración `20260702T1700_customer_login_fix_searchpath.sql`): `digest()`/`gen_random_uuid()` de pgcrypto viven en schema **`extensions`** (no `public`); las RPCs tenían `search_path='public'` → fallaban con `reason:'rpc'`; fix = `set search_path to 'public','extensions'`. Edge **`shop-customer-auth`** (pública, `--no-verify-jwt`, service-role dentro, calca shop-payment-intent): actions request (llama RPC + send-email con service-role vía `x-internal-key`) + verify; anti-abuso; nunca revela si el email existe. Plantilla **`shop_login_code`** en send-email/templates.ts **WHITE-LABEL (marca de la TIENDA, no de Folvy)**: `brandLayout()` con logo+nombre de la cuenta (decisión de Julio: el email del comensal va con marca de su tienda, no de Folvy — estándar de los mejores; los emails de PLATAFORMA (impago/suspensión/welcome) siguen con marca Folvy). El logo sale de **`accounts.logo_url`** (se actualizó al `logo_color_light.png` de Foodint, versión a color para fondo claro, subida a storage — la tienda usa `shop_logo_url` distinto, versión oscura sobre hero, NO se toca). Front: `customerAuthService.ts` (request/verify/getSessionCustomer/logout + token en localStorage por slug) + `CustomerLoginModal.tsx` (email→código 2 pasos) + `ShopHubRoute.tsx` (botón \"Entrar\"/\"Hola,{nombre}\"+Salir en la topbar, antes placeholder). Verificado en vivo: email llega, código entra, sesión persiste al recargar. Commits `ddcb584`+`cc6ec7d`+`03f2859`. DEUDA menor: el nombre \"Julio GC\" sale de una compra previa; editable en F4 (Mi cuenta).
>
> **(C) F3 — MOTOR DE CUPONES (núcleo en producción, verificado; falta UI admin + ciclo post-pedido).** RECON: cupones del Shop = tierra virgen (`account_discount` es del billing SaaS, no reutilizable); `place_shop_order` repreciona server-side; `sale.discount_amount` muerta lista para usar; margen medible vía `compute_sale_line_cost`; \"primer pedido\" por lookup email/phone. DECISIONES: cupón solo sobre **subtotal** (nunca envío, es coste real); guardarraíl de margen **Opción 1** (avisar pero PERMITIR en bienvenida = inversión de captación consciente; suelo duro configurable para el resto; `computed_cost` NULL = no se afirma pérdida, no bloquea). **Sub-paso 1** — migración `20260702T1900_crm_coupons.sql`: tabla `coupon`(account_id, code[NULL=auto sin código], name, discount_type[percent/fixed], value, applies_to[subtotal], min_subtotal, first_order_only, auto_apply, starts/ends_at, max_redemptions[NULL=ilimitado], max_per_customer[default 1], active, omnibus_ref_note[seam Ómnibus], created_by; constraints percent≤100, auto⇒code NULL, ventana válida; índices únicos: código por cuenta, **un solo auto activo por cuenta**) + `coupon_redemption`(coupon_id, sale_id, customer_id, customer_email/phone snapshot, discount_amount, reference_subtotal[seam Ómnibus], margin_after; **índice único parcial (coupon_id,customer_id) que cierra la carrera de la bienvenida**) + `accounts.shop_coupon_margin_floor_pct`(NULL=sin suelo) + RLS (miembros gestionan coupon, LEEN redemption; escritura solo por place_shop_order). Cupón de bienvenida de Foodint insertado a mano: `4a16e0a3...` \"Bienvenida 10%\" percent 10, min 20€, first_order_only+auto_apply. **Sub-pasos 2+3+4** — migración `20260702T2000_place_shop_order_coupons.sql` (recrea place_shop_order entera): (2) el bucle de reprecio acumula coste por línea (menu_item.recipe_item_id→recipe_item.computed_cost) en `v_cost_known`/`v_cost_has_null` → margen medible; (3) resuelve cupón (por código o auto_apply), valida (mínimo, primer-pedido por lookup email/phone, topes total y por cliente), calcula descuento sobre subtotal, guardarraíl 2 niveles (bienvenida avisa/permite, resto suelo duro, NULL no veta), devuelve desglose en dry-run sin persistir; (4) pedido real escribe discount_amount+ajusta total+inserta coupon_redemption (captura unique_violation → degrada a sin descuento sin abortar). **Sub-paso 6 (checkout)** — `checkoutService.ts` (+coupon en payload, +discount/coupon en respuesta, +consent al tipo que faltaba de F1) + `CheckoutRoute.tsx`: estado del cupón vía dry-run (efecto con debounce 400ms), banner verde de bienvenida automática + gancho coral (\"deja tu email\") + campo \"¿Tienes un cupón?\" con mensajes de error amables + fila \"Bienvenida −X€\" en resumen (aside+móvil); el descuento sale del SERVIDOR, el pedido real manda el código y place_shop_order revalida. **BUG cazado y arreglado** (`7598fd8`): el dry-run no se disparaba porque `refreshCoupon` salía si `cart.locationId` era null; fix = usar local de respaldo (candidato/primero) porque el cupón se calcula sobre subtotal, no necesita local. VERIFICADO EN VIVO: banner de bienvenida aplicado, 29,70€→26,73€ (10%), llamada place_shop_order 200 en Network. Commits `4655c47`+`715044e`+`3162989`+`7598fd8`.
>
> **BUG DE DISEÑO PENDIENTE (Julio lo cazó, decisión A2 tomada, arreglo NO construido aún):** la bienvenida se aplica AHORA a cualquier comensal sin email ni registro (descontrolado, contradice el golpe nº1 de control de margen). **DECISIÓN A2: la bienvenida solo se aplica con email + consentimiento marcado** (el descuento COMPRA el contacto con permiso de marketing, propósito real del imán; A1 solo-email capta email no usable legalmente, A3 logueado = demasiada fricción). Arreglo pendiente = cambio quirúrgico en el bloque del cupón de `place_shop_order`: si es bienvenida (first_order_only/auto_apply) y no hay email O no viene consent.marketing=true → no aplica (reason 'needs_contact', discount 0). **ES LO PRIMERO A HACER al retomar el CRM.**
>
> **FRENTE PROPIO ANOTADO (Julio lo pidió hace turnos, Claude lo aparcó mal, recogido; NO urge, hacerlo cuando sea sensato en el orden):** CONFIGURACIÓN PERSONALIZADA de la oferta de bienvenida por cada cliente de Folvy (Llorente29: \"20%, o 4€ por pedido, probar cuál convierte\" = A/B testing de conversión) — el motor YA lo soporta (tabla coupon con discount_type/value/min_subtotal), falta la UI de admin (sub-paso 5 de F3) con **impacto en margen real al configurar** (RPC `preview_coupon_impact`: \"con −20%: margen medio 61%→39%, N platos bajo suelo, N sin escandallo — complétalos para ver impacto real\" = golpe nº1 visible al decidir) + que **el agente proponga la bienvenida por histórico** (ticket medio, márgenes, conversión → F9). Orden: A2 primero → UI config con impacto de margen → agente propone. PULIDO menor pendiente: cuando la bienvenida ya está aplicada, sobra el gancho coral (se pisan).
>


**Lo anterior: 2026-07-01 (CIERRE · noche). STRIPE PRODUCCIÓN LIVE MONTADO (esperando verificación de Stripe) + REPARTO POR LOCAL EN ORDERS + TIENDA ABIERTA AL PÚBLICO + FIX CRÍTICO DE COCINA (pago).** Sesión de puesta en producción del cobro real del Shop + cierre del frente de reparto.

> **(A) STRIPE PRODUCCIÓN LIVE — casi entero, bloqueado solo por la verificación de Stripe (hasta 24h).** Se activó la cuenta de plataforma **LIVE a nombre de Julio Gª Colón como AUTÓNOMO** (Empresario Individual, NIF …491S; NO la sociedad Fplvy que era el nombre de test — cosmético, el nombre público sigue "Fplvy S.L.", cambiar a "Folvy"). **Connect activado, modelo PLATAFORMA** (direct charges: los comerciantes cobran directo, onboarding alojado en Stripe = Express, Stripe gestiona el riesgo). **Claves live puestas:** `STRIPE_SECRET_KEY` (sk_live "Folvy producción", acceso completo) en Supabase secrets; `VITE_STRIPE_PUBLISHABLE_KEY` (pk_live_…wKG7) en Vercel (proyecto **folvy-app**, Production+Preview, con redeploy sin caché — la variable NO existía antes, por eso el Payment Element nunca inicializaba en producción); `STRIPE_WEBHOOK_SECRET` (whsec del webhook de producción). **NOTA:** Supabase muestra los secrets **hasheados** (2008b82f…/63adecc…), NO el valor real — es normal, no se puede verificar mirando, solo confiar o probar. **Webhook de producción** creado en Stripe live (Workbench → Webhooks, "Folvy Shop producción"): URL `https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/stripe-webhook`, **ámbito = CUENTAS CONECTADAS** (crítico: los pagos ocurren en la cuenta del restaurante, no en la plataforma; con "tu cuenta" nunca llegarían), 2 eventos `payment_intent.succeeded` + `payment_intent.payment_failed`, versión API 2026-06-24.dahlia. **3 edges redesplegadas** con secrets live: `stripe-webhook` **--no-verify-jwt** (Stripe llama sin JWT); `shop-payment-intent` y `stripe-connect-onboard` **sin** la flag (JWT de usuario). **Llorente29 reconectada en LIVE:** se puso `accounts.stripe_account_id` de foodint (51ad1792) a NULL para forzar cuenta nueva live (el `acct_1TmwGv` era de test) → el onboarding creó **`acct_1ToSNz31tAYkxzan`** live; datos del restaurante Llorente29 Food SL, **Julio es admin legal** (representante válido), IBAN BBVA de Llorente29, comisión `shop_fee_bps=500` (5%, confirmado). **ESTADO: onboarding "incompleto" porque Stripe verifica la identidad de la sociedad (hasta 24h) — no depende de nosotros.** La **prueba de cobro real FALLA todavía** ("No se pudo iniciar el pago"): el pedido nace bien (new/pending, sin `stripe_payment_intent_id`) → `shop-payment-intent` NO crea el intent → **causa casi segura = cuenta conectada sin verificar aún. PRIMER PASO próxima sesión = leer el error EXACTO en los logs de `shop-payment-intent`** (`account_invalid`/`capabilities` = esperar a Stripe; `authentication` = clave mal). Cuando Stripe apruebe → refrescar estado en el panel → probar un cobro pequeño real → verificar dinero a Llorente29 + 5% a la plataforma. **DEUDAS Stripe:** cambiar nombre público Fplvy→Folvy; Bizum + quitar iDEAL/Klarna en la conectada; rotar secrets de TEST (ya no se usan); comisión por defecto de clientes nuevos (nacen shop_fee_bps=0); migrar a Folvy SL cuando la sociedad exista (hoy autónomo).
>
> **(B) FRENTE DE REPARTO CERRADO — selector por local + fila en Orders + botón de despacho manual (todo en producción, rev-list 0).** **Selector de despacho POR LOCAL** (commit `1ab68fc`): `locations` gana `dispatch_mode`('auto'/'manual', default auto) + `dispatch_broker` (CHECK catcher/jelp/uber_direct/shipday, default catcher). El **trigger viejo `trg_auto_dispatch_catcher`** (cableado a `source='folvy_shop'`, solo AFTER UPDATE, que NO despachaba los own_delivery de Last) fue **REEMPLAZADO** por `tg_auto_dispatch`/`trg_auto_dispatch` **AFTER INSERT OR UPDATE** con guardarraíl por **`service_type='own_delivery'`** (cubre Shop + Last own_delivery, NUNCA platform_delivery), dispara si el local está en auto + broker=catcher, idempotente por `carrier_order_id`, secreto interno embebido. **UI en Configuración → Locales → Configuración avanzada** (decisión de Julio: es config operativa del local, junto a fichaje/recepciones/horario — NO en la ficha del conector, donde quedaría escondida si mañana el broker es otro): `DispatchConfigSection.tsx` + `locationDispatchService.ts` (usa `.update(row as never)` por database.ts sin regenerar), montado en `OtherPages.tsx` (`LocationsPage`) tras el horario general; se revirtió el bloque que se puso primero en `ConnectorDetailPage`. Migración `20260701T1600_dispatch_config_local.sql`. **Fila de reparto en Orders** (commit `0bb91a8`): `OrderCard` → componente `DeliveryRow` con **3 caras según QUIÉN reparte (`carrier_code`, NO el canal de venta)** — (i) own_delivery SIN carrier → botón azul "Despachar a Catcher" (rojo "Reintentar" + motivo si `dispatch_error`); (ii) platform_delivery sin carrier → "Lo lleva Glovo/Uber/JE" plegable con teléfono de soporte (Glovo 931227262, Uber 911232186, JustEat 910507394); (iii) despachado → broker + estado + rider + tel + ETA plegable. El despacho manual invoca la edge `catcher-dispatch {sale_id}` (sin `internal:true`, basta el JWT de usuario). Realtime sobre la tabla `sale` refresca la tarjeta tras despachar. `ordersFeedService`: `deliveryView` + `isOwnDeliveryUndispatched` + `dispatchOrder` + `PLATFORM_SUPPORT`. Migración `20260701T1700_orders_feed_dispatch_error.sql` (añade `dispatch_error` al feed). Maquetas aprobadas por Julio antes de construir.
>
> **(C) FIX CRÍTICO DE COCINA — guardarraíl de pago (bug real cazado por Julio).** Un pedido `folvy_shop` pagado con tarjeta (stripe) pero **con el pago SIN confirmar** se mostraba en la **tablet de cocina**: `orders_feed_by_token` (la versión de la tablet/estación) NO tenía el filtro que sí tenía `orders_feed` → cocina veía y aceptaba pedidos sin cobrar. Además el filtro viejo (`not(source='folvy_shop' and order_status='new')`) era **insuficiente**: un online que avanza a accepted/in_preparation con pago pending se colaba igual. **NUEVO guardarraíl idéntico en AMBAS funciones** (migración `20260701T1800_orders_feed_gate_pago.sql`): `and not (s.source='folvy_shop' and s.payment_method='stripe' and coalesce(s.payment_status,'pending') <> 'paid')` — oculta cualquier online sin pago confirmado **sin importar el `order_status`**; el efectivo (cash) siempre se ve. `place_shop_order` y `mark_shop_order_paid` estaban **bien** (el online nace new/pending; solo el webhook lo pasa a accepted+paid) — el código era correcto, faltaba el filtro del feed by-token. Verificado en vivo: el pedido de prueba de Ay Mamita Bowls (49,60€, stripe/pending) desapareció de la tablet.
>
> **(D) TIENDA ABIERTA AL PÚBLICO** (commit `de5c747`): quitados los banners "Vista previa" de `ShopHubRoute` y `BrandMenuRoute` + el `aside` "Pedidos online muy pronto" del hub (el carrito real `CartPanel` ya operaba aparte; el aside solo era decorativo). El "Añadir" del `BrandMenuRoute` ya dependía solo de `menu.isOpen`, no del flag de preview.
>
> **(E) DIAGNÓSTICO WEBHOOK CATCHER→FOLVY (pendiente de su lado).** El despacho Folvy→Catcher **funciona** (guarda `carrier_order_id`), pero la vuelta (el rider) NO llega — `external_webhook_log` con **0 filas de Catcher** = **Catcher NUNCA ha llamado al webhook**. El código de `catcher-webhook` está **bien** (cruza por `externalId`=sale.id / `carrier_order_id`, mapea rider_name/phone/transport_price/delivery_state). **RAÍZ: Catcher no tiene registrada la URL del webhook.** Email enviado a `it@catcher.delivery` desde partners@ pidiendo registrar `https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/catcher-webhook` para Orders + HD; `catcher-webhook` redesplegado `--no-verify-jwt`. Los "Luis Driver/Miguel A." que se veían antes eran UPDATEs manuales de prueba, nunca hubo flujo real Catcher→Folvy. **PENDIENTE: que Catcher registre la URL → el rider llegará solo a la BD** (y la fila de Orders ya lo mostrará, verificado con el pedido que sí tenía rider).
>
> **DEUDA del cierre:** regenerar `database.ts` (CLI ya reinstalado hoy; quita el `as never` de `locationDispatchService`). Rotaciones arrastradas: secrets de TEST de Stripe, secreto interno del trigger de Catcher (`fv_catdisp_`) y credenciales sandbox de Catcher (al pasar a prod), `service_role` + tokens de webhook. **Frentes siguientes:** cerrar deudas de Stripe producción (nombre, Bizum, comisión por defecto), dominio de la tienda (hoy app.folvy.app/t/foodint), impresión y el resto del frente de imagen (pantallas de gestión + móvil).

Deuda del Shop consolidada en docs/folvy_shop_deuda.md.

SHOP · SUBDOMINIO POR TIENDA EN PRODUCCIÓN (02/07): cada tienda resuelve por hostname <slug>.folvy.app (foodint.folvy.app live, SSL ok), navegación base-aware, retrocompatible con /t/slug. Nuevo módulo src/modules/shop/shopHost.ts (isShopHost/shopSlugFromHost); ShopHubRoute resuelve host-first + shopBase; App.tsx monta el Shop por hostname. Sin tocar nameservers ni correo (OVH intacto). Alta de tienda nueva = Add Existing en Vercel (OVH resuelve por CNAME wildcard *). Commit del subdominio en main.

**Última actualización: 2026-06-29 (CIERRE 9 · noche). MARCO MULTI-AGENTE DE FOLVY + FOLVY COPILOTO — el agente ACTÚA, no informa. De chatbot a copiloto que ejecuta acciones reales con confirmación.**

> Sesión larga y monotemática sobre el agente de IA. Mandato de Julio: "los agentes no solo informan, ACTÚAN y EJECUTAN; algo muy avanzado en agentes; que ayude de verdad, no figura decorativa para vender". Todo construido contra benchmark del estado del arte 2026 (Toast IQ, Amazon Bedrock HITL, DoD human-in/on/out-of-loop, EU AI Act art.14, casos de fallo en producción). Documentos de diseño versionados en `docs/`: `folvy_agent_framework.md`, `folvy_b3_contrato_ejecucion.md`, `folvy_kitchen_auditoria.md`, `folvy_kitchen_plan_superacion.md`.

**(A) MARCO MULTI-AGENTE (reutilizable) — EN PRODUCCIÓN.** No se construyó "el agente de Kitchen" sino el MARCO de agentes de Folvy; Kitchen es la primera implementación. Refactor del edge `supabase/functions/folvy-ai/index.ts`: **B1 registry `AGENTS[module]`** (cada agente declara persona + tools + modelo), `resolveAgent(module)` con fallback a `_default`; **B2 persona componible** (BASE_FOLVY común + persona del agente). Quitado el encuadre viejo "cocinas fantasma" → "hostelería" (coherente con el posicionamiento). El `module` viaja del front (Shell→Bubble→hook→body) y selecciona el agente. Añadir un agente = una entrada en el registry. **Segundo agente previsto = Team (Personal)**, para reorganizar ese módulo que está mal; valida que el marco escala (se aborda tras Kitchen probado).

**(B) FIX DE AUTH CRÍTICO — el agente por fin LEE datos reales.** Bug del código original (no del refactor): `createClient(url, userJwt)` pasaba el JWT donde va la ANON KEY → el gateway lo rechazaba como apikey inválida → error de auth en TODA lectura RLS (tool `catalog_health` Y memoria `ai_memory`, esta última fallaba en silencio). El agente "nació desfasado" porque nunca pudo autenticar. FIX: `createClient(url, anonKey, {global:{headers:{Authorization: Bearer jwt}}})` — patrón canónico de las otras 7 edge functions. Añadido `SUPABASE_ANON_KEY` al env leído + al ToolContext. VERIFICADO EN VIVO: el agente lee, razona y prioriza por impacto € ("85,7% bajo control, 1.355€ sin mapear, top birria 1.600€ sin coste, ¿asignamos?").

**(C) CONTRATO DE EJECUCIÓN CON AUTONOMÍA GRADUADA (B3) — la pieza que hace al agente ACTUAR.** Patrón propose→confirm→execute, estándar 2026 (Bedrock User Confirmation + Return of Control). **Tabla `ai_action`** (migración `20260629T2100`): libro mayor por cuenta con ciclo de vida (proposed/confirmed/executed/rejected/failed/rolled_back), risk (L0/L1/L2), summary, args, effect_preview, result, **rollback_hint OBLIGATORIO para L1/L2** (lección de los casos de fallo: agente sin rollback borró un disco entero), proposed_by/confirmed_by/session_id. RLS calcada de `ai_memory` (lectura `account_id = ANY(current_user_account_ids())`, escritura `current_user_is_admin_of`). **RPC `propose_ai_action(...)`** (SECURITY DEFINER, exige rollback_hint en L1/L2, devuelve uuid) — la llama el edge. **RPC `commit_ai_action(action_id, edited_args)`** (SECURITY DEFINER): verifica admin, idempotente (no re-ejecuta executed), despacha por tool_name, marca executed/failed, nunca a medias. **Autonomía graduada por riesgo:** L0 auto (audita, no frena) / L1 tarjeta de confirmación / L2 reforzado. Configurable por cliente (Fase B). El contrato es del MARCO: todos los agentes lo heredan.

**(D) PRIMERA WRITE TOOL `assign_resale_cost` — EJECUTADA DE VERDAD (la birria).** El agente detectó en vivo 1.600€ de birria sin coste y le dimos la herramienta para cerrar ESE hueco real (decisión: el agente útil resuelve el problema que detectó, no un caso de demo). La tool PROPONE (no escribe): resuelve el ancla `recipe_item_id` por nombre del menu_item (Puerta 1 directa de `classify_unmapped_product`, evita el callejón `needs_target`), llama `propose_ai_action`, devuelve sobre `pending_confirmation`. Al confirmar → `commit_ai_action` → `classify_unmapped_product(account, name, 'resale', unit_cost, recipe_item_id)`. **VERIFICADO EN BD**: QUESATACOS DE BIRRIA (DC) → recipe_item `5e55dc57` quedó type=raw, cost_strategy=fixed, fixed_cost=2.30, is_sellable/is_purchasable=true. **La primera acción real ejecutada por un agente de Folvy.** Bugs cazados en el camino: (1) `commit_ai_action` llamaba `classify_unmapped_product` como escalar cuando devuelve TABLE → "invalid input syntax for type json" → arreglado leyéndola como tabla (migración `20260629T2300`); (2) `p_edited_args` null como jsonb → merge defensivo (migración `20260629T2200`, ya superada por la T2300).

**(E) TARJETA + MODAL CENTRAL de confirmación.** El edge emite un evento SSE nuevo `action_proposed` (sobre estructurado, no texto a parsear) cuando una write tool propone; el service lo reconoce, el hook lo guarda como `pendingAction` en el mensaje. **Modal CENTRAL a pantalla completa** (`FolvyAIActionModal.tsx`, decisión de Julio: una acción que cambia datos de negocio merece tomar la pantalla, no un cartelito lateral): resumen + efecto desglosado + [Confirmar]/[Cancelar], backdrop oscuro. Tras confirmar → estado de ÉXITO visible (palomita verde grande "Hecho" ~2,5s) → se cierra solo. La tarjeta pequeña inline (`FolvyAIActionCard.tsx`) queda solo como registro en el hilo. `commit_ai_action` se llama vía cast `(supabase as any).rpc` (database.ts sin regenerar = deuda).

**(F) MODELO POR AGENTE.** `AgentDef.model` opcional; Kitchen declara `claude-sonnet-4-6` (razona sobre márgenes). Prioridad: `FOLVY_AI_MODEL` (env, override global para abaratar pruebas con Haiku sin tocar código) → modelo del agente → DEFAULT. Permite enrutar por complejidad (Haiku para simple, Sonnet para razonar) cuando entren más agentes.

**(G) VOZ — ida y vuelta (Web Speech API, gratis, español).** Hook `useVoice.ts`: STT (`SpeechRecognition`, botón de micrófono en el composer, transcribe al input) + TTS (`SpeechSynthesis`, toggle de altavoz en cabecera, lee la respuesta al terminar). Selección de la mejor voz española disponible (prioriza neuronales/"Online Natural"/"Enhanced" sobre la robótica por defecto). LIMITACIÓN: la voz del sistema suena a "máquina antigua" en muchos Chrome (Edge trae voces Microsoft Online Natural mucho mejores). DEUDA: TTS premium (ElevenLabs/OpenAI) para producción — voz natural, coste por uso solo cuando el toggle está activo, se mete en el escandallo del agente.

**(H) FOLVY COPILOTO — identidad de marca.** Renombrado "Folvy AI" → **"Folvy Copiloto"** (benchmark: "copilot" es el término ganador 2026, NO "asistente"/"chatbot"; comunica "actúa contigo"; los líderes usan marca+función, no nombres humanos propios para B2B). Carta de presentación en el empty state con el isotipo de Folvy (identidad inequívoca de marca, NO foto de persona — eso resta seriedad en B2B), tagline "No solo te informa: actúa contigo, siempre con tu confirmación", y las 4 capacidades REALES. **Primer encuentro (opción C):** la primera vez en una cuenta se muestra la presentación; después, saludo proactivo. Flag por cuenta en localStorage. Atribuciones y etiquetas de tools con nombres legibles ("Folvy Copiloto consultó: asignación de coste").

**FICHEROS CLAVE:** edge `supabase/functions/folvy-ai/index.ts`; front `src/modules/folvy-ai/` (hooks `useFolvyAI.ts`+`useVoice.ts`; components `FolvyAIBubble.tsx`/`FolvyAIComposer.tsx`/`FolvyAIMessage.tsx`/`FolvyAIActionCard.tsx`/`FolvyAIActionModal.tsx`; services `folvyAIService.ts`; types `folvyAI.ts`); `src/shell/Shell.tsx` (pasa module). Migraciones `20260629T2100/T2200/T2300`. Commits c5ad39b/a7e11b7/58b7e13/5838223/7ab6afb (+ varios), todos rev-list 0.

**DEUDAS DECLARADAS (este frente):**
- **PANEL DE CONSUMO DE IA POR CUENTA (URGENTE).** Folvy es multi-tenant; el coste de la API de Anthropic es coste variable POR CLIENTE. La base ya existe (`ai_interaction` guarda tokens_in/out, account_id, model por turno). Falta el panel que sume tokens × precio-del-modelo por cuenta/mes = "escandallo del agente". Sin esto no se conoce el margen real del SaaS ni se puede poner precio/límite. Sesión dedicada.
- **AUTO-RECARGA de créditos Anthropic + límite de gasto** (operativa, producción): el saldo se agotó en pruebas y el agente quedó mudo ("No he podido responder" = IA HTTP 400 credit balance). Un copiloto de cocina no puede callarse a media noche por saldo. Configurar auto-reload + spend limit en console.anthropic.com.
- **TTS PREMIUM** (ElevenLabs/OpenAI) para producción — voz natural; coste solo con toggle activo.
- **SEGUNDO AGENTE = Team** (reorganizar el módulo + validar que el marco escala).
- **Write tools pendientes:** `reprice_menu_item` (L1; patrón listo, efecto real reutilizando `computeEngineering` = (newMargin−currentMargin)×unitsSold de `menuEngineeringService.ts`); más acciones (86, sustituir ingrediente).
- **UI de selección de candidato** cuando `classify_unmapped_product` devuelve `needs_target` con varios candidatos (hoy la tarjeta dice "asígnalo desde la ficha").
- **Carta de presentación del agente (Fase B):** avatar/identidad + toggle de activación + nivel de autonomía configurable (conecta con B3). Cuando el agente ya ejecute bien.
- **Capa proactiva (Fase B):** feed "Para ti" de margen en el Resumen de Kitchen (como Toast IQ pero sobre coste/margen, que él no ve).
- **B4/B5 del marco:** memoria por módulo + tool `remember` (estrena escritura de `ai_memory`; fix CHECK `surface='opening'` de `ai_interaction` que pierde logs de saludo); front por superficie completo.
- **`database.ts` sin regenerar** (cast en `commit_ai_action` del hook). CLI supabase npx rota en la máquina (usar global de scoop).

**(I) AUDITORÍA FOLVY KITCHEN + FRENTE NUEVO ABIERTO (comodidad de uso + imagen).** Al inicio de la sesión se auditó Kitchen zona por zona con benchmark competitivo (doc `docs/folvy_kitchen_auditoria.md`). VEREDICTO HONESTO: Folvy Kitchen **gana decisivamente en el núcleo económico** (escandallo al céntimo reconciliado, AvT+inventario perpetuo que meez no tiene e iguala a R365 con "salud del dato", unidades de uso amigables, AECOC CEP, modificadores con coste real, y ahora el copiloto que actúa sobre el margen — único). **PIERDE o empata en comodidades de recetario:** (1) escalar receta NO existe (meez lo vende como estrella); (2) vídeo por paso (meez sí; Folvy tiene pasos vinculados a ingredientes que meez no); (3) versionado de recetas (meez/Apicbase sí, Folvy no); (4) "Añadir a carta"/vincular escandallo↔menu_item a medio cablear (107 menu_items con recipe_item_id a escandallos vacíos; botón "Añadir a carta" muerto sin onClick en RecipeEditorPage:2330); (5) madurez/rodaje de los veteranos. Huecos acotados, conocidos, casi todos de construcción (no de arquitectura). **FRENTE NUEVO ABIERTO POR JULIO (próxima sesión, ver guion vivo): COMODIDAD DE USO + MEJORA SUSTANCIAL DE IMAGEN DE PANTALLAS, incluida revisión de pantallas MÓVIL.** Sustituir/igualar a la competencia en los huecos de recetario + subir el listón visual de toda la app + responsive (recordatorio: el sidebar no colapsa en móvil/tablet — deuda de App.tsx que requiere permiso explícito de Julio).

---

**Última actualización: 2026-06-27 (CIERRE 7 · noche-2). FOLVY SHOP — NÚCLEO TRANSACCIONAL COMPLETO Y VERIFICADO EN VIVO (pago Stripe Connect + efectivo + cascada a cocina/impresión + caducidad).**

**(A) PAGO STRIPE CONNECT — COMPLETO Y PROBADO EN VIVO.** Direct charges sobre la cuenta conectada del restaurante (el dinero entra en SU cuenta; Folvy cobra `application_fee` = total×`shop_fee_bps`/10000). Edge `shop-payment-intent` (crea PaymentIntent con application_fee) + `stripe-webhook` (`constructEventAsync` verifica firma, `mark_shop_order_paid` mueve new→accepted server-side, `--no-verify-jwt`). Checkout: Payment Element de Stripe (`@stripe/react-stripe-js`) con `<Elements stripe={loadStripe(pk,{stripeAccount:connectedAccountId})}>`. Probado en vivo con tarjeta 4242: pedido pagado, fee aparece en plataforma. **ONBOARDING REAL desde panel admin** (Account Links API, NO pegar acct_ a mano): Edge `stripe-connect-onboard` (create_link/refresh_status, crea cuenta Standard + Account Link, guard `decodeFolvyClaims` exige `folvy.is_platform_admin`, CON verify-jwt) + `StripeConnectSection.tsx` (estado + botón conectar + comisión % sin SQL). Plataforma test = **Fplvy S.L.** `acct_1TmvYmQSZIt7d1og`; conectada Llorente29 `acct_1TmwGv3dRj8xVJQn` (en `accounts.stripe_account_id` de foodint). Migraciones 20260627T2100/T2200/T2300. Commits b117c8b/ce5bc5e/1254de3 (rev-list 0).

**(B) MÉTODOS DE PAGO CONFIGURABLES POR CUENTA + EFECTIVO.** Decisión de producto (Julio): **efectivo se acepta automático, online espera confirmación de pago**. 3 flags en `accounts`: `shop_pay_online`(default true)/`shop_pay_cash_pickup`/`shop_pay_cash_delivery`(default false) + RPC pública `shop_payment_config(slug)`. `place_shop_order`: si `payment.mode='cash'` → inserta en 'new' y UPDATE a 'accepted' (el UPDATE dispara los triggers AFTER UPDATE de impresión+Catcher; nacer directo en accepted NO los dispararía) → devuelve `accepted:true`. Checkout muestra botones según config y modo: "Ir a pagar" (online) + "Pagar en efectivo al recoger/entrega" (cash, va directo a confirmación). Fallback seguro: si config falla, solo online (nunca abre efectivo por error). Etiqueta "Para llevar"→**"Recoger en el local"**. `feed`/`kds_board` filtran `not (source='folvy_shop' and order_status='new')` → online sin pagar NO entra en cocina. Panel admin: 3 toggles en sección Cobros. Migraciones T2400/T2500. Commits baf9b08/75ea725 (rev-list 0). VERIFICADO EN VIVO: efectivo nace accepted + 3 print_jobs; online en new = 0 jobs y no se ve en cola.

**(C) CADUCIDAD DE PEDIDOS ABANDONADOS.** `expire_unpaid_shop_orders(30)` cancela (no borra, conserva traza de conversión) los `folvy_shop` en `new` sin pagar >30min. Cron `expire-unpaid-shop-orders` cada 5min (jobid 7). Solo afecta online abandonado (efectivo nace accepted). Migración T2600. Commit 638ed8d. VERIFICADO: pedido envejecido 40min → cancelado.

**(D) BUG PRODUCCIÓN selector de locales — ARREGLADO.** El cliente "no veía sus locales" (solo "Todos"). RAÍZ: timing — AppContext arranca `locations` de caché vacía y la sync tarda; el selector pintaba estado engañoso. RLS y datos siempre OK. FIX: `LocationSelector.tsx` muestra "Cargando locales…" deshabilitado si (cloudEnabled && activeAccountId && lista vacía && (syncing||lastSync===null)). Commit e2de5bc. Verificado borrando caché.

**(E) OPERACIÓN EN LOCAL — VERIFICADA CON HARDWARE REAL.** Tablet "Tablet J" (`4e522d23`, Plaza Castilla, kds_device por token) conectada al Shop; pedido del Shop entra en la pantalla Pedidos. Cadena de impresión validada en vivo: pedido→cola→agente local→NT311→**3 tickets impresos** (bag/kitchen/labels). El trigger imprime al ACEPTAR (`trg_auto_print_on_accept`), no al terminar. **HALLAZGO IMPRESIÓN (frente propio):** el agente local en modo terminal manual es solo DESARROLLO; para comercializar hay que empaquetarlo invisible (servicio Windows con instalador / impresora cloud Sunmi sin agente / tablet como puente). La nube NUNCA habla directo con impresora LAN — SIEMPRE hay un puente local (Otter/Deliverect dan el hardware con el agente dentro). Motor ya agnóstico de transporte. Decidir cloud / agente-servicio / ambos.

**(F) CONSUMO STOCK/AvT DEL SHOP — motor OK, BLOQUEADO POR DATOS.** `tg_sale_consumption_on_complete` + `generate_sale_consumption` son AGNÓSTICOS de source (cualquier venta consume al pasar a `completed` vía escandallo, idempotente). PERO los 107 `menu_item` con `recipe_item_id` apuntan a recipe_items VACÍOS; los escandallos reales (ej. Birria Chicken Bowl 19 líneas, recipe_item `912d49c4`, menu_items_enlazados=0) existen en Kitchen SIN enlazar al catálogo. **Frente transversal "enlazado catálogo↔escandallo"**: afecta a TODA venta (Glovo/Uber/Last también), no solo Shop — sin enlace, ninguna venta alimenta el AvT. Patrón: emparejar por nombre/código los 107 productos con sus recipe_items reales, repoblar `menu_item.recipe_item_id`.

**(G) NOTIFICACIÓN AL CLIENTE — ARQUITECTURA DISEÑADA, APARCADA (dependencia externa: proveedor WhatsApp).** Diseño agnóstico de canal: tabla outbox `customer_notification` (sale_id, customer_phone/email, event, payload, channel, status pending/sent/delivered/failed, attempts) + dispatcher con adaptadores (email Resend ya montado=1er adaptador real; WhatsApp/SMS enchufables). Preferencia de canal por cuenta. **COSTES investigados (España 2026):** WhatsApp utility 0,0166€/msg (gratis en ventana servicio 24h) + ~49€/mes BSP (360dialog sin markup, el más limpio); SMS A2P 0,05-0,09€/msg (el más caro, NO usa tarifa personal — es proxy/centralita, no SIM); email casi gratis. **El SMS "gratis" de tu tarifa es P2P, NO sirve para envíos automáticos A2P.** Modelo A (un WhatsApp de Folvy) vs B (por restaurante, tipo Stripe) sin decidir. Disparador: cuando Julio resuelva proveedor + plantilla aprobada por Meta.

**(H) HALLAZGO CRM (estratégico, sesión dedicada futura).** El "histórico de clientes" para CRM/loyalty/marketing: el **teléfono de pedidos `lastapp` es PROXY de plataforma** (Uber/JustEat usan número-centralita único + código; "Влад С." con 260 pedidos/13 marcas/6.487€ = ruido técnico, NO cliente). Solo el teléfono de canales PROPIOS (Folvy Shop, reparto propio real) identifica a una persona. CRM real hoy = ínfimo (Shop recién nacido). PERO direcciones/horas SÍ explotables para **BI geográfico agregado** (zonas calientes, horas pico por marca — LEGAL, es estadística interna). RGPD: usar dato de plataforma para CONTACTAR sin consentimiento es ilegal (multas 20M€). Idea Julio (owned-channel migration): detalle físico al entregar (pegatina/QR) que invita a registrarse → puente de consentimiento → marketing legal. Roadmap grande (BI agregado ya / captación consentimiento / CRM-loyalty-marketing con WhatsApp). Benchmark loyalty: Punchh/Paytronix/Thanx (card-linked frictionless, recompensa consciente del margen=terreno Folvy), Talon.One (motor único reglas ofertas+loyalty). Decisión Pleez (ofertas a PLATAFORMAS, no clonar) sigue vigente y es distinta de ofertas en el Shop propio (territorio limpio).

**(I) DEUDAS PRODUCCIÓN STRIPE (anotadas):** activar Bizum + quitar iDEAL/Klarna/Bancontact/EPS en la conectada (panel Stripe + onboarding real); plataforma DEFINITIVA Folvy SL (no Fplvy test); webhook Stripe de producción; comisión por defecto para clientes nuevos (hoy nacen shop_fee_bps=0); ROTAR todos los secrets de test (STRIPE_*, fv_catdisp_, fv_cron_, fv_oadv_).

**Lo anterior (2026-06-24, CIERRE 5). SESIÓN MONOTEMÁTICA — bug silencioso de recepciones resuelto de raíz + modal "Meter al stock" (solución definitiva).**

**(A) BUG SILENCIOSO DE RECEPCIONES — RESUELTO, EN PRODUCCIÓN.** Recepciones confirmadas que NO metían el género al stock, en silencio (raíz: goods_receipt_line sin triggers/constraints; confirm_goods_receipt saltaba líneas sin formato/qty_in_base y confirmaba igual con aviso "revisar" inútil para cocina). Construido: `post_pending_receipt_line(line_id)` (postea una línea pendiente, resuelve formato de línea o de proveedor preferido, idempotente; baja needs_review SOLO si NO queda ninguna línea sin movimiento — FIX CRÍTICO: antes el indicador mentía) + `post_pending_receipt(receipt_id)` v3 (devuelve posted/still_pending/pending_items con razón sin_articulo|sin_formato). Migraciones 20260623T2200/T2300/T2400/T2500. Commits 1a55c5b, rev-list 0 0.

**(B) MODAL "METER AL STOCK" — SOLUCIÓN DEFINITIVA.** `PostPendingModal.tsx` (NUEVO, src/modules/supply/components/): lista cada línea pendiente con su razón y la resuelve SIN SALIR del modal. 'sin_articulo' → casa con LineMatchPicker (busca/propone IA/crea artículo nuevo). 'sin_formato' → editor compacto (simple o caja×pieza, reusa convertToBase/ensurePackTree). Artículo nuevo sin proveedor → enlace AUTOMÁTICO al proveedor del albarán (supplier_id de la recepción). Tras resolver, postea solo. Badge rojo fuerte "Falta meter al stock" (antes "revisar" débil) + botón en RowActions (GoodsReceiptsPage.tsx). goodsReceiptService.ts: postPendingReceipt + postPendingReceiptLine. VALIDADO EN VIVO: ALB-00014 3 líneas dentro (papel 50m, Nachos 750g, Tajín 450g), alubia ALB-00023 18.000g Plaza Castilla.

**(C) UNIDADES DE LONGITUD cm/m.** Ampliado CHECK kitchen_unit_dimension_valid a 'length'; sembradas cm (base, factor 1) y m (factor 100), globales. Migración 20260624T0600 (idempotente). Permite formatos amigables "1 rollo de 50 m" (papel horno/film/aluminio). Papel de horno cambiado de base 'ud' a 'm'.

**(D) ANTES EN LA SESIÓN.** Editor de formato en ficha de ingrediente (PurchaseSourcesSection.tsx, commit 0fa9993) con flip fixed→last_purchase para que el coste fluya desde la compra. Banner de validación para raw (ReviewBanner.tsx + KitchenItemDetailPage.tsx, commit a275291): "Pendiente de validar"/"Falta el coste"/"Dar por bueno".

**DEUDA DE RAÍZ DECLARADA (frente futuro):** que la recepción al CONFIRMAR no permita "confirmar y olvidar" en silencio — estado "confirmada con pendientes" como ciudadano de primera, indicador permanente. Requiere RECON de confirm_goods_receipt + benchmark blind-receiving, sesión dedicada. Hoy se hizo RECUPERABLE y VERAZ.

---

**Última actualización: 2026-06-23 (CIERRE 4). SESIÓN MIXTA — integración cliente 2 en Last + fix Folvy Orders (día de negocio 04:00) + verificación adaptador HubRise + arranque de la carga de costes de Llorente29 desde Cloudtown.**

**(A) CLIENTE 2 (Kitchen Grill LstQ, cuenta `f69e10fa-f641-4152-b8d8-8e03d843415a`) INTEGRADO EN LAST, EN VIVO.** Tienda Ensanche Vallecas (Last locationId `ff12b2bf-5a00-4c98-a9a7-cda2c56c6fa4`, org Cloudtown `b7bc4753`) vinculada a su local Folvy (`b88dd4a6-7f1c-4bb8-b2a5-e796093642c1`) en `external_location_map` (source='lastapp'); integración Folvy instalada en la tienda desde el panel de Last; aparece en el integrador (7 ubicaciones, antes 6). **Aislamiento de ventas VERIFICADO en el código del webhook**: `lastapp-webhook` resuelve `account_id` por `locationId` vía `external_location_map`, NO por marca → las ventas del cliente 2 entran a su cuenta sin mezclarse con Llorente29 aunque compartan marcas cedidas. **BUG ABIERTO (no toca ventas):** la pantalla de "marcas pendientes" del cliente 2 muestra marcas PROPIAS de Llorente29 (Foodint `31f13f35`) porque el importador/listado pide el catálogo POR ORGANIZACIÓN (Cloudtown, compartida) en vez de POR `locationId`; confirmado contra la API de Last (`/catalogs` exige `locationId`; `/organizations/{org}/catalog` mezcla). NO importar catálogo del cliente 2 hasta el fix. Proceso de alta documentado (borrador) en `docs/folvy_onboarding_cliente_last_cedidas.md`; DOS pasos marcados ⚠️ pendientes de cerrar el acceso autorizado con Last/CTB (descartado el atajo de manipular la URL).

**(B) FIX FOLVY ORDERS — DÍA DE NEGOCIO CON CORTE 04:00, EN PRODUCCIÓN.** Lo que parecía "faltan pedidos en Orders" NO era bug: todas las ventas de hoy en BD con `order_status` poblado (0 en NULL), Sales las cuenta bien; el descuadre era reparto por LOCALES distintos + la ventana móvil de 6h de `orders_feed` que escondía lo cerrado hace >6h. **Verificado en BD ANTES de tocar** — Code dedujo por código que el backfill dejaba `order_status` NULL; al comprobar 0 NULL hoy se DESCARTÓ esa causa y NO se aplicó el parche al backfill. Cambio aplicado: la pestaña Cerrados pasa de ventana de 6h a DÍA DE NEGOCIO de 04:00 a 04:00 (TZ `accounts.timezone`='Europe/Madrid'); vivos sin límite, terminales solo si su cierre cae en el día de negocio en curso. Constante `c_business_day_cutoff_hours=4`. Migraciones `20260622T1700_orders_feed_cerrados_dia_local.sql` + `20260623T0900_orders_feed_dia_negocio_corte_0400.sql` (commits 0be164c, 0a1e5b8, rev-list 0 0). Validado en vivo (31 cerrados visibles pasada medianoche).

**(C) ADAPTADOR HUBRISE — VERIFICADO CONSTRUIDO Y DESPLEGADO.** RECON de Code: `hubrise-webhook` ACTIVE v11, `verify_jwt=false`, valida `X-HubRise-Hmac-SHA256` (hexdigest, timingSafeEqual sobre body crudo), mapea order create/update a la ingesta canónica (`adapt_hubrise_order`/`close_sale`/`cancel_sale`, idempotente por `external_ref`=order.id, marca por `connection_name`), pone `order_status`, auto-aceptación fase 2. `hubrise-order-status` (empuje de estado) también ACTIVE. Pendientes = comprobaciones de campo con tráfico real, no falta build. Correo de seguimiento a Janaina (HubRise) preparado: pide SOLO bloquear la suscripción en la cuenta de test "Folvy Test (zy9j2)" (usuario partners@folvy.app), aparcando Glovo España hasta tener el test rodando.

**(D) ARRANCADA LA CARGA DE COSTES DE LLORENTE29.** Fuente de verdad decidida = informe **"Compras y Ventas" de Cloudtown** (lo que CTB paga de verdad), NO el export de tspoon (coste teórico, con datos rotos: harissa 0,015€/bote, milanesa 233,96€/ud). 5 meses de PDF (ene–may 2026) cruzados contra los 150 productos de Folvy (raw+packaging+tool) → `Folvy_vs_CTB.xlsx`: ~14 ingredientes sin coste que CTB sí tiene, listos para cargar; el resto sin pareja son sub-recetas que cocinan (Arroz criollo, pico de gallo, salsas Chilli/Verde/Smokey → van por ESCANDALLO, no por precio) o de marca propia. **CARGA NO EJECUTADA** (quedó en la tabla de revisión, para proteger de errores ×1000 en conversión Kg→g/Lt→ml). Decisión: cargar "del motor" (last_purchase/average_weighted), no fixed, para que las facturas los actualicen. **FEATURE confirmada por Julio con caso de uso real: ALARMA DE PRECIOS** cuando una recepción supera el coste de referencia de CTB, aunque la venta venga de marca cedida (coste CTB = coste estándar; recepción más cara = avisar). Dato roto a corregir: "Milanesa Ternera Rebozado 233,96€" → real ~3,63€/ud (tspoon) ó 14,62€/kg (CTB).

---

**Última actualización: 2026-06-19 (CIERRE). MÓDULO FOLVY ORDERS — CIERRE MAYOR EN PRODUCCIÓN (5 piezas validadas en vivo con pedidos reales de Glovo). El feed operativo multi-canal por el que entra y se opera TODO pedido (propias Y cedidas), con la arquitectura del empuje resuelta de raíz.**

**(A) FUSIÓN Orders+KDS en UN módulo "Folvy Orders"** (commit ba89312): 3 vistas — Pedidos `/orders` (feed), Cocina `/orders/cocina` (=KdsBoardPage, KDS intacto), Ajustes `/orders/ajustes`. Kiosco `/cocina-tv` intacto. Auto-aceptación por canal (commit 8868703, `order_acceptance_config`).

**(B) PANTALLA UNIFICADA — diseño aprobado** (`docs/folvy_orders_pantalla_unificada_diseno.md`, commit d70dae4): UNA pantalla, varias LENTES (por pedido / por estación / producción) sobre el pedido CANÓNICO. AGNÓSTICO DE CANAL (Julio insistió): cada canal entra por su adaptador→modelo canónico; HubRise/Last/Otter son adaptadores de pleno derecho, ninguno es dueño. Identidad navy `#0e1820` + terracota `#D67442` + Fraunces.

**(C) A1 FEED EN PRODUCCIÓN** (base BBDD d70dae4 + front 63d2c54): 5 campos canónicos en `sale` (customer_name/phone, delivery_address, expected_time, customer_note) que cada adaptador rellena. RPC `orders_feed(p_location_id)` = feed por order_status con líneas (padres/hijas, alérgenos de escandallo `recipe_item_allergen`, notas por organizationProductId, marcado de `kds_line_state`), semáforo, totales, canónicos. Front en `src/modules/orders/`: OrderCard (comanda completa, modificadores rojo/ámbar por heurística, alérgenos, nota banda roja, semáforo, B2 halo), OrdersFeed (cuadrícula/kanban, filtros, polling 10s + realtime sobre sale, sonido al entrar pedido nuevo accionable), ChannelBadge (sin logos). Resuelve local con useLocationScope.

**(D) LAST ALIMENTA EL FEED** (commit 87c1a4e, validado en vivo: #FB368 Glovo entró solo al feed de Llorente29): Last es ADAPTADOR DE PLENO DERECHO igual que HubRise — NO se migra a nadie (Julio corrigió el falso dilema "migrar a HubRise"). Webhook `lastapp-webhook` reescrito: extrae los 5 canónicos del raw_tab (geocodedAddress, customerInfo name+surname+phone, schedulingTime…), nace `order_status='accepted'` (Last viene aceptado del TPV), close→completed, cancel→cancelled. CUALQUIER cliente con Last puede usar el sistema.

**(E) RUTA COMPLETA + #1 EMPUJE A LAST** (commit b885e48): RPC `set_order_status` (guard manager/admin). Spec OpenAPI de Last confirma `PUT /orders/{tabId}/status` (KITCHEN/READY_TO_PICKUP/ON_DELIVERY/DELIVERED) + `POST /orders/{tabId}/cancel`; auth Bearer+header `locationID` (patrón `lastGet` ya en uso); tabId=`external_tab_ref`, locationID=`external_location_text`. Toggle `lastapp_integration.push_status_enabled` (apagado por defecto). ACTIVO en producción en LAS DOS orgs Last de Llorente29 (Foodint propias + Cloudtown cedidas).

**(F) #2 ESCANDALLO AL PULSAR** (commit 0492702, validado en vivo con "Pita BOWL Mixto"): pulsar el nombre de un plato con receta (gorro de chef) abre el `CookModePanel` del KDS (foto, alérgenos, ingredientes escalados a la cantidad). REUSO PURO, no se toca el KDS ni `kds_recipe`. Los platos sin receta no son clicables.

**(G) #3 MARCAR LÍNEA** (commit ae88d20, validado en vivo: marcar en el feed apareció marcado en el KDS): check verde por plato → `kds_mark_line` (con sesión, sin token). Comparte `kds_line_state` con el KDS → SINCRONÍA entre lentes (marcar en Pedidos marca en Cocina y viceversa).

**(H) #7 PUENTE KDS→FEED — ARQUITECTURA DEFINITIVA DEL EMPUJE (Opción A, "lo más profesional")** (commit 0f6cce8, validado en vivo con Glovo: `net._http_response` status 200 + `{"push":{"ok":true}}`): el EMPUJE pasa a ser CONSECUENCIA DEL CAMBIO DE ESTADO, no algo atado al botón. Cualquiera mueve `order_status` (feed con `set_order_status` · cocina-kiosco con `kds_bump` al servir el Pase) → trigger `trg_sale_push_status` sobre sale (WHEN old<>new, solo lastapp + estados empujables) → `net.http_post` FIRE-AND-FORGET a la Edge `order-advance` → empuja a Last → Glovo. FUNCIONA DESDE EL KIOSCO DE COCINA (token, sin usuario logueado) = requisito de Julio ("la cocina tendrá una tablet dedicada; si desde ahí no empuja, lo hecho no vale"). Si Last falla, el estado YA cambió: la cocina NUNCA se bloquea. `kds_bump` ampliada: servir en estación `kind='expo'` avanza `order_status` (UPDATE directo, no `set_order_status`, por el guard de sesión que no aplica en kiosco). `order-advance` reescrita: entrada interna por secret (`x-order-advance-secret` ↔ env `ORDER_ADVANCE_SECRET`), DEPLOY CON `--no-verify-jwt` (la frontera la hace el secret); ya no toca estado interno, solo empuja. Patrón `net.http_post` copiado del `ingestion_monitor` (pg_net ACTIVO, verificado en `pg_extension`). El feed vuelve a `set_order_status` (el trigger empuja). Migraciones `20260619T0930_set_order_status`, `T0940_lastapp_push_toggle`, `T1010_kds_bump_advance_order`, `T1020_sale_push_trigger`.

**(I) 7a CICLO DE VIDA POR TIPO DE REPARTO** (commit 6c1d80d): el cierre depende de QUIÉN reparte (regla de Julio). **PLATAFORMA (Glovo/Uber/JE):** listo → botón "Entregado al rider" → cerrado; Folvy se DESENTIENDE al recoger el rider; empuja hasta READY_TO_PICKUP y el cierre NO se empuja (Glovo gestiona la entrega del rider → evita el `INVALID_STATUS_CHANGE` real que se observó al empujar DELIVERED). **PICKUP:** "Entregado al cliente" → cerrado. **OWN_DELIVERY:** "En reparto" → "Completar" (la 7b añadirá "En ruta" + flota + métricas). `kds_bump`: plataforma y pickup → awaiting_collection, propio (y NULL) → in_delivery. Migración `20260619T1030_kds_bump_platform_pickup`. Datos reales service_type: platform_delivery 1125, own_delivery 241, pickup 8.

**DECISIONES NUEVAS (no perder):**
- **UNA SOLA TABLET DE FOLVY para propias Y cedidas** — el operario de cocina no salta entre Folvy y Last. El empuje funciona igual para cedidas (solo necesita tabId+locationID de Last). Toggle de empuje activo en Foodint (propias) + Cloudtown (cedidas).
- **El toggle de empuje debe ser POR ORGANIZACIÓN/MARCA, no global por cuenta** (hoy vive en `lastapp_integration`, que ya distingue Foodint/Cloudtown). La UI del toggle (pendiente) debe permitir elegir por organización.
- **ESCANDALLO DE LAS CEDIDAS ES OBLIGATORIO en Folvy** — porque Folvy CONTROLA EL STOCK de las cedidas y HACE SUS PEDIDOS (sin escandallo no hay consumo teórico, AvT ni órdenes de compra). Retirada la suposición previa de que las cedidas no tendrían escandallo. Conecta con el frente "Cloudtown marcas cedidas" (crear carta + puente tspoon→Folvy por PLU con `normPlu`).
- **Empuje ASYNC sin feedback inmediato** = precio de la Opción A; la observabilidad del empuje (log de fallos donde el manager los vea) es deuda declarada (el `INVALID_STATUS_CHANGE` hoy queda solo en `net._http_response`).

**MAPA DE CIERRE DE ORDERS — "no entra en producción hasta el 100%" (Julio).** CERRADO hoy: #1 empuje+ruta, #2 escandallo, #3 marcar línea, #7 puente, 7a ciclo de vida. PENDIENTE: **#4** cierre anti-faltantes (marcar todo→cerrar→dispara impresión), **#5** impresión lógica (ticket cocina/pegatina por artículo/ticket bolsa/reimpresión), **#6** modificadores con flag real (hoy heurística prefijo "sin"), **#8/9** cruce estaciones + collection LIKE, **7b** REPARTO PROPIO (flota Catcher OBLIGATORIO/Jelp/Shipday + estado "En ruta" + métricas de tiempos de reparto = frente mayor). Post-100%: kiosco del feed (puerta B), alinear KDS al navy, alinear la secuencia de estados con Last (evitar 400s), observabilidad del empuje async.

**FRENTE PENDIENTE APUNTADO (NO en caliente): MIGRACIÓN DE ESCANDALLOS CEDIDOS Folvy Interno → Llorente29.** Julio lo pidió; pospuesto a sesión dedicada. Es migración ENTRE CUENTAS (regla de máxima cautela: verificar la cuenta antes de ejecutar). Preguntas abiertas: ¿las marcas cedidas (Big Mike's, Chivuos, Milanesa Haus…) existen ya como brand en Llorente29 o solo en Folvy Interno? ¿qué se migra (recipe_item + recipe_line + ingredientes)? ¿relación con "crear carta de cedidas primero"? Requiere RECON serio.

**Lo anterior (2026-06-18, 2ª sesión) — HUBRISE VIVO DE PUNTA A PUNTA + MÓDULO DE GESTIÓN DE CARTA POR MARCA + MODELO base+override CONFIRMADO + HALLAZGO del motor de margen muerto. Producción/build verde, esquema INTACTO (cero migraciones esta sesión).**

**(A) HUBRISE — INTEGRACIÓN DE PUNTA A PUNTA VIVA.** Segunda vía de delivery (Uber+JustEat con 1 API), desbloquea al Cliente 2 sin esperar a Otter. Bug raíz corregido: la frontera del webhook (`supabase/functions/hubrise-webhook/index.ts`) validaba el HMAC en **base64** cuando HubRise firma en **hex** → toda entrega caía en 401 silencioso (regla webhooks: deploy `--no-verify-jwt`, la seguridad la hace el token/firma dentro del código). Entorno de pruebas: cuenta "Folvy Test" (`zy9j2`), location `zy9j2-0`, catalog `mm92j`; 2 clientes OAuth — "Folvy" (598759333895, lectura) y "Folvy Injector" (155453763266, inyección de pedidos de prueba); tokens en `$env:HR_TOKEN` / `$env:HR_INJECTOR_TOKEN`, secrets JSON en `C:\Users\jgcol\Downloads\`. El pedido de prueba entra por la INGESTA CANÓNICA (`external_source='hubrise'`) → KDS + stock + AvT, sin tocar el motor (frontera única). Notas HubRise (Janaina): reseller desde 6ª cuenta −28,6%; setup 25€/conexión, 1ª marca/local gratis; SIN sandbox (la cuenta "Folvy Test" es producción de pruebas); NO 100% autónomo en JustEat/Glovo (HubRise en el bucle). **Publicador de Catálogo DISEÑADO y APROBADO** (`docs/folvy_catalogo_publicador_diseno.md`): Folvy publica carta+precios a HubRise/canales; dirección configurable por marca. **DEUDA: versionar el SQL de HubRise aplicado-no-versionado** (`adapt_hubrise_order`, `close_sale`, `cancel_sale` + la migración HubRise) — vive solo en BBDD.

**(B) MÓDULO DE GESTIÓN DE CARTA POR MARCA — construido por capas, todo build verde, SIN tocar esquema.** Sobre `menu_category` + `menu_item` (estilo Kitchen: gris + acento terracota `#D67442` + azul marino `#1E3A5F`). Benchmark: Otter (ficha = puesto de mando con todo dentro: precios override por canal/ubicación, N categorías, modificadores; carta marca→categorías→items) y Last (estándar, 1 categoría/producto). DECISIÓN: **NO añadir entidad "Menú"** entre marca y categorías (over-engineering: 1 marca = 1 carta = 1 catálogo HubRise; menús múltiples/dayparts = futuro). DECISIÓN: **flechas ↑/↓** como vía principal de orden (drag&drop frágil en tablet; queda como extra futuro).
- **CP1-a (crear):** `menuCategoryService.ts` (NUEVO) CRUD de `menu_category` (list/create/update/deactivate/reorder, slugify, soft-delete vía `is_active=false`); FIX del constraint `UNIQUE(brand_id, slug)` — si el slug existe inactivo lo reactiva, si activo da aviso legible ("Ya tienes la categoría «X»"). `menuItemService.createBaseMenuItem` (canal/receta NULL, estilo create-then-cost). `NewMenuItemModal.tsx` + `NewCategoryModal.tsx` (NUEVOS). Botones "Categoría"/"Añadir producto" en `KitchenMenuPage`.
- **Capa 1 (organizar/mover):** `setMenuItemCategory` + `setMenuItemCategoryBulk`; casillas de selección por producto + "seleccionar todos" por categoría + barra azul "N seleccionados · Mover a [select] · Mover" (uno o en bloque) + toast **Deshacer**; aviso de marca CEDIDA (proxy honesto vía `ownership_type='licensed'`, porque `catalog_source` aún NO existe). Precio NO editable en fila; selección se limpia al cambiar de marca. **FIX B:** las categorías VACÍAS no aparecían (la query de productos no las traía) → `KitchenMenuPage` carga `listMenuCategories` aparte (estado `allCats`), las muestra como secciones aunque vacías y alimenta con ellas el "Mover a…"; `displayCategories` (memo) fusiona allCats + productos + "Sin categoría".
- **Capa 2 (reordenar/plegar/borrar):** `position` añadido a `CatalogProduct` en `brandCatalogService.ts` (select+order+mapper; `menu_item.position` existía a 0 → se siembra 0..n-1 al reordenar). `reorderMenuItems`. En `KitchenMenuPage`: plegar/desplegar (chevron), ↑/↓ para reordenar categorías y productos (optimista + persiste + revierte en error), borrar categoría con `ConfirmDialog` ("sus N productos no se borran, pasan a Sin categoría") + **Deshacer** (reactiva). `undo` generalizado a `{label, revert:()=>Promise}`.
- **FICHA-COCKPIT (producto en varias marcas + categoría)** — "muy muy necesario" (Julio). `listBrandsForRecipe`, `listAccountBrands`, `addRecipeToBrand` (crea/reactiva un `menu_item` base en la marca destino apuntando a la MISMA `recipe_item`, copia el PVP de origen; reactiva si estaba archivado por el índice único), `getMenuItemCategoryId`. `ProductPlacementSection.tsx` (NUEVO): chips de las marcas donde se vende (con PVP, ✕ para quitar salvo la marca actual), desplegable + "Añadir a marca", aviso si no hay escandallo (sin receta no se puede compartir), selector de categoría, placeholder "disponibilidad por local/canal próximamente". `CatalogProductDetailPage` sección S10 "Marcas y ubicaciones" (antes texto muerto) ahora monta `<ProductPlacementSection>`.

**(C) MODELO DE CATÁLOGO — CONFIRMADO POR DATOS REALES (no requiere migración).**
- **base + override.** Los `menu_item` vivos tienen `channel_id` NULL → un producto = una fila **base** con `price` por defecto (SIN IVA, `vat_rate` default 10). El precio por canal vive en `menu_item_override` (account_id, menu_item_id, channel_id, location_id, price, is_available, name, description, photo_url, short_name, category_name) = overrides por (producto × canal × local). **NO existe** junction N:N de categorías (`menu_item_category` no existe) ni `menu_item_location`. Índice único `menu_item_brand_channel_recipe_unique` = (brand_id, channel_id, recipe_item_id) — cuenta también filas archivadas (por eso `addRecipeToBrand` reactiva en vez de duplicar).
- **`menu_category`:** brand_id, parent_id (árbol), position, emoji, slug, is_active (soft-delete; NO tiene archived_at). Constraint `menu_category_brand_id_slug_key` = UNIQUE(brand_id, slug), NO incluye is_active.
- **RECETAS COMPARTIDAS ENTRE MARCAS (clave de las marcas virtuales):** el escandallo (`recipe_item`) es de la CUENTA; cada marca tiene su `menu_item` apuntando a la MISMA receta con su PVP. Confirmado en datos: **33 recetas ya están en >1 marca**. El modelo ya era el correcto; faltaba la herramienta (la ficha-cockpit).
- **Canales (`sales_channel`, Folvy Interno):** Glovo, JustEat, Uber (delivery), Shop (takeaway). Sala/terraza/barra serán canales nuevos type 'dine_in' cuando llegue el TPV propio.

**(D) HALLAZGO CRÍTICO — el motor de margen por canal está muerto (define el frente siguiente).** `public.menu_item_economics(p_brand_id, p_service_type default 'platform_delivery')` (SECURITY DEFINER) hace **INNER JOIN `sales_channel` ON sc.id = mi.channel_id** + INNER JOIN `recipe_item`, y **NO lee `menu_item_override`**. Como todos los `menu_item` tienen `channel_id` NULL → la función **no devuelve filas** en la práctica (por eso la carta muestra estado de escandallo pero no cifras de margen). Resolución de comisión dentro de la función: `brand_channel_rate` (override marca×canal vía `brand_channel`) > `channel_rate` (defecto del canal) > NULL; `commission_basis` según `commission_base` ('pvp_sin_iva'→price, else→price_with_vat = price·(1+vat/100)); calcula `net_margin` (own) = price − cost − basis·pct/100, `food_cost_pct`, `contribution_margin`, `food_cost_status`; ramo 'licensed' usa `revenue_share`. La ficha (`CatalogProductDetailPage`, sección `s-economia`) hace un **cálculo CLIENTE paralelo** (channelRates + recipeCost + baseFromGross) que SÍ se ve, **pero usa el MISMO precio base para todos los canales** (solo varía la comisión). → El frente "precio por canal con margen real" NO es un modal: requiere **reescribir el motor en SQL** para que por producto dé una fila POR CANAL usando el precio del override (‖ base) y la comisión del canal, leyendo `menu_item_override` = verdad server-side; luego servicio de overrides (set/clear precio+disponibilidad por canal/local), modal "Editar precios" (defecto + por canal) con margen real al teclear, y **jubilar el cálculo cliente** (una sola verdad).

**(E) DECISIONES DE PRODUCTO REGISTRADAS.**
- **Precios sala/terraza/barra** (cuando haya TPV): NO modelo nuevo — barra/salón/terraza = **canales** (`sales_channel` type 'dine_in'); precio en el MISMO `menu_item_override` que Glovo/Uber/Shop. MATIZ: el recargo de terraza debe ser una **REGLA** (% o fijo sobre base, estilo `channel_rate`), no precio plato a plato. Requisito del canal 'dine_in' para el frente TPV.
- **N:N categorías** (producto en varias categorías de la misma carta, estilo Otter) = NO ahora; Folvy sigue **1:1** (`menu_category_id` único); frente estructural aparte si surge necesidad real. (Lo que Julio pedía como "muy necesario" era producto en varias MARCAS — resuelto con la ficha-cockpit.)
- Menores (ajustables): añadir a marca copia el PVP de origen; quitar marca = archiva (no se puede quitar la marca que estás viendo, se hace desde su carta); `created_by` va NULL al crear (retoque menor pendiente — no se quiso adivinar el hook de identidad de Kitchen).

---

**Última actualización: 2026-06-17 (CIERRE 2ª sesión). Lo último — MÓDULO ALMACÉN COMPLETADO: AvT (TEÓRICO VS REAL) + FRENTE ② NIVELES (BASE MRP II) + FICHAJE RESUELTO EN DOS CAPAS. Todo en producción, build verde, rev-list 0.**

**(A) AvT (TEÓRICO VS REAL) — EL GRAN DIFERENCIADOR — en dos formas.** Cierra el frente 5 (inventario perpetuo cierra el AvT). Benchmark Apicbase/MarketMan/Crunchtime/meez: Folvy golea en SALUD DEL DATO (números honestos o ninguno) + PORQUÉ de la desviación + todo-en-uno. Doc `docs/folvy_avt_diseno.md`. **PUNTUAL**: lee el último `inventory_count` aprobado del local; muestra `system_qty`(teórico) vs `counted_qty`(real) vs `variance_value`(€), ordenado por € perdido, con SALUD DEL DATO arriba y CAUSA PROBABLE por línea (dato incompleto / merma real / escandallo no fiable / sin clasificar); % silenciado cuando teórico≤0 (evita −16100%). Servicio `inventoryCountService.ts` (+getLatestApprovedCount, classifyAvtCause) + `AvtSection.tsx`. **POR PERIODO CONSOLIDADO**: RPC `avt_period(p_account, p_from, p_to, p_location)` (SECURITY INVOKER) → por artículo: inicial(último conteo antes del periodo, o movimiento 'apertura' del ledger marcado `init_estimated` avisando) + compras(recepcion+traspaso_entrada) − consumo(−Σ qty_base 'consumo') = teórico final; merma=teórico final − conteo real final; universo=artículos con conteo final DENTRO del periodo; status medible/sin_apertura/dato_incompleto/escandallo_no_fiable; SOLO medibles suman al total. `avtService.ts` + `AvtPeriodSection.tsx` (presets mes/mes pasado/30d/90d/trimestre + Agrupar Local/Almacén/Familia/Artículo + salud del dato). Toggle "Por periodo"(default)|"Último conteo" dentro de Desviación·AvT en InventoryPage; sub-toggle "Desviación(AvT)"|"Consumo teórico". Migración `20260617T2000_avt_period_engine.sql`. Commits e829260, 1e21e53. Validado Foodint Alcalá: puntual 8 de 10 "Dato incompleto" (stock negativo del saneamiento) = el AvT NO miente; periodo "Este mes" = 1 medible, 1 inicio estimado, 148 sin conteo de inicio, Merma 0,00€ (no inventa cifra de los no medibles). **El AvT es el incentivo para contar con regularidad.**

**(B) FRENTE ② NIVELES min/par — BASE DEL MRP II.** Tabla `stock_level` (item×local, separada del saldo) con 5 campos: `min_qty`, `par_qty` (UI activa) + `reorder_point`, `lead_time_days`, `safety_qty` (LISTOS para el MRP II, no en UI — el nivel vivo futuro y el punto de pedido). PUNTO DE PEDIDO previsto pero NO activado (necesita lead time + consumo fiables; deuda 0). El par alimenta el "To Par" del order builder; `purchase_order.origin='par'` ya existe. RPC `stock_levels_overview` (niveles+stock+below_min+to_par_qty, bajo-mínimo primero, SECURITY INVOKER) y `set_stock_level` (SECURITY DEFINER con guard; gestiona SOLO min/par — el upsert NO toca reorder/lead/safety para no pisar config del MRP; firma 7 args, p_min/p_par default null → `?? undefined` en servicio = omitir = poner null = borrar nivel). LECCIÓN: PostgREST genera args de RPC como `number`(requerido) o `number|undefined`(con default), nunca `number|null`; para enviar null se OMITE el arg y la RPC aplica su default null. `stockLevelService.ts` + `StockLevelsSection.tsx` (KPIs bajo-mínimo/con-nivel/sin-definir, edición inline, "repón X"=par−stock). Pestaña "Niveles" en InventoryPage (entre Existencias y Movimientos, icono SlidersHorizontal) + min/par editables en la FICHA del artículo por local (`ItemStockPanel.tsx`, misma tabla/RPC, dos puertas cero duplicación). Migraciones `20260617T2100_stock_levels.sql` + `T2200_set_stock_level_fix.sql`. Commits 748db53, 7e86e25. **IDEA JULIO (SIGUIENTE): NIVELES VIVOS por consumo** — par=consumo medio diario×días entre pedidos; min=consumo medio diario×lead time+seguridad; "IA propone, humano decide". Faltan frecuencia de pedido + lead time fiables (no encender hasta tenerlos).

**(C) RESUMEN del Almacén — tarjetas encendidas.** SummarySection gana contador real de bajo-mínimo (vía getStockLevelsOverview, no bloquea) y enciende las 2 tarjetas que eran "Próximamente": "Bajo mínimo" (contador real → pestaña Niveles, roja si >0) y "Desviación teórico vs real" (→ pestaña AvT). onNavigate ampliado con 'niveles'. Commit 699dec1.

**(D) FICHAJE RESUELTO EN DOS CAPAS.** Problema raíz: Natacha (Foodint Alcalá) no podía fichar porque su GPS la situaba a 1.848 m del local estando dentro (GPS por red/WiFi miente) y el radio estaba fijo en 1.000 m en el código. Desbloqueo inmediato del día: INSERT manual en `clock_entries` (entrada de hoy). **(a) FICHAJE MANUAL FIABLE del manager**: `handleClock` en `StaffPage` (pestaña Fichajes del modal de empleado) reescrito — antes solo `setEmp` (estado local, NO escribía BD); ahora `async`, escribe vía `addClockEntry`→`insertClockEntry`→`clock_entries`, marca `source='manual'` + MOTIVO obligatorio (en `address`: `Manual · {motivo} · por {autor}`=rastro legal), sin GPS del manager, sin bloqueo por horario (redondeo solo informativo). Parche de 6 bloques sobre StaffPage (2000 líneas, no reescrito). Commit b176bf3. **(b) FICHAJE DE RAÍZ — radio/modo por local**: migración `20260617T2300_clock_geofence_config.sql` (`locations` + `clock_radius_m` default 200 + `clock_geofence_mode` 'block'|'warn' con CHECK; idempotente). `Location` (types/index.ts) + clockRadiusM/clockGeofenceMode; `supabaseSync.ts` mapeo lectura (rowToLocation) + escritura (locationToRow); `FichajeEmpleado.tsx` radiusForLoc lee del local (no el 1000 fijo), modo 'warn' deja fichar fuera del radio marcando `address='Fuera de zona · Xm'`, botón habilitado por canClock=(inZone||mode==='warn'); UI en `OtherPages.tsx` (LocationsPage): radio + selector Bloquear/Avisar en la sección de geolocalización. Commit 8cdb558. RECON reveló que SOLO Foodint Alcalá tiene coords (Plaza Castilla y Carabanchel a NULL) → el modo 'warn' es la red de seguridad para esos dos. **PENDIENTE validación: Julio pone Foodint Alcalá en 'warn' y verifica que Natacha ficha sola desde su móvil; la salida de Natacha de hoy ya se puede hacer con el botón manual.** DEUDA anotada (guion): fichaje por QR/NFC del local (frente mayor, si 'warn' no bastara).

---

**Última actualización: 2026-06-17 (CIERRE 1ª sesión). Lo último — MÓDULO ALMACÉN ESTRUCTURADO (5 secciones) + AL1 COMPLETO + AUTOINVENTARIO CON REPARTO VISIBLE + FRENTE ① MOVIMIENTOS (LIBRO MAYOR) + FICHA DEL ARTÍCULO VIVA. Todo en producción y verificado en vivo sobre Llorente29 (Foodint Alcalá). Diagnóstico de Julio (16/06, correcto): "hacemos MUY BIEN el autoinventario pero POCO MÁS" → hoy se construyó el CUERPO del almacén alrededor de la joya (autoinv IA).**

**(A) MÓDULO ALMACÉN reestructurado.** La entrada de sidebar "Inventario" → renombrada "Almacén" (`module.tsx`, solo label). `InventoryPage.tsx` pasa de 5 pestañas planas a 5 SECCIONES en flujo mental: **Resumen · Existencias · Movimientos · Inventarios · Teórico vs Real**. Resumen NUEVO = portada de KPIs reales (valor stock, cobertura %, colocados, sin zona) + 2 tarjetas "Próximamente" (Bajo mínimo / Desviación·AvT) que se encenderán con ② y ③. Existencias = StorageZonesSection (zonas AL1). Movimientos = MovementsSection (ver D). Inventarios = sub-toggle Conteos | Autoinventario. Teórico vs Real = ConsumptionSection. Commits c6e32f2, 1095007.

**(B) AL1 — CANTIDAD EN FORMATO DE COMPRA + AJUSTE DE STOCK CON MOTIVO.** Las lecturas (cobertura/huérfanos/zonas) muestran la cantidad como formato de compra de referencia ("≈ 3 Bolsa" + base + €gris), helper `formatStockQty` exportado en `storageZonesService.ts`. Migración `20260617T1300` (3 RPC de lectura traen el formato raíz). **Ajuste de stock**: fijas el CONTEO REAL (no el delta), en formato o base, MOTIVO obligatorio; Folvy calcula el movimiento diferencia. Tabla `stock_adjustment` + RPC `register_adjustment` (DEFINER, llama recompute_location_stock_core), migración `20260617T1400`. `stockAdjustmentService.ts` + `AdjustStockModal.tsx` (botón en el peek). reason_codes: count_correction, direct_receipt, waste, expired, other. Commits 85eb9a3, a11a9e1, 0f9d9bc. Verificado: ajuste Caja Milanesa Haus 300→200 (−100, count_correction) → evento+movimiento+coste+autor correctos.

**(C) AUTOINVENTARIO — REPARTO POR PERSONA VISIBLE.** El backend (`generate_daily_count` + `resolveTodayCounters`) YA repartía por round-robin entre quien trabaja hoy (horario, fallback a activos del local, menos vacaciones); faltaba MOSTRARLO (igual que APPCC). Añadido `getTodayAssignments` (lee assigned_to del conteo cycle de hoy, nombres vía fetchEmployees) + en `AutoInventorySection`: KPI "personas cuentan hoy", bloque "Reparto de hoy" con chips, columna "Asignado a". SIN SQL. Commit 7276d1e. Verificado Foodint Alcalá: 2 personas (Johanny ·11, Natacha ·11), reparto equitativo exacto.

**(D) FRENTE ① MOVIMIENTOS — LIBRO MAYOR DEL ALMACÉN (completo).** Alcance "todo junto": histórico + entrada directa + traspaso + merma integrada. Migración `20260617T1600`: RPC `list_stock_movements` (histórico con REFERENCIA legible resuelta por tipo en un query) + tabla `stock_transfer` + RPC `register_transfer` (DEFINER, 2 movimientos enlazados traspaso_salida/entrada entre LOCALES, valida stock en origen, recompute ambos). Fix `20260617T1700`: la referencia de venta legible (U356/G829) vive en `sale.raw_tab->>'code'` (raw_tab es TEXT → castear `left(btrim,1)='{' then ::jsonb`), NO en external_ref (UUID). Referencias por tipo: venta="Glovo · G829" · recepción="ALB-00002 · nº albarán" · ajuste/merma="motivo" · traspaso="→ Local". DECISIONES: la ENTRADA DIRECTA no necesita SQL (reusa register_adjustment: sumar N = fijar conteo a saldo+N, motivo direct_receipt). El traspaso entre ZONAS del mismo local NO escribe ledger (el stock se valora por LOCAL, no por zona) = es recolocación, ya resuelta en Existencias "Mover a". Ficheros: `movementsService.ts`, `ItemPicker.tsx` (selector reutilizable), `MovementActionModal.tsx` (kind entry|transfer|waste), `MovementsSection.tsx`. WasteSection.tsx queda HUÉRFANO (no borrar). Commits 04bc74e, 77cd158. Verificado: histórico con referencias legibles, filtros por tipo+rango, recepciones/ventas/ajustes correctos. Ledger Foodint Alcalá: 4.405 movimientos (4.091 consumo/sale, 191 recepcion, 108+11+1 ajuste, 3 apertura; merma=0, traspaso nunca usado antes de hoy).

**(E) FICHA DEL ARTÍCULO VIVA.** Los 2 colapsables muertos de `KitchenItemDetailPage` ("Stock por almacén" / "Histórico de compras") cobran vida. Migración `20260617T1800`: RPC `item_stock_by_location` (saldo por local + formato ref) + `item_movements` (histórico del artículo, todos locales, con location_name + referencia). "Stock por almacén" = fila por local (saldo formato+base, valor, botón **Ajustar por local** → AdjustStockModal; cada fila ES un local → resuelve el "Ajustar en ficha" aparcado). "Movimientos del artículo" = histórico del artículo LIMITADO POR FECHA (default 30 días, filtro 7d/30d/mes/todo — migración `20260617T1830` añade p_from/p_to a item_movements, FIRMA NUEVA → regen database.ts). Ficheros: `itemStockService.ts`, `ItemStockPanel.tsx`, `ItemMovementsPanel.tsx`. Commits efcf60c, 1c1dbc2. LECCIÓN: RPC nueva (o cambio de firma) SIEMPRE requiere regen database.ts (el tipo de .rpc() es unión literal de nombres; Code paró correctamente al fallar el build).

**HALLAZGO (no deuda del trabajo de hoy, lo destapa el módulo): STOCK NEGATIVO en Foodint Alcalá** — varios artículos con stock teórico < 0 (Carne de Birria total −32,77 €; "stock negativo (revisar)"/"a cero ¿agotado?" en Autoinventario). Causa: se ha descontado por escandallo (ventas) más de lo que las recepciones registraron (entradas sin meter, o escandallo que descuenta de más). Es el diagnóstico del **frente ③ Teórico vs Real**.

**PENDIENTES del módulo Almacén (próximas sesiones):** ~~**② Niveles máx/mín**~~ **✅ HECHO en la 2ª sesión 17/06** (ver bloque B arriba; enciende "Bajo mínimo"). ~~**③ Teórico vs Real**~~ **✅ HECHO en la 2ª sesión 17/06** (AvT puntual+periodo, ver bloque A arriba; enciende "Desviación·AvT"; confirmó el stock negativo de Foodint Alcalá como "dato incompleto"). ~~**Resumen final**: quitar el "Próximamente"~~ **✅ HECHO** (bloque C). **Datos sucios sandbox (Folvy Interno, NO deuda):** Mozzarella "Kilogramo=1500g" y Caja Milanesa Haus con formatos Paquete duplicados (revisar al montar módulo de formatos en serio).

---

**Última actualización: 2026-06-16 (CIERRE jornada). Lo último — RECONSTRUCCIÓN DEL MOTOR DE APROVISIONAMIENTO A €/UNIDAD BASE + TRES ALARMAS DE PRECIO EN RECEPCIÓN. Cierra de raíz el OBLIGATORIO D (la ambigüedad de `last_price`: el módulo de pedidos lo usaba como €/caja y Kitchen como €/base → caso Delicias-COHELDI).**

**(A) `article_supplier.last_price` AHORA ES €/UNIDAD BASE (€/g, €/ml, €/ud), no €/formato.** Cambio de raíz, ejecutado y verificado COSTE-NEUTRAL en las dos cuentas (Folvy Interno + Llorente29 Food). El motor `kitchen_recompute_raw_cost` lee el €/base DIRECTO (desacoplado del formato: basta un precio €/base, el formato ya NO es requisito del coste). El €/caja se DERIVA donde hace falta (pedidos = `last_price × qty_in_base`).

**(B) ESCRITORES A €/base canónico vía `_eur_base_from_format(format_id, precio_formato)` (= precio ÷ qty_in_base).** `confirm_goods_receipt`, `learn_from_receipt` y `apply_invoice_costs` escriben €/base. El BUG DEL DOBLE (meter `qty × precio` como si fuera €/base, que inflaba costes) muere POR CONSTRUCCIÓN.

**(C) UI BASE-FIRST.** Ficha de ingrediente y alta teclean/muestran €/kg (€/L, €/ud) reutilizando `unitPriceToBase`/`unitPriceFromBase`/`pickDisplayUnit` (único hogar en `unitConversion.ts`); el €/caja se deriva y es solo informativo. **Selector de estrategia de coste** en la ficha (4 reales del CHECK: `last_purchase`, `average_weighted`, `average_window`, `fixed`). **Alta blindada**: pregunta "¿peso / volumen / unidades?" y fija la base FINA (`is_base=true`) de esa dimensión — IMPOSIBLE crear con base no-fina (origen del bug del aceite con base "L"). Botón **"Recostear todo"** (`recostAllRaws`) dispara el motor sobre todos los raws/tools no-fixed: Folvy Interno 183/183, Llorente29 98/98.

**(D) PRECIO PACTADO** — columna `article_supplier.negotiated_price` (€/base, NULL = sin pacto), editable en la ficha del ingrediente y del proveedor ("pactado", mecánica base-first idéntica al precio). NO afecta al coste (sigue saliendo de `last_price`/estrategia); es REFERENCIA para la alarma.

**(E) TRES ALARMAS DE PRECIO EN RECEPCIÓN, independientes** (una línea dispara cualquiera, varias o ninguna), avisos LEGIBLES en €/kg junto al campo de precio (no chip diminuto, no €/base crudo): **(1) salto puntual** vs último pagado (`priceAlertFor`, umbral `supply_settings.price_alert_pct`); **(2) contra pactado** (`negotiatedAlertFor`, `negotiated_alert_pct`, default 0 = avisa en cuanto lo supere); **(3) deriva acumulada** vs MEDIANA del periodo (`price_drift_for` + `driftAlertFor`, `drift_alert_pct`=25, `drift_window_months`=6, mínimo 3 recepciones para que la mediana sea fiable). El €/base entrante se calcula con UNA fórmula compartida (`lineActualPerBase`: OCR vía importe de línea, manual vía precio tecleado ÷ qty_in_base); sin cantidad contada (>0) las dos que dependen del entrante callan (la deriva no, lee el ledger). **Ningún competidor junta las tres.**

**(F) FIXES DE RAÍZ del régimen viejo:** `supplier_format_prices` devolvía un valor heredado (÷qty_in_base de más) → la alarma puntual marcaba disparates (230000%); arreglada a €/base directo. `void_goods_receipt`: al anular revierte stock Y `last_price` (lo deja en el de la recepción superviviente más reciente del mismo proveedor/formato, o NULL si no queda) + recostea; `price_drift_for` ignora recepciones anuladas (`gr.status='confirmado'`).

**(G) SQL VERSIONADO:** `supabase/migrations/20260616T1200_aprovisionamiento_eur_base.sql` (volcado fiel: 8 funciones + columnas nuevas, idempotente). `database.ts` regenerado con `negotiated_price` / `negotiated_alert_pct` / `drift_alert_pct` / `drift_window_months`.

**PENDIENTE / PRÓXIMO FRENTE — Bloque 6c «proveedores que se encarecen»:** panel que corre `price_drift_for` sobre TODOS los artículos, ordenado por **€ EVAPORADO** (no por %), clicable a la ficha. Diseñado, NO construido (requiere `price_drift_all` SQL nueva + UI); se hará sobre datos ya limpios. **Deuda menor:** chunk >500 kB (warning de build conocido).

---

**Última actualización: 2026-06-13 (CIERRE jornada). Lo último — MÓDULO KDS (Kitchen Display System) COMPLETO Y EN PRODUCCIÓN, verificado en vivo de punta a punta sobre Llorente29.**

**KDS — FRENTE COMPLETO HOY (13/06), VERIFICADO EN VIVO. Módulo nuevo `src/modules/kds/` (topBarOrder 7, "Folvy KDS"). 8 migraciones (2100→2800) + helper safe_jsonb (2750). Commits: 4f1c8d6 (0a), 3ccaab3 (0b), d542a8f (capa1 backend), cbbcc77+8867e39 (frontend+kiosco), 733c36b (fix ruta), 9290215 (estación defecto), 94d43f4 (botón Servir+RPC), df5e7c6 (ticket completo). Todos rev-list 0.**

**(A) CICLO DE VIDA DE LA VENTA (capas 0a+0b) — la venta vive con `sale.status` (open→closed→cancelled), no dos tablas.** Nace en `tab:created` (status='open', sin coste/consumo); coste+consumo de stock SOLO se consolidan en `tab:closed` (`close_sale`); `cancel_sale`+`revert_sale_consumption` restan stock si se anula. Motor canónico agnóstico de origen (Last hoy; Otter/Glovo/Deliverect mañana = solo fronteras que traducen a abrir/cerrar/cancelar). `sale.external_tab_ref` (=tab.id) agrupa el pedido. Webhook `lastapp-webhook` reescrito como frontera fina (dispatch por eventType, `upsertSale`+`ingestBill`, `--no-verify-jwt`). PENDIENTE: probar cancelación real (`tab:cancelled` marcado en Last, puede tardar días).

**(B) KDS CAPA 1 — el tablero de cocina, tablero por estado de COCINA (no contable).** Topología: `kitchen_station` (prep/expo por local, semilla 2/local + trigger), `kitchen_family_route` (ruteo familia→estación), `recipe_item.kds_station_id` (override por plato), `kitchen_station.is_default` (estación por defecto, 1/local vía índice único parcial). Estado: `kds_ticket_station_state` (bump por estación), `kds_line_state` (marcado por plato reversible), `kds_device` (multi-tablet, token revocable). RPC con DOBLE PUERTA (sesión `belongs_to_account` | token de dispositivo, SECURITY DEFINER con guard propio): `kds_board`, `kds_bump`/`unbump`, `kds_mark_line` (toggle), `kds_recipe` (Cook Mode), `kds_set_default_station` (swap atómico), `kds_resolve_device`, `kds_authorize`. El board vive por estado de cocina: el pedido sale cuando el EXPO marca servido (no por `tab:closed`); ventana de seguridad 2h para closed sin servir; canal por COALESCE(sales_channel, external_channel_text).

**(C) RUTEO + CIERRE DE TICKET (resuelto el bloqueante).** Los 74 platos de Llorente29 tienen `family_id=NULL` (sin clasificar; `recipe_family` solo tiene scope='ingredient'). SOLUCIÓN deuda 0: `kds_board` hace fallback a la ESTACIÓN POR DEFECTO del local cuando una línea no tiene override ni ruteo → 0 líneas en "Sin estación", tablero usable ya. El "cerrar/quitar ticket" en cocina = botón **"Servir"** (bump del expo, doble toque anti-fantasma, siempre visible al pie de cada tarjeta) → el pedido sale del board. Verificado: servir quita el ticket.

**(D) COOK MODE + TICKET COMPLETO.** Cook Mode (`kds_recipe`): ingredientes base+escalado×qty, alérgenos de ficha (`recipe_item_allergen`), foto `kitchen_photo_url`→fallback `menu_item.photo_url`, pasos ligados (E8, vacíos hoy). Tarjeta muestra el TICKET REAL: combos desglosados (`parent_sale_line_id`+`line_type='combo_item'`; cabecera atenuada/gris + componentes en grande = lo cocinable manda), modificadores (`line_type='modifier'`) sangrados, NOTAS DE CLIENTE (de `raw_tab.products[].comments` por `organizationProductId`=`external_product_id`; banda roja ⚠ pegada a su plato; raras 0,5% = peligrosas, por seguridad/alérgenos). Helper `safe_jsonb` blinda el cast del raw_tab (malformado→null, no tumba el tablero). Kiosco en ruta PROPIA **`/cocina-tv`** (NO `/kds`: el Shell monta módulos en raíz sin slug, `startsWith('/kds')` secuestraba el módulo entero; guard estrecho a /cocina-tv en App.tsx).

**KDS PENDIENTE (próximos frentes, ninguno urge):**
- **NIVEL 2 del ticket — impacto del modificador en RECETA y COSTE** (diferenciador, batir tspoon/R365). Tabla `modifier_recipe_impact` YA existe (3 filas, casi vacía): liga modificador→cambio en receta (añade/quita/sustituye ingrediente, con confianza+confirmación humana). Visión: modificador altera escandallo y coste al vuelo; margen real ponderado por mix vendido. Construir = poblar el mapeo de los 221 modificadores→impacto (IA propone, Pamela confirma). Diseño en `docs/folvy_kds_ticket_completo_diseno.md`.
- **COOK MODE de combos** (un combo no abre Cook Mode hoy; sus componentes ya están en la tarjeta — declarado).
- **IDEAS JULIO (Capa 2):** opciones de VISUALIZACIÓN del ticket (cuadrícula/lista/seguidos); SONIDOS configurables; realce extra al entrar ticket con nota.
- **CANCELACIÓN real** sin probar (esperando `tab:cancelled` de Last).
- **DEUDA: regenerar `database.ts`** (casts en kitchen_station/kitchen_family_route/kds_device/kds_*); umbral semáforo 5/10min provisional→configurable por tipo servicio; Realtime solo sesión (kiosco vive del polling 10s); combo_item sin menu_item_id (su receta en Cook Mode no se muestra hasta casarlos); nietas (modificador de un componente de combo) no se muestran (board agrega 1 nivel).

---

**Anterior — Última actualización: 2026-06-11 (CIERRE jornada). Lo último — CASADO DE VENTAS a 98,6% en Folvy Interno con MARCA ESTABLE POR UUID + INGESTA QUE NO DESCARTA NADA DEL TICKET + SELECTOR DE LOCAL DESBLOQUEADO.**

**(A) CASADO DE VENTAS — de ~77% a 98,6% (frente mayoritario del día), con arquitectura estable, no parche.** Cadena: (1) catálogo de cedidas Cloudtown descargado — la org Last cedida (`b7bc4753-...`, mismo token que las propias) nunca había traído catálogo; `lastapp-sync-catalog` (redeployado) escribió **686 productos**. Auth que funcionó: invocar desde la consola del navegador en localhost con el token de sesión de platform admin (el gateway exige `Authorization: Bearer <publishable_key>`; el `x-internal-key` solo autoriza DENTRO de la función). (2) Índice `uq_menu_item_external` redefinido para incluir `brand_id` → matrícula única POR MARCA (desbloquea productos compartidos entre marcas: agua/refrescos/postres con la misma `organization_product_id` en N marcas). (3) `seed_catalog_from_lastapp(account_id)` (SECURITY DEFINER, idempotente): crea `recipe_item` (type='dish', `needs_review=true`, sin escandallo) + `menu_item` por producto sin presentación; salta marcas inexistentes (no inventa). Sembró 197+80 cedidas. (4) `adapt_lastapp_order` **v3**: combos casan por marca DEDUCIDA de sus hijos casados (el combo no trae `organizationProductId` propio, solo los hijos; patrón industria = el combo se identifica por sus componentes). **Residual 9 líneas `no_recipe`** = ventas SIN `organizationProductId` en el crudo (dato ausente en origen; casables a mano por su marca, que ahora tienen). `unmapped_reason` válidos (CHECK): `no_brand`, `no_recipe`, `no_menu_item`, `ambiguous`, `ignored`, `delisted`.

**(B) RAW EVENT STORE — guardar el 100% del ticket que el TPV exporta, se use o no (principio de Julio, estructural).** El webhook guardaba solo `tab.products` (`raw_products`) y descartaba la cabecera entera (marca `locationBrandId`, local, cliente, notas, delivery). ARREGLADO: columna `sale.raw_tab text` + `lastapp-webhook` redeployado (`--no-verify-jwt`) guarda el `tab` COMPLETO en `raw_tab` (mantiene `raw_products`). Lo que no se use hoy queda para mañana.

**(C) MARCA ESTABLE POR UUID — fin de la deducción frágil (principio de Julio: no deducir por parámetros que cambian en el tiempo).** El ticket SIEMPRE trae `locationBrandId` (marca) + `locationId` (local) en su cabecera (verificado con el OpenAPI oficial de Last; el evento de ventas es `tab:closed`, NO `catalog:updated`). El casado deducía la marca de los productos (cambia si se recasa) → mal. AHORA: (1) marca histórica recuperada del log al 100% — `external_brand_text`/`external_location_text` rellenados en las 379 ventas desde `lastapp_webhook_log` (cruce por `bill.id`=`external_ref`, verificado 375/375; el log tenía 656 tickets con `locationBrandId`). (2) `external_brand_map` poblado y **VALIDADO POR JULIO**: 42 filas `(source=lastapp, external_brand_id=locationBrandId, external_location_id=locationId) → brand_id`. 42 UUID Last → 16 brands → 6 UUID local → **3 locales físicos** (cada local tiene 2 cuentas Last: propia + CTB cedidas; mismo almacén físico). Validación por productos (cada UUID cuadra con su marca) + confirmaciones de Julio: **Milanesa House=propia / Milanesa Haus=cedida** (dos marcas reales); **Van Van, FOODINT, Dirty Burgers** = sin uso/técnica/parada (no se mapean). (3) `sale.brand_id` rellenado vía el mapa (no por productos). (4) `adapt_lastapp_order` usa `v_sale.brand_id` (del mapa); webhook `resolveSaleBrand` reescrito: PRIMERO el mapa, respaldo por productos solo si el mapa no conoce la combinación (con log de aviso).

**(D) SELECTOR DE LOCAL — desbloqueado.** Era texto muerto: `ShellTopBar` pintaba `{locationLabel}` fijo, no el `LocationSelector` real (que ya existía y funciona: usa `useLocationScope`, persiste en `AppContext`). Arreglado: ahora monta `<LocationSelector/>`. Build verde. **PERO ninguna página lo escucha** (cambias local y Pedidos/Personal/Recepciones no filtran) → frente "scope de local en toda la app" (encargado a Code). Permisos por local (qué locales ve cada usuario) = pendiente, va con accesos de Llorente29.

**(E) PANTALLA POR MARCA×LOCAL — diseñada (maquetas validadas con Julio), NO construida.** Encargada a Code. Diseño: local del selector global de arriba, marca con selector propio; por marca su historia completa (pendiente/casado/ignorado, agrupado por producto con nº ventas); casado acotado a la marca (imposible error de atribución); "ignorar" pide MOTIVO y se ve motivo+fecha+deshacer (golea a tspoon, que no muestra el porqué). `salesReliabilityService.ts`/`SalesExceptionsPage.tsx` existen pero NO filtran por marca/local.

**Encargo a Code**: `docs/ENCARGO_CLAUDE_CODE_local_y_pantalla_marca.md` (TRABAJO A = scope de local en la app; TRABAJO B = pantalla por marca×local). Para ejecutar en paralelo mientras Julio monta Llorente29.

**Commit del día**: `4493071` (20 ficheros, pusheado y verificado 0 0). Incluye: `sale.raw_tab`, webhook con marca por mapa, `adapt_lastapp_order` v3, `seed_catalog_from_lastapp`, `ShellTopBar` con LocationSelector, `HomeGeneral` con métricas reales.

**DEUDA TÉCNICA (versionar antes de dar el repo por sano)**: DDL aplicado en sesión que falta como migración con prefijo de fecha: `alter table sale add raw_tab`, redefinición de `uq_menu_item_external` (con `brand_id`), poblado de `external_brand_map`. Las migraciones `adapt_lastapp_order.sql`/`_v3.sql`/`seed_catalog_from_lastapp.sql` están SIN prefijo `YYYYMMDDThhmm_` (rompe convención) → renombrar. Regenerar `database.ts` ya hecho (raw_tab).

**SEGURIDAD — rotar (pegados en chat hoy)**: `LASTAPP_INTERNAL_KEY` (`e1f05c66...`), publishable key (`sb_publishable_PyzPVoi...`, pública pero registrada), internal key de prueba (`247ef137...`).

---


**Última actualización: 2026-06-10 (CIERRE jornada). Lo último — INVENTARIO PERPETUO avanzó tres frentes + ARREGLO CRÍTICO de webhook.**

**(A) T1 INVENTARIO DE APERTURA — HECHO y en producción (commit 9898d4c).** Nuevo `movement_type='apertura'` (7º tipo) + `inventory_count.is_opening`. Un conteo es apertura si el local no tiene movimiento `apertura` previo (detección automática en `build_inventory_count`). `apply_inventory_count` escribe `apertura` en vez de `ajuste` si is_opening. El AvT excluirá `apertura` de la variación. Front: `InventoryCountSheet` con banner de apertura (oculta Sistema/Variación/Motivo). Migración `20260610T1200`.

**(B) T2 REGISTRO DE MERMA PROACTIVO — HECHO y en producción (commit 2e02f69, build verde).** `movement_type='merma'` + `source_type='waste'` + tabla `stock_waste` (causa, qty_base, unidades de uso preparadas para frente 7, unit_cost, cost_eur, foto opcional, lote, caducidad) + RPC `register_waste` (SECURITY DEFINER; cualquiera registra, decisión Julio). Front: pestaña "Merma" en Inventario (`WasteSection.tsx` + `wasteService.ts`): alta rápida (artículo→cantidad base→causa→foto opcional) + listado del periodo con €. Catálogo de causas curado. Migraciones `20260610T1500` (esquema) + `20260610T1600` (RPC). RECON corrigió: `listInventoryItems(accountId)` recibe solo cuenta; `InventoryItem` no trae unidad (se resuelve por join en el listado vía `recipe_item.base_unit_id`→`kitchen_unit.abbreviation`).

**(C) AUTOINVENTARIO IA — DISEÑO APROBADO + A1 ESQUEMA HECHO (commit 5f9cb7d).** Diseño completo en `docs/folvy_autoinventario_diseno.md`. Motor 2 capas anidadas: **QUÉ contar** = valor (consumo rotación×coste + `stock_value` refuerzo) + rotación + riesgo (`variance_*` + `stock_waste`; el riesgo PROMOCIONA un barato a clase alta); **CUÁNTO contar** = por COBERTURA de valor en riesgo, NO cadencia fija (el "3-5/día" era inventado, DESCARTADO), NO p-valor (inventario sesgado; honesto = "cobertura", no "estadística"). **CRITICIDAD OPERATIVA** (override, diferenciador): consumible barato e invisible cuyo fallo CIERRA la marca (ej. bolsas de envío — no van en escandallo, ABC las pondría en C, pero sin ellas no sale un pedido). Atributo MARCABLE (no deducible): `recipe_item.is_operational_critical` + `operational_min_qty` opcional (decisión Julio: opción 2 = flag + mínimo opcional; alarma proactiva al bajar del mínimo, sin esperar al conteo). HECHO en esquema (migración `20260610T1700`, versionada). QUIÉN cuenta = trabajador FICHADO, rota, no su zona. Variaciones → food cost (merma real no explicada por ventas se suma al coste real) + explicación REAL (`stock_waste`) / TEÓRICA (IA propone, no afirma). Configurable el OBJETIVO, no el motor. Didáctico en 2 idiomas (cocinero/gerente). Benchmark hecho (MarketMan/NetSuite/SAP: todos cadencia fija por ABC, nadie dimensiona por fiabilidad ni explica ni cierra a food cost → Folvy golea). RECON completo: rotación sale de `stock_movement` (`movement_type='consumo'`, `qty_base*unit_cost`); coste de `recipe_item.computed_cost`; stock de `recipe_item_location_stock`. **PRÓXIMO: A1-función (ABC/score AL VUELO, no persistido) + A2 (cola priorizada visible).**

**(D) ARREGLO CRÍTICO — WEBHOOK perdía ventas de local no mapeado (CTB).** El `lastapp-webhook` hacía `throw` ante local no mapeado → la venta se perdía (solo log). ARREGLADO de fondo y DEPLOYADO (`--no-verify-jwt`): ahora guarda como `note='pendiente-local-no-mapeado'` en `lastapp_webhook_log`, sin throw → NINGUNA venta se pierde. Las 3 tiendas CTB (Cloudtown, org Last `b7bc4753`) mapeadas a mano a sus Foodint en `lastapp_location_map` (misma cocina física: 2 `lastapp_location_id` → 1 `location`; cruce confirmado por API Last `/locations` con dirección, NO por la fiscal de Barcelona del payload). Token integrador Folvy/Cloudtown = `247ef137-...`. **PENDIENTE (anotado, memoria #21): las ventas CTB entran pero NO casan** porque falta importar el CATÁLOGO CTB (`lastapp_catalog_product=0` → `resolveSaleBrand` da null) + marcas/menús cedidas, igual que se hizo con las propias (herramienta `lastapp-catalog-import` apuntada a org Cloudtown). Diseño del frente onboarding en `docs/folvy_onboarding_integraciones_diseno.md`. Lección de método: el camino de ALTA DE LOCAL NUEVO EN VIVO (onboarding) es distinto del backfill histórico y hay que probarlo como tal — el webhook asumía "local ya mapeado".

**Última actualización: 2026-06-09 (CIERRE jornada). Lo último — FRENTE NUEVO CRÍTICO «RECEPCIÓN USABLE Y FIABLE»:** Julio recepcionó albaranes reales y el flujo NO da seguridad ("los formatos no casan; falta ver la foto del albarán mientras corrijo cantidades; del 3º-4º ya ni miraba; un trabajador comete error seguro"). RECON hecho: `GoodsReceiptForm` YA tiene formato manual, conversión, blind-receiving y resumen pre-confirmación — el problema es que el CONJUNTO no transmite seguridad. Tres huecos a resolver JUNTOS: (1) conversión de formatos robusta y clara; (2) foto del albarán visible junto a la tabla al editar (tspoon TAMPOCO la muestra = gol Folvy); (3) bloqueo de confirmación si Σlíneas ≠ total del albarán (tspoon solo avisa = gol Folvy). Benchmark tspoon iniciado (3 capturas); FALTA el profundo (dump `tspoon_dump/` + R365/MarketMan/xtraCHEF). **REDISEÑO HECHO (noche 09/06, commits 5230ff4..62a225e, build verde): espejo del albarán — recibido a ciegas, foto del albarán a la IZQUIERDA, «el albarán dice» agrupado, formato en UNA línea con árbol de pack real (`ensurePackTree`: nodo interior contable + Caja con qty_in_base derivado, sin trigger en cascada), «→ X al almacén» visible, rojo+motivo si no cuadra; tarjeta con jerarquía limpia. PENDIENTE: Julio no está del todo convencido y VALIDA con VARIOS ALBARANES (10/06); si cuadra → recepción a HECHO; si no → ajustar tarjeta/parser/árbol.** Segundo frente acoplado: NAVEGABILIDAD/USO MÓVIL del trabajador (foto no visible en móvil = deuda responsive; recepción fuera del portal del trabajador; permisos por decidir; idea: portal en dos bloques — personal / procesos de trabajo). ANTES (mismo día, ya commiteado): bug estructural del router (`isShellRoute` obsoleto en `routes.ts`) — F5/recarga ya no expulsa a Inicio; crear plato desde venta huérfana (`create_dish_from_unmapped` + `ConfirmDialog` Folvy + navegación a la ficha). Commit 3bc2705. Y antes (09/06 mañana): consumo teórico VIVO (af85058), identidad del recast jubilada + `reprocess_sale` unificado (6e7f765), recosteo + política DOS RELOJES (coste de venta CONGELADO / coste de ingrediente VIVO; diagnóstico, sin código), capa 4 de fiabilidad verificada 95,02%. El §1 del 08/06 se conserva debajo. Ver §1.1 y §1.3.**

**Última actualización: 2026-06-08 (CIERRE jornada). Lo último (FRENTE FIABILIDAD reorientado a CANÓNICO): el adaptador Last.app ahora escribe `unmapped_reason` en el canónico (Camino A, commit 9e62e36) → la razón del no-casado (no_brand/no_recipe/no_menu_item) vive en sale_line, calculada por el adaptador (que conoce el formato), y la fiabilidad la LEERÁ sin acoplarse a ningún TPV. Verificado tras backfill (201 ventas/761 líneas): product 306 casan/17 no_recipe/4 no_menu_item; combo_item 121/22/8. SIGUIENTE: capa 4 (señal de fiabilidad % ciego, lee canónico) + reescribir compute_sale_line_cost para leer canónico (hoy aún lee raw_products). ANTES (mismo día, 3 hitos mayores): (1) MODELO CANÓNICO multi-TPV — puerta única de entrada, el core no lee formato de TPV, solo el adaptador (adapt_lastapp_order descompone en jerarquía product/modifier/combo_item); añadir TPV = 1 adaptador, CERO cambios en core (Otter entrará por el suyo). (2) MOTOR DE COSTE DE VENTA REAL — sale_line.computed_cost = escandallo ± modificadores confirmados + combos (Σ componentes). (3) G3 MODIFICADORES COMPLETO — el frente diseñado el 05/06: modifier_recipe_impact con ciclo de vida (proposed/confirmed; el coste solo usa confirmed); pestaña "Modificadores" en el editor (diff SALE→ENTRA sin jerga, confirmar/ajustar/rechazar, crear ingrediente al vuelo marcado needs_review); Edge propose-modifier-impacts (Nivel 2 IA, botón "Sugerir con IA"); latido de coste en vivo (preview server-side); 3 niveles de aprendizaje (1+2 operativos, 3 auto-confirmación DORMIDO hasta histórico). Commits: 72ca8a5, c75ee40, d1a30a5, 01c2904, 3ee6cc9, ae541e9, 9e782f9, 9e62e36. LECCIÓN DE MÉTODO (Julio): `conversation_search` del tema ANTES de abrir cualquier frente — el de modificadores ya estaba diseñado el 05/06 y se redescubrió a base de rodeos. Ver §1.1.**

> **NOTA DE MANTENIMIENTO:** el fichero VERDADERO es `C:\dev\llorente29-app\CONTEXTO_CLAUDE.md` (git). La fuente de verdad técnica es la BBDD+repo, no este relato (regla recon de área). Migraciones SQL versionadas en `supabase/migrations/`.

### 1.0 — CORRECCIÓN DE DATO (vigente)
CEO: **Julio Gª Colón (García Colón)**, NO "Gascón". Admin Google: `jgcolon@idasal.com`. Correo partners/integraciones: `partners@folvy.app`. **Folvy es para TODA la hostelería, no solo dark kitchens.**

### 1.0.bis — ARQUITECTURA DE CUENTAS (03/06, CRÍTICO — NO CONFUNDIR)
- **`Folvy Interno` (account_id `00000000-0000-0000-0000-000000000001`) = BANCO DE PRUEBAS.** Aquí vive TODO el trabajo real de desarrollo: 162 raws, 215 dishes, ~12K ventas, 55 familias de plato + 15 de ingrediente. **Para Kitchen/coste trabajar SIEMPRE aquí.**
- **`Llorente29` (`51ad1792-6629-4ef7-833a-b57b09a86710`) = CLIENTE REAL, hoy VACÍO** (0 raws/dishes/ventas). Se poblará migrando desde Folvy Interno cuando esté listo.
- **Futuro:** cuenta "cliente base" con semillas/plantillas para onboarding de clientes nuevos.
- **REGLA:** verificar el `account_id` real con SELECT antes de sembrar/configurar. NO asumir Llorente29. (Hoy se corrigió el vigilante de ingesta y el seed de familias, que estaban por error en la cuenta vacía.)

### 1.0.ter — DECISIÓN ESTRATÉGICA MAYOR (02/06) — NO PERDER
**Folvy es INTEGRADOR DIRECTO de las plataformas de delivery (Glovo primero), sin intermediarios.** Razones: coste, concepto 360, control del flujo de datos, fidelización estructural. Confirmado viable (Glovo/Uber tienen partner program con staging gratis).

### 1.0.quater — GIRO ESTRATÉGICO MAYOR (03/06) — APROVISIONAMIENTO = MRP II
**El aprovisionamiento de Folvy NO es "un módulo de compras" — es MRP II DE CICLO CERRADO de hostelería** ("SAP/Oracle con UI moderna que un cocinero usa sin manual"). El hueco de mercado para GANAR: nadie en hostelería tiene la PLANIFICACIÓN (Apicbase/MarketMan/Toast se quedan en ejecución). El "paso 4 IA factura→coste" era solo la fase 8-9 de un ciclo de 13.
- **Las 13 fases:** previsión demanda → plan maestro → explosión de necesidades (escandallo×ventas) → balance vs stock → capacidad → órdenes (auto/stock mínimo/plantilla/iniciativa) → aprobación → envío → recepción albarán (OCR) → factura + three-way match → inventario perpetuo → trazabilidad lote → AvT → cierre/márgenes. **El cierre realimenta la previsión** (ciclo cerrado).
- **MÉTODO:** copiar conceptos estándar de ERP industriales/perecedero (reorden, stock seguridad, lead time, lote económico, BOM, three-way match; PAR levels, FEFO, lotes con caducidad, auto-86, transferencias entre locales) y TRADUCIR a lenguaje de cocina. NO inventar.
- **PRINCIPIO RECTOR (construcción por capas):** cada capa = SISTEMA COMPLETO Y USABLE POR SÍ SOLO sin depender del MRP II, pero con los GANCHOS puestos desde el día 1 para enlazar después. Entrada manual que funciona sola; el MRP II se enchufa luego como fuente/consumidor sin reescribir. NO construir media tubería inútil.
- **NORMA IA en compras:** la IA NO es solo OCR — es COPILOTO que guía al comprador y evita errores (pedido: cantidad por histórico, sobrepedido, proveedor preferente, duplicado; recepción: descuadres, caducidades; factura: variación de precio, three-way, errores). Lenguaje cocinero, anti-invención, confianza visible. "IA propone, humano decide".
- **DECISIÓN navegación:** módulo PROPIO de primer nivel (confirmado por Apicbase: módulos hermanos sobre datos maestros centrales). **Folvy Kitchen = datos maestros** (ingredientes/recetas/proveedores/coste). **Folvy Supply = proceso** (pedir→recibir→facturar→inventario→previsión).
- **DOCS:** `folvy_mrp_ii_mapa.md` + `.svg` (raíz repo, commit bf4f2a4) = mapa de las 13 fases con estado, insumos existentes y método. Mirarlo al decidir frentes de este módulo.

### 1.1 — Dónde estamos HOY (estado construido)

**ACTUALIZACIÓN 16/06/2026 (NOCHE — LO MÁS RECIENTE, leer primero). Kitchen en producción real (Llorente29), recepción real con Pamela, y nace el MAPA DE FOLVY vivo.**
- **APROVISIONAMIENTO RECONSTRUIDO A €/BASE (cierra OBLIGATORIO D).** El motor de aprovisionamiento se reconstruyó a €/unidad base (€/g, €/ml, €/ud): `last_price` ya es €/base en las dos cuentas (coste-neutral verificado), motor desacoplado del formato, recepción/factura escriben a €/base, UI base-first, alta blindada, `negotiated_price` (precio pactado), tres alarmas de precio en recepción (puntual, contra-pactado, deriva vs mediana), `void_goods_receipt` revierte stock+precio. SQL `20260616T1200_aprovisionamiento_eur_base.sql`. La vieja ambigüedad €/caja vs €/base queda disuelta.
- **BADGE HONESTO DE INGREDIENTES (en producción, `KitchenItemsPage.tsx`).** Dos señales excluyentes por fila: "sin terminar" (ámbar = `needs_review`, falta clasificar) vs "sin coste" (neutro = clasificado pero `fixed_cost`/`computed_cost` = 0, falta proveedor). "clasificado y costeable" = sin chip. El "sin coste" es DERIVADO del coste (no flag guardado): una recepción recostea → cae solo. Cierra el agujero de "se ve hecho pero subcostea en silencio".
- **178 INGREDIENTES DE LLORENTE29 CLASIFICADOS.** IA en serie (familia + IVA derivado determinista). Hubo que sembrar antes el árbol de familias (ver hueco abajo). Cierre de dato de 5 falsos positivos: ingredientes con familia+IVA+sin nota que la IA dejó en `needs_review` por timeout (el enriquecido grababa pero la última llamada se cortaba) → `UPDATE needs_review=false` acotado a familia+IVA+sin nota. DEUDA: el masivo debe cerrar `needs_review` aunque la llamada IA falle (al tocar `recipeBulkEnrichService`).
- **HUECO DE ARQUITECTURA (familias): `recipe_family` es POR CUENTA, no global → cuenta nueva nace SIN familias.** `migrate_kitchen_core` solo creó las familias referenciadas por algún ingrediente migrado → Llorente29 nació con 2 de 16. PARCHE mínimo reversible: copiadas las 14 familias planas que faltaban desde Folvy Interno (sin duplicar). PENDIENTE RAÍZ (frente prioritario): `seed_ingredient_families_for_account()` idempotente enganchada al onboarding JUNTO a `seed_appcc_for_account` + LISTA GRANDE definitiva (árbol AECOC jerárquico con `parent_family_id`+`code` + master `ingredient_template` grande). Pedida hace días por Julio, no debe volver a aparcarse.
- **FIX IVA: `rowToRecipeItem` no mapeaba `vat_category_id`/`vat_category_source`** (`recipeItemService.ts`) → la ficha mostraba "sin IVA" aunque estuviera guardado y confirmado en BBDD. NO era el guardado ni RLS: era el mapeo, que vaciaba el IVA al pasar de fila a objeto. Passthrough laxo añadido (mismo patrón que el resto del módulo: `database.ts` va por detrás). DEUDA: tipar `vatCategoryId`/`vatCategorySource` en `RecipeItem` al regenerar `database.ts`.
- **RECEPCIÓN REAL Bidfood (con Pamela).** Milanesa: formato "Caja 16 ud" (4 kg) → 58,49 €/caja = 3,656 €/ud. Aprendizaje clave: el descuadre "cuentas en piezas / albarán en cajas" (1 caja = 170 tequeños, 2 cajas = 32 filetes) es CORRECTO, no un error. **DEUDA UX PRIORITARIA (rediseño, sesión dedicada — el frente de Julio):** la fricción real es el ARRANQUE EN FRÍO (la 1ª vez de cada artículo obliga a montar formato/unidad/precio en plena recepción). Separar el ALTA del artículo (pensar, antes, en calma, o sembrado del catálogo del proveedor) de la RECEPCIÓN (solo contar+confirmar). Además: (a) distinguir descuadre REAL (rojo que frena) de "misma cantidad otra unidad" (gris informativo, hoy salta rojo y deja confirmar = alarm fatigue); (b) aceptar IMPORTE TOTAL de línea, no €/caja (Julio pisó la trampa: tecleó total como unitario = doble coste); (c) recordar formatos montados. Benchmark blind-receiving.
- **MAPA DE FOLVY v1 EN PRODUCCIÓN (`/_admin/mapa-folvy`).** Pedido por Julio para "acotar el descontrol según crece el proyecto". Diagrama de flujo del producto COMPLETO (39 cajas: construido + ideas pendientes como tienda propia/Otter/HubRise/Catcher/cedidas/MRP II/comisiones). Tabla `folvy_map_node` (GLOBAL sin account_id, RLS solo `platform_admins`; `status_declared` vivo/a_medias/deuda/bloqueado/vacio/idea + `status_note` + `measure_table`; árbol `parent_id`/`layer`/`flow_order`; flujo aprovisionamiento→cocina→venta→consumo→margen + ramas plataforma/soporte/admin). RPC `folvy_map_measure()` (estado MEDIDO vivo vía `pg_stat_user_tables`). Página por capas: semáforo declarado (color caja, juicio de Julio, MANDA) + señal medida (conteo de filas) + CHOQUE marcado cuando no cuadran + edición de estado en 1 clic. Migraciones `20260616T2330` (tabla) + `T2335` (seed idempotente) + `T1400` (RPC). NO es un .md que envejece: lo medido se recalcula solo, el juicio se edita en un clic. EVOLUCIÓN = post-v1, guiada por uso. El RITUAL DE CIERRE gana un paso permanente: actualizar `folvy_map_node` (estado declarado de las cajas que cambiaron de fase).
- **FRENTES GRANDES ANOTADOS (memorias) para próximas sesiones:** (1) rediseño de RECEPCIÓN (arranque en frío); (2) PROVEEDORES/PRECIOS (vuelve costeables las muchas "sin coste", da sangre al Bloque 6c "proveedores que se encarecen" aparcado por falta de histórico); (3) MÓDULO ALMACÉN/INVENTARIO completo tipo tspoon — diagnóstico de Julio "hacemos muy bien el autoinventario pero poco más": la JOYA (autoinv IA) está, falta el CUERPO (gestión almacén: múltiples almacenes+ubicaciones, stock teórico vs real, mover, mermas, máx/mín) + status de cobertura de áreas (hoy autoinventario sale vacío en cuenta nueva por 0 áreas) + IA que recomienda almacén por familia/conservación; (4) LISTA GRANDE familias/ingredientes AECOC; (5) CLOUDTOWN marcas cedidas — CTB mantiene escandallos en app Lovable (solo pantalla); sincronización viva requiere acceso a SU base (Supabase) o export, o scraper Playwright vía Code; pendiente conversación con CTB.

**ACTUALIZACIÓN 16/06/2026 (mañana/tarde).**
- **TRABAJADOR — cambios de turno arreglados (commit `9af0a0c`, rev-list 0 0).** `fetchColleagues(locationIds)` en `supabaseSync.ts` (busca compañeros por local sin exigir accountId; la RLS filtra por cuenta) + `SolicitarCambioModal`/`TablonCambiosView`/`MisCambiosView`. El "bloqueante" de login del trabajador (`El empleado no pertenece a tu cuenta`) era **FALSO**: sesión cruzada de admin cacheada en el navegador de localhost; en producción funcionaba. La confirmación del INTERCAMBIO queda por validar con un trabajador real en producción (validación, no deuda).
- **DELIVERY / INTEGRACIONES (diseño + esqueletos, NADA desplegado):**
  - **OTTER:** adaptador diseñado + esqueleto hasta el límite del alta (`docs/folvy_adaptador_otter_diseno.md` + `supabase/functions/otter-webhook/index.ts`). Frontera valida `X-HMAC-SHA256` (base64 del body con secret); `order.create` responde 200/202; catálogo BIDIRECCIONAL (Menus + Menus Manager); **NO hay API de promociones** (solo efecto en Order Total/Finance); deploy obligado `--no-verify-jwt`. Alta requiere **Application ID + Client Secret de un Account Representative** (NO credenciales de cliente como Last). 2º correo de partnership ENVIADO.
  - **HUBRISE:** muy avanzado (Janaina; reseller desde 6ª cuenta −28,6%; setup 25€/conexión, 1ª marca/local gratis, −50% agrupado; sub 35€→10€/local; sin sandbox=producción, cuenta test "Folvy"; Glovo ES sin fecha). **CLIENTE 2 (1 local, 6 marcas, Uber+JustEat, SIN Glovo) DESBLOQUEA HubRise = vía rápida sin esperar a Otter.** Correo de reactivación a Janaina preparado. Build = adaptador `hubrise` (1 API cubre Uber+JE) sobre ingesta canónica.
  - **LAST (hallazgo, soporte Abraham Miranda):** NO expone estado abierto/cerrado de marca/canal (ni endpoint ni evento; propuesto sin fecha). Desactivación de PRODUCTO sí, vía `catalog:updated`. ⇒ la **alarma de disponibilidad se construye sobre HORARIOS (horario declarado), no sobre Last.**
- **TIENDA PROPIA = Folvy Shop (estudio en `docs/folvy_tienda_propia_estudio.md`).** Único canal directo que SABE el margen real (escandallo + economía de plataformas). El pedido entra por la ingesta canónica (`external_source='folvy_shop'`) → KDS + stock + AvT. Multimarca nativo + **CARRITO CRUZADO entre marcas con UNA entrega** (ventaja dark-kitchen que Glovo no da). Stripe Connect MVP. Fases S1 pickup → S5. **MARKETPLACE (Folvy B2C agregando a todos los clientes) = OTRO negocio, APARCADO** (compite con los partners, problema de tráfico/CAC, contradice el sin-comisión).
- **MOTOR DE OFERTAS POR PLATAFORMA (clima+deporte+rentabilidad) — BENCHMARK + DECISIÓN, NO construir.** Es la §10 de `folvy_economia_plataformas_diseno.md`. Auditoría 16/06 (regla deuda-0): **YA EXISTE** — **PLEEZ** (trypleez.com, Madrid, 2020, Buenavista Equity) hace exactamente esto: push de 1 clic a Uber/Glovo/Deliveroo, guardarraíles de margen, disparadores por reglas, **inputs CLIMA + EVENTOS DEPORTIVOS**, competitor tracker; opera vía **credenciales del restaurante** (automatiza el panel del agregador) + **scraping de escaparates** públicos por zona. Sapaad (promos margen-multicanal) y Nory (clima+eventos para forecasting) también pisan el área. **DECISIÓN: NO clonar** (océano rojo, incumbente local financiado); Folvy aporta solo la VERDAD DE MARGEN que Pleez no calcula (escandallo + economía real reconciliada, agnóstico de TPV) → quedarse con el **guardarraíl de margen por plato×plataforma** (sale de Capa A/C de economía); clima/deporte/auto-push = territorio Pleez; Pleez = posible integración, no enemigo. Doc: `docs/folvy_motor_ofertas_diseno.md`.
- **OBLIGATORIOS abiertos (sin cerrar hoy):** A) acceso trabajador reentrada PIN; B) PWA instala directo en Android; C) masivo no cierra `needs_review` por `review_notes`; D) editar precios de proveedor desde la app (decisión de raíz: qué es `last_price`, €/caja vs €/base). Detalle en el guion vivo.
- **SEGURIDAD pendiente (arrastrada):** rotar service_role key + `LASTAPP_INTERNAL_KEY` (e1f05c66) + token Last (247ef137); www.folvy.app NXDOMAIN.

**MODELO CANÓNICO MULTI-TPV + COSTE DE VENTA REAL + G3 MODIFICADORES + FIABILIDAD REORIENTADA (08/06). Día de 3 hitos arquitectónicos y el frente de modificadores cerrado de punta a punta.**
- **MODELO CANÓNICO (puerta única de entrada):** decisión arquitectónica de Julio — TODOS los datos externos entran por un adaptador que los traduce al canónico; el core (coste/inventario/analítica/fiabilidad/economía/previsión) NO lee formato de ningún TPV, solo el canónico. El esquema ya existía (`sale` + `sale_line` con `line_type`/`parent_sale_line_id`/`modifier_option_id`/`combo_slot_id`/`map_source`/`unmapped_reason`/`computed_cost`). Adaptador `adapt_lastapp_order(sale_id)` descompone `raw_products` en jerarquía: producto (line_type='product') → modificadores (line_type='modifier', parent=producto) → componentes de combo (line_type='combo_item') → modificadores de componente (nietas). Identidad: producto/componente por `organizationProductId→lastapp_product_map→recipe_item→menu_item`; modificador POR ID en contexto del padre (`modifier_group_assignment→modifier_option.external_id`) con fallback por nombre. Backfill: 201 ventas, 761 líneas (product 327/modifier 283/combo_item 151). **Añadir un TPV = 1 adaptador + poblar mapeos, CERO cambios en core.** Otter: Julio tiene acceso manager de un cliente (sirve para validar; conector productivo requiere Programa de Socios). Commit c75ee40.
- **MOTOR DE COSTE DE VENTA REAL:** `sale_line.computed_cost` (+ `cost_computed_at`). `compute_sale_line_cost(sale_line_id)` = escandallo del producto ± modificadores (impactos CONFIRMADOS) + combos (Σ coste de componentes reales del JSON, recursivo). Helper `_impact_cost(target, qty, unit)` con conversión IDÉNTICA a `kitchen_recompute_item` (qty×factor/base o vía recipe_item_unit_conversion). HONESTO: NULL si falta coste, no inventa. **DEUDA: aún lee raw_products; pendiente pasar a leer canónico (frente 1 actual).** Commits 72ca8a5 (producto+mods+combos).
- **G3 MODIFICADORES — COMPLETO** (el frente diseñado el 05/06; decisión B = normalizar en ingesta, modelos delta xtraCHEF/Craftable + multiply):
  - `modifier_recipe_impact` ampliada con CICLO DE VIDA: `status` (proposed/confirmed/rejected), `confidence`, `source` (human/ai/import), `rationale`, `confirmed_by_name`/`confirmed_at`. **`compute_sale_line_cost` SOLO usa status='confirmed'** → una propuesta de IA NUNCA toca el coste hasta que un humano la confirma (humano siempre entre IA y coste). Commit d1a30a5.
  - Pestaña "Modificadores" en `RecipeEditorPage` (junto a Escandallo/Receta/Etiquetado): cabecera de cobertura (conocidos/por revisar/%), tarjeta por opción con diff legible SALE→ENTRA (CERO jerga técnica, nunca se ve add_item/replace_item), confirmar/ajustar/rechazar. `modifierImpactService.ts` (listOptionsByRecipe, getCoverage, upsert/confirm/reject, recomputeAffectedSales). Commit 01c2904.
  - **Crear ingrediente al vuelo** en "Ajustar": si no existe, "Crear «X» como nuevo" → nace SIN coste y marcado `needs_review` (declaradamente incompleto, aviso "sin terminar" en la tarjeta, se propaga a ficha/listas/plato por el sistema existente). Reutiliza `createRecipeItem`.
  - Edge `propose-modifier-impacts` (Nivel 2 IA, deploy CON verify-jwt — no recibe webhooks): 3 fuentes en orden de fiabilidad — aprendizaje cruzado (misma opción ya confirmada en otro plato, sin IA, conf 0.9), IA Sonnet por nombre+catálogo (elige solo de ingredientes que existen), anti-invención (conf<0.55 o sin ingrediente claro → no propone). Todo `proposed`+`source='ai'`. Probada en real (Big Napo): acertó Pollo/Ternera 0.95, en Cerdo cogió lo más cercano 0.85 porque NO existe milanesa de cerdo (fallo de datos, no de IA). Botón "Sugerir con IA" en la pestaña. Commits 3ee6cc9, ae541e9.
  - **Latido de coste en vivo** (`preview_modifier_impact_cost`, solo lectura, reutiliza `_impact_cost` → preview == coste guardado): en "Ajustar", al cambiar cantidad muestra base→delta→total con debounce 350ms. Server-side (regla: coste nunca en cliente). Commit 9e782f9.
  - **3 NIVELES de aprendizaje:** 1 (memoria, ON) + 2 (propuesta IA, ON, humano confirma) operativos; 3 (auto-confirmación) CONSTRUIBLE PERO DORMIDO — sin histórico la "confianza alta" sería inventada y auto-confirmar mal corrompe el food cost (viola anti-invención). DISPARADOR: ~50-100 impactos confirmados con buen acierto → Julio baja el umbral. La diferencia 2 vs 3 NO es cuánto ayuda la IA, es SI HAY HUMANO entre IA y coste. Mismo patrón que estrategias coste average_* dormidas.
  - Docs: `docs/folvy_g3_editor_impacto_modificadores_diseno.md`, `docs/folvy_reconciliacion_identidad_modificadores.md`, `docs/folvy_modelo_canonico_ventas.md`.
- **FIABILIDAD REORIENTADA A CANÓNICO (frente actual):** el `recast_lastapp_sales` viejo lee `raw_products` (acoplado a Last.app) → contradice el modelo canónico. DECISIÓN: la identidad vive en el adaptador (por TPV), la fiabilidad lee el canónico (agnóstica). HECHO (Camino A, commit 9e62e36): el adaptador calcula y escribe `unmapped_reason` (brand_id null→no_brand; sin recipe→no_recipe; recipe sin carta→no_menu_item) — en el sitio donde conoce el formato. Verificado tras backfill: product 306/17/4, combo_item 121/22/8, 0 no_brand. Folvy distingue no_recipe de no_menu_item (tspoon los junta) → acción distinta. PENDIENTE: capa 4 (señal % ciego lee canónico), reescribir compute_sale_line_cost a canónico, jubilar identidad del recast viejo.
- **HALLAZGO de RECON (08/06):** `sale_line` NO tiene referencia externa al producto de origen (solo product_name + menu_item_id) → la razón del no-casado debe calcularla el adaptador (que sí tiene el id externo y los mapeos), no una función de fiabilidad agnóstica posterior. Por eso Camino A. `lastapp_product_map` en BBDD tiene `recipe_item_id` (el migration 20260528T1100 dice menu_item_id → drift documentado).


**MÓDULO FOLVY SUPPLY — CASADO DE VENTAS lastapp + SUBSISTEMA DE FIABILIDAD (07/06). Arregla que las ventas de plataforma entraban SIN casar y arranca el sistema que vigila ese dato sucio en todo el ciclo MRP II.**
- **Causa raíz (verificada en BBDD, no hipótesis):** tras el Catálogo de Marca Fase A, los `menu_item` quedaron con `channel_id` NULL (canal vive en `menu_item_override`). El webhook construía su cache con clave `channel_id|recipe_item_id` y EXCLUÍA los menu_item sin canal → cache vacía → las 267/286 líneas caían a `unmapped`, con `sale.brand_id` también NULL. Además el payload de Last.app NO trae la marca; sí trae `catalogProductId` por producto.
- **Fix del webhook (`supabase/functions/lastapp-webhook/index.ts`, desplegado `--no-verify-jwt`):** cache por **`brand_id|recipe_item_id`** (carga menu_item con brand_id aunque channel_id sea NULL). La MARCA se resuelve por `catalogProductId → lastapp_catalog_product.lastapp_brand_name → brand` (autoridad: el catalogProductId es único por marca, aunque el mismo plato exista en varias marcas). `resolveLine` ya no usa canal (el canal queda para economía en `sale.channel_id`) y devuelve `brand_id` aunque el plato no case. Benchmark xtraCHEF/Apicbase: consumo canal-agnóstico, casado a nivel item; canal = dimensión de economía. `menu_item_override` solo lleva precio/disponibilidad (verificado, sin recipe).
- **Verificado por simulación SQL sobre 374 líneas reales:** marca 374/374 (100%), receta 318/374, casarían a menu_item 214/374. El resto queda unmapped SIN inventar (escandallos/cartas incompletos). El emparejamiento sale_line↔raw_products NO puede ser por posición (37% desordenadas) → se hace por NOMBRE NORMALIZADO dentro del ticket (clon EXACTO del `normalize()` del webhook, NO `normalize_ingredient_name` que quita paréntesis); verificado que mismo nombre en un ticket = mismo catalogProductId (0 conflictos).
- **Subsistema de fiabilidad — capas construidas hoy:** (1) `sale_line.unmapped_reason` text + CHECK (`no_brand|no_recipe|no_menu_item|ambiguous|ignored|delisted`|NULL), ortogonal a `map_source`; tipos `database.ts` regenerados. (2) el webhook escribe la razón en ingesta. (3) función `recast_lastapp_sales(p_account_id)` SECURITY DEFINER **CREADA** (replica la cadena del webhook en SQL, idempotente, respeta `manual`/`ignored`/`delisted`), **PENDIENTE DE EJECUTAR**.
- **PENDIENTE INMEDIATO (capa 3, ejecución):** `recast_lastapp_sales` es SECURITY DEFINER → en SQL Editor `auth.uid()` null revienta el guard. Decidir: **A** ejecutar desde la app (sesión válida, botón "Recasar" en la futura pantalla de excepciones) o **B** ajustar el guard para ejecución de servicio. Verificación esperada: ~214 casadas, 56 no_recipe, ~104 no_menu_item, 0 no_brand.
- **DISEÑO COMPLETO del subsistema (aprobado, NO construido) en `docs/folvy_fiabilidad_casado_diseno.md`:** UNA señal de fiabilidad (% ventas sin casar) que se propaga a food cost, inventario y compras. Modelo de 7 estados (golea a tspoon: separa `no_recipe` de `no_menu_item`, propone match IA, estados `ignored`/`delisted`). Cadena de daño MRP II: venta sin casar → no descuenta receta → stock teórico INFLADO → merma fantasma (inventario) + pedidos To-Par/MRP que PIDEN DE MENOS → rotura. Capa de alarma activa (no pasiva): producto nuevo sin receta, % ventas ciegas sobre umbral, inventario con datos sucios, pedido To-Par/MRP sobre stock sucio (proporcional a `pedido.origin`: manual no avisa). Maquetas hechas en sesión. 3 decisiones abiertas: umbral configurable vs fijo; alarma producto-nuevo tiempo real vs cierre de servicio; impacto en € vs % de merma.
- **CHECKPOINT TSPOON:** modelo de estados validado contra captura real de tspoon (pantalla por marca: Productos a la venta / no vinculados / no vinculados ignorados / descatalogados / sin coste actualizado; separa con coste/sin coste/pendiente). El dump `73_ventas_albaranes` resultó ser el flujo B2B del obrador (cocina central facturando a marcas), no el casado de plataforma — útil para el frente de cocina central. Nota lateral (no perseguir): la línea de venta de tspoon trae `codeCustomerProduct` UUID con formato igual a los IDs de Last.app → posible puente determinista tspoon↔Last.app, relevante para migración/Cloudtown.
- **DEUDA SQL (drift):** `recast_lastapp_sales.sql` debe ir a `supabase/migrations/` (hoy suelto en outputs); + los 2 SQL untracked de recepción (`format_price_per_base.sql`, `supplier_format_prices.sql`).

**MÓDULO FOLVY SUPPLY — RECEPCIÓN "QUÉ ENTRA AL ALMACÉN" (07/06, EN PRODUCCIÓN, commit a0e678e). Cierra la deuda de Julio: el que recepciona ve EXACTO qué entra a stock, y el precio reacciona al formato.** Todo en `src/modules/supply/pages/GoodsReceiptForm.tsx` (cero BBDD, cero migración).
- **Panel pre-confirmar extendido:** el `summary` (useMemo) ya calculaba `aStock`/`sinMapear`; ahora desglosa `enterLines[]` (lo que entra: nombre + cantidad en unidad de almacén vía `formatBaseQty` + nota doble columna + coste) y `notEnterLines[]` (lo que no entra + motivo "sin reconocer"/"sin formato"). El `ReviewPanel` pinta dos listas explícitas en vez del recuento agregado. Misma regla que `confirm_goods_receipt` (entra si `recipeItemId && qtyInBaseFromFormat() !== null`).
- **Precio reactivo al formato** (el fallo de confianza que detectó Julio: cambiar de formato no movía el "€ / formato"): helper puro `rescaleCostToFormat(prevCost, prevQtyInBase, nextQtyInBase, refPerBase)`. ESCALADO MATEMÁTICO (decisión de Julio): €/base constante = prevCost/prevQtyInBase (o €/base del proveedor si la línea no tiene precio); coste nuevo = €/base × contenido nuevo. Ej.: bote 200 g a 2,03 € → caja 2,4 kg = 24,36 €. Los descuentos por volumen NO se modelan aquí (van al aviso de precio / precio pactado). Si no hay ancla → vacía (no inventa). Aplicado en `selectFormatOption` y `setFormatQty`.
- **Cantidad en idioma de compras:** bajo "Recibido" sale "N × {formatLabel}" (ej. "12 × Caja (2,4 kg)") y "= {qty×formatQtyInBase} al almacén" (en vivo, ya no se esconde al tocar el formato). Cabecera "Recibido / en su formato". Sin formato → "elige formato ↑" en ámbar.
- **CHECKPOINT TSPOON (fuente empírica, dump `tspoon_dump/71_compras_albaranes.json`, 901 albaranes):** la línea (`listDeliveries`) lleva doble unidad nativa (`quantity`+`unit` a stock; `quantityFormat`+`unitFormat`+`costFormat` el formato) = nuestra arquitectura de 3 capas (ellos plana). `recibido` y `idStore` (ALMACÉN) por línea. NO lleva lote/caducidad (nosotros sí). Albarán = documento propio (`deliveryFor`→pedido), con `costType`/`businessLine` (dimensión contable que no tenemos). Validado que MarketMan/xtraCHEF/MarginEdge tienen gate de verificación pero en idioma de oficina; nadie hace el desglose cocinero "qué entra".
- **DEUDAS DECLARADAS (con disparador):**
  1. `qty_in_base` SERVER-SIDE — hoy la conversión es cliente (`qtyInBaseFromFormat`/`unitConversion.ts`); `confirm_goods_receipt` se fía del valor del navegador. Mover a función SQL. Disparador: endurecer el confirm.
  2. ALMACÉN/UBICACIÓN POR LÍNEA en recepción (tspoon lo hace con `idStore`; cada línea a su zona). Hoy todo a un `location_id`. Disparador: multi-almacén/FEFO. `storage_area` ya existe (inventario capa 1).
  3. RENOMBRAR FORMATOS CONFUSOS ("Uni (200 g)" engaña: parece unidad suelta, es bote) + UNIDADES DE USO AMIGABLES (gestos de cocina, memoria #5). Toca `recipe_item_purchase_format` + varias pantallas. Frente propio con RECON.
  4. AVISO DE PRECIO vs ESCALADO — al escalar el precio por formato, el aviso de precio puede saltar solo por cambiar de formato (posible ruido). Ajuste fino del copiloto si molesta en uso real.
  5. DRIFT SQL — `format_price_per_base.sql` y `supplier_format_prices.sql` untracked en la raíz del repo → decidir si migración versionada en `supabase/migrations/` o descartar (con el saneamiento git ya pendiente).
- **LECCIÓN DE MÉTODO (07/06):** el RECON va SIEMPRE contra fuente primaria (BBDD+repo+dumps), NO contra el guion/CONTEXTO (van por detrás). Hoy un CONTEXTO truncado al arrancar hizo tratar C2.2 (OCR recepción), C3 (factura) e inventario capa 1 como nacientes cuando ya estaban CONSTRUIDOS → el diseño se sobredimensionó y encogió al leer el código real. El gate de Julio ("¿has chequeado tspoon?") lo cazó. Verificar el estado construido ANTES de diseñar.

**MÓDULO FOLVY SUPPLY — INVENTARIO PERPETUO, CAPA 1 COMPLETA (04/06; build verde, NO probado en vivo). El tronco del MRP II: ya se puede hacer inventario de punta a punta (crear→contar a ciegas→cerrar→revisar→aprobar→ajuste real del stock).** Pestaña "Inventario" en Supply (2 sub-pestañas: Áreas | Conteos). Benchmark MarketMan/NetSuite/Zoho/Crunchtime. Sistema de 3 niveles + auditoría transversal (diseño en `docs/folvy_inventario_perpetuo_diseno.md`): N1 saldo vivo (ledger), N2 autoinventario IA diario (capa 3, pendiente), N3 auditoría de cierre (capa 4, pendiente); disciplina de auditoría transversal (blind por defecto, tolerancias ABC, aprobación+motivo, reason codes).
- **C1.1 modelo (commit 3ea7f0b + 191972f-parent; migraciones 20260604T3400/3500):** 4 tablas RLS belongs_to_account: `storage_area` (id, location_id, name, position, active, **parent_id auto-ref OPCIONAL** = jerarquía configurable por cliente, mismo patrón que recipe_family; decisión tras benchmark: el STOCK se valora por LOCAL, el área solo organiza el conteo, NO bins=over-engineering, cocina/almacén central = un location más + traspasos), `recipe_item_storage_area` (artículo↔área, unique), `inventory_count` (code INV- correlativo vía next_inventory_count_code+trigger, kind cycle|audit|full, status abierto|contando|en_revision|aprobado|anulado, blind default true), `inventory_count_line` (system_qty, counted_qty, variance_qty/pct/value€, abc_class A|B|C, within_tolerance, reason_code CHECK merma|caducado|rotura|robo_desconocido|error_escandallo|error_recepcion|traspaso|otro, recount_of). supply_settings + tol_a/b/c_pct (2/3/5).
- **C1.2 áreas (commit 191972f):** `storageAreaService` (CRUD áreas jerarquía opcional + asignación artículo↔área + listInventoryItems filtra type='raw' is_active — NO is_stockable que está a 0). `InventoryPage` pestaña Áreas (crear/renombrar/reordenar flechas/archivar, jerarquía 1 nivel, AssignItemsModal con buscador). Base del shelf-to-sheet.
- **C1.3 motor de conteo (commit c6862cd; migración 20260604T3600):** funciones SECURITY DEFINER `build_inventory_count(count_id, area_ids[], full)` (genera líneas + snapshot system_qty + abc provisional por valor de stock percentil 90/50; alcance por áreas o full; status→contando) y `close_inventory_count(count_id)` (variance_qty/pct/value€ + within_tolerance vs tol ABC; status→en_revision; resumen). `inventoryCountService` + `InventoryCountSheet` (hoja BLIND secuenciada por área —no muestra system_qty al contar, anti-sesgo— + guardado progresivo + vista revisión con system visible/variación/%/€ color/reason_code). Pestaña Conteos + NewCountModal (kind+alcance). Contar en unidad base (g/ml/ud).
- **C1.4 aprobación→ajuste (commit f594279; migración 20260604T3800):** `apply_inventory_count(count_id, user_id, user_name)` SECURITY DEFINER — solo desde en_revision, idempotente; por línea con variación≠0 escribe movimiento `ajuste` (qty_base con signo = counted−system, source_type='inventory_count') en stock_movement + `recompute_location_stock(p_item_id, p_location_id)`; **reason_code OBLIGATORIO fuera de tolerancia** (EXCEPTION aborta si falta, a prueba de fallos en SQL); status→aprobado. Botón "Aprobar y ajustar stock" en revisión, gating rol manager/admin, bloqueado si faltan motivos. CIERRA LA CAPA 1: el conteo corrige el stock real.

**SANEAMIENTO LOCAL OPERATIVO — DEUDA TRANSVERSAL CRÍTICA CERRADA (04/06; commits a89147a + fcbc46c). Ninguna pantalla operativa (inventario, pedido, recepción) tiene ya selector manual de local.** El error de que un cocinero elija local a mano (descontrol grave entre locales) está eliminado. Modelo MIXTO (decidido por Julio + benchmark): el local sale del CONTEXTO, no de selección manual.
- **3 ficheros nuevos:** `operativeLocationService.resolveOperativeLocation(_accountId, employeeId)` (cascada: fichaje activo clock_entries.location_id_at_clock → user_profiles.employee_id → employees.location_id + assigned_locations; _accountId prefijado por no usado, reservado RLS futuro). `useOperativeLocation` hook (cascada con degradado POR ROL: fichaje→perfil→gerente; gerente usa activeLocationId del header si ≠'all', o elige; worker sin local resuelto BLOQUEA; devuelve operativeLocationId, source, isResolved, blocker, canChoose, chooseOptions, setManualLocation). `OperativeLocationBanner` (aviso "Estás en: X" en acciones de riesgo; selector solo-gerente si no resuelve; bloqueo worker).
- **3 pantallas corregidas:** InventoryPage, SupplyOrderBuilder (pedido), GoodsReceiptForm (recepción — local fijo desde hook salvo fixedHeader de documento OCR/corrección; banner solo si !fixedHeader). Quitados todos los `<select>` de local.
- **DEUDA: fichaje NO probado en vivo** (clock_entries VACÍA, n=0 — la cascada N1 del local operativo está cableada pero no verificada; hoy resuelve por local del empleado / elección de gerente). Verificar cuando haya fichajes reales.

**MÓDULO FOLVY SUPPLY — C3 FACTURA + THREE-WAY MATCH: COMPLETO Y EN PRODUCCIÓN (04/06; build verde, NO probado en vivo aún). Cierra el ciclo de compra: pedido→recepción→FACTURA. Iguala a R365 en AP y lo SUPERA en el eslabón al margen del plato (nadie lo tiene).**
Pestaña "Facturas" en Folvy Supply. Tablas nuevas: `supplier_invoice` (cabecera; doc_kind invoice|credit_note para abonos; code FAC- correlativo; status borrador/en_revision/aprobada/con_discrepancias/pagada/anulada; match_status; source manual|ocr; ai_session_id; approved_at/by/by_name para audit; corrects_invoice_id), `supplier_invoice_line` (recipe_item_id, raw_text, supplier_code, qty, unit_price, line_amount, vat_pct, vat_category_id, goods_receipt_line_id, match_result, match_detail jsonb), `supplier_invoice_receipt` (N:M factura↔albaranes), `invoice_approval_rule` (reglas de aprobación). Funciones: `next_supplier_invoice_code`, `run_invoice_match`, `apply_invoice_costs`, `invoice_required_role`, `current_user_can_approve_invoice` (todas en migraciones 20260604T2600/2800/3000/3200).
- **C3.1 (commit 1325e38):** modelo + servicio `supplierInvoiceService` + pestaña Facturas con alta manual + abonos/notas de crédito desde el día 1 + código FAC-.
- **C3.2 (commit 349f003):** OCR de factura — REUTILIZA `scanReceipt`/`ocr-albaran` (la Edge Function ya detecta facturas, NO se duplicó). `resolveInvoiceHeader` (proveedor por NIF + sugiere albaranes sin facturar del proveedor), `InvoiceScanPanel`, anti-duplicado por nº factura. Prerellena el alta editable.
- **C3.3 (commit bc96c68):** motor three-way `run_invoice_match(invoice_id)` (SECURITY DEFINER, idempotente, se prueba DESDE LA APP) — por línea cruza precio (vs unit_cost albarán, umbral supply_settings), cantidad (vs qty_received agregado por artículo), no_recibido, IVA (vs `vat_rate_for(categoría, invoice_date)` del motor fiscal). Veredictos: ok|diferencia_precio|diferencia_cantidad|no_recibido|iva_no_cuadra|sin_casar. Pantalla de revisión (clic en factura→detalle) con chips + detalle "facturado X vs albarán Y" + botones Cuadrar/Aprobar/Marcar discrepancia. Aprobar registra audit (quién/cuándo).
- **C3.4 (commit 55dea82):** eslabón coste `apply_invoice_costs(invoice_id)` — al aprobar, escribe last_price=precio facturado (upsert por recipe_item_id+supplier_id) → dispara trg_article_supplier_recompute_cost → kitchen_recompute_raw_cost → cascada a platos. Devuelve IMPACTO por ingrediente (coste/precio antes vs después + Δ%). Panel "Impacto en coste" en la UI. NO mueve stock (lo hizo la recepción). DIFERENCIAL: factura conectada al margen del plato.
- **C3.5 (commit 6b7bf42):** enrutado de aprobación `invoice_approval_rule` (importe/proveedor/local → rol requerido admin|manager, por prioridad) + funciones `invoice_required_role` / `current_user_can_approve_invoice` (reutilizan current_user_is_admin_of / _admin_or_manager_of). Gating en `approveInvoice` + botón Aprobar deshabilitado con motivo + panel "Reglas de aprobación" (engranaje). Default sin reglas: manager o admin aprueban (no rompe nada).
- **PENDIENTE: probar C3 en vivo** (escaneo factura, three-way, impacto coste — solo compilado, nunca ejecutado). **Benchmark R365** anotado: igualado en AP (OCR+3way+aprobación+audit+abonos), superado en eslabón al margen + IVA por fecha (normativa ES) + UI para cocinero. Docs: `docs/folvy_c3*_*.md`.

**MÓDULO FOLVY SUPPLY — C2.2 OCR DE RECEPCIÓN: COMPLETO Y EN PRODUCCIÓN (04/06, de punta a punta). La grieta del mercado (memoria por proveedor) que NO tienen xtraCHEF/MarketMan.**
Cadena completa del albarán escaneado: escanear (foto cámara directa en móvil/PDF) → leer+validar → materializar borrador → casar líneas con memoria → crear al vuelo (IA sugiere) → aprender al confirmar → resolver intermediarios → avisar de duplicados.
- **a-1 LEE + VALIDA (migración 20260604T1600):** bucket privado `receipt-uploads` (jpeg/png/webp/pdf, 10MB, RLS por cuenta) + tabla `goods_receipt_ai_session` (lo leído + validación). Edge Function `ocr-albaran` (VISIÓN, clon de extract-recipe, modelo oculto vía env VISION_MODEL=claude-opus-4-8, deploy NORMAL no webhook). Extrae cabecera + líneas (raw_text, supplier_code, qty, unit_price_net, descuento, lote, caducidad) + impuestos; VALIDA por BASE IMPONIBLE (Σlíneas≈base, tolerancia 1%), detecta manuscrito y baja confianza. UI `ReceiptScanPanel`: captura por dispositivo (móvil cámara directa `capture` + archivo; PC foto/PDF), visor del albarán (PC paralelo con zoom+páginas; móvil lightbox), compresión en cliente (1600px). PROBADO E2E (Europastry, Coheldi descuentos, Makro multipágina, Nobleza manuscrito).
- **a-2 MATERIALIZA (migración 20260604T1800):** `goods_receipt.delivered_by` (entregado por, trazabilidad) + `ai_session_id`. `resolveReceiptHeader`: proveedor = EMISOR por NIF→nombre (NO se adivina intermediario), local por DIRECCIÓN (los nombres del albarán no coinciden con los de Folvy: "Costa Verde"=Plaza Castilla en Cañaveral 75). Botón "Crear recepción desde esto" → abre `GoodsReceiptForm` en 4º modo OCR (cabecera propuesta editable, líneas con cantidad PRECARGADA —excepción consciente al blind-receiving: el albarán ya tiene la cantidad—, source='ocr').
- **b.1 CASA LÍNEAS CON MEMORIA:** reutiliza la RPC `run_mapping` (cascada: CÓDIGO de proveedor vs article_supplier.supplier_code → nombre exacto → normalizado → difuso trigram; devuelve confianza+semáforo+match_type), filtrada a `target_types=['raw']`. `matchReceiptLine`. Verde único → preseleccionado. `LineMatchPicker` (modal: candidatos + buscador manual). HALLAZGO RECON: NO se reutiliza `confirm_mapping` (su aprendizaje escribe en sale_line/menu_item = VENTAS); compras tiene su aprendizaje propio.
- **b.2 CREATE-ON-SCAN:** crear artículo (`quickCreateRawItem`: type='raw', source='ocr_invoice', needs_review; unidad base de las 3 globales) desde el picker y proveedor (`quickCreateSupplier`: nombre+NIF) desde la cabecera, sin salir de la recepción. Familias vía `listSupplyFamilies` (tabla `recipe_family`).
- **b.3 APRENDE AL CONFIRMAR (migración 20260604T2200):** `goods_receipt_line.supplier_code` + función `learn_from_receipt` (SECURITY DEFINER): upsert en `article_supplier` (clave recipe_item_id+supplier_id) de supplier_code + `supplier_item_name` (DENOMINACIÓN del proveedor, nueva col, idea de Julio — estándar Apicbase/MarketMan) + last_price + formato. La próxima factura casa por código sola. NO toca coste (ya lo hace el ledger C2).
- **b.4 MEMORIA DE INTERMEDIARIO (migración 20260604T2300):** tabla `supplier_alias` (emitter_norm/nif → supplier_id comercial + delivered_by). `learn_supplier_alias` (SECURITY DEFINER): si el emisor del albarán difiere del proveedor elegido, recuerda el alias. `resolveReceiptHeader` lo lee antes de casar. CIERRA EL CASO CLOUDTOWN: Joan/Bidfood entregan EN NOMBRE DE Cloudtown (proveedor comercial real, a quien Llorente29 paga; stock es de Llorente29); 1ª vez eliges Cloudtown → se aprende → 2ª vez propone Cloudtown + "entregado por Joan" solo.
- **b.5 ANTI-DUPLICADO:** `findDuplicateReceipt` (mismo proveedor + mismo nº albarán, no anulado) → aviso al materializar (no bloqueo). + botón "Casar artículo" subido de rango (era enlace sutil, ahora botón azul visible).
- **b.6 COPILOTO DE ALTA (IA):** Edge Function `suggest-item` (TEXTO, no visión; deploy normal). Al crear artículo, sugiere nombre limpio ("METRO Chef queso grana padano DOP…"→"Queso grana padano"), familia (SOLO de la lista real de la cuenta, id exacto o null si duda — anti-invención) y unidad base. `suggestItemAttributes`. Prerellena editable con "✨ sugerido"; degrada limpio si la IA falla. UNIDADES BASE GLOBALES (account_id null): ud `869711c3-eabd-4e95-92f2-555efaaba6b0`, g `8fc3baae-04cc-4b2c-83cc-7fa0181e74e4`, ml `953c626f-146b-484f-b3f5-47c42eeacc0e`.
- **Commits:** cde225b/2a46e88 (a-1), c532aa9/987668e (a-2), 7faede0 (b.1), e08daaf (b.3), f4254df (b.2), 58c0f00 (b.4), 198bc10 (b.5), 329336e (b.6). Docs en `docs/folvy_c2.2_*`. DEUDA LIMPIEZA: borrar recepciones de prueba ALB-00001…00008 (confirmadas sin postear stock) + sesiones IA con goods_receipt_id null (pruebas a-1). NO PROBADO EN VIVO aún por Julio: el bucle de memoria (confirmar→reescanear→verde por código) y el copiloto de alta.

**MÓDULO FOLVY SUPPLY — C2 RECEPCIÓN DE ALBARÁN + LIBRO MAYOR DE STOCK (04/06, EN PRODUCCIÓN, ciclo cerrado):**
- **Estructura (migración 20260604T1000):** `goods_receipt` (cabecera: local NOT NULL, proveedor, pedido nullable=recepción ciega, code ALB-00001 correlativo, supplier_doc_number, status borrador/confirmado/anulado, source manual/ocr, needs_review), `goods_receipt_line` (qty_received, purchase_format_id, qty_in_base nullable, unit_cost, lot_code/expiry_date=ganchos FEFO, map_source/map_needs_review), `stock_movement` (EL LEDGER append-only: qty_base con signo, unit_cost SELLADO por movimiento, source polimórfico), `recipe_item_location_stock` (snapshot WAC: qty_on_hand, avg_unit_cost, stock_value).
- **Valoración WAC perpetuo append-only:** valor = SUM(qty_base × unit_cost) con signo, reconstruible y exacto. LIFO descartado (ilegal ES). FEFO/lote NO se descartan (ganchos desde día 1). Escandallo (last_price) y WAC (inventario) = dos lentes deliberadas (AvT).
- **Lógica ledger (migración 20260604T1200, SECURITY DEFINER, se prueban DESDE LA APP):** `confirm_goods_receipt` (postea entradas; ANTI-INVENCIÓN: solo líneas con item+qty_in_base resueltos; needs_review no postea; actualiza last_price→trigger recalcula raw), `void_goods_receipt` (reverso append-only), `recompute_location_stock` (snapshot). En el servicio, tras confirmar, `cascadeFromItem` propaga coste RAW→platos→menu_item_economics (margen).
- **Auto-estado del pedido (migración 20260604T1400):** `recompute_purchase_order_status` se llama en confirm/void → el pedido pasa SOLO a recibido / recibido_parcial / enviado según recibido acumulado vs pedido. NO toca terminales (borrador/cancelado/cerrado). Manual de último recurso en el detalle: Cancelar (sin recepciones confirmadas) / Cerrar-no-se-completará (recibido_parcial).
- **Anular y corregir:** en una recepción confirmada, además de Anular (reverso), Anular y corregir = abre un borrador precargado con sus líneas; la original se anula SOLO al confirmar la corregida (orden seguro: 1º crea+confirma nueva, 2º anula vieja). Hereda purchase_order_id.
- **Recepción ANTI-ERROR (blind receiving, benchmark confirmation-bias):** la celda "Recibido" NACE VACÍA SIEMPRE (no precarga); Pedido/Ya recibido/Pendiente como referencia gris (pendiente = max(0, pedido−ya recibido), vía `listOrderLineReceived`). Botón "Rellenar con lo pendiente" opt-in. RESUMEN antes de confirmar SIEMPRE en lenguaje llano (frases con nombre de producto y cantidades, no contadores abstractos); 2º clic REFORZADO solo si anomalía (de más: detalla cuánto vs pendiente y vs pedido; o masa sin tocar >30% y >3 líneas). "De menos" se informa, no frena.
- **UI:** módulo Supply con pestaña Recepciones (`GoodsReceiptsPage`; `GoodsReceiptForm` 3 modos contra-pedido/corregir/ciego; `SupplyOrderDetailPage` Registrar recepción + cancelar/cerrar). `goodsReceiptService.ts`. Commits f96d049 (C2.1), 02cb815 (cierre), 844c71c (fix anular-corregir+toast), fc74fa5 (anti-error), 97d25cf/9f4a09e (resumen detallado + lenguaje llano). PROBADO E2E.

**MÓDULO FOLVY SUPPLY — PEDIDO REDISEÑADO Y COMPLETO (03/06, en producción):**
- **Rediseño del pedido sobre el catálogo del proveedor** (commit 1e52bb5+): el pedido NO se teclea a mano — eliges proveedor → carga su catálogo (`article_supplier` → formato + last_price + supplier_code) → pones cantidades. `supplierCatalogService.getSupplierCatalog`. `SupplyOrderBuilder` (flujo A: proveedor→catálogo→guardar; solo filas con cantidad>0 entran). Precio del sistema (no a mano), no se muestra en el builder (sí en PDF).
- **Formato legible** (3780532): "Saco (5 kg)" en vez de "Saco (5000)" — el catálogo trae la unidad base del artículo y escala g→kg, ml→L. "Enviado por" precargado con el usuario.
- **Arquitectura MULTI-LOCAL** (de5e63a, RECTORA): la ubicación es la unidad operativa base. El pedido pertenece a un local (`purchase_order.location_id`); el builder OBLIGA a elegir local; la dirección de entrega sale de `locations.address`. Selector de local en builder (`listSupplyLocations`). Folvy Interno tiene 3 locales (Foodint Alcalá/Carabanchel/Plaza Castilla). Consolidación por cuenta = capa de lectura futura.
- **Número de pedido** (SQL `purchase_order_code.sql`): `next_purchase_order_code` + trigger `trg_set_purchase_order_code` → `PED-00001` correlativo por cuenta (imita el patrón `folvy_code`, que es solo de recipe_item). Pedidos existentes renumerados.
- **Detalle del pedido** (472ef9f): muestra nº, local de entrega + dirección, proveedor, fechas, líneas, total. Botón "Marcar como enviado".
- **PDF del pedido** (1693a52, `purchaseOrderPdf.ts`, jsPDF): cabecera datos fiscales cliente (de accounts) + nº/fechas, bloques "Proveedor" + "Entregar en" (local), tabla líneas con formato e IVA por línea, DESGLOSE DE IVA POR TIPO (base+cuota, resuelto por fecha del pedido vía `vat_rate_for`), total, enviado-por, pie con cuña **"Folvy · folvy.app" CLICABLE** (textWithLink). Hueco de LOGO reservado (deuda). Botón "Descargar PDF" en el detalle. DECISIÓN: descargar = consulta, NO cambia estado; enviar de verdad o marcar a mano = enviado.

**MOTOR DE IVA versionado por fecha + propuesta automática ("mejora invisible", 03/06, en producción):**
- **Problema resuelto:** el gobierno cambia los IVAs de alimentos con frecuencia (el aceite pasó 10→5→0→2→4% en 24 meses). Un vat fijo por artículo obligaría a editar cientos a mano.
- **Modelo (commit 7ca4a8a, `vat_model.sql`):** `vat_category` (5 categorías globales: alimento_basico, aceite_oliva, alimento_general, bebida_alcoholica, no_alimentario) + `vat_rate` (tipos VERSIONADOS por valid_from/valid_to: cambio del BOE = 1 fila, hereda toda la categoría; resuelve por fecha del documento → valida facturas OCR antiguas) + `family_vat_default` (mapeo familia AECOC→categoría, por NOMBRE para servir a cualquier cuenta) + `recipe_item.vat_category_id`/`vat_category_source` (proposed|confirmed). Catálogo GLOBAL (los tipos los fija el Estado; Folvy los mantiene una vez para todos).
- **Funciones:** `vat_rate_for(cat, fecha)` (tipo vigente) + `propose_vat_category(item)` (propone según familia). **Trigger `trg_propose_vat_on_family`** (`vat_propose_trigger.sql`): al asignar/cambiar familia por CUALQUIER vía (UI, IA, importación, semilla), propone el IVA solo. Sembrado: tipos 2025 (4/10/21% + recargo equivalencia) + histórico aceite 2024. Aplicado a 157 artículos.
- **UI de revisión** (commit 4c37bf9, `vatService` + `ItemVatSelector` en la ficha del ingrediente): muestra categoría fiscal con su % vigente, marca propuesto/confirmado, permite confirmar o cambiar (reclasificar mixtos como el aceite). Cierra el ciclo IA-propone-humano-confirma del IVA.
- **Conecta con OCR (paso 4/C3):** cuando llegue factura por OCR, Folvy tiene el IVA esperado por artículo+fecha → chequea contra el de la factura, marca needs_review si no cuadra.

**CATÁLOGO DE MARCA Fase A — COMPLETO Y EN PRODUCCIÓN (05/06; 8 tablas + importador + pantalla Menú).** Benchmark Otter + Supy/R365.
- **Esquema Fase A + A6 (commits 8716f9c, 47eb640):** 8 tablas: `menu_category`, `menu_item_override` (variante canal×marca), `modifier_group`, `modifier_option`, `modifier_group_assignment`, `modifier_recipe_impact`, `combo_slot`, `combo_slot_option`. `menu_item` ampliado (product_type, external_id; channel_id+recipe_item_id NULLABLE). `sale_line` normalizada. RLS + idempotencia. Modelo: menu_item = verdad de MARCA, canal = variante en override. Combo sin escandallo propio, coste = Σslots.
- **Importador Last.app (commit ae855fa):** Edge Function `lastapp-catalog-import` (auth dual, `--no-verify-jwt`). Trae catálogo comercial "en uso": locations→brands→catalogs.default (filtra vacías + canal informes) cruzado con GET org catalog. Marca por nombre + BRAND_ALIAS. Idempotente por external_id. NO crea recipe_items ni costes. Componentes de combo entran como productos. Real Llorente29: 151 productos, 17 combos, 43 grupos modificadores, 9 marcas. Tabla rasa total previa (datos eran de prueba).
- **Pantalla Menú (commit 9ace0e7):** `KitchenMenuPage` + `brandCatalogService`, ruta 'menu'. Carta de marca READ-ONLY: selector de marca, KPI cobertura escandallo (0% = onboarding, fórmula: items con recipe_item_id / total items), categorías + productos con estado escandallo, combos expandibles (muestra slots y opciones).
- **PENDIENTE Fase B:** reordenar drag&drop, CRUD catálogo, variantes canal×ubicación, modifier_recipe_impact, push a canales. **Fase C:** dashboard menu engineering, sync catalog:updated + alarmas. **Fotos:** el importador Last.app NO las trae. Investigar endpoint o subir manual.

**FICHA DE PRODUCTO B1 — CatalogProductDetailPage (05/06, commit 9b0abdf, en producción):**
- Detalle de producto navegable con **índice sticky lateral** + **secciones apiladas** (decisión UX basada en Baymard: tabs horizontales esconden contenido; índice pegajoso da overview + atajos, como Otter). Ruta: menu → producto → ficha.
- **Secciones:** Datos (editable: nombre, descripción, categoría, foto), Precios (contenedor para E2), Modificadores (lectura de grupos asignados), Disponibilidad (contenedor para toggles canal), Avanzado (contenedor para kitchen_name, fotos, dietéticos). Las tres últimas son contenedores "próximamente" honestos.
- **Crece con:** E2 (cascada margen en Precios), overrides por canal/local (Disponibilidad), datos extendidos (Avanzado).

**ECONOMÍA DE CANAL E1 — COMISIONES (05/06, commits efd8f5e + 6c52f54 + 7a3b0db, en producción, NO VERIFICADO EN VIVO):**
- **Documento de diseño:** `docs/folvy_economia_canal_promociones_diseno_2026-06-05.md` — modelo completo de margen (3 niveles), IVAs, conector multi-broker, gestor de campañas Ómnibus, 10 fases.
- **E1 datos (migración 20260605T0300):** tabla `channel_rate` (defecto por canal: channel_id + commission_pct + service_type delivery|pickup|dine_in; RLS belongs_to_account) + función `menu_item_economics(p_menu_item_id)` con fallback por especificidad (override marca×canal `menu_item_override.commission_pct` > defecto canal `channel_rate.commission_pct` > NULL). Devuelve PVP, food_cost, gross_margin, commission_pct/amount, delivery_fee, own_courier_cost, net_margin. `database.ts` regenerado.
- **E1 UI (commit 6c52f54):** zona **Ajustes** en sidebar de Folvy Kitchen + `channelRateService` (CRUD channel_rate) + `KitchenSettingsPage`. Configura comisión % por canal (Glovo 15%, JustEat 15%, Uber variable) y tipo de servicio.
- **DECISIONES CLAVE:**
  - **Catcher = broker de reparto propio (last-mile), NO agregador de comisiones.** Da coste REAL de transporte por pedido (~6,30€/pedido Llorente29: 5,38€ rider + 0,96€ comisión Catcher), cruzable con ventas por order_code. NO da comisión de plataforma (config manual).
  - **JELP = segundo broker** → conector de transporte MULTI-BROKER (capa genérica, adaptadores Catcher/JELP), como el de TPV.
  - **Margen en 3 niveles:** (1) unitario para fijar PVP, (2) real por pedido a posteriori, (3) rentabilidad de canal por periodo. Ads NUNCA al coste unitario (inventar) → solo nivel 3. Promos: simulan para PVP, miden reales (sale.discount_amount) para margen.
  - **Ley Ómnibus (descubrimiento clave):** precio promocionado = mínimo de 30 días. Glovo ya bloquea promos ilegales. Precio "pegajoso" → empuja foco al margen = tesis Folvy. Técnica del artículo-espejo (Patatas Clásicas / Patatas Clásicas 1): mismo escandallo, dos menu_item, activar/desactivar por campaña. NADIE en el mercado cierra este bucle (verificado: MarginEdge/R365/Apicbase/Livelytics solo a posteriori).
  - **IVA heterogéneo (vigilar mucho):** comida 10%, bebida alcohólica/azucarada 21%, transporte 21%. Bases homogéneas, nunca mezclar base con total. Motor de IVA versionado por fecha ya existe.
- **PENDIENTE E1:** verificar en vivo (arrancar app → Kitchen → Ajustes → configurar Glovo → abrir ficha producto Glovo y comprobar fallback margen). `brand_channel` sigue VACÍO — necesario para overrides por marca (caso Uber variable).

**Lo previo sigue vigente** (familias AECOC, monitorización ingesta 2+3, Folvy Connect/Glovo, motor coste real Kitchen, etc.) — ver historial más abajo.

### 1.2 — INTEGRADORES (evaluación cerrada)
Last.app (525€/mes, a sustituir), HubRise (segunda fila), KitchenHub/Otter/Deliverect (descartados). Folvy = integrador directo.

### 1.3 — DEUDA VIVA / FRENTES (por prioridad)
0. **🔴 RECEPCIÓN USABLE Y FIABLE — FRENTE PRIORITARIO (validado en uso real 09/06).** El flujo de recepción de albaranes no da seguridad en la práctica. RECON hecho (`GoodsReceiptForm` ya tiene formato manual, conversión, blind-receiving y resumen pre-confirmación; el problema es el CONJUNTO). Tres huecos JUNTOS: (1) conversión de formatos robusta y clara; (2) foto del albarán visible junto a la tabla al editar (gol vs tspoon, que no la muestra); (3) bloqueo de confirmación si Σlíneas ≠ total del albarán (gol vs tspoon, que solo avisa). Benchmark tspoon iniciado (3 capturas); FALTA el profundo: dump `tspoon_dump/` + R365/MarketMan/xtraCHEF. **REDISEÑO HECHO la noche del 09/06 (espejo del albarán + árbol `ensurePackTree` + tarjeta con jerarquía + foto del albarán a la izquierda; commits 5230ff4..62a225e, build verde). PENDIENTE validar con varios albaranes (Julio, 10/06) → si cuadra, a HECHO; si no, ajustar.** Segundo frente acoplado: navegabilidad/uso móvil del trabajador (foto no visible en móvil = deuda responsive; recepción fuera del portal del trabajador; permisos por decidir; idea: portal en dos bloques personal/procesos).
1. **🔴 OVERRIDES — PRECIO POR CANAL CON MARGEN REAL (frente activo, SQL-first).** Reescribir el motor de margen para que por producto dé una fila **por canal** con precio del override (‖ base) y comisión del canal, leyendo `menu_item_override` (hoy `menu_item_economics` no lo lee y exige `channel_id` no nulo → no devuelve nada). Después: servicio de overrides (set/clear precio + disponibilidad por canal/local), modal "Editar precios" (defecto + por canal) con margen real al teclear desde el motor nuevo, agotar/86, poner/quitar local; **jubilar el cálculo cliente** de la ficha (una sola verdad). RECON al arrancar: ¿`channel_rate`/`brand_channel_rate` poblados? ¿hay overrides ya? Cautelas SECURITY DEFINER (no probar en SQL Editor; verificar desde la app; regen `database.ts` si cambia firma). Cubre mañana sala/terraza/barra (canales 'dine_in') sin reescribir.
2. **VERIFICAR E1 EN VIVO + E2 CASCADA MARGEN (pendiente 05/06).** E1 (comisiones channel_rate + menu_item_economics) compilado pero nunca ejecutado. Verificar: Kitchen → Ajustes → configurar Glovo → ficha producto → comprobar fallback. Luego **E2: cascada margen visible en ficha** (sección Precios): PVP − escandallo − comisión − transporte (configurable, marcado estimación) = margen. Toggle por concepto. `menu_item_economics` ya devuelve los componentes; falta presentarlos + restar transporte del net_margin (pieza que evita vender a pérdida). **brand_channel sigue VACÍO:** poblar para overrides por marca (Uber variable). Sub-paso de E1 o E2.
   - **CATÁLOGO Fase B — el sub-punto está CONSTRUIDO (18/06, ver §1 bloque 18/06 B):** crear/organizar/reordenar/plegar/borrar + ficha-cockpit (producto en varias marcas + categoría). Queda pendiente: push a canales (Publicador de Catálogo, diseñado), variantes canal×ubicación (= frente Overrides, ítem 1), `modifier_recipe_impact` (= frente Modificadores/Combos). Las fotos siguen sin venir del importador de Last.
3. **MÓDULO SUPPLY — C2 RECEPCIÓN + C2.2 OCR + C3 FACTURA: COMPLETOS Y EN PRODUCCIÓN (04/06).** El ciclo de compra (pedido→recepción→factura) está cerrado de punta a punta. C2.2.c (avisos de precio/caducidad) HECHO. C3.1–C3.5 HECHO. Ya NO son frente. **PENDIENTE: probar C3 en vivo** (escaneo factura, three-way, impacto coste — solo compilado).
   - **DEUDA IMPORTANTE — RECEPCIÓN DESDE PORTAL DEL TRABAJADOR (NO construida):** hoy el módulo Supply está gateado a rol `manager` (`requiredRole:'manager'` en module.tsx). Un manager puede recibir desde su móvil (responsive + cámara directa ya funcionan), pero un trabajador NO entra al módulo. Falta: (a) recibir desde el PORTAL DEL TRABAJADOR (no solo manager) → deja la recepción en borrador → la oficina valida y confirma; (b) CÁMARA integrada en el flujo de recepción (foto en el momento de recibir, no antes); (c) roles y circuito de validación. POR QUÉ IMPORTA: quien recibe en una cocina es el personal de turno, no el manager; sin esto la recepción se retrasa o se hace de memoria. Disparador: antes de producción. Benchmark R365/MarketMan. Documentado en Folvy_Supply_modulo.docx §7.
   - **INTEGRACIÓN B2B PROVEEDORES (EDI) — frente de NEGOCIO, no de código** (investigado 04/06): ciclo completo posible vía EDIFACT/GS1 — PRICAT (catálogo+precios), ORDERS/ORDRSP (pedido+confirmación), DESADV (albarán con lotes/caducidades), INVOIC (factura). Makro lo tiene; va por INTEGRADOR (EDICOM/Seres/nexmart/Conecta EDI) o parser EDIFACT, con ALTA y MAPA por cada pareja emisor-receptor y por documento. CIFRAS REALES: ~4.000€/interfaz (≈12.000€ por ORDERS+DESADV+INVOIC) en asequibles, 4-8.000€/interfaz y 20-30.000€ proyecto medio en EDICOM, meses de implantación, + recurrente por documento; los grandes ignoran pymes. CONCLUSIÓN: inviable pedírselo a un restaurante; el OCR (hecho) cubre el 90% del valor sin coste. VISIÓN A FUTURO (diferenciador brutal): que FOLVY MISMO sea el agregador EDI — integra Makro/Bidfood UNA VEZ y lo revende a toda su base repartiendo coste. Decisión estratégica con masa de clientes, no tramo de código. La factura EDI (INVOIC) es obligatoria en GSA; PRICAT+ORDERS a confirmar con Makro. Enchufa como FUENTE de la misma recepción/catálogo sin reescribir (arquitectura MRP II por capas).
   - **Frentes futuros de C3:** tesorería/vencimientos/conciliación bancaria; enforcement DURO de aprobación por trigger/RLS (hoy el gating es UX+función, no bloquea a nivel BBDD); notificación al aprobador requerido (campana); factura que CREA recepción implícita (compra directa sin albarán); EDI INVOIC como fuente alternativa al OCR.
   - Previos vigentes: **FEFO + trazabilidad de lote** (ganchos lot_code/expiry ya existen; al construir inventario/consumo); **APPCC en recepción** (temperatura/estado/rechazo de línea; obligación legal); **LOCAL ACTIVO de sesión** (DEUDA: location_id operativo del contexto sesión/dispositivo, no selector manual; ninguna pantalla nueva añade selector manual; disparador: antes de producción).
4. **INVENTARIO PERPETUO — CAPA 1 COMPLETA (04/06).** 1.1 modelo + 1.2 áreas + 1.3 motor de conteo + 1.4 aprobación→ajuste. Ya se puede hacer inventario de punta a punta y corrige el stock real. Ya NO es frente. **PENDIENTE probar en vivo.** SIGUIENTE en el tronco MRP II: **CAPA 2 — CONSUMO por ventas×escandallo** (la SALIDA del ledger: cada venta descuenta ingredientes según escandallo → habilita el **AvT real** teórico vs real, corazón del control de coste). Luego CAPA 3 (autoinventario IA), CAPA 4 (auditoría cierre + AvT período), CAPA 5 (FEFO + portal trabajador). Orden de dependencia: 2→3→4→5.
5. **ENVÍO del pedido al proveedor: email (Resend) + WhatsApp** (lo más usado en hostelería ES; abrir wa.me con resumen). DECISIÓN: enviar de verdad marca el pedido como "enviado" (descargar PDF no). PENDIENTE.
6. **AUTOINVENTARIO con IA = CAPA 3 (IDEA OBLIGATORIA Julio; base lista tras capa 1).** Cycle counting hostelero — contar 3-5 productos/día, la IA selecciona QUÉ (valor/riesgo/rotación/anomalías=ABC) y QUIÉN cuenta (no siempre el mismo/no su zona); diferencias se analizan y comunican solas. EXTENSIÓN: en productos de alto valor del escandallo, comparar contra escandallo (¿escandallo mal? ¿merma proceso? ¿robo?) y calcular EFECTO ECONÓMICO en €. Nadie en hostelería cierra este bucle. ES MÁS QUE CONTAR — no diluir. Necesita la capa 2 (consumo) para el dato de rotación/anomalía. El motor de conteo (1.3) y el ajuste (1.4) ya están: la capa 3 elige qué/quién y comunica encima de ellos.
7. **WEB pública folvy.app** (DECISIÓN 03/06): reorientar a VENDER (beneficios para el hostelero, no módulos; CTA demo/consulta; navegable). NO autoactualizar con módulos (descartado: la web vende, no documenta; los beneficios envejecen despacio). El roadmap activo/pendiente vive en el mapa interno (folvy_mapa_global), NO en la web pública (a cliente le siembra dudas; a inversor sí se le enseña).
8. **GLOVO G1** (recepción real): BLOQUEADO esperando acceso al stage (ticket INTSUPPO-1382). RPC `menu_item_economics` (EP1) cerrable. Catcher I3 (credenciales de pruebas disponibles). Zona "Ajustes" Kitchen HECHA (KitchenSettingsPage, commit 6c52f54).
9. Seguridad: rotar service_role/webhook tokens (Last `247ef137-...`). Code-splitting (~727KB gzip, sigue creciendo). 34 platos needs_review. Medidor coste IA por cuenta. **Fichaje sin probar en vivo** (clock_entries vacía → cascada N1 del local operativo no verificada).
10. **DEUDAS NUEVAS (09/06):** `format_price_per_base.sql` y `supplier_format_prices.sql` sueltos en la RAÍZ del repo (drift → mover a `supabase/migrations/`); mensaje rojo feo "revisa el mapeo" en combos (pulir); scripts `recast-sales.mjs`/`check-reliability.mjs` comparan contra números hardcodeados del 08/06 (pre-canónico) → disparan ⚠️ FALSAS, actualizar a valores canónicos actuales (recast 329 casadas / 20 no_recipe / 0 no_menu_item; reliability 95,02% / 5.979,40€ casado / 6.293€ total / 313,60€ no_recipe).
11. **DEUDAS NUEVAS (18/06) — VERSIONADO Y DRIFT:** versionar en `supabase/migrations/` el SQL de HubRise (`adapt_hubrise_order`, `close_sale`, `cancel_sale` + migración HubRise); `www.folvy.app` sigue NXDOMAIN; añadir `catalog_source` ('folvy'|'pos') a `brand` en CP2; **OBLIGATORIOS A-C del 12/06 siguen abiertos** (A acceso-trabajador-reentrada PIN; B PWA botón instalar directo en Android; C masivo no cierra `needs_review` por `review_notes != null`).

### 1.3.HALLAZGOS técnicos (vigentes)
- **RECON DE ÁREA** antes de diseñar. **SQL Editor solo devuelve la salida de la ÚLTIMA consulta → una consulta por turno.**
- **Número de documento:** el sistema `folvy_code`/`next_folvy_code`/`set_folvy_code` es SOLO de `recipe_item`. Para otras tablas (pedido) hay que replicar el patrón (prefijo+correlativo+LPAD+trigger), no reutilizarlo.
- **Patrón de módulo nuevo:** `src/modules/<id>/module.tsx` + línea en `moduleRegistry.ts`. Cuidado con el CASING de carpeta en Windows.
- **PDF:** jsPDF 4.2.1 (`import jsPDF from "jspdf"`, `new jsPDF({orientation,unit:"mm",format:"a4"})`, `textWithLink` para enlaces, `doc.output("blob")`). Patrón calcado de APPCC.
- **Edición de ficheros con script:** cuidado con caracteres zero-width al insertar (un className roto rompió un build hoy). Verificar tras editar.
- **Webhooks externos** deploy `--no-verify-jwt`. **database.ts:** `gen types --yes` + UTF-8 sin BOM tras cada cambio de esquema. **PELIGRO (04/06): `gen types > database.ts` directo VACIÓ el fichero cuando la CLI no devolvió nada (rompió toda la app, 16 errores "no exported member Database"). MÉTODO SEGURO: regenerar a `database.new.ts` con `2> gen_error.txt`, verificar nº de líneas (~9600) y que no hay error, y SOLO entonces mover al sitio bueno (UTF-8 sin BOM) + borrar temporales. Si se vacía: `git checkout HEAD -- src/types/database.ts` lo recupera.** Las FUNCIONES nuevas también entran en los tipos → regenerar tras crear cualquier función (RPC) o el servicio da TS2345.
- **RPC con parámetros opcionales:** el tipo generado pone `string[] | undefined` (no `| null`) para args con DEFAULT → pasar `?? undefined`, no `?? null` (si no, TS2322).
- **Falta UI para editar el perfil propio** (nombre): hoy se corrigió "Gascón"→"Gª Colón" por SQL directo en `user_profiles.display_name`.
- **NUNCA `Set-Content -Encoding UTF8` sobre ficheros con acentos** → corrompe tildes; usar `Copy-Item` del descargado (reforzado 09/06).
- **NUNCA `window.confirm`** → usar `ConfirmDialog` de Folvy (reforzado 09/06).
- **RECON de fuente primaria SIEMPRE antes de tocar** (el bug del F5 estaba en `routes.ts`, no donde parecía — 09/06).
- **No decidir un rediseño crucial a medias sin el ritual completo** (RECON → benchmark del mejor → diseño golear aprobado → construir; lección 09/06, dicha por Julio).

### 1.4 — Próximos pasos priorizados
> **ESTADO 18/06:** la cadena de fiabilidad canónico + consumo teórico + módulo Almacén/AvT + Niveles + Fichaje están HECHOS. El catálogo de marca (crear/organizar/ficha-cockpit) y HubRise de punta a punta también. El frente ACTIVO es **OVERRIDES (precio por canal con margen real)**.

1. **OVERRIDES — precio por canal con margen real (frente activo).** Motor SQL base+override+canal → servicio de overrides → modal "Editar precios" con margen real al teclear → jubilar el cálculo cliente. (Detalle en §1.3 ítem 1 nuevo.)
2. **MODIFICADORES Y COMBOS (frente grande, el que preocupa a Julio).** Un MODIFICADOR toca **coste Y stock** desde el día uno ("las dos cosas o no merece la pena", Julio). COMBO = suma de componentes por defecto con ajuste manual posible. Solución = un **resolutor único de "receta efectiva en venta"** (receta base + impactos de modificadores elegidos + componentes de combo) que escupe consumo teórico por ingrediente×local → de ahí beben coste real, descuento de almacén, AvT y consumo MRP II (una pieza, no cinco). Folvy ya tiene `modifier_recipe_impact` (impact_type/quantity/target_recipe_item_id — nadie lo tiene). Plan: DISEÑO PRIMERO con RECON de cómo explota hoy el motor de consumo una venta (¿cuenta o ignora modificadores/combos?), luego modificadores, luego combos. Montaje fácil con "unidades de uso amigables" (+1 loncha, no +25 g).
3. **Capa 1.b residual del catálogo:** retoque `created_by` al crear; permitir marcas vacías seleccionables en el selector de carta (CP1-a.2; `listAccountBrands` ya creado puede servir).
4. **Publicador de Catálogo** (push Folvy→HubRise/canales; diseño aprobado en `docs/folvy_catalogo_publicador_diseno.md`).
5. **Deuda de versionado/seguridad** (SQL HubRise a migrations; rotar service_role + tokens; DNS www) y **OBLIGATORIOS A-C del 12/06**.
6. **Producción Llorente29 objetivo: 7 sept 2026.**

### 1.11 — NOTA HISTÓRICA
> **02/06:** integrador directo + Folvy Connect + D2 Vault + Glovo (ticket INTSUPPO-1382). **03/06 (AM):** monitorización ingesta capas 2+3. **03/06 (núcleo):** FRENTE COSTE REAL — recon (cimiento ya construido), reconciliación coste (bc28560), validación E2E, pasos 1-2 (8ec5883, 9d75f9b), sub-frente FAMILIAS completo (7d0a6a4, e87de68, 3d21eb9, 2daae1b, 479ecd3): clasificación IA (106 auto/56 revisar/0 sin), revisión, filtro, gestor CRUD con subfamilias AECOC. Hallazgo arquitectura de cuentas (Folvy Interno=pruebas / Llorente29=cliente vacío). Mapa global creado (7fad688). **04/06 (maratón):** C3 factura/three-way (1325e38→349f003→bc96c68→55dea82→6b7bf42), documento Supply docx + mapas actualizados (8fe679e), INVENTARIO CAPA 1 completa (3ea7f0b modelo→191972f áreas→c6862cd conteo→f594279 ajuste), saneamiento LOCAL OPERATIVO (a89147a base+inventario→fcbc46c pedido+recepción). Migraciones 20260604T3400/3500/3600/3800. Incidente: gen types vació database.ts, recuperado por git checkout + método seguro. **05/06 (mañana):** Catálogo de Marca Fase A — esquema 8 tablas (8716f9c, 47eb640), importador Last.app `lastapp-catalog-import` 151 prod/17 combos/9 marcas (ae855fa), pantalla Menú KitchenMenuPage read-only con KPI cobertura (9ace0e7). **05/06 (tarde):** Ficha de producto B1 CatalogProductDetailPage con índice sticky + secciones apiladas Baymard (9b0abdf). Economía de canal E1 datos — channel_rate + menu_item_economics + migración 20260605T0300 (efd8f5e). E1 UI — KitchenSettingsPage zona Ajustes (6c52f54). Documento de diseño economía/canal/promos 10 fases (7a3b0db). Decisiones: Catcher=broker reparto, JELP=2º broker→multi-broker, margen 3 niveles, Ley Ómnibus + artículo-espejo, IVA heterogéneo. **07/06:** casado de ventas lastapp arreglado (cache `brand_id|recipe_item_id`, marca vía `catalogProductId`, `--no-verify-jwt`); subsistema de fiabilidad iniciado (capas 1-2); recepción "qué entra al almacén" en producción (a0e678e). **08/06:** 3 hitos arquitectónicos — MODELO CANÓNICO multi-TPV (`adapt_lastapp_order`; principio rector 5: frontera única/motor puro), MOTOR DE COSTE DE VENTA REAL (`sale_line.computed_cost` congelado), G3 MODIFICADORES completo (ciclo proposed/confirmed; solo confirmed toca el coste). Capa 4 de fiabilidad (señal central). Commits 72ca8a5, c75ee40, d1a30a5, 01c2904, 9e62e36. **09/06 (mañana):** consumo teórico VIVO ventas×escandallo (af85058), identidad del recast jubilada + `reprocess_sale` unificado (6e7f765), recosteo + política DOS RELOJES (congelado venta / vivo ingrediente; sin código), capa 4 verificada 95,02%. **09/06 (tarde):** bug del router F5 (`isShellRoute` en `routes.ts`) + crear plato desde venta huérfana (`create_dish_from_unmapped` + `ConfirmDialog`) (3bc2705); CONTEXTO §1 (65c708e). **09/06 (noche):** recepción REDISEÑADA — espejo del albarán (recibido a ciegas, foto a la izquierda, formato en una línea con árbol `ensurePackTree`, «→ X al almacén», rojo+motivo si no cuadra) + tarjeta con jerarquía. Commits 5230ff4 (T1) → 52e8771 (T2a) → 7130303/b5f5b5c/604e14b/0663c45 (T2b) → 63a4f5f/7d5db77 (árbol) → 62a225e (jerarquía). Build verde. Pendiente validar varios albaranes (10/06). Sigue acoplado: navegabilidad/uso móvil del trabajador.

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

## SESIÓN 04/06/2026 — Folvy Supply C2: recepción de albarán + libro mayor de stock (ciclo cerrado) + blindaje anti-error

Sesión larga y muy productiva: se construyó y cerró C2 entero, con varias iteraciones de diseño guiadas por feedback de Julio.

### LO CONSTRUIDO (todo en producción, cuenta Folvy Interno)
- **C2.1 — estructura + ledger + UI base** (commit f96d049): 4 tablas (goods_receipt, goods_receipt_line, stock_movement=ledger, recipe_item_location_stock=snapshot WAC), RLS, correlativo ALB-. RPC confirm/void/recompute (SECURITY DEFINER, se prueban desde la app). WAC perpetuo append-only con coste sellado por movimiento. goodsReceiptService.ts (CRUD + qtyInBaseFromFormat + confirmReceipt con ripple cascadeFromItem RAW→platos→margen + voidReceipt + listLocationStock). UI: pestaña Recepciones, GoodsReceiptsPage, GoodsReceiptForm (contra-pedido/ciego), Registrar recepción en el detalle. Probado E2E (ALB-00001).
- **Cierre C2** (commit 02cb815, migración 20260604T1400): auto-estado del pedido (recompute_purchase_order_status en confirm/void → recibido/recibido_parcial/enviado solo; no toca terminales). Anular y corregir. Cancelar/Cerrar manual de último recurso.
- **Fix anular-y-corregir + UX** (commit 844c71c): BUG corregido — antes anulaba al pulsar aunque salieras sin guardar; ahora la original se anula SOLO al confirmar la corregida (orden seguro: 1º crea+confirma nueva, 2º anula vieja). Auto-volver con toast (fuera la pantalla de franja verde). Celda recibido destacada.
- **Recepción ANTI-ERROR / blind receiving** (commit fc74fa5): feedback de Julio (precargar la cantidad pedida en Recibido es peligroso con 30 líneas = confirmation bias). Benchmark (Finale/DataDocks/eFulfillment): blind count estándar para alto valor/volumen; híbrido. DISEÑO: celda Recibido VACÍA siempre; Pedido/Ya recibido/Pendiente referencia gris (listOrderLineReceived); botón Rellenar con lo pendiente opt-in; resumen antes de confirmar siempre; 2º clic reforzado solo si anomalía.
- **Resumen detallado + lenguaje llano** (commits 97d25cf, 9f4a09e): el contador 'De más: 1' confundía (se leía como 1 unidad). Panel reescrito en humano, con nombre de producto y cantidades: 'Cebolla Morada: cuentas 5, solo faltaban 2 (te sobran 3). Con esto tendrías 6 de un pedido de 3.' Sin contadores abstractos. De menos informa, no frena. Probado E2E.

### DECISIONES CLAVE
- Estado del pedido AUTOMÁTICO; manual (cancelar/cerrar) solo último recurso, terminal; la automatización nunca lo pisa.
- 'De más' no bloquea recibir (recibido≥pedido=completa); si fuera problema se trata con avisos IA (C2.2), no alterando el auto-estado.
- Recibido de más se mide y muestra contra lo pendiente Y contra el pedido total.
- Lote/caducidad: la línea ya los transporta y se persisten (hueco FEFO/APPCC); inputs visibles y lógica en su frente (no media tubería).

### FRENTES NUEVOS ANOTADOS (con disparador)
- **C2.2** — OCR foto albarán como propuesta a validar + create-on-scan (proveedor/artículo no existentes → source='ocr', needs_review, no toca coste hasta resolver) + copiloto IA de avisos en recepción (de más/menos, caducidades). Sobre la misma UI.
- **FEFO + trazabilidad de lote** — capturar lot_code/expiry al recibir → consumo por caducidad más próxima → trazabilidad para alertas sanitarias. Disparador: al construir inventario/consumo.
- **APPCC en recepción** — control de recepción (temperatura, estado embalaje, caducidad, conformidad transporte); una incidencia puede rechazar la línea y deja traza en recepción y APPCC. Obligación legal. Disparador: tras anti-error.
- **LOCAL ACTIVO de sesión** (DEUDA) — el location_id operativo debe salir del contexto sesión/dispositivo, no de un selector manual (en cocina = error seguro). Modelo de datos ya correcto; es solo UI. Contención: ninguna pantalla nueva añade selector manual de local. Disparador: antes de producción.

### NOTA OPERATIVA
- **ALB-00003 quedó ANULADO** por el bug viejo de anular-y-corregir (se anuló al pulsar, antes del fix). Si ese stock debía estar dentro, rehacer esa recepción.
- **Higiene git:** los últimos push empaquetaron muchos objetos (cruft); al arrancar, revisar `git status` por si quedó algo sin trackear (incluida data confidencial Llorente29 JSON — saneamiento git ya pendiente, sesión dedicada).

### MÉTODO REFORZADO
- El anti-error nació de feedback de Julio + benchmark obligatorio ANTES de diseñar (confirmation bias / blind receiving). UI pensada para personal de cocina poco formado: frases con nombre de producto, no jerga ni contadores abstractos.

## SESIÓN 05/06/2026 (MAÑANA — Catálogo de Marca Fase A + importador Last.app + pantalla Menú)

### LO CONSTRUIDO
- **Esquema Fase A + A6 (commits 8716f9c, 47eb640):** 8 tablas nuevas para el catálogo comercial de marca: menu_category, menu_item_override, modifier_group, modifier_option, modifier_group_assignment, modifier_recipe_impact, combo_slot, combo_slot_option. menu_item ampliado (product_type, external_id; channel_id+recipe_item_id NULLABLE). sale_line normalizada. RLS + idempotencia. Modelo: menu_item = verdad de MARCA, canal = variante en override. Combo sin escandallo propio, coste = Σslots.
- **Importador Last.app (commit ae855fa):** Edge Function `lastapp-catalog-import` (auth dual, `--no-verify-jwt`). Trae catálogo comercial "en uso": locations→brands→catalogs.default, filtra vacías + canal informes, cruzado con GET org catalog. Marca por nombre + BRAND_ALIAS. Idempotente por external_id. NO crea recipe_items ni costes. Componentes de combo entran como productos. Real Llorente29: 151 productos, 17 combos, 43 grupos modificadores, 9 marcas. Tabla rasa total previa.
- **Pantalla Menú (commit 9ace0e7):** KitchenMenuPage + brandCatalogService, ruta 'menu'. Carta de marca READ-ONLY: selector marca, KPI cobertura escandallo (0%=onboarding), categorías + productos con estado escandallo, combos expandibles.

## SESIÓN 05/06/2026 (TARDE — Ficha de Producto B1 + Economía de Canal E1)

### LO CONSTRUIDO
- **B1 — Ficha de producto (commit 9b0abdf):** CatalogProductDetailPage con índice sticky lateral + secciones apiladas (decisión UX Baymard: tabs esconden; índice pegajoso da overview, como Otter). Secciones: Datos (editable), Precios (contenedor E2), Modificadores (lectura), Disponibilidad (contenedor), Avanzado (contenedor).
- **Documento de diseño economía/canal/promos (commit 7a3b0db):** `docs/folvy_economia_canal_promociones_diseno_2026-06-05.md` — modelo completo margen 3 niveles, IVAs, conector multi-broker, gestor campañas Ómnibus, 10 fases.
- **E1 datos (commit efd8f5e, migración 20260605T0300):** tabla channel_rate (defecto por canal) + función menu_item_economics con fallback por especificidad. database.ts regenerado.
- **E1 UI (commit 6c52f54):** zona Ajustes en sidebar Kitchen + channelRateService + KitchenSettingsPage. Configura comisión % por canal + tipo de servicio.

### DECISIONES CLAVE
- Catcher = broker reparto propio (last-mile), NO agregador de comisiones. Coste real ~6,30€/pedido Llorente29. JELP = segundo broker → conector multi-broker.
- Margen en 3 niveles: (1) unitario PVP, (2) real por pedido, (3) canal por periodo. Ads solo nivel 3.
- Ley Ómnibus: precio promocionado sobre mínimo 30 días. Técnica artículo-espejo para esquivar legalmente. NADIE cierra este bucle.
- IVA heterogéneo: comida 10%, bebida alcohólica/azucarada 21%, transporte 21%. Bases homogéneas.
- Ficha producto: secciones apiladas + índice sticky (NO tabs). Baymard.

### PENDIENTE
- Verificar E1 en vivo. E2 cascada margen en ficha. brand_channel vacío. Fotos catálogo (Last.app no las trae).
- CONTEXTO_CLAUDE.md NO se actualizó al cierre de esta sesión → actualizado en la sesión del 06/06.
