# Folvy — Inventario perpetuo: el tronco del MRP II
### Diseño del sistema completo (plano del que cuelga cada capa). 04/06/2026.

## Decisión de modelo (tras benchmark de hostelería + WMS industrial + retail + ERP)
NO es "elegir entre inventario semanal, autoinventario o auditoría". Son piezas distintas
que resuelven problemas distintos y los mejores las COMBINAN. El inventario perpetuo es el
SALDO VIVO; los conteos son la VERIFICACIÓN de ese saldo; la auditoría es el CÓMO se cuenta
para que sea fiable. Folvy monta un sistema de TRES NIVELES:

### Nivel 1 — Saldo vivo (ledger perpetuo)
El stock se deriva del libro mayor de movimientos con signo: entra (+) por recepción,
sale (−) por consumo (ventas×escandallo), ± por ajustes/conteos/traspasos. Corre SOLO, sin
que nadie cuente. Da stock estimado en tiempo real por local.
- **Estado:** medio construido. `stock_movement` (qty_base con signo, lote, caducidad,
  unit_cost, movement_type, source_type) + `recipe_item_location_stock` (WAC) +
  `recompute_location_stock` ya existen. La RECEPCIÓN ya escribe (+). Falta el CONSUMO (−).

### Nivel 2 — Autoinventario diario (comodidad)
La IA selecciona 3-5 productos/día por ABC (valor) + riesgo + rotación + anomalías, y QUIÉN
cuenta (no siempre el mismo, no su zona). Se cuentan a ciegas en minutos; el sistema corrige
el saldo y registra la variación, que se analiza y comunica sola. Mantiene precisión sin
parar la cocina nunca. IDEA OBLIGATORIA de Julio. EXTENSIÓN: en productos de alto valor del
escandallo, comparar contra escandallo y calcular EFECTO ECONÓMICO de la merma en €.

### Nivel 3 — Auditoría de cierre (solidez)
Cada X configurable por empresa (semana/quincena/mes), un conteo más amplio o completo que
cierra el período y da el AvT real fiable + el inventario final para el COGS. Aquí el
"inventario completo" tiene sentido: como FOTO DE CIERRE, no como rutina diaria pesada.

### Transversal — Disciplina de auditoría (el CÓMO)
Aplica a los niveles 2 y 3, no es un nivel aparte:
- **Blind count por defecto:** la celda "contado" nace vacía; no se muestra la cantidad
  esperada (evita sesgo de confirmación). Mismo principio que la recepción anti-error.
- **Tolerancias por clase ABC:** ~1-2% para "A", hasta ~5% para "C" (configurable por cuenta,
  como supply_settings). Variación dentro de tolerancia → autoajuste con motivo; fuera →
  escala a recuento (segundo contador, primer resultado enmascarado) + investigación.
- **Nada se ajusta sin aprobación + código de motivo.** Todo deja rastro (audit trail).
- **Reason codes:** merma, caducado, rotura, robo/desconocido, error de escandallo, error de
  recepción, traspaso no registrado. Alimentan el análisis de causa.

## Por qué esta combinación (cómodo + fiable + sólido)
- Cómodo: el día a día es el goteo de 3-5 productos (N2), nunca un parón.
- Fiable: blind count elimina sesgo; tolerancias ABC cazan lo que importa; nada se ajusta sin aprobación.
- Sólido: la auditoría de cierre (N3) da el COGS real y el AvT verdadero cada período.
- Semanal-completo solo = fiable pero incómodo. Autoinventario solo = cómodo pero no cierra.
  Juntos con la disciplina de auditoría = los tres atributos.

## La fundación común a construir primero
N2 y N3 son, por debajo, EL MISMO MOTOR DE CONTEO: cambian QUÉ se cuenta (la IA elige unos
pocos, o se cuenta todo) y CADA CUÁNTO. Por eso la primera capa es el **motor de conteo +
ajuste con blind count**. Sobre él se montan autoinventario (N2) y auditoría (N3) sin reescribir.

## Orden de capas (cada una usable sola)
1. **Motor de conteo + ajuste (shelf-to-sheet por zona, blind, tolerancias, aprobación→ajuste).**
   La fundación. Storage areas (hogar del artículo), hoja secuenciada por ubicación física
   (no alfabética), conteo a ciegas, variación vs sistema, aprobación → movimiento de ajuste
   automático con motivo. Móvil, en equipo. Benchmark: MarketMan/Crunchtime/NetSuite shelf-to-sheet.
2. **Consumo por ventas×escandallo (las salidas, motor del AvT).** Ventas (ya las hay) ×
   recipe_line → movimientos `consumo`. El stock baja solo; aparece el primer AvT real.
3. **Autoinventario IA (cycle counting ABC).** La IA elige qué/quién contar cada día. N2.
4. **Auditoría de cierre periódica.** Configurable por empresa; cierra período + AvT fiable. N3.
5. **FEFO + acceso del trabajador (portal).** Afinado de perecederos (lote/caducidad ya en
   el modelo) + punto de entrada en el portal del worker para CONTAR y RECIBIR (une la deuda
   de la foto de albarán pendiente). Conteo y recepción desde el móvil del trabajador.

## Storage areas — decisión de modelo (capa 1)
Concepto estándar (MarketMan): cada artículo tiene un "hogar" (área de almacén: cámara, seco,
barra…) y puede estar en varias. La hoja de conteo se secuencia por área física → contar es
rápido y no se olvida nada. Folvy: tabla `storage_area` (por local) + asignación artículo↔área
con orden. La hoja de conteo sale ordenada por área+orden. (RECON antes de construir: ver si
ya existe algo de áreas/almacenes.)

## Lo que ya está (no rehacer)
- Ledger con signo + WAC + lote + caducidad + tipos de movimiento (consumo/recuento/traspaso
  ya en el CHECK) + source_type (sale/inventory_count/transfer/adjustment ya en el CHECK).
- `recompute_location_stock` (suma con signo). recipe_line (escandallo, para el consumo).
- Umbral configurable por cuenta: patrón supply_settings reutilizable para tolerancias.

## Benchmark resumido (fuentes)
- Perpetuo = saldo; cycle count = verificación del saldo (SphereWMS, NetSuite).
- ABC: 20% de artículos = 80% del valor; "A" se cuentan más (NetSuite, Fishbowl).
- Cadencia A semanal / B mensual / C trimestral + pasada extra tras evento de cambio (Uphance, SG Systems).
- Blind count por defecto contra sesgo; recuento con primer resultado enmascarado; reason
  codes; CAPA si sistémico; nada se ajusta sin aprobación (Sensiba, EZO, SG Systems, CPCON).
- Tolerancia 1-2% "A" / 5% "C", escalado automático de excepciones (Nuage/NetSuite).
- Shelf-to-sheet por storage area, secuenciado físico, móvil en equipo (MarketMan, Crunchtime, NetSuite).
- AvT: teórico (ventas×receta) vs real (inicial+compras−final); <2% bien, 3-5% mejorable,
  >5% investigar (meez, R365, Toast, Crunchtime, Galley).
- Combinar siempre cycle + conteo total de cierre; GAAP/IRS aceptan perpetuo con controles (ISM).

## Diferencial Folvy (lo que nadie cierra)
- Autoinventario IA que elige qué/quién + analiza y comunica diferencias solo.
- Efecto económico de la merma contra escandallo en € (alto valor).
- Conteo y recepción desde el mismo punto en el portal del trabajador.
- Todo enchufado al margen del plato (cascada de coste ya viva) y al motor de IVA por fecha.
