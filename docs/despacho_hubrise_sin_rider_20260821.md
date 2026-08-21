# ENCARGO «El despacho al repartidor no sale en los pedidos de HubRise» — resultado

Fecha: 21/08/2026 · Commit `d2e48bf` · `catcher-dispatch` **v51** · migración aplicada

## El fallo, reproducido antes de tocar nada

`dry_run` sobre el pedido de Milanesa House del 21/08, con la **v48** que había:

```
400  {"ok":false,"error":"el pedido no tiene dirección de cliente (raw_tab.delivery)"}
```

Exactamente lo que decía el encargo.

## Los datos: complementarios al 100 %

Pedidos `own_delivery` de los últimos 30 días, en producción:

| origen | pedidos | con rider | coords en `.customer` | coords en `.delivery` |
|---|---:|---:|---:|---:|
| lastapp | 408 | 326 | **0** | **408** |
| hubrise | **4** | **0** | **4** | **0** |
| folvy_shop | 2 | 2 | 0 | 0 |

Ni un solo cruce. Last siempre trae la dirección en `.delivery` y nunca en
`.customer`; HubRise, al revés. No es una coincidencia de un pedido: es la forma
de cada integración.

*(El encargo dice 428/300 y 6 pedidos; mis cifras salen de filtrar
`service_type = 'own_delivery'` sobre 30 días exactos. La conclusión es la misma.)*

## Lo que el encargo no ve, y que habría hecho daño

**En HubRise, `raw_tab.delivery` NO es la dirección: es el bloque del repartidor
de la plataforma.** En el pedido `03c5bec4` del 21/08 trae:

```json
{"carrier":"Uber Eats","driver_name":"Anthony David",
 "driver_latitude":"40.443814","driver_longitude":"-3.614083", ...}
```

Si el camino de HubRise cayera a `raw_tab.delivery` cuando `customer` no
resuelve —que es lo natural al copiar el patrón del Shop—, **mandaríamos al
rider a donde está el repartidor de Uber**. Por eso el camino de hubrise **no
tiene caída**: si `customer` no resuelve, se para y lo dice.

Hoy no llega a pasar porque el disparador `tg_auto_dispatch` sólo despacha
`service_type = 'own_delivery'` y esos pedidos son `platform_delivery`. Pero
`catcher-dispatch` también se puede invocar a mano, y la puerta estaba abierta.

## §3 · El arreglo

`deliveryFromHubrise()` lee `raw_tab.customer`:

| Campo | De dónde |
|---|---|
| `address` | `sale.delivery_address` (ya compuesto); si faltara, `address_1` + `address_2` si ≠ `city` + `postal_code` |
| `details` | `customer.delivery_notes` |
| `latitude` / `longitude` | `customer.latitude` / `longitude`, **convertidas de texto a número** |
| `postalCode` | `customer.postal_code` |
| `geocodedAddress` | **sin poner, a propósito** |

Sobre `geocodedAddress`: HubRise no manda ese campo, así que `addressMismatch()`
devuelve `false` y se usan las coordenadas de HubRise tal cual. Está comentado en
el código para que se lea como decisión y no como olvido: no se puede detectar
una discrepancia contra un dato que no existe, e inventar una re-geocodificación
sería cambiar un pin bueno por uno adivinado.

## §4 · El fallo mudo, que es el que costó el mes

Todo camino que no llega a crear el pedido en Catcher escribe ahora su motivo en
`sale.dispatch_error` antes de devolver. Y el vigía de los 8 minutos distingue:

```
dispatch_error con algo  ->  «No se pudo enviar a Catcher: <motivo>»
dispatch_error vacío     ->  «Enviado a Catcher, sin rider tras 8 min…»
```

No prefija dos veces: el vigía sólo alcanza cada pedido una vez
(`delivery_alarm_at is null` en los candidatos, y el UPDATE lo pone).

**Una excepción, razonada**: el 401 del secreto interno **no** escribe. Es la
frontera de autenticación y aún no se sabe quién llama; dejar que un no
autenticado escriba texto en cualquier pedido por su id sería abrir una puerta
para cerrar una ventana. Queda en el log.

## Y un fallo mío, encontrado probando

