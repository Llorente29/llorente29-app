# Folvy — REGLAS NO NEGOCIABLES (manual de operación)

> Se lee en cada arranque. Son las reglas estables de cómo trabajar. La **historia** vive en el archivo (`folvy_archivo_YYYY-MM.md` + `CONTEXTO_CLAUDE.md` congelado); el **estado** en `folvy_estado.md`. Aquí solo las reglas.

## 0. REGLA CERO (antes de responder cualquier cosa técnica)
- **La BBDD es la verdad; los docs pueden estar desfasados.** RECON contra fuente primaria (BBDD por MCP + repo) ANTES de proponer o diseñar. Nunca diseñar contra un doc.
- Si Julio (CEO) no se identifica, asumir Julio. Un refuerzo técnico se declara en su 1ª línea ("Soy [Nombre], refuerzo técnico de Julio"). Si alguien cambia de rol a mitad, verificar con una pregunta de contexto vivido (no buscable).

## 1. Operación (turno a turno)
- **Una instrucción operativa por turno.** Los errores suelen venir de amontonar pasos.
- **Marcar SIEMPRE el contexto**: 🖥️ PowerShell/bash · 🗃️ SQL Editor.
- **Marcar SIEMPRE cada acción operativa**: COMMIT/ROLLBACK, build, git grep/commit/push (verificar push con `rev-list`), reiniciar dev server.
- **Julio ejecuta, Claude diseña/revisa.** (Nota 22/07: Claude ya tiene Supabase por MCP → puede hacer RECON directo y, si Julio lo autoriza, ejecutar cambios de BBDD él mismo, siempre marcando la operación y enseñando el SQL antes.)
- **Archivos COMPLETOS**, nunca diffs sueltos sin contexto. **Pedir el original ANTES de modificar** (o que Claude Code lo lea). No inventar sobre suposiciones. Pedir en UN mensaje todos los ficheros de un tramo.
- **NO insistir en cerrar ni mencionarlo.** Julio decide cuándo cerrar (salvo riesgo técnico real: build roto, algo peligroso a medias). El cierre lo dispara Julio diciendo *"cerramos"* → seguir `folvy_cierre_sesion.md` **completo, los 9 puntos**.
- **Directo, sin pelotismo.** Discrepar UNA vez con argumentos; si Julio insiste, ejecutar y registrar la reserva.
- Preguntas: en Cowork las preguntas con botones (AskUserQuestion) **sí** funcionan y se pueden usar. (La regla vieja "solo prosa" era del chat clásico, donde no llegaban bien.)

## 1.bis ENTREGA — commit → push → deploy → verificar (REGLA DURA, la más ignorada)
- **Ningún encargo/trabajo/aporte se da por HECHO hasta las 5 etapas: (1) commit → (2) push (verificado: la rama tiene puntero `origin/`, o `git rev-list --count origin/<rama>..<rama>` = 0) → (3) PR/merge a main → (4) deploy → (5) verificación en vivo.** Nada se queda en localhost.
- **Una rama SIN `origin/` = trabajo VARADO, no trabajo hecho.** Causa real (25/07): el desplegable de reparto (`0011299`, rama `feat/reparto-propio-desplegable`) se construyó, se verificó en local y se quedó **sin pushear** → se dio por perdido y casi se re-encarga desde cero. En paralelo, trabajo VIVO en Supabase (HubRise `hubriseToken.ts`, `hubrise-order-status`, `hubrise-callback-ensure`) sigue **sin comitear** = drift repo↔producción. Es la deuda de proceso que más ha dolido.
- **Esto ya estaba en los 7 pasos del cierre diario** (`folvy_cierre_sesion.md`) y se ignoró repetidamente → por eso se eleva aquí a NO negociable.
- Al terminar cada tramo, Claude/Code **declara el estado git explícito**: rama · commit · pushed (sí/no) · PR (sí/no) · deploy (sí/no) · verificado en vivo (sí/no). Sin las 5, no se dice "hecho": se dice "hecho hasta la etapa N, falta X".
- **⚠️ `supabase functions deploy` ENCIENDE `verify_jwt` por defecto.** Toda edge llamada por un trigger/cron/RPC (con secreto interno, sin sesión) debe recibir `Authorization` (anon, es público) **o desplegarse con `--no-verify-jwt`** — si no, su llamada la rechaza la puerta con **401 antes de ejecutarse**, sin dejar rastro. Causó el incidente del auto-despacho (26/07) y reapareció en Fase A/B (30/07: `hubrise-location-dispatch` y `availability-dispatch` necesitan `--no-verify-jwt`, o el log del despacho queda en null). **Ninguna edge del camino crítico puede fallar en silencio: 401/errores → escribir rastro.**

