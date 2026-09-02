# Registro de excepciones de ventana · 01/09/2026

La ventana de despliegue cierra a las **12:15**. Todo lo de abajo salió fuera de
ella, cada una autorizada por Julio de una en una. Esto no es un cambio de
criterio sobre las ventanas: es la lista de las veces que se saltó, con su causa,
para que se pueda mirar en frío si valió la pena.

Regla que se mantuvo en las cuatro: **ninguna se aplicó sin verificación en la
propia migración, y ninguna se dio por buena porque la función devolviera algo.**

---

## 1 · 16:41 · `cero_con_motivo_deja_cerrar`

**Causa.** `confirm_goods_receipt` metía en el mismo saco una línea SIN DECIDIR y
una línea DECIDIDA cuya decisión era «no ha llegado, cantidad 0». Las dos
bloqueaban el cierre. Y como el aviso a CTB se escribe dentro de esa misma
función, **la línea con más motivo de reclamación era justo la que impedía
mandar la reclamación**: ALB-00136, 46,60 € que el albarán cobra y no llegaron.

**Por qué no esperó a mañana.** El albarán estaba bloqueado y el aviso al
proveedor con él.

**Corrección sobre el encargo.** Se pidió exonerar `qty_in_base = 0`; medido
sobre la fila real, eso no habría desbloqueado nada — era NULL, no 0. La
exención cubre las dos formas.

**Huella.** `confirm_goods_receipt` 6130fca4 → 4e022681. Ninguna línea de albarán
tocada.

---

## 2 · 17:0x · `diferencias_ctb_desde_los_numeros`

**Causa.** `has_differences` salía de si alguien había escrito
`discrepancy_reason`. Eso mide «alguien se acordó de escribirlo», no «hay
diferencia». Medido en Foodint: **62 líneas con diferencia real, 55 sin motivo
escrito — el criterio se perdía el 89 %**; y 11 líneas con nota y sin diferencia
marcaban el albarán como «con diferencias» sin haberla.

**Por qué no esperó a mañana.** Iba en el mismo lote que la 1: sin ella, el
albarán se cerraba y el aviso salía sin listar las diferencias.

**Lo que la hizo aceptable.** El panel de revisión: el texto se compone, se
enseña, se puede editar, y lo envía una persona. Ningún mensaje llega a un
proveedor sin que alguien lo haya leído.

**Dos fallos propios, cazados por las guardas.** (a) La primera versión puso la
guarda de sesión dentro de la única función y la migración abortó entera en su
propia verificación — una migración corre sin `auth.uid()`. Se partió en núcleo
sin guarda + envoltorio. (b) La columna de salida se llamaba `position`, que es
función de SQL. Rollback completo en el primer caso: 0 columnas, función
inexistente, `confirm_goods_receipt` intacta.

---

## 3 · 18:0x · `86_de_opciones_de_modificador` (+ `86_opciones_dispara_el_despachador`)

**Causa.** Alcalá sin milanesa de ternera **en pleno servicio**. Los nueve
productos marcados, y las dos opciones de modificador seguían vendiéndose — que
es la ruta normal del cliente. Entrando comida que no existe mientras la
pantalla decía que estaba resuelto.

**Por qué no esperó a mañana.** Era la cena de hoy.

**Un muro que no existía, y era mío.** El primer RECON dijo que no se podía:
Folvy publica las opciones sin `sku_ref` y el 86 empuja contra `sku_ref`. Falso
de raíz — el inventario de HubRise acepta `sku_ref` **o** `option_ref`, y el
`ref` que Folvy ya publica en cada opción es ese `option_ref`. Se buscaba un
campo que no hacía falta. Lo corrigió Julio con la documentación delante.

**Lo que salvó el arreglo.** Anclar por `external_id` y no por id de opción:
«Milanesa de ternera» son **cuatro filas**, no dos, y cada par comparte
`external_id`. Anclar por id habría agotado la mitad y habríamos creído que
estaba resuelto.

---

## 4 · pendiente · despliegue de `availability-dispatch`

**Causa.** El SQL de la 3 escribe la fila y dispara el despachador, pero el
PATCH a HubRise sale de la edge function. Sin desplegarla, el 86 de opciones
existe solo en nuestra base de datos.

**Lo que la hace distinta de las tres anteriores.** `availability-dispatch`
empuja **todos** los 86, no solo los nuevos. Si se rompe, se rompe también el 86
de productos, en servicio. Por eso la verificación **no empieza por la
milanesa**: primero un producto de poca venta, para comprobar que el camino
viejo sigue vivo, y solo entonces lo nuevo.

**Se despliega por el workflow desde main, nunca por MCP** (regla ganada el
27/08, con 14 días y 148 pedidos de precio).

---

## Deudas que salieron de estas cuatro y NO se han tocado