El primer `sinLlegarACatcher` escribía **también en `dry_run`**. Lo descubrí
cuando mi propio ensayo sobre el pedido de Uber Eats le dejó un `dispatch_error`
que no correspondía a ningún intento real de despacho. Un ensayo que deja rastro
en producción deja de ser un ensayo.

Restaurado ese pedido a `null` y arreglado en la v51: `dry_run` ya no toca nada.
Verificado: tras un ensayo que falla, `dispatch_error` sigue a `null`.

## Criterios

| # | Criterio | Estado |
|---|---|---|
| 1 | `dry_run` sobre Milanesa House da Claudio Coello y 40.431534 / -3.68581 | ✅ |
| 2 | Un pedido de Last despacha exactamente igual | ✅ byte a byte |
| 3 | Ningún camino deja el pedido sin `dispatch_error` | ✅ probado |
| 4 | Pedido real de Just Eat con `carrier_order_id` y sin error | ⏳ **no se puede forzar** |
| 5 | Comparar repo con producción antes de desplegar | ✅ idénticos |

### Criterio 1 — el payload que sale ahora

```
orderDeliveryLocation : CLAUDIO COELLO 101, bajo centro, ASEDIE, 28006
orderDeliveryLat      : 40.431534
orderDeliveryLong     : -3.68581
addressDetails        : telefonillo a nombre de ASEDIE
```

### Criterio 2 — Last, antes y después

El payload de `4e6e2b4a` (Mila's Sandwiches, Glovo por Last, 20/08) con la v48 y
con la v51: **md5 idéntico `1505b820c3384725f90b4c4761bce83d`**, normalizando
`orderPickupTime`, que es `now()+10min` por diseño y cambia en cada llamada.

Probado además `fd736a90`, «Calle de Federico Gutiérrez» — con tilde, que es el
caso que ejercita el despojado de acentos: `addressMismatch=false`, sin llamar a
Mapbox. Correcto.

### Criterio 4 — por qué no lo cierro yo

Haría falta un pedido **nuevo** de Just Eat con reparto propio. El de Milanesa
House es de las 12:55 y son más de las 18:00: despacharlo de verdad mandaría un
rider a Claudio Coello a por una comida que se entregó hace horas. **Eso no se
hace para cerrar un criterio.** Se cierra solo con el próximo pedido real; la
comprobación es `carrier_order_id` relleno y `dispatch_error` a null.

### Criterio 5 — la comparación

Las 380 líneas del repo contra las vivas, byte a byte: **idénticas**, md5
`432cf746f03fa2d614667df8dfaaa3b2`. Esta vez el repo sí era la verdad.

La comparación cazó de paso un error **mío** de transcripción: al copiar el
fichero desplegado escribí los caracteres combinantes decodificados donde el
fichero lleva el escape `̀`. Era mi copia, no una diferencia real.

## Lo que queda abierto, y es mío

**Producción (v49-v51) lleva en `normStreet` los dos caracteres combinantes
decodificados donde el repo lleva `̀-ͯ`.** El transporte JSON del MCP
de despliegue decodifica los escapes al subir; lo intenté corregir dos veces y no
lo conseguí, y no voy a desplegar una función crítica una tercera vez por un byte.

- **La clase de caracteres es la misma y el comportamiento también** — verificado
  con el pedido de «Gutiérrez».
- **No es la deriva peligrosa del 26/07**, donde producción tenía una mejora que
  el repo no y desplegar habría retrocedido. Aquí es al revés: el repo está mejor
  escrito y desplegarlo normaliza, sin riesgo en ninguna dirección.
- **Remedio**: desplegar desde el CLI de Supabase, o escribir el escape doble
  (`\\u0300`) en el JSON del MCP. Queda anotado en la cabecera de la función.

## Otro detalle, para que no sorprenda

En los pedidos de HubRise, `orderCode` sale como **`g23x743`** — el `external_ref`.
No hay `pos_short_code` ni `platform_order_code`, así que la cadena de reserva
cae hasta ahí. El repartidor no tiene un código corto que cantar al llegar, como
sí tiene con Last («G345»). Es comportamiento **anterior**, no lo he cambiado,
pero con Glovo migrando el lunes afecta a los 428 pedidos al mes. Decisión tuya
si quiere arreglarse antes del cutover.
