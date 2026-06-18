# Folvy — Publicador de Catálogo + Centro de Mando de Pedidos
### Documento de diseño para aprobación · v1 · 18/06/2026

> **Estado:** diseño previo a construcción. NADA construido aún. Se aprueba el modelo
> sobre papel antes de tocar BBDD/código (mismo método que el editor de escandallos y
> la economía de plataformas).
>
> **Ritual cerrado:** RECON ✓ (BBDD real, no CONTEXTO) + BENCHMARK ✓ (Otter, Deliverect,
> Last, HubRise API). Esto es el paso 3 (DISEÑO). Construir = paso 4, tras aprobación.
>
> **Disparador:** decisión de Julio (18/06) — el Cliente 2 NO tiene TPV propio; su único
> sistema es Folvy. Para que la integración "sirva de verdad" tiene que cerrar el ciclo
> completo de operación de delivery: publicar carta, gestionar disponibilidad, horarios,
> impresión y pedidos. **Norma innegociable: entero y bien, deuda 0, marca blanca total
> (el cliente piensa que la integración es Folvy; HubRise es invisible).**

---

## 0. Por qué esto importa

Hoy Folvy **recibe** pedidos de HubRise (ingesta viva y verificada el 18/06). Pero recibir
es media tubería: un cliente sin TPV necesita además **publicar su carta** a las plataformas,
**agotar un plato**, **fijar precios por canal**, **abrir/cerrar**, **imprimir** y **operar
los pedidos**. Sin eso, la integración no sirve.

Este documento diseña ese frente como un **módulo único** — el *Centro de Mando de Pedidos*
de cocina — y define en detalle su **primera pieza: el Publicador de Catálogo**, que es el
prerrequisito de la disponibilidad y de los precios por canal, y lo que permite al cliente
empezar a vender.

---

## 1. La forma del módulo: Centro de Mando de Pedidos

Visión de Julio: *"en cocina tienen que tener una pantalla para controlar todo lo
relacionado con los pedidos, desde el KDS, pasando por catálogos, horarios, impresiones,
pantalla de pedidos si no usas KDS."* El benchmark confirma que es la forma correcta
(Otter lo llama *Order Manager*; un shell con pestañas).

**Shell del módulo (pestañas), con su estado actual:**

| Pestaña | Qué hace | Estado hoy |
|---|---|---|
| **Pedidos** | Feed de pedidos en vivo (vista feed+detalle), aceptar/rechazar/listo, vista para quien NO usa KDS | Ingesta viva; falta la vista-feed y los botones de estado→plataforma |
| **KDS / Cocina** | Tablero por estación, bump, Cook Mode | ✅ EN PRODUCCIÓN (`/cocina-tv`) |
| **Catálogo** | Carta maestra → **publicar** por marca/canal, con **margen real visible**; crear menú nuevo | 🟡 modelo de datos completo; falta la maquinaria (ESTE DOC) |
| **Disponibilidad** | 86 por plato y por canal (3 estados), agotar/reactivar | 🟡 `is_available` existe; falta UX + push |
| **Horarios** | Horario por marca/canal; base de la alarma de silencio | 🔴 por construir |
| **Impresión** | Comanda de cocina + ticket; estado de impresora | 🔴 frente nuevo de cero (cloud printing) |
| **Integraciones** | Estado de conexión + estado de publicación por canal | 🟡 parcial (conector/account_connector) |

**Regla de arquitectura (la de siempre):** cada pestaña es un sistema completo y usable por
sí mismo, diseñado para enlazar con el resto sin reescribir. Se construye **Catálogo
primero**; el resto encaja encima.

---

## 2. Benchmark — qué hacen los mejores (y la lección dura de cada uno)

