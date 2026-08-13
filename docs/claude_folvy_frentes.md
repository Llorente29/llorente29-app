# Folvy — Tablero de FRENTES (trabajo abierto)

> **Qué es**: la lista de frentes abiertos, una línea cada uno + a qué doc de detalle ir. El **frente activo y los 2-3 siguientes** están en `folvy_estado.md` (leer eso primero). Aquí está el mapa completo de lo que hay abierto.
> **Cómo se mantiene**: al cerrar un frente → fuera de aquí, resumen a `folvy_estado.md` y detalle a su `*_estado.md`. El **historial de cierres** vive en `folvy_archivo_YYYY-MM.md` (y lo anterior al 22/07, congelado en `folvy_guion_vivo.md`).
> **Antes de abrir un frente**: `project_search` + `conversation_search` del tema + **RECON en BBDD por MCP** (la BBDD es la verdad, no el doc).

---

## 🔴 ACTIVO / INMINENTE — orden por impacto (12/08/2026)

**El frente activo y su orden salen del cierre del 12/08.** Detalle vivo del activo en `folvy_estado.md`.

- 🔴 **RECEPCIÓN · rediseño de pantalla — ACTIVO.** La lógica funciona (casado → formato → coste, verificado en pantalla: 0,0092 €/ud); el diseño no sirve para un oficinista de nivel medio-bajo. Maqueta propuesta y aprobada como punto de partida. Es la puerta por donde entra el coste de todo el sistema. → `claude/folvy_recepcion_un_paso_diseno_20260812.md` · `claude/folvy_almacen_recepcion_estado.md`
- 🔴 **Repaso del camino "revisar borrador".** Quedan 2 sitios del mismo patrón (efecto de enlace a pedido `if (order || correcting) return` y Propuestas de `run_mapping` condicionadas a `ocrPrefill`). **Decidir de una vez la condición que gobierna la edición** (¿se puede editar esta línea? ≠ ¿vengo de escanear?), no cazarlos uno a uno. Es el ÚNICO camino que usa Llorente29 (`receipt_approval='oficina'`).
- 🟠 **T2200 + T2201** — escritas y sin aplicar. **Solo con servicio cerrado.** El lado cliente de T2201 se despliega ANTES (rama `feat/tpv-t1e-kitchen-name-cliente`). `kitchen_name` en el pase NO llega con T2201: migración aparte, **nunca el mismo día**.
- 🟠 **Robustez de tablet** — rama `fix/tablet-robustez` (1 commit sin mergear) + WIP de Julio. Era el frente de la mañana del 12/08 y no se tocó. El 11/08 a las 23:42 cerró Carabanchel (validaba el token con `kds_board` 1.895 ms contra `statement_timeout` 3 s → «token no válido» falso, impresión y latido muertos con la UI). Parche vivo: `anon.statement_timeout` 8 s — **no quitar hasta verificar en las 3 tablets.** → `claude/ENCARGO_CODE_tablet_robustez_20260812.md`
- 🟠 **Almacén > Movimientos (timeout)** — 5 intentos, causa no aislada. **Siguiente paso: RECON del frontend, capturar la llamada real**, no más SQL. Lo que sirvió: índice `idx_sm_account_loc_time` (370→25 ms).
- 🟡 **T7 · Rentabilidad viva** — T7.a entregado (rama `feat/t7a-menu-engineering`, sin mergear). Diferencial real: nadie cruza margen × popularidad × canal de forma nativa. Regla: sin escandallo completo, no hay cuadrante. → `claude/folvy_t7_rentabilidad_viva_diseno_20260812.md`
- 🟡 **MRP II / puntos de pedido (R5)** — diseñado el 10/08 y validado numéricamente el 12/08. **Depende de recepción y consumo limpios.** → `claude/folvy_almacen_stock_minimo_autorregulado_diseno.md`
- ⚪ **86 unificado de Last** — PARADO por decisión de Julio. Falta la ruta REST del "Stock de productos" por local; correo a Abraham sin enviar. (`menu_item.external_id` = `productId` de Last 494/494; `enabled:false` ≠ "agotado".) → `claude/folvy_86_unificado_last_diseno_20260812.md`
- ⚪ **Catcher: eventos sin log** — cualquier incidencia de reparto es indiagnosticable.

### Otros frentes abiertos (no reordenados arriba — se conservan con su puntero a doc)

