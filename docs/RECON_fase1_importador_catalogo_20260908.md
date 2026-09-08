# El importador de catálogo no descubre catálogos — y el arreglo ya está escrito en el repo

**08/09/2026 · después del `dry_run` del §8 · nada tocado.**

---

## 1 · Primero, una corrección mía: el discriminador de mi RECON medía otra cosa

En `RECON_gestion_de_modificadores_20260908.md` §3 monté esto como prueba de que el
importador dejaba caer los grupos:

| platos importados del TPV | con algún modificador |
|---|---|
| hasta el 20/06 | 27,0 % |
| después del 20/06 | 3,1 % |

**El `dry_run` deja esa lectura sin pie.** Si el importador devuelve 0 productos, no
pudo traer esos 32 platos. Así que fui a mirar de dónde salieron:

- **31 de los 32 nacieron dentro de los 5 minutos siguientes a su primera venta.**
- Los 32 están en el espejo del catálogo.

O sea: **los trajo el alta automática desde venta huérfana, no el importador.** Y un
plato que nace de una VENTA no puede traer modificadores, porque una línea de venta no
lleva los grupos del catálogo. El 3,1 % no era «el importador los deja caer»: era
«estos platos no han pasado por el catálogo en su vida».

Mi mecanismo estaba mal. El problema de fondo resultó ser peor que el que yo describí,
pero eso no salva la inferencia: **la hice sobre una población que no era la que creía.**
Regla 31, y esta vez en mi propio discriminador.

---

## 2 · La respuesta al §8: el arreglo lleva escrito en el repo desde el 12/08

El §8 pregunta qué trae hoy `/locations/{id}` en `brands[].catalogs`, y si el catálogo
canónico se movió de sitio. **No hace falta inspeccionar el JSON crudo: la función
hermana ya lo averiguó, lo dejó escrito y usa el endpoint bueno.**

`supabase/functions/last-catalog-sync/index.ts:193-199`, comentario textual:

> Lista **AUTORITATIVA** de catálogos de un local: `GET /catalogs?locationId=`.
> El walk de `brands[].catalogs` (vía `/locations/{id}`) **NO es exhaustivo por sí
> solo** — verificado en vivo el 12/08 contra Foodint Carabanchel: el walk encontró 8
> catálogos (208 productos) cuando la medición a mano (y `/catalogs?locationId=`) dan
> la carta completa. […] `/catalogs?locationId=` manda; `brands[].catalogs` sólo
> aporta la etiqueta de marca/canal cuando la tiene.

Las dos funciones, lado a lado:

| | descubre catálogos con | resultado hoy |
|---|---|---|
| `last-catalog-sync` (línea 205) | `GET /catalogs?locationId=` **y** `/locations/{id}` sólo para la etiqueta | **41 catálogos · 4.444 productos · 19 marcas** |
| `lastapp-catalog-import` (línea 235-244) | sólo `/locations/{id}` → `brands[].catalogs.default`; si viene vacío, `continue` | **0 catálogos · 0 productos · 20 marcas `skipped_empty`** |

**Y el espejo está vivo:** última pasada **hoy 08/09 a la 01:00**. No es que el endpoint
haya muerto y haya que buscar otro — es que **el importador usa el que no es**, y su
hermana lleva 27 días usando el bueno.

Por eso `brands_skipped_empty` listaba a Chivuos: `brands[].catalogs.default` viene
vacío para ella, y ahí el importador se rinde. `/catalogs?locationId=` la habría
encontrado, que es lo que hace el espejo con sus 4.444 productos.

**Lo que esto ahorra:** el §8 daba por trabajo «ver qué trae hoy el JSON crudo». No hace
falta. El arreglo de la fase 1 es adoptar `resolveLocationCatalogs` —o su patrón— de
`last-catalog-sync`. Código que ya corre en producción todas las noches.

---

## 3 · Lo que esto cambia del plan del §6/§8

El paso ② («arreglar el importador») queda en tres, y en este orden:

1. **Fase 1 — descubrir catálogo por `/catalogs?locationId=`.** Es el arreglo que
   desbloquea todo lo demás: sin catálogos no hay productos, ni grupos, ni opciones que
   upsertear. Y no se escribe de cero: se toma de la hermana.
