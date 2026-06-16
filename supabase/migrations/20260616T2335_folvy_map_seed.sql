-- ============================================================================
-- FOLVY MAP — SEMILLA (estado medido el 16/06/2026, RECON global)
-- ----------------------------------------------------------------------------
-- Idempotente: ON CONFLICT (code) actualiza nombre/estado/nota, no duplica.
-- Re-ejecutable cuando quieras para resembrar el árbol base.
--
-- status_declared: vivo | a_medias | deuda | bloqueado | vacio | idea
--   vivo      = construido y con datos reales de operación
--   a_medias  = construido pero parcial / chasis incompleto
--   vacio     = código existe pero SIN ESTRENAR (0 filas, no es un fallo)
--   deuda     = construido pero con deuda declarada que hay que cerrar
--   bloqueado = no avanza por una dependencia concreta
--   idea      = aún NO existe como código (futuro)
--
-- measure_table: tabla cuya población mide el estado objetivo en vivo.
--   Las filas entre paréntesis al final de cada nota = conteo medido 16/06.
-- ============================================================================

BEGIN;

INSERT INTO public.folvy_map_node
  (code, name, description, layer, flow_order, status_declared, status_note, measure_table)
VALUES

-- ───────────────────────── APROVISIONAMIENTO ─────────────────────────
('supply.proveedores',   'Proveedores',            'Maestro de proveedores y alias.', 'aprovisionamiento', 10, 'vivo',     'En uso (41 proveedores, 8 alias).', 'supplier'),
('supply.articulos',     'Artículos de proveedor', 'article_supplier: formato + precio por proveedor×ingrediente.', 'aprovisionamiento', 20, 'a_medias', 'Poblado (459) pero precio PACTADO casi nadie (1/416). Editar precio proveedor = deuda viva.', 'article_supplier'),
('supply.pedidos',       'Pedidos de compra',      'Orden sobre catálogo del proveedor, multi-local, PDF.', 'aprovisionamiento', 30, 'vivo',     'En uso (14 pedidos, 56 líneas).', 'purchase_order'),
('supply.recepcion',     'Recepción de albarán',   'Confirmar lo recibido, OCR, formatos caja↔pieza, movimiento de entrada.', 'aprovisionamiento', 40, 'deuda',    'En uso (31 albaranes, 195 líneas). DEUDA UX: arranque en frío (montar formato en plena recepción), rojo que no frena, €/caja vs importe total. Rediseño pendiente.', 'goods_receipt'),
('supply.facturas',      'Facturas + three-way',   'Factura → casado de líneas → last_price → coste. El paso 4 OCR factura→coste.', 'aprovisionamiento', 50, 'vacio',    'SIN ESTRENAR (0). Eslabón factura→coste no existe aún en datos.', 'supplier_invoice'),

-- ───────────────────────── COCINA / ESCANDALLO ─────────────────────────
('kitchen.ingredientes', 'Ingredientes (raw)',     'Catálogo de materias primas: familia, IVA, alérgenos, coste, conservación.', 'cocina', 10, 'vivo', 'Núcleo maduro (907 items). 178 de Llorente29 clasificados 16/06.', 'recipe_item'),
('kitchen.familias',     'Árbol de familias',      'Clasificación de ingredientes (AECOC). Por cuenta.', 'cocina', 15, 'deuda', 'Funciona (88 filas) pero PLANO. Falta seed al onboarding + lista grande jerárquica con código. Frente prioritario.', 'recipe_family'),
('kitchen.escandallos',  'Escandallos (recetas)',  'recipe_line: composición y coste server-side al céntimo.', 'cocina', 20, 'vivo', 'Corazón del producto, muy maduro (1353 líneas).', 'recipe_line'),
('kitchen.formatos',     'Formatos de compra',     'Caja→stock→uso: 3 capas de unidad por artículo.', 'cocina', 25, 'a_medias', 'Poblado (547) pero el montaje en frío es la fricción de recepción.', 'recipe_item_purchase_format'),
('kitchen.pasos',        'Pasos de receta (E8)',   'Pasos ligados a ingredientes (diferenciador vs meez/Apicbase).', 'cocina', 30, 'vacio', 'Construido pero SIN ESTRENAR (0 pasos). No es fallo, es sin usar.', 'recipe_item_step'),
('kitchen.unidades_uso', 'Unidades de uso amigables','"1 papel, 1 loncha, 1 cazo": el cocinero no piensa en gramos.', 'cocina', 35, 'idea', 'DIFERENCIADOR sin estrenar (0 conversiones). Sobre recipe_item_unit_conversion.', 'recipe_item_unit_conversion'),
('kitchen.modificadores','Modificadores',          'Punto de elección que altera líneas y coste (milanesa pollo/ternera).', 'cocina', 40, 'vivo', 'En uso (groups 86, options 320, impacto 3).', 'modifier_group'),
('kitchen.master',       'Master de ingredientes', 'ingredient_template global compartido (efecto red).', 'cocina', 50, 'a_medias', 'Sembrado pequeño (56). Falta crecerlo a lista grande.', 'ingredient_template'),

