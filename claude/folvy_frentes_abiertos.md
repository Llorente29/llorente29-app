# Frentes abiertos

Lo que se ha encontrado, se ha medido y NO se ha arreglado, con la razón por la
que no. No es una lista de deseos: cada entrada tiene su medida y su fecha, y
sale de aquí cuando se cierra o cuando Julio decide que no se cierra —y
entonces se mueve al registro de decisiones, no se borra.

Distinto de `folvy_registro_excepciones_ventana_20260901.md`, que guarda lo que
SÍ se hizo fuera de norma y qué enseñó.


## POR AQUÍ SE EMPIEZA LA PRÓXIMA (cerrado el 02/09)

Escrito en el repositorio a propósito: hoy dos cosas se salieron del contexto de
la conversación y hubo que pararse a recuperarlas. Esto no depende de ninguna
sesión.

**1 · Desplegar `offers-agent`.** El código YA está commiteado y lee
`agent_pause` (dos líneas, junto al bucle de `offers_agent_config`). Falta solo
el despliegue de la edge function. En cuanto esté, su fila del panel «Mis
agentes» cambia sola de «todavía no se puede pausar desde aquí» a interruptor
operativo — el panel ya está preparado y no hay que tocarlo.

**2 · Las tres tarjetas que faltan de las cinco**, por este orden:

| Tarjeta | De dónde sale | Estado del RECON |
|---|---|---|
| **Conteos pendientes** | `listInventoryCounts(accountId, locationId)` de `inventoryCountService` | Mirado. El criterio «sin cerrar» ya está escrito en `atencionService`: vivos son `contando` y `en_revision`; `aprobado` y `anulado` son finales |
| **Pedidos atascados** | el criterio lo define el vigía `hubrise-order-stuck-watchdog` | Sin mirar. Leer el vigía ANTES de escribir la consulta: el criterio de «atascado» ya existe y no se inventa otro |
| **Salud de conexiones** | `connectorService` (`listAccountConnectors`) + `hubrise-connection-health` | Sin mirar. Falta ver la forma de `AccountConnector` |

Las tres son de grupo Almacén / Canales y ya están declaradas como P2 en
`src/shell/home/cards/p2Cards.ts`: cablearlas es ponerles `component` y sacarlas
de esa lista. La prueba del catálogo pasará de «8 y 13» a «11 y 10» — y hay que
actualizarla, que es justo el despiste que costó una prueba roja empujada hoy.

**Lo que NO toca todavía:** «% personal sobre ventas» y «Puntos de pedido»
(frentes 9 y 10). Están DECIDIDOS pero no construidos, y el 10 tiene cinco
guardas que hay que leer enteras antes de escribir la primera línea.

---

## 1 · «Salsa Tzatziki» sale siete veces en el panel de opciones agotadas
**Abierto:** 02/09/2026 · **Medido en Foodint Alcalá**

Las nueve opciones de modificador agotadas del 01/09 son, leídas por una
persona, **dos**: «Salsa Tzatziki (Recomendada)» ×7 y «Base Ternera (Premium
Selection)» ×2. El panel agrupa por `external_id` y cada una tiene el suyo, así
que salen nueve tarjetas y siete dicen lo mismo.

**Por qué importa:** siete filas idénticas hacen que nadie sepa cuál pulsar. Es
el mismo problema que tenía la milanesa en la pantalla de productos el 01/09,
que se resolvió agrupando — aquí falta el equivalente.

**Por qué no se toca ahora:** el 01/09 la decisión fue agrupar por `external_id`
justamente para que el 86 funcionara por local. Cambiar la agrupación de las
opciones sin volver a mirar cómo se despacha a HubRise es cómo se rompe un 86
que hoy funciona. Necesita su propio RECON.

---

## 2 · El fichero de tipos ha divergido de la base — PRIORIDAD ALTA
**Abierto:** 02/09/2026 · **Subido de prioridad el mismo día, tras morder dos veces**

