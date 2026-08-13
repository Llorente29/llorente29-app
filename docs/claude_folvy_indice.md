# Folvy — ÍNDICE de documentos (mapa: tema → doc)

> **Para qué**: antídoto contra "no sabía que existía ese doc". Antes de abrir un frente, además de `project_search`, mira aquí qué doc cubre el tema. Los `*_estado.md` = verdad viva del área; `*_diseno.md` = diseño/benchmark; ENCARGO_* = encargos a Claude Code.
> **Orden de arranque**: `folvy_arranque_prompt.md` (pegar al empezar) → `folvy_estado.md` (qué toca hoy) → `folvy_frentes.md` (todo lo abierto) → `folvy_mapa_sistema.md` (inventario técnico verificado) → **el `*_estado.md` del área** → **RECON en BBDD por MCP**. Reglas: `folvy_reglas.md`.
> **⚠️ REGLA 06/08**: leer **TODOS** los docs de la sección del área antes de diseñar. No basta con `project_search`.

## 🧭 Entrada, estado y reglas (los que se leen a diario)
- `folvy_arranque_prompt.md` — prompt de arranque de sesión, copiar y pegar. **Actualizado 12/08 (primero: el 86 unificado; frente activo: robustez de tablet).**
- `folvy_estado.md` — **leer primero**: frente activo + siguientes + bloqueos + cómo operar. **Actualizado 12/08.**
- `folvy_frentes.md` — tablero completo de frentes abiertos. **Actualizado 12/08.**
- `folvy_mapa_sistema.md` — **inventario técnico verificado contra BBDD**. ⚠️ NO cubre Team, app del trabajador, notificaciones, autoinventario, APPCC ni recepciones (RECON pendiente). **+ `claude/folvy_mapa_sistema_addendum_20260810.md`** — DOS orgs en Last (Cloudtown = cedidas · FOODINT NUEVO = propio), inventario de la conexión Last, CubeJS.
- `folvy_reglas.md` — **reglas no negociables**. **Actualizado 12/08: §5 nueva (7 reglas de la sesión del TPV y el incidente de tablet).**
- `folvy_cierre_sesion.md` — ritual de cierre (v2).
- `folvy_indice.md` — este mapa.
- `folvy_competitive_map.md` — mapa competitivo por área.

## 🗄️ Archivo (congelados — se buscan, no se leen enteros)
- `folvy_archivo_2026-08.md` — historial de cierres (append-only, entradas nuevas ARRIBA). **Entrada 11-12/08: T1 del TPV en producción · sistema de diseño · latido arreglado de raíz · Carabanchel cerrado por una tablet.**
- `folvy_archivo_2026-07.md` — historial de cierres (desde 22/07).
- `folvy_guion_vivo.md`, `CONTEXTO_CLAUDE.md` — ARCHIVADOS, no tocar.
- `folvy_addendum_sesion2_decisiones.md`, `folvy_reconciliacion_2026-05-21.md`, `folvy_arquitectura_reconciliada.md`, `folvy_v1_spec.md`, `folvy_auth_model.md` — base histórica.

## 🖥️ TPV PROPIO (T1 EN PRODUCCIÓN desde el 11/08 — PR #49)
- `claude/folvy_tpv_propio_viabilidad_20260810.md` — **decisión de Julio, fases T1–T5, estado vivo del frente.** Leer primero.
- `claude/folvy_tpv_mapa_funcional_vs_mercado_20260811.md` — **🆕 ~120 funciones del TPV contra Last, Revo, Ágora, Glop, Lightspeed, TouchBistro y Foodtic.** Qué gana, qué empata, qué falta. De aquí sale T1.e.
- `claude/folvy_tpv_sistema_diseno_20260811.md` — **🆕 SISTEMA DE DISEÑO (rector de toda pantalla del TPV)**: tokens, 76 px táctiles (96 en Cobrar), contraste WCAG 2.2 medido, estado nunca solo por color, cuatro anchuras con una sola base de código, fotos. Maqueta aprobada: `folvy_tpv_diseno.html`.
- `claude/folvy_tpv_decisiones_arquitectura_20260811.md` — **🆕 las 6 decisiones cerradas** (append-only, UUIDv7 en cliente, rangos fiscales por dispositivo, Verifacti, PowerSync, puertos de dispositivo).
- `claude/folvy_tpv_benchmark_mercado_20260811.md` — benchmark global+España+delivery+técnico. VeriFactu = billete de entrada (comprar Verifacti). Offline = PowerSync.
- `claude/folvy_mercado_objetivo_y_posicionamiento_20260811.md` — **DOC RECTOR de mercado**: 267k locales, dark kitchens 0,2 %, delivery en contracción, control horario como gancho nº 1, prueba del "bar con terraza".
- `claude/folvy_onboarding_plantillas_tipo_negocio_20260811.md` — **🆕** plantillas de arranque por tipo de negocio.
- **Encargos:** `ENCARGO_CODE_tpv_t1_venta.md` (T1, mergeado) · `ENCARGO_CODE_tpv_t1b_codigo_ticket_y_ruta.md` (mergeado) · `ENCARGO_CODE_tpv_t1c_device_y_sesion.md` · **`ENCARGO_CODE_tpv_t1d_nota_cocina_y_modificadores.md`** (mergeado; cerró el ciclo de venta) · **`ENCARGO_CODE_tpv_t1e_cimientos.md`** (🆕 cimientos irreversibles: régimen fiscal, PAX, nombre de cocina, comanda de anulación, reimprimir/buscador — **rama sin crear**) · **`ENCARGO_CODE_tpv_t1f_diseno.md`** (🆕 aplicar el sistema de diseño — 4 commits sin mergear) · `ENCARGO_CODE_tpv_t2a_caja.md` (caja, en espera).

