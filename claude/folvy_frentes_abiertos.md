# Frentes abiertos

Lo que se ha encontrado, se ha medido y NO se ha arreglado, con la razón por la
que no. No es una lista de deseos: cada entrada tiene su medida y su fecha, y
sale de aquí cuando se cierra o cuando Julio decide que no se cierra —y
entonces se mueve al registro de decisiones, no se borra.

Distinto de `folvy_registro_excepciones_ventana_20260901.md`, que guarda lo que
SÍ se hizo fuera de norma y qué enseñó.


## POR AQUÍ SE EMPIEZA LA PRÓXIMA (cerrado el 02/09, noche)

El mosaico está **completo salvo una**: veinte tarjetas cableadas de veintiuna.

**La que falta es «Puntos de pedido», y falta a propósito** — frente 10. No es
que no haya dado tiempo: Julio decidió que el punto lo CALCULA el sistema desde
el consumo, y el consumo fiable empieza el 30/07. Con cinco semanas de
histórico, un punto de pedido calculado sería una media de agosto disfrazada de
criterio. Se cablea cuando haya dos o tres meses. Quien la coja antes creyendo
que «solo falta enchufarla» está cogiendo el frente 10, no una tarjeta.

**Cerrados el 02/09 por la noche:** el **14** (el food cost estaba inflado:
27,4 % era 22,3 %, y el diagnóstico que traía el frente era el equivocado), el
**15** (`list_costless_sold_products` retirada), el **17** (renombrada a
«Vendido sin coste», con la clave intacta) y el **19** (F0.5 aplicada, con las
dos que la auditoría de agosto había dejado fuera de su alcance).

**Dos frentes cambiaron de diagnóstico al medirlos, y los dos los había escrito
yo:** el 14 proponía un `where` que habría BAJADO el food cost 4,6 puntos
borrando coste real, y el 16 pedía construir un motor que ya estaba escrito. En
los dos casos la medida previa era correcta y la conclusión estaba invertida.

**Lo que sí está esperando decisión de Julio**, y en este orden de coste:

| # | Qué | Coste |
|---|---|---|
| 16 | **El motor ya existe.** Lo roto es el barrido nocturno, que no puede ver un combo: 131 combos y 3.338 € reparables con un `where`. Escribe datos, así que decides tú | Un `where` + backfill |
| 18 | Las tres pantallas de Ventas no leen la URL, así que el drill del bloque del dinero va sin filtro de local | Tres pantallas |
| 21 | La rama `> 60` de la bandera «sospechoso» no puede encenderse. Propuesta: bajarla a 40 % | Un número, tuyo |
| 16b | 265 componentes de combo sin casar dejan 263 combos (5.074 €) sin costear, y ahí el motor hace bien en negarse | Trabajo de catálogo |

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

## 9 · «% personal sobre ventas» — CONSTRUIDA, pero SIN EL DATO PARA CALCULAR
**Decidido y construido el 02/09** · **Bloqueado por un campo vacío en la plantilla**

> **Los SEIS empleados activos de Foodint tienen `employer_ss_annual` a NULL.**
> Ninguno. Y uno —Keilymar— tiene además `salary` a 0.

La tarjeta está hecha y enchufada, y **no da número**: dice qué falta y a quién.
En cuanto alguien rellene la seguridad social de la plantilla, empieza a
funcionar sola, sin tocar código.

**Por qué no se rellenó con el bruto y ya:** habría salido un porcentaje del
orden de un 30 % más bajo del real, o sea diciendo que el negocio va mejor de lo
que va — y con ese número se decide si se contrata. Es literalmente lo que Julio
prohibió. Estimar la seguridad social con un porcentaje típico era la otra
salida y es peor: inventar un dato y darle cara de medido.

**Y basta UNO sin dato para invalidar el porcentaje:** sumar el coste de cinco
personas y dividirlo entre las ventas de seis da un número más bajo que el real,
y más bajo es justo la dirección que engaña.

**Lo que hay que hacer para desbloquearla:** rellenar `employer_ss_annual` (y el
`salary` de Keilymar) en la ficha de cada empleado. Es dato de gestoría, no de
desarrollo.

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

**Cómo está hecha:** horas de `team_worked_shifts` —la fuente canónica, para no
dar dos cifras distintas de las mismas horas— × coste/hora desde `employees`,
contra ventas de `sale`, en la semana del negocio. `salary` y
`employer_ss_annual` son ANUALES: 22.589,76 € con 40 h/semana es un salario de
convenio al año.

