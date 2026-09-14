# `pase_ficha` · el contacto del cliente, medido antes de escribir la función

**14/09/2026.** No es código: son las cifras con las que se escribirá `pase_ficha`,
para que la próxima sesión no las vuelva a medir — ni las vuelva a medir MAL,
que es lo que pasó hoy.

## 🔴 Corrección de una medición mía de las 17:05

Dije dos cosas y las dos eran falsas:

> «El código NO está en `sale`. Vive sólo en `lastapp_webhook_log.payload`.»
> «Está dos de cada tres veces: 335 de 527 pedidos de Uber en 14 días.»

**Está en `sale.raw_tab`, y está el 100 % de las veces.** Medí la cobertura
contra el LOG de webhooks —que efectivamente tiene huecos— en vez de contra la
columna de la propia venta. El «2 de cada 3» era la tasa de filas del log, no la
del dato. `raw_tab` está presente y es JSON válido en **3.195 de 3.195** ventas
de 30 días.

Es la regla 5 otra vez: la evidencia no medía lo que yo creía que medía.

## Dónde está el código, exactamente

`sale.raw_tab` es **texto**, y trae una de DOS formas según por dónde entró el
pedido. Las dos conviven en la misma columna y son complementarias:

| forma | ruta dentro de `raw_tab` |
|---|---|
| HubRise | `customer → phone_access_code` |
| Last | `customerInfo → phoneNumberCode` |

Hay que preguntar por las dos. Ninguna sola cubre un canal entero: de los 990
pedidos de Uber de 30 días, 374 traen la forma HubRise y 616 la de Last —
**374 + 616 = 990**, sin solape y sin hueco.

## Cobertura · 30 días · Foodint

| canal · reparto | ventas | con código | |
|---|---|---|---|
| Uber · lo reparte Uber | 990 | **990** | 100 % |
| JustEat · lo reparte JustEat | 44 | **44** | 100 % |
| JustEat · reparto nuestro | 36 | **36** | 100 % |
| JustEat · recogida | 3 | **3** | 100 % |
| Uber · recogida | 9 | **8** | ⚠️ uno sin código |
| **Glovo · todo** | 2.113 | **0** | Glovo no manda código nunca |

Glovo no lo necesita en reparto propio: manda el teléfono real del cliente.
En reparto suyo no manda ni una cosa ni la otra, y eso sigue sin tener arreglo.

## Forma del código

| canal | patrón | dígitos | patrones distintos |
|---|---|---|---|
| Uber | `999 99 999` | 8 | **uno solo en los 998** |
| JustEat | `999999999` | 9 | **uno solo en los 83** |

Y es por pedido, no por cliente: 376 códigos distintos en 376 ventas (forma
HubRise) y 619 en 622 (forma Last). Las tres repeticiones de la forma Last están
sin explicar y son 3 de 622: se mira cuando se escriba la función, no antes.

El teléfono, en cambio, es **uno solo por canal** en las 998 y en las 83. Es la
centralita, como dijo Julio.

## Lo que hace posible

`pase_ficha` puede armar la marcación **en la base, leyendo sólo `sale`**:

    tel:+34910780961,,,41233908     Uber · el código sin los espacios
    tel:+34910381154,,,123456789    JustEat
    tel:+34699412388                Glovo propio · directo

**Sin columna nueva, sin despliegue de edge function y sin depender del log.**
Mi propuesta de las 17:05 pedía las dos cosas; ninguna hace falta.

⚠️ **Lo que NO está medido y no se promete:** que esas centralitas acepten los
tonos nada más descolgar. Eso se sabe con una llamada desde la tablet de Alcalá,
no con una consulta. Hasta entonces la hoja enseña **también el código escrito y
grande**, y la marcación es una comodidad, no la única vía.