## 🚨 Incidentes
- **`claude/ENCARGO_CODE_tablet_robustez_20260812.md` — 🔴 PRIORIDAD MÁXIMA (11/08, 23:42: Carabanchel cerró).** La tablet validaba el token con `kds_board` (1.895 ms) contra un `statement_timeout` de 3 s → mensaje falso de token revocado, impresión y latido muertos con la UI. Solución: `device_location_by_token` (16 ms), reintento con espera creciente, mensajes honestos, latido/impresión fuera de la UI, reintento de impresión.
- `claude/folvy_incidente_20260811_kds_device_bbdd_caida.md` — **BBDD caída 45 min por el latido del KDS (11/08).**
- `claude/folvy_kds_latido_raiz_estado_aplicacion.md` — **🆕 estado de aplicación del arreglo de raíz: verificado en carga, 3,00 escrituras/min.**
- `claude/ENCARGO_CODE_kds_latido_raiz.md` + `claude/ENCARGO_CODE_kds_latido_raiz_adenda_20260811.md` — el encargo y su adenda.
- `claude/ENCARGO_CODE_limpieza_kds_viejo_y_prevencion_20260811.md` — **🆕** limpieza del KDS viejo + prevención de recaída (vigía de escritores).
- `claude/folvy_averia_20260809_cierre_alcala.md` — cierre de Alcalá 09/08 sin `reason_code`.
- `claude/folvy_hubrise_incidente_20260806_duplicado_y_codigo.md`.

## 🖨️ IMPRESIÓN (frente permanente — *"siempre es un problema"*)
- **`claude/folvy_impresion_problema_y_salidas_20260811.md` — 🆕 el problema medido y las salidas evaluadas** (Epson Server Direct Print, Star CloudPRNT, mixed content y Local Network Access de Chrome 142). Contiene el principio permanente de Julio.
- `claude/folvy_impresion_nativo_vs_poll_diseno.md` · `claude/folvy_impresion_checklist_tablet.md` · `claude/ENCARGO_CODE_config_impresion.md` · `claude/ENCARGO_CODE_autoprint_y_reimprimir.md` · `claude/ENCARGO_CODE_calidad_tickets.md` · `claude/ENCARGO_CODE_impresion_onboarding.md`.

## 💶 Liquidaciones / conciliación / ventas cedidas
- `claude/folvy_conciliador_liquidaciones_estado_20260811.md` — **estado del conciliador Glovo/Uber/JustEat. C1 APLICADO (537/21/6.080 = 6.638 exacto, cron diario).** Pendiente C2-C5.
- `claude/ENCARGO_CODE_conciliador_c1_metrica_y_llave.md` — **🆕** el encargo de C1 (métrica y normalización de llave).
- `claude/folvy_ctb_liquidacion_jul2026_contraste.md` — **contraste completo de la liquidación CTB julio.** §6.bis: pendiente auditar abono por escandallo (bloqueado por P3).
- `claude/folvy_plantilla_contraste_liquidacion_ctb.md` — **plantilla mensual aprobada**.
- `claude/folvy_ventas_cedidas_modelo.md` · `claude/folvy_ventas_inteligencia_diseno.md` · `folvy_economia_plataformas_diseno.md`.

