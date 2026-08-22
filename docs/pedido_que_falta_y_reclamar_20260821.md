# ENCARGO «Qué falta de un pedido, y poder reclamarlo» — resultado

Fecha: 21/08/2026 · Commit `5284ec6` · 2 migraciones aplicadas y verificadas

## Lo primero: dos cosas del encargo que hay que corregir

### 1 · La pregunta sobre WhatsApp ya estaba contestada

El §3 dice «mira primero por dónde sale hoy `ctb_notification_queue` antes de
añadir un canal». Mirado: **ya sale por WhatsApp**. `CtbNotifyPage` usa Web Share
con el albarán adjunto y, en PC, portapapeles + abrir el fichero. No hay
proveedor de mensajería y no lo va a haber: lo dice su propia cabecera —«no hay
canal oficial robusto a grupos de WhatsApp»— y **el humano es el transporte, a
propósito**.

**No hay nada que construir ni nada que preguntarte.**

### 2 · La Parte C ya existía, y ahí estaba el fallo de verdad

`CloseShortOrderModal` está en producción **desde el 10/08**, con motivo
obligatorio, compartido entre la ficha del pedido y el vigía de colgados. No hay
botón que construir.

Lo que fallaba es **a dónde manda el pedido**:

```
'enviado'          → 'cancelado'     ← aquí
'recibido_parcial' → 'cerrado'
```

De los **41 cancelados** de Foodint, **10 salieron de ese botón** — y **ocho con
el motivo «Otro»**:

| Pedido | Líneas | Motivo |
|---|---:|---|
| PED-00014 | 35 | Otro |
| PED-00020 | 33 | Otro |
| PED-00021 | 29 | Otro |
| PED-00036 | 24 | Otro |
| PED-00037 | 23 | Otro |
| … | | |

Pedidos semanales enteros. **«Otro» era donde iba a morir «llegó, pero el sistema
no lo cierra».** Con el casado de líneas roto (arreglado ayer), un pedido cuya
mercancía sí había llegado se quedaba en `enviado`, y cerrarlo lo mandaba a
`cancelado`.

**Arreglado**: el destino mira ahora **el hecho** —¿hay algo recibido?— y no la
etiqueta del estado. Llegó algo → `cerrado`. No llegó nada → `cancelado`. El
modal comprueba el hecho antes de dejar cerrar; mientras no lo sabe, no deja.

*(Los otros 31 cancelados no pasaron por ese botón: se cancelaron por otra vía o
antes de que existiera. El encargo daba los 41 por obra del botón; son 10.)*

## Parte A · el número, sin abrir nada

`purchase_order_shortfall` y `purchase_order_progress`. **El cálculo vive en un
solo sitio** y de ahí beben las tres cosas que lo necesitan: la fila, la ficha y
el texto de la reclamación. Si cada una lo calculara por su cuenta acabarían
discrepando.

La fila dirá, verificado contra la base:

> **PED-00042** · CLOUDTOWN, S.L. · **27 de 31 · faltan 4** · **4 días de retraso**

Una consulta para toda la lista, no una por fila. Y si esa consulta falla, la
lista sigue entera y sólo se queda sin el número: degradar, no romper.

Al abrir, `OrderShortfallPanel` — **las que faltan arriba**, con pedido / llegó /
falta, y las 27 completas plegadas detrás de un desplegable. El orden lo impone
el servidor, no la pantalla, para que la ficha y la reclamación enseñen lo mismo:

| # | Artículo | Pedido | Llegó | Falta |
|---|---|---:|---:|---:|
| 1 | Bolsa Marron Grande 25x15x43,5 · Caja | 2 | 0 | **2** |
| 2 | Bolsas Personalizadas Big Mikes · Caja | 1 | 0 | **1** |
| 3 | Queso Mozarela · Paquete | 10 | 3 | **7** |
| 4 | Salsero Pp 120 Cc con Tapa · Paquete | 1 | 0 | **1** |
| 5 | Aceite Alto Oleico · Bidón | 1 | 1 | 0 |

El panel **no se pinta si no falta nada**: un panel que siempre está deja de
leerse.

## Parte B · reclamar

