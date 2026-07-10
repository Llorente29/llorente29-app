# Folvy — Mapa competitivo maestro

**El documento vivo de "cómo golear".** Organizado por ÁREA de Folvy (no por competidor), para que antes de tocar cualquier frente abras su sección y veas a todos los rivales enfrentados + dónde está Folvy + el veredicto.

> **Cómo se usa**: en el paso 2 (BENCHMARK) del ritual de cada frente, abres la sección del área. En el paso 4 (MEDIR), actualizas el veredicto.
> **Cómo se mantiene**: cada frente actualiza su sección. Los datos web caducan — la fecha de cada dato importa.
> **Leyenda de veredicto**: 🟢 Folvy golea · 🟡 empate/deuda declarada · 🔴 Folvy aún no juega · ⚪ no aplica a Folvy.

---

## Los rivales (quién es quién, en una línea)

| Rival | Qué es | Fortaleza | Para quién | Precio (dato/fecha) |
|---|---|---|---|---|
| **tspoon** | ERP de cocina ES, ciclo completo | Amplitud (compra→contabilidad), cocina central, fiscal ES | Cadenas, producción, ES | Opaco |
| **Apicbase** | Back-office F&B multi-local (BE) | Recetas como dato único, API-first, internal ordering | Cadenas medianas/grandes, EU | ~149-160$/mes+ (G2, 2026) |
| **Restaurant365 (R365)** | ERP USA: contabilidad+inventario+labor | Contabilidad integrada, R365 AI sobre el P&L, AvT real | Multi-unidad 5+, USA | 435$/mes Essential, 635$ Pro (2026) |
| **meez** | Software de recetas "by chefs" | UX de cocina, 3.000+ ingr con yields, alérgenos/nutrición auto, pasos con foto/vídeo | Chefs, cadenas; capa sobre R365 | "Get a quote", regional |
| **Marketman** | Inventario/compras/recetas | OCR factura, sugerencia de pedido, multi-TPV | QSR, cafeterías, multi-unidad | 199-249$/mes/local (2026) |
| **Crunchtime** | Inventario+labor cadenas grandes | Escala enterprise, operaciones de campo | Cadenas grandes (100s) | Enterprise opaco |
| **Toast** | TPV USA + back-office | Ecosistema TPV-céntrico todo en uno | Restaurantes USA | Hardware+% |
| **Mapal OS** | Suite hostelería (ES/EU) | APPCC, formación, operaciones | Cadenas ES/EU | Opaco |
| **Gstock** | Inventario/compras ES | Económico, español, sencillo | SMB ES | Bajo |

Notas: meez **se declara "complementario, no competidor" de ERPs** — capa culinaria sobre R365. R365 y meez tienen alianza (sync). Eso deja un hueco: nadie une UX-de-cocina-meez + ciclo-cerrado + IA en un solo producto SMB español. Ese es el espacio de Folvy.

---

## ÁREA 1 — Escandallos / fichas técnicas / coste

**El estándar del área**: meez (UX de cocina + costeo en tiempo real) y Apicbase (receta como dato único multi-local).

| Capacidad | Mejor del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| Coste recursivo en tiempo real | meez, Apicbase, tspoon (todos) | Sí, a la décima de céntimo, recompute en cascada | 🟡 paridad |
| Sub-recetas / yields / merma | meez (prep-loss tracking), tspoon (quantityGross) | Sí, cantidad bruta server-side | 🟡 paridad |
| Pasos enlazados a ingredientes | meez (pasos con foto/vídeo); tspoon tiene campo plano (0% lo usa) | Sí (E8, pasos↔ingredientes) + foto/vídeo/enlace por paso (01/07) | 🟢 golea — pasos ligados a ingredientes Y con media; meez tiene media pero no ligada a coste |
| Alérgenos automáticos | meez (auto desde 3.000 ingr), tspoon (18% calculado real) | Campo existe, sin poblar | 🔴 deuda (master ingr) |
| Nutrición automática | meez (USDA labels) | "Próximamente" | 🔴 deuda (master ingr) |
| Material/envase en escandallo | tspoon (94% de platos lo usan) | Verificar soporte en recipe_line | 🟡 verificar / deuda |
| Versionado de receta | meez (version-controlled) | **EN PRODUCCIÓN (01/07)**: pestaña Histórico (`recipe_item_version`): guardar versión + etiqueta + qué cambió + marcar hito + historial | 🟡 paridad con meez |
| Escalar receta (reescalar por rendimiento/lote) | meez (función estrella), Apicbase, R365 | **EN PRODUCCIÓN (01/07)**: control "Producción · Multiplicar por [n] · ×2 · ×3 · ½"; recalcula cantidades y coste al vuelo (ancla `yield_portions`) | 🟡 paridad con meez |
| Foto/vídeo por paso | meez | **EN PRODUCCIÓN (01/07)**: foto + subir vídeo + pegar enlace por paso, sobre pasos ya ligados a ingredientes | 🟢 golea — meez tiene vídeo pero NO ligado a ingredientes; Folvy tiene ambos |
| Importar receta por foto/PDF/Excel/Word con IA | nadie lo hace | **EN PRODUCCIÓN (12/06; revisión anti-duplicados de raíz 28/06)**: foto/PDF→visión, Excel/Word→texto, monta escandallo; **pantalla de revisión que casa cada línea con la despensa (literal+difuso) antes de crear → 0 duplicados** (la decisión va directa a la RPC, no a una tabla intermedia) | 🟢 **GOLEA (vivo)** — meez/Apicbase obligan a teclear; nadie tiene revisión anti-duplicados al importar |
| Duplicar receta (copiar y variar 1-2 ingr) | meez (version/duplicate) | **EN PRODUCCIÓN (28/06)**: RPC atómica copia plato+líneas+pasos+foto; abre la copia para editar | 🟡 paridad con meez |
| Coste HONESTO ante unidad no convertible | nadie lo controla (todos asumen conversión) | Hoy la línea no convertible se salta en silencio (fuga); **frente declarado: BLOQUEAR + consumo pendiente visible** | 🔴 deuda (con plan de goleada: honestidad de dato que ningún rival tiene) |
| Copiloto de IA que ACTÚA sobre coste/margen | Toast IQ (proactivo+accionable, pero ve ventas/labor, NO coste/margen) | **EN PRODUCCIÓN (29/06)**: Folvy Copiloto ve coste+margen+AvT a la vez, detecta huecos en € y EJECUTA la corrección con confirmación (asignó el coste de la birria, verificado en BD) | 🟢 **GOLEA (vivo)** — único agente que actúa sobre la economía del plato; ningún rival lo tiene |