---

## 10 · «Puntos de pedido» — DECIDIDO, y DELIBERADAMENTE APLAZADO
**Decidido el 02/09** · **NO SE CONSTRUYE TODAVÍA, y esto no es un olvido**

> **NO LA COJAS CREYENDO QUE ESTÁ LISTA.** Está decidida y sus guardas están
> escritas, pero construirla hoy es construir algo que empieza a servir dentro
> de un mes.
>
> **La razón, medida:** el historial de agotados arranca el 30/07 (ver más
> abajo). Con cinco semanas, la guarda 1 —excluir los días agotados del consumo
> medio— apenas tiene de dónde excluir, y la tarjeta llevaría puesta casi todo
> el rato la coletilla «calculado sobre 28 días, que es todo el historial
> disponible». Un punto de pedido así sale flojo y con cara de provisional.
>
> **Cuándo cogerla:** cuando el historial dé para dos o tres meses. Entonces la
> misma tarjeta, con el mismo código, sale sólida. El techo se despega solo.

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

## 12 · La bolsa de horas ignoraba el día de cierre — ARREGLADO el 02/09
**Abierto y cerrado el 02/09/2026** · Se deja la ficha porque explica un patrón

> **La pantalla parecía configurable y no lo era.**
>
> Ese `?? 25` no era un valor por defecto: era **una decisión tomada en silencio
> sobre las horas de la gente** — y una de las dos pantallas es la que el
> trabajador abre para ver las suyas.

**El arreglo (02/09):** `gestoriaDay: undefined` en `BolsaHorasPage.tsx:111` y
en `MiBolsaHoras.tsx:69`. Dos líneas, y `getEffectiveCloseDay` vuelve a hacer lo
que dice su nombre: coger el `closeDay` del local. Con eso desaparece también la
divergencia con la tarjeta del Inicio.

**Lo que sigue abierto de esto:** nada en el código. Pero la ficha se queda,
porque el mecanismo de abajo es el que hay que reconocer la próxima vez.

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


## 14 · El food cost estaba inflado — RESUELTO el 02/09, y el diagnóstico era otro
**Abierto y cerrado el 02/09** · **Migración `20260902T2200_food_cost_denominador_por_unidad.sql`**

### Lo que este frente decía, y por qué estaba mal

Decía: «mete líneas de `modifier` y de `combo_item` en el denominador; se
arregla con `and coalesce(sl.line_type,'product')='product'` y la cobertura sube
de 71,4 % a 88 %». Se midió antes de aplicarlo, como manda la regla 5, y salió
lo contrario de lo previsto:

```
food cost   27,4 %  ->  22,8 %     BAJA 4,6 puntos
```

Porque las líneas que iba a quitar **no son gratis**: 1.411 de las 2.862 tienen
receta costeada y aportan **2.880 € de coste real** contra solo 400 € de
ingreso. Ese `where` habría borrado 2.880 € de comida de verdad del numerador.

**Un cambio que hace BAJAR el food cost es un cambio que dice que el negocio va
mejor de lo que va.** Es el error que aprueba, el mismo patrón del frente 15. Y
lo escribí yo en este fichero por la mañana, con una tabla y todo. La tabla era
correcta; la conclusión que saqué de ella, no.

*(El «88,0 %» que puse aquí tampoco valía: lo medí sobre `sale_line.computed_cost`
y esta RPC define «costeada» por `recipe_item.computed_cost`. Dos definiciones
distintas comparadas como si fueran la misma.)*

### El fallo de verdad

Un combo se parte en varias `sale_line`: una PADRE de tipo `product` y varias
HIJAS de tipo `combo_item`. **El dinero y el coste no viven en la misma:**

- El **precio** va en la padre. Medido: **581 de los 605 combos** vendidos en 30
  días (**13.229 €**) lo ponen ahí; solo 22 (421 €) lo ponen en las hijas. Y la
  padre no tiene `recipe_item`, porque un combo no lleva escandallo propio.
- El **coste** va en las hijas, que sí tienen receta.

La función agrupaba por LÍNEA y filtraba los dos sumatorios por `costed`:
**metía el coste de las hijas en el numerador y tiraba el ingreso de la padre
del denominador.** El food cost de todos los combos se dividía entre un
denominador que no incluía lo que los combos facturan.

### La corrección y lo que movió