- `purchase_order_id` en `ctb_notification_queue`; `goods_receipt_id` pasa a
  nullable y un **`CHECK` garantiza exactamente uno de los dos**. Eso es lo que
  protegía de verdad el `NOT NULL`.
- **Sin `unique` sobre el pedido**: reclamar dos veces tiene que poder hacerse y
  **verse** (§3.5). El rastro es el valor, no un candado.
- El mensaje **lo compone el sistema** y se enseña **tal cual** antes de salir.
  El operario revisa y envía, no redacta.
- `queue_ctb_order_claim` se niega, con motivo explícito, si el proveedor no
  comunica por el grupo de CTB o si al pedido no le falta nada — nunca devuelve
  null en silencio.
- **La cola aprendió a pintar reclamaciones.** Sin esto habría creado una fila
  que nadie puede procesar: la cuarta pata otra vez.

Texto que sale hoy para PED-00042:

```
Falta material de un pedido
Proveedor: CLOUDTOWN, S.L.
Local: Foodint Alcalá
Pedido: PED-00042 · entrega prevista 18/08/2026

Faltan 4 artículos:
• Bolsa Marron Grande 25x15x43,5: pedidas 2 Caja, recibidas 0 → faltan 2
• Bolsas Personalizadas Big Mikes: pedidas 1 Caja, recibidas 0 → faltan 1
• Queso Mozarela: pedidas 10 Paquete, recibidas 3 → faltan 7
• Salsero Pp 120 Cc con Tapa: pedidas 1 Paquete, recibidas 0 → faltan 1

Enviado con Folvy · folvy.app
```

**Sólo aparece el botón con proveedores que comunican por el grupo de CTB** (4 de
19 en Foodint, Cloudtown entre ellos). Con los demás la ficha lo dice en vez de
ofrecer un botón que no cumple — pero **es un hueco real**: reclamar a los otros
15 proveedores no tiene camino. Si lo quieres, es otro encargo.

## Un fallo silencioso encontrado de paso

`Supplier.notifyGroup` **no estaba en el mapeador** aunque el `select` es `'*'`.
Quien lo leyera obtenía `undefined` — y el botón de reclamar se habría apagado
solo, sin error, sin nada. Añadido al tipo y al mapeador.

## Criterios

| # | Criterio | Estado |
|---|---|---|
| 1 | La fila dice «27 de 31 · faltan 4» y «4 días de retraso» sin abrir | ✅ verificado contra la base |
| 2 | Al abrir, las 4 que faltan salen primero con pedido/recibido/falta | ✅ posiciones 1-4 |
| 3 | Reclamar compone solo, enseña antes de enviar y deja rastro | ✅ |
| 4 | Una notificación es de recepción **o** de pedido, por `CHECK` | ✅ probado insertando una fila ilegal: la rechaza |
| 5 | «Dar por cerrado» exige motivo y no usa `cancelado` | ✅ con matices — ver abajo |
| 6 | Las 55 existentes siguen igual | ✅ 55, todas de recepción, todas enviadas |
| 7 | Verificado con PED-00042 **en pantalla y captura** | ⏳ **de Julio** |

**Sobre el criterio 5**: el botón exige motivo desde el 10/08. Ya **no** usa
`cancelado` cuando ha llegado algo, que es el caso que importa. Sigue usándolo
cuando **no ha llegado nada**, y eso es correcto: un pedido del que no llegó nada
no se «cierra», se cancela. Confundirlos en el otro sentido sería el mismo error
al revés.

## Comprobaciones

`tsc` limpio · `npm run build` limpio · **10 pruebas nuevas** del compositor del
mensaje y del destino de cierre (102 en total, 97 pasan).
Los 5 fallos de los mapeadores de multitenancy y los 5 errores de lint
**ya estaban** — verificado con `git stash`.

## Deuda que sigue anotada, no arreglada

`purchase_order_shortfall` compara `qty_received` (formato del albarán) con
`qty_ordered` (formato del pedido) **sin convertir**, igual que
`recompute_purchase_order_status`. En PED-00042 hay dos líneas donde los formatos
no coinciden y cuadran por casualidad. Se replica el criterio **a propósito**: si
la ficha contara distinto que el estado del pedido, dirían cosas distintas del
mismo pedido. Se arregla en los dos a la vez o en ninguno.