**Cómo golea Folvy aquí**: (1) pasos enlazados a ingredientes que meez no liga a coste igual; (2) IA que estructura escandallo desde foto/PDF/Excel/Word (nadie lo hace; **VIVO desde 12/06**); (3) alérgenos+nutrición SIEMPRE calculados desde master (memoria #23), nunca a mano; (4) **el Copiloto que ACTÚA sobre coste/margen (29/06)** — diferenciador único, ningún rival tiene un agente que ejecute correcciones de economía del plato. **Comodidades de recetario CERRADAS (01/07):** escalar receta, versionado (Histórico `recipe_item_version`), foto/vídeo por paso, "Añadir a carta" (validado en vivo, commit `25ddf69`), sustituir/quitar ingrediente y duplicar receta están en producción → el recetario ya iguala o supera a meez. **Deuda restante vs meez:** solo alérgenos/nutrición auto desde master (disparador: T1). **VEREDICTO HONESTO (act. 01/07):** Folvy gana DECISIVAMENTE en el núcleo económico (escandallo al céntimo reconciliado, AvT+inventario perpetuo, unidades amigables, modificadores con coste real, copiloto que actúa) Y ya iguala/supera a meez en comodidades de recetario. Lo único que queda del frente de PRODUCTO abierto el 29/06 es el rodaje VISUAL de las pantallas de GESTIÓN + móvil (frente activo; el rebrand del 01/07 fue solo lado cliente/Shop, no tocó la gestión). No se vende el empate como victoria: el foso (economía + agente) sigue siendo lo difícil y ganado; las comodidades de recetario ya NO son deuda.

---

## ÁREA 2 — Compras / pedidos / proveedores

**El estándar**: Apicbase (internal ordering), Marketman (sugerencia de pedido por demanda), tspoon (11 estados, pedido automático por proveedor).

| Capacidad | Mejor del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| Catálogo de proveedor (artículo+formato+precio) | tspoon, Apicbase, Marketman | article_supplier + formatos anidados caja→bote | 🟢 golea (formatos anidados; otros: plano) |
| Pedido sobre catálogo (no líneas a mano) | tspoon, Apicbase | Sí (builder C1 rediseñado, 3 modos) + **STOCK REAL por artículo en cajas (14/06, `formatStockForOrder`)** | 🟡 paridad (pedir + stock visible; falta edición de precio operativa y desglose fino de formato) |
| Sugerencia de cantidad por histórico | Marketman, R365 AI | Diseñado (IA compras, memoria #28) | 🔴 deuda (con plan de goleada) |
| Pedido automático por proveedor (días, mínimos) | tspoon (weekDays, minim, notSendIfUnderMin) | No | 🔴 deuda |
| Envío mail + WhatsApp | tspoon (sendMailType/Whatsapp) | En cola (Resend + WhatsApp) | 🔴 deuda (en cola) |
| Multi-estado de pedido | tspoon (11 estados) | Parcial (verificar cobertura) | 🟡 deuda |
| Aprobación de pedido | tspoon (mandatoryApproval) | Parcial | 🟡 verificar |
| Acreedor vs proveedor | tspoon (creditor) | No (mezcla servicios y mercancía) | 🟡 deuda menor |

**Cómo golea Folvy**: (1) formatos anidados (caja→bote→uso) que ningún rival modela en 3 capas; (2) IA copiloto de compras (sugerir, avisar sobrepedido, duplicados) que solo Marketman/R365 rozan; (3) planificación MRP (pedido origin=mrp) que nadie tiene en hostelería. **Deudas**: pedido automático por proveedor, envío WhatsApp, estados completos. Disparador: cerrar Supply C2/C3.

---

## ÁREA 3 — Recepción de albaranes

**El estándar**: tspoon (puntos de control, lote, entrada a almacén, **almacén por línea**), Marketman/R365/MarginEdge/xtraCHEF (OCR factura + paso de verificación que bloquea hasta validar, pero en jerga contable y para oficina).

> **Checkpoint tspoon CERRADO contra fuente empírica (07/06, 901 albaranes reales).** La línea de albarán tspoon (`listDeliveries`) guarda doble unidad nativa (`quantity`+`unit` lo que entra a stock; `quantityFormat`+`unitFormat`+`costFormat` el formato de compra) = nuestra arquitectura de 3 capas, ellos plana en la línea. `recibido` por línea, `idStore` por línea (cada artículo a su zona). NO lleva lote/caducidad (nosotros sí). El albarán es documento propio enlazado al pedido (`deliveryFor`), con `costType`/`businessLine` (dimensión contable que no tenemos). Verificado: MarketMan/xtraCHEF/MarginEdge tienen gate de verificación pero en idioma de oficina; ninguno hace el desglose cocinero "qué entra al almacén".

| Capacidad | Mejor del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| OCR de albarán/factura | Marketman, R365 (con humano detrás) | Sí, OCR propio (visión Claude, sin humano) | 🟢 golea (más barato, sin humano) |
| Casado por código de proveedor | tspoon | Sí (validado SAL72) | 🟡 paridad |
| Blind receiving (anti-confirmation-bias) | nadie lo hace explícito | Sí (celda nace vacía, memoria #30) | 🟢 golea |
| Aviso de precio (cero falsos positivos) | varios avisan, con ruido | Sí, derivado caja→bote | 🟢 golea (cero falsos) |
| Lote por línea en recepción | tspoon (NO lo trae en el dump real) | No | 🔴 deuda (trazabilidad) |
| Entrada a almacén automática | tspoon, R365 | confirm_goods_receipt postea a stock | 🟡 paridad |
| Puntos de control (temp, embalaje) | tspoon | No (pero APPCC existe aparte) | 🟡 deuda (enlazar APPCC) |
| Resumen "qué entra al almacén" claro | nadie (todos en jerga de oficina) | Panel entra/no-entra por línea + precio reactivo + cantidad en formato (07/06) | 🟢 golea (idioma cocinero, único) |
| OCR doble columna (cajas vs contenido) | tspoon (quantity+quantityFormat) | quantity + packages + "N × Caja (X kg) = Y al almacén" | 🟢 golea (visible al recibir) |
| Almacén/ubicación POR LÍNEA | tspoon (`idStore` por línea) | No (todo a un location_id) | 🔴 deuda (disparador: multi-almacén/FEFO) |
| Coste/conversión server-side | — | qty_in_base se calcula en cliente (deuda declarada) | 🟡 deuda (mover a SQL) |

**Cómo golea Folvy**: OCR sin humano (más barato que xtraCHEF/Marketman) + blind receiving + aviso cero-falsos-positivos + **desglose "qué entra al almacén" en idioma cocinero** (nadie lo hace; los rivales validan en jerga de oficina). **Deudas**: lote en recepción, almacén por línea (tspoon lo tiene), qty_in_base server-side, enlazar puntos de control con APPCC.

> **Nota 24/06:** Recuperación de líneas sin postear (Meter al stock) resuelta dentro del flujo, con casado+formato sin salir — supera el blind-receiving plano de los competidores que solo avisan. Pendiente: estado 'confirmada con pendientes' en el momento de confirmar.

> **DEUDA UX PRIORITARIA descubierta 16/06 (recepciones reales con Pamela): el ARRANQUE EN FRÍO.** El blind receiving y el panel "qué entra" golean en el día a día, pero la PRIMERA VEZ de cada artículo obliga a montar formato (caja↔pieza), elegir unidad y teclear precio EN PLENA RECEPCIÓN — demasiada carga para un trabajador en el muelle. *"Cuanto más poblado, menos piensas"* (Julio): la 2ª recepción del artículo ya no pregunta. **Rediseño (sesión dedicada):** separar el ALTA del artículo (formatos/unidades/precios = pensar, antes, en calma, por quien sabe — o sembrado del catálogo del proveedor) de la RECEPCIÓN (solo contar+confirmar). Además: (a) distinguir descuadre REAL (rojo que frena) de "misma cantidad otra unidad" (gris informativo — hoy salta rojo y deja confirmar = alarm fatigue); (b) aceptar IMPORTE TOTAL de línea, no €/caja (trampa real: Julio tecleó total como unitario = doble coste); (c) recordar formatos montados. Benchmark blind-receiving. Memoria #30. Esto baja el veredicto de "🟢 golea en uso fluido" a **🟡 deuda en arranque en frío** hasta el rediseño.

---

## ÁREA 4 — Inventario perpetuo / stock / mermas

**El estándar**: R365 (AvT real, actual vs theoretical), tspoon (510 inventarios reales en Llorente29), Crunchtime (escala).

| Capacidad | Mejor del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| Inventario perpetuo (inicial+entradas−salidas) | tspoon, R365, Apicbase | **EN PRODUCCIÓN (14/06)**: ledger `stock_movement` (apertura/ajuste/consumo/recepción); conteo que SUSTITUYE en su instante (`apply_inventory_count` v3); apertura sin tolerancia; stock real por artículo/local verificado de punta a punta | 🟡 paridad (motor sólido; falta usabilidad de unidades amigables) |
| Actual vs Theoretical (AvT) | R365 (su bandera), Crunchtime | **EN PRODUCCIÓN (17/06)**: puntual (último conteo: teórico vs real vs € perdido) + por periodo consolidado (`avt_period`: inicial+compras−consumo=teórico, merma=teórico−real; agrupable Local/Almacén/Familia/Artículo) + SALUD DEL DATO (números honestos o ninguno) + CAUSA PROBABLE por línea | 🟢 **GOLEA (vivo)** — iguala el AvT de R365 y golea con salud del dato + porqué de la desviación |
| Niveles mín/par + reposición | tspoon (máx/mín), R365 | **EN PRODUCCIÓN (17/06)**: tabla `stock_level` (min/par activos; reorder/lead/safety listos para nivel vivo) + "repón X"=par−stock → To-Par del pedido | 🟡 paridad (manual; el nivel VIVO por consumo lo deja por delante cuando se encienda) |
| Mermas registradas | tspoon (por corte, tipo, valorada) | Entrada de merma en Movimientos (libro mayor, 17/06) | 🟡 paridad (registro sí; por corte/tipo = deuda menor) |
| Merma por DIFERENCIA (calculada) | nadie la calcula bien | **EN PRODUCCIÓN (17/06)**: el AvT por periodo la calcula (inicial+compras−consumo−real=merma), valorada en €, con salud del dato | 🟢 **GOLEA (vivo)** — nadie cierra este bucle con honestidad del dato |
| Autoinventario IA (cycle counting) | nadie en hostelería | **EN PRODUCCIÓN**: cola ABC + reparto por persona visible (15-17/06) | 🟢 goleada clara (vivo) |
| Ubicaciones dentro de almacén | tspoon (StoreLocation) | Zonas de almacén (AL1, 17/06) | 🟡 paridad (zonas sí; FEFO dentro = deuda) |
| FEFO (caducidades) | tspoon (modeFefo) | No | 🔴 deuda (con lotes) |
| Multi-almacén / traspasos | tspoon, Apicbase, R365 | **EN PRODUCCIÓN (17/06)**: `stock_transfer` + `register_transfer` (traspaso entre locales, 2 movimientos enlazados, valida stock origen) | 🟡 paridad (traspaso entre locales sí) |

**Cómo golea Folvy ★**: (1) autoinventario IA (contar 3-5/día que la IA elige por ABC) — nadie lo hace; (2) merma por diferencia + efecto económico — nadie cierra el bucle; (3) consumo teórico encendible YA (ventas×escandallo) sin esperar a construir inventario. **Prioridad real ALTA**: Llorente29 hizo 510 inventarios en 2 años — es lo que más usa. R365 es el rival a batir aquí (AvT es su bandera). Disparador: SUBE en prioridad tras los datos reales.

> **VEREDICTO ACTUALIZADO 17/06 (tras las dos sesiones del módulo Almacén, deuda-0): 🟢 golea como MÓDULO.** El "cuerpo" que faltaba el 16/06 se construyó: módulo Almacén estructurado (6 secciones), zonas (AL1), Movimientos como libro mayor (entrada directa + traspaso entre locales + merma), ficha del artículo viva, niveles mín/par, y **AvT en producción** (puntual + por periodo, con salud del dato y causa probable). Folvy ya tiene lo que tspoon tiene (stock teórico vs real, histórico por producto, mover entre almacenes, merma, entrada directa, máx/mín) Y AÑADE lo que tspoon no tiene: autoinventario IA, merma por diferencia valorada, AvT con honestidad del dato. R365 (cuyo AvT es su bandera) queda igualado en AvT y superado en salud del dato. **Lo que queda (deuda menor, no baja el veredicto):** FEFO/lotes, merma por corte/tipo, y el **nivel VIVO por consumo** (idea Julio — par/min calculados, sobre `stock_level` ya listo). **El motor F1 ya tiene chasis.**

> **VEREDICTO REVISADO 16/06 (diagnóstico de Julio vs tspoon en producción, deuda-0): 🔴 a medias como MÓDULO.** El autoinventario IA **🟢 golea** (tspoon NO lo tiene) — la pieza difícil, hecha. PERO la **gestión de almacén básica** que tspoon tiene completa, Folvy no: múltiples almacenes + UBICACIONES dentro (Cámara/Congelador/Partida), stock TEÓRICO vs REAL + desviación, coste teórico vs real, histórico por producto, MOVER entre almacenes, MERMA, entrada directa, establecer cantidad, máx/mín. Frase de Julio: *"hacemos MUY BIEN el autoinventario pero POCO MÁS"* — Folvy hizo la JOYA antes que el CUERPO. **"Motor F1 sobre chasis a medias."** Síntoma concreto: el autoinventario sale VACÍO en cuenta nueva porque `build_inventory_count` (modo no-completo) filtra por área asignada y la cuenta nace con 0 áreas (de 907 ingredientes, 28 con área). **Frente grande (sesión dedicada):** replantear ALMACÉN/INVENTARIO como módulo propio estructurado tipo tspoon + STATUS DE COBERTURA (ver qué hay en cada área, huérfanos sin almacén, asignación en bloque) + MULTI-ÁREA por ingrediente + IA que recomienda almacén por familia/conservación ("IA propone, humano decide"). Memoria #19. **[SUPERADO 17/06 — ver veredicto de arriba.]**

---

## ÁREA 5 — Producción / cocina central

**El estándar**: tspoon (partidas, estados, lote), Apicbase (internal ordering central→outlet).

| Capacidad | Mejor del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| Producción por partidas | tspoon (Llorente29 NO la usa: 0) | No | 🔴 deuda (no urgente: ni el cliente la usa) |
| Estados de producción (pend/inic/fin) | tspoon | No | 🔴 deuda |
| Lote en producción | tspoon | No | 🔴 deuda (trazabilidad) |
| Planificación de producción (cuánto producir) | nadie en hostelería (todos registran) | Diseñado (MRP, explosión necesidades) | 🟢 oportunidad de goleada |
| Internal ordering (central→tienda) | Apicbase, tspoon (traspasos) | No | 🔴 deuda |

**Cómo golea Folvy**: igualar la base (partidas+estados+lote) + golear con PLANIFICACIÓN MRP (cuánto producir mañana desde previsión de ventas) que nadie tiene. **Prioridad BAJA confirmada por datos**: Llorente29 no usa producción (0 partidas, 0 producción). Tenerla con GANCHO de diseño desde ahora (memoria #25), no priorizarla. Es para obrador/catering/cadena, no dark kitchen.

---

## ÁREA 5.bis — KDS / tablero de cocina / pase (NUEVO, construido 13/06)

**El estándar**: Toast KDS, Square KDS, Fresh KDS, Quantic/Oracle Micros. Pantallas de comandas: ruteo por estación, bump por ítem, semáforo de tiempo, recall, expo flow.

| Capacidad | Mejor del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| Tablero por estación + ruteo | Toast/Square (por categoría/menú) | Sí (familia→estación + override + estación por defecto) | 🟢 iguala |
| Bump por estación + recall | todos | Sí (reversible) | 🟢 iguala |
| Marcado por plato reversible | Fresh KDS | Sí (toggle) | 🟢 iguala |
| Semáforo de tiempo | todos | Sí (umbral provisional 5/10min) | 🟡 iguala (umbral configurable = deuda) |
| Multi-tablet con token | todos | Sí (kds_device revocable, kiosco /cocina-tv) | 🟢 iguala |
| Combos desglosados + modificadores en ticket | todos | Sí (parent_sale_line_id + line_type) | 🟢 iguala |
| Notas de cliente destacadas | la mayoría | Sí (banda ⚠ por plato, del raw_tab) | 🟢 iguala |
| **Cook Mode: receta+ingredientes+alérgenos al pinchar el plato** | **nadie así** (KDS muestran comanda, no ficha técnica) | Sí (kds_recipe: base+escalado, alérgenos de ficha, foto, pasos ligados) | 🟢 **golea** |
| **Coste/margen en vivo en el pase** | nadie | Diseñado (Nivel 2, modifier_recipe_impact) | 🟢 oportunidad de goleada |
| **Ciclo cerrado a inventario** (el pase consume stock) | nadie (los KDS son solo display) | Sí (tab:closed → consumo por escandallo) | 🟢 golea |
| Multimarca por UUID en un tablero | raro (los KDS son monomarca) | Sí (un KDS por local recibe todas las marcas) | 🟢 golea |
| **Terminal de cocina único (Pedidos+Cocina+86) por token, sin login** | Toast/Square (terminal de cocina propietario) | Sí (Estación de Tablet `/estacion` 21/06: 3 pestañas por token sobre el mismo `kds_device`, PWA con icono propio) | 🟢 iguala (sin hardware propietario) |

**Cómo golea Folvy**: en la base (ruteo, bump, semáforo, expo, recall, multi-tablet, combos/modificadores) IGUALA a Toast/Square/Fresh. Donde GOLEA es en lo que ningún KDS hace porque son solo pantallas de comandas: el **Cook Mode** (tocar un plato abre su ficha técnica — ingredientes escalados, alérgenos de ficha, foto, pasos ligados a ingredientes), el **ciclo cerrado** (el pase consume stock por escandallo, no es un display aislado), el **multimarca por UUID** (un tablero por local recibe todas las marcas del dark kitchen), y el **Nivel 2 pendiente** (coste/margen del plato en vivo en el pase, vía modifier_recipe_impact — diferenciador que ni R365 tiene en cocina). Verificado en vivo sobre Llorente29 (13/06). La **Estación de Tablet** (21/06) une Pedidos + Cocina + Disponibilidad/86 en un solo terminal por token, sin login — equivalente operativo al "terminal de cocina" de los grandes, montado sobre el mismo `kds_device`, sin hardware propietario.

---

## ÁREA 5.ter — Impresión de tickets físicos (NUEVO, automático en vivo 21/06)

**El estándar**: Toast/Square/Last/Otter imprimen comandas por una app nativa en un dispositivo del local (que abre sockets a la impresora de red/Bluetooth) o por impresora cloud (Sunmi, Star CloudPRNT). No hay magia: las mismas dos vías que Folvy.

| Capacidad | Mejor del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| Impresión automática al aceptar el pedido | todos | Sí (trigger `tg_auto_print_on_accept` → cola → agente → papel, sin nadie con Folvy abierto) | 🟢 iguala |
| Multi-transporte (cloud / red / Bluetooth) | Toast/Square (varios drivers) | Sí por diseño (`printer.transport`: sunmi_cloud, escpos_network [vivo], epson_epos, bluetooth, browser_pdf; `config` jsonb) | 🟢 iguala (agnóstico desde el día 1) |
| 3 documentos (bolsa/factura simpl., cocina, pegatinas) | la mayoría (1-2 docs) | Sí (renderizador propio; pegatinas aplanan combos y expanden qty) | 🟢 golea (3 docs con pegatina por pieza) |
| **Cola de impresión inmutable y auditable** | raro (mandan a la impresora directo) | Sí (`print_job.payload` jsonb congelado, status, reintentos, source auto/manual/reprint) | 🟢 golea |
| **Preview en pantalla == papel** | nadie (el ticket se ve al imprimir) | Sí (el agente DIBUJA con el MISMO `ticketRenderer` del front) | 🟢 golea |
| Calidad visual del ticket (tipografía, logo, €) | Last/Otter (apps nativas, ticket pulido) | **FACTURA/BOLSA = clon de Last (24/06): render a IMAGEN (canvas) → ráster ESC/POS; logo protagonista, tipografía real, € y acentos perfectos, descuento tachado, IVA, dirección desglosada, QR, pie publicitario** | 🟢 iguala (factura indistinguible de Last) |
| Layout legible / aprovecha 80mm | todos | Factura RESUELTA (imagen, 24/06); 🟡 cocina y pegatinas aún por texto ESC/POS (pasar al motor de imagen) | 🟡 factura 🟢 / cocina-pegatina pendiente |
| Ticket como soporte publicitario (marca propia) | nadie lo explota | Sí: pie \"Hecho con Folvy · folvy.app\" + QR a la shop de la marca con caption configurable | 🟢 golea |
| Iconos gráficos (moto/alérgenos/logo) | todos (bitmap) | Capa 2 pendiente (bitmap ESC/POS desde PNG) | 🟡 deuda declarada |
| Reimpresión / impresión manual a voluntad | todos | Pendiente (botón) — `source='reprint'/'manual'` ya en el modelo | 🟡 pendiente inmediato |
| Versionado en migraciones / agente en repo | n/a | 🔴 SQL solo en BD, agente fuera del repo | 🔴 deuda crítica |

**Cómo golea Folvy**: la cadena automática FUNCIONA en vivo por LAN (Sunmi NT311, ESC/POS, puerto 9100), con arquitectura AGNÓSTICA multi-transporte igual que los grandes por dentro (agente o impresora cloud; el navegador no abre sockets, no es una limitación de Folvy sino una ley del navegador). Donde GOLEA: (1) la **cola inmutable y auditable** (`print_job` congelado, reintentos, trazable); (2) la **FACTURA/BOLSA renderizada como IMAGEN** (canvas → ráster), CLON de Last validado en papel (24/06): logo protagonista sin deformar, tipografía real, €+acentos perfectos (resuelve que la NT311 corrompe codepages), descuento tachado, IVA legal al 10%, dirección de cliente desglosada, QR; agnóstico de impresora; (3) el **ticket como soporte publicitario** (pie Folvy + QR a la shop de la marca). DEUDA antes de declarar 🟢 pleno: pasar COCINA y PEGATINAS al mismo motor de imagen (hoy por texto), iconos bitmap (capa 2), botón de reimpresión, VERSIONAR el SQL + meter el agente en el repo, y numeración fiscal propia (VeriFactu). Sunmi partner solicitada (Llorente29 Food/Spain/Folvy) para el transporte cloud futuro. Validado en vivo sobre Llorente29 Plaza Castilla (factura clon de Last, 24/06).

---

## ÁREA 6 — Ventas / foodcost teórico / economía de plataformas

**El estándar**: R365 (P&L en tiempo real), Toast (TPV-céntrico). NADIE cubre bien delivery español + comisiones.

| Capacidad | Mejor del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| Integración ventas reales | Toast (su TPV), R365 (vía POS) | Last.app webhook, 12K ventas, 99.3% mapeadas | 🟢 golea en delivery ES |
| Importar carta completa del POS (catálogo→Folvy) | Deliverect/Otter (sync de menú), Apicbase (import) | **EN PRODUCCIÓN (21/06)**: importador genérico Last→Folvy (categorías+productos+fotos+descripciones+modificadores+combos+slots), idempotente por matrícula, **producto compartido entre marcas** (un físico→N menu_items por marca, base del 86 multimarca), combos en su categoría editables; 17 marcas Llorente29 idénticas a Last | 🟢 golea — el modelo de producto compartido entre marcas (apagar Coca Cola una vez = en todas) pocos lo hacen; reutilizable por cliente |
| Operación del pedido (aceptar/rechazar/estado→plataforma) | Last (Order Manager), Otter, Deliverect | **Fase 1 VIVA (18/06)**: empuje de estado a HubRise (`hubrise-order-status`, PUT con X-Access-Token, autoriza por RLS), validado #RP65P received→accepted; pestaña "Pedidos" + auto-aceptación por canal/marca en diseño (`docs/folvy_pedidos_pestana_diseno.md`) | 🟡 fase 1 viva, UI en diseño |
| Foodcost teórico (coste×ventas) | R365, tspoon (costRecipe por línea) | Coste de venta REAL por línea (escandallo ± modificadores confirmados + combos), leído del canónico | 🟢 golea (coste por venta REAL, no por plato medio) |
| Coste real por modificador | nadie lo modela bien (en tspoon/R365 el modificador no altera el coste) | Sí (G3: cada opción altera el escandallo; coste al vuelo; humano confirma) | 🟢 goleada (08/06) |
| Comisiones + precio/margen por canal | nadie lo modela | **EN PRODUCCIÓN (18/06)**: motor server-side `menu_item_channel_economics` (precio override‖base por canal, comisión por canal, margen neto real al céntimo) + modal "Editar precios" con margen en vivo por canal; cálculo cliente jubilado | 🟢 goleada (nadie juega) |
| Margen real ponderado por mix vendido | meez (menu matrix), R365 | Base lista: coste real por venta × ventas reales del canónico | 🟡 deuda con plan (datos ya en canónico) |
| Reparto propio (last-mile, coste real) | nadie lo integra en el ciclo de coste | **CONSTRUIDO Y VALIDADO EN SANDBOX (25/06)**: despacho a Catcher (`catcher-dispatch` auth+create order v1, envío real aceptado) + webhook de estado/rider/coste real + disparo automático por trigger; transversal, solo despacha donde Last no lo hace; el `transport_price` real entra al pedido | 🟢 golea (nadie mete el coste real de reparto propio en el ciclo) — falta tráfico real y registrar webhook en Catcher |
| Tienda propia / canal directo (escaparate multimarca) | Olo (enterprise), ChowNow/Flipdish (DTC mono-marca), Zuppler (multi-marca supercart) | **NÚCLEO TRANSACCIONAL COMPLETO Y VERIFICADO EN VIVO (27/06)**: `/t/:slug` Hub + carta de marca (estado abierto/cerrado por horario real) + modal con **alérgenos legales por opción** + **carrito cross-brand con regla mismo-local=una entrega** + checkout (autocomplete + zona PostGIS + mínimo + franjas que respetan horario) + **PAGO Stripe Connect** (direct charges, application_fee, onboarding real, Payment Element, tarjeta probada) + **métodos configurables por cuenta** (online/efectivo) + ingesta→KDS+stock+AvT+Catcher + impresión verificada con hardware real. ÚNICO canal que sabe el margen real (escandallo+economía) | 🟢 golea en multimarca + alérgenos legales + margen real + cobra de verdad — el CRM/loyalty ya está EN CONSTRUCCIÓN y en producción (02/07): identidad+consentimiento, login de cliente por OTP, motor de cupones server-side, cupón de bienvenida con **impacto de margen real al configurarlo** (nadie lo hace: Cheerfy/Thanx estiman) y captura anticipada de consentimiento RGPD; siguiente F4 \"Mi cuenta\" (histórico+reorder). NORTE `docs/folvy_crm_diseno.md` v2 |
| Menu engineering | meez (menu matrix), R365 | Parcial (Ingeniería de menús existe) | 🟡 verificar vs meez |
| Motor de ofertas por plataforma (agente decide + publica + margen real) | **Pleez** (Madrid), Sapaad, Nory | **EN PRODUCCIÓN (04/07, cerebro mejorado 08/07): agente decide cada hora sobre los 4 canales + robot publica en Glovo + Uber API en cola.** 08/07: el agente pasó de ver solo Glovo/Uber a ver **los 4 canales** (Shop+JustEat incluidos), y de rendirse en silencio a **exprimir cada canal a su máximo rentable** (cascada que baja el % hasta el que aguanta el margen) + **alertar** cuando ninguno da (de 6 decisiones/0 ofertas a 81/81) | 🟢 **GOLEA**: Pleez decide a ciegas del coste; Folvy con margen real por plato (escandallo+comisión sobre base rebajada) SAGRADO e igual por canal, cascada de alternativas por canal (el Shop llega más lejos por su comisión 5%), guardarraíl que excluye platos bajo margen, alerta honesta cuando nada es rentable, ciclo cerrado |

**Cómo golea Folvy**: delivery español + comisiones por canal (R365/Toast viven en TPV/USA; tspoon en TPV/Shopify) — nadie modela la economía de plataformas española. Margen ANTES de vender. **Disparador**: economía de plataformas ya diseñada, conectar con ventas reales.

> **Motor de ofertas por plataforma — ACTUALIZADO 04/07: DE "NO clonar" A "EN PRODUCCIÓN Y GOLEANDO".** La decisión del 16/06 ("no clonar Pleez, solo guardarraíl") se REVIRTIÓ porque Llorente29 lo EXIGE y el cliente 2 lo pide = demanda pagada, ya no océano rojo especulativo. Construido en un día (04/07) el motor COMPLETO: agente decisor (Edge `offers-agent` + pg_cron cada hora, regla de recuperación always-on contra pico histórico, guardarraíl de suelo 45% que excluye platos bajo margen del alcance, cedidas jamás en plataforma) + robot publicador (Playwright sobre panel Glovo, vía A) + Uber API oficial en cola de Partner Engineering (vía B). **2 promos reales creadas por la máquina** (Scandal 10%, Milanesa House 15%, Cañaveral). **Pleez** (trypleez.com, Madrid, Buenavista Equity) hace ofertas por canal con push de 1 clic + clima + eventos, PERO decide con margen sobre coste tecleado a mano y ve el escaparate por scraping, no la operación → **no puede calcular margen real por plato; Folvy sí** (escandallo al céntimo + comisión sobre base rebajada). Doc comercial: `docs/folvy_motor_ofertas_informe.md` (vende el motor sin revelar el mecanismo de acceso a plataformas). **ACTUALIZACIÓN 08/07 — el CEREBRO da un salto:** auditoría con datos reales destapó que el agente era pobre (veía solo Glovo/Uber porque su universo arrancaba de los objetivos, que solo existen para plataforma; se rendía en silencio cuando el % no aguantaba el margen; ignoraba el Shop —canal de MÁS margen, 5%— y JustEat). Corregido: `agent_sales_signal_v2` reescrita (universo = marca×canal×local, los 4 canales, objetivo opcional, cedidas solo en Shop) + **cascada de alternativas** (baja el % hasta el que aguanta, cada canal a su máximo rentable) + **margen sagrado por canal** (45% igual en todos; el Shop llega más lejos solo por su comisión) + **alerta** cuando nada es rentable. De 6 decisiones/0 ofertas a 81/81. Doc de diseño del cerebro completo v3: `docs/folvy_agente_ofertas_v3_diseno.md` (catálogo de señales: valle horario, fútbol/derbis, clima bidireccional, festivos, payday, eventos, margen real; matriz de armas por canal; motor señal→{tipo,alcance,franja,profundidad,canal}). **DEUDA del área (act. 08/07):** pantalla unificada de ofertas (hoy partidas kitchen/PlatformOffers+shop/Campaigns, JustEat no aparece), objetivos del Shop + "sin objetivo a cero ≠ va bien" (hace que el Shop proponga 10% plano), Shop en auto, **tipos de oferta rotativos (el `kind` sigue hardcodeado a "standard" = EL gran frente v3)**, robot Uber (RECON del panel hecho), multi-local, franjas, autoaprendizaje. Versionado del motor: SALDADO en su mayor parte (la señal se versionó hoy).

---

## ÁREA 7 — IA / copiloto

**El estándar**: R365 AI (entrenada sobre el P&L completo), Marketman (OCR+sugerencias). meez (alérgenos/nutrición auto).

| Capacidad | Mejor del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| IA sobre datos de operación | R365 AI (P&L: vendido/costó/pagó/ganó) | Folvy Copiloto (ve Personal+APPCC+Ventas+coste/margen) | 🟡 paridad de ambición, distinto foco |
| Copiloto que cierra bucles | R365 AI (waste, variance, purchasing) | Diseñado transversal (memoria #28) | 🟡 deuda con plan |
| OCR sin humano | Folvy (visión Claude) | Sí | 🟢 golea |
| Anti-invención (needs_review) | nadie lo formaliza | Sí (filosofía Folvy) | 🟢 golea |
| Foto IA de ficha (rellenar foto) | nadie | Diseñado (memoria #2) | 🟢 oportunidad |
| IA ve TODOS los módulos a la vez | nadie (R365 ve P&L, no operación cocina) | Sí (Personal+APPCC+Ventas) | 🟢 golea |
| **Agente que ACTÚA (no solo informa)** | Toast IQ (proactivo+accionable; ve ventas/labor) | **EN PRODUCCIÓN (29/06)**: Folvy Copiloto propone→confirma→EJECUTA acciones reales (`ai_action` con autonomía graduada L0/L1/L2, rollback; asignó el coste de la birria verificado en BD) | 🟢 **golea** (Toast actúa sobre ventas/labor; Folvy actúa sobre la economía del plato, que Toast NO ve) |
| Marco multi-agente reutilizable | nadie lo expone así en hostelería | Registry de agentes + persona componible (Kitchen vivo, Team siguiente) | 🟢 oportunidad estructural |
| Voz (hablar al copiloto / que responda) | pocos en hostelería | Sí (Web Speech ida y vuelta, español) | 🟢 golea (deuda: TTS premium) |

**Cómo golea Folvy**: R365 AI es el rival serio en finanzas (IA sobre el P&L, reduce ~15% errores de forecast) y Toast IQ es el rival serio en "agente accionable" — pero Toast ve ventas/labor, NO el coste/margen del plato. **El salto del 29/06**: Folvy pasó de un asistente que INFORMA a un **Copiloto que ACTÚA** — propone, el humano confirma, ejecuta de verdad (contrato `ai_action`, autonomía graduada, audit, rollback; primera acción real verificada en BD: el coste de la birria). Marco multi-agente reutilizable (Kitchen primera implementación, Team siguiente). El foso: ve cocina+APPCC+ventas+coste+margen a la vez, anti-invención, en español, para SMB, **y ejecuta correcciones sobre la economía del plato que ningún rival toca.** Deudas declaradas: panel de consumo de IA por cuenta (es coste variable por cliente), TTS premium, capa proactiva en pantalla, segundo agente. **Mostrar la IA en cada módulo y que actúe, no tenerla escondida ni decorativa.**

---

## ÁREA 8 — Fiscal / contabilidad / integraciones ERP

**El estándar**: tspoon (Fiskaly/Verifactu, Business Central), R365 (contabilidad nativa).

| Capacidad | Mejor del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| Facturación electrónica (Verifactu/TicketBAI) | tspoon (Fiskaly integrado) | No | 🔴 DEUDA CRÍTICA (obligación fiscal ES) |
| Contabilidad / cuentas de análisis | R365 (nativa), tspoon (export) | No | 🔴 deuda |
| Three-way match (pedido↔albarán↔factura) | tspoon, R365, Marketman | Diseñado (paso 4 OCR) | 🔴 deuda con plan |
| Integración ERP externo (Odoo, BC) | tspoon (por proveedor) | No | 🟡 deuda (cadenas, no SMB) |
| Export contable | tspoon, R365 | No | 🔴 deuda |

**Cómo golea Folvy**: aquí Folvy está DETRÁS. La deuda crítica es **Verifactu** — será obligatorio en España; sin ello un cliente fiscalmente serio elige tspoon. Three-way match con IA es el diferenciador cuando llegue. **Disparador**: antes de vender a cliente que facture desde Folvy.

---

## ÁREA 9 — APPCC / seguridad alimentaria / trazabilidad

**El estándar**: Mapal OS (APPCC+formación), tspoon (controles), Apicbase (HACCP).

| Capacidad | Mejor del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| Registros APPCC | Mapal, tspoon, Apicbase | Sí, módulo cerrado | 🟡 paridad |
| Acción correctiva + foto + notificación | nadie lo cierra así | Sí (campana al manager) | 🟢 golea |
| Trazabilidad de lote | tspoon (lote en recepción/producción) | No | 🔴 deuda |
| Trazas cruzadas (alérgenos por instalación) | tspoon | No | 🔴 deuda |

**Cómo golea Folvy**: APPCC con bucle de corrección + foto + notificación (más completo que el control plano de tspoon). **Deuda**: trazabilidad de lote (conecta recepción + producción + APPCC).

---

## ÁREA 10 — CRM / Loyalty / Ofertas (NUEVO 03/07 — el tablero exhaustivo tras la corrección de proceso)

> **Origen de esta área:** Julio cazó (03/07) que pese a pedir benchmark a fondo, "lo básico" del mercado (2x1, % por plato, envío gratis) estaba sin tratar. Regla reforzada desde entonces: **el paso BENCHMARK produce la enumeración EXHAUSTIVA de capacidades del área con veredicto por fila** — lo que no está en el mapa no existe; lo 🔴 está declarado, no invisible. Fuente primaria: Uber Eats Offers, Glovo Promotool, Cheerfy, Punchh/Paytronix/Thanx, Pleez, Starbucks/Domino's (patrones), Just Eat.

### 10.a — Catálogo de tipos de OFERTA (paridad con los paneles de partner)

| Capacidad | Quién la tiene | Folvy (03/07) | Veredicto |
|---|---|---|---|
| % / € dto sobre el pedido (mín., fechas, topes) | Todos | ✅ F3+G1, con guardarraíl de margen | 🟢 golea (margen delante, nadie lo da) |
| Solo clientes nuevos vs todos | Glovo, Uber | ✅ first_order_only | 🟢 |
| % dto por plato/categoría/marca | Glovo "% producto", Uber "% off item" | ✅ G2a (server-side, fuente única carta=cobro) | 🟢 golea (impacto de margen POR PLATO antes de activar) |
| Precio tachado por artículo + Ómnibus | Todo escaparate (Glovo lo exige) | ✅ G2a: `menu_item_price_history` + tachado SOLO legal + letra "precio más bajo 30 días" | 🟢 golea (Ómnibus POR CONSTRUCCIÓN; nadie valida, Folvy sí) |
| **Artículo espejo** (precio agresivo legal sin tachado) | **nadie** (técnica manual de algunos operadores) | ✅ G2a: create_mirror_item + swap + oferta automática en el gestor cuando el tachado sería ilegal | 🟢 goleada única |
| Envío gratis / con mínimo | Uber "£0 delivery", Glovo campañas de entrega | ✅ G2a (auto o código; coexiste con bienvenida; barrita "te faltan X€") | 🟢 |
| Combinar oferta de plato + de cesta | Uber lo permite | ✅ coexistencia construida (lanes subtotal/envío + item en línea) | 🟢 |
| Franjas horarias (happy hour) | Programación de plataforma | ✅ weekdays/time_from/time_to (TZ Madrid) | 🟢 |
| Presupuesto máx. que apaga la campaña sola | Uber weekly budget | ✅ budget_max (canjes vivos) | 🟢 |
| **2x1 / BOGO** | Glovo 2x1, Uber BOGO | ✅ G2c (escalera de pares al céntimo; badge negro/amarillo en las 7 pantallas) | 🟢 |
| Plato de regalo desde X€ | Uber "free item over £X" | ✅ G2c (línea REAL a 0€ que la cocina prepara + barrita de progreso) | 🟢 golea (el regalo entra a cocina/ticket/KDS; los paneles de plataforma solo descuentan) |
| Menú/bundle a precio cerrado con coste real | nadie con coste real | ❌ declarado | 🔴 futuro |
| Gestor de campañas (crear/pausar/clonar/eliminar/histórico) | Uber Eats Manager "All Campaigns", Glovo WebApp | ✅ G1+G2a-D (con impacto de margen y buscador multi-marca) | 🟢 |
| Rendimiento por campaña (canjes, € invertido) | Uber/Glovo básico; Otter Analytics (promoted vs un-promoted, ROI) | ✅ G2e completo: panel por campaña + margen real en TODOS los tipos + **dashboard "Folvy Shop→Inicio"** (Δ vs periodo anterior, filtros local/marca/promo, descargas CSV/XLSX patrón Otter) — con MARGEN REAL donde Otter da brutas | 🟢 golea |
| Impacto de margen real ANTES de activar | **nadie** | ✅ preview_coupon_impact + impacto por plato del alcance | 🟢 goleada única |

### 10.b — Loyalty / retención

| Capacidad | Quién | Folvy (03/07) | Veredicto |
|---|---|---|---|
| Bienvenida que compra el consentimiento | Cheerfy y todos | ✅ A2 (email+consentimiento o no aplica) | 🟢 |
| Área de cliente (histórico, reorder, datos) | Starbucks/Domino's (reorder 1-tap), Cheerfy básico | ✅ F4 (reorder EXACTO revalidado contra carta viva) | 🟢 |
| Recompensa por frecuencia + progreso goal-gradient | Starbucks, Domino's, Just Eat Stampcards | ✅ T3 (progreso calculado, config con margen delante) | 🟢 golea (nadie configura el premio viendo el margen) |
| Baja de consentimiento tan fácil como el alta (RGPD 7.3) | exigencia legal, pocos lo exhiben | ✅ F4 (toggle + log demostrable revoked/account_page) | 🟢 cumplimiento demostrable |
| Cashback | Cheerfy (su estrella), Punchh Wallet | ❌ decisión estratégica pendiente (Julio, F6) | 🔴 decisión |
| Cumpleaños / aniversario | Starbucks, todos | ❌ (ni se pide la fecha) → F5 | 🔴 anotado |
| Referidos ("invita y gana") | Glovo, Uber, Domino's | ❌ → F5 | 🔴 anotado |
| Upselling inteligente en el pedido | Cheerfy (+30% ticket), Uber | ❌ → F6 | 🔴 anotado |
| Win-back / encuesta con recompensa / reseñas propias | Cheerfy, Thanx | F5 (diseñado, plato favorito nombrado) | 🟡 en plan |
| Segmentación por comportamiento | Cheerfy, Punchh, Paytronix | F6 | 🟡 en plan |
| Campañas email/SMS/WhatsApp automatizadas | todos | F5 (Resend listo; WhatsApp aparcado) | 🟡 en plan |
| A/B de ofertas servido | Thanx | 🔴 deuda declarada (config+impacto ya existen) | 🔴 |
| Tarjeta Apple/Google Wallet | Cheerfy, PAR | ❌ futuro no crítico | ⚪ |
| Suscripciones tipo Prime / gift cards | Paytronix, Toast | ❌ no prioritario SMB | ⚪ |

### 10.c — Automatización de campañas (la escalera, explícita desde 03/07)

| Modelo | Cómo automatiza | Su límite | Folvy |
|---|---|---|---|
| **Pleez** (el listón) | Motor de REGLAS: caídas de demanda, valles, stock, competidores, clima, eventos; guardarraíles y ROI por promo | Margen sobre coste tecleado a mano; ve el escaparate (scraping), no la operación | **G2d** = mismo motor de reglas PERO contra histórico PROPIO (SELECT, no scraping) + margen real por disparo. coupon.origin='rule' ya existe |
| **Toast IQ Grow** | Agente que propone acciones (499$/mes + humano al lado) | Ve ventas/labor, no margen de plato | **F9** agente-marketer sobre contrato B3 (ya en producción); propone reglas Y campañas con coste de margen |
| **Punchh/Paytronix AI** | Personalización 1-a-1 predictiva | Enterprise, estiman coste | F6 segmentos + margen real |
| Escalera Folvy | **G1 manos (hecho) → G2d reflejos (reglas, EN CONSTRUCCIÓN con diseño v1 aprobado: 3 disparadores contra histórico propio + límites + kill switch) → F9 cerebro (agente)** | | 🟢 G1 · 🔨 G2d · F9 declarado |

**Cómo golea Folvy en el área:** el motor único Ómnibus-aware + margen-consciente sirve a CRM y a canal (decisión 02/07); ningún rival combina reglas de Pleez + agente de Toast + verdad de margen. **Deudas del área:** reglas G2d (en construcción), catálogo↔escandallo (el margen por plato es tan bueno como la cobertura de escandallos: 420/582 sin coste), cashback (decisión), A/B servido.

---

## ÁREA 11 — Adquisición pagada / Ads (NUEVO 03/07 — declarada, sin construir)

| Capacidad | Quién | Mecanismo | Folvy | Veredicto |
|---|---|---|---|---|
| Ads dentro de Glovo (Posicionamiento inteligente + palabras clave) | Glovo Manager Portal | **RECON hecho 03/07**: sin API pública; panel con anti-bot → automatización de navegador gestionada (mecanismo Pleez). Contrato de promo `deals` capturado, mapeo Folvy→Glovo casi 1:1 | ❌ (construible, F8) | 🔴 F8 |
| Uber Eats Promotions + Sponsored Listings (Ads) | Uber partners | **RECON hecho 03/07**: APIs OFICIALES existen (Promotions suite + Ads APIs programáticas + Reporting). Solicitud de partner-integrador ENVIADA | ❌ (vía A viable, esperando partner) | 🟡 en trámite |
| Meta Ads (Instagram/Facebook) | Toast IQ Grow lo automatiza | **Marketing API pública y robusta** — automatizable de verdad | ❌ | 🔴 frente "Adquisición social" post-F5 (necesita píxel/atribución al Shop) |
| TikTok Ads | ídem | **Ads API pública** | ❌ | 🔴 ídem |
| ROI de ads/promos contra MARGEN real (no ventas brutas) | **nadie** — Glovo canta "ROI 3,69x Bueno" a Llorente29 sobre 8.043€/29.657€ BRUTOS | Folvy tiene venta + escandallo + comisión de canal (menu_item_channel_economics) | ❌ (construible ya) | 🔮 la goleada del área |
| Dashboard unificado gasto (descuentos + ads) por canal | Toast IQ parcial | | G2e absorbe la parte de descuentos | 🟡 |

**Nota de prudencia (vigente):** no prometer push/ads automatizados a Glovo/Uber hasta el RECON de F8 (Pleez casi seguro automatiza sobre paneles con credenciales, como tspoon). Las campañas ya nacen con `channels[]` para enchufarse sin rehacer.

---

## ÁREA 12 — Radar competitivo de precios y ofertas (NUEVO 03/07 — declarada, sin construir)

| Capacidad | Pleez (el referente) | Folvy | Veredicto |
|---|---|---|---|
| Ver precios/ofertas de rivales en el radio de reparto (escaparates públicos Glovo/Uber) | ✅ competitor tracker | ❌ | 🔴 F8 |
| Disparador de regla "movimiento de competidor" | ✅ | G2d lo prevé como trigger | 🟡 declarado |
| **Cruce con margen propio** ("igualar al rival te deja al 31%; con espejo a 9,50 mantienes el 42%") | ❌ imposible para Pleez (no ve la operación) | diseño previsto | 🔮 la goleada del área |
| Técnica | scraping de escaparates públicos (terreno conocido: tspoon) | | ⚪ legalmente defendible, datos públicos |

---

## ÁREA 13 — Motor de ofertas de PLATAFORMA / agente autónomo (NUEVO 05/07 — construido y medido)

**Qué es**: el agente que decide, propone y (tras 1 clic humano) publica promociones EN las plataformas (Glovo hoy; Uber armado en seco; JustEat virgen), con margen real delante y ciclo cerrado propone→publica→mide→aprende.

| Capacidad | Pleez | Toast IQ | Cheerfy | Glovo/Uber nativos | **Folvy (05/07)** |
|---|---|---|---|---|---|
| Decide contra margen real por plato (escandallo) | 🔴 ciego al coste (scraping) | 🔴 no ve margen | 🔴 | 🔴 (su "ROI 3,69x" es sobre BRUTAS) | 🟢 preview con comisión sobre base rebajada + suelo 45% que EXCLUYE platos |
| Objetivos del negocio por marca×canal×LOCAL | 🔴 | 🔴 | 🔴 | 🔴 | 🟢 brand_channel_target (el cero es una fila; urgencia sin exigir pasado) |
| Señales: clima real + día de semana + eventos | 🟡 parcial | 🟡 | 🔴 | 🔴 | 🟢 Open-Meteo diario (evento real 37,7°C el primer día) + DOW 12 semanas ±5 |
| Aprendizaje del uplift MEDIDO (no caja negra) | 🔴 | 🟡 opaco | 🔴 | 🔴 | 🟢 determinista y auditable: solo con ≥2 medidas de ventana honesta; visible en el razonamiento |
| Publicación automática en Glovo | 🟢 (su foso: navegador gestionado) | 🔴 | 🔴 | ⚪ | 🟢 robot residente v3.18: multi-local dirigido, idempotente contra la VERDAD de Glovo (adopta, no duplica), kill-switch, anti-upsell |
| Publicación Uber por API oficial | 🔴 | 🔴 | 🔴 | ⚪ | 🟡 brazo construido EN SECO (Edge+cola+cron x7); esperando scopes Partner Engineering |
| JustEat | 🔴 | 🔴 | 🔴 | ⚪ | 🔴 terreno virgen — es el frente activo (reorganización multi-plataforma) |
| El PORQUÉ de cada campaña visible al operador | 🔴 | 🟡 | 🔴 | 🔴 | 🟢 dashboard: banner Señales de hoy + razón parseada con mini-chips en TODA campaña + uplift con regla de honestidad de ventana |
| 2x1 con precio de espejo calculado (Ómnibus-correcto) | 🔴 | 🔴 | 🔴 | 🟡 (la promo existe, el precio lo pones a ojo) | 🟡 cerebro construido y validado + procedimiento + sistema DISEÑADO — CONGELADO por decisión (reabrir tras multi-plataforma) |

**Veredicto (05/07): 🟢 golea en cerebro/señales/honestidad/Glovo; 🟡 Uber (esperando scopes) y 2x1 (congelado con diseño); 🔴 JustEat (frente activo).** **[+ FRENTE RRSS abierto 05/07 noche: agente de contenido Foodint→Shop con margen real por post — ninguna herramienta de RRSS (Later, Buffer, Hootsuite, Cheerfy) puede atribuir margen real a una publicación porque no tienen el escandallo debajo. TR1+TR2 vivos, brazo IG publicando por Graph API, fábrica de imágenes N1 en industrialización. Ver docs/folvy_rrss_diseno.md.]** La medición de uplift real necesita días de campañas vivas — el motor ya la registra solo.

> **ACTUALIZACIÓN 06/07 — offers-agent v2.0 + Módulo Social + N2:** **(ofertas)** política nueva de COBERTURA TOTAL (todo marca×canal×local habilitado tiene oferta; intensidad adaptativa mal→artillería / bien→5% mantenimiento que sube por tendencia) + **Uber ahora PROPUESTO** (nace pendiente, se sube a mano a Uber Manager hasta que Partner Engineering apruebe la API) + fix de raíz `location_id` en el scope (era la causa de los huecos de cobertura de Glovo). Sin ofertas los algoritmos de las plataformas bajan tu ranking = por eso la cobertura total no es opcional. **(RRSS 🟢→module completo)** Módulo Social entero en producción (Cola/Parrilla/Directivas/Ajustes, IG auto + TikTok/FB asistido) + **N2 «Gemini viste el fondo» VIVO** (dress = plato REAL intocable sobre ambiente generado; mood = escena IA etiquetable; biblioteca de escenas editable y evolutiva; worker residente autónomo). Foso reafirmado: nadie en RRSS de hostelería viste la foto del plato real con IA + atribuye margen real por post. **PENDIENTE FONDO (frente 1): robot Glovo v4 «concilia»** (leer las promos activas de Glovo antes de crear, cancelar/reordenar, red de seguridad del toast «otra promoción en curso» → mata el bucle de reintentos a ciegas). Glovo SÍ expone la lista de promos + botón Cancelar.

> **ACTUALIZACIÓN 08/07 (81/81 + MARATÓN) — 4 fallos del cerebro corregidos + v3 del Shop + aprendizaje transversal + deportes:** el agente pasó de **6 decisiones/0 ofertas a 81/81** (el Shop era invisible en la señal, JustEat fuera, se rendía sin bajar el %, se callaba al fallar — los 4 corregidos; migr `20260708T0030`). **v3 del Shop (canal de más margen, 5%): 🟢 golea** — variedad de % por estado (SHOP_BANDS) + rotación diaria + **valle horario + Happy Hour aditiva** (`agent_hourly_signal`) + **regalo por marca en jugada A/B** (a coste real garantizando 45%) + reglas gobernables por cuenta (`shop_rules`) + regalo visible en el storefront + **board unificado de los 4 canales** (`AgentOffersPage`) + Shop en AUTO (se publica solo). **Aprendizaje TRANSVERSAL** `agent_mechanic_signal` (uplift por marca×canal×MECÁNICA —pct/happy_hour/gift/bogo/free_delivery— en los 4 canales; rotación ponderada; jubila las 2 señales parciales) — ninguna herramienta rota mecánicas eligiendo por uplift real medido. **Señales de EVENTO deportivo: 🟡 montado pero ciego** — recolector `sports-events` (nacionales + LaLiga/Segunda por ciudad del local) listo, pero el plan FREE de API-Football solo da 2022-2024 → **Julio decide la fuente** (football-data.org recomendada). El fútbol es driver documentado del delivery en España (el que ve el partido en casa/bar = cliente de compartir). Regla anti-scraping para decisiones de dinero. Goleada sobre Pleez intacta: margen real del escandallo donde Pleez estima.

## ÁREA 14 — Gestión de personal / fichajes / turnos / informes de RRHH (NUEVO 06/07 — declarada, mayormente por construir)

**Qué es**: el módulo Team. Hoy es ~1/10 en funcionalidad de personal frente a los verticales. Frente grande declarado el 06/07 tras el análisis de mercado.

| Capacidad | Mejor del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| Fichaje digital (multi-dispositivo, geofence) | Sesame (12+ métodos), Factorial | Fichaje móvil + kiosko + geofence configurable por local (warn/block) + manual del manager con motivo+autor+rastro; **[08/07] modo warn que NUNCA bloquea + aviso rojo al fichar fuera de zona (móvil+kiosko) + GPS falla→ficha marcando 'Sin ubicación' + distancia por fichaje visible en Control Horario (Haversine, verde/rojo)** | 🟡 base sólida y honesta; falta anti-fraude de raíz (QR dinámico) y editar los existentes |
| **Anti-fraude de presencia (evita fichar-fuera y suplantación)** | Sesame/Factorial (geofence duro + biometría/NFC) | 🔴 paliativo puesto (aviso+registro), solución real pendiente | 🔴 frente serio: **QR dinámico firmado (location_id+tiempo) en pantalla fija del local + sesión personal en el móvil** — presencia × identidad no-compartible. El GPS de navegador miente cientos de m sistemáticamente (Natacha 670 m fijos dentro del local) → bloquear por GPS es inviable |
| **Editar/corregir fichajes con rastro legal** | todos (ley RD 8/2019 + control horario 2026) | NO construido | 🔴 frente — la ley PERMITE corregir si hay log inmutable (quién/cuándo/antes-después/por qué), original nunca se pisa, 4 años, nada biométrico |
| Cuadrantes / planificación de turnos (drag-and-drop, plantillas hostelería) | Combo/Skello (verticales), Sesame (rotativos) | básico | 🔴 frente grande |
| Ausencias/vacaciones conectadas al cuadrante | Factorial, Sesame, Shiftbase | 🔴 | 🔴 |
| Disponibilidad del empleado / open shifts | Skello Smart Planner, Planday | 🔴 | 🔴 |
| Alertas de convenio (horas extra, descansos 12h, publicación tardía) | todos | 🔴 | 🔴 legal-crítico |
| Portal/app del empleado (ver turno, fichar, pedir vacaciones) | todos | parcial | 🟡 |
| **Informe legal de jornada para Inspección** | todos (obligatorio) | 🔴 | 🔴 obligatorio por ley |
| **% personal sobre ventas / coste laboral / ventas por hora** | Combo/Planday estiman cruzando el TPV | 🔴 aún no, pero… | 🟢 **ventaja estructural**: Folvy tiene ventas+personal+escandallos en UNA verdad → informes que los demás solo aproximan por integración frágil |

**Veredicto (06/07): 🔴 mayormente por construir, con una ventaja de goleada latente.** El ángulo ganador (mismo patrón que ofertas: margen real donde otros estiman): **coste de personal REAL cruzado con ventas REALES** — % personal sobre ventas en tiempo real por local/turno, ventas por hora trabajada, planificar turnos según la previsión de ventas (histórico que ya tenemos). Prioridad honesta: informes primero (los datos ya están) → editar fichajes con auditoría legal → cuadrantes → ausencias/app/alertas. Benchmark: Combo, Skello (verticales hostelería), Sesame (rotativos), Factorial (suite RRHH), Planday/Shiftbase (demanda+TPV).

**Actualización 08/07:** desatascado el fichaje con un **paliativo digno** (no bloquear + transparentar): radios a 200 m/warn, aviso rojo con confirmación al fichar fuera de zona, bug de Marlón resuelto (GPS falla ya no bloquea), distancia por fichaje visible en Control Horario, y 2 consultas de auditoría por Haversine. Confirmado con datos que el GPS de algunos móviles miente de forma sistemática (no es fraude) → **la solución de fondo es el QR dinámico + sesión personal, no un radio más estricto**. Los INFORMES de Team (incluido el % personal sobre ventas) quedan como el frente propio grande de la próxima sesión.

# RESUMEN — el tablero de una mirada

**Folvy YA golea (9, act. 03/07)**: formatos anidados, recepción anti-error + OCR sin humano, ventas delivery + comisiones, APPCC con corrección, IA multi-módulo + anti-invención, pasos enlazados (vs tspoon), **CRM con margen real delante de cada oferta (bienvenida/frecuencia/campañas — nadie lo tiene)**, **Ómnibus por construcción + artículo espejo (goleada única, área 10)**, **baja RGPD 7.3 demostrable en un toggle**.

**Oportunidades de goleada (nadie lo hace, Folvy diseñado)**: autoinventario IA, merma por diferencia, planificación MRP (compras y producción), importar escandallo por foto IA, foto IA de ficha, reparto propio.

**Ventaja de arquitectura (transversal, 08/06)**: modelo CANÓNICO multi-TPV con FRONTERA ÚNICA — toda venta entra por un adaptador que la traduce a un formato interno común; el core (coste, fiabilidad, inventario, analítica) no depende de ningún TPV. Añadir Glovo/Uber/Otter/Deliverect = un adaptador, sin tocar el núcleo. tspoon vive atado a su TPV/Shopify; R365/Toast al TPV USA; Apicbase tiene API pero no este patrón de adaptadores para delivery ES. Sostiene la promesa "conecto con lo que tengas" sin que cada integración sea un proyecto. Fiabilidad del casado VISIBLE y honesta (% del dinero realmente costeado, no maquillado) — distingue "sin receta" de "sin carta"; tspoon junta todo en "no vinculado".

**Deudas críticas (Folvy detrás, urgen)**:
1. 🔴 **Verifactu/facturación electrónica** — obligación fiscal, se pierden clientes sin ella.
2. 🔴 **Inventario perpetuo + AvT** — lo que MÁS usa Llorente29 (510 inv); R365 es bandera aquí.
3. 🔴 **Three-way match** — tspoon/R365/Marketman lo tienen.
4. 🔴 **Trazabilidad de lote + FEFO**.

**Deudas con plan de goleada (alcanzar y superar)**: alérgenos/nutrición auto (vs meez), IA copiloto que cierra bucles completos / capa proactiva (vs R365 AI/Toast IQ), pedido automático por proveedor (vs tspoon).

**El espacio de Folvy (la tesis)**: nadie une la UX-de-cocina de meez + el ciclo-cerrado de tspoon/R365 + IA que planifica y cierra bucles, en un producto SMB español con delivery nativo. meez es solo cocina (se declara capa sobre R365). R365 es finanzas USA. tspoon es ciclo ES pero registro manual sin IA real. Apicbase es cadenas grandes sin front. **Folvy = MRP II de ciclo cerrado + IA + UX de cocina + delivery ES, para SMB.**

---

## Pendiente de rellenar (próximas pasadas, por área)
- Crunchtime: detalle por área (hoy solo cabecera) — disparador: frente inventario/cadenas.
- meez menu matrix: detalle vs Ingeniería de menús de Folvy — disparador: frente ventas/margen.
- Apicbase internal ordering: detalle — disparador: frente producción/multi-local.
- Gstock/Mapal: detalle por área — disparador: cuando compitan en un frente concreto.
- Precios actualizados: caducan; reverificar antes de usar en argumentario comercial.
