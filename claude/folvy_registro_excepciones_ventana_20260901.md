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
