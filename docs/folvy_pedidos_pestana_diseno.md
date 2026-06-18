# Folvy — Pestaña "Pedidos" (Centro de Mando, fase 2) · diseño en papel

**Estado:** propuesta para aprobar antes de construir. No toca código todavía.
**Depende de:** fase 1 (ciclo de vida) — YA en producción y validada en vivo (#RP65P received→accepted,
commit `5f78aa7`). El Edge `hubrise-order-status` (empuje) y el espejo de entrada (webhook) funcionan.
**NO depende de P-A** (Janaina): esta pestaña opera pedido a pedido, lo cual ya está desbloqueado.

---

## 1. El problema que resuelve (por qué esto es lo siguiente)

Hoy los pedidos de delivery entran en Folvy (webhook) y se ven en el KDS de cocina, pero **nadie los
acepta/rechaza desde Folvy**. Eso tiene una consecuencia dura, no cosmética:

- **Uber auto-cancela** un pedido que no se acepta en **< 10 min**. Sin pantalla de operación, un
  pedido real de Uber gestionado solo desde Folvy se perdería.
- **JustEat** exige como mínimo marcar **Confirmado** (= `accepted`).
- **Glovo** no permite cancelar un pedido ya creado → el rechazo solo es válido **antes** de aceptar.

La pestaña "Pedidos" es la consola donde el encargado **ve el pedido entrante y actúa** (aceptar,
rechazar, marcar listo, ajustar la hora), y ese acto **viaja a la plataforma** vía el Edge de la fase 1.
Es la mitad operativa del tubo que ya construimos.

---

## 2. Dónde vive

- **Pestaña "Pedidos"** dentro del módulo de delivery/operación (a confirmar en RECON: módulo propio
  vs sección del Shell en raíz, patrón KDS `/cocina-tv`).
- **Distinta del KDS:** el KDS es el tablero de **cocina** (por estación, bump de preparación). "Pedidos"
  es el tablero **de operación/recepción del pedido** (aceptar/rechazar/tiempos/estado de plataforma).
  Comparten la misma venta, distinta lente. (Last los tiene separados: Order Manager ≠ KDS.)
- **Tiempo real:** la app ya mantiene una suscripción realtime a cambios (visto en consola:
  `SUBSCRIBED`). El feed se suscribe a `sale` (insert/update) de la cuenta con `order_status` no nulo →
  los pedidos entran y cambian de estado **solos**, sin recargar.

---

## 3. El FEED (lista de pedidos)

Dos vistas conmutables (como Last), misma fuente:

### 3.1 Vista CUADRÍCULA (operación rápida en servicio)
Tarjetas grandes, pensadas para tablet en el pase. Cada tarjeta:
- **Código** del pedido (corto, legible) + **plataforma** (chip de color: Glovo verde, Uber negro,
  JustEat naranja, Shop azul marino — reusar `channelBadge` existente).
- **Marca** (cuando la haya; hoy puede venir null hasta P-A → mostrar el canal).
- **Hora de entrada** + **semáforo de tiempo** (verde→ámbar→rojo según minutos desde que entró vs
  objetivo). En Uber, **cuenta atrás de los 10 min** bien visible si está sin aceptar.
- **Estado** (punto de color + etiqueta: Nuevo / Aceptado / En preparación / Listo / En reparto /
  Completado / Rechazado / Cancelado).
- **Importe** total.
- **Botón(es) de acción primaria** según estado (ver §6) — p. ej. en "Nuevo": **Aceptar** / **Rechazar**.

### 3.2 Vista LISTA (visión de control / repaso)
Tabla densa, una fila por pedido (como la lista de Last). Columnas:
`Código · Plataforma · Marca · Estado · Tiempo (semáforo) · Hora pedido · Hora entrega/recogida ·
Importe · Servicio (delivery/collection)`. Clic en fila → detalle (§5).

### 3.3 Filtro por estado (cabecera)
Pestañas/segmented: **Activos** (new+received+accepted+in_preparation+awaiting_collection+in_delivery) ·
**Nuevos** (sin aceptar) · **En curso** · **Cerrados** (completed) · **Incidencias**
(rejected/cancelled/delivery_failed) · **Todos**. Por defecto: **Activos**.
Filtros secundarios: por plataforma, por marca, por local (multi-local: el local sale del contexto de
sesión/dispositivo, no selector manual — regla de contención ya acordada).

### 3.4 Contador de cabecera
"X nuevos · Y en curso · Z incidencias" — lectura de un vistazo del estado del servicio.

---

## 4. Identidad y orden del feed

- **Orden por defecto:** los **nuevos sin aceptar arriba**, y dentro, el más antiguo primero (el que
  más corre peligro de auto-cancelarse). El semáforo refuerza la urgencia.