## 2. Código / migraciones (para Claude Code y al diseñar)
- **NO tocar `App.tsx` sin permiso explícito de Julio.**
- **NO sobrescribir `notificationsService.ts`** (firma posicional consolidada: los parámetros originales no se mueven; lo nuevo va al final).
- **🔴 ANTES DE APLICAR CUALQUIER MIGRACIÓN/DEPLOY DEL REPO, comparar la versión VIVA con lo que trae el fichero** — sobre todo si viene de trabajo paralelo de Code, que puede haber diagnosticado contra una versión del repo ya obsoleta. *(Caso real 28/07: la migración de Code de `create_dish_from_unmapped` estaba escrita contra tablas MUERTAS — `lastapp_catalog_product`/`lastapp_product_map`, `to_regclass`=NULL, el vivo es `external_catalog_product` — y reintroducía un recast que ya se había quitado. Aplicarla a ciegas habría roto la función en runtime + revuelto un timeout. Se resolvió FUSIONANDO: la lógica buena de Code sobre el cuerpo vivo.)* La receta es la misma que con `catcher-dispatch` (26/07): `pg_get_functiondef` de lo vivo → fusionar, nunca sobrescribir. **Producción suele ir por delante del repo (drift); el repo no es la verdad, la BBDD sí.**
- **🔴 supabase-js: NUNCA guardar `rpc`/`from` en una variable suelta** — pierde el `this` y falla con `Cannot read properties of undefined (reading 'rest')` **sin llegar a enviar la petición**. Formas válidas: inline `(supabase!.rpc as ...)('fn', args)` o `.bind(supabase!)` con el cast a la firma simple ANTES del bind (si no, TS2589). **Corolario crítico:** un servicio que falla así **no devuelve datos vacíos — no devuelve nada** → la UI **NUNCA** debe interpretar "error" como "cero resultados"; un estado de éxito no puede renderizarse si hubo error. *(Bug real 2 veces en prod: banner KPI 24/07 y pantalla de fiabilidad 26/07.)* **Corolario 2 (28/07): un `catch(()=>[])` en el cliente convierte un error de BBDD en "lista vacía" y ESCONDE el fallo** — un catch que devuelve vacío debe al menos `console.warn`.
- **Rendimiento de RPC pesadas** *(28/07)*: no construir consultas arrancando por la tabla más grande y filtrando después (patrón `sale_line`-primero → sondear `sale` una a una = 255 MB de buffers, timeout en frío). Filtrar por la dimensión selectiva PRIMERO (fecha via índice, CTE `... as materialized`) y enganchar la grande por hash join. **`EXPLAIN` en caliente miente; mirar BUFFERS.** Toda RPC pesada con guardia `set statement_timeout`. Verificar equivalencia (md5 / `is not distinct from`) antes de aplicar. Detalle en `folvy_mapa_sistema.md` §Rendimiento.
- **`database.ts` regenerado va en el MISMO commit** que los tipos/services que lo usan (unidad atómica que compila en aislamiento). **Todo DDL aplicado en sesión → migración** en `supabase/migrations/` (`YYYYMMDD'T'HHmm_descripcion.sql`, transaccional, cabecera `Aplicada:`) antes del push. Si no, hay DRIFT.
  - ⚠️ **`supabase db push` NO funciona aquí** (rechaza el nombre con "T"; salta todo y falla por historial). **Las migraciones se aplican a mano por el SQL Editor**; el fichero queda como registro. Nunca sugerir `db push` ni `migration repair`. (Detalle en `folvy_mapa_sistema.md`.)
