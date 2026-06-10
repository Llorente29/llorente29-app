# Folvy — T2: Registro de merma proactivo (waste log)

**Módulo de inventario y merma · capa B · diseño para aprobación**
RECON + benchmark de la pieza completos. No se ha tocado código.

---

## 1. Qué es

La pantalla para registrar la merma **en el momento en que ocurre**: "tiré 2 kg de
tomate caducado", "se rompió una caja de huevos", "regalé 3 cafés". Baja el stock real
y queda con su causa. Es la fuente PROACTIVA de merma explicada (la reactiva es el
`reason_code` del conteo). Sin esto, toda variación es "inexplicada" hasta el conteo.

---

## 2. Benchmark de la pieza — dónde igualamos y dónde goleamos

### Estándar (Toast/xtraCHEF, MarketMan, Apicbase)
- Evento de merma contra un artículo: tipo + causa + cantidad + foto + empleado + hora
  → coste calculado automático.
- Mantra unánime: el waste log solo funciona si es **rápido y diario** (acto reflejo).
- Capturan el "porqué" siempre, para detectar patrones.
- Apicbase añade ángulo sostenibilidad (huella de carbono, agua) — secundario para MVP.

### tspoon (dump real)
- Parte de merma (cabecera `MM0001` + fecha + descripción) que agrupa líneas.
- Catálogo de tipos: Caducado, Consumo Personal, Mal estado, Regalo, Error pedido
  cliente, Ajuste almacén.

### Veredicto
Replicar "evento con tipo/causa/foto/coste" = empate. Donde se golea:
1. **Unidades de uso amigables** (idea Julio, diferenciador): registrar en gestos de
   cocina ("1 cazo", "media bandeja", "2 lonchas") y que Folvy traduzca a coste y stock.
   Nadie lo hace: todos obligan a gramos/unidad de inventario.
2. **Circuito cerrado con el AvT**: la merma proactiva entra como "merma explicada" en
   el AvT de periodo (T3) sin que el gestor cruce nada a mano. En los líderes registras
   en un sitio y miras el informe en otro.
3. **Foto + lote + caducidad** ya soportados por el ledger (`lot_code`, `expiry_date`)
   sin tabla extra → trazabilidad de qué lote se tiró.

---

## 3. Modelo de datos — decisión

**Evento plano como unidad base** (no cabecera+líneas). Cada merma = una fila, un clic,
porque encaja con el mantra "rápido y reflejo" que hace que un waste log se use. La
agrupación por día/parte es una VISTA (agrupar eventos), no una obligación de captura.
Esto golea a tspoon (su parte con cabecera añade fricción al registro del día a día).

### Cómo se escribe (sin tabla nueva de cabecera)
La merma es una **salida en el ledger** con su tipo y causa:
- `movement_type = 'merma'` (nuevo tipo, hermano de consumo/ajuste/apertura).
- `qty_base` negativo (sale del stock).
- `unit_cost` = WAC del instante (coste real de lo que se tira).
- `source_type = 'waste'` (nuevo valor en el constraint).
- `lot_code` / `expiry_date` opcionales (qué lote/caducidad se tiró).
- `notes` = contexto libre ("se cayó al suelo").

### Tabla nueva: causa estructurada
El ledger no tiene campo "causa". Una tabla ligera `stock_waste` (cabecera del evento)
referenciada desde el movimiento por `source_id`:
- `id`, `account_id`, `location_id`, `recipe_item_id`
- `reason_code` (catálogo, ver §4)
- `qty_base`, `use_unit_label` + `use_unit_factor` (la unidad amigable usada al registrar)
- `unit_cost`, `cost_eur` (derivado)
- `photo_url` (opcional)
- `lot_code`, `expiry_date` (opcional)
- `notes`, `occurred_at`, `created_by`, `created_by_name`, `created_at`
- RLS por cuenta (igual que el resto de Supply).

El movimiento de ledger apunta a este registro (`source_type='waste'`, `source_id=stock_waste.id`).
Así el AvT (T3) suma merma explicada leyendo movimientos `merma` con su causa.

