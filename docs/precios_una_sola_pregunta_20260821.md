# ENCARGO «El gestor de precios pide cinco decisiones» — resultado

Fecha: 21/08/2026 · Commit `b9b81bf` · `main` y `claude/redesign-pricing-modal-amxuzy`

## Lo que hay que corregir del encargo: la decisión 5 no fue lo que parecía

§2 fila 5 dice que el ensayo corrió con Alcalá y la publicación con toda la cuenta.
Es cierto, pero **la publicación no salió del botón de publicar**. Los logs del 21/08:

```
07:44:55  hubrise-catalog-publish   scope=single(Alcalá)  catálogos=1/2  dry_run=true
07:45:18  hubrise-brand-connect     ← botón «Conectar a delivery»
07:45:21  hubrise-catalog-publish   scope=all             catálogos=2/2  dry_run=false
07:45:23  hubrise-brand-connect     200
```

`confirmarPublicacion()` siempre publicó con el mismo local que el ensayo; ese
código estaba bien. Lo que pasó es que Julio cerró el ensayo y pulsó **el botón de
al lado**, «Conectar a delivery», que:

1. Acota cuidadosamente su propio trabajo a un local (líneas 133-185), y
2. luego publica con `{ brand_id }` a secas → `scope=all`.

Y el panel nunca le pasaba el local: `connectBrandToDelivery(selectedBrand.id)`.
**El ámbito se perdía dos veces, en dos ficheros.** Eso es lo que republicó
Carabanchel, que es un escaparate vivo.

**Arreglado y desplegado**: `hubrise-brand-connect` **v8**, verificada byte a byte.
Antes de desplegar se comprobó que la copia del repo era la de producción (v7 se
desplegó 18:40:44 CEST, el commit del repo es de 18:41:13 — 29 segundos después).

Es una **sexta** decisión oculta, y de las peores: dos botones adyacentes, uno de
ellos publica todo sin decirlo.

## §3 · Las cifras del encargo son correctas y son de producción

| | Foodint | Folvy Interno |
|---|---:|---:|
| Precios por canal | 67 | 13 |
| De ámbito cuenta | 58 | 13 |
| De ámbito local | **9** | 0 |
| De ellos, con gemelo de cuenta | **9 de 9** | — |

80 en total. **Las 9 están en producción.** El diagnóstico se sostiene entero.

Y es peor de lo que dice el encargo. `effective_price()` resuelve
**(canal+local) > (local) > (canal) > base**, así que en Alcalá mandaba el del
**19/08**, no el que Julio escribió el 21/08. Su cambio de hoy sólo tenía efecto en
Carabanchel. Coincidían en el número, así que no se vio.

## §4 · Lo que hace la pantalla ahora

**Una pregunta: «¿qué carta?» y «¿dónde?».** De esa única variable salen la
escritura, el texto de la barra de guardado y el alcance de publicar — no pueden
discrepar porque son la misma.

### 4.1 · Cada canal dice si llega

`channel_publish_route` llevaba puesta desde el 18/08 y **no la consumía nadie**
(cuarta pata otra vez). Ahora sí:

| Local | Glovo | Uber | Just Eat |
|---|---|---|---|
| Foodint Alcalá | **Se gestiona en Last** 🔒 | Publica Folvy | Publica Folvy |
| Foodint Carabanchel | **Se gestiona en Last** 🔒 | **Se gestiona en Last** 🔒 | **Se gestiona en Last** 🔒 |

La celda con candado **no se abre** — ni desde el teclado ni desde la operación en
lote, que era una puerta de atrás.

**Dos cosas que no se inventan:**

- Un canal de reparto **sin fila** queda «sin declarar» y **se puede editar**.
  Folvy Interno y Kitchen Grill no tienen ni una fila: bloquear por falta de dato
  dejaría la pantalla inútil en dos cuentas de tres. Un hueco es un dato; tratarlo
  como un «no» sería inventar.
- **Mostrador y Shop no son de reparto** y no reciben un aviso falso: su precio
  vale dentro de Folvy en cuanto se guarda.

### 4.2 · Un solo precio por celda

La chapa de la celda ya no dice «propio del local» / «hereda» sino
«sólo en Foodint Alcalá» / «precio de la carta» / «igual que el base».

### 4.3 · Cambiar y publicar, un solo botón

