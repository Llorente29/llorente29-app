# Cierre del día · Capturas junto al encargo

Este encargo no trae maqueta: lo que se compara son las frases y el
comportamiento que pidió Julio el 09/10 contra lo que pinta la pantalla.

Capturas de staging-conta sacadas por la e2e
`tests/e2e/conta/cierre/cierre.spec.ts` (ordenador 1440 × 900 y móvil 390 × 844,
página entera) con las semillas INVENTADAS del C04 y del cierre
(`supabase/seeds/conta/seed_cierre_staging.sql`), en la ejecución verde **164**
(sobre `2ae0219`; las subió el propio e2e en `813ecee`). La 163 se quedó en
rojo por una sola prueba, la de Ajustes en el móvil: la tarjeta no decía de qué
era la hora (lo arregló `2ae0219`, abajo).

| Pantalla | Ordenador | Móvil |
|---|---|---|
| Asiento de ventas del día con sus no confirmados, «Ver» abierto | `asiento-no-confirmados-ordenador.png` | `asiento-no-confirmados-movil.png` |
| Libro diario con el día en curso | `libro-dia-en-curso-ordenador.png` | `libro-dia-en-curso-movil.png` |
| Ajustes › Ejercicio › Hora de cierre del día | `ajustes-hora-cierre-ordenador.png` | `ajustes-hora-cierre-movil.png` |

**Lo que es de la captura, no de la pantalla.**
- La barra de la IA (y, en móvil, la de abajo) es `position: fixed`: en una
  captura de página entera sale pintada a la altura de la ventana, encima de lo
  que haya ahí. En `asiento-no-confirmados-movil.png` tapa la línea «3 pedidos
  no confirmados · 66,80 €…» y el «Ocultar»; en `ajustes-hora-cierre-movil.png`,
  la hora; en `libro-dia-en-curso-movil.png`, los filtros. En uso real no tapa
  nada al desplazarse, y la e2e comprueba esos textos visibles en los dos
  tamaños.
- La franja ocre de arriba es la de staging («NO ES PRODUCCIÓN»).
- «Hoy se cierra mañana a las 6:00» es porque la e2e corrió a las 19:57 de
  Madrid. Entre las 0:00 y las 6:00 diría «Hoy se cierra a las 6:00».

## El asiento: «no están en estas ventas»

**Como lo pidió Julio.**
- Bajo las cifras, una línea: «3 pedidos no confirmados · 66,80 € · no están en
  estas ventas» y «Ver». No es un aviso ni va en rojo: es información del día.
- «Ver» abre la lista con hora, marca, canal, código, importe y cómo acabó, **en
  palabras** («En preparación», «Entrega fallida», «Esperando recogida»), nunca
  el estado en inglés de la plataforma. La e2e comprueba que en la lista no
  aparece ninguno (`awaiting`, `delivery`, `failed`, `cancelled`,
  `in_preparation`), y la unitaria de `comoAcabo` lo mide sobre las 19 parejas
  de estado reales.
- Encima de la lista, el porqué en una frase: seguían abiertos a la hora de
  cierre, se cerraron como no confirmados, no son venta, y si la plataforma paga
  alguno se propone como venta de su día.
- Las cifras del asiento (98,90 €) no cambian: los 66,80 € están fuera, que es
  lo que dice la línea.
- En móvil, por niveles: código e importe; hora, marca y canal; cómo acabó.

**Distinto, y por qué.**
1. **El encargo ponía «71,70 €» de ejemplo** (los tres reales del 02/10 en
   producción). La captura dice 66,80 € porque son los tres de la semilla del
   04/10 (17,00 + 22,40 + 27,40). Las pruebas unitarias sí usan los 71,70 €
   reales.
2. **El enlace «pagado después, en su asiento»** no sale en la captura: ninguno
   de los tres de la semilla está pagado. Se prueba en el paso 12 de staging y
   en las unitarias.

## El libro: el día en curso

**Como lo pidió Julio.**
- «Hoy se cierra mañana a las 6:00. Sus ventas se proponen entonces.», encima
  de los filtros, en gris y como nota (`role="note"`), no como aviso.
- «Proponer lo pendiente» llega hasta el último día cerrado: el de hoy no sale.
  Esto no se ve en la captura: lo prueban las unitarias de `rangoAProponer` y
  el paso 3 de staging.

## Ajustes: la hora de cierre

**Como lo pidió Julio.**
- En Ajustes › Ejercicio, la tarjeta «Hora de cierre del día»: «6:00 (la de
  serie)» y una línea de qué hace. «Cambiar» la edita; guardar **falla en
  pantalla** si no se actualiza exactamente una fila (regla 8). La e2e la
  cambia y la deja como estaba.

**Distinto, y por qué.**
1. **En el móvil la hora lleva su nombre delante** («Hora de cierre del día:
   6:00 (la de serie)»). Las tarjetas de Ajustes no pintan su título en el
   móvil, y Ejercicio tiene tres: la de la hora se quedaba en «6:00 (la de
   serie)» sin decir de qué. Lo cazó la e2e 163.
