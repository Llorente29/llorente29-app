# ENCARGO PARA CODE · Modificadores, fase C: las pantallas · preparado el 11/09/2026

> **Archivado en el repo el 12/09/2026 a las 10:45 (reloj de la base), tal cual lo
> entregó Julio.** Hasta hoy vivía fuera del repositorio y por eso no se podía
> construir fiel a él. Éste es el texto que manda; si alguna vez diverge de la
> copia de Julio, gana la suya y se corrige aquí.

**Estado: preparado.** Se entrega a Code cuando la fase B esté cerrada y verificada
(el extra existe una sola vez, «qué lleva» cuelga del extra, «sustituye» vive en la
pregunta puesta en un plato). Hasta entonces no se toca: una cosa cada vez.

**Documentos que mandan:**

- `claude/ENCARGO_CODE_modificadores_ninguna_venta_sin_descontar_20260911.md`, sobre todo el §5.
- La maqueta «Modificadores de Folvy», con 8 tableros (artifact `51e7d1ea-da4d-4c64-a835-dc0eda650dde`, versión 2), aprobada por Julio el 11/09.
- La sección Extras, que ya está en producción: es la vara de construcción. Mismas piezas, mismo método de captura, mismas reglas (`claude/ENCARGO_CODE_kitchen_seccion_extras_20260907.md`, §9–§23).

Lo que Julio necesita primero: **poder crear una pregunta y ponerla en sus platos.**
Por eso el primer paquete publicable (§3) es la lista, crear, poner en platos y las
dos fichas de pregunta. Lo demás va detrás.

**Si lo que midas contradice algo de esto, gana lo que midas: para y cuéntalo.**

## §0 · Antes de construir: mide (sin tocar)

1. Cómo llega hoy una pregunta de una marca propia a Glovo, Uber y la web. Qué dispara `hubrise-catalog-publish` (un botón, un cambio, un cron), qué publica de preguntas, opciones y sus platos, y cuánto tarda. Una pregunta creada en Folvy tiene que salir por ese mismo camino. Si hoy hace falta pulsar algo, la pantalla lo dice («Pendiente de publicar en Glovo, Uber y la web») y el botón lleva a lo que ya existe (regla 35).
2. Qué pantallas tocan hoy preguntas, opciones y sus platos (la pestaña Modificadores de la ficha del plato, `SalesExceptionsPage` «grupos», Extras), con su ruta real. Ninguna se queda como segundo camino para lo mismo sin decirlo. La pestaña del plato se queda: es donde se ve un plato concreto.
3. Quién puede editar: los mismos permisos que la escritura de Extras (administrador o encargado de la cuenta).
4. Cómo se ven hoy los datos de cada tablero, con las consultas que usarán las RPC. Las cifras de la maqueta son de ejemplo: la pantalla pinta lo que devuelva la RPC.

## §1 · Reglas de construcción (las de Extras, sin excepciones)

- **Diseño:** fiel a la maqueta, no al estilo de hoy de la app. Clase `.cocina` y las piezas de `PatronDeKitchen` (`CabeceraCocina`, `CifraCocina`, `PastillaCocina`, `BotonCocina`, `CampoCocina`), con los tokens exactos de `tokens_maqueta.css`. Si falta una pieza (segmentos de elección, fila de opción, modal de platos), se crea en el mismo patrón y con su prueba.
- **El castellano vive en `lib/`.** La RPC devuelve claves y la frase la pone `lib/`. Las palabras en pantalla son **pregunta, opción, extra, qué lleva, sin decidir, sustituye, añade, quita**. Nunca grupo, modificador, impacto, bundle, confirmed ni inglés.
- El servicio **no convierte un fallo en una lista vacía**. Si se cambia de cuenta con una consulta en vuelo, la respuesta caduca (regla 9 en el navegador).
- **RPC:** SECURITY DEFINER con guarda de cuenta, sin anon ni PUBLIC. Las que escriben, en una sola transacción (regla 13). Un solo reloj: la RPC devuelve la ventana en días enteros de Madrid y la pantalla la escribe (regla 36).
- Paneles y modales **por portal a `body`**, centrados en lo que se ve, que se cierran con Escape.
- **Ningún botón sin destino que exista hoy** (regla 35). Si el destino llega en un paquete posterior, el botón llega con él.
- **Captura a 1280** de cada tablero desde los componentes reales, con la cabecera incluida y las mismas fuentes en los dos lados (regla 37). Va al lado de su tablero. Julio la ve antes de publicar. Las diferencias se enumeran y se corrigen, no se explican.
- Publicar es subir a `main` y aplicar migraciones: **nada que toque la entrada de pedidos, el consumo o el stock entre las 12:15 y las 23:45** (reloj de la base). Las pantallas de oficina sin cambios de base se publican cuando la captura cuadre.

