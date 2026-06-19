# Folvy Orders — Pantalla unificada de Servicio (Pedidos + Cocina) · diseño en papel

**Estado:** spec consolidado para aprobar antes de construir. Recoge TODO lo decidido en la
sesión de diseño del 19/06. No toca código todavía.
**Sustituye/absorbe:** `folvy_pedidos_pestana_diseno.md` (fase 2, ciclo de vida) — sus decisiones
siguen válidas y se integran aquí, ampliadas con cocina, volumen, cierre, impresión y producción.
**Apoyado en producción:** auto-aceptación por canal (commit `8868703`) y fusión del módulo
Orders+KDS (commit `ba89312`), ambos vivos. El Edge `hubrise-order-status` (empuje) y el webhook
de entrada funcionan.

---

## 0. Principio rector — AGNÓSTICA DE CANAL (no negociable)

**La pantalla opera sobre el pedido CANÓNICO de Folvy, no sobre HubRise.** Todo lo específico de
canal vive en dos sitios aislados, nunca en la pantalla:

1. **Adaptador de entrada** — normaliza el pedido de cada canal (HubRise, Otter, Last, Glovo
   directo, Catcher, Folvy Shop) al modelo canónico (`sale` + líneas). HubRise es el **primer**
   adaptador cableado, no el dueño del modelo.
2. **Capa de empuje + tabla de capacidades** — las acciones de vuelta (aceptar/rechazar/listo) y
   las reglas duras por plataforma. La pantalla dice "acepta este pedido"; la capa decide a qué
   adaptador llamar según el canal de origen.

> La pantalla sirve igual a HubRise, Otter, Last, Glovo directo, Catcher y Folvy Shop el día que
> cada uno se enchufe, **sin reescribir una línea de la pantalla**. Cada pedido lleva su `canal` y
> su `origen` (qué adaptador lo trajo): la pantalla los **muestra** (chip de color); la capa de
> acciones los usa para **enrutar** la respuesta. Una sola lógica de pantalla para todos los canales.

---

## 1. La tesis: una pantalla, varias lentes, que se adapta a la cocina

El pedido es uno. La pantalla es una. Lo que cambia es **quién mira y qué necesita**, y **cómo es
la cocina del local** (0, 1 o N estaciones). La misma pantalla pasa de "tarjeta limpia todo-junto"
a "pase con zonas" a "estación" a "producción", según contexto — no son pantallas distintas, son
**lentes** del mismo tablero sobre el mismo pedido canónico.

**Las lentes (un selector, como el de cuadrícula/lista):**

| Lente | Para quién | Qué muestra |
|---|---|---|
| **Por pedido** | Pase / cocina pequeña / encargado | El pedido entero: comanda + estado + acciones |
| **Por estación** | Cocinero de una partida | Solo SUS líneas, de todos los pedidos |
| **Producción (lote)** | Plancha / prep en hora punta | Artículos/componentes agregados (ver §7) |

Y dentro de "Por pedido", **dos formas de ver el conjunto** (toggle, el local elige según el momento):
- **Cuadrícula** — tablero de pase clásico, todo a la vista.
- **Por estado (kanban)** — columnas Por aceptar · En preparación · Listos. **Escala mejor con volumen.**

**La forma de la cocina la define el local** (estaciones que ya existen en el KDS):
- **Cocina pequeña (todo junto):** 0-1 estaciones. Tarjeta = comanda completa, una persona recibe,
  monta, cierra. Sin ruido de zonas.
- **Cocina grande (por zonas):** N estaciones. El pedido se reparte; cada zona ve y marca su parte;
  una estación de **pase/embalaje** (la última) lo cierra cuando todas terminan.

**La lente la define el dispositivo/rol** (ya existe: dispositivos KDS con estaciones y token). La
tablet de plancha abre "por estación"; la pantalla del encargado abre "por pedido". En el local
pequeño, una sola lente lo enseña todo.

---

## 2. Identidad visual (decidida)

- **Mundo del pase, oscuro** — porque se lee a un metro, horas, entre vapor y manos ocupadas. El
  oscuro da máximo contraste a distancia, no deslumbra bajo luz de cocina, y hace que los colores de
  alarma (rojo/ámbar) **salten**.
- **NO negro puro.** Navy profundo cálido (`#0e1820`) = identidad Folvy, no "otro KDS negro genérico".
  Mantiene todas las ventajas técnicas del oscuro con marca propia.
