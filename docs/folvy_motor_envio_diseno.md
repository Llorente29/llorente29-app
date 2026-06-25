# Folvy · Motor de coste y precio de envío — Diseño

**Estado:** propuesta de diseño para aprobación (no construido).
**Fecha:** 2026-06-25
**Autor:** Claude (coordinador) · revisa Julio Gª Colón

---

## 0. Principio rector (lo que nos hace ganar)

Todos los motores de envío del mercado (Uber Eats, DoorDash, Cartwheel, Shipday, Locus)
fijan el precio de envío "a ojo" o por demanda. **Ninguno conoce el margen real del
pedido.** Folvy sí: escandallo al céntimo + comisión de canal + coste real del repartidor.

> **El surge de Folvy nunca te hace perder dinero**, porque el suelo de cada tarifa es
> el margen real, no una corazonada. Folvy convierte "precio dinámico" en
> "precio dinámico **rentable garantizado**".

Eso es el WOW. Es un guardarraíl que ni Uber, ni Cartwheel, ni Shipday tienen, porque
no tienen el escandallo.

---

## 1. Regla legal innegociable (grabada en el diseño)

Dos familias de ajuste, **separadas a propósito**:

| Familia | Dirección | Se basa en | Legal | Dónde vive |
|---|---|---|---|---|
| **Surge contextual** | SUBE | contexto neutro: zona, clima, hora, demanda, evento | Sí | Capa 3 |
| **Descuento dirigido** | BAJA | cliente/segmento: fiel, nuevo, recuperación, cupón | Sí | Capa 3 |

**La línea roja:** subir el precio por la **identidad** del cliente está prohibido
(Maryland HB0895, abril 2026, multas 10.000–25.000 $; y va a más). Bajar para premiar
está permitido y es deseable.

- ✅ Cliente fiel → −2 € envío (retención).
- ✅ Cliente nuevo → primer envío gratis (captación).
- ✅ Cliente que tuvo un problema → cupón de recuperación puntual (compensar).
- ❌ Cliente "quejica" detectado → subirle el envío (penalizar). **Nunca.**

Principio en una frase: **surge por contexto, descuentos por cliente. Subir = neutro;
bajar = puede ser personal.**

---

## 2. Arquitectura por capas (deuda 0: cada capa funciona sola)

Cada capa es un sistema completo y usable con entrada manual; las siguientes se
enchufan como fuente/consumidor sin reescribir. Patrón ya usado en Folvy
(`pedido.origin`, MRP II).

```
Capa 1  ZONAS + TARIFA BASE        (manual, este frente — la base del hub)
Capa 2  COSTE REAL DEL BROKER      (Catcher / Uber Direct / Shipday)
Capa 3  REGLAS DINÁMICAS           (surge contextual + descuentos dirigidos)
Capa 4  3 VENTANAS AL CLIENTE      (rápido / valor / eco)
        ───────────────────────────────────────────────
        GUARDARRAÍL DE MARGEN REAL  (transversal a todas)
```

### Capa 1 — Zonas + tarifa base  *(se construye primero)*

Modelo Uber Eats Manager, igualado y mejorado. Cada **local** define sus **zonas de
entrega**, que pueden CONVIVIR (radio + polígono + CP a la vez, como Uber: hasta 14
custom/CP + 1 radial).

Cada zona lleva: método, geometría, **coste de envío**, **pedido mínimo**, **ETA**.

**Regla de solapamiento (de Uber):** si una dirección cae en varias zonas, **gana la
tarifa más baja**. (Lo espera el cliente; evita disputas.)

**Métodos (los tres, deuda 0):**
- **Radio** — anillos concéntricos desde el local (0–2 km = 2,50 €; 2–4 km = 3,99 €…).
- **Polígono** — dibujo en mapa (Leaflet) **+ import KML** (Uber lo tiene → lo igualamos).
- **Códigos postales** — lista de CP por zona (exacto en ciudad, sin geocodificar).

### Capa 2 — Coste real del broker  *(después)*

El coste de reparto NO lo inventa Folvy: lo da el operador. Catcher, Uber Direct,
Shipday, Jelp devuelven coste por pedido según distancia/momento.

- Como **Cartwheel**: enrutar al broker más barato disponible (27% menos coste, 20% más
  ingreso delivery en su caso real).