2. **Marca por id, no por nombre.** Ahora con pruebas: en cuanto la fase 1 traiga
   catálogos, «Milanesa Haus» (Last) contra «Milanesa House» (Folvy) y «Dirty joes»
   contra «Dirty Burger» empiezan a caer en `brands_unresolved`. Y un grupo que no
   resuelve marca hoy se salta **en silencio** (`continue`): eso pasa a decirse
   (regla 7 — el umbral ordena, no decide quién existe).
3. **Upsert de verdad**, con la decisión 1 de Julio: el TPV manda en nombre, precio,
   orden, activo y asignaciones; jamás toca `modifier_recipe_impact`.

**Una advertencia sobre el orden, que no es teórica.** Arreglar la fase 1 sin arreglar
antes el upsert y la marca hace que entren de golpe **41 catálogos y ~4.444 productos**
donde hoy hay 568 platos. Con `upsertByExternalId` como está —insertar-o-saltar— eso es
una avalancha de inserciones sin posibilidad de corregirlas después, y con la marca por
nombre, un porrón de `brands_unresolved` o, peor, filas colgadas de la marca
equivocada. **La fase 1 va con `dry_run` primero, se lee cuántos entrarían, y sólo
entonces se decide.** Un importador que no traía nada es malo; uno que trae 4.000 filas
mal casadas es peor y se limpia a mano.

Y hay una pregunta de concepto que no es mía: **¿los 4.444 productos del espejo deben
entrar todos como `menu_item`?** Hoy Folvy tiene 568. El espejo es el catálogo completo
de 41 catálogos por canal; puede que muchos sean el mismo plato repetido por canal. Eso
se mide antes de abrir el grifo, no después.

---

## 4 · El cadáver de configuración del §8

La fila de `external_integration` con org `31f13f35…` devuelve 404
`ORGANIZATION_NOT_EXISTS`. Mientras siga ahí, cada pasada del importador gasta una
llamada en fallar y mete ruido en el informe. No la borro: es dato de producción y va
con Julio delante (F2). Queda anotada.

---

## 5 · Lo que NO he hecho, y por qué

**No he inspeccionado el JSON crudo de `/locations/{id}`.** El §8 me daba el token
`LASTAPP_TOKEN_FOODINT_NUEVO` para hacerlo, pero (a) no lo tengo: es un secreto de
Supabase y no está en mi entorno, y (b) el proxy de red de esta sesión corta la salida
igual que cortó `functions/` y Storage. Y sobre todo (c): **ya no hace falta.** La
respuesta estaba en el repo, y viene con fecha de verificación en vivo y con 4.444
productos de prueba corriendo cada noche.

---

# Respuesta al §10 · ¿el importador debe leer del espejo?

**No, y el motivo es corto: el espejo no tiene lo que el importador necesita.**

`external_catalog_product` guarda **productos y nada más** — `catalog_product_id`,
`organization_product_id`, `external_catalog_id`, nombre, `price_cents`,
`product_type`, `is_enabled`, canal, fechas. **No guarda categorías, ni grupos de
modificadores, ni opciones, ni slots de combo**, que es justamente el trabajo del
importador de la fase 2 en adelante. Leer del espejo lo dejaría sin la mitad de su
tarea y habría que volver a llamar a Last igualmente.

**Pero la preocupación de fondo es correcta y tiene mejor arreglo: compartir el
CÓDIGO, no el dato.**

Hoy cada función tiene su propia copia de `lastGet` y su propio descubrimiento de
catálogos — uno bueno y uno viejo conviviendo, que es exactamente el bug que nos ha
costado esto. Y ya existe `supabase/functions/_shared/`, que usan las dos (de ahí
sacan `cors`), así que el sitio está hecho: falta `_shared/lastapp.ts` con `lastGet` y
`resolveLocationCatalogs`, importado por `last-catalog-sync` y por
`lastapp-catalog-import`.

**Por qué es mejor que compartir el dato:** una función es determinista y se prueba;
el espejo es una tabla con su propia frescura. Si el importador leyera de él, el día
que el espejo falle una pasada el importador traería una carta vieja **sin
enterarse** — un tercer camino de fallo silencioso. Compartiendo el código, las dos
descubren igual y ninguna depende de que la otra haya corrido.

**Una sola fuente de descubrimiento, sí. Que sea una función, no una tabla.**