- Terracota Folvy (`#D67442`) para acción/marca. Texto off-white cálido (`#f2efe9`), no blanco puro
  (descansa la vista en uso prolongado). Display **Fraunces** para lo que importa (código, total,
  tiempo, cantidades de producción).
- **El resto de la app sigue clara** (se usa en oficina/tablet sin prisa). El oscuro es solo de esta
  pantalla, por su función.

---

## 3. La tarjeta del pedido (lente "por pedido")

**A1 — La comanda completa SIEMPRE en la tarjeta.** En cocina no se navega. Toda la comanda
(productos, modificadores, alérgenos) se ve de un vistazo. El detalle (drawer) queda solo para info
secundaria: cliente, dirección, totales, datos de envío.

**B2 — El que necesita acción, físicamente más grande + halo.** Jerarquía:
- Normal → callado.
- Necesita mano (sin autoaceptar / hay que actuar) → **más grande + halo terracota**.
- Muriéndose (tiempo crítico, rojo) → **parpadeo**, reservado a lo que de verdad va a morir.
- El foco va al pedido que **NO se autoaceptó** (el que necesita mano), no al que sí.

**Modificadores y notas = PROTAGONISTAS** (donde más se equivoca la cocina):
- **Rojo** = quitar / alergia ("SIN gluten", "soy celíaco"). El más fuerte.
- **Ámbar** = añadir / preferencia ("+ Extra bacon").
- Tamaño casi igual al del producto — nunca un susurro gris.
- **Nota del cliente** = banda roja completa, ⚠, nunca truncada. **Al tocarla se despliega entera**
  (en vistas densas se muestra recortada + expandible).

**Alérgenos desde el escandallo** — Folvy los cruza con la receta de cada línea. Las plataformas no
los muestran en comanda = diferenciador. Depende de que la línea esté casada con su plato (ya lo hace
la ingesta canónica).

**Tiempo prominente** — lomo de color por urgencia (verde <5′, ámbar 5-10′, rojo >10′ parpadea).
Nuevos sin aceptar arriba; el más antiguo primero. Umbrales **configurables por canal** (deuda
declarada del KDS: hoy provisionales 5/10).

**Canal** — chip de color por plataforma (Glovo amarillo, Uber gris oscuro, Just Eat naranja, Shop
terracota). Sin logos (copyright): solo color + nombre. `channelBadge` con color a crear (el chip
violeta del KDS no distingue).

**Marcado de líneas — en TODAS las lentes.** Tocar una línea la marca como hecha (se tacha, sube el
contador "2/3 hecho"). Es la base del control.

---

## 4. Auto-aceptación (vivo) + acciones del ciclo

- **Auto-aceptación por canal/marca** (ya en producción): el pedido entra ya aceptado, sin clic
  contra el reloj. Uber, Glovo, Just Eat, Shop se aceptan solos de fábrica. La pantalla **destaca el
  que NO se autoaceptó** (canal manual / regla que lo impidió).
- **Acciones** (la matriz §6 del doc de fase 2 sigue válida): Aceptar (ASAP de un toque) / Rechazar
  (con motivo) en nuevos; En preparación / Listo / Ajustar hora después. Cada acción llama a la
  **capa de empuje** (§0), que enruta al adaptador del canal. Reglas duras por plataforma (Glovo no
  cancela tras aceptar, Uber 10 min, Just Eat confirma) en la **tabla de capacidades**, no en la
  pantalla. Mientras la llamada está en vuelo: "enviando…"; si el canal da error, toast claro y el
  estado **no** se mueve (no mentir al usuario).

---

## 5. El cruce cocina↔pedido (la fusión, lente "por pedido" en cocina grande)

La tarjeta del pase muestra, además de la comanda, **en qué zona va el pedido**:
`Cocina: 🟢 Plancha ✓ · ⏳ Freidora · ○ Pase`. Cada línea lleva su **chip de zona** (a qué partida
va). El **"Marcar listo" final solo se enciende cuando TODAS las zonas terminan**. Es la pieza que
une las dos caras sin mezclarlas: el del pase ve el avance de cocina sin cambiar de pantalla; el
cocinero ve de qué pedido viene su línea.

- En cocina **pequeña**: la línea de zonas no aparece (no hay zonas). Tarjeta limpia.
- **Cocina + embalaje separados** (preferencia Julio): se modela como la **estación de pase final**,
  configurable por local. En el pequeño puede ser la misma persona; en el grande, una posición propia.
  Encaja sin inventar nada (el KDS ya tiene el concepto de "expo"/pase).

---

## 6. Cierre anti-faltantes + impresión