- **Toda función `SECURITY DEFINER` con `p_account_id` lleva guard `belongs_to_account`** (una omisión = fuga entre cuentas; pasó 2 veces: `_kitchen_day_banner_for` 25/07 y `warehouse_reliability_queue` 26/07). Y **ningún trigger/función con catch mudo** (`exception when others then null`): si traga un error, que lo registre.
- **Sustitución quirúrgica en funciones vivas y compartidas** (`orders_feed_by_token`, `order_for_print`, `upsert_pos_sale`): migración generativa sobre `pg_get_functiondef()` con guard `DO` que exige **ocurrencia única** del fragmento y aborta si no. Nunca reescribir el cuerpo entero de una función que consumen las tablets.
- TS strict · camelCase cliente / snake_case BBDD · doble cast `as unknown as Json` para jsonb · `tsconfig`: NO enums, NO parameter properties · Oxc (Vite): no mezclar `??` con `&&` sin paréntesis · services CRUD multi-tenant: patrón `brandsService.ts` · Edge Functions corren en Deno (`npm run build` NO las compila; su check es que el deploy no falle). ⚠️ **Cada Edge nueva necesita su `deno.json`** (import map de `@supabase/supabase-js`); sin él el bundle falla ("Relative import path not prefixed") *(30/07)*.
- **🔴 El payload de `deploy_edge_function` se genera MECÁNICAMENTE desde disco, nunca se transcribe a mano** *(15/08)* — reteclear el contenido de un fichero largo (sobre todo `_shared/*`) dentro de la llamada lo corrompe sin que el deploy falle (Deno no tipa-chequea código muerto sintácticamente válido). Generar el JSON del `files` por script (Python/Bash) leyendo los ficheros reales, y verificar después con `get_edge_function` que lo desplegado coincide byte a byte con el fichero real — no basta con que el deploy devuelva éxito.
- **El build se verifica con `tsc -b`** (lo que corre Vercel), no `tsc --noEmit`. Hay script: **`npm run typecheck`** *(añadido el 02/09)*.
  - ⚠️ **`tsc --noEmit` sobre la raíz NO COMPRUEBA NADA y sale con exit 0.** `tsconfig.json` es un fichero de solución (`"files": []` + `references`): no encuentra ficheros de entrada y no mira una sola línea. No es que avise menos — es que no mira. *(Se volvió a pagar el 02/09; la regla ya estaba escrita aquí desde el PR #47.)*
  - 🔴 **ANULACIÓN RETROACTIVA (02/09):** los documentos de lote de **agosto de 2026** que declaran «`tsc --noEmit` limpio» como verificación **no verificaron nada con esa línea**. Son once: `pedido_articulo_repetido_20260820`, `quitar_plato_de_carta_20260823`, `subrecetas_preparaciones_ui_20260823`, `batch_yield_subrecetas_20260823`, `gestor_menus_auditoria_f1_20260824`, `gestor_menus_premium_20260824`, `gestor_menus_fix_margen_20260824`, `gestor_menus_f2_f7_20260824`, `botones_carta_no_responden_20260824`, `carta_pausar_y_menu_contextual_20260824`, `recostear_todo_20260824`. **No se reescriben** —reescribir once ficheros para arreglar una frase es cómo se pierde una noche—: esta línea los anula. Casi todos declaran además `npm run build` ✓, que sí ejecuta `tsc -b`; **solo hay que re-verificar lo que dependa de un lote que NO lo declare.**
- **UNA RAMA NUEVA POR ENCARGO.** Nunca empujar a una rama ya mergeada.
- **🔴 REGLA 11 — UN FRENTE QUE PROPONE UN ARREGLO LLEVA MEDIDA SU CONSECUENCIA** *(02/09)*. Sin esa medida el frente **no está terminado, está apuntado**. Medir el problema no es medir la solución: son dos medidas, y la segunda es la que se salta.
  - *Por qué existe:* dos frentes escritos el mismo día tenían **la medida bien y la conclusión invertida**. El **14** proponía un `where` que habría BAJADO el food cost 4,6 puntos borrando 2.880 € de coste real; el **16** pedía construir un motor de combos que **ya estaba escrito**. Los dos se habrían caído solos al escribirlos si la propuesta hubiera llevado su ensayo al lado, en vez de tres semanas después.
  - *Qué cuenta como consecuencia medida:* el número ANTES y DESPUÉS del arreglo propuesto, sobre datos reales, sin aplicarlo. Un ensayo en seco. Si no se puede ensayar, eso también se escribe — y entonces el frente dice «propuesta sin ensayar», que es una etiqueta honesta y avisa a quien lo coja.
  - *El detector:* si la propuesta se lee como «se arregla con un `where`» y no hay una cifra al lado que diga a cuánto se mueve, el frente está a medias. **Y ojo al encuadre:** llamarlo «un `where`» es exactamente lo que desanima a medir.
- Config: **UTF-8 SIN BOM, LF** (nunca `Set-Content -Encoding UTF8` ni `Out-File`). Verificar hooks existentes antes de crear uno nuevo. Nunca PII reales como datos de prueba.

## 3. SQL / BBDD
- Verificar BBDD (`information_schema` / MCP) antes de cualquier decisión arquitectónica.
- **🔴 EL SQL EDITOR DE SUPABASE SE TRAGA STATEMENTS EN SILENCIO — NO FIARSE DEL "Success" *(30/07, la lección más cara de Fase B)*.** Además del begin/commit ya conocido (§abajo), el editor reportó **"Success. No rows returned" pero NO creó objetos SUELTOS** (un `CREATE UNIQUE INDEX`, un `CREATE TRIGGER`, un `DELETE` del reset) — sin patrón claro, sin error. **Reglas obligatorias:**
  - **Verificar CADA objeto con una query independiente tras la migración** (`pg_indexes`/`pg_trigger`/`pg_get_functiondef`/`information_schema.columns`). No basta el "Success".
  - **Operaciones críticas (reset, reseed, borrados): UNA sentencia por Run**, verificando cada una. Los INSERT/ALTER/CREATE TABLE sueltos sí se aplican fiables; los multi-sentencia son los que fallan.
  - **Cada migración que cree un objeto lleva guard `DO` que consulta `pg_catalog` y ABORTA con excepción si no quedó** — antes de tocar datos. (El guard es la 1ª red; la query independiente es la de verdad, porque el runner podría tragarse también el guard.)
  - **`begin;`/`commit;` en el fichero: el editor los DESCARTA** — devuelve "Success" sin aplicar nada. Para aplicar a mano, quitar el begin/commit; el fichero se queda como registro. *(`apply_migration` por MCP sí aplica de verdad.)*
- **⚠️ `ALTER TABLE` sobre tablas calientes (`sale`, `sale_line`, `kds_device`) SOLO con servicio cerrado** *(11/08)* — un `DROP/ADD CONSTRAINT` en caliente participó en tumbar la BBDD 45 minutos.
- **RPC nueva o con firma cambiada → `notify pgrst, 'reload schema';`** al final, o PostgREST no la ve y el front falla mudo.
- SQL revisable ANTES de ejecutar. **Preview SELECT antes de cada migración/DELETE. Verificación post-ejecución obligatoria.**
- **No ejecutar SQL en producción sin red de seguridad** (PITR o staging). Parar inmediatamente ante cualquier output inesperado.
- **Ejecutar las verificaciones POR SEPARADO**: un bloque multi-statement en el editor solo devuelve el resultado del ÚLTIMO SELECT (oculta los anteriores).
- Sin subqueries en CHECK · sin funciones volátiles (`now()`/`random()`) en WHERE de índice parcial · `jsonb_build_object` >50 pares → literal `'{...}'::jsonb` · `min()/max()` no admiten `uuid` → castear `::text` y volver a `::uuid`.
- **`UPDATE ... FROM t ... WHERE ...`: la condición que referencia la tabla objetivo (`target.col = t.col`) va en el WHERE, NO en el ON del JOIN** — si no, "invalid reference to FROM-clause entry" *(30/07, seed de stock_group)*.
- **`ON CONFLICT (cols) DO NOTHING` necesita un índice ÚNICO que case EXACTAMENTE esas columnas** — si el índice no existe o no coincide, no dispara y se duplican filas en silencio *(30/07: `stock_group` sin el unique compuesto → 19 grupos por duplicado)*. Y en multi-tenant, el unique de una tabla por-cuenta va **compuesto `(account_id, ...)`**, no global (las claves externas se comparten entre cuentas).
- **Antes de dar por muerta una columna, medir a 90 días, no a 30** *(11/08: `ignore_reason`/`ignored_at` parecían sin uso a 30 días; a 90 los usan 168 líneas con un significado distinto — reutilizarlos habría contaminado el consumo y el food cost)*.
- Limpieza: DELETE topológico en orden inverso de dependencias. NO `TRUNCATE CASCADE`, NO soft delete si el objetivo es limpieza física.
- **Reparto Claude/Code**: leer un fichero CONCRETO que Claude identifica → lo sube Julio (rápido). Búsqueda/descubrimiento en el repo (`git grep`, "¿existe X?") o ejecución → Claude Code. (Para BBDD, Claude tiene MCP directo.) NUNCA "don't ask again" en Code para `git`/`curl`/comandos sensibles.

## 4. Método / DEUDA 0
- **Antes de abrir un frente**: `conversation_search` + `project_search` del tema + RECON en BBDD. (La causa de las duplicaciones pasadas fue saltarse esto.) ⚠️ **Cuidado con `LIMIT` en las queries de RECON** — un `limit 30` escondido hizo creer "28 colisiones" cuando eran ~100 *(30/07)*. Contar sin límite antes de dimensionar.
- **DEUDA 0**: benchmark del mejor (mapa competitivo del área) ANTES de diseñar. No vender empate como victoria. **No bordear/aparcar problemas: se atacan y se resuelven** (o se anotan explícitamente como deuda con dueño y disparador, nunca se ignoran en silencio).
- **Auto-protección**: un sistema vivo no se protege solo. Los fallos silenciosos (una llamada que no se envía, un despacho que no ocurre, un dato que no descuenta, un cierre indefinido olvidado) deben tener un **vigía que los haga ruidosos** — error visible + alarma. "Funciona ahora" no es seguridad; "avisa si deja de funcionar" sí.
- **No prometer lo que no se puede cumplir (UI honesta):** si Folvy no controla algo (el 86 de Last, una marca cedida en Last, un local sin conexión HubRise), la UI **degrada** ("gestionar en Last" / "no conectado") en vez de ofrecer un botón que no cumple. Patrón de Fase 0/A/B.
- **La ausencia en una documentación NO es ausencia en el producto** *(11/08)*. Verificar afirmaciones de mercado contra fuente primaria (la falsa "ventana VeriFactu").
- **Folvy es para TODA la hostelería**, no solo dark kitchens. Cada decisión de producto pasa la prueba del "bar con terraza y dos empleados".
- Identidad verificada ante decisiones de impacto presupuestario o de producción. Autorizaciones por otros canales (WhatsApp, oral) exigen trazabilidad escrita en el chat.
- **Mapa del sistema (anti-omisión de contexto)**: `folvy_mapa_sistema.md` es el inventario técnico verificado. Se consulta en la APERTURA. **Todo hallazgo de RECON que contradiga o amplíe un doc se escribe ahí EN EL MOMENTO** (con fecha y fuente). Verificarlo en la sesión no basta: si no se escribe, se pierde.

## 5. Reglas nacidas del 11-12/08 (TPV, tablets, informes)

- **🔴 Si un dato que doy no cuadra con lo que Julio ve en pantalla, se PARA en ese momento y se dice.** No se sigue puliendo el informe. *(Caso: entregué "44 productos desactivados en Alcalá"; la pantalla de Julio mostraba 2. Se perdió una hora. `enabled:false` en la API de Last no significa "agotado", significa "fuera de la carta activa de este local" — incluye catálogo histórico, marcas de otras ciudades y el mismo refresco duplicado por marca.)*
- **🔴 Cuando me equivoco, la solución NO es "mañana lo vemos".** Julio: *"cuando alguien se equivoca y la solución es 'mañana lo vemos' es que no quiere hacerlo. La próxima vez me lo dices directo y no perdemos tiempo."* O se arregla ahora, o se dice claramente que no se puede y por qué.
- **🔴 Verificar en la BASE, no en el repo ni en el doc.** El conciliador C1 llevaba días aplicado y funcionando con cron diario mientras el estado decía "en pausa". Lo mismo con costes: el "food cost del 10,5 %" era una métrica rota, no un margen.
- **🔴 Ningún bundle sale antes que sus migraciones.** El OTA (Capgo) llega a las tablets en minutos; una migración pendiente convierte eso en un local cerrado. Orden: migración aplicada y verificada → bundle.
- **🔴 Ningún encargo de pantalla se da por terminado sin especificación visual.** Si un encargo describe una pantalla y no dice cómo debe verse ni remite a `folvy_tpv_sistema_diseno_20260811.md`, está incompleto. *(El panel de cuentas gris hacía exactamente lo que pedía mi encargo: el encargo era el que estaba mal.)* Julio: *"esto lo van a usar camareros, algunos con niveles muy bajos de formación… sin diseño no hay venta, lo buscas de los líderes y lo copias"*.
- **🔴 Un punto de verificación que no se puede ejecutar se reporta como NO EJECUTADO**, nunca como superado. Vale para Code y para mí.
- **🔴 Las impresoras siempre son un problema en cualquier cliente** (principio permanente de Julio). Todo lo que se diseñe con impresora asume que fallará: reintento, aviso visible cuando se agota, e idempotencia antes de reimprimir.
- **🔴 Ningún dato derivado se da por terminado sin sus tres patas: quien lo hace en caliente · un barrido que repara lo atrasado · un vigía que mide y avisa.** El patrón que explica cuatro incidentes distintos (latido, impresión, coste de línea, validación de token) es siempre el mismo: algo se resuelve una vez, en caliente, y si ese momento falla nadie vuelve.
- **En el arranque de cualquier proceso, usar la función barata.** Validar un token con `kds_board` (1.895 ms, escala con los pedidos vivos) en vez de `device_location_by_token` (16 ms) es lo que cerró Carabanchel. Medir el coste de lo que se llama en el camino crítico, no suponerlo.
- **Un mensaje de error que manda a buscar donde no es cuesta un local.** «El token no es válido o fue revocado» ante un fallo de red enseña al personal a desvincular tablets sanas. Sin conexión ≠ va lento ≠ token revocado: tres estados, tres mensajes, y solo el tercero pide vincular.
- **Los procesos de servicio (latido, impresión) no cuelgan del árbol de la interfaz.** Una tablet que no puede pintar todavía puede imprimir comandas, y eso salva el servicio.
- **Medir el contraste, no estimarlo.** En mi propia propuesta de diseño había 4 fallos WCAG (`--accent` 3,68:1 con blanco). "Se ve bien" no es una medida.
- **Antes de afirmar que un dato no se guarda, comprobar por qué columna se guarda.** Dije que el stock no se descontaba buscando por `stock_movement.sale_line_id` (null en las 26.425 filas, columna muerta); la función usa `source_type='sale'` + `source_id`. Mismo error cometido por dos analistas el mismo día.

## 6. LA CUARTA PATA: quién la usa (12/08/2026)

> **Ninguna pieza se da por terminada hasta que ALGO LA CONSUME y se ha verificado con datos reales que la consume.** Un `create function` en verde no es una entrega; un PR mergeado tampoco.

Extiende la tríada existente (**en caliente · barrido · vigía**, §5) con la pata que faltaba.

**Por qué existe:** el 12/08 aparecieron **siete** piezas construidas, correctas y desconectadas — `negotiated_price`, `price_drift_for`, `autoclose_daily_count`, `learn_from_receipt`, el ciclo de compra P1, `stock_level` y el propio diseño MRP II del 10/08. Todas funcionaban. Ninguna se usaba. Julio: *"siempre que se dejan buenas ideas, mueren o no se conectan. Es el gran mal y defecto de Folvy."*

**En la práctica:**
- Antes de diseñar algo nuevo: **RECON de si ya existe**. El 12/08 se propuso construir cuatro cosas que ya estaban hechas.
- El criterio de terminado de una fase es **la siguiente funcionando encima**, no que compile.
- Un encargo se cierra con **verificación en pantalla**, no con el deploy.

## 7. Diseño para quien lo usa, no para quien lo construye (12/08/2026)

Julio: *"las capacidades profesionales del personal son muy bajas; no les pidas lógica. O les vas guiando paso a paso o les bloqueas. **Si hay decisión, hay error**."* Y sobre aplicar solo criterio técnico: *"diseño para ingenieros y no para el día a día de un oficinista de nivel medio-bajo; pobre, 0 comercial y sin visión hacia el cliente"*.

**En la práctica:**
- **Lo que se puede deducir, se deduce.** No se pregunta lo que el sistema ya sabe.
- Lo resuelto **se colapsa a una frase con su resultado**; la maquinaria se esconde.
- Lo que necesita acción: **una pregunta y botones grandes**, nunca enlaces de texto ni dos acciones del mismo peso apiladas.
- **Nada que exija interpretar.** Si algo no cuadra: se bloquea y se avisa al encargado.
- El texto de un botón dice **lo que hace** ("Recibir y meter al stock"), no lo que es.

---

_Estado vivo: `folvy_estado.md`. Frentes: `folvy_frentes.md`. Cierre: `folvy_cierre_sesion.md`. Historia completa (congelada): `CONTEXTO_CLAUDE.md` + repo._
