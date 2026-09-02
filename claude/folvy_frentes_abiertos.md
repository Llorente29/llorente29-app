# Frentes abiertos

Lo que se ha encontrado, se ha medido y NO se ha arreglado, con la razón por la
que no. No es una lista de deseos: cada entrada tiene su medida y su fecha, y
sale de aquí cuando se cierra o cuando Julio decide que no se cierra —y
entonces se mueve al registro de decisiones, no se borra.

Distinto de `folvy_registro_excepciones_ventana_20260901.md`, que guarda lo que
SÍ se hizo fuera de norma y qué enseñó.

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

## 2 · 23 de las 232 RPC que llama el front no están en el fichero de tipos
**Abierto:** 02/09/2026 · **Medido sobre `src/` y `src/types/database.ts`**

Se puede llamar a una función que no existe y descubrirlo en producción. Hoy
solo dos rompieron el build —`kitchen_archive_item` y `kitchen_unarchive_item`—
y fue por casualidad: solo `recipeItemService` está tipado en estricto. Las
otras 21 pasan sin que nadie se entere.

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

**Dato para (4), y no cuadra con lo que se recordaba:** la desvinculación se dio
por ocurrida a las 20:26 del 27/08, pero los avisos sitúan a «Pase» callada
**desde las 13:12** y a «Cocina» **desde las 18:27** de ese mismo día. Son dos
aparatos, en dos momentos, y ninguno a las 20:26. La ventana a investigar es
esa, no la otra.

**Y una pieza de la (2) que cuesta minutos y se puede hacer aparte:** que el
botón «Escanear» no esté cuando la cámara no puede funcionar. Un botón que no
puede cumplir es peor que ningún botón.