`unidad = coalesce(parent_sale_line_id, id)`. El numerador no se toca —16.439 €,
el mismo euro por euro—; el denominador recupera los 13.229 € que se tiraban.

| | antes | después |
|---|---:|---:|
| cobertura | 71,4 % | **95,2 %** (96,6 % por dinero) |
| food cost | 27,4 % | **22,3 %** |
| ingreso base | 59.894 € | 73.591 € |
| food cost € | 16.432 € | 16.439 € |

Y por marca, que es donde de verdad dolía — estas cifras deciden qué marca se
mira y cuál se cierra:

| Marca | antes | después |
|---|---:|---:|
| Ay Mamita Bowls | 46,3 % | **18,9 %** |
| Deep Pizza | 78,6 % | **32,9 %** ← estaba marcada «sospechosa» |
| Chivuos | 60,4 % | **22,6 %** ← estaba marcada «sospechosa» |
| Koreans do it better | 39,4 % | **23,5 %** |
| Big Mike's Burger Joint | 37,2 % | **24,1 %** |
| Dos Coyotes | 32,7 % | **26,8 %** |
| Milanesa Haus | 24,6 % | 23,8 % ← casi no vende combos |

**Las marcas que salían fatal eran justo las que venden combos.** Después del
cambio no queda **ninguna** marcada como sospechosa: las dos banderas rojas eran
artefactos del mismo fallo, y la tarjeta que estrené esta mañana mandaba a Julio
a revisar dos escandallos que están bien.

### Lo que sigue siendo optimista, y se dice

Las 1.187 líneas de `modifier` llevan 726 € de venta y **cero** coste: ninguna
opción tiene receta costeada. Su ingreso entra en el denominador y su coste no
entra en el numerador, así que el 22,3 % se queda algo por debajo del real. Son
el 0,95 % de la venta; costeadas, el número subiría unas tres décimas. Escrito
para que el día que alguien coste los modificadores, la subida no se lea como
una regresión.

### La lección, que es la cara

**Un frente con su medida al lado no es un diagnóstico.** Aquí la medición era
buena (2.868 líneas, 1.149 €, todo correcto) y la conclusión estaba invertida,
porque supuse que esas líneas no aportaban coste en vez de comprobarlo. La
comprobación costó una consulta.

## 15 · `list_costless_sold_products` devuelve cero y el agujero existe
**Abierto:** 02/09/2026 · **Esquivado, no arreglado**

La RPC existe desde antes, se llama exactamente como el problema y **devuelve
CERO filas para Foodint**. La tarjeta «Platos sin escandallo» iba a anclarse ahí.

Devuelve cero porque exige `recipe_item.computed_cost IS NULL AND fixed_cost IS
NULL`, y hoy todos los `recipe_item` enlazados que se venden tienen coste. El
agujero real está **un paso antes**: productos de carta sin `recipe_item`
enlazado. Y la RPC los excluye por construcción, porque hace
`JOIN recipe_item ON ri.id = mi.recipe_item_id`.

**Lo que habría dicho la tarjeta:** «0 platos sin escandallo». Detrás:

| | productos | líneas | venta 30 d |
|---|---:|---:|---:|
| Sin coste, sin combo declarado | 87 | 313 | 6.357 € |
| Sin coste, combo declarado | 31 | 268 | 5.181 € |
| **Total sin costear** | **118** | **581** | **11.522 €** |

Es el cero de la regla 7 servido por una fuente de aspecto impecable, y solo se
cazó porque se midió la RPC antes de cablearla en vez de después.

**Lo que se hizo:** función nueva, `home_vendido_sin_coste`, con el criterio
correcto (`sale_line.computed_cost`, que es lo que el motor deja escrito en la
línea y ya resuelve combos y modificadores).

**CERRADO el 02/09. Julio decidió retirar**, y el argumento es el bueno: dos
fuentes para la misma pregunta es como nace la siguiente discrepancia (regla 10).

Migración `20260902T2320_retirar_list_costless_sold_products.sql`, que guarda la
definición original entera —borrar algo sin dejar cómo era es borrar dos veces—
y lleva guarda `do $$` antes del `drop`. Verificado después: cero firmas.

**Lo que se midió antes de borrar:**

| | |
|---|---|
| Objetos de la base que la nombran | **ninguno** (0 funciones, vistas, crons) |
| Consumidores en el código | **uno**: la sección «Casado pero sin coste» de `SalesExceptionsPage` |
| Llamadas en `pg_stat_statements` | **1 en toda la vida de la base** |
| Grants | `anon` podía ejecutarla; se va con ella |