- **Sonido configurable** al entrar un pedido nuevo (idea Julio del KDS, aplica aquí). Declarado.
- **Marca estable:** se muestra `brand_id`→nombre; si null (pre-P-A), se muestra el canal. Nunca se
  deduce del producto.

---

## 5. El DETALLE del pedido

Panel/drawer al pinchar un pedido. Tres bloques (como Last):

1. **Líneas del pedido:** productos, cantidades, **modificadores** y **componentes de combo**
   (idea Julio del KDS: el ticket debe mostrar componentes + modificadores + **alérgenos**). Reusar el
   render de líneas del KDS si encaja (RECON). **Los alérgenos los pone Folvy** cruzando cada línea con
   su escandallo (las plataformas no los muestran en comanda = diferenciador); depende de que la línea
   esté casada con su plato (lo que ya hace la ingesta canónica). El **contenido completo del pedido**
   vive aquí, no en la tarjeta del feed (que es compacta a propósito).
2. **Información del pedido:** estado actual, hora de entrada, **hora prometida** (`confirmed_time` /
   `expected_time`), servicio (delivery/collection), método de pago, totales (subtotal, descuentos,
   envío, total), notas del cliente / notas del vendedor.
3. **Información del cliente:** nombre, teléfono, dirección de entrega (si delivery).

Acciones en el detalle = las mismas de §6, con más espacio (incluido "Ajustar hora").

---

## 6. ACCIONES del ciclo de vida (el corazón)

Cada acción **llama al Edge `hubrise-order-status`** (fase 1) con `{sale_id, status[, confirmed_time]}`.
El feed refleja el cambio cuando el Edge espeja `order_status` (realtime). Mientras la llamada está en
vuelo: botón en estado "enviando…"; si el Edge devuelve error (p. ej. HubRise 409/404), **toast claro**
y el estado **no** cambia (no mentimos al usuario).

### 6.1 Matriz estado × acción (qué botones aparecen)

| Estado actual | Botones que se muestran | Estado destino |
|---|---|---|
| **new / received** (sin aceptar) | **Aceptar** · **Rechazar** | accepted / rejected |
| **accepted** | **En preparación** · **Listo** · **Ajustar hora** | in_preparation / awaiting_collection / (confirmed_time) |
| **in_preparation** | **Listo** · **Ajustar hora** | awaiting_collection |
| **awaiting_collection** (listo) | **En reparto** *(solo reparto propio)* | in_delivery |
| **in_delivery** | *(sin acción; lo cierra la plataforma/repartidor)* | — |
| **completed / rejected / cancelled / delivery_failed** | *(terminal: solo ver)* | — |

"Aceptar" puede abrir un mini-paso para fijar **hora prometida** (`confirmed_time`) — Uber/JustEat la
usan. "Ajustar hora" = reenviar `confirmed_time` más tarde (pedido va con retraso). "Rechazar" pide
**motivo** (texto libre / motivos rápidos).

### 6.2 Reglas DURAS por plataforma (guardarraíles en la UI)

- **Uber:** si **auto-aceptación ON** (§6.4), el pedido entra **ya aceptado** (sin cuenta atrás). Si OFF,
  en "Nuevo" se muestra la **cuenta atrás de 10 min**; al acercarse a 0, la tarjeta parpadea. Tras
  aceptar, **"Listo" es opcional** (Uber lo automatiza) → atenuado, no obligatorio. Cancelar tras aceptar
  = **no** ofrecido.
- **Glovo:** **Rechazar solo en "Nuevo"**. Una vez aceptado, **no hay botón de cancelar** (Glovo no
  permite cancelar un pedido ya creado). La UI lo oculta para no prometer algo imposible.
- **JustEat:** **Aceptar** = el mínimo obligatorio (Confirmado). El resto de pasos, opcionales.
- **Shop (canal propio):** flujo completo bajo nuestro control (futuro Folvy Shop).

> La matriz de §6.1 se **recorta por plataforma** con estas reglas. Diseño: una tabla de capacidades
> por canal (`canChannelDo[channel][action]`) que oculta botones imposibles. Mejor ocultar que mostrar
> y fallar.

### 6.4 Auto-aceptación por canal/marca (añadido 18/06, Julio)

Uber **soporta auto-aceptar** pedidos; no hay por qué depender siempre del clic manual contra el reloj
de 10 min. Diseño (provider-agnóstico, no solo Uber): un **toggle "Auto-aceptación" por canal y por
marca** en ajustes de Pedidos. Cuando está ON:
- El pedido entra y Folvy lo **acepta solo** al instante (empuja `accepted` nada más recibir el webhook,
  con `confirmed_time` = ASAP). La tarjeta nace ya en "Aceptado" / "En preparación", **sin cuenta atrás**.