Ya no es una deuda teórica. El 02/09 **impidió escribir un filtro por cuenta**,
que es la regla 9, y obligó a parchear tres tablas a mano.

**Y el parche manual es el problema, no la solución.** Cada uno es una
divergencia más entre el fichero y la base, y el día que alguien regenere se
los lleva por delante sin enterarse: el build volverá a fallar donde hoy
compila, y quien lo regenere no tendrá forma de saber qué se acaba de perder.
Los parches de hoy están anotados aquí precisamente para que ese día se sepa
qué había.

Se puede llamar a una función que no existe y descubrirlo en producción. Hoy
solo dos rompieron el build —`kitchen_archive_item` y `kitchen_unarchive_item`—
y fue por casualidad: solo `recipeItemService` está tipado en estricto. Las
otras 21 pasan sin que nadie se entere.

### La cuenta de mordeduras de hoy

| Cuándo | Qué pasó |
|---|---|
| 02/09 mañana | `kitchen_archive_item` y `kitchen_unarchive_item` rompen el build |
| 02/09 tarde | `schedules`, `employees` y `vacations` sin `account_id`: **el filtro de cuenta no compila**. Parcheadas a mano las tres (Row/Insert/Update) |
| 02/09 tarde | `employee_clock_status` no está entre las RPC tipadas. Se resuelve con `src/lib/rpcSinTipar.ts`, un puente ÚNICO y borrable, para no seguir divergiendo el fichero generado |
| 02/09 tarde | `shift_templates` y `clock_entries` tampoco tienen `account_id` en el fichero. Aquí NO se parcheó: se acotaron las consultas por los ids de local y de empleado que ya se tenían, que además es **más estrecho** que filtrar por cuenta. Cuando se pueda acotar así, es mejor que un parche |
| 02/09 tarde | `home_layout` no está **entera** en el fichero (se creó el 30/08, después de generarlo). No hizo falta parchear: `homeLayoutService.ts` ya tenía su propio puente local `tabla()` para las cuatro tablas `home_*`, y la columna nueva entra por ahí. Tercer caso en que la primera opción del criterio evita el parche |

### El criterio mientras tanto (aprobado el 02/09), en este orden

1. **Acotar por los ids que ya se tienen** es la PRIMERA opción. Pedir «los
   fichajes de estos seis empleados» es más estrecho que «los de esta cuenta»,
   no toca el fichero generado y no deja deuda.
2. **`src/lib/rpcSinTipar.ts`**, solo donde no hay alternativa: una RPC que no
   está tipada y que no se puede sustituir por una consulta acotada.
3. **Parchear el fichero de tipos a mano es el ÚLTIMO recurso**, y cada vez que
   se haga se anota en la tabla de arriba, porque una regeneración se lo lleva
   sin avisar.

**Las dos salidas, y hay que elegir una:** o el fichero se regenera de verdad
con el CLI (`npm run gen:types`, necesita token de Supabase), o el chequeo
estricto se extiende a los demás servicios.

**Mordió el 02/09:** `schedules`, `employees` y `vacations` tienen `account_id`
en la base —verificado en `information_schema`— y NO lo tenían en el fichero de
tipos, así que filtrar por cuenta no compilaba. Se parchearon esas tres tablas a
mano (Row/Insert/Update) en vez de quitar el filtro: la BBDD es la verdad y la
regla 9 no se negocia por un fichero desactualizado. Quedan 20 RPC y las demás
tablas por revisar.

**Aviso para quien lo haga:** regenerar con el generador del MCP NO es
equivalente. Produce 202 errores en 26 ficheros (`RejectExcessProperties`,
`account_id` obligatorio en los Insert) porque es una versión más nueva que la
del CLI con el que se generó el fichero del repo. Eso es una migración de
generador, no una regeneración, y va aparte.

---

## 3 · Un despliegue fallido no avisa por ningún canal que alguien lea
**Abierto:** 02/09/2026 · **Se quedó a medias**