- **🖥️ TPV PROPIO — T1 EN PRODUCCIÓN (PR #49, `fa00be9`).** Venta, modificadores, combos, nota de cocina, comandar, imprimir, guardar/recuperar cuenta, cobrar, entregar y **descuento de stock verificado**. Bug crítico cerrado: la rama `deliver` era inalcanzable → ninguna venta descontaba stock. **Pendiente:** aplicar la migración 1101 (nota de cocina al KDS/impresión — no se aplicó a propósito el día del incidente porque toca `orders_feed_by_token`) · **T1.f diseño** (4 commits en `feat/tpv-t1f-diseno`, sin mergear: faltan 4 correcciones de contraste + fotos + etiquetas superpuestas) · **T1.e cimientos** (encargo listo, rama sin crear) · T2.a caja · las 6 decisiones de arquitectura antes de T2. → **RECTOR:** `claude/folvy_mercado_objetivo_y_posicionamiento_20260811.md` · `claude/folvy_tpv_mapa_funcional_vs_mercado_20260811.md` · `claude/folvy_tpv_sistema_diseno_20260811.md` · `claude/folvy_tpv_decisiones_arquitectura_20260811.md` · encargos `ENCARGO_CODE_tpv_t1d_nota_cocina_y_modificadores.md` · `ENCARGO_CODE_tpv_t1e_cimientos.md` · `ENCARGO_CODE_tpv_t1f_diseno.md`

- **🖨️ IMPRESIÓN — principio permanente de Julio: *"las impresoras en cualquier cliente siempre son un problema"*.** Estado medido: 17 comandas de cocina realmente perdidas en 30 días · **156 trabajos encolados sin impresora asignada** · un `print_job` 9 días en "enviado" sin confirmar ni fallar · la ficha de impresora de Folvy no coincide con lo que usa la APK ("Pase" tiene `.130` en la base, sus errores apuntan a `.151`). Salidas evaluadas (Epson Server Direct Print, Star CloudPRNT, mixed content y Local Network Access de Chrome 142). → `claude/folvy_impresion_problema_y_salidas_20260811.md`

- **💶 CONCILIADOR DE LIQUIDACIONES — C1 APLICADO** (verificado en BBDD el 12/08; estaba anotado por error como "en pausa"): `match_status` reparte **537 casada · 21 sin_casar · 6.080 sin_origen = 6.638 exacto**, con cron diario. **Pendiente C2-C5:** cargar liquidaciones jul/ago · pantalla de discrepancias · reloj de disputa 30 días Uber · ingesta `settlement-extract`. → `claude/folvy_conciliador_liquidaciones_estado_20260811.md` · `claude/ENCARGO_CODE_conciliador_c1_metrica_y_llave.md`

- **🧾 LIQUIDACIÓN CTB — contraste julio HECHO** (ventas cuadran al 0,02 %; aritmética al céntimo; 43 precios cargados como `negotiated_price`; plantilla mensual aprobada). **Pendientes:** pedir a CTB criterio de "Compras" + detalle FV-02872 + devoluciones · **⏳ auditar abono por consumo según escandallo (bloqueado por P3)** · A2-bis (4-5 formatos con error de magnitud, con OK de Julio). → `claude/folvy_ctb_liquidacion_jul2026_contraste.md` · `claude/folvy_plantilla_contraste_liquidacion_ctb.md` · `claude/folvy_ventas_cedidas_modelo.md`

- **📦 Fiabilidad de ALMACÉN (10/08).** **EJECUTADO:** A2+A3+vigía+acción pulsable (PRs #44/#45) · P1 ciclo de compra (#46) + saneado 24 pedidos · **P1.b recepción móvil MERGEADO (#47)** — falta verificar en el muelle con recepción real. **Nuevo (12/08): barrido diario de coste de línea aplicado** (`sale_line_cost_sweep_diario`, cron 04:50) → cobertura de margen 34,3 % → **69,4 %**, food cost real **30,1 %**. **Pendiente:** alta de elaboraciones (movimiento "producción" no existe) · Fase C (coste medio; 72/470 valores negativos) · A1 (formatos duplicados) · P2-P7 · **93 de 336 ingredientes sin coste** · **bug: `folvy_shop` pickup nunca descuenta stock**. → `claude/folvy_almacen_fiabilidad_hallazgo_20260810.md` · `claude/folvy_almacen_auditoria_profunda_20260810.md` · stock mínimo autorregulado: `claude/folvy_almacen_stock_minimo_autorregulado_diseno.md`

- **🚚 Carabanchel/Catcher — DECISIÓN PENDIENTE DE JULIO.** Hoy despacha **Last** ("Catcher Carabanchel" enabled desde 05/03). Conexión Folvy creada y **pausada** (`56fef2f0-…`): Opción A (apagar en Last + encender Folvy) u Opción B (borrar conexión Folvy). → `claude/folvy_carabanchel_reparto_propio_hallazgo_20260810.md`

- **🆔 Código de pase** (tarjeta, ticket de bolsa, `catcher-dispatch`) — desplegar con cocina cerrada. → `claude/ENCARGO_CODE_codigo_de_pase_identificacion.md`
- **🍳 KPI de cocina — higiene del dato** (recalibrar umbrales tras ~1 semana). → `claude/folvy_kpi_tiempos_cocina_estado.md`
- **Alarma no-entregado** — Capas 1-4 en prod; Capa 5 desbloqueada. → `claude/folvy_alarma_no_entregado_estado.md`
- **HubRise self-service → GO-LIVE** — asistente mergeado; disponibilidad completa; auditoría de Antoine pendiente. Bloqueantes: plan/pago (tope 5), reconnect de bridges. → `claude/folvy_hubrise_golive_checklist.md`
- **Catcher producción** — ✅ operativo. Deuda: flip staging→api en repo · `orderSource:'lastapp'` invisible ante Catcher · `orderPickupTime` fijo +10 min. → `claude/folvy_catcher_produccion_encendido.md`
- **🟠 Dashboard de ventas — ranking descuadrado** (`slice(0,8)` + NULL brand_id).

## ✅ CERRADO ESTA SEMANA (fuera del tablero)
- **🚨 Latido del KDS — ARREGLADO DE RAÍZ Y VERIFICADO EN CARGA (12/08).** De ~107 escrituras/min a **3,00/min = 1 por tablet y minuto**, mismo ritmo con local lleno y vacío. `kds_heartbeat` es el único escritor de `last_seen_at`; **vigía 0912 (cron */5)** avisa si los escritores dejan de ser 3. Limpieza del KDS viejo entregada. → `claude/folvy_incidente_20260811_kds_device_bbdd_caida.md` · `claude/folvy_kds_latido_raiz_estado_aplicacion.md` · `claude/ENCARGO_CODE_limpieza_kds_viejo_y_prevencion_20260811.md`

## 🚦 DISPONIBILIDAD (86) — módulo COMPLETO 31/07 (C1-C3 en producción)
- ✅ Fases 0/A/B + C1 + C2 + C3a + C3b en producción. ✅ Semáforo tablet (4 grants a anon) arreglado 10/08. ✅ Dispatch v7 filtra por marca.
- **🟢 Roadmap:** auto-86 por stock — gated en fiabilidad de almacén; ahora también pieza #3 del bloque universal del benchmark TPV.
- **🩹 Deuda destapada 12/08:** el TPV lee la disponibilidad de `menu_item.is_available` (global, foto congelada de Last — 149/521 marcados no disponibles, 24 de 48 en desacuerdo con Last) en vez de `product_availability` (por local, la que gestiona Julio). **Confirmado por Julio: `is_available` no se usa para nada más.**

## 📱 TABLET / OTA
- ✅ Capa 1 (APK sideload) y Capa 2 (OTA Capgo) en producción, verificadas en tablet física (bundle 113→114).
- **🔴 Robustez** — ver ACTIVO arriba. **Regla nueva: ningún bundle sale antes que sus migraciones.**
- Pendiente: auditoría APK por tablet · MDM/`server.url` · la configuración real de impresoras vive en las tablets, no en Folvy.

## 💰 INCENTIVOS (RECON+BENCHMARK hechos)
- Diseño pendiente · ingesta de reseñas sin feed vivo · fichaje↔cuadrante (`clock_entries.scheduled` NULL).

## 🧱 NÚCLEO (bugs de raíz — sesión dedicada)
- Bloqueo por unidad no convertible · "Eliminar no elimina" · enlazado catálogo↔escandallo (**312 menu_items a receta vacía; 487 líneas de venta con receta vacía = 4.147 €**; top-25 en `claude/folvy_almacen_escandallos_prioridad_20260810.md` — bloquea la auditoría del abono CTB) · **`stock_movement.sale_line_id` a null en las 26.425 filas: columna muerta que hizo equivocarse a dos analistas el mismo día — o se rellena o se elimina** · **`short_name` vacío en los 1.103 productos** (el nombre corto es lo que hace legible un botón sin foto) · cobertura de escandallos.

## 📣 OFERTAS / RRSS · 🛒 SHOP / CRM
- Robot Uber · pantalla unificada de ofertas · 2x1 · Robot Glovo v4 · fixtures deportes · CRM F5-F9 · migrar Shop a estilo B · **bug: ventas `folvy_shop` pickup nunca completan → sin stock ni cierre**.

## 🍳 KITCHEN / ALMACÉN
- Ver ACTIVO (fiabilidad). Además: KPI F3 + foto-al-Listo · visión de cocina (diseño) · elaboraciones por día · limpieza de catálogo (611 muertos) · KDS Nivel 2 · alta de marcas (falta DELETE/archivar).
- **Anomalías de venta sin explicar:** Carabanchel lleva 3 meses sin vender un bocadillo (12 junio → 3 julio → 0 agosto; Alcalá vende 70/mes) · Alcalá no vendió ni un quesataco el domingo 9, entre 21 el sábado y 22 el lunes.

## 👥 TEAM
- **F10 en prueba en vivo** (cuadrante Alcalá 10/08 publicado — VIGILAR). Decisiones pendientes de Julio: 2-2-1 vs horas iguales (semana 17/08) · "Cubrir el resto" → ¿solver? · avería 09/08 sin `reason_code` · correo a Janaina. → `claude/folvy_team_f10_estado.md`
- Dimensionamiento Carabanchel · fix vacaciones sin commitear + gemelo `scheduler.ts` · QR anti-fraude · informes.
- **🟢 Contexto regulatorio (11/08):** registro digital de jornada aplazado a sept-2026 (dictamen desfavorable Consejo de Estado 23/03; sin BOE). Cuando entre: multas hasta 10.000 €/trabajador. **El control horario de Folvy será el gancho comercial nº 1.** → `claude/folvy_mercado_objetivo_y_posicionamiento_20260811.md` §6

## 🤖 ASISTENTE / COPILOTO (abierto 09/08, sin diseñar)
- Frontera innegociable: *el asistente propone, la persona publica*. Pendiente RECON + BENCHMARK (Skello ya lanzó capa conversacional). Primer caso real: la plantilla fantasma del solver. Material: `claude/folvy_team_asistente_cliente.md` (cliente) · `claude/folvy_team_contexto_agente.md` (⚠️ interno).

## 🖼️ PRODUCTO / IMAGEN · 💰 VALORACIÓN
- Sidebar móvil (`App.tsx`, permiso) · demo client · i18n (aparcado) · estudio valoración/pricing ENTREGADO (31/07).
- **Fotos de producto (12/08):** cobertura real **Foodint 96,4 % · cuenta de laboratorio 4,8 %**. El rediseño T1.f quitó fotos que ya existían — hay que devolverlas.
- **🆕 Last como fuente analítica de cedidas (10/08):** CubeJS 46 cubos; catálogo+86 por ubicación vía `getLocationProducts`; snapshot+diff para novedades CTB. Guardarraíl: Folvy NO escribe en Last **salvo el 86 unificado, cuando se resuelva el prerrequisito**. → `claude/folvy_mapa_sistema_addendum_20260810.md` §8

## 🧩 INFRA / OBLIGATORIOS / DEUDA
- **🔴 Seguridad pre-cliente-2** (358 DEFINER-anon, 77 search_path, 19 RLS sin políticas, rotaciones, bucket público) · **🔴 Drift repo↔prod**.
- **Parche vivo a revertir:** `anon.statement_timeout` 8 s (era 3 s) — quitar cuando la robustez de tablet esté verificada, no antes.
- "objetivo" con dos significados · Milanesa House vs Haus · hardcodes de marca (Fase 0) · OBLIGATORIOS 12/06 (A/B/C) · deuda HubRise (token global → Vault) · secretos pendientes de rotación · copia `folvy-release.jks`.
- **Uber por dos vías (HubRise + Last)** — verificar no-duplicación.

## 📦 SIGUIENTE (cuando se libere lo de arriba)
- T2 caja → T3 fiscal (Verifacti, **bloqueado por la firma de Julio**) → T4 sala → T5 offline (PowerSync) · conciliador C2-C5 · watchdog de downtime marca×plataforma (patrón Checkmate) · Magic Menu Quadrant (margen×popularidad sobre el escandallo) · capas 5-7 fiabilidad · tienda propia S1-S5.

---
_Detalle de cada frente: su `*_estado.md`. Historial: `folvy_archivo_2026-08.md` (entrada 11-12/08). Inventario técnico: `folvy_mapa_sistema.md` + addendum. Mapa de docs: `folvy_indice.md`._
