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