- En el detalle se muestra un aviso: "Aceptado automáticamente · auto-aceptación activada en {canal}".

**Guardarraíles** (deuda 0, no auto-aceptar a ciegas):
- Solo dentro del **horario de apertura** (enlaza con fase 3 / Horarios).
- Más adelante, solo si **hay stock** del plato (enlaza con el 86 / fase 4). Si no hay stock → no
  auto-acepta, cae al flujo manual con aviso.

Cuando está OFF (o sin definir), rige el flujo manual de §6.1 (Aceptar/Rechazar con la cuenta atrás).
Pieza pequeña montada sobre el Edge de la fase 1; es parte de la fase 2 (un ajuste + una rama en el
webhook de entrada).

### 6.3 Lo que NO entra en esta pantalla (declarado, otras fases)
- **Pausar/cerrar el local con duración** (`order_acceptance` + `resume_at`) = **fase 3** (es a nivel
  location, no pedido).
- **86 por producto/modificador** (push de inventario) = **fase 4**.
- **Reparto propio (crear/cancelar envío)** = enganche **Catcher** (frente conectado).
- **Impresión de comanda/ticket** = frente de cero (cloud printing).
- **Cerrar por marca / por canal** = depende de **P-A**.

---

## 7. Estados de error y honestidad

- **HubRise rechaza** (404 pedido caducado, 409 conflicto, 401 token): toast con el motivo legible;
  el `order_status` local **no** se mueve (el Edge ya garantiza esto: solo espeja si HubRise dio 2xx).
- **Token inválido/revocado** (como nos pasó hoy): mensaje "conexión con la plataforma caída, avisa a
  soporte" — no es culpa del operario. (Multi-location token = `hubrise_integration`, P-A/CP2.)
- **Pérdida de realtime:** botón "actualizar" manual de respaldo + refetch al reconectar.

---

## 8. RECON pendiente ANTES de construir (no antes de diseñar)

Para no construir contra supuestos. A verificar en repo+BBDD:
1. **Dónde montar la pestaña:** ¿módulo `delivery` con submódulos, o sección del Shell? ¿Ruta propia
   tipo `/pedidos` (cuidado con el secuestro de prefijo que pasó con `/kds`)?
2. **Patrón de feed/lista reusable:** ¿hay ya una lista de ventas (sales dashboard) o el KDS con un
   render de líneas/tarjetas que reaprovechar para no reinventar?
3. **Suscripción realtime:** confirmar el canal/tabla a la que ya está suscrita la app y si filtra por
   `order_status`.
4. **`channelBadge` / identidad de canal:** confirmar el componente existente para reusarlo.
5. **Render de líneas con modificadores+combos+alérgenos:** ¿existe en KDS? ¿se extrae de `sale_line` /
   `raw_products`?
6. **Permisos:** qué rol puede operar pedidos (RLS de `sale` + UI gating).

---

## 9. Preguntas abiertas para Julio (decisiones de diseño)

- **A — "Listo" y servicio:** ¿separamos "Listo para recoger" (collection) de "Listo para repartidor"
  (delivery), o un único "Listo" (→ awaiting_collection) y la etiqueta cambia según servicio? (Propongo:
  un solo "Listo", etiqueta contextual.)
- **B — Aceptar con hora:** ¿"Aceptar" pide siempre `confirmed_time`, o acepta con ASAP por defecto y
  "Ajustar hora" es aparte? (Propongo: aceptar con ASAP por defecto, hora opcional.)
- **C — Cuadrícula vs lista por defecto:** ¿arrancamos en cuadrícula (operación) o lista (control)?
  (Propongo: cuadrícula en tablet, lista en escritorio — por ancho.)
- **D — Alcance del primer cierre (fase 2a):** ¿construimos primero **feed + aceptar/rechazar**
  (resuelve el problema Uber 10 min ya) y dejamos preparación/listo/ajustar-hora para 2b? ¿O todo de una?

---

## 10. Resumen

La pestaña "Pedidos" convierte el ciclo de vida (fase 1, ya vivo) en una **consola operable**: ver el
pedido entrante, aceptarlo/rechazarlo a tiempo (crítico para Uber), moverlo por sus estados y que cada
acto llegue a la plataforma. Es **deuda 0** y **no depende de P-A**. Pausar local, 86 y cerrar por
marca/canal quedan declarados para fases siguientes.

*Documento vivo. Al aprobar, se versiona en `docs/folvy_pedidos_pestana_diseno.md` y se construye tras
el RECON del §8.*
