# Folvy — Cierre de sesión 05/06/2026 (tarde)

Documento de traspaso. Pegar al inicio de la próxima conversación o guardar en
`docs/`. Resume lo hecho hoy y lo que queda, para arrancar sin perder contexto.

---

## Lo conseguido hoy (todo commiteado y en producción)

### Bloque Catálogo de Marca (mañana)
- **Esquema Fase A + A6** (8 tablas + idempotencia + nullable). Commit 8716f9c, 47eb640.
- **Importador Last.app** (`lastapp-catalog-import`): 151 productos, 17 combos, 9 marcas
  importados limpios. Tabla rasa previa. Commit ae855fa.
- **Pantalla Menú** (Folvy Kitchen): carta de marca read-only, KPI cobertura escandallo,
  categorías, combos. Commit 9ace0e7.

### Bloque Ficha de Producto (Fase B, tarde)
- **B1 — Detalle de producto** (`CatalogProductDetailPage`): ficha navegable con índice
  sticky lateral + secciones apiladas (decisión UX basada en Baymard: tabs horizontales
  esconden contenido; índice pegajoso da overview + atajos, como Otter). Secciones:
  Datos (editable), Precios, Modificadores (lectura), Disponibilidad, Avanzado. Las tres
  últimas son contenedores "próximamente" honestos. Commits 9b0abdf.

### Bloque Economía de Canal (tarde) — el corazón económico
- **Documento de diseño** `docs/folvy_economia_canal_promociones_diseno_2026-06-05.md`:
  modelo completo de margen (3 niveles), IVAs, conector multi-broker, gestor de campañas
  Ómnibus, 10 fases. Commit 7a3b0db.
- **E1 — Comisiones (capa de datos)**: tabla `channel_rate` (defecto por canal) +
  `menu_item_economics` con fallback por especificidad (override marca×canal > defecto
  canal > NULL). Migración `20260605T0300`. database.ts regenerado. Commit efd8f5e.
- **E1 — Comisiones (UI)**: zona **Ajustes** en sidebar de Folvy Kitchen +
  `channelRateService` + `KitchenSettingsPage`. Configura comisión por canal (Glovo 15%,
  etc.). Commit 6c52f54.

---

## Pendiente inmediato (al retomar)

1. **VERIFICAR E1 en vivo** (no se llegó a probar): arrancar app → Folvy Kitchen →
   Ajustes → configurar Glovo (comisión %, tipo de servicio). Luego abrir ficha de un
   producto de marca propia en Glovo y comprobar que el margen recoge la comisión vía el
   fallback. Esta es la prueba real del fallback de E1.

2. **E2 — Margen unitario en la ficha (sección Precios)**: mostrar la CASCADA transparente
   y configurable (decisión de Julio: "que sea transparente, se identifique rápido y sea
   configurable"). PVP − escandallo − comisión − transporte (configurable, marcado como
   estimación) = margen. Cada línea visible. Toggle por concepto de qué entra en el margen.
   La función menu_item_economics ya devuelve los componentes; falta presentarlos + restar
   el transporte (hoy `delivery_fee`/own_courier_cost se expone pero NO se resta del
   net_margin — ESA es la pieza que faltaba, la que evita vender a pérdida).

3. **brand_channel sigue VACÍO**: para overrides por marca (caso Uber variable) hay que
   poblar brand_channel. Sub-paso de E1 o E2.

---

## Decisiones clave tomadas hoy (no perder)

- **Catcher = broker de reparto propio** (last-mile), NO agregador de comisiones. Da el
  COSTE REAL de transporte por pedido (~6,30€/pedido en Llorente29: 5,38€ rider + 0,96€
  comisión Catcher), cruzable con ventas por order_code. Tiene credenciales de pruebas.
  NO da la comisión de plataforma (esa es config manual).
- **JELP** = segundo broker, igual que Catcher → el conector de transporte debe ser
  MULTI-BROKER (capa genérica, adaptadores Catcher/JELP), como el de TPV.
- **Modelo de margen en 3 niveles**: (1) unitario para fijar PVP, (2) real por pedido a
  posteriori, (3) rentabilidad de canal por periodo. Ads NUNCA al coste unitario (sería
  inventar) → solo nivel 3. Promos: se simulan para PVP, se miden reales (sale.discount_amount)
  para margen.
- **Ley Ómnibus** (descubrimiento clave): el precio promocionado se calcula sobre el
  mínimo de 30 días. Glovo ya bloquea promos ilegales. Esto vuelve el precio "pegajoso" y
  empuja el foco al margen — la tesis de Folvy. Julio quiere alcance MÁXIMO: planificar y
  GARANTIZAR rentabilidad de promos + ejecutarlas en plataforma. Técnica del artículo-espejo
  (Patatas Clásicas / Patatas Clásicas 1) para esquivar Ómnibus legalmente: mismo escandallo,
  dos menu_item, activar/desactivar por campaña. Folvy lo orquesta. NADIE en el mercado
  cierra este bucle (verificado: MarginEdge/R365/Apicbase/Livelytics solo a posteriori).
- **IVA heterogéneo** (vigilar mucho): comida 10%, bebida alcohólica/azucarada 21%,
  transporte 21%. Bases homogéneas, nunca mezclar base con total. Motor de IVA versionado
  por fecha ya existe.
- **Ficha de producto**: secciones apiladas + índice sticky (NO tabs). Crece con Precios
  (overrides), Disponibilidad (toggles canal), Avanzado (kitchen_name, fotos, dietéticos).
- **Fotos del catálogo**: el importador Last.app NO las trae. Investigar endpoint o subir
  manual. Pendiente.

---

## Estado técnico
- Stack: React19/Vite8/TS6/Tailwind3/Supabase Pro (xzmpnchlguibclvxyynt).
  Repo C:\dev\llorente29-app, rama main. Cuenta de trabajo: Folvy Interno (0000...0001).
- Build verde, push 0 0 en todos los commits.
- channel_rate creada con RLS. menu_item_economics con fallback. Sin probar en vivo aún.

## Higiene pendiente (de antes)
- www.folvy.app NXDOMAIN. Rotar tokens. needs_review ausente de migraciones.
- Documento de diseño de la ficha de producto (B) sin redactar como .md (opcional).
- Vigilar si Claude Code toca migraciones en paralelo (apareció un T0400 duplicado, borrado).