## 👥 TEAM / personal / previsión / app del trabajador
- `claude/folvy_team_estado.md` — **VERDAD VIVA DEL ÁREA (06/08)**. Leer SIEMPRE antes de tocar Team.
- `claude/folvy_team_f10_estado.md` — **✅ F10 solver en producción; cuadrante 10/08 PUBLICADO (prueba en vivo — VIGILAR).** 11 decisiones vigentes.
- Encargos F10 (cerrados, historia del razonamiento): `ENCARGO_CODE_f10_plantilla_fantasma.md` · `ENCARGO_CODE_f10_reparto_justo.md` · `ENCARGO_CODE_f10_descanso_entre_semanas.md` · `ENCARGO_CODE_f10_semilla_frontera.md` · `ENCARGO_CODE_f10_solver.md` · (superados: `ENCARGO_CODE_f10_reparto.md`, `ENCARGO_CODE_cubrir_el_resto.md`).
- `claude/folvy_team_guia_modelo_de_trabajo.md` · `claude/folvy_team_asistente_cliente.md` (apto cliente) · `claude/folvy_team_contexto_agente.md` (⚠️ INTERNO) · `claude/ENCARGO_CODE_team_completo.md` (marco 12 fases) · `claude/folvy_team_auditoria_datos_vivos_20260806.md` · `claude/folvy_team_sistema_visual_y_mapa_pantallas.md` · `claude/folvy_team_generador_cuadrantes_diseno.md` · `claude/folvy_team_control_horario_profesional_diseno.md` · `claude/folvy_team_autoscheduling_benchmark_diseno.md` · `claude/folvy_personal_cocina_estado.md` · `claude/folvy_prevision_cuadrante_cierre.md` · `folvy_prevision_demanda_estudio.md`.
- *Superados*: `ENCARGO_CODE_team_v1_lanzamiento_septiembre.md`, `ENCARGO_CODE_team_control_horario_profesional.md`.

## 🤖 ASISTENTE / COPILOTO (frente 09/08 — sin diseñar)
- `claude/folvy_frentes.md` § ASISTENTE — encuadre. Pendiente RECON + BENCHMARK.

## 🍳 KPI de cocina e INCENTIVOS
- `claude/folvy_kpi_tiempos_cocina_estado.md` · `claude/folvy_kpi_cocina_f2_diseno.md` · `claude/folvy_kpi_tiempos_cocina_diseno.md` · `claude/folvy_incentivos_recon.md` · `claude/folvy_incentivos_benchmark.md` · `claude/folvy_guia_cocina_orders.html`.

## 🛵 Reparto / delivery / canales / DISPONIBILIDAD (86)
- `claude/folvy_carabanchel_reparto_propio_hallazgo_20260810.md` — **quién despacha Carabanchel (Last); conexión Folvy pausada; decisión A/B pendiente.**
- `claude/folvy_reparto_propio_estado.md` · `claude/folvy_reparto_propio_diseno.md` · `claude/folvy_reparto_config_diseno.md` · `claude/folvy_alarma_no_entregado_estado.md` · `claude/folvy_reparto_legal_investigacion.md` · `claude/folvy_ley_rider_autofactura.md` · `claude/folvy_llorente29_modelo_reparto_legal.md` · `claude/folvy_catcher_produccion_encendido.md`.
- **HubRise**: `claude/folvy_hubrise_golive_checklist.md` · `claude/folvy_hubrise_catalogo_selfservice_diseno.md` · `claude/folvy_hubrise_glovo_estado.md` · `claude/folvy_hubrise_diseno_integracion_conectores.md` · `claude/ENCARGO_CODE_hubrise_conexion_escritora.md` · `claude/ENCARGO_CODE_hubrise_asistente_conectar_marca.md` · `claude/ENCARGO_CODE_fotos_combos_hubrise.md` · `claude/folvy_marcas_duplicadas_hallazgo.md` · `claude/folvy_hubrise_respuesta_antoine_20260807.md`.
- **DISPONIBILIDAD (86)**: `claude/folvy_hubrise_cierre_pausa_horarios_diseno.md` · `claude/folvy_disponibilidad_modulo_profesional_diseno.md` · encargos C1/C2/C3a/C3b · `claude/ENCARGO_CODE_86_multiseleccion_y_lote.md` · `claude/folvy_hubrise_86_sku_compartido_hallazgo.md` · `claude/folvy_hubrise_horarios_pausa_por_marca_analisis.md`.
  - **⚠️ 86 unificado Folvy↔Last (12/08):** `claude/folvy_86_unificado_last_diseno_20260812.md` — las dos capas de Last y por qué está parado (falta la ruta REST del "Stock de productos" por local). El prerrequisito y el error de `enabled:false` también en `folvy_estado.md` § 86 unificado.

## 📱 Tablet / OTA / apps nativas
- **`claude/ENCARGO_CODE_tablet_robustez_20260812.md` — 🔴 el encargo activo.**
- `claude/folvy_actualizacion_tablets_diseno.md` · `claude/ENCARGO_CODE_actualizacion_tablets_capa2_ota.md` · `claude/folvy_pipeline_apk_estado.md` · `claude/folvy_app_nativa_fase1_diseno.md` · `claude/folvy_play_dossier.md`.
- ⚠️ **La APK empaqueta la web: un deploy de Vercel NO llega a las tablets** — llega por OTA (Capgo). **Y ningún bundle sale antes que sus migraciones.**