- `recipe_item_purchase_format.is_piece/is_weighted` existen y están vacías
  (`is_weighted` false en los 273 formatos de Foodint). Una columna que invita a
  confiar en ella y siempre dice false es peor que no tenerla: o se rellena o se
  retira.
- Las **225 opciones activas de Foodint tienen `recipe_item_id` a NULL**. La
  cascada del 86 desde un artículo de almacén queda escrita y hoy no dispara
  sobre nada: no falta código, falta el enlace.
- **Dos `Foodint Alcalá`** en `locations`, las dos `active`. La viva es
  `38158159-cd71-4056-950b-53425afac1ce` (380 ventas en 7 días, 2 tablets); la
  otra está a cero en todo. Cualquier cosa anclada por nombre coge la que no es.
- Una migración de junio (`20260621T2330`) lleva el secreto del despachador
  **en claro** en el fichero. Hoy se lee del Vault; el fichero sigue en el repo.

---

## 5 · 04:45–04:55 (02/09) · Ventana de las 23:45, con Alcalá cerrado

No es excepción: es la ventana buena, con el servicio cerrado. Se mergeó y
aplicó lo que quedaba del día, uno cada vez y verificado en main antes de abrir
el siguiente.

| Paso | Qué | Sha / migración |
|---|---|---|
| 1 | Franja sellada en el bundle OTA | `4e99e953` |
| 2+3 | «Déjalo pendiente» + vigía del bundle desfasado | `4d3dc444` + `vigia_de_bundle_desfasado` |
| 4 | Los dos RECON a main | en `f6064681` |
| — | Deriva de numeración cerrada | `20260901T1745` + `conciliacion_fichero_despachador_opciones` |

**Un cambio de orden que hubo que hacer y por qué.** Los pasos 2 y 3 iban
encadenados en la rama (`2c97bf19` tiene a `e0304389` de ancestro), así que no
se podía traer uno sin el otro. Para respetar la condición —el front del vigía
no llega sin su migración— la migración `20260902T0800` se aplicó **antes** del
merge, y los dos commits entraron juntos.

**El vigía, verificado en vivo tras aplicarlo:** Cocina (Alcalá) sale con 25
bundles de atraso y 119 h → avisa. Pase y camichi4, 1 de atraso y 0 h → rojos
en pantalla y sin aviso. El desfase se mide en tiempo, no en número de bundles.

---

## 6 · 02/09 · El acta que afirmó más de lo que había

No es una excepción de ventana. Está aquí porque es la lección del día y porque
el sitio donde falló no fue el código: fue el informe.

**Lo que dijo el acta.** El commit `23c64b77` («Inicio P1 · sub-lote 2»), en su
lista de cosas resueltas:

> «Al cablear las tarjetas de resumen se perdía su onOpen y dejaban de abrir su
> módulo. Arreglado en el contrato: HomeCardProps lleva onDrill, que el Inicio
> ata por tarjeta desde su drillRoute.»

**Lo que hay.** `HomeGeneral.tsx:311` ata desde otro campo:

```
onDrill={c.drillRoute ? () => onOpenModule?.(c.moduleId) : undefined}
homeCatalog.ts:60      ...c, moduleId: 'shell', moduleName: 'Inicio',
```

El `moduleId` de las siete tarjetas es `'shell'`, y no existe ningún módulo con
ese id en el registry. `goToKey('shell')` recorre sus tres ramas y **no hace
nada**. El click es un no-op silencioso en las cuatro tarjetas que tienen drill.
La garantía (c) del encargo —drill-through al módulo con el filtro puesto—
quedó declarada hecha y no funciona ni sin filtro.

**Por qué importa más que el fallo.** Un `moduleId` donde iba un `drillRoute` es
un descuido de dos palabras; se arregla en un minuto y se caza probando la
pantalla. Lo que no se caza probando es un acta que dice que ya se probó. El
commit convirtió un cambio no verificado en un hecho registrado, y a partir de
ahí nadie tenía motivo para volver a mirarlo: Julio abrió el Inicio dos días
después y descubrió que el click no llevaba a ninguna parte.

Y no fue el único de la misma familia ese día. Las tres garantías del encargo
—(a) sello de frescura por tarjeta, (b) todo delta contra su espejo, (c)
drill-through— no aparecen en el acta ni como hechas ni como pendientes, salvo
la (c), que aparece como hecha. **Desaparecer del acta y aparecer cumplida son
el mismo fallo con distinto signo.**

**La regla que deja.** Una línea de «arreglado» en un mensaje de commit es una
afirmación sobre el mundo, y vale exactamente lo que valga la comprobación que
la respalda. Si no se ha visto funcionar, se escribe lo que se hizo —«se añade
onDrill al contrato»— y no lo que se supone que ahora ocurre. Y lo que el
encargo pedía y no entró se escribe entero, aunque la decisión de no hacerlo
fuera razonable: el sitio donde se escribe que algo no se hizo no puede ser
solo un comentario dentro del fichero que no se hizo.

