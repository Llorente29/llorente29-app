# R02 · Capturas contra la maqueta v2, una a una

Capturas hechas por `tests/e2e/reparto/quien-reparte.spec.ts` en staging-conta (cuenta A, datos inventados de
`supabase/seeds/reparto/`), ordenador 1440 px y móvil. Maqueta: `docs/reparto/maquetas/r02/R1Reparto.png`.

| Captura | Qué enseña |
|---|---|
| `quien-reparte-ordenador.png` | La pantalla entera, con la sugerencia de Folvy sin responder |
| `quien-reparte-movil.png` | Una tarjeta por marca; la sugerencia ya respondida («No») y «Lo que ha hecho Folvy» |
| `cocina-ordenador.png` | Pedidos de Norte Centro: dos ámbar (7B000 Uber, E2E01 Just Eat) y dos grises (7B001, E2E02 Glovo) |
| `cocina-movil.png` | El mismo ámbar en el móvil |

## Igual que la maqueta

- Título, miga «Ajustes › Reparto», «Se guarda al tocar» y el texto de arriba, palabra por palabra.
- Tabla marcas × plataformas con la ayuda «dirección solo si la tienda está como «reparto propio»» bajo cada una.
- Las dos filas «Si no dices nada» (la de propias arriba del todo; la de cedidas justo antes de las marcas cedidas) con el texto de la maqueta.
- Celda «Plataforma | Nosotros»: azul relleno = decidido; blanco con borde y «hereda» = de «Si no dices nada».
- Punto ámbar «!» donde llegan «propios» sin dirección (Pita del Sur · Uber, Burger Norte · Just Eat).
- Leyenda del pie: «Lo has decidido tú», «Hereda de «Si no dices nada»», «Aviso…», «Se guarda al tocar».
  «Deshacer» aparece después de guardar (lo prueba el e2e), no antes.
- Columna «Qué ve la cocina» con los tres ejemplos #705 / #118 / #112 en gris, verde y ámbar; nada en rojo.
- Bloque de Folvy: «En Uber, Pita del Sur lleva 3 pedidos seguidos sin dirección.», el porqué y los dos botones
  «Sí, la reparte Uber» / «No, lo arreglo en Uber».
- Móvil: una tarjeta por marca, como dice el LEEME de la maqueta.

## Diferencias, y por qué

1. **Todas las celdas salen en azul («decidido»), ninguna con «hereda».** Es la decisión 1 de la respuesta: la
   migración escribe una fila por celda que reproduce el interruptor, así que todo lo que existía queda
   decidido (`migrated`). «Hereda» aparece en marcas nuevas o al quitar una decisión. En la maqueta Burger
   Norte y Pita heredan.
2. **«por local» sale en todas las marcas**, no solo en Smash. En la cuenta A de pruebas todas tienen 2 locales
   (añadí Norte Mercado para probar la capa de local); el enlace sale siempre que la cuenta tiene más de un
   local. En la maqueta solo Smash lo lleva. Si se quiere solo donde ya hay un local separado, es una línea.
3. **El bloque de Folvy pone los botones debajo del texto**, uno encima de otro. En 360 px de columna no caben al
   lado; la maqueta los dibuja saliéndose de la tarjeta. La primera ejecución e2e lo cazó: el texto quedaba a 0
   de ancho (corregido en `7274b9b`).
4. **Los ejemplos de «Qué ve la cocina» salen de las marcas reales de la cuenta** (#705 Lovers de Prueba, #118 y
   #112 Burger Norte), no fijos de Smash y Pita. Y el #112 no lleva los enlaces «Pedirla al cliente · Cambiar a…»:
   es un ejemplo, no un pedido, y un botón que no hace nada no se pinta (regla 35).
5. **Iniciales de la marca en el mismo color** para todas; la maqueta las pinta de colores distintos. Se puede
   copiar si se quiere; no lo hice por no inventar una paleta fuera de `tokens.css`.
6. **No sale la barra «Pregunta o pide algo».** Es la del módulo de contabilidad (C00); esta pantalla vive en
   Ajustes del Folvy de siempre. Fuera del encargo.
7. **Primera captura: celdas de columnas vecinas pegadas y el «!» de Pita · Uber tapado** por la columna de al
   lado. Corregido en `de602c7` (hueco entre columnas, aviso por encima). Esa segunda captura sacó otro: los
   botones encogían y la opción marcada salía cortada («Platafor…»). Corregido después: las columnas de
   plataforma miden lo mismo en todas las filas (mínimo 180 px, donde cabe la opción marcada en negrita), así que
   cuadran de arriba abajo, y si falta sitio cede la columna de la marca. Por debajo de 1280 px «Qué ve la
   cocina» pasa debajo de la tabla, y por debajo de 1000 px salen las tarjetas del móvil. Las capturas de
   esta carpeta son las de después; medido antes con la letra de verdad (Geist), 1440 px, sin corte ni desborde.

## La cocina

- Etiqueta en franja propia dentro de la tarjeta, como en los ejemplos de la maqueta: ámbar «Nosotros · falta la
  dirección» + «Uber / Just Eat no la ha mandado» + «Cambiar a «la reparte X»»; gris «La reparte Glovo · nada que
  hacer» con el teléfono de soporte.
- **Ningún rojo del reparto.** Lo rojo que se ve (borde izquierdo, «53 min ⚠», «73′») es el **tiempo** del pedido,
  que ya estaba: 7B000 y 7B001 llevan una hora abiertos en la semilla. 7B001 es de plataforma y está igual de
  rojo, lo que demuestra que no sale del reparto.
- No sale «Pedirla al cliente» porque los pedidos de la semilla no traen teléfono ni la plataforma tiene portal
  configurado: sin acción, sin botón.
- **Fuera del encargo, pendiente:** en el móvil la cabecera de Pedidos se monta (los botones de sonido y
  refrescar tapan el título «Pedidos»). Es la cabecera que ya había, no la he tocado.