## §2 · Los tableros, uno a uno

### Tablero 1 · La lista de preguntas (Kitchen › Modificadores)

- Carril: «Modificadores», al lado de «Extras».
- Cabecera:
  - pregunta «¿Qué puede elegir, añadir o quitar el cliente en cada plato?» con su línea de regla;
  - selector de marca («Todas» por defecto);
  - buscador de pregunta u opción;
  - botón «+ Crear pregunta».
- Franja arriba: «De los extras vendidos en N días, descuentan del almacén el X %», con sus cifras (sin decidir, Folvy no los conoce, cedidas y propias) y el botón «Ver lo que no cuadra» (tablero 7). Sale del estado de A3 y A5. **Hasta que exista el tablero 7, la franja se pinta sin el botón.**
- Cinco cifras:
  1. preguntas (con su número de opciones);
  2. platos con alguna pregunta, de cuántos;
  3. repetidas (mismo nombre en la misma marca);
  4. opciones frente a extras distintos;
  5. opciones sin decidir qué llevan (y cuántas cobran).
- Lista agrupada por marca: propias primero y cedidas después, con la nota «Marca cedida · la carta la manda Last». Una fila por pregunta:
  - nombre y tipo;
  - qué puede hacer el cliente («Elegir 1 · obligatoria», «Añadir hasta 5», «Quitar hasta 2»);
  - opciones (y cuántas cobran);
  - en cuántos platos: «Ninguno» en rojo;
  - pastillas: «Copiada N veces», «N sin decidir», «Mismo nombre, reglas distintas», «Se cambia en Last», «N vendidas antes de llegar»;
  - un botón: Juntar, Revisar o Abrir.
- Orden: primero las que piden algo.
- Preguntas que no están en ningún plato activo (por ejemplo, porque se retiró el plato o el combo): van aparte, con «En ningún plato · su plato se retiró el …» y el botón «Retirar».
  - Es el caso real del 11/09: los combos «Combo Duo Smash» y «Combo Individual Smash» se archivaron el 08/09 y dejaron vivas 5 preguntas de Smash Brothers, con 22 opciones.
  - Al archivar un plato o un combo, Folvy avisa de las preguntas que se quedan sin ningún plato y ofrece retirarlas en el mismo paso.

### Tablero 2 · Una pregunta propia

- Editable:
  - lo que lee el cliente, con la nota «así sale en Glovo, Uber y la web»;
  - qué puede hacer: elegir una, añadir varias o quitar;
  - cuántas como mucho;
  - si tiene que elegir alguna;
  - si puede repetir.
- Opciones: nombre, el extra detrás («Extra «Salsa Yogur» · en 13 opciones»), precio, qué lleva («lo dice el extra») o «Sin decidir · Decidir», y si se vende.
- «+ Añadir opción» abre el buscador de extras del tablero 5.
- Si la pregunta está copiada: franja «Esta pregunta está copiada N veces» con «Ver las N» y «Juntar las N en una». Juntar preguntas deja una sola pregunta en todos sus platos.
- A la derecha: en qué platos está (con «Quitar») y «+ Poner en más platos» (tablero 3).

### Tablero 3 · Poner en platos