### 6.1 El flujo de cierre (objetivo: cero faltantes)
1. El cocinero marca líneas como hechas (barra de progreso).
2. Al completar la última, la pantalla **propone cerrar la comanda**.
3. **No se puede cerrar a medias:** si falta una línea, la pantalla lo dice exacto ("Falta: 1× Brownie")
   y bloquea. El pedido no se cierra incompleto.
4. **El cierre es el que dispara la impresión** (no la última línea automáticamente): hay un punto de
   confirmación humano justo antes del papel, y el ticket sale cuando de verdad se va a embolsar.
5. Quién cierra: **la última estación** (pase/embalaje en cocina grande; el cocinero en la pequeña).

### 6.2 Sistema de impresión — cuatro documentos, programable
Pantalla y papel **conviven** (hay quien usa solo pantalla, solo papel, o ambos). Cada documento es
programable, con su momento e impresora:

| Documento | Para qué | Cuándo | Impresora | Programable |
|---|---|---|---|---|
| **Ticket de cocina** (comanda) | Preparar en papel aunque haya pantalla / respaldo | Al aceptar / entrar | Cocina | **Sí/No por local** |
| **Pegatina por artículo** | Identificar cada envoltorio (estilo BK), no mezclar pedidos | Al empezar a montar (en cocina) | Etiquetadora | Sí/No por local + flag por artículo |
| **Ticket de bolsa** | Checklist de embalaje (anti-faltantes) | Al cerrar | Embalaje | Sí/No por local |
| **Reimpresión bajo demanda** | Sacar de nuevo cualquiera | Cuando se pida | La que toque | Icono en cada tarjeta |

- **Pegatinas salen al MONTAR (al principio, en cocina)**, no al cerrar: cada producto nace etiquetado
  y viaja identificado cocina→pase→embalaje. Evita que se **mezclen** pedidos.
- **Ticket de bolsa sale al CERRAR (al final)**: checklist de lo que va dentro, con modificadores.
  Evita que **falte** algo.
- **Una pegatina por UNIDAD** (2× Coca-Cola → 2 pegatinas). Lleva: producto, nº pedido, cliente, marca,
  modificador (rojo/ámbar).
- **Flag de pegatina por artículo (sí/no, opción A):** se decide en frío, en la ficha del artículo.
  **Default = SÍ automático a todo** (más fácil corregir 10 a "no" —latas, aguas— que marcar 200 a "sí").
  Anti-descontrol: el sistema sabe cuántas pegatinas tocan (suma de unidades con flag) → ni de más ni
  de menos.
- **Reimpresión:** icono de impresora en cada tarjeta → elegir qué reimprimir (comanda / bolsa /
  pegatinas). Salva impresora atascada, ticket mojado, repartidor que perdió el suyo.
- **Configuración:** pestaña "Impresión" en Ajustes de Orders, por local (qué documentos ON, a qué
  impresora va cada uno). Decisión en frío; la operación solo ejecuta.

### 6.3 Honestidad deuda-0 (impresora física)
La impresora térmica es un **adaptador de salida** (cloud printing: PrintNode/Star/Epson) = su propio
sub-tramo. La **capa lógica** (qué documento, cuándo, a qué impresora, anti-faltantes, reimpresión) se
diseña y funciona desde el día uno: el documento se **genera siempre**; mientras no haya impresora
física conectada, se ve/descarga en pantalla (PDF). El adaptador se enchufa como salida **sin
reescribir nada**. No hay media tubería.

---

## 7. Producción en vivo (lente "lote") — DIFERENCIADOR A PROBAR EN CAMPO

### 7.1 Qué resuelve
6 comandas × 4 hamburguesas = 24 iguales. Montar pedido a pedido es ineficiente (la plancha arranca
y para 6 veces). La vista de producción **agrega por artículo a través de todos los pedidos activos**:
la plancha ve "24 discos, hazlos ya" y produce en lote.

### 7.2 Dos niveles (se construyen LOS DOS — decidido)
- **Por producto** (simple): "Hamburguesa Doble ×18" — agrupa pedidos que piden lo mismo. Para montar
  en cadena.
- **Por componente** (MRP): Folvy explota cada plato en su **escandallo** y suma → "Discos ×38 · Panes
  ×32 · Bacon ×36". **Explosión de necesidades en vivo** — ningún competidor de hostelería lo tiene
  (ninguno conoce el escandallo como Folvy). Para la mise en place.