Esa única llamada dice bastante: la sección se abrió una vez, y lo que enseñó
fue una lista vacía.

**Lo que se pierde y lo que no.** Con la sección se va su fila `CostlessRow`,
que tenía un flujo de resolución de tres acciones (reventa / plato / combo). **La
maquinaria NO se pierde:** `classifyUnmappedProduct` la siguen usando las otras
dos secciones de la misma pantalla. Lo que desaparece es una fila que no tenía a
nadie a quien enseñar. En su sitio queda un comentario que dice adónde se fue la
pregunta, no un hueco.

**Y un segundo defecto suyo, registrado por si vuelve:** filtraba
`s.source = 'lastapp'`, así que las ventas importadas por CSV de plataforma no
entraban nunca. Con un solo agujero ya no valía; con dos, menos.


## 16 · El motor de combos YA EXISTE. Lo que está roto es el reparador
**Abierto el 02/09 · MEDIDO el 02/09, y el diagnóstico que traía era el equivocado**

Julio decidió «el motor» y puso una puerta antes de construir: **medir por qué
`combo_item.computed_cost` sale NULL — si la línea no lleva la referencia al
producto componente, el arreglo es otro y más hondo.**

Se midió. Y las dos respuestas dan la vuelta al frente.

### Respuesta 1: la referencia SÍ está

De las 1.678 líneas `combo_item` de 30 días, **1.413 tienen `menu_item_id`, y
las 1.413 tienen receta enlazada Y con coste.** No es 1.413 → 1.200 → 900: es el
mismo número las tres veces. La referencia existe y la receta tiene precio. Las
otras 265 son componentes que nadie casó, y ése es un problema de catálogo, no
de estructura.

**Así que no es «más hondo».** El arreglo no exige tocar cómo se guarda una
venta.

### Respuesta 2: `combo_item.computed_cost` está a NULL A PROPÓSITO

`compute_sale_line_cost` **ya hace exactamente lo que Julio decidió**: si la
línea tiene hijos `combo_item`, recorre los hijos, suma
`COALESCE(ri.computed_cost, ri.fixed_cost)` de cada uno, le aplica los impactos
de sus modificadores, multiplica por la cantidad **y escribe el total en la
línea PADRE**. El coste del combo es la suma de sus componentes, y lo es desde
antes de que abriéramos este frente.

Los hijos se quedan a NULL porque **no es ahí donde va el coste**. La pregunta
de la puerta tiene respuesta y no es un fallo: es el diseño, y es el correcto.

**El motor no hay que construirlo.** Estaba escrito. Lo que yo fiché como «los
combos no se costean ni por arriba ni por abajo» era mirar el piso equivocado.

### Lo que sí está roto, y es pequeño

De los **606 combos** vendidos en 30 días (8.412 € sin costear):

| | combos | € |
|---|---:|---:|
| Con algún hijo sin casar — el motor se niega, y hace bien | 263 | 5.074 |
| **Con todos los hijos costeables y aun así sin coste** | **131** | **3.338** |

Esos 131 son la anomalía. Desglosados:

- **96** se costearon ANTES de que la receta de su hijo tuviera coste
  (`cost_computed_at` < `updated_at` de la receta hija). El motor pasó, no pudo,
  escribió NULL, y nadie volvió.
- **35** no los visitó nunca nadie.
- **0** se visitaron con la receta ya lista y aun así salieron NULL. **No hay
  fallo de lógica en el motor**: cuando corre a tiempo, calcula bien.

Y aquí está el remate. Existe un reparador nocturno para exactamente este caso
—`sale_line_cost_sweep`, cron `sale-line-cost-sweep` a las 04:50, y su propio
comentario dice «venta de hoy costeada mañana al escandallar»—. Se comprobó
cuántos de los 131 recogería:

> **`los_ve_el_barrido = 0`. Ninguno.**

Porque su consulta hace `join recipe_item ri on ri.id = mi.recipe_item_id`, y
**un combo no tiene receta propia** — es lo que lo hace un combo. El INNER JOIN
lo tira. El reparador tiene un punto ciego con la forma exacta de un combo.

### La propuesta, y por qué no la he aplicado

El arreglo es al `where` del barrido: además de las líneas de producto con
receta propia, recoger **las líneas padre de combo cuyos hijos ya son todos
costeables y que siguen sin coste**. `compute_sale_line_cost` ya sabe qué hacer
con ellas; solo hay que dárselas.

