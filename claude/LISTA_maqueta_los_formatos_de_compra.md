# LISTA · Los formatos de compra, contra su maqueta aprobada

**Regla 1 del 16/09.** Esta lista va entera en cada encargo de formatos hasta que todo esté en ✅.
- Nada se aplaza sin quedar aquí con fecha.
- Nada pasa a ✅ sin captura de la pantalla real, visto bueno de Julio y comprobación en la aplicación.

> **Copia de trabajo de Code.** La que manda es la del proyecto; si discrepan, gana la del proyecto. Esta se ha traído del cruce del 19/09 y se ha movido solo en los puntos corregidos.

**Maqueta:** «Los formatos de compra en la ficha del artículo», **aprobada por Julio el 19/09** («ok a todo») · https://claude.ai/artifact/H3wCwDSY1GdQ6uDky1BD7K

**Dirección fija de la rama:** `folvy-app-git-claude-cool-thompson-msx9dg-llorente29s-projects.vercel.app` (apunta siempre al último commit).

**Estado 19/09, cuarta vuelta.** Los dos retoques hechos y **el alta ya no escribe al pulsar «Siguiente»**: el artículo nace al guardar, y «Guardar y seguir luego» es la única forma de dejarlo a medias a propósito. Un alta abandonada no deja rastro.

**Tercera vuelta.** Cruzado en el preview `a55a57e` (17 de 25 en 🟢) y **corregidas las tres cosas que bloqueaban** más los cuatro reparos menores. Pendiente: volver a mirar en el preview del commit nuevo.

**Las cinco decisiones que manda (Julio, 19/09):**
1. **No hay pantalla nueva de formatos.** Todo dentro del flujo del artículo: al crearlo pregunta lo que hace falta; al modificarlo se despliega entero.
2. **Varios proveedores por artículo, cada uno con su formato y su referencia.**
3. **En qué se cuenta lo decide quien crea el artículo**, artículo por artículo.
4. **Si el proveedor cambia la caja, Folvy crea la versión nueva solo y avisa.** Lo pasado no se toca.
5. **Lo que está a medias sale en la propia lista de artículos**, con filtro. Sin zona dedicada.

**Leyenda:** ✅ hecho, visto y aprobado · 🟢 visto en captura, falta la aprobación de Julio · 🟡 a medias · ❌ falta · ❔ sin poder comprobar · ⏸ aplazado con fecha

## A · El alta del artículo (artboard 1)

| # | la maqueta dice | hoy | dónde está |
|---|---|---|---|
| A1 | El paso «De quién lo compras» trae **los dos modos desde el principio**: «De una pieza» y «Caja con piezas dentro» | 🟢 **corregido ×2** | **«Siguiente» ya no crea el artículo**: solo avanza con un borrador en memoria. El artículo nace al guardar; si se sale, no queda nada. «+ Nuevo ingrediente» tiene **dos pasos**: el botón dice «Siguiente: de quién lo compras» y el paso 2 es **la misma sección de la ficha** en `modoAlta` (formulario abierto, sin los botones de escandallo ni el pie). No es un formulario nuevo — si lo fuera, habría dos sitios donde arreglar el mismo fallo |
| A2 | La fila se lee como una frase: **Caja · lleva · 6 · piezas de · Bote · de · 965 g** | 🟢 | sin cambios |
| A3 | Debajo, la cuenta en verde: **«1 Caja = 6 Botes × 965 g = 5.790 g»** | 🟢 **corregido** | el separador de miles ya no baila: toda la sección pasa por la misma función. En es-ES el separador se omite por defecto en los números de cuatro cifras, así que las dos formas eran «correctas» — cantaba verlas juntas |
| A4 | **Su referencia** y **cómo lo llama él**, uno al lado del otro, con su porqué debajo | 🟢 | sin cambios |
| A5 | El precio es **el de la caja**, y al lado sale a cuánto queda el gramo y la pieza | 🟢 **corregido ×2** | el €/pieza en la tarjeta, y **en singular**: «28,84 € / caja · 4,81 € / lata». `singular()` es el inverso exacto de `plural()` |
| A6 | **«+ Añadir otro proveedor para este mismo artículo»**, con la nota de los 71 artículos | 🟢 | sin cambios |
| A7 | **«¿En qué lo cuentas?»**: Cajas · Botes · unidad base | 🟢 | con el plural arreglado |
| A8 | **«Cómo queda»**: las cuatro líneas juntas | 🟢 **corregido** | estaba construido pero **escondido hasta tener el formulario lleno**, o sea justo cuando ya no hacía falta. Ahora sale siempre con el formulario abierto y con «—» en lo que falta; se le ha añadido la línea del precio |
| A9 | Pie con **«Guardar y seguir luego»** | 🟢 | sin cambios |

