# Folvy — Archivo de cierres · agosto 2026

> Append-only. Entradas nuevas ARRIBA. La historia congelada vive aquí; el estado vivo en `folvy_estado.md` y el detalle de área en su `*_estado.md`.

## 12/08/2026 — El día del motor de stock (y de las piezas desconectadas)

**Sesión larga. Se arregló el motor de consumo de punta a punta y se destapó el patrón de fondo del proyecto.** Detalle: `folvy_almacen_recepcion_estado.md`, `folvy_estado.md`.

**Cerrado y verificado en vivo:**
- **El stock se descuenta al ENTRAR la venta** (antes: al cerrarla, y el 3,68 % nunca se cerraba → 5.103 € sin descontar desde el 12/06). Segunda corrección el mismo día: dispara **al escribir las líneas**, no al nacer la venta. Migraciones `T1520` + `T1700`.
- **HubRise casaba CERO productos** — ninguno de sus pedidos había descontado stock nunca. Dos causas encadenadas: referencia con namespace (`marca:uuid`, `shr_`) comparada literal, y filtro `external_source='hubrise'` cuando el catálogo real viene de Last. 29 de 32 reprocesados **sin** tocar stock (frontera del sábado respetada).
- **TPV: 146 productos que el camarero no podía abrir.** **Shop: 46 ocultos al cliente final** (Bendito Burrito pasó de 17 a 28). Ambos por leer `menu_item.is_available` — columna muerta importada de Last — en vez de `product_availability`, y sin filtrar por local.
- **Autoinventarios**: existía `autoclose_daily_count` y **nadie la llamaba**; conteos parados >20 h con el trabajo hecho. Cron `autoinventory-autoclose` (jobid 46).
- **Recepción**: enlace pedido↔recepción reparado (llevaba 1 de 105), casado automático (83 de 97 líneas) y selector de formato. 4 PR (#54–#57). **Cadena verificada en pantalla: 0,0092 €/ud.**
- **224 ventas viejas** cerradas sin tocar stock (frontera del sábado 8/08).
- Vigía `sales_without_consumption` + rediseño T7 y del ciclo de recepción.

**El hallazgo de la sesión — SIETE piezas construidas, correctas y DESCONECTADAS:** `negotiated_price` (no alimenta el coste) · `price_drift_for` (avisa, nunca bloquea) · `autoclose_daily_count` (nadie la llamaba) · `learn_from_receipt` (nadie la consultaba, con 248 filas aprendidas) · P1 ciclo de compra (mergeado el 10/08, el enlace no estaba donde se confirma) · `stock_level` (tabla correcta, **0 puntos de pedido**) · el diseño MRP II del 10/08 (redescubierto a base de SQL sin buscarlo primero).

> Julio: *"siempre que se dejan buenas ideas, mueren o no se conectan. Es el gran mal y defecto de Folvy; tú lo estás viendo, cómo muere en las conexiones de la info."*
>
> **Regla nueva:** ninguna pieza se da por terminada hasta que **algo la consume** y se ha verificado con datos reales que la consume. La cuarta pata de la tríada (§6 de `folvy_reglas.md`).

**Bloqueado por decisión de Julio:** el 86 unificado de Last. Probado que Folvy lee y escribe disponibilidad, pero en Last hay **dos capas** que solo propagan en un sentido (agotar en la pantalla de Stock baja al catálogo; escribir en el catálogo **no** sube al Stock). Falta la ruta REST del "Stock de productos" por local; correo a Last redactado y sin enviar.

**Sigue sin resolver:** Almacén > Movimientos (timeout, 5 intentos, causa no aislada) y el diseño de la pantalla de recepción, que pasa a ser el frente activo.

## 11-12/08/2026 — T1 del TPV en producción · sistema de diseño · el latido arreglado de raíz · y un local cerrado por una tablet

Sesión larga y desigual: se cerró el frente técnico más grande del TPV y, la misma noche, un fallo de robustez cerró un local. Julio: *"cada día me preocupa más si está bien diseñado el APK para tablet, es muy grave todo esto"*.

### 1. T1 del TPV MERGEADO a producción (PR #49, `fa00be9`)

Ciclo de venta completo y verificado en vivo: venta, modificadores con contador y `group_type`, combos, **nota de cocina de punta a punta**, comandar, imprimir, **guardar y recuperar cuenta** (`pos_open_sales` + panel de cuentas), cobrar, **entregar** y **descuento de stock verificado** — 22 movimientos reales de ingredientes, packaging incluido.

**🔴 Bug crítico destapado al verificar:** la rama `deliver` de `upsert_pos_sale` era **inalcanzable** — un guard anterior abortaba con "la cuenta ya está cerrada". Es decir: **ninguna venta del TPV descontaba stock jamás.** Arreglado por sustitución quirúrgica (`tpv_t1d_fix_deliver_inalcanzable`) y verificado con venta real.

### 2. El latido del KDS, arreglado de raíz

Del incidente del 11/08 (BBDD caída 45 min): **de ~107 escrituras/min a 3,00/min = exactamente 1 por tablet y minuto**, medido con local lleno y con local vacío. `kds_heartbeat` es el único escritor de `last_seen_at`, y hay **vigía (0912, cron */5)** que avisa si los escritores dejan de ser 3.

### 3. Costes: la métrica que estaba rota

Cobertura de margen **34,3 % → 69,4 %** (3.712 líneas reparadas por barrido `sale_line_cost_sweep_diario`, cron 04:50). Ingreso con margen conocido: 56.083 € → **112.089 €** de 166.140 € (90 días). **Food cost real 30,1 %** — el 10,5 % que devolvía la consulta ingenua era la métrica rota, no un margen espectacular.

### 4. Sistema de diseño del TPV (corrección de rumbo de Julio)

Julio, viendo el panel de cuentas: *"ya estás montando pantallas que parecen listados de los antiguos de papel pijama… esto lo van a usar camareros, algunos con niveles muy bajos de formación… sin diseño no hay venta, lo buscas de los líderes y lo copias"*.

- **Sistema de diseño con números medidos**, no adjetivos: tokens, objetivos táctiles 76 px (96 en Cobrar), contraste WCAG 2.2, estado nunca solo por color, ninguna letra encogida. → `folvy_tpv_sistema_diseno_20260811.md`
- **Maqueta interactiva aprobada** (`folvy_tpv_diseno.html`) con toggle "Reglas" que enseña cada medida sobre la propia pantalla.
- **Multiplataforma exigida por Julio** ("ordenadores, Windows, Apple, Android, tablet, móviles"): cuatro anchuras, una sola base de código; tablet horizontal como formato de referencia; móvil = comandero.
- **Contraste medido, 4 fallos encontrados** en mi propia propuesta: `--accent` daba 3,68:1 con blanco, `--warn` 4,43:1 sobre su tinte, `--line` 1,38:1. Corregidos con valores calculados, no a ojo.
- **Regla nueva que nace de aquí:** ningún encargo de pantalla se da por terminado sin especificación visual. El panel gris hacía **exactamente** lo que pedía mi encargo; el encargo era el que estaba incompleto.

### 5. Mapa funcional del TPV contra el mercado

~120 funciones comparadas contra Last, Revo, Ágora, Glop, Lightspeed, TouchBistro y Foodtic. Encargo de Julio: *"un listado de lo que hará contra lo que hacen los mejores"*. Salieron cuatro cimientos que hoy son columnas y mañana son migraciones con dinero encima → encargo T1.e. → `folvy_tpv_mapa_funcional_vs_mercado_20260811.md`

**Decisión de Julio sobre el alcance**, ante el argumento de que Llorente29 no necesita sala ni caja: *"pero si no lo hacemos ya ¿cómo se va a vender? ¿qué cliente se va a ofrecer a ser conejillo de indias? Hay que tenerlo, tenerlo completo, tener el mejor. Usar a Llorente29 en todo lo que se pueda para el desarrollo del TPV, en paralelo intentar encontrar clientes que lo quieran."*

### 6. 🔴 INCIDENTE 23:42 — Carabanchel cerró por una tablet

La tablet cogió el bundle 114 por OTA, se reinició, y al arrancar validó el token **llamando a `kds_board`** (medido: **1.895 ms** con pedidos vivos, 988 ms con el local vacío) contra el `statement_timeout` de `anon`, entonces **3 s**. Superó el corte → pantalla **«El token no es válido o fue revocado»** — *falso*, el token estaba y sigue activo. **La impresión y el latido murieron con la interfaz.** Nadie se enteró: Julio lo supo por una foto de WhatsApp. Último pedido 22:32, **local cerrado a las 23:42**.

Mitigado con reinicio + `anon.statement_timeout` a 8 s (parche temporal, no quitar hasta verificar). **Existe desde siempre la función barata: `device_location_by_token` tarda 16 ms y devuelve además el local y la etiqueta.** Encargo entregado con prioridad máxima, por delante de la caja. → `ENCARGO_CODE_tablet_robustez_20260812.md`

### 7. Conciliador C1: estaba aplicado y yo lo tenía en pausa

Descubierto **durante el cierre**, verificando en la base en vez de en el doc: `match_status` reparte **537 casada · 21 sin_casar · 6.080 sin_origen = 6.638 exacto**, con cron diario. Llevaba días anotado como "en pausa".

### 8. 86 unificado Folvy↔Last (propuesta de Julio) — con un prerrequisito

Julio: *"además de 86 para las marcas propias… que se pudiera montar otro 86 paralelo o junto para Last"*. Lo sólido: **`menu_item.external_id` ES el `productId` de Last, 494 de 494** — la llave existe y está completa; la API escribe disponibilidad por local.

**⚠️ Y aquí está el fallo del día:** entregué un informe de "44 productos desactivados en Alcalá" y **la pantalla que usa Julio muestra 2**. Causa: **`enabled: false` no significa "agotado"**, significa "no forma parte de la carta activa de este local" — incluye catálogo histórico, marcas de otras ciudades y duplicados (9 "AGUA 50 CL", 9 "FANTA NARANJA", 6 "FANTA LIMÓN": el mismo refresco repetido por marca). De los 44, **19 ni existen en Folvy**. Julio: *"llevamos más de media hora de informe y sin terminar aún ¿para que sea falso?"*.

Antes de diseñar nada del 86 unificado hay que **localizar qué campo mueve el interruptor de "Stock de productos" de Last**. Construir sobre `enabled` significaría que agotar en Folvy saca el producto de la carta entera.

### Lecciones de método (las caras)

- **Si un dato no cuadra con lo que Julio ve en pantalla, se para en ese momento y se dice.** No se sigue puliendo un informe falso.
- Julio, sobre aplazar un error: *"cuando alguien se equivoca y la solución es 'mañana lo vemos' es que no quiere hacerlo. La próxima vez me lo dices directo y no perdemos tiempo."*
- **Verificar en la base, no en el repo ni en el doc**: el conciliador llevaba días funcionando y anotado como parado.
- **Ningún bundle antes que sus migraciones.** El OTA llega a las tablets en minutos; una migración pendiente convierte eso en un local cerrado.
- **Un punto de verificación que no se puede ejecutar se reporta como no ejecutado**, nunca como superado.
- **Las impresoras siempre son un problema en cualquier cliente** (principio permanente de Julio). Todo lo que se diseñe con impresora asume que fallará.
- Me equivoqué tres veces con números y las tres las corrigió Julio o una segunda medición: el stock que "no se descontaba" (buscaba por una columna muerta, `sale_line.sale_line_id`, null en 26.425 filas), las "65 comandas perdidas" (eran **17**; mezclaba etiquetas de bolsa) y el "48,1 % de fotos" (era la media de dos cuentas: **Foodint 96,4 %**, laboratorio 4,8 %).

### El patrón que ordena casi todo

Cuatro incidentes distintos, la misma enfermedad: **algo se resuelve una vez, en caliente, y si ese momento falla, nadie vuelve.** El latido escribía en cada lectura · la impresión muere al primer fallo · el coste se calcula al entrar la venta · la tablet valida el token una vez.

**La cura es siempre la tríada: quien lo hace en caliente · un barrido que repara lo atrasado · un vigía que mide y avisa.** Regla: ningún dato derivado se da por terminado sin sus tres patas.

→ Encargos del día: `ENCARGO_CODE_tpv_t1d_nota_cocina_y_modificadores.md` · `ENCARGO_CODE_tpv_t1e_cimientos.md` · `ENCARGO_CODE_tpv_t1f_diseno.md` · `ENCARGO_CODE_tablet_robustez_20260812.md` · `ENCARGO_CODE_limpieza_kds_viejo_y_prevencion_20260811.md`
→ Docs nuevos: `folvy_tpv_sistema_diseno_20260811.md` · `folvy_tpv_mapa_funcional_vs_mercado_20260811.md` · `folvy_impresion_problema_y_salidas_20260811.md` · `folvy_tpv_decisiones_arquitectura_20260811.md`

---

## 10-11/08/2026 — Maratón: fiabilidad de almacén ejecutada · nace el frente TPV · liquidación CTB auditada · caída de BBDD por el latido del KDS (resuelta)

Sesión larguísima (tarde del 10 a madrugada del 11). Cinco bloques.

### 1. Fiabilidad de almacén: de hallazgo a producción en un día
- **A2** (formatos con error de magnitud: Alto Oleico 25→25000, Mozzarella 200→2000) aplicado por BBDD.
- **A3 — stock en unidad base** + **vigía de stock negativo** (RPC `negative_stock_report`, umbral anti-ruido 5 % del consumo, clasificación de causa) + **acción pulsable** (Ajustar/Contar universal + atajo a recepción si hay proveedor): **PRs #44 y #45 en producción**, verificados en vivo (7 alertas reales en Carabanchel, ruido silenciado).
- **Auditoría profunda MRP II** (encargo de Julio): la cadena pedido↔albarán↔ingreso existe en esquema y está desconectada en la práctica (1/101 recepciones enlazadas); 28 % de ventas sin descontar stock. Plan P1–P7. → `folvy_almacen_auditoria_profunda_20260810.md`
- **P1 ciclo de compra en producción (PR #46)** + saneado de 24 pedidos colgados (solo queda PED-00036). **P1.b recepción móvil (escanear-primero, parciales, cierre corto): PR #47 MERGEADO** tras arreglar un build roto de Vercel (lección: `tsc -b`, no `tsc --noEmit`).
- **Diseño del stock mínimo autorregulado** (motor semanal con histéresis + gate de fiabilidad + benchmark MarketMan/Apicbase/Supy). → `folvy_almacen_stock_minimo_autorregulado_diseno.md`
- 4 bugs del patrón `const rpc = supabase.rpc` (pierde el `this`) cerrados.

### 2. Incidente G782 + inventario de la conexión Last
- Pedido G782 53 min sin rider: la alarma era VERDADERA. Causa: Carabanchel despacha por **Last** (integración "Catcher Carabanchel" activa desde 05/03), no por Folvy. Conexión Folvy creada y **PAUSADA** esperando decisión A/B de Julio. Tres diagnósticos erróneos por consultar `getIntegrations` sin `organizationId` (responde por Cloudtown). → `folvy_carabanchel_reparto_propio_hallazgo_20260810.md`
- **Dos organizaciones en Last**: Cloudtown = MARCAS CEDIDAS (no "antiguo") · FOODINT NUEVO = negocio propio. Inventario completo de lo accesible (CubeJS 46 cubos, getLocationProducts con 86 por ubicación). → `folvy_mapa_sistema_addendum_20260810.md`

### 3. Nace el frente TPV (decisión de Julio: "último eslabón, TPV completo, funcional, moderno")
- **Pliego funcional del POS de Last** levantado de su documentación pública (~60 funciones + 14 huecos). Arquitectura real verificada: master Android + slave Electron, EPSON ESC/POS, **la caja cuelga de la impresora** (no copiar). → `folvy_tpv_pliego_funcional_last_20260810.md`
- **Benchmark de mercado** (globales + España + delivery-first + técnico 2026). ⚠️ RECTIFICACIÓN: Last SÍ tiene VeriFactu ("activable en 24 h, incluido") — **VeriFactu es billete de entrada, no diferencial**; comprar pasarela (Verifacti), no motor propio. Offline: PowerSync (Sync Streams GA 05/2026). 6 decisiones de arquitectura antes de T2 (append-only, UUIDv7 cliente, rangos fiscales por dispositivo…). → `folvy_tpv_benchmark_mercado_20260811.md`
- **Corrección de encuadre de Julio**: "Folvy es un SaaS para toda la hostelería; las dark kitchen son la porción más pequeña". Números: 266.837 locales, dark kitchens ~0,2 %; el delivery **se contrae** (−7 % en 2025); el hueco es el operador independiente (TPV+personal+coste real); **control horario = mejor gancho comercial** (registro digital obligatorio inminente). T4 (sala) pasa a núcleo; el caso rector de T1 es la barra. → `folvy_mercado_objetivo_y_posicionamiento_20260811.md` (**doc rector**)
- **T1 CONSTRUIDO por Code** (rama `feat/tpv-t1-venta`, commits 2961441/93f820f/dfdf229, build READY): pantalla `/tpv`, pop-up modificadores/combos reutilizando dishConfigService, RPC `upsert_pos_sale` (save/command/charge/deliver) calcando la convención de Folvy Shop, contador diario de tickets (`pos_ticket_counter`, corte 4h Madrid), ruta cableada en App.tsx (permiso explícito; FUERA de AccountStatusGate a propósito). **3 migraciones aplicadas y verificadas.** Decisiones de RECON: `service_type='pickup'` + canal; `source='folvy_pos'`; Comandar/Cobrar topan en `accepted`; "Entregado" cierra a `completed` y dispara consumo (a las pickup hoy no las completa nadie — bug hermano: **folvy_shop nunca ha descontado stock**). IVA: hostelería 10 % íntegro (corrección de Julio con AEAT; falsa alarma de "IVA mixto" retirada). **Checklist de mostrador PENDIENTE; PR sin abrir.**

### 4. Liquidación CTB julio auditada + conciliador
- **Ventas cuadran al 0,02 %** (21.788 € base): regla `Folvy/1,10 = CTB`; Last coincide al céntimo en Glovo. Aritmética 25 %/35 %/IVA/saldo verificada al céntimo. **Punto ciego: 546 € de devoluciones** (refund_amount siempre 0 → encargo corto pendiente). Compras: modelo aclarado por Julio (la Relación = almacén del negocio cedido; abonan consumo de sus ventas por escandallo); cruce por producto hecho (58 % imputado ≈ peso de sus marcas). **⏳ PENDIENTE GRANDE: auditar el abono por consumo según escandallo — bloqueado por la campaña de escandallos (P3).** 4 formatos más con error de magnitud destapados (patata 12,5 kg, gouda, tortilla, mozzarella). **43 precios CTB cargados como `negotiated_price`** (backup previo). **Plantilla mensual aprobada.** → `folvy_ctb_liquidacion_jul2026_contraste.md` · `folvy_plantilla_contraste_liquidacion_ctb.md`
- **Conciliador de liquidaciones** (interés fuerte de Julio: "eso me da de comer"): RECON — las tablas YA existen con 6.638 líneas; el casado está al 4,6 % por dos causas identificadas (almohadilla en Uber: fix de una línea → 68 %; y sin solape temporal). **3.410 € sin casar solo en junio.** Plan C1–C5. → `folvy_conciliador_liquidaciones_estado_20260811.md`

### 5. 🔴 INCIDENTE: caída de BBDD por el latido del KDS (~01:20–02:05)
Producción inaccesible durante la prueba del TPV. Causa: **13 funciones del KDS escribían `last_seen_at` en CADA lectura** → tormenta de bloqueos sobre `kds_device` con el pool agotado. **Con los 3 locales CERRADOS**: las tablets ociosas bastan para tumbar la base. Resuelto: reinicio desde el panel (Julio) + **mitigación aplicada y verificada** (UPDATE condicional a 30 s en las 13 funciones, backup en `_backup_kds_fn_20260811`, reversión de 5 líneas documentada). Posible desencadenante: mi migración del CHECK de `sale` (lección: ALTER TABLE sobre tablas calientes, con servicio cerrado). **El arreglo de raíz pasa POR DELANTE del despliegue del TPV.** → `folvy_incidente_20260811_kds_device_bbdd_caida.md`

### Lecciones de método
- La ausencia en una knowledge base NO es ausencia en el producto (falsa "ventana VeriFactu" — rectificada con fuente primaria).
- El cliente actual es el extremo del mercado: cada decisión de producto pasa la prueba del "bar con terraza y dos empleados".
- `ALTER TABLE` sobre tablas calientes = con servicio cerrado.
- El contraste de una liquidación externa destapa bugs propios (4 formatos) — auditar hacia fuera audita hacia dentro.
- WebFetch cachea 15 min: para verificar un commit, pedir por SHA.

→ Detalle TPV: `folvy_tpv_propio_viabilidad_20260810.md` · Encargos: `ENCARGO_CODE_tpv_t1_venta.md` · `ENCARGO_CODE_tpv_t1b_codigo_ticket_y_ruta.md`

---

## 09/08/2026 — F10 CERRADO: el greedy muere, el solver exacto entra en producción

**Se abandona la línea greedy tras seis versiones y se sustituye por un solver exacto.**
El detonante: el lunes de la semana 10/08 salía con **cero personas**. No era un bug
iterable, era estructural — el greedy decide sin volver atrás, así que los descansos caían
de residuo. Julio lo cortó en seco: *"es imposible que Claude no sea capaz de conseguir un
motor para organizar el horario de tres trabajadoras"*.

**Prototipo Python como oráculo** (`docs/solver_prototipo.py`): dos fases —reservar los días
libres ANTES de repartir, luego set-cover exacto con backtracking y objetivo lexicográfico—
resuelven dos semanas reales en 0,24 s. Portado a `src/services/scheduleSolver.ts` y validado
día a día contra el oráculo, no solo en los totales.

**En producción: PRs #42 y #43, 13 commits, `main` = `7065ac6`. Cero migraciones.**

### Resultado sobre Alcalá, semana 10/08

| | Antes (greedy v6) | Ahora (solver) |
|---|---|---|
| Lunes | **vacío** | cubierto |
| Huecos | 4 (17 h) | **0** |
| Horas | 21,5 · 25 · 22,3 | **39,25 × 3** (spread 0,0) |
| Días libres | los 3 el mismo día, de residuo | escalonados y **decididos** |
| Descanso semanal | 36 h 15 (invisible) | **43,5 h las tres, comprobado** |

**RODAJE COMPLETADO**: primera propuesta del motor escrita en `schedules.cells`
(`1e95fdbc…`, Alcalá 10/08, `draft`). **Nunca había ocurrido en ninguna versión del motor.**

### Los cuatro defectos encontrados y cerrados en el día

1. **Plantilla fantasma.** El solver sentaba a la persona en `Mañana1` (12:30–16:00, 0 usos
   en 9 semanas) dejando vacío el asiento declarado de `Mañana`. Origen: el prototipo tenía
   las 4 plantillas escritas a mano, así que el caso no podía existir en el oráculo; el
   greedy sí tenía la protección y el port la perdió. Resuelto con criterio `tier`:
   cobertura declarada → uso histórico → nada. **Trampa esquivada**: `Corrido1` y `Corrido2`
   también tienen `coverage = 0` pero son reales — filtrar solo por cobertura los mataba.
2. **`open_close_extra` = 30 personas.** El panel escribía los 30 minutos de margen también
   en un campo viejo que significa PERSONAS → `team_labor_requirement` pedía **31 cocineros**
   a las 13:00. Dato corregido, campo pasado a solo lectura.
3. **Reparto injusto.** Los partidos y el descanso solo se minimizaban en total, nunca se
   repartían. Añadidos al objetivo lexicográfico por debajo del spread de horas.
4. **🔴 El descanso semanal no cruzaba la frontera de semana.** Ni el solver TS ni
   `generate_week_schedule` miraban más allá del lunes que resolvían. El caso real de Pamela
   (36 h 15) solo era visible encadenando a mano el domingo anterior. Resuelto con cascada
   **fichaje sano → cuadrante publicado → "no lo sé"**, nunca desde `draft`.

### El filtro que evitó un falso positivo

La regla propuesta —*"el fichaje si es posterior al plan"*— habría elegido **siempre el dato
corrupto**: una salida olvidada es por definición posterior al plan. RECON de 60 días: 166
fichajes, 0 sin salida, pero **4 jornadas > 12 h**, una de **23 h 52 min**. Umbral
implementado a 660 min, derivado de política ya configurada (corrido más largo + 3× margen
de cierre), y comprobado *después* de fijarlo que cae en un hueco real de los datos.
**Un aviso falso es peor que no avisar: enseña al encargado a ignorar los avisos.**

### Decisiones de Julio

Ritmo 15 platos/persona-hora · tope de planificación 9,5 h separado del legal (540) ·
**`Mañana1` NO se toca** ("ahora no está en uso, quizás más adelante sí") · semilla de
frontera = fichaje con filtro → publicado → "no lo sé" · sin dato, **avisar y seguir**,
nunca un verde falso.

### Abierto al cierre

- **Partidos 2-2-1 vs horas 39,25 × 3 exactas** — con esta curva no caben las dos. Los 5
  partidos son el suelo matemático (23 bloques, 18 días de trabajo): no se bajan, se reparten.
- **¿"Cubrir el resto" pasa al solver?** El plpgsql comparte el defecto de frontera.
- **Publicar el borrador** cuando el reparto sea justo.

### Otros hechos del día

- **Avería en Alcalá: cierre a las 15:01** (registrado en `availability_event`, **sin
  `reason_code`**). Riesgo: hoy quedará como un domingo flojo en el histórico que alimenta la
  previsión. → `folvy_averia_20260809_cierre_alcala.md`
- **Frente nuevo abierto: 🤖 asistente / copiloto.** Primer caso de uso real salido del propio
  rodaje: el motor quería un turno de 12:30–16:00 y, al no poder pedirlo, se lo autoconcedió
  por una plantilla fantasma. Ya sabe lo que quiere; le falta boca.
- **Hallazgo sin investigar**: 3 empleadas con salida de fichaje **idéntica a las 06:38**.

### Lecciones de método

- **Probar en el sitio equivocado cuesta una hora.** Producción y el preview de una rama son
  visualmente idénticos. `raw.githubusercontent` 404/200 zanjó la duda en 5 segundos.
- **Un PR mergeado + commits nuevos en la misma rama = confusión garantizada.** Rama nueva
  por encargo.
- **Una mejora medida con el instrumento averiado no está demostrada.** Code re-midió el
  reparto sembrando la frontera de verdad y aisló de dónde venía el número malo. Esa es la
  verificación que vale.
- **La prueba de que un arreglo de detección funciona es que aparezca un número malo**, no
  que todo salga verde.
- La regla del 08/08 —verificar antes de aplicar— pagó **cuatro veces** hoy: el uso histórico
  evitó borrar `Mañana1` y matar los corridos; el commit desplegado evitó perseguir un bug
  fantasma; los fichajes revelaron que la regla propuesta elegía el dato corrupto; y encadenar
  a mano con el domingo anterior destapó un defecto que los dos motores ocultaban desde
  siempre. Ninguna comprobación costó más de un minuto.

→ Detalle: `claude/folvy_team_f10_estado.md`
→ Encargos del día: `ENCARGO_CODE_f10_plantilla_fantasma.md` · `ENCARGO_CODE_f10_reparto_justo.md` ·
  `ENCARGO_CODE_f10_descanso_entre_semanas.md` · `ENCARGO_CODE_f10_semilla_frontera.md`

---

## 08/08/2026 — F10: motor de cuadrantes reconstruido de cero + 3 años de histórico

**Motor nuevo en producción.** `generate_week_schedule` sustituye a `propose_schedule`
(huérfano declarado, sin borrar). Genera turnos desde la curva de venta real, no desde
plantillas. Verificado en vivo: **0 huecos los 7 días, 0 turnos ilegales**, jornada
continua salvo cuando el valle obliga a partir. 69 de 120 h contratadas — las 51
restantes se declaran, no se disimulan. 13 migraciones T1900→T2100.

**Histórico de 3 años anclado.** 60.000 pedidos (feb-2023 → ago-2026) de las 3 cocinas
→ 2.345 filas en `sales_history_daily`. Antes había 56 días. Bebidas y postres separados
(5,7 % de las unidades, no generan trabajo de cocina).

**Estacionalidad medida y desestacionalizada** (media móvil de 12 meses para retirar el
crecimiento): agosto **0,689** · noviembre **1,337**. El prior anterior situaba el máximo
en marzo-mayo; el máximo real es noviembre y octubre estaba infraestimado un 25 %.

**Pantalla de cobertura reparada.** Convivían 3 cálculos desalineados; la pantalla decía
78 % cuando el motor decía 100 % (sumaba la demanda de 4 áreas contra un cuadrante de
cocina). Ahora una sola fuente. `contracted_hours_week` expuesto al cliente: Natacha
figuraba con 43,5 h cuando su contrato son 40.

**Decisiones de Julio**: ritmo 20 platos/persona-hora (revoca el prior de 12 del 10/07) ·
prioridades del cuadrante (1ª cubrir demanda, 2ª horas contratadas, 3ª jornada continua
deseable no obligatoria) · las horas sobrantes las coloca el encargado con parámetros,
no el motor solo.

**Lección de método**: 11 migraciones aplicadas sobre suposiciones, 8 diagnósticos falsos.
Las cuatro correcciones que salvaron la sesión las hizo Julio desde el conocimiento de la
operación, no un modelo. → dos reglas nuevas en `folvy_estado.md`.

→ Detalle: `claude/folvy_team_f10_estado.md`
→ Calendario de prueba de septiembre: `folvy_alcala_calendario_prueba_septiembre.md`