El 02/09 hubo **cuatro despliegues a producción en ERROR** y tres del APK/OTA
durante veinte minutos, y se descubrió porque Julio se quejó de que no veía una
pantalla. Sí hubo correos —cinco— pero llegan al mismo buzón que los 96 diarios
de cierres de marca.

**Lo construido:** nada todavía. Se empezó y se paró para atender el Inicio. El
diseño al que se había llegado: un workflow que escuche `workflow_run` de las
dos cadenas de Actions y `deployment_status` de Vercel, y encole por
`_queue_system_alert` con debounce por cadena.

**Lo que apareció montándolo y sí se arregló:** `_queue_system_alert` era
ejecutable por `anon` y por `authenticated`. Cerrado el 02/09 en las
migraciones `T0640` y `T0650`.

**La parte que no es técnica, y es la que decide si esto sirve:** un aviso más
en un buzón que nadie lee no arregla nada. Julio: *«cada aviso que dejamos en
pie sin que nadie lo lea le quita valor al siguiente»*.

---

## 4 · El cajón del Inicio agrupa por módulo y la maqueta agrupa por negocio
**Abierto:** 02/09/2026 · **Va en el sub-lote del cajón**

Los seis grupos aprobados —Ventas, Team, Cocina, Almacén, Canales, Agentes— son
el idioma del negocio. El cajón agrupa por el módulo donde vive el código, así
que la tarjeta del 86 saldría bajo «Folvy Kitchen» en vez de «Canales».

**Decidido:** el grupo pasa a ser un atributo declarado de cada tarjeta, no el
módulo que la aporta. Pendiente de ejecutar.

---

## 7 · `assigned_locations` no cuenta para «en cocina ahora» ni para cuadrantes
**Abierto:** 02/09/2026 · **Deuda declarada, hoy no cambia nada**

Las dos tarjetas de Team agrupan por `employees.location_id`, la ficha del
empleado. Existe además `assigned_locations`, para quien trabaja en más de un
sitio.

**Con la plantilla de hoy —seis personas, cada una en un local— no cambia nada.
El día que alguien trabaje en dos locales, sí:** aparecerá contado solo en el
suyo de ficha, y el otro local dirá que tiene menos gente de la que tiene.

---

## 5 · El huso está fijado a Madrid en vez de salir de `accounts.timezone`
**Abierto:** 02/09/2026 · **No molesta hoy; con cliente fuera de España, sí**

`set_at`, `sold_at` y todo lo demás están en UTC (regla 4). Para contar días
naturales o cortar un día de ventas hay que convertir a la hora del negocio, y
ahora mismo eso está escrito como la constante `'Europe/Madrid'` en
`src/lib/fechas.ts`.

**Por qué no es un detalle:** `accounts.timezone` YA EXISTE y ya lo usa
`sales_dashboard` —`coalesce(timezone, 'Europe/Madrid')`—, así que hoy conviven
dos criterios: el servidor pregunta a la cuenta y el front supone Madrid. Con
todos los locales en Madrid dan lo mismo y nadie lo nota; con un cliente en
Canarias son una hora, y el 31 de diciembre eso es un día entero y un cierre
contable.

**Lo que hace falta:** que la cuenta activa exponga su huso al front —hoy no
viaja en el contexto— y que `src/lib/fechas.ts` lo reciba en vez de suponerlo.
La constante está en UN solo fichero a propósito, para que ese día sea un
cambio y no una búsqueda.

**De dónde sale:** de arreglar el conteo de días del 86 el 02/09, donde el
cálculo por horas transcurridas daba 4 y la base decía 5.

---

## 6 · Tablets de cocina: el aviso funcionaba y nadie lo leyó
**Abierto:** 02/09/2026 · **Cerrado el incidente, abierto el frente**

Del 27/08 al 01/09 la tablet «Cocina» de Alcalá estuvo cinco días fuera. Causa
real: **perdió su token**. Ninguna de las tres hipótesis que se barajaron —red,
runtime congelado, token compartido— era la buena. En cuanto se revinculó cogió
los 45 bundles pendientes de una vez, así que el bucle de versión nunca estuvo
roto. Hoy las tres tablets están en el bundle 230 y latiendo.