- Modal con buscador de plato, el interruptor «Solo los que no la tienen» y una fila por plato de la marca.
- Estados de cada fila: «Ya la tiene» (casilla apagada), «Tiene una copia · se junta» (marcada) o normal.
- Dos formas: por categoría de la carta (los platos nuevos de esa categoría la heredan, y se puede quitar plato a plato) o plato a plato.
- Pie: «N platos · M copias se juntan en esta» y «Poner en N platos».

### Tablero 4 · Una pregunta de marca cedida

- **Solo lectura** en todo lo que manda Last: nombre, opciones, precios, platos y reglas. Cada campo lleva candado.
- Franja: «Esta pregunta la manda Last», con la frase de identidad: si Last cambia el nombre o el precio, lo que lleva se queda; si el mismo extra está en otra marca, ya viene decidido.
- Lo único que se toca: qué lleva cada opción, con «Decidir», que abre la ficha del extra.

### Tablero 5 · Crear una pregunta y ponerla en platos

- Solo marcas propias. En una marca cedida, el botón explica que las preguntas se crean en Last y llegan solas.
- 1 · La pregunta: los mismos campos que el tablero 2, y la marca.
- 2 · Las opciones: el buscador busca primero en los extras que ya existen («Ya existe · lleva … · está en N preguntas de …», con «Usar este»). Crear un extra nuevo va en segundo plano, y si se llama igual que uno que ya existe, pregunta antes.
  - Cada opción lleva su precio.
  - Si el extra no está decidido, se decide ahí mismo con las respuestas de la fase B: lleva, quita, es un plato o no lleva nada.
  - **Con una opción sin decidir, no se crea la pregunta.**
- 3 · En qué platos: por categoría o plato a plato.
- Aviso de pregunta parecida: si los platos elegidos ya tienen una pregunta con las mismas opciones, se dice «¿No es la misma pregunta que «…»?» y se ofrece «Usar «…»» en vez de crear otra. Es lo que evita las copias.
- Botón: «Crear y poner en N platos». Sale por el camino de publicación del §0.1.

### Tablero 6 · La ficha del extra (Kitchen › Extras)

- La pantalla Extras de hoy conserva su diseño aprobado. Gana el filtro «Todos / Los que cobran», y cada fila abre esta ficha.
- Extras **no pide decidir lo que no se puede vender**. Las opciones cuya pregunta no está en ningún plato activo no cuentan como pendientes: salen plegadas aparte («de platos retirados»). Hoy aparecen como si hubiera que arreglarlas, y Julio no sabía de dónde salían.
- Qué lleva: la respuesta (lleva, quita, es un plato o no lleva nada) y lo que lleva, con el mismo selector de Extras (ingrediente o plato, cantidad, unidad y coste en vivo). Vale para todas sus opciones.
- Cuando la pregunta obliga a elegir y la receta ya lleva otra de sus opciones: la nota «ahí sustituye, no se suma», con los platos.
- Dónde aparece: una fila por pregunta, con marca, precio, platos, ventas de N días y qué hace en el plato («Añade» o «Cambia la …»).
- Cómo lo reconoce Folvy en los pedidos: en HubRise, cuántas referencias; en Last, el código del extra.
- Los paneles «Agotado» e «Historial» llegan con la fase D. En C no se pintan (regla 35).

### Tablero 7 · Lo que llega y no cuadra (Kitchen › Modificadores)

- Cinco cifras:
  1. extras vendidos;
  2. cuántos descuentan (en %, cedidas y propias);
  3. sin decidir;
  4. Folvy no los conoce;
  5. enlazados por el nombre.
- Secciones, cada una con ventas, importe, «Qué ve Folvy» y un botón:
  1. Vendido y Folvy no lo tenía (`extra_desconocido`), agrupado por extra y marca, con la propuesta por nombre dentro de la marca. Botones: «Enlazar», «Enlazar y decidir» o «Buscar».
  2. Encontrado por el nombre, en una copia que no es (`fuzzy`). Botones: «Es la misma» o «Usar la suya».
  3. Nuevo en Last, sin decidir, agrupado por pregunta. Botón: «Decidir los N».
  4. Cambió en Last: nombre o precio, con el mismo código. Solo se apunta.
  5. Ya no está en Last (`deactivated_by = 'last'`, de A2c).
  6. Sin decidir, los que más se venden, ordenados por ventas.