**Ensayo en seco de lo que repararía** (replicando la suma del motor sin
escribir nada): 131 combos, 3.338 € de venta, **878 € de coste que aparecen**,
un food cost del **26,3 %** para ese grupo. Está en familia con el resto de la
casa (mediana 21,6 %, máximo 33,1 %), que es la señal de que el número
reparado no es absurdo.

**No se ha aplicado, y la razón no es la banda:** es que **escribe datos de
producción** —rellena 131 filas de `sale_line`— y eso es más que redefinir una
función. Va con la decisión de Julio delante, no detrás.

**Qué se movería y qué no**, para que nadie se lleve una sorpresa:

- **«Vendido sin coste» SÍ**: lee `sale_line.computed_cost`. Los 11.522 € sin
  costear bajarían a unos 8.184 €.
- **«Food cost medio» y «Margen del mes» NO**: leen `food_cost_dashboard`, que
  va por `recipe_item.computed_cost` rodado a la unidad de venta. Ni se enteran.

Y de paso cierra parte de la discrepancia entre las dos definiciones de
«costeada» que se anotó al cerrar el frente 14.

### Lo que queda como trabajo de verdad

Los **265 componentes de combo sin casar**, que dejan 263 combos (5.074 €) sin
costear con toda la razón. Eso no lo arregla ningún `where`: hay que casarlos.
Es trabajo de catálogo y tiene su sitio natural en la pantalla de Casado.

## 17 · «Platos sin escandallo» se llama ahora «Vendido sin coste» — CERRADO el 02/09
**Abierto y cerrado el 02/09** · **Decidido por Julio**

La tarjeta contaba **productos de carta vendidos sin coste**, y el nombre
prometía otra cosa. Palabras de Julio al cerrarlo: *«Platos sin escandallo»
promete una causa y entrega otra*.

**Por qué no era una manía de redacción.** «Platos sin escandallo» nombra UNA
CAUSA —falta la receta— y manda a quien lo lee a escribir escandallos. Dentro de
esa cifra hay al menos tres causas:

1. productos sin `recipe_item` enlazado,
2. productos con receta enlazada y sin coste,
3. packs y menús a los que **nadie declaró el combo** — y esos NO se arreglan
   con un escandallo, se arreglan declarando el combo o arreglando el motor
   (frente 16).

Un título que nombra el síntoma deja que la fila diga la causa. Uno que nombra
una causa manda a la mitad de la gente a hacer el trabajo equivocado.

### La clave NO cambió, y eso es la mitad de la decisión

Sigue siendo `kitchen.platos_sin_escandallo`. **Una clave es identidad** —es lo
que está guardado en `home_layout` y lo que compara el aviso de «tarjetas
nuevas»— **y un título es etiqueta**. Cambiar la clave para que hiciera juego con
el nombre habría hecho desaparecer la tarjeta del Inicio de quien ya la tuviera
puesta, en silencio: exactamente el fallo que costó el sub-lote del cajón.

Hay una prueba que fija las dos cosas a la vez —el título nuevo y la clave
vieja— para que a nadie le parezca buena idea «cuadrarlas» más adelante.

### Lo que NO hizo falta tocar, comprobado

El espejo `home_card_catalog` tiene una columna `title`, pero el cliente solo lee
de él `card_key` y `active` (`homeLayoutService.ts:69`). El título de la BBDD es
decorativo: **el código es la verdad**, así que el renombrado no llevó migración.

## 18 · Las tres pantallas de Ventas no leen la URL
**Abierto:** 02/09/2026 · **Consecuencia visible hoy**

`/ventas/margen`, `/ventas/margen-final` y `/ventas/cedidas` **no usan
`useSearchParams`**. Comprobado, no supuesto.

Por eso las tres tarjetas nuevas del bloque del dinero mandan su enlace **sin
filtros**, en vez de mandar un `local` que se perdería en silencio — que es
exactamente lo que prohíbe la tabla de contratos de `drill.ts`, y por lo que
esa tabla existe.

**La consecuencia que se ve:** si en el Inicio hay un local seleccionado, la
tarjeta enseña las cifras de ese local y el enlace abre la pantalla con TODOS.
Los números no cuadran, y no hay nada en pantalla que explique por qué.