## 🎓 Formación
- `claude/folvy_formacion_auditoria_externa.md` · `claude/folvy_formacion_benchmark_competencia.md`.

## 📣 Ofertas / RRSS / plataformas · 🛒 CRM / Shop
- `claude/folvy_uber_robot_estado.md` · `claude/folvy_2x1_marcas_propias_estado.md` · `folvy_sistema_2x1_diseno.md` · `folvy_agente_ofertas_v3_diseno.md` · `folvy_rrss_diseno.md` · `folvy_crm_diseno_v2.md` · `claude/folvy_customer_notification_estado.md`.

## 🍳 Kitchen / ALMACÉN / ventas / costes / fiabilidad / visión
- `claude/folvy_almacen_auditoria_profunda_20260810.md` — **AUDITORÍA MRP II 10/08**: plan P1-P7. P1 ✅ (#46) · P1.b ✅ (#47, verificar en muelle).
- `claude/folvy_almacen_fiabilidad_hallazgo_20260810.md` — hallazgo + ejecución A2/A3/vigía (PRs #44/#45). Pendiente: Fase C, A1, elaboraciones.
- `claude/folvy_almacen_stock_minimo_autorregulado_diseno.md` — **diseño del stock mínimo con estudio histórico + lanzamiento automático (MRP II) + benchmark líderes.**
- `claude/folvy_almacen_escandallos_prioridad_20260810.md` — top-25 productos vendidos sin descontar. Campaña P3.
- `claude/folvy_almacen_reclamaciones_proveedor_nota.md` — P6.b: no existe sistema de reclamaciones.
- Encargos almacén 10/08: `ENCARGO_CODE_almacen_stock_unidad_base.md` · `ENCARGO_CODE_almacen_vigia_stock_negativo.md` · `ENCARGO_CODE_almacen_vigia_fix_rpc_cliente.md` · `ENCARGO_CODE_almacen_vigia_accion_pulsable.md` · `ENCARGO_CODE_almacen_p1_ciclo_compra.md` · `ENCARGO_CODE_almacen_p1b_recepcion_movil.md`.
- `claude/folvy_sistema_garantia_fiabilidad_almacen.md` · `folvy_fiabilidad_casado_diseno.md` · `claude/folvy_pantalla_ventas_sin_descuento_diseno.md` · `claude/folvy_elaboraciones_por_dia_semana.md` · `claude/folvy_vision_plan_ejecucion.md` · `claude/folvy_vision_benchmark_mundial.md` · `claude/folvy_vision_diseno_v0_captura.md` · `folvy_v1_editor_escandallos_diseno.md`.
- **RECEPCIÓN (frente activo 12/08):**
  - `claude/folvy_recepcion_un_paso_diseno_20260812.md` — **DISEÑO RECTOR de la recepción**: de 4 pasos a 1, stock al recibir, memoria de casado, revisión de oficina no bloqueante, R5 puntos de pedido.
  - `claude/folvy_coste_recepcion_blindaje_diseno.md` — blindaje del coste (coste de referencia vs real).
  - `claude/folvy_almacen_recepcion_estado.md` — **estado vivo del área** (los 5 bugs del mismo patrón, números medidos, caso Pan de Pita).
  - Encargos 12/08 (los tres mergeados): `claude/ENCARGO_CODE_enlace_pedido_recepcion.md` · `claude/ENCARGO_CODE_recepcion_selector_formato.md` · `claude/ENCARGO_CODE_recepcion_casado_automatico.md`.
- **VENTAS / ANALÍTICA:** `claude/folvy_t7_rentabilidad_viva_diseno_20260812.md` — matriz margen × popularidad. Regla: sin escandallo completo, no hay cuadrante.

## 💰 Valoración / negocio · 🎨 Marca / arquitectura
- `claude/folvy_valoracion_pricing_rondas_estudio.md` · `claude/folvy_auditoria_diseno_externa.md`.
- `folvy-brand-spec.md` — **paleta real: marino `#1E3A5F`, terracota `#D67442`, crema `#F5F4F0`**. ⚠️ El TPV usa el sistema de diseño propio (`folvy_tpv_sistema_diseno_20260811.md`), no la paleta de marca: en pantalla de servicio manda el contraste.
- `folvy_integraciones_modulo_diseno.md` · `OBLIGATORIO_acceso_trabajador_reentrada.md` · `ENCARGO_CLAUDE_CODE_local_y_pantalla_marca.md`.

---
_Al crear un doc nuevo, añádelo aquí en su sección. Al cerrar un frente, su resumen va a `folvy_estado.md` y el detalle a su `*_estado.md`._