- Confirmar «es este» enseña a Folvy el código. Se guarda la relación código → extra, `resolver_opcion_de_extra` la consulta, y la línea y las demás con el mismo código se enlazan hacia atrás con A4. **Es un cambio en la entrada de pedidos: se aplica fuera de la banda.**
- «Cambió en Last» necesita un registro: el importador apunta cada cambio de nombre o precio de una opción que manda Last en una tabla de cambios del extra. Es la misma tabla sobre la que la fase D construye el historial. Se crea aquí.
- Si una sección está vacía, lo dice. **«Nada en estos N días» no es lo mismo que no mirar.**

### Tablero 8 · Juntar copias

- Modal: «Juntar N «…» en un solo extra». Las opciones se quedan donde están, con su precio.
- Lo que dicen hoy: una fila por versión («0,2 bote de…», «Nada»), con copias y ventas. Se elige cuál se queda; sale marcada la que más se vende.
- Cómo va a descontar en cada pregunta: Folvy ha mirado la receta de cada plato. Si la pregunta es obligatoria y la receta lleva uno de sus extras, propone «Sustituye la …»; si no, «Añade». Se puede cambiar.
  - Si hay platos sin receta, se dice: descontará lo que lleva, pero el plato seguirá sin coste.
- Pie con la consecuencia en cifras: ventas que pasan a descontar, dónde deja de descontarse otra cosa, y la regla de Julio (coste en todo el histórico; almacén solo desde el último recuento aprobado).
- «Juntar las N»: la operación de juntar de la fase B, y después A4 regenera las ventas afectadas.

## §3 · Orden y paquetes

1. §0 medido.
2. **Paquete 1, «gestionar preguntas»:** tableros **1, 5, 3, 2 y 4**, con la franja del tablero 1 sin su botón. Capturas, visto de Julio y publicar. Es lo que Julio pide primero.
3. Paquete 2, «un extra, una ficha»: tablero 6 con el filtro de Extras, tablero 8, y el botón «Juntar» de la lista y de la ficha de pregunta.
4. Paquete 3, «lo que no cuadra»: tablero 7, el botón de la franja, la relación código → extra y el registro de cambios de Last. Toca la entrada de pedidos: se aplica fuera de la banda.

## §4 · Verificación

- Por paquete: captura a 1280 al lado de cada tablero, visto de Julio, publicación, y verificación mía en producción (Chrome) sin escribir.
- **La primera escritura real de cada paquete la hace Julio**, que es la prueba de que un administrativo puede:
  - Paquete 1: crear una pregunta en una marca propia y ponerla en sus platos. Yo compruebo en la base la pregunta, sus opciones apuntando a extras existentes y sus platos, y que sale publicada por HubRise.
  - Paquete 2: juntar las 11 «Salsa Tzatziki (Recomendada)». Yo compruebo que queda un extra, 11 opciones, y que en las pitas sustituye a la Yogur. Después, que las ventas regeneradas descuentan Tzatziki y dejan de descontar Yogur solo por encima del corte.
  - Paquete 3: enlazar una venta de «Vendido y Folvy no lo tenía». Yo compruebo el código aprendido, las líneas enlazadas hacia atrás y el aviso diario.

Build verde, lint igual o menor, pruebas de `lib/` con filas reales.

## §5 · Una cosa que el tablero no puede pintar como avería (añadido el 12/09)

Desde A4a, cada movimiento de consumo lleva la línea de venta de la que sale. Con
dos excepciones legítimas, y ninguna de las dos es un fallo:

- Los movimientos anteriores al corte por ingrediente los escribió el motor viejo y nunca tuvieron línea.
- Un movimiento congelado por el corte pierde su línea si la venta se reprocesa: las líneas se borran y se rehacen, y esa fila, por estar congelada, no se puede reescribir. El stock no se mueve.

Así que en los tableros, y en cualquier aviso:

- «sin procedencia» **solo por encima del corte**;
- por debajo, si hace falta decir algo, se dice lo que es: «de antes del corte», en gris, sin botón y sin alarma.