### Lo que se midió antes de decidir el orden

| | |
|---|---|
| Avisos `kds_device_silencio` del 27/08 al 02/09 | **28** |
| De ellos, **entregados** | **28** (`sent_at` en todos) |
| Primer aviso | 27/08 **13:25** (la tablet llevaba 13 min callada) |
| Qué decía | nombre de la tablet, local, minutos, versión **y el remedio** |
| Avisos sin enviar | 0 |

El aviso decía literalmente: *«La tablet "Pase" del local Foodint Alcalá lleva 13
minutos sin dar señal de vida, en horario de servicio. […] Si la pantalla pide
vincular, apagar y encender la tablet suele bastar.»*

**El sensor funcionó, el mensaje era bueno y la entrega también.** Lo que falló
es que el aviso llegó a un sitio donde nadie lo mira. Veintiocho veces.

### Por qué esto reordena las tres piezas

La pieza que parecía primera —que `kds_heartbeat` registre los tokens
desconocidos en vez de devolver `false` y tirar la evidencia— **no habría
acortado los cinco días**: habría añadido detalle a un aviso que ya se estaba
mandando y ya se estaba ignorando. Sigue mereciendo la pena, pero es la tercera.

**Orden propuesto:** (1) que el aviso llegue a alguien que actúe — es el mismo
problema que el frente 3, y un solo arreglo sirve para los dos; (2) el código
corto de seis dígitos, que es lo que convierte la próxima caída de días en
minutos, porque hoy revincular en pleno servicio es imposible: «Escanear» no
puede pedir cámara en la APK y la alternativa es teclear cincuenta caracteres;
(3) registrar el token desconocido con su hora; (4) averiguar por qué se
desvinculó sola.

**Dato para (4), CORREGIDO el 02/09 — el error era mío y era la regla 4.** Dije
que la desvinculación no cuadraba con las 20:26 que daba `last_seen_at`. Cuadra:
el aviso saltó a las 18:40 UTC diciendo «13 minutos», o sea callada desde las
18:27 **UTC**, que son las **20:27 de Madrid**. `last_seen_at` = 18:26:50+00 =
20:26 de Madrid. **El mismo instante.** Resté minutos a un `created_at` en UTC y
lo escribí como si fuera hora de reloj — en la misma ficha en la que estaba
siendo cuidadoso con todo lo demás, y el día de escribir `src/lib/fechas.ts`
para que esto no pasara en las tarjetas.

Lo que sí se sostiene: fueron DOS aparatos. «Pase» calló a las **15:12 de
Madrid** y «Cocina» a las **20:26**. La ventana a investigar para los cinco días
es la de Cocina: 27/08, 20:26 de Madrid.

**Y un fallo real en la vecindad, que apareció al comprobarlo:** el aviso no
escribe NINGUNA hora, solo una duración —«lleva 13 minutos»—. Leído en el
momento, perfecto; leído tres horas después en una pila de correos, es inútil:
no se puede saber cuándo empezó sin mirar la cabecera del correo. Añadirle la
hora local del negocio («sin señal desde las 20:26») es una línea, y va con el
mismo criterio de `fechas.ts`. Entra en la pieza (1).

**EL DESTINO DEL AVISO, decidido por Julio el 02/09 y mejor que la propuesta
anterior:** el arreglo NO es mandarlo a otro correo. Es que el aviso viva en la
**franja del Inicio**, que es la pantalla que ya se mira. El correo es para
cuando no hay nadie delante; la franja, para cuando sí. La prueba de que
funciona: «la tablet Cocina lleva 5 días sin dar señal» llegó por la franja, no
por el correo.

**Y una pieza de la (2) que cuesta minutos y se puede hacer aparte:** que el
botón «Escanear» no esté cuando la cámara no puede funcionar. Un botón que no
puede cumplir es peor que ningún botón.