- Folvy **reconcilia**: coste real del broker vs lo cobrado al cliente = margen real del
  envío. `delivery_quote.source` = manual | catcher | uber_direct | shipday…

### Capa 3 — Reglas dinámicas  *(después; aquí vive el WOW)*

Mueven la tarifa **dentro del guardarraíl de margen**.

- **Surge contextual (sube):** clima (lluvia), evento (partido/concierto cercano),
  hora pico, demanda alta, valle (baja). Factores neutros, nunca identidad.
- **Ajuste de doble cara** (de Locus): cuando sube el surge en una zona caliente, a la
  vez se puede ofrecer bonus al repartidor propio para "auto-reparar" la oferta.
- **Descuentos dirigidos (baja):** fiel, nuevo, recuperación, cupón, cumpleaños.

Cada regla declara: disparador (condición), efecto (±€ o ±%), prioridad, y **respeta el
guardarraíl** (no puede dejar el margen bajo el suelo configurado).

### Capa 4 — Las 3 ventanas al cliente  *(después; el WOW visible)*

Transparencia = lo que convierte el dynamic pricing de "sospechoso" en "elección".
Investigación (Accenture/Locus): el cliente odia las tarifas ocultas pero responde bien
a transparencia + elección. En checkout, ofrecer:

- **Rápido** — entrega ya, paga el surge (compra certeza).
- **Valor** — franja valle, más barato (ahorra).
- **Eco** — más lento, más barato, menor huella (gancho para Gen Z/Millennial).

El cliente elige; no se le impone.

---

## 3. Guardarraíl de margen real (transversal — el diferenciador)

En CUALQUIER ajuste (surge arriba o descuento abajo), Folvy calcula al instante:

```
margen_real_pedido = PVP_pedido
                   − coste_escandallo (suma de líneas, ya lo tenemos)
                   − comisión_canal   (modelo de comisiones, ya lo tenemos)
                   − coste_envío_real (broker, Capa 2)
```

- Cada local/marca configura un **suelo de margen** (€ o %).
- Si un ajuste (subir surge poco, o bajar por fidelidad) cruza el suelo → Folvy **avisa**
  ("este envío te deja en pérdidas de 1,20 €") y/o bloquea según política.
- Funciona en ambos sentidos: protege del descuento que arruina y del surge que ahuyenta.

Nadie más puede hacer esto: requiere el escandallo, que es nuestro.

---

## 4. Modelo de datos (propuesta)

> Requiere **PostGIS** (hoy NO instalado; en Supabase es 1 clic:
> `create extension postgis;`). Sin él, radios por `earthdistance`/`cube` y polígonos en
> la app — peor. Recomendación: activar PostGIS.

### `delivery_zone` (Capa 1)
```
id              uuid pk
account_id      uuid not null
location_id     uuid not null          -- la zona pertenece a un LOCAL
name            text                   -- "Centro", "Anillo 0-2km"…
method          text  check (radius | polygon | postal)
-- geometría según método:
radius_m        integer                -- si radius
center          geography(Point)       -- si radius (default = coords del local)
area            geography(Polygon)     -- si polygon
postal_codes    text[]                 -- si postal
-- económico por zona:
delivery_fee    numeric not null
min_order       numeric
eta_min         integer
priority        integer default 0      -- desempate fino; pero la regla base = más barata
is_active       boolean default true
fee_source      text default 'manual'  -- manual | distance | broker | dynamic
created_at / updated_at
```

### `delivery_pricing_rule` (Capa 3 — futura, modelo listo)
```
id, account_id, location_id (nullable = toda la cuenta)
kind            text check (surge | discount)
trigger         jsonb   -- {type:'weather', condition:'rain'} | {type:'segment', value:'loyal'}…
effect          jsonb   -- {mode:'pct'|'eur', value:+20|-2}
direction       text check (up | down)   -- up solo si kind=surge y trigger NO es identidad
respects_floor  boolean default true     -- el guardarraíl manda
priority        integer
is_active       boolean
```
Constraint de diseño: `kind=surge` ⇒ `trigger.type` ∈ {weather, event, time, demand, zone}
(neutros). `trigger.type='segment'/'customer'` ⇒ `direction='down'` obligatorio. (La ley,
codificada en la tabla.)