### 7.3 Matices que la hacen deuda-0 (no agregación de juguete)
- **Producir ≠ montar.** La vista de producción hace el **componente** en lote; el **montaje y cierre
  sigue siendo por pedido** (cada bolsa se arma individual contra su ticket/pegatinas). Marcar un lote
  hecho **no cierra pedidos**.
- **Solo se agrega lo idéntico.** Las variantes con modificador que cambia la cocina van **aparte**
  ("Doble ×16" + "Doble ×2 SIN cebolla"). No se mezcla lo que no es igual de verdad.

### 7.4 El modelo que aguanta pedidos entrando en vivo (CONTINUA — decidido)
No se cuenta contra un número global (eso miente al entrar el 7º pedido). Se separan tres cantidades:
- **Necesario** = lo que piden los pedidos activos (sube al entrar un pedido).
- **Hecho** = lo producido (sube solo cuando el cocinero marca).
- **Pendiente** = Necesario − Hecho (lo único que el cocinero mira).

La tarjeta dice **"Pendiente: 12 · (26 de 38 hechos)"**, no "38". Si entra un pedido con 4 más:
Necesario→42, Hecho sigue 26, Pendiente 12→16. **Nunca se pierde lo hecho.** Y **producido ≠ asignado**:
si hiciste 26 y se pedían 24, hay 2 de stock caliente; entra pedido de 4 → Pendiente 2 (no 4). Evita
producir de más. Enlaza con **inventario perpetuo / AvT** (lo producido no montado es stock o merma,
que Folvy ya mide).

**Marcar lo hecho:** A+B para empezar — **A** "+ Hecho N" por tandas (como trabaja la plancha, por
hornadas); **B** "Hecho todo lo pendiente" (ponerse al día de golpe). **C** automático desde el montaje
(descuenta solo al montar un pedido) = capa que se enchufa encima cuando el montaje por pedido esté
vivo, sin reescribir (el modelo Necesario/Hecho/Pendiente ya lo soporta — otra fuente de "hecho", como
`origin` en el MRP).

### 7.5 Por qué es "a probar en campo" y no pieza central del día uno
Su criterio de éxito **no es técnico, es de campo**: "la teoría me gusta, la realidad suele ser distinta"
(Julio). Solo sabremos si ayuda o estorba **viéndola usar en el pase, en hora punta**, con Pamela y un
cocinero. Por eso:
- Se construye como **lente, encendida en modo prueba en UN local** (el de cocina grande de Llorente29),
  **apagable**.
- **El veredicto lo da el pase, no nosotros.** Si ayuda, se queda y se afina. Si estorba, se apaga y
  sabemos POR QUÉ (ruido, distrae, no la miran) → cómo arreglarla.
- Llorente29 es el laboratorio: lo que estorbe al que la pidió, estorbará más a un cliente cualquiera.

No es posponer: el cimiento (Necesario/Hecho/Pendiente sobre escandallo) se construye; la validación
es de campo.

**[PENDIENTE de Julio]** Lente vs pantalla separada: recomendación = **lente** (mismo dato, otro ángulo;
separada obliga a sincronizar dos sitios). Julio: "no lo sé" → confirmar al construir.

---

## 8. Volumen (hora punta)

- **Toggle cuadrícula / kanban** (el local elige; recomendado dejar elegir, no imponer).
- **Densidad adaptativa:** a más pedidos, tarjetas más compactas (menos aire) — **pero nunca se tocan
  modificadores/notas/alérgenos**, que siguen grandes. Se encoge el chrome, no lo crítico.
- **Orden:** los que necesitan acción arriba-izquierda; los tranquilos abajo. Con buen orden, 20
  pedidos no pesan igual.
- **Kanban escala mejor** con volumen (ves el cuello de un vistazo: "2 por aceptar, 13 cocinando").

---

## 9. Plan por capas (cada pieza con su sitio — NADA pospuesto "para nunca")

### Capa A — Lo que la cocina necesita sí o sí (primera construcción)
Es lo que de verdad evita errores y la cocina usa desde el minuto uno:
- Lente **por pedido** (cuadrícula + kanban) y **por estación**, sobre el pedido canónico.
- Comanda completa (A1), B2, modificadores/notas protagonistas, alérgenos del escandallo, tiempo,
  canal con color, nota desplegable.
- **Marcado de líneas** en todas las lentes.
- **Cruce cocina↔pedido** (zonas en la tarjeta) — adaptado al nº de estaciones del local.
- **Cierre anti-faltantes** (guard + propone cerrar).
- **Sistema de impresión (capa lógica):** los 4 documentos se generan, programables por local + flag
  de pegatina por artículo; reimpresión por tarjeta. Salida en PDF/pantalla hasta enchufar impresora.