-- ───────────────────────── VENTA / INGESTA ─────────────────────────
('sales.ingesta',        'Ingesta canónica (TPV)', 'Venta entra por adaptador (Last.app); frontera única multi-TPV.', 'venta', 10, 'vivo', 'A pleno rendimiento (webhook log 5162, mapeo 112).', 'lastapp_webhook_log'),
('sales.ventas',         'Ventas',                 'sale / sale_line: ticket completo, raw event store.', 'venta', 20, 'vivo', 'En uso fuerte (1146 ventas, 3836 líneas).', 'sale'),
('sales.catalogo',       'Catálogo / carta',       'menu_item por marca×canal: name, precio, foto, vat.', 'venta', 30, 'vivo', 'Poblado (750 items, 114 categorías).', 'menu_item'),
('sales.marcas',         'Marcas',                 'brand + mapeo estable por UUID (external_brand_map).', 'venta', 40, 'vivo', 'En uso (34 marcas, 85 mapeos).', 'brand'),
('sales.kds',            'KDS (cocina en vivo)',   'Tablero por estación, Cook Mode, multi-tablet.', 'venta', 50, 'a_medias', 'Capa 1 viva (12 estaciones, 6 devices) PERO ruteo familia→estación bloqueado (kitchen_family_route 0).', 'kitchen_station'),

-- ───────────────────────── CONSUMO / INVENTARIO ─────────────────────────
('inv.stock',            'Stock perpetuo',         'stock_movement: cada entrada/salida mueve stock por ubicación.', 'consumo', 10, 'vivo', 'Motor con muchísimo movimiento (4320). Stock por local 548.', 'stock_movement'),
('inv.autoinventario',   'Autoinventario IA',      'A1-A4: qué/cuánto/quién contar. La joya que tspoon no tiene.', 'consumo', 20, 'vivo', 'En producción (1488 líneas de conteo). LA pieza difícil, hecha.', 'inventory_count_line'),
('inv.almacenes',        'Almacenes / áreas',      'Áreas físicas, ubicaciones, asignación de ingredientes.', 'consumo', 30, 'a_medias', 'CHASIS INCOMPLETO: 14 áreas pero solo 28 ingredientes asignados (de 907). Rompe el autoinventario en frío. Frente grande tipo tspoon.', 'recipe_item_storage_area'),
('inv.mermas',           'Mermas',                 'Registro y trazabilidad de merma.', 'consumo', 40, 'vacio', 'SIN ESTRENAR (0). Parte del módulo almacén completo.', 'stock_waste'),
('inv.consumo_teorico',  'Consumo teórico',        'Ventas × escandallo = lo que deberías haber gastado.', 'consumo', 50, 'idea', 'Encendible pronto (datos ya existen) vía RPC, sin esperar inventario.', NULL),

-- ───────────────────────── MARGEN / MRP II ─────────────────────────
('margen.coste',         'Coste real al céntimo',  'Coste server-side por ingrediente y plato, recompute automático.', 'margen', 10, 'vivo', 'Validado contra tspoon. Es la verdad de Folvy.', NULL),
('margen.rentabilidad',  'Rentabilidad / AvT',     'Margen por plato, food cost, análisis de ventas teórico.', 'margen', 20, 'a_medias', 'Existe vista pero depende de coste poblado (muchas "sin coste").', NULL),
('margen.mrp2',          'MRP II ciclo cerrado',   'Previsión → explosión → órdenes → recepción → three-way → AvT.', 'margen', 30, 'idea', 'DESTINO estratégico. Construido por capas; previsión/explosión aún no.', NULL),