**Otter (referente del cockpit).** Dos superficies: *Order Manager* web (gestión/ajustes/
informes) + *Orders App* en tablet de cocina (feed en vista dividida, ETA, estado "Listo").
86-ing con **3 estados** (disponible / no disponible hoy con auto-restauración a medianoche /
indefinido) y toggle "ofrecido en" por canal. Pausa de tienda en todas las plataformas con un
clic. **Auto-aceptar + auto-imprimir.** → *Lección:* el 86 de 3 estados y la disponibilidad
por canal son el estándar a igualar; auto-aceptar+imprimir es lo que esperan.

**Deliverect (referente del constructor de carta multicanal).** Carta maestra central →
**publicar** a canales, con:
- **Historial de publicación / reportes de operación** con éxito/fallo **por canal**. Publicar
  es asíncrono y puede fallar en una plataforma sí y otra no. → *Lección dura: sin estado de
  publicación por canal, el cliente no sabe si su carta está viva en Glovo. Imprescindible.*
- **Validación previa** que caza errores antes de publicar (fotos que faltan, productos como
  modificadores, productos borrados, precios incoherentes, disponibilidades solapadas). →
  *Lección: validar antes de empujar evita rechazos silenciosos de la plataforma.*
- **Overrides por canal/local** ("fine-tune": nombre/precio/disponibilidad distintos por
  plataforma) y **precios por canal** (price levels). → *Lección: el override por canal es
  esperado; Folvy ya lo tiene en `menu_item_override`.*
- **Conflicto maestro↔sync:** cuando el POS pisa los overrides hechos en Deliverect = su mayor
  fuente de dolor documentada. → *Lección: Folvy lo resuelve de raíz con `catalog_source` por
  marca ('folvy'|'pos'): se decide explícitamente quién manda, sin deriva.*

**HubRise (el motor que envolvemos en marca blanca).** Su API de catálogo cubre **todo** lo
que necesitamos (ver §4): `PUT /catalogs` con categorías, productos, SKUs, listas de opciones
(=modificadores), deals (=combos), descuentos, IVA por tipo de servicio, alérgenos+nutrición,
imágenes, y precios por canal vía variants/price_overrides. Disponibilidad vía
`PUT/PATCH inventory` (stock=0). → *Folvy no reimplementa nada de esto: lo proyecta.*

---

## 3. Dónde Folvy GOLEA (no empata)

Regla del proyecto: ganar de calle en cada área o declarar deuda. Aquí Folvy gana por dos
razones que **ningún competidor tiene**:

**3.1 — Publicación consciente del margen.** Deliverect y Otter dejan fijar un precio por
canal **a ciegas de coste**: no saben lo que cuesta el plato, así que no pueden decir si ese
precio pierde dinero tras la comisión del 30 % de Glovo. Folvy tiene el **escandallo al
céntimo** (`recipe_item`) + la **economía de canal** (Capa A: `brand_channel_rate` +
`menu_item_economics`). El publicador muestra, **en el momento de fijar el precio en cada
canal**, el **margen real después de comisión**: *"a este PVP en Glovo ganas 12 % / pierdes
0,40 €."* Con guardarraíl: avisa si el margen cae bajo umbral o es negativo. **Es la única
carta del mercado que conoce su propio margen por plato × plataforma.** (Enlaza con la
"verdad de margen" que ya decidimos que es el territorio único de Folvy frente a Pleez.)

**3.2 — La carta maestra ES la verdad de Folvy, no una copia.** `menu_item.recipe_item_id`
ata cada producto a su escandallo (coste, alérgenos, foto). Publicar no es reescribir datos:
es **proyectar** el dato vivo de Folvy a la plataforma. Los competidores importan del POS y
**derivan** (su problema de sync); Folvy **es** la fuente. Y `modifier_recipe_impact` sabe
*qué ingrediente añade/quita cada modificador y cuánto cuesta* → margen real del modificador,
con confirmación humana. **Eso no lo tiene nadie** (tspoon/R365 tratan el modificador como
texto+precio).

---

## 4. RECON — el modelo de datos de Folvy ya está completo (mapeo 1:1 con HubRise)