---

## 8 · `availability_event` no guarda el local en el 84 % de los cierres de marca
**Abierto:** 02/09/2026 · **El historial de disponibilidad no responde por local**

Foodint se opera POR LOCAL. Un historial de disponibilidad que no sabe en qué
local pasó cada cosa no responde a la única pregunta que se le hace.

### Medido sobre todo el histórico de Foodint

| scope | eventos | sin local | último nulo | último evento |
|---|---|---|---|---|
| **brand** | 62 | **52 (84 %)** | 29/08 | 02/09 |
| product | 810 | 20 | 31/08 | 02/09 |
| modifier_option | 10 | 0 | — | 01/09 |
| location | 10 | 0 | — | 02/09 |

**Lo que costó hoy:** la línea del porqué de la tarjeta «Ventas · esta semana»
tuvo que descartar 19 de los 28 eventos de las dos últimas semanas. Sin local
no se puede decir «en los dos locales» sin suponer a cuáles afectó, y suponer
es inventar. La frase literal de la maqueta —«El martes Meraki Pita estuvo
cerrada en los dos locales»— no es reproducible con este historial.

### Dos matices que cambian el trabajo, y hay que decirlos

1. **En `product`, un `location_id` nulo puede ser LEGÍTIMO.** En
   `product_availability`, null significa «todos los locales» —la tienda lo lee
   así: `(pa.location_id = p_location_id or pa.location_id is null)`—. Así que
   los 20 nulos de product no son necesariamente un fallo. Los de **brand** sí:
   `_set_brand_closure_core` recorre `p_location_ids` y escribe SIEMPRE un
   local, así que un nulo ahí viene de otro camino de escritura.

2. **Parece tapado desde el 30/08**, pero NO está confirmado. Los 10 eventos de
   marca posteriores al 29/08 llevan local. Eso es compatible con que se
   arreglara el camino… y también con que nadie lo haya usado desde entonces.
   Diez eventos en cuatro días no distinguen una cosa de la otra.

### Lo que hay que hacer, en este orden

1. **Averiguar qué camino escribe `scope='brand'` sin local**, y si sigue vivo.
   `_set_brand_closure_core` no es: hay otro, probablemente el anterior al
   30/08. Mientras no se sepa cuál, no se puede decir que esté tapado.
2. **Taparlo**, o —si el nulo tiene que significar «todas» también en brand—
   escribirlo explícito y documentarlo, para que el historial sea legible sin
   adivinar.
3. **Los 52 eventos ya escritos no se recuperan.** Esa parte del historial está
   perdida y conviene saberlo antes de construir un informe encima.

---

## 9 · «% personal sobre ventas» — DECIDIDO: coste de empresa
**Abierto:** 02/09/2026 · **Decidido por Julio el 02/09** · Pendiente de construir

**La decisión:** el coste es **coste de empresa** — `salary` + `employer_ss_annual`
— no el salario bruto.

**Sus palabras, que son la regla:** *«el bruto es engañar en silencio»*. No es
una preferencia contable: entre uno y otro hay del orden de un 30 %, y con ese
número se decide si se contrata. Un panel que enseña el bruto no da un número
menos preciso: da un número que dice que el negocio va mejor de lo que va, y no
avisa de que lo está diciendo.

**Y la tarjeta DICE CUÁL USA.** No solo el porcentaje: el subtítulo lleva «coste
de empresa». Una cifra de la que hay que preguntar cómo está hecha ya ha fallado
— si hay que preguntar, la respuesta llega tarde o no llega.

**Lo que queda por construir (4 h):** horas de `clock_entries` × coste/hora
desde `employees`, contra ventas de `sale`, en el día del negocio.

---

## 10 · «Puntos de pedido» — DECIDIDO: lo calcula el sistema, del consumo
**Abierto:** 02/09/2026 · **Decidido por Julio el 02/09** · Pendiente de construir