**Lo que costaría:** las tres pantallas ya tienen su propio selector de local
con estado; es leer un parámetro al montar y sembrarlo. No se ha hecho en este
lote porque son tres pantallas de producción que no son del Inicio, y meterles
mano de paso es cómo se rompe algo que funcionaba.

**Mientras tanto:** los enlaces van limpios. Un filtro que no viaja es mejor que
un filtro que viaja y se pierde.


## 19 · Trece tablas de trabajo sin RLS y con escritura de `anon`
**Abierto:** 02/09/2026 · **Encontrado de paso, medido, NO tocado** · **Es de seguridad**

Comprobando los permisos de `licensed_settlement` para la tarjeta nueva salió
esto, y no es de la tarjeta:

De las **311 tablas** de `public`, **286 conceden INSERT/UPDATE/DELETE a
`anon`** (el default de Supabase, que el proyecto ya ha tenido que revocar a
mano dos veces: `_queue_system_alert` y `agent_pause`). En 272 de ellas la RLS
está activa y las políticas piden sesión, así que `anon` no pasa.

**En CATORCE no hay RLS.** Ahí el grant es lo único que decide, y el grant dice
que sí:

| Tabla | anon |
|---|---|
| `_backup_permission_sets_20260814` | SELECT, INSERT, UPDATE, DELETE |
| `_backup_permission_set_assignments_20260814` | SELECT, INSERT, UPDATE, DELETE |
| `_backup_article_supplier_20260810` / `_20260815` / `_ctb_20260811` | ídem |
| `_backup_purchase_order_20260810`, `_backup_purchase_format_20260810` | ídem |
| `_backup_kds_fn_20260811`, `_backup_kds_fn_20260811_pre0901` | ídem |
| `_a1_anuladas`, `_a2_cache_antes`, `_a3_antes`, `_a3_cola` | ídem |
| `spatial_ref_sys` (PostGIS, del sistema) | ídem |

**Lo que significa:** la clave anónima —la que va en el bundle del navegador y
cualquiera puede leer— llega a copias de la tabla de PERMISOS y a copias de
proveedores y pedidos, y puede borrarlas. El prefijo `_` no las esconde:
PostgREST expone el esquema `public` entero.

**RECON HECHO el 02/09 (noche), y NO es incidente.** Ficha completa en
`claude/folvy_recon_tablas_sin_rls_anon_20260902.md`. Lo esencial:

`pg_stat_database.stats_reset` está a NULL, así que los contadores cubren toda
la vida de la base. Sobre eso: **todas** las consultas que han tocado las trece
tablas las hizo el rol `postgres`, y todas son el `create table … as` o el
`count(*)` de verificación del guion que las creó. Ni una de `anon`,
`authenticated` ni `service_role`. Cero funciones, vistas, triggers, crons o
dependencias las nombran. Cero lecturas desde la aplicación.

Las copias de permisos guardan UUID internos y el modelo de permisos — sin
credenciales— y **no las lee ningún camino de autorización**, así que escribir
en ellas no eleva privilegios. Es divulgación de una copia muerta y una puerta
abierta que no hace falta: deuda real, no incidente.

**Y revocar no puede romper nada:** `postgres` es dueño y `BYPASSRLS`, y
`service_role` también. Para las trece, el `revoke` basta y la RLS ni siquiera
hace falta. El único caso con riesgo es `spatial_ref_sys` —PostGIS, y sí se
usa—, y se resuelve quitándole solo INSERT/UPDATE/DELETE y dejándole el SELECT.

**CERRADO el 02/09 (noche).** Migración `20260902T2300_f0_5_cerrar_grants_tablas_sin_rls.sql`,
aplicada bajo el criterio F2 y verificada con `has_table_privilege` antes y
después: las trece más `social_n2_usage` en false para `anon` y `authenticated`
en los cuatro verbos; `football_team_city` con SELECT y sin escritura;
`service_role` intacto en las quince. `spatial_ref_sys` sigue pendiente, en su
propio bloque.

### Y las dos que faltaban: la F0.4 de agosto se quedó a mitad de alcance

`20260807T1600_f0_4_close_no_rls_table_holes.sql` **hizo bien su trabajo** —se
comprobó, `anon` está cerrado en las dos, tal como dice su cabecera—. Lo que
pasa es que **su alcance era `anon`**, lo dice el título, y `authenticated` se
quedó fuera. En una tabla con `account_id` y sin RLS, `authenticated` es el rol
peligroso: es cualquier usuario logueado de cualquiera de las tres cuentas.