Verificado contra `information_schema` (18/06). **No hay que rediseñar el modelo; solo
construir la maquinaria encima.** Correspondencia Folvy → HubRise:

| Folvy (verificado) | HubRise (API catálogo) | Notas |
|---|---|---|
| `menu_item` (name, description, category, price, vat_rate, photo_url, tags[], is_available) | `product` + `sku` (name, description, price, tax_rate, image_ids, tags) | núcleo del producto |
| `menu_item.recipe_item_id` | (no se sube) | **el coste/alérgenos** — uso interno para el margen y para `nutrition` |
| `menu_item.brand_id` | catálogo/conexión por marca | una carta por marca virtual (ver §6.2) |
| `menu_item.external_id` / `external_source` | `private_ref` del sku | mapeo estable para dedup e ingesta |
| `brand` (slug, logo, color, ownership_type) | account/location/connection | la marca virtual |
| `sales_channel` (slug, channel_type) | `variant` / connection | el canal (Glovo/Uber/JustEat/Shop) |
| `menu_item_override` (price, name, photo, is_available, **por channel_id Y location_id**) | `price_overrides` + `restrictions` (variants) | override por canal **y** local (mejor que ellos) |
| `modifier_group` (min/max, allow_repetition, group_type) | `option_list` (min_selections/max_selections/multiple_selection) | 1:1 |
| `modifier_option` (price_impact, is_default, **recipe_item_id**) | `option` (price, default) | + enlace a ingrediente |
| `modifier_recipe_impact` (impact_type, quantity, target_recipe_item_id, confidence) | (no se sube) | **margen real del modificador** — uso interno |
| `combo_slot` (min/max, combo_item_id) | `deal` (lines, pricing_effect) | combos |
| `recipe_item` alérgenos | `product.nutrition.allergens` | legal (EU 1169/2011); HubRise lo soporta |
| `menu_item.photo_url` | `image` (subir → referenciar `image_id`) | subir imagen antes del catálogo |

**Tablas de comisión presentes:** `brand_channel`, `brand_channel_rate`, `channel_rate` →
motor del margen real (Capa A del doc de economía de plataformas).

**RECON pendiente antes de construir** (honestidad — no verificado aún):
- (a) **Contenedor "menú"**: ¿existe una entidad `menu`/`menu_category` que agrupe ítems en una
  carta, o la carta = (marca × canal) sobre `menu_item`? `menu_item` tiene `menu_category_id`.
  → verificar antes de CP1 (define el botón "crear menú nuevo").
- (b) **Mapeo marca→conexión HubRise**: cómo se relacionan las 6 marcas virtuales del Cliente 2
  con conexiones/catálogos de HubRise (¿1 catálogo por marca? ¿1 conexión por marca×plataforma?).
  → pregunta a HubRise/Janaina (P-A) + verificar en el alta.
- (c) **`hubrise_integration`**: tabla gemela de `lastapp_integration` (token en Supabase
  Secrets, nombre en la tabla) — NO existe aún; se crea en CP2 (deuda ya anotada).

---

## 5. Marca blanca — cómo el cliente solo ve Folvy

Folvy es el cliente OAuth y **tiene el token**. Por tanto **todas** las operaciones de catálogo
(crear, editar, publicar, agotar, precio por canal) las hace **Folvy contra la API de HubRise
desde el servidor** (Edge Function), con el token guardado en Supabase Secrets. El cliente entra
en Folvy, edita su carta en Folvy, pulsa "Publicar" en Folvy. **No toca HubRise jamás.** El
único momento con marca HubRise es la conexión OAuth inicial, que la hace **Folvy/Julio en el
onboarding** (como el 18/06), no el cliente. Para ocultarlo del todo incluso ahí está el
programa reseller de HubRise (Janaina, en marcha).

---

## 6. Arquitectura del Publicador

