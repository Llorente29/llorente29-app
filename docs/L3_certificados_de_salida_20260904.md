# C9 L3 §1 + §5 · La tabla de verificación y el certificado de salida

**04/09/2026.** Nada de esto toca el camino vivo: `sale_verification` nace cerrada e
inerte (nadie la escribe todavía) y el certificado **sólo lee**.

## La regla dura, y cómo se cumple

Cada hora sale de un registro real y **lleva escrita su fuente**. Lo que no existe se
imprime como `NO DISPONIBLE` **con el motivo**, nunca en blanco y nunca inventado.

Está forzado por construcción, no por disciplina:

- Cada paso es un objeto `{paso, fuente, estado, hora_madrid, hora_utc, nota}`, no un
  timestamp suelto — un timestamp suelto no puede decir que no existe.
- `jsonb_strip_nulls` quita las claves vacías: o hay valor, o la clave no aparece.
- La migración lleva un bloque que **aborta** si algún paso sale con la nota en blanco,
  si un `no_disponible` no dice por qué, si una hora no va en Madrid, o si el «marcado
  listo» no va etiquetado como sello débil.

## ⚠️ `sale.ready_at` no es prueba fuerte, y el certificado lo dice cada vez

Va marcado `[SELLO DEBIL]` siempre, con la frase «sello del sistema, SIN acuse de la
plataforma». Y **se mide la ráfaga de ese pedido concreto**: cuántos otros del mismo
local comparten el minuto. Así el aviso es un número, no una advertencia genérica.

En el certificado de G296 sale: *«Se marcaron 2 pedido(s) más en el mismo minuto en este
local: esta hora dice cuándo alguien PULSÓ, no cuándo el pedido estuvo listo.»*

## Tres hallazgos al generar los certificados reales

1. **`sale_step_event` NO EXISTE.** Las migraciones B53 de L0a nunca se aplicaron. El
   acuse de plataforma sale `NO DISPONIBLE` en **todos** los pedidos, y el certificado
   dice exactamente por qué. Hasta que se apliquen, ninguna hora está confirmada por
   Uber ni por Glovo.
2. **Las horas salían en UTC.** Regla 4, y aquí es cara: este documento se adjunta a una
   reclamación. Un certificado que dice «12:21» de un pedido que en Madrid entró a las
   14:21 no es un detalle de formato, es una fecha equivocada en una disputa con dinero.
   Corregido: `hora_madrid` formateada y `hora_utc` etiquetada al lado.
3. **No hay ni un pedido multimarca hoy.** Son 6 de 2.790 en 30 días (0,2 %), todos de
   agosto. El tercer certificado usa el del 12/08 con 3 marcas, y se dice.

## Los tres certificados

Generados con `select public.certificado_de_salida_texto('<sale_id>')`.

### 1 · Una marca, de hoy — G296 (Dos Coyotes, Glovo)

```
--------------------------------------------------------------------------
CERTIFICADO DE SALIDA DE PEDIDO
--------------------------------------------------------------------------
Pedido      G296   (plataforma: 101762814715)
Canal       glovo
Local       Foodint Alcalá
Marca       Dos Coyotes
Cliente     Alvaro
Estado      completed
Emitido     04/09/2026 18:57:02   (Todas las horas en Europe/Madrid salvo las marcadas UTC.)

HORAS
--------------------------------------------------------------------------
  Pedido recibido            04/09/2026 14:21:32
                             fuente: sale.created_at

  Aceptado                   04/09/2026 14:21:32
                             fuente: sale.accepted_at

  Marcado listo              04/09/2026 14:34:46   [SELLO DEBIL]
                             fuente: sale.ready_at
                             Sello del sistema, SIN acuse de la plataforma. Se marcaron 2 pedido(s) mas en el mismo minuto en este local: esta hora dice cuando alguien PULSO, no cuando el pedido estuvo listo.

  Acuse de la plataforma     NO DISPONIBLE
                             fuente: sale_step_event
                             La tabla sale_step_event todavia no existe (B53/L0a sin aplicar). Hasta entonces no hay acuse de plataforma para ningun pedido.

  Entregado al repartidor    NO DISPONIBLE
                             fuente: sale.handed_to_courier_at
                             Sin hora de entrega al repartidor registrada.

  Entregado al cliente       NO DISPONIBLE
                             fuente: sale.delivered_at
                             Sin hora de entrega al cliente registrada (habitual en reparto de plataforma).

IMPRESIONES
--------------------------------------------------------------------------
  labels    done   creado 04/09 14:21:32  enviado 04/09 14:21:32  terminado 04/09 14:21:32  (intentos 1)
  kitchen   done   creado 04/09 14:21:32  enviado 04/09 14:21:32  terminado 04/09 14:21:33  (intentos 1)
  bag       done   creado 04/09 14:34:46  enviado 04/09 14:35:00  terminado 04/09 14:35:03  (intentos 1)
  labels    done   creado 04/09 14:37:33  enviado 04/09 14:37:35  terminado 04/09 14:37:36  (intentos 1)

UNIDADES ETIQUETADAS
--------------------------------------------------------------------------
  3 etiquetas acunadas, 0 escaneadas por el cliente. Primera: 04/09 14:21:32
    [KPPPNVRCB1G3] QUESATACOS DE TERNERA (DC)         ud 1    escaneada: no disponible
    [P019OX0K85UL] PATATAS FRITAS (DC)                ud 1    escaneada: no disponible
    [JKEITAM2TL04] bolsa de bebidas                   ud -    escaneada: no disponible

FOTO DE SALIDA
--------------------------------------------------------------------------
  NO DISPONIBLE
  No hay ninguna foto de este pedido. La captura (C9 L2 §4) todavia no esta en la tablet.

VERIFICACION DE EMBOLSADO
--------------------------------------------------------------------------
  NO DISPONIBLE
  Este pedido no se ha verificado. El lector de L3 todavia no esta desplegado.

LO QUE ESTE CERTIFICADO NO PRUEBA
--------------------------------------------------------------------------
  - La hora de «listo» de este pedido comparte minuto con otros 2. Es un sello de sistema, no una prueba de cuando estuvo listo.
  - Sin acuse de plataforma: sale_step_event no existe todavia. Ninguna hora de este certificado esta confirmada por Uber ni por Glovo.
  - Sin foto: este certificado documenta horas, no contenido.
--------------------------------------------------------------------------
Cada hora sale de un registro real y lleva escrita su fuente. Lo que pone «no disponible» es que NO EXISTE el dato, no que sea cero.
--------------------------------------------------------------------------
```