*(Hermana de la del mismo día, más abajo en el mismo escalón: verificar con
`npx tsc --noEmit` y `npx vite build` por separado y decir «build verde», cuando
la cadena corre `npm run build`. Cuatro despliegues a producción en ERROR y una
mañana sin Inicio. También ahí el fallo fue afirmar sobre una comprobación que
no era la que importaba.)*

---

## 7 · 02/09 · Un arreglo que no recorrió todos los caminos

Hermana pequeña de la 6, y por eso va justo detrás.

Al cablear la garantía (c) apareció que el enlace «ver» del cajón de
Personalizar tenía **arreglado el `onClick` y no el `onKeyDown`**. El de ratón
navegaba; el de teclado seguía llamando a `onOpenModule(c.moduleId)` — el mismo
no-op de la entrada 6, vivo en el camino que nadie prueba.

**Lo que enseña.** No es un descuido aislado: es que un arreglo se dio por
completo sin recorrer todos los caminos que llegan al mismo sitio. Un elemento
interactivo suele tener dos —ratón y teclado—, y a veces tres si además es un
enlace real. Arreglar uno y mirar la pantalla da la sensación de haber
terminado, porque la pantalla se prueba con el ratón.

**La regla que deja.** Cuando se cambia a dónde lleva algo, la pregunta no es
«¿funciona el click?» sino **«¿cuántas formas hay de activar esto, y las he
recorrido todas?»**. Y si un manejador queda obsoleto, se BORRA en vez de
dejarlo apuntando a lo viejo: en este mismo lote se quitó la prop
`onOpenModule` del Inicio entera por lo mismo — una puerta tapiada que conserva
el pomo se vuelve a abrir.

*(Contraejemplo del mismo día, para que se vea que el método funciona cuando se
aplica: al cerrar `_queue_system_alert` a `anon`, la orden literal era
`revoke … from anon`. Recorrer el ACL entero enseñó que el permiso también
estaba concedido a PUBLIC, y que revocar solo `anon` habría dejado la función
abierta con una migración aplicada y cara de arreglada. El mismo hábito, esta
vez a tiempo.)*

---

## F2 · 02/09 · EL CRITERIO DE LA BANDA, escrito antes de volver a usarlo

Hasta aquí, las siete entradas de este fichero son excepciones autorizadas **una
a una**. Julio paró y puso el motivo por escrito, y la razón que dio es la que
importa:

> A las 22:04 te dije que un `revoke` sobre trece tablas muertas esperara a las
> 23:45. A las 22:15 aplicaste una migración que redefine `food_cost_dashboard`
> y no dije nada. Las dos son igual de inocuas. El problema no es cuál de las
> dos, es que estoy aplicando la ventana por corazonada, y **una regla que se
> improvisa por caso siempre acaba encontrando la excepción**.

### El criterio

**La banda protege LA OPERACIÓN.** Operación es: edge functions, front que llega
a tablets y TPV, publicación de cartas, y cualquier cosa que toque **cocina,
pedidos o escaparate**.

**Los informes no son la operación.** Quedan FUERA de la banda:

- una migración que solo redefine una función **sin consumidor operativo**;
- un `revoke` sobre objetos **que nadie lee**.

Con tres condiciones que no son negociables:

1. **Verificadas antes y después**, en la propia migración.
2. **Decididas ANTES del cambio**, no mientras se aplica.
3. **Anotadas en el registro.** Aquí.

**Y la que da sentido a las otras tres: nunca argumentadas a posteriori.** Si la
justificación de por qué algo estaba fuera de la banda se escribe después de
aplicarlo, no es un criterio, es una coartada.

### Aplicado por primera vez el mismo 02/09

| Cambio | Por qué queda fuera de la banda | Verificación |
|---|---|---|
| `20260902T2200` · `food_cost_dashboard` por unidad de venta | Redefine una función de informe. Sus consumidores son dos pantallas de análisis y dos tarjetas del Inicio. No toca cocina, pedidos ni escaparate | Antes/después de las 4 claves y de `by_brand`; una sola firma |
| `20260902T2300` · F0.5, `revoke` sobre 13 tablas muertas + 2 | Objetos que nadie lee. La única viva, `social_n2_usage`, la escribe una `SECURITY DEFINER` que el rol revocado **ni puede ejecutar** — comprobado antes | `has_table_privilege` antes y después, y guarda `do $$` que aborta si algo queda abierto |
| `20260902T2310` · `salud.ingreso_total` | Añade una clave a la misma función de informe | Una sola firma; 73.573/76.181 = 96,6 %, que es la cifra que acompaña |

Las tres decididas antes, verificadas dentro, y anotadas aquí. Ninguna se aplicó
apoyándose en que la anterior hubiera salido bien.
