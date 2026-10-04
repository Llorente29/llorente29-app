# R02 · Contraste: cómo lo presentan Otter, Deliverect y Last

Media página (encargo §7). Fuentes públicas consultadas el 04/10/2026; no he podido abrir las pantallas por
dentro, así que comparo lo que documentan, no lo que he tocado.

## Qué hacen

- **Otter.** Los ajustes de reparto son por marca y tienda. Hay un valor de «todas las marcas» y, en cada tienda,
  un interruptor «Override delivery settings» para separarla. Desde ahí se activa o se apaga el reparto como modo
  de entrega, y se conectan los transportistas (Shipday, DoorDash Drive, Nash…).
  ([activar el reparto](https://helpdesk.tryotter.com/hc/en-us/articles/21700580601747-How-to-Enable-or-Disable-Delivery-as-a-Fulfillment-Mode),
  [transportistas](https://helpdesk.tryotter.com/hc/en-us/articles/27589269188499-Couriers-Logistics-in-Order-Manager))
- **Deliverect.** La pieza es el *dispatch*: por local (o para todos, dejando el desplegable vacío) se eligen los
  transportistas preferidos, el precio máximo y los tramos de distancia. Admite tiendas solo propias, solo de
  terceros o mixtas, y si la flota propia no llega, pasa el trabajo a un tercero.
  ([auto-selección](https://help.deliverect.com/en/articles/7979515-configure-dispatch-partner-auto-selection),
  [activar un transportista](https://help.deliverect.com/en/articles/7979514-dispatch-activate-a-dispatch-partner-for-a-location),
  [mis repartidores](https://help.deliverect.com/en/articles/9399812-dispatch-my-couriers))
- **Last.** El «Own Delivery» se elige pedido a pedido desde el TPV (empresa de reparto = propio, marca, teléfono
  del cliente). Para cada pedido se decide quién lo gestiona: repartidores propios, de terceros o ambos.
  ([crear un Own Delivery](https://help.last.app/lastpos/own-delivery.html),
  [delivery propio](https://last.app/producto/delivery-propio))

## Qué hacen mejor que nosotros

1. **Deliverect** mezcla la decisión con el coste y la distancia (precio máximo, tramos de km) y cae a un tercero
   si la flota propia no llega. Nosotros tenemos esa cadena en «Reglas de despacho», pero en otra pantalla; aquí
   solo se decide *si* repartimos.
2. **Otter** separa una tienda con un único interruptor visible («Override»). Nuestro «por local» es más
   discreto: puede pasar desapercibido hasta que hay una tienda separada.
3. **Last** deja decidirlo en el momento del pedido. Nosotros lo decidimos antes, en la celda, y desde el pedido
   solo se puede cambiar hacia «la reparte la plataforma», para ese pedido y los siguientes.

## Qué hacemos mejor nosotros

1. **Se lee en diez segundos.** Una sola tabla, marcas por plataformas, con dos palabras por celda: «Plataforma |
   Nosotros». No hay que entrar tienda a tienda ni abrir el despacho para saber quién lleva un Smash en Uber.
2. **Decimos de dónde sale cada decisión**: azul si la decidió alguien, gris y «hereda» si viene de «Si no dices
   nada». Ninguno de los tres enseña en la misma pantalla qué está heredado y qué no.
3. **El dato manda.** El punto ámbar «!» y la sugerencia de Folvy nacen de los propios pedidos: 3 «propios»
   seguidos sin dirección quieren decir que en la plataforma la tienda no está como reparto propio. Ninguno de los
   tres avisa de que su configuración contradice lo que manda la plataforma.
4. **La cocina no se asusta.** El reparto va en su etiqueta (gris, verde, ámbar) y nunca pinta el pedido en rojo.
   Un pedido sin dirección se cocina igual.

*Nota aparte, vista al buscar:* el PR #140 sale en los resultados de un buscador público. Va con el pendiente de
pasar el repositorio a privado.