Al guardar sale la frase, con las dos salidas:

> **3 precios cambiados en Meraki Pita · Foodint Alcalá.**
> Se publicarán en **Uber** y **Just Eat**.
> **Glovo no**: se gestiona en Last.
> [ Publicar ahora ]  [ Dejarlo guardado sin publicar ]

Si ningún canal de ese local publica desde Folvy (Carabanchel hoy), lo dice:
*«De aquí no sale nada a ninguna plataforma»*, y el botón queda apagado.

### 4.4 · Publicar va exactamente donde dice la pantalla

`publishBrandCatalog(brandId, locationId)` — la misma `locationId` que gobierna la
escritura. Aquí **no hay dos actos que puedan divergir**: la propia pantalla es el
ensayo (ya dijo canal por canal a dónde llega), así que sale **una** línea de log
con el scope, no dos. El criterio 3 —`scope=single(...)` en los dos— sigue
aplicando al flujo de la pantalla de carta, donde el ensayo y la confirmación son
dos clics; ahí lo que se ha arreglado es el tercer botón que se saltaba los dos.

## Un hallazgo de paso: un local cerrado en el desplegable

Foodint tiene **tres** locales y **Plaza Castilla está `active = false`** (con
Meraki Pita todavía marcada como disponible allí). La pantalla los cargaba sin
filtrar: habría ofrecido un local cerrado y habría dicho «los 3 locales» cuando son
2 — y ese número es justo el que se lee antes de escribir. Ahora sólo salen los
abiertos.

## §5 · Los 9 duplicados, resueltos

Migración `20260821T0900_precios_duplicados_local_y_cuenta.sql`, **aplicada**.

Son los 3 productos × 3 canales de Meraki Pita en Alcalá — los mismos que Julio
tocó. Escritos en ámbito local el 19/08 y en ámbito cuenta el 21/08.

El `SELECT` previo no va en un chat: va **dentro de la transacción**. Se fotografía
`effective_price()` de los 9 antes, se borra, se vuelve a fotografiar y se comparan.
Si un solo céntimo se hubiera movido, la migración revienta y revierte entera.
Además, la igualdad de precio es parte del **filtro**: una fila con precio distinto
sería una excepción de verdad y no puede entrar ni por accidente.

Verificado después con consulta independiente — los 18 precios (3 productos × 2
locales × 3 canales):

| Producto | Base | Se publica |
|---|---:|---:|
| Crispy Falafel & Greek Dip | 6,50 | **7,90** |
| Pita BOWL Mixto | 14,80 | **16,30** |
| The Mixed Master | 13,90 | **15,90** |

Iguales en los dos locales, iguales en los tres canales, iguales que antes.
El rastro lo deja solo el trigger `trg_menu_item_override_history` con `op='delete'`.

⚠️ **Ojo con la primera consulta de verificación que hice**: «Meraki Pita» existe en
Foodint **y** en Folvy Interno, y «Foodint Plaza Castilla» también. Una consulta por
nombre devuelve las dos cuentas mezcladas. La migración sí iba clavada por UUID de
cuenta; la que estaba mal era mi comprobación, y se rehízo por `brand_id`.

## Criterios

| # | Criterio | Estado |
|---|---|---|
| 1 | Glovo en Alcalá dice «se gestiona en Last» y no deja escribir | ✅ |
| 2 | Al guardar, una frase con cuántos, dónde, a qué canales sí y a cuáles no | ✅ |
| 3 | Ensayo y publicación con el mismo ámbito | ✅ arreglado en el sitio real (`hubrise-brand-connect` v8); en la rejilla no hay dos actos que divergir |
| 4 | Ni «ámbito» ni «override» en pantalla | ✅ 0 ocurrencias visibles |
| 5 | Los 9 duplicados resueltos con prueba previa | ✅ y la prueba va dentro de la transacción |
| 6 | Alguien que no la haya visto sube tres precios sin preguntar nada | ⏳ **de Julio** |

## Comprobaciones

`tsc` limpio · `npm run build` limpio · **10 pruebas nuevas** del veredicto de ruta.
`eslint` limpio en `PriceGridPage` y `channelRouteService`.
Los 3 errores de lint de `KitchenMenuPage` y los 5 fallos de test de los mapeadores
de multitenancy **ya estaban** — verificado con `git stash`.