**Detalle que sale solo:** dos trabajos `labels` (14:21 y 14:37) — hubo una reimpresión.
Y los 3 tokens son los mismos, porque L1 §2.4 obliga a reutilizarlos.

### 2 · Con bebidas, de hoy — G424 (Dos Coyotes, Glovo)

```
--------------------------------------------------------------------------
CERTIFICADO DE SALIDA DE PEDIDO
--------------------------------------------------------------------------
Pedido      G424   (plataforma: 101762903884)
Canal       glovo
Local       Foodint Alcalá
Marca       Dos Coyotes
Cliente     Diego
Estado      completed
Emitido     04/09/2026 18:57:08   (Todas las horas en Europe/Madrid salvo las marcadas UTC.)

HORAS
--------------------------------------------------------------------------
  Pedido recibido            04/09/2026 15:32:27
                             fuente: sale.created_at

  Aceptado                   04/09/2026 15:32:27
                             fuente: sale.accepted_at

  Marcado listo              04/09/2026 16:02:24   [SELLO DEBIL]
                             fuente: sale.ready_at
                             Sello del sistema, SIN acuse de la plataforma. Dice cuando alguien pulso «Listo».

  Acuse de la plataforma     NO DISPONIBLE
                             fuente: sale_step_event
                             La tabla sale_step_event todavia no existe (B53/L0a sin aplicar). Hasta entonces no hay acuse de plataforma para ningun pedido.

  Entregado al repartidor    NO DISPONIBLE
                             fuente: sale.handed_to_courier_at
                             Sin hora de entrega al repartidor registrada.

  Entregado al cliente       NO DISPONIBLE
                             fuente: sale.delivered_at
                             Sin hora de entrega al cliente registrada (habitual en reparto de plataforma).

IMPRESIONES
--------------------------------------------------------------------------
  kitchen   done   creado 04/09 15:32:27  enviado 04/09 15:32:28  terminado 04/09 15:32:29  (intentos 1)
  labels    done   creado 04/09 15:32:27  enviado 04/09 15:32:28  terminado 04/09 15:32:29  (intentos 1)
  bag       done   creado 04/09 16:02:24  enviado 04/09 16:02:48  terminado 04/09 16:02:49  (intentos 1)

UNIDADES ETIQUETADAS
--------------------------------------------------------------------------
  6 etiquetas acunadas, 0 escaneadas por el cliente. Primera: 04/09 15:32:28
    [BRHRM36HOCNZ] QUESATACOS DE TERNERA (DC)         ud 1    escaneada: no disponible
    [TVPVBXET190I] Coca Cola                          ud 1    escaneada: no disponible
    [P9CXXL0ET2GA] Coca Cola Zero.                    ud 1    escaneada: no disponible
    [M85LQWPHK1W2] QUESADILLA DOS COYOTES (DC)        ud 1    escaneada: no disponible
    [HHAB3Y31G6KH] QUESATACOS DE TERNERA (DC)         ud 2    escaneada: no disponible
    [0L10ADNI0LN7] bolsa de bebidas                   ud -    escaneada: no disponible

FOTO DE SALIDA
--------------------------------------------------------------------------
  NO DISPONIBLE
  No hay ninguna foto de este pedido. La captura (C9 L2 §4) todavia no esta en la tablet.

VERIFICACION DE EMBOLSADO
--------------------------------------------------------------------------
  NO DISPONIBLE
  Este pedido no se ha verificado. El lector de L3 todavia no esta desplegado.

LO QUE ESTE CERTIFICADO NO PRUEBA
--------------------------------------------------------------------------
  - Sin acuse de plataforma: sale_step_event no existe todavia. Ninguna hora de este certificado esta confirmada por Uber ni por Glovo.
  - Sin foto: este certificado documenta horas, no contenido.
--------------------------------------------------------------------------
Cada hora sale de un registro real y lleva escrita su fuente. Lo que pone «no disponible» es que NO EXISTE el dato, no que sea cero.
--------------------------------------------------------------------------
```