### 6.1 — Proyección (Folvy → JSON HubRise)
Una función pura `buildHubriseCatalog(brandId, channelId?)` que toma el modelo Folvy y produce
el `data` del catálogo HubRise: categorías ← `menu_category`/`category`; products+skus ←
`menu_item` (aplicando `menu_item_override` del canal si existe); option_lists ←
`modifier_group`+`modifier_option`; deals ← `combo_slot`; nutrition.allergens ← alérgenos del
`recipe_item`. **Idempotencia:** `private_ref` de cada sku = `menu_item.id` (estable) → en
actualizaciones HubRise deduplica y no duplica.

### 6.2 — Catálogo por marca (decisión de diseño)
Para marcas virtuales, **un catálogo HubRise por marca Folvy** (más limpio que un catálogo con
variantes para todo). El publicador empuja la carta de la marca X al catálogo que usa la conexión
de la marca X. *(Confirmar el modelo exacto de conexiones con HubRise — P-A.)*

### 6.3 — Imágenes primero
Secuencia obligada por HubRise: (1) subir imágenes nuevas `POST /catalogs/:id/images` con
`private_ref` = id de foto Folvy (dedup), guardar los `image_id`; (2) `PUT /catalogs/:id` con
la carta referenciando esos `image_id`. En actualizaciones, solo subir imágenes nuevas (comparar
por `private_ref`/`md5`), no reenviar las que ya están.

### 6.4 — Publicar es asíncrono y por canal → estado y historial (lección de Deliverect)
**Tablas nuevas:**
```
catalog_publish            -- un "trabajo" de publicación
  id, account_id, brand_id, requested_by, requested_at, status ('pending'|'done'|'partial'|'failed')
catalog_publish_target     -- resultado POR canal/conexión
  id, publish_id → catalog_publish, channel_id, hubrise_catalog_id,
  status ('ok'|'error'), error_text, published_at
```
La UI muestra "Publicado en Glovo ✓ · Uber ✓ · JustEat ✗ (error: falta foto en 2 platos)",
con historial. Nunca un "publicado" ciego.

### 6.5 — Validación previa (lección de Deliverect)
Antes de empujar, `validateCatalog(brandId)` devuelve bloqueos y avisos:
- **Bloqueo:** producto sin precio, sin categoría, sku sin nombre, modificador sin opciones.
- **Aviso:** foto que falta, **alérgenos sin declarar** (legal), precio con margen negativo en
  algún canal (enlaza con §3.1), disponibilidades solapadas.
El cliente ve la lista y corrige antes de publicar. Cero rechazos silenciosos de la plataforma.

### 6.6 — El margen real al fijar precio (el golazo, §3.1)
En el editor de precio (base y por canal vía `menu_item_override`), al teclear un PVP se llama a
`menu_item_economics` (Capa A) y se muestra el **margen neto tras comisión** de ese canal, con
semáforo y guardarraíl. Es lo que convierte el publicador en algo que **ningún competidor tiene**.

### 6.7 — Dirección (`catalog_source`)
Por marca: `'folvy'` (Folvy manda, publica a HubRise) o `'pos'` (el TPV manda, Folvy espeja).
Cliente 2 = `'folvy'` siempre (no tiene TPV). Llorente29 = mixto (propias `'folvy'`, cedidas
Cloudtown `'pos'`/Last). El publicador solo actúa sobre marcas `catalog_source='folvy'`.

### 6.8 — Crear menú nuevo (apuntado por Julio, no perder)
Acción primaria que hoy falta: botón **"Crear menú/carta nueva"** para una marca → crea el
contenedor (según RECON-a), permite añadir categorías e ítems (o sembrar desde el master de
ingredientes/escandallos), y deja la carta lista para publicar. Es la acción de entrada del
módulo en Otter/Deliverect; en Folvy también debe serlo.

---

## 7. Plan de construcción por fases (cero deuda entre fases)