### `delivery_quote` (Capa 2 — futura)
```
id, sale_id, location_id, zone_id
distance_m, fee_charged, cost_real, cost_source (manual|catcher|uber_direct|shipday)
margin_real     numeric    -- reconciliado
created_at
```

---

## 5. Motor de resolución (dirección → local + coste)

Entrada: dirección del cliente (geocodificada con **Mapbox** → lat/lng).
Salida: local que sirve + coste de envío + ETA.

```
1. geocodificar dirección  → punto (lat,lng)        [Mapbox]
2. buscar TODAS las zonas activas que cubren el punto:
     - radius : ST_DWithin(center, punto, radius_m)
     - polygon: ST_Contains(area, punto)
     - postal : CP del punto ∈ postal_codes
3. de las zonas que cubren → elegir la de TARIFA MÁS BAJA (regla Uber)
4. esa zona define: local (location_id) + delivery_fee base + min_order + eta
5. (Capa 3) aplicar reglas dinámicas dentro del guardarraíl
6. si NINGUNA zona cubre → "aún no llegamos a tu zona" (honesto)
```

**Importante (UX, anti-abandono):** este motor solo corre **al pedir** (carrito/checkout),
NO al entrar. El cliente curiosea marcas/cartas/precios sin dar dirección. La dirección
se pide cuando va a pedir.

---

## 6. Qué se construye en este frente vs después

| Pieza | Cuándo |
|---|---|
| PostGIS activado | este frente (prerequisito) |
| `delivery_zone` + UI (radio + polígono Leaflet + CP) | este frente (Capa 1) |
| Motor de resolución dirección→local→coste (Mapbox) | este frente |
| Guardarraíl de margen (aviso con escandallo+comisión) | este frente (sin coste broker aún: usa coste estimado) |
| `delivery_pricing_rule` (modelo) | este frente (tabla creada, sin UI) |
| Reglas dinámicas (UI surge/descuento) | Capa 3, después |
| Integración broker (coste real) | Capa 2, después |
| 3 ventanas en checkout | Capa 4, después |

El hub público (frente siguiente) **consume** la Capa 1: el cliente mete dirección →
resolución → local + coste.

---

## 7. Decisiones tomadas (criterio: ser los mejores)

1. Solapamiento → gana la **tarifa más baja** (regla Uber).
2. Polígono → **dibujo Leaflet + import KML** (igualar a Uber, deuda 0).
3. Geocodificación → **Mapbox** (precio/calidad ES; mismo mapa para dibujar polígonos).
4. Geometría → **PostGIS** (resolución nativa en BD; activar extensión).
5. Lectura pública del catálogo → **RPC `security definer`** que sirve solo lo publicado
   (más seguro que abrir RLS a `anon`). + cerrar agujero `menu_category`/`menu_item_override`
   que hoy dejan `ALL` a `public`.
6. Surge por contexto; descuentos por cliente; **nunca subir por identidad** (ley).
7. Guardarraíl de margen real transversal = el diferenciador WOW.

---

## 8. Benchmark (fuentes, jun 2026)

- **Uber Eats Manager** — zonas radio+polígono+CP conviviendo; coste/mínimo/ETA por zona;
  solapamiento = tarifa más baja; polígono por dibujo o KML.
- **Locus** — ajuste de doble cara (sube fee zona caliente + bonus al rider) = cadena
  auto-reparable; transparencia + 3 tiers (lujo/valor/eco) como respuesta a la aversión
  a tarifas ocultas.
- **Cartwheel** (hostelería) — enruta entre flota propia y brokers (Uber Direct/DoorDash
  Drive) por coste y disponibilidad; −27% coste reparto, +20% ingreso delivery.
- **CloudKitchens** — factores de dynamic pricing: hora, día, demanda, clima, eventos,
  método de pedido.
- **Maryland HB0895** (abr 2026) — prohíbe usar datos personales del consumidor para
  subirle el precio. Multas 10.000–25.000 $. → surge por contexto, no por identidad.

**Hueco que Folvy llena y nadie cubre:** todos fijan precio sin saber el margen real.
Folvy lo sabe (escandallo). Surge y descuentos **garantizados rentables**.
