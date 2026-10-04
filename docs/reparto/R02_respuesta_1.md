# R02 — Respuesta 1 (tras las comprobaciones previas, PR #140)

Buen informe; lo de Glovo sin dirección en 1.868 de 1.868 cambia la maqueta y lo agradezco. Decisiones a las ocho preguntas. Con ellas sigue con las tareas 2 a 7 en orden, sin parar salvo bloqueo.

1. **Interruptor apagado → filas explícitas, no herencia.** La migración escribe una fila por marca × plataforma que reproduce lo que hace hoy `resolve_dispatch`: interruptor encendido → `own` en todas las plataformas; apagado → `platform` en todas. `source='migrated'`, nota «del interruptor antiguo». Así el resultado de la resolución antes y después es idéntico para todas las marcas y plataformas (la prueba de 0 diferencias de la tarea 3 es exactamente esta). Que Smash o Lovers pasen a «Nosotros» en Uber lo decidirá Julio en la pantalla, no la migración. La fila a mano del 02/10 (Uber·propia·propio) queda absorbida en la herencia y, como hoy no manda sobre el interruptor, no cambia nada.
2. **Last.** Por Last entran las marcas cedidas, y a las cedidas las reparte siempre la plataforma. La regla nueva se aplica también a esos pedidos y el resultado para ellos es `platform` (filas migradas o herencia de cedidas), sin despacho: igual que hoy. Comprueba y escribe en el PR que los 2.662 pedidos de Last son todos de marcas cedidas; si alguno fuera de una marca propia, apúntalo y no decidas nada.
3. **Texto de ayuda y sugerencia.** Bajo las tres plataformas el mismo texto: «Manda la dirección solo si la tienda está en la plataforma como “reparto propio”». La sugerencia de la IA vale para las tres. Cambio la maqueta en eso (adjunto `R1Reparto` v2).
4. **Rejilla de precios: entra.** `brand_price_grid` pasa a leer la misma resolución (`resolve_dispatch` o una función hermana sobre la misma fuente), con prueba de que los precios por canal no cambian para ninguna marca tras migrar. Si al abrirlo ves que es más de un día de trabajo, para y dilo con el tamaño.
5. **Nivel de local.** La fuente nueva lleva `location_id` **no nulo**, con un valor fijo «todos los locales» (UUID cero) para la fila de marca, y filas por local solo cuando una tienda se separa. Así el índice único es normal, sin parciales, y se acabó el R01 de raíz. Resolución: local → marca → herencia por tipo → `platform`. En la pantalla, la celda de marca lleva un enlace discreto «por local» que despliega una fila por local solo si hay diferencias o si la persona lo abre.
6. **Semillas.** Marcas, locales, políticas y ventas inventadas (nombres de la maqueta), con la **forma** real de los pedidos de HubRise y Last pero sin ningún dato de cliente; una tanda que se pueda rehacer. Nada copiado de producción.
7. **`source`.** Solo lo que se guarda: `manual`, `migrated`, `ai_accepted`. «Hereda» no se guarda; se deduce cuando no hay fila, y la resolución lo devuelve como `inherited` para pintarlo.
8. **«Si no dices nada»: dos filas**, marcas propias y marcas cedidas. Cedidas con `platform` por defecto; se puede cambiar, pero la pantalla avisa de que a las cedidas las reparte la plataforma.

## Lo que ya sabemos y arregla este encargo

- Los 13 pedidos de Uber en rojo y el 431 de Scandal en Glovo: con la regla nueva, «propio sin dirección» es ámbar y «la reparte Glovo» no se despacha. No los toques ahora; al desplegar, la misma tanda los sanea (lista de qué pedidos cambia y a qué, en el informe de la migración).
- El «Reintentar despacho» que no puede funcionar desaparece con las etiquetas nuevas.
- Las 72 ventas que siguen abiertas aunque terminaron: pendiente aparte, como lo tienes; no entra aquí.

## Método

Capturas junto a la maqueta al terminar la tarea 4, no al final. Lo que aparezca fuera del encargo, al PR como pendiente. Nada en producción.