## B · La ficha abierta (artboard 2)

| # | la maqueta dice | hoy | dónde está |
|---|---|---|---|
| B1 | Cabecera: **«Se gasta en g · Se cuenta en cajas»** y el coste grande, diciendo **de qué proveedor sale** | 🟢 **corregido ×2** | «Se cuenta en **cajas · latas de 3.000 g · latas de 1.600 g**»: agrupadas por nombre, cada grupo donde lo pone su miembro más grande. Ni «latases», ni unidades fundidas, ni «y … y» |
| B2 | **Una tarjeta por proveedor**, con su referencia, su texto, su precio y su formato en una línea legible | 🟢 | con el €/pieza añadido |
| B3 | El principal va marcado, y se ve **la fecha de su último albarán** | 🟢 | sin cambios |
| B4 | **Aviso cuando dos proveedores no se parecen**, con «Revisar el formato» / «Está bien» | 🟢 | sin cambios |
| B5 | Pie de la ficha: recuento · se gasta · cuántos platos | 🟢 | con el plural arreglado |

## C · Editar un formato con historia detrás (artboard 3)

| # | la maqueta dice | hoy | dónde está |
|---|---|---|---|
| C1 | Arriba, en ámbar: **«Este formato ya se ha usado N veces desde el <fecha>»** | 🟢 | sin cambios |
| C2 | Y la frase que quita el miedo | 🟢 | sin cambios |
| C3 | **«Lo que va a cambiar»**: hasta hoy / desde hoy, con el coste de cada uno | 🟡 | **está construido.** Su cuenta vive ahora en `lib/formatosDeCompra.ts` (`loQueVaACambiar`) y está **probada con los números reales de Alubias**. Lo que sigue sin comprobar es la pantalla de punta a punta: hace falta teclear en un formato con movimientos y **yo no puedo escribir en producción**. Ver la respuesta en el parte |
| C4 | «¿En qué lo cuentas?» también aquí | 🟢 **corregido** | sin «Latases» |
| C5 | Pie: **queda apuntado quién lo cambió y cuándo** | 🟢 **corregido** | en futuro: «Cuando guardes quedará apuntado que lo cambiaste tú, …» |

## D · La caja ha cambiado (artboard 4)

**⏸ Aplazada el 19/09 de común acuerdo.** El SQL propuesto está escrito y **sin ejecutar**, esperando que Julio lo lea. D1–D6 sin tocar.

## E · Lo que está a medias, en la lista (artboard 5)

| # | la maqueta dice | hoy | dónde está |
|---|---|---|---|
| E1 | Franja arriba con el número y el porqué en una línea | 🟢 | sin cambios |
| E2 | Tres filtros con su número | 🟢 | contados en vivo |
| E3 | Las filas a medias **con fondo distinto** y sello | 🟢 **corregido** | **un solo sello por fila**. Manda lo que está MAL (No cuadra, Repetido) sobre lo que FALTA (formato, referencia, coste); el resto va como «+N» y en el título del sello, y se sigue contando en los filtros — no se esconde nada (regla 7). Y «sin terminar» se calla cuando ya hay sello: repetía en vago lo que el sello dice con nombre |
| E4 | Botón **«Terminarlo»** que abre justo el paso que falta | 🟢 | sin cambios |
| E5 | Sellos **«No cuadra»** y **«Repetido»** | 🟢 | sin cambios |
| E6 | Lo terminado dice **«✓ terminado»**, sin ruido | 🟢 | sin cambios |

## F · Palabras y tamaños

| # | | hoy |
|---|---|---|
| F1 | Nada de «unidad base», «conversión» ni «factor» en pantalla | 🟢 |
| F2 | Sin emojis. Iconos del sistema | 🟢 |
| F3 | Pantalla de oficina, 1.280 px, y que se pueda usar en un portátil de 1.366 | ⏸ 19/09 · **deuda aparte, aceptada**: la barra horizontal es de toda la aplicación, no de estas pantallas |
| F4 | La referencia del proveedor, en monoespaciada | 🟢 |

## Lo que tiene que llegar para pasar a ✅

1. ~~Capturas de cada pantalla real~~ **hecho: Claude entra al preview y lo mira directamente.**
2. ~~Claude las cruza con esta lista~~ **hecho el 19/09.**
3. ~~Las tres cosas que bloquean, corregidas~~ **hecho; pendiente de volver a mirar en el preview del commit nuevo.**
4. `npm run build` exacto, fusión y READY en Vercel.
5. Julio lo ve en la aplicación y cada punto pasa de 🟢 a ✅.