**Éste es el que enseña L1 §5.2 funcionando:** las dos Coca-Colas llevan **su propia
etiqueta cada una** (`TVPVBXET190I` y `P9CXXL0ET2GA`), además de la de la bolsa. Antes
del arreglo de esta tarde habrían sido una sola pegatina que no probaba nada.

Y no tiene ráfaga: su aviso de «listo» es el corto. La ráfaga se mide de verdad.

### 3 · Multimarca — 12/08, tres marcas

**No es de hoy, y hay que decirlo:** hoy no hubo ningún pedido multimarca. Son 6 de 2.790
en 30 días. Éste es el único con **tres** marcas.

```
--------------------------------------------------------------------------
CERTIFICADO DE SALIDA DE PEDIDO
--------------------------------------------------------------------------
Pedido      no disponible   (plataforma: FS9F63B)
Canal       no disponible
Local       Foodint Alcalá
Marcas      Koreans do it better - Fried Chicken + Scandal Burgers + The Urban Kebab
Cliente     Julio
Estado      completed
Emitido     04/09/2026 18:57:14   (Todas las horas en Europe/Madrid salvo las marcadas UTC.)

HORAS
--------------------------------------------------------------------------
  Pedido recibido            12/08/2026 22:07:39
                             fuente: sale.created_at

  Aceptado                   12/08/2026 22:07:39
                             fuente: sale.accepted_at

  Marcado listo              12/08/2026 22:21:36   [SELLO DEBIL]
                             fuente: sale.ready_at
                             Sello del sistema, SIN acuse de la plataforma. Dice cuando alguien pulso «Listo».

  Acuse de la plataforma     NO DISPONIBLE
                             fuente: sale_step_event
                             La tabla sale_step_event todavia no existe (B53/L0a sin aplicar). Hasta entonces no hay acuse de plataforma para ningun pedido.

  Entregado al repartidor    12/08/2026 22:23:41
                             fuente: sale.handed_to_courier_at

  Entregado al cliente       12/08/2026 22:35:45
                             fuente: sale.delivered_at

IMPRESIONES
--------------------------------------------------------------------------
  kitchen   done   creado 12/08 22:07:59  enviado 12/08 22:08:00  terminado 12/08 22:08:00  (intentos 1)
  bag       done   creado 12/08 22:21:36  enviado 12/08 22:21:39  terminado 12/08 22:21:40  (intentos 1)

UNIDADES ETIQUETADAS
--------------------------------------------------------------------------
  NO DISPONIBLE
  Este pedido no tiene etiquetas acuñadas. O se imprimio antes de que existiera label_token (C9 L1, 04/09), o no se imprimieron etiquetas.

FOTO DE SALIDA
--------------------------------------------------------------------------
  NO DISPONIBLE
  No hay ninguna foto de este pedido. La captura (C9 L2 §4) todavia no esta en la tablet.

VERIFICACION DE EMBOLSADO
--------------------------------------------------------------------------
  NO DISPONIBLE
  Este pedido no se ha verificado. El lector de L3 todavia no esta desplegado.

LO QUE ESTE CERTIFICADO NO PRUEBA
--------------------------------------------------------------------------
  - Sin acuse de plataforma: sale_step_event no existe todavia. Ninguna hora de este certificado esta confirmada por Uber ni por Glovo.
  - Sin etiquetas identificables: no se puede afirmar QUE unidades salieron, solo cuantas se pidieron.
  - Sin foto: este certificado documenta horas, no contenido.
--------------------------------------------------------------------------
Cada hora sale de un registro real y lleva escrita su fuente. Lo que pone «no disponible» es que NO EXISTE el dato, no que sea cero.
--------------------------------------------------------------------------
```

**Éste es el que prueba que el «no disponible» sale del dato y no es una constante:** no
tiene etiquetas ni código corto, pero **sí** tiene entrega al repartidor y al cliente,
donde los otros dos ponen `NO DISPONIBLE`. Cada campo mira su propio registro.

## Lo que falta para que un certificado sirva de verdad en una reclamación

Por orden de valor:

1. **Aplicar las tres migraciones B53 de L0a.** Es lo único que convierte la hora de
   «listo» de sello débil en hora con acuse. Hoy es la carencia más grande.
2. **La captura (L2 §4)**, para que haya foto y `sha256`.
3. **El lector (L3 §2-§4)**, para que haya verificación.

Sin las tres, el certificado documenta **horas y etiquetas acuñadas**, no contenido. Y lo
dice en cada emisión, que es justo lo que se le pidió.