-- ───────────────────────── PLATAFORMA / DELIVERY ─────────────────────────
('plat.comisiones',      'Comisiones / economía',  'Comisión por canal + override por marca; margen real por plato×plataforma.', 'plataforma', 10, 'vacio', 'Diseñado, SIN ESTRENAR (brand_channel 0, rate 0).', 'brand_channel_rate'),
('plat.otter',           'Adaptador Otter',        'Integración propia con Otter (catálogo bidireccional).', 'plataforma', 20, 'idea', 'Adaptador diseñado + esqueleto; pendiente alta (App ID/Secret). 2º correo enviado.', NULL),
('plat.hubrise',         'Adaptador HubRise',      '1 API cubre Uber+JustEat. Vía rápida vía Cliente 2.', 'plataforma', 30, 'idea', 'Muy avanzado en negociación (Janaina). Build sobre ingesta canónica.', NULL),
('plat.catcher',         'Catcher (reparto propio)','Broker last-mile: coste real de transporte propio.', 'plataforma', 40, 'idea', 'Integración futura; no bloquea comisiones.', NULL),
('plat.tienda',          'Tienda propia (Folvy Shop)','Canal directo que SABE el margen real; carrito cruzado multimarca.', 'plataforma', 50, 'idea', 'Estudio hecho (docs/folvy_tienda_propia_estudio.md). Stripe Connect MVP. Fases S1→S5.', NULL),
('plat.cedidas',         'Marcas cedidas (Cloudtown)','Espejar + costear escandallos de CTB; Llorente29 corre compra+stock.', 'plataforma', 60, 'idea', 'Pendiente: ver si CTB da acceso a su base / export. Si no, gestión manual.', NULL),

-- ───────────────────────── SOPORTE ─────────────────────────
('soporte.appcc',        'APPCC',                  'Planes, plantillas, ejecuciones, firmas, incidencias, auditorías.', 'soporte', 10, 'a_medias', 'Día a día MUY usado (87 ejec, 247 resp, 46 firmas) PERO auditorías e incidencias sin estrenar (0).', 'appcc_executions'),
('soporte.team',         'Equipo / fichajes',      'Empleados, fichajes, turnos, formaciones.', 'soporte', 20, 'a_medias', 'Base viva (6 empleados, 22 fichajes) pero turnos avanzados/vacaciones sin estrenar.', 'employees'),
('soporte.comunicaciones','Comunicaciones',        'Dispatcher multicanal, email log.', 'soporte', 30, 'a_medias', 'Fase A; Edge Function email B.2 diseñada NO desplegada (revisión seguridad).', 'account_email_log'),
('soporte.monitor',      'Monitorización ingesta', 'Alarma por silencio de ventas en horario.', 'soporte', 40, 'idea', 'config existe (1), service_windows sin sembrar. Construir con módulo Horarios.', 'ingestion_monitor_config'),

-- ───────────────────────── ADMIN / BASE ─────────────────────────
('admin.billing',        'Facturación / planes',   'Suscripciones, planes, gate de estado de cuenta.', 'admin', 10, 'a_medias', 'Estructura viva (1 suscripción, 19 items) sin operación de cobro real.', 'subscriptions'),
('admin.cuentas',        'Cuentas / locales',      'accounts, locations, usuarios, permisos.', 'admin', 20, 'vivo', 'En uso (2 cuentas, 6 locales, 8 usuarios).', 'accounts'),
('admin.saneamiento',    'Saneamiento / backups',  'Tablas _backup_* y deuda de limpieza.', 'admin', 90, 'deuda', '10 tablas _backup_20260516/17 = basura real a borrar. Único cadáver literal.', NULL)

ON CONFLICT (code) DO UPDATE SET
  name            = EXCLUDED.name,
  description     = EXCLUDED.description,
  layer           = EXCLUDED.layer,
  flow_order      = EXCLUDED.flow_order,
  status_declared = EXCLUDED.status_declared,
  status_note     = EXCLUDED.status_note,
  measure_table   = EXCLUDED.measure_table,
  updated_at      = now();

COMMIT;