**La decisión:** el punto de pedido lo **calcula el sistema** a partir del
consumo, y **se recalcula solo**. No un campo que alguien rellena artículo a
artículo.

### EL PRINCIPIO QUE MANDA SOBRE TODO LO DEMÁS

**El sistema PROPONE, no pide solo.** El día que esto dispare un pedido
automático, la decisión de Julio del 02/09 fue **«que lo calcule»**, no **«que
compre»**. Quien lea esta ficha dentro de seis meses y esté a punto de cablear
un pedido automático: eso es una decisión nueva, y no está tomada.

### Las cinco guardas

**1 · Los días agotados NO cuentan en el consumo medio.** Sin esto el cálculo se
muerde la cola: cada rotura baja el consumo medio, el punto de pedido baja con
él, y el punto bajo provoca la siguiente rotura. Un sistema que aprende de sus
propios fallos a equivocarse más.

> **CORRECCIÓN DE LA FUENTE, medida el 02/09 antes de escribir esto.** El
> encargo decía «tienes `product_availability` con sus fechas». **No sirve para
> esto:** esa tabla tiene 106 filas y **las 106 con `is_available = false`**. Es
> una tabla de ESTADO ACTUAL — la fila existe mientras el producto está agotado
> y se borra al reactivarlo, igual que `brand_closure`. Solo sabe decir qué está
> agotado AHORA y desde cuándo; no puede decir que la Coca-Cola estuvo agotada
> el 14, 15 y 16 de agosto si hoy está disponible.
>
> **La fuente buena es `availability_event`**, que sí guarda cierres Y
> aperturas: 810 eventos de producto, el más antiguo del **05/08**.
>
> **Y eso pone un techo que hay que saber:** el historial de agotados llega a
> unas cuatro semanas. Más atrás no se puede excluir nada, y hay que decirlo en
> vez de calcular como si esos días hubieran sido normales.

### El techo, explicado (medido el 02/09)

**Es el caso bueno: el techo se despega solo.** La tabla no existía, no es que
se dejara de registrar.

| | |
|---|---|
| `availability_event`, creada por | `20260731T1000_availability_event.sql` |
| `location_status_log`, creada por | `20260730T1610_location_status_log.sql` |
| Primer evento en la base | **30/07/2026** |
| Eventos hoy | 892 |

Las dos tablas empiezan el mismo fin de semana porque **se crearon entonces**.
Antes del 30/07 no hay historial de disponibilidad de ninguna clase, y no
porque un camino de escritura se lo saltara: porque no había dónde escribirlo.

**Consecuencia práctica:** el horizonte crece un día por día. Hoy son ~5
semanas; en un mes serán ~9 y deja de molestar para un cálculo de consumo. No
hay nada que arreglar aquí — solo que decirlo mientras sea corto.

**Y NO ES EL CASO MALO**, que sí habría sido un frente: no hay un camino de
escritura que siga sin registrar. Eso es otra cosa y ya tiene ficha: el
**frente 8** —`location_id` nulo en el 84 % de los eventos de marca— sí afecta a
la CALIDAD de este historial, aunque no a su longitud.

### ¿Alguien poda `availability_event`? NO (medido el 02/09)

Un dato que se borra solo no puede ser la base de una decisión de compra, así
que se comprobó antes de apoyar nada encima:

- **Ninguna función** de `public` contiene `delete from availability_event` ni
  `delete from location_status_log` ni un `truncate` sobre ellas.
- **Ningún `cron.job`** las toca. El único trabajo de limpieza programado es
  `cleanup_auth_rate_limits_daily`, que es de los límites de intentos de login.

**El historial se acumula.** Si algún día se añade una poda —por tamaño, que es
la razón habitual— hay que saber que este cálculo depende de ella: podar a 90
días deja el punto de pedido sin la temporada anterior. Queda dicho aquí para
que quien la escriba lo lea antes.

**2 · Esos días se IMPUTAN, no se ponen a cero.** Con la media del mismo día de
la semana en fechas con existencia. Es demanda censurada: que no se vendiera un
sábado agotado no significa que nadie lo quisiera, significa que no había.