- **CP0 — Cerrar RECON pendiente** (§4 a/b/c): contenedor de menú, mapeo marca→conexión HubRise,
  confirmar con HubRise el modelo de catálogos para marcas virtuales. Sin esto no se diseña fino
  CP1/CP2.
- **CP1 — Catálogo maestro en la app** (editor + crear menú + margen real visible). Sin HubRise
  todavía: el cliente construye y ve su carta y su margen por canal dentro de Folvy. **Medible:**
  crear una carta de marca con N platos, precios por canal, y ver margen neto por canal al céntimo.
- **CP2 — Publicador → HubRise** (`hubrise_integration` + proyección + imágenes + `PUT /catalogs`
  + estado/historial por canal + validación previa). **Medible:** publicar la carta de la marca de
  prueba y verla viva en el catálogo HubRise (y, con Cliente 2 real, en Uber/JustEat).
- **CP3 — Disponibilidad / 86 por canal** (3 estados, push vía `PATCH inventory`). **Medible:**
  agotar un plato en Folvy → desaparece en la plataforma; reactivar → vuelve.
- **CP4 — Resto del cockpit**: vista de pedidos (feed para quien no usa KDS) + aceptar/rechazar/
  listo (`PATCH order status`), horarios, impresión (frente cloud-printing aparte). Cada uno, su
  ritual.

Cada fase: diseño aprobado → BBDD (transaccional, revisable) → service → UI → build verde →
verificación en la app. `database.ts` regenerado tras cada cambio de esquema.

---

## 8. Riesgos y honestidad declarada

- **Impresión es un frente nuevo de cero.** HubRise no imprime (lo hace una app de impresora del
  marketplace). Para marca blanca + cloud, el camino es impresora de red por protocolo cloud
  (tipo Star CloudPRNT / Epson, la impresora pide trabajos a una URL de Folvy). Requiere su propio
  RECON + benchmark. No se diseña aquí; va en CP4 como pieza independiente.
- **Pausa instantánea de tienda** ("cierro 1h ahora") es más de lado-plataforma; HubRise no la
  expone limpia (igual que Last). Horario **declarado** sí (restrictions/horarios). La verdad
  operativa la lleva el módulo Horarios. A verificar a fondo en CP4.
- **Modelo de catálogos para marcas virtuales en HubRise** sin confirmar (P-A) — bloquea el diseño
  fino de CP2.
- **El margen real depende de que la Capa A tenga datos** (`brand_channel_rate` sembrado por
  cliente). Si está vacío, el publicador muestra "comisión no configurada" en vez de un número
  falso (honestidad: nunca un margen inventado).
- **`menu_item_economics` es SECURITY DEFINER** → probar desde la app, no desde el SQL Editor.

---

## 9. Preguntas abiertas para Julio (cerrar antes de CP1/CP2)

- **P-A (HubRise):** ¿cómo mapean las 6 marcas virtuales del Cliente 2 a conexiones/catálogos de
  HubRise? (1 catálogo por marca, 1 conexión por marca×plataforma…) → correo a Janaina.
- **P-B:** el botón "crear menú nuevo" — ¿el contenedor es una entidad `menu` propia, o la carta =
  (marca × canal) sobre `menu_item`+`menu_category`? (RECON-a lo responde.)
- **P-C:** ¿sembrar la carta de una marca **desde el master de escandallos** (todos los platos con
  coste) o construirla a mano plato a plato? (Define el flujo de "crear menú".)
- **P-D:** ¿CP1 (catálogo en la app + margen visible) como primer cierre, y CP2 (publicar a HubRise)
  como el siguiente? ¿O CP1+CP2 juntos como un solo frente "publicar"?

---

*Documento vivo. Al aprobar, se versiona en `docs/folvy_catalogo_publicador_diseno.md` y se
referencia en `CONTEXTO_CLAUDE.md` y en el guion vivo. Construcción: CP0 (cerrar RECON) → CP1.*