- Agnóstico de canal (§0): adaptador de entrada + capa de empuje + tabla de capacidades.

### Capa B — Diferenciador a probar en campo
- **Producción en vivo** (continua, Necesario/Hecho/Pendiente, por producto + por componente). Modo
  prueba en el local de cocina grande, apagable. Validación de campo manda. Marcado A+B; C cuando el
  montaje por pedido esté vivo.

### Capa C — Honestidad técnica (adaptadores de salida/entrada, su propio tramo)
- **Adaptador de impresora física** (cloud printing) — se enchufa como salida sin tocar la capa lógica.
- **Adaptadores de canal nuevos** (Otter, Glovo directo, Folvy Shop, Catcher) — se enchufan a la
  frontera sin tocar la pantalla.

> Disparadores explícitos: Capa A se construye ya. Capa B se enciende en prueba tras Capa A, en un
> local. Capa C: cada adaptador cuando su integración toque (impresora cuando haya hardware; canales
> según roadmap de delivery). Ninguna pieza queda sin sitio.

---

## 10. RECON ya hecho (base para construir Capa A)

Del repo+BBDD (19/06):
- **Data:** `kds_board` NO sirve para el feed (no trae `order_status`, filtra por "expo done" =
  criterio de cocina). → **RPC nueva `orders_feed`** por estado de plataforma + cliente/entrega/total
  + líneas con desglose. Para producción: RPC que explote escandallo de los pedidos activos.
- **Render de líneas:** `KdsLineRow`/`NoteChip` no exportados → extraer a componente compartido.
- **Reuso:** semáforo (`timeLevel`+`minutos`), polling 10s, sonido/resalte de nuevos, gating manager.
- **`channelBadge` con color por canal:** a crear (el chip violeta del KDS no distingue).
- **Servicio front que invoque la capa de empuje** (aceptar/rechazar): no existe, a crear.
- **Raíz `/orders`** monta hoy `KdsBoardPage` (placeholder); el feed reemplaza esa raíz (1 línea).
- **Realtime:** `sale` no está en la publicación `supabase_realtime` → polling (como el KDS). Añadir
  `sale` a la publicación = mejora futura, no en este tramo.

---

## 11. Decisiones cerradas hoy (registro)

✅ Pantalla unificada, una sola, con lentes (por pedido / estación / producción) · ✅ se adapta al nº
de estaciones del local · ✅ identidad navy cálido (no negro puro), terracota, Fraunces · ✅ A1 comanda
completa en tarjeta · ✅ B2 el que necesita acción más grande + halo · ✅ modificadores/notas
protagonistas (rojo=quitar/alergia, ámbar=añadir), nota desplegable · ✅ alérgenos del escandallo ·
✅ Uber/todos auto, destacar el NO autoaceptado · ✅ volumen cuadrícula + kanban con toggle, densidad
adaptativa · ✅ marcado de líneas en todas las lentes · ✅ cierre anti-faltantes (guard + cerrar
imprime) · ✅ 4 documentos de impresión programables por local · ✅ pegatina al montar / ticket bolsa
al cerrar · ✅ pegatina flag por artículo (A, default sí automático), una por unidad · ✅ ticket de
cocina programable (papel aunque haya pantalla) · ✅ icono reimprimir en cada tarjeta · ✅ producción
los dos niveles (producto + componente) · ✅ producción continua en vivo (Necesario/Hecho/Pendiente),
modo prueba en campo · ✅ cocina+embalaje = estación de pase final configurable · ✅ agnóstico de canal
(frontera única + canónico, HubRise primer adaptador).

**[PENDIENTE de Julio]:** producción lente vs separada (rec: lente) · volumen imponer vista vs toggle
(rec: toggle).

---

## 12. Siguiente paso (cuando se apruebe este documento)

Diseño en papel del **modelo de datos completo** (Capa A) sobre lo que el KDS ya tiene: estados de
línea, zonas/ruteo, cierre, los documentos de impresión y sus disparadores, el flag de pegatina por
artículo, y la RPC `orders_feed` (+ la de explosión para producción, Capa B). De ahí, construcción
clavada a las maquetas, por tramos reversibles con build verde.

*Documento vivo. Al aprobar, se versiona en `docs/folvy_orders_pantalla_unificada_diseno.md` y manda
sobre las maquetas (que son su representación visual).*