**`social_n2_usage` no estaba muerta: la escribieron hoy.** 40 filas, último
acceso 02/09 a las 12:08 UTC. Es el contador diario del agente Social
(`account_id, day, count`). Sin RLS y con INSERT/UPDATE/DELETE para
`authenticated`, cualquier usuario logueado podía leer el consumo de las otras
cuentas y **poner su propio contador a cero** — darse presupuesto ilimitado. Es
el caso exacto que Julio quería descartar antes de tocar: una tabla viva.

Revocar no la rompe, y se comprobó ANTES: `claim_n2_budget` es `SECURITY
DEFINER`, su dueño es `postgres` —que conserva INSERT y UPDATE— y **ni `anon` ni
`authenticated` pueden ejecutarla**. La escritura no pasa nunca por el grant del
usuario.

`football_team_city` es catálogo de referencia: 0 filas, nunca leída, sin
`account_id`, la llena `sports-events` como `service_role`. Se le quita la
escritura y se le deja el SELECT, igual que la F0.4 hizo con `anon`.

**La lección, y es de alcance, no de ejecución:** una auditoría que se titula
«grants a anon» cierra `anon` y deja `authenticated` abierto durante 26 días,
con el guard verde y la cabecera diciendo la verdad. Cuando el alcance se pone
en el título, lo que queda fuera del título no se ve que falta.

**Propuesta, en dos pasos separados:**
1. `revoke all on <las 13> from anon, authenticated;` — reversible, inmediato,
   y no puede romper nada porque ninguna pantalla las lee. `spatial_ref_sys` se
   deja: es de PostGIS.
2. Decidir cuáles de los ocho `_backup_*` (de agosto) y los cuatro `_a*` siguen
   haciendo falta, y tirar el resto. Un backup que ya no se va a restaurar es
   solo superficie.


## 20 · `tsc --noEmit` en este repositorio NO COMPRUEBA NADA
**Abierto:** 02/09/2026 · **Sale con exit 0 siempre** · **Misma familia que el frente 11**

`tsconfig.json` es un fichero de SOLUCIÓN: `"files": []` más dos `references`
(`tsconfig.app.json` y `tsconfig.node.json`). Con project references, el
comprobador es **`tsc -b`**; `tsc --noEmit` sobre el fichero raíz no encuentra
ningún fichero de entrada y **sale con 0 sin mirar una sola línea**.

**Cómo se cazó:** cambié tres nombres de campo en `FoodCostSalud` y dejé a
propósito tres consumidores leyendo los nombres viejos. `npx tsc --noEmit` no
dijo nada. `npx tsc -b` dijo:

```
foodCostMedio.ts(91,24): error TS2339: Property 'lineas_costeadas' does not exist
foodCostMedio.ts(92,21): error TS2339: Property 'lineas' does not exist
foodCostMedio.ts(93,30): error TS2339: Property 'lineas_costeadas' does not exist
foodCostService.ts(79,12): error TS2353: 'lineas' does not exist in type
```

**Lo que esto significa hacia atrás:** en el lote de las cuatro tarjetas del
02/09 usé `tsc --noEmit` como comprobación intermedia varias veces y anuncié
«limpio». No comprobaba nada. **El lote está bien igualmente** —`npm run build`
ejecuta `tsc -b` y pasó en verde— pero la comprobación que yo creía estar
haciendo no se hacía. Un `exit 0` de una herramienta que no ha mirado nada es
indistinguible de un `exit 0` de una que ha mirado todo, y es la misma familia
que el frente 11: el despliegue que no despliega y sale verde.

**La regla que sale:** en este repositorio, el comprobador de tipos es
**`npx tsc -b`**. `--noEmit` sobre la raíz está prohibido como prueba.

**Arreglado en el mismo lote:** `package.json` ya tiene
`"typecheck": "tsc -b"`. Existe un nombre correcto que teclear y nadie tiene que
acordarse de esto. Lo que queda abierto es la costumbre: si alguien escribe
`tsc --noEmit` por inercia, sigue saliendo verde sin mirar.

### CORRECCIÓN (02/09, misma noche): esto no era un hallazgo. Era una regla escrita que me salté

Al barrer el repositorio entero buscando `--noEmit` apareció esto:

> `docs/claude_folvy_reglas.md:38` — **«El build se verifica con `tsc -b`** (lo
> que corre Vercel), no `tsc --noEmit`.»