---

## 4. Catálogo de causas (merma proactiva)

Subconjunto curado, alineado con tspoon + los líderes (NO el del conteo, que es otro
contexto). Propuesta:
- `caducado` — Caducado / fuera de fecha
- `mal_estado` — Mal estado / deteriorado
- `rotura` — Rotura / se cayó
- `sobreproduccion` — Sobreproducción (se cocinó de más)
- `error_preparacion` — Error de preparación (se quemó, mal hecho)
- `regalo` — Regalo / invitación
- `consumo_personal` — Consumo del personal
- `devolucion_cliente` — Devolución de cliente
- `otro` — Otro (con nota obligatoria)

Configurable a futuro por cuenta (como las tolerancias). En T2: catálogo fijo curado.

---

## 5. Unidades de uso amigables (el gol)

Si el artículo tiene unidades de uso definidas (`recipe_item_unit_conversion` con
etiqueta+factor, parcial hoy), el registro ofrece esos gestos ("1 cazo = 0,25 L"). El
cocinero elige "2 cazos", Folvy guarda `qty_base = 0,5 L` y el coste. Si el artículo no
tiene unidades amigables, cae a la unidad base (gramos/ud) — funciona igual, sin bloquear.
Guardamos la etiqueta usada (`use_unit_label`) para que el listado muestre "2 cazos", no
"0,5 L" (lenguaje de cocina en la vista, base en el cálculo).

---

## 6. UX — pantalla de registro rápido

Dónde: nueva pestaña "Merma" en Inventario (junto a Áreas/Conteos/Consumo), + acceso
rápido. Patrón: una fila de alta siempre visible arriba (artículo → cantidad en unidad
amigable → causa → [foto] → registrar), y debajo el listado del día/periodo agrupado,
con € total. Rápido y reflejo, como mandan los líderes.

- Buscador de artículo (raw activos del local).
- Cantidad + selector de unidad amigable (o base si no hay).
- Causa (catálogo §4); "otro" pide nota.
- Foto opcional (Storage, como APPCC/recepción ya hacen).
- Coste calculado y mostrado al vuelo (WAC × cantidad base).
- Al registrar: escribe `stock_waste` + movimiento `merma` al ledger + recalcula saldo.

---

## 7. Tramos de T2 (por capas, deuda 0)

- **T2.1 — Esquema**: tipo `merma` + source_type `waste` en constraints; tabla
  `stock_waste` + RLS; migración versionada; regenerar `database.ts`.
- **T2.2 — RPC de registro**: `register_waste(...)` (frontera con guard) que valida,
  inserta `stock_waste`, escribe el movimiento `merma`, recalcula saldo. SECURITY DEFINER.
- **T2.3 — Servicio + pantalla**: servicio `wasteService.ts` + pestaña "Merma" con la
  fila de alta rápida + listado del periodo + €. Unidades amigables si existen.
- **T2.4 — Enganche AvT**: dejar listo que T3 lea movimientos `merma` como merma
  explicada (no se construye aquí; solo se garantiza que el dato queda bien).

---

## 8. Lo que NO toca T2 (contención)

- No toca el conteo ni su `reason_code` (es la otra fuente de merma, reactiva; ambas
  suman en el AvT).
- No construye el AvT (es T3).
- No añade selector manual de local (contexto operativo).
- Sostenibilidad/HACCP (huella carbono) = posible extensión futura, fuera de MVP.

---

## 9. Pregunta abierta para Julio

1. **¿Quién puede registrar merma?** ¿Cualquier trabajador (cocinero registra lo que
   tira), o solo manager/admin? Los líderes lo abren a todo el equipo (es el punto: que
   sea reflejo). Mi recomendación: cualquier rol con acceso al local puede registrar;
   solo ver el AvT/coste agregado queda para manager. ¿De acuerdo?
2. **¿Foto obligatoria u opcional?** Recomendación: opcional (obligar frena el reflejo).