**3 · Las roturas cuentan como señal propia.** N roturas en 30 días suben el
punto de pedido **aunque la media no lo pida**. La media dice cuánto se gasta;
las roturas dicen que el colchón era corto, y eso es información distinta.

**4 · El plazo de entrega se MIDE por proveedor**, de la fecha del pedido a la
del albarán. No un número fijo igual para todos: un proveedor que tarda cuatro
días necesita más colchón que uno que trae al día siguiente, y eso está en los
datos.

**5 · Mínimo manual por artículo que el cálculo NUNCA puede bajar.** Es la
válvula: donde alguien sabe algo que los datos no saben, gana la persona.

### Lo que la tarjeta tiene que decir de sí misma

**Con cuántos días de historia ha calculado, y si hubo roturas en el periodo.**
Un punto de pedido salido de tres días no vale lo mismo que uno de treinta, y
uno salido de una racha de agotados no vale lo mismo que uno de un mes limpio.
Quien lo lee tiene que poder distinguirlos sin preguntar.

**Y MIENTRAS EL TECHO SEA CORTO, LA TARJETA DICE EL TECHO, no solo los días.**

> «Calculado sobre 28 días, **que es todo el historial disponible**»

dice algo muy distinto de «calculado sobre 28 días». Lo primero avisa de que no
hay más y de que el número mejorará solo; lo segundo deja creer que 28 fue una
elección, y que alguien podría haber pedido 90. Cuando el historial pase de
largo de la ventana que se use, la coletilla sobra y se quita.

**Y lo estacional y lo de poca rotación se MARCAN, no se calculan a la brava.**
Si el consumo es irregular, la tarjeta lo dice en vez de dar un número con cara
de certeza. Un número con cara de certeza sobre un dato que no la tiene es peor
que no dar número.


---

## 11 · Un despliegue que no despliega nada sale verde y no lo dice
**Abierto:** 02/09/2026 · **Del mismo patrón que todo lo de hoy**

El 02/09 a las 19:xx se lanzó el workflow de despliegue sobre `fa24539f`.
**Verde en 8 segundos, sin desplegar ninguna función** — y el resumen del run no
lo dijo. Ocho segundos y un tick verde se leen como «desplegado».

**Esta vez el final fue bueno:** `offers-agent` ya estaba en v54, desplegada a
las **18:51:05** por el workflow del commit anterior (`e147d57c`, 27 segundos
antes). El paso que decide qué funciones se despliegan hizo lo correcto — no
había nada nuevo — pero lo comunicó como un éxito indistinguible de un
despliegue real.

**Es la regla 8 en el CI:** un paso que hace algo importante confirma o falla
**con contenido**. «Verde» no dice si desplegó cinco funciones, una o ninguna, y
esta misma mañana ya costó una confusión con `hubrise-webhook`.

**Lo que hay que hacer:** que el resumen del run diga **qué funciones desplegó,
por nombre — o «ninguna»**. Es una línea en el step summary, y convierte un tick
mudo en un parte.

**Detalle para quien lo arregle:** el origen del despliegue se puede leer en el
`entrypoint_path` de la función. Las desplegadas por CI llevan
`/home/runner/work/...`; las desplegadas a mano, `/tmp/user_fn_...`. Sirve para
auditar después quién desplegó qué sin depender de los logs del run.

---

## 12 · La bolsa de horas ignora el día de cierre configurado — y son nóminas
**Abierto:** 02/09/2026 · **Hoy cosmético. El día que alguien cambie el día, no.**

### El mecanismo, exacto

`getEffectiveCloseDay` decide así:

```
if (config.syncWithGestoria && config.gestoriaDay) return config.gestoriaDay
return config.closeDay
```

Y las dos pantallas que lo llaman construyen el config así:

```
closeDay:    (location as any).hoursBalanceCloseDay ?? 25   ← se lee BIEN
gestoriaDay: (location as any).gestoriaSendDay      ?? 25   ← NO EXISTE, siempre 25
syncWithGestoria: … ?? true                                 ← true en los 7 locales
```

**`gestoria_send_day` no existe en `locations`, ni en el tipo, ni en el mapper.**
Comprobado el 02/09. Así que `gestoriaDay` es SIEMPRE `25` —un número, o sea
verdadero— y con `syncWithGestoria` en true la primera rama gana siempre:

> **`getEffectiveCloseDay` devuelve 25 SIEMPRE, y el `closeDay` bien leído se
> tira a la basura.**

Lo irónico: `hoursBalanceCloseDay` **sí** está bien mapeado
(`supabaseSync.ts:61`). El campo se lee correctamente de la base y luego se
descarta. La pantalla parece configurable y no lo es.

### La cifra, que es la que decide

| Cuenta | Local | `hours_balance_close_day` | Sincroniza |
|---|---|---|---|
| Foodint | Alcalá | 25 | sí |
| Foodint | Carabanchel | 25 | sí |
| Foodint | Plaza Castilla | 25 | sí |
| Kitchen Grill LstQ | Kitchen Grill | 25 | sí |
| Folvy Interno | los tres | 25 | sí |

**Los siete locales están en 25.** Así que HOY no hay ni un saldo mal calculado:
el defecto coincide con el valor real en todas partes. **Es cosmético.**

**Y es un arma cargada.** El día que alguien ponga 31 en un local, la pantalla
seguirá calculando con 25 y nadie se enterará, porque el `as any` se tragó el
error que lo habría avisado. Los saldos de horas acaban en nóminas.

### Dónde está, y una divergencia que ya existe

- `src/pages/BolsaHorasPage.tsx:111`
- `src/components/MiBolsaHoras.tsx:69` — **la del empleado**, que es peor: es la
  que ve el trabajador de sus propias horas.

Y la tarjeta nueva del Inicio (`src/modules/personal/home/bolsaHoras.ts`) NO
tiene el fallo: usa `gestoriaDay = closeDay`, así que respeta el día
configurado. **El día que alguien cambie el día de cierre, la tarjeta y la
pantalla darán saldos distintos de las mismas horas.** Arreglar las dos
pantallas cierra también esa divergencia.

### El arreglo

Quitar `gestoriaDay` de los dos sitios —o dejarlo en `undefined`, no en 25— para
que `getEffectiveCloseDay` caiga a `closeDay`. Es una línea en cada uno. Lo que
NO se puede hacer es dejar el `?? 25`: ese valor por defecto es justo lo que
convierte un campo que no existe en una decisión silenciosa.

---

## 13 · El `as any` que hizo posible el frente 12
**Abierto:** 02/09/2026 · **Misma familia que el frente 2, y peor**

`(location as any).gestoriaSendDay` compila, se ejecuta y devuelve `undefined`
para siempre. Sin el `as any`, TypeScript habría dicho que ese campo no existe
en `Location` — que es exactamente lo que pasaba y lo que nadie supo durante
meses.

**Es la misma familia que los tipos desactualizados del frente 2, pero peor:**
allí el fichero se quedó viejo solo, por no regenerarlo; **aquí el desvío está
escrito a mano**, deliberadamente, y silencia el aviso en el punto exacto donde
hacía falta.

**La regla que sale de esto:** un `as any` sobre una fila de la base no es un
atajo de tipos, es apagar la única comprobación que hay de que ese campo existe.
Si hace falta leer un campo que el tipo no tiene, el camino es el criterio del
frente 2 —acotar, puente único, o parche anotado— y NUNCA un `as any` en el
sitio de lectura.

**Deuda medible:** hay 16 errores de `@typescript-eslint/no-explicit-any` vivos
en `src/modules/ventas/services` (channelRates, foodCost, licensed, trend). No
son del Inicio y no se han tocado, pero son del mismo patrón y conviene mirarlos
antes de que uno de ellos esconda otro campo fantasma.