Y su origen, en `docs/claude_folvy_archivo_2026-08.md:109`: se aprendió
arreglando **un build de Vercel roto en el PR #47**. O sea que el proyecto ya
había pagado exactamente este fallo, lo había escrito en su fichero de reglas, y
yo lo repetí. Presentarlo como descubrimiento propio era la mitad de la verdad.

**Y el barrido dejó una segunda cosa, más incómoda:** hay **ocho documentos de
agosto** que declaran «`tsc --noEmit` limpio» como verificación de un lote
(`gestor_menus_premium_20260824`, `gestor_menus_auditoria_f1_20260824`,
`gestor_menus_fix_margen_20260824`, `subrecetas_preparaciones_ui_20260823`,
`botones_carta_no_responden_20260824`, `gestor_menus_f2_f7_20260824`,
`carta_pausar_y_menu_contextual_20260824`, `quitar_plato_de_carta_20260823`,
`recostear_todo_20260824`, `batch_yield_subrecetas_20260823`,
`pedido_articulo_repetido_20260820`). **Esas afirmaciones estaban vacías cuando
se escribieron.** Los lotes pueden estar bien —casi todos declaran también
`npm run build` ✓, que sí comprueba— pero la línea del `--noEmit` no probaba
nada en ninguno.

### Lo que el barrido descartó, y es la buena noticia

**No hay ningún hook ni workflow afectado.** No existe `.husky/`, no hay
`lint-staged`, no hay `pre-commit`. Los tres workflows de Actions
(`deploy.yml`, `build-apk.yml`, `deploy-edge-functions.yml`) no usan `--noEmit`:
`deploy.yml` corre `npm run build`, que es `tsc -b && vite build`. **La puerta
de CI sí comprueba.** El agujero era solo de comprobación manual y de lo que se
escribía en los registros.


## 21 · La bandera «sospechoso» tiene una rama que no puede encenderse
**Abierto:** 02/09/2026 · **Probada, no celebrada** · **C1 de Julio**

Al cerrar el frente 14 desaparecieron las dos marcas marcadas como sospechosas.
La tentación era contarlo como éxito. Julio pidió lo contrario: **probar la
bandera contra un caso que sí deba dispararse**, porque sus umbrales se fijaron
mirando números que estaban mal —con Deep Pizza al 78,6 %— y un listón puesto
para aquello puede haber quedado inalcanzable. Una bandera que no puede
encenderse es `list_costless_sold_products` con otra ropa.

**La medida.** 68 observaciones = 17 marcas × 4 ventanas (30 días, agosto,
julio, junio), con la métrica nueva:

| | valor |
|---|---:|
| mínimo | 5,4 % |
| mediana | 21,6 % |
| p95 | 31,1 % |
| máximo | **33,1 %** |
| por encima de 60 % (`> 60`) | **0** |
| por encima de 40 % | **0** |
| por debajo de 8 % (`< 8`) | **1** |

**Veredicto, rama por rama:**

- **`< 8` está VIVA y sirve.** Se disparó una vez: julio, una marca al 5,4 %.
  Es la rama que caza «falta coste», y hace su trabajo.
- **`> 60` está MUERTA.** El máximo real en cuatro ventanas y diecisiete marcas
  es 33,1 %, a 27 puntos del listón. Con la métrica corregida ninguna marca de
  este negocio puede acercarse: el 60 % se puso cuando los combos inflaban el
  número al doble. Es una alarma que no puede sonar.

**Lo que NO se ha hecho:** cambiar el umbral. El número es una decisión de
negocio y aquí solo se aporta la distribución con la que decidirlo.

**Propuesta, anclada en el dato y no en el gusto:** bajar la rama alta a **40 %**
—siete puntos por encima de la peor marca real, así que no dispara por variación
normal, y bien por debajo de donde un food cost deja de ser un margen— y dejar
`< 8` como está. Con esos umbrales, las 68 observaciones dan 1 bandera, la de
julio, que es la que hay que ver.

**Y un hallazgo de paso:** `kitchen_settings.target_food_cost_pct` existe como
columna, pero **Foodint no tiene fila en `kitchen_settings`**. Así que hoy no
hay objetivo configurado con el que anclar el umbral, y por eso la propuesta es
un número absoluto y no «X puntos sobre el objetivo», que sería lo bueno. Si
Julio pone el objetivo, la bandera puede pasar a ser relativa y dejar de
envejecer sola.
