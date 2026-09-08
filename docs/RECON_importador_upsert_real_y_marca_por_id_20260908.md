# ② Importador: upsert de verdad + marca por id — lo medido y lo que cambia

**Fecha:** 08/09/2026 · **Rama:** `claude/schema-migrations-repo-40d7u8` · **Estado:** al repo, SIN
desplegar. Espera `dry_run` y a Julio (F2).
**Encargo:** §7.6.1 de `ENCARGO_CODE_gestion_de_modificadores`. De los tres puntos, dos ya iban en
`415fbb44` («Van Van» a descartadas, mecanismo de `skipped_empty` confirmado). Esto es el tercero.

---

## §1 · Lo que apareció al ir a escribir el upsert, y que cambia el diseño

La decisión 1 dice «el importador pasa a upsert de verdad sobre las filas del TPV». Antes de escribirlo
había que saber **con qué clave** se casa una fila de Last con la de Folvy. La que usaba `upsertByExternalId`
es `(account_id, external_source, external_id)`. Medido en Foodint (regla 9, todo con `account_id`):

```sql
with cuenta as (select id from accounts where name ilike '%foodint%' limit 1),
etiquetados as (
  select mi.external_id, b.ownership_type
  from menu_item mi join brand b on b.id = mi.brand_id
  where mi.account_id=(select id from cuenta)
    and mi.external_source='lastapp' and mi.external_id is not null)
select count(*) filas, count(distinct external_id) ids,
  (select count(*) from (select external_id from etiquetados group by 1
      having count(distinct ownership_type)>1) x) ids_own_y_licensed,
  (select count(*) from (select external_id from etiquetados group by 1
      having count(*)>1) y) ids_repetidos
from etiquetados;
```

| filas etiquetadas | external_id distintos | ids repetidos | ids con PROPIA y CEDIDA a la vez |
|---|---|---|---|
| **513** | **361** | **28** | **7** |

**`external_id` no identifica una fila de `menu_item`.** Y no es un error de datos: son **las bebidas**.
Last tiene UN producto «COCA-COLA ORIGINAL» (`ec807d42-b811-4f78-be71-dc2eefef6890`) y Folvy tiene una ficha
por marca — **nueve** para ese id: Lobbers (cedida) y Meraki Pita, Milanesa House, Scandal Burgers, Mila's
Sandwiches, Smash Brothers, Bendito Burrito, Dirty Burger, The Urban Kebab. Igual `MAHOU 5 ESTRELLAS` (8),
`AGUA 50 CL` (8), `FANTA NARANJA` (8), `FANTA LIMÓN` (5), `COCA-COLA ZERO` (8).

Con esa clave, el mapa `external_id -> id de Folvy` se quedaba con **una** de las nueve, y cuál dependía del
orden en que llegaran los catálogos. Mientras el importador **sólo insertaba**, apenas se notaba. En cuanto
**actualiza**, escribe la Coca-Cola de Lobbers encima de la de Meraki Pita.

**La clave lleva ahora el ÁMBITO.** Medido: con el ámbito, **0 pares repetidos en las seis tablas**.

| tabla | ámbito | filas / ids hoy | pares repetidos |
|---|---|---|---|
| `menu_item` | `brand_id` | 513 / 361 | **0** |
| `menu_category` | `brand_id` | 129 / 129 | 0 |
| `modifier_group` | *(external_id solo, a propósito)* | 50 / 50 | 0 |
| `modifier_option` | `modifier_group_id` | 199 / 199 | 0 |
| `combo_slot` | `combo_item_id` | 132 / 132 | 0 |
| `combo_slot_option` | `combo_slot_id` | 381 / 381 | 0 |

`modifier_group` es la excepción **deliberada**: su ámbito natural sería `brand_id`, pero la marca de un
grupo la decide «la primera marca que lo usa» y ese orden no es estable entre pasadas. Con `brand_id` en la
clave, un baile de orden **crearía un grupo duplicado en otra marca** en vez de actualizar el que hay. Va
por `external_id` solo, y `brand_id` no se actualiza nunca: el grupo se queda donde está.

*Y esto es deuda que queda declarada:* ninguna de las seis tablas tiene una restricción UNIQUE sobre
`(account_id, external_source, external_id)` ni sobre el par con ámbito. La idempotencia del importador vive
entera en su propio `select`. Verificado con `pg_constraint` (contype `u`/`p`): lo único que hay es
`menu_category_brand_id_slug_key`, `menu_item_brand_channel_recipe_unique` y la de
`modifier_group_assignment (grupo, plato)`.

## §2 · La marca por id ya tenía tabla, y el importador no la miraba

`external_brand_map` existe desde el **12/06** con la forma exacta que hacía falta:
`UNIQUE (account_id, source, external_location_id, external_brand_id) -> brand_id`, más `is_ignored` con un
CHECK que obliga a `brand_id IS NULL` cuando se ignora.

En Foodint, `source='lastapp'`: **48 filas, 48 ids de Last distintos, 6 locales, 17 marcas de Folvy, 1
ignorada, 0 ids con dos destinos.** El importador resolvía por **nombre normalizado**, que es lo que obliga a
tener el alias `"dirty burgers" -> "dirty burger"` y lo que deja **«Milanesa Haus» (cedida) a un tilde de
«Milanesa House» (propia)**.

El recorrido de `brands[].catalogs` ya tenía delante el `id` de la marca y lo tiraba. Ahora `CatalogInfo`
lleva `brandId`, y `resuelveMarca` va **por id primero**, por nombre después — y el informe dice por cuál fue
cada una (`marcas_por_id`, `marcas_por_nombre`). Lo que caiga en la lista de nombres es lo que queda por
mapear; el número que hay que ir bajando.

## §3 · La guarda: `ownership_type`, no `external_source`

Medido (mismo día):

| ownership_type | platos activos | con `external_source='lastapp'` | sin la etiqueta |
|---|---|---|---|
| `licensed` (9 marcas) | 307 | 283 | 24 |
| `own` (9 marcas) | 255 | **206** | 49 |

**206 platos vivos de marcas PROPIAS llevan la etiqueta `lastapp`** — cadáver de junio. O sea que «¿esto lo
trae Last?» **no se puede preguntar mirando `external_source`**: para 206 filas de marcas cuya verdad es
Folvy, la respuesta es que sí. Se pregunta por `brand.ownership_type`, y eso es lo que hace la guarda:
resuelva por id o por nombre, si la marca de Folvy no es `licensed`, **no se importa nada suyo** y sale en
`marcas_propias_rechazadas` con el motivo.

## §4 · Qué campos manda Last, y cuáles no se tocan

En un solo sitio (`CAMPOS_DE_LAST`), para que ampliarlo se vea en el diff:

| tabla | Last manda en |
|---|---|
| `menu_category` | `name` |
| `menu_item` | `name`, `price`, `is_available`, `menu_category_id`, `product_type` |
| `modifier_group` | `name`, `min_selections`, `max_selections` |
| `modifier_option` | `name`, `price_impact`, `position` |
| `combo_slot` | `name`, `min/max_selections`, `position` |
| `combo_slot_option` | `menu_item_id`, `price_impact`, `position` |

**Ausencias deliberadas**, todas con motivo:
- `menu_item.recipe_item_id` — el escandallo. Es de Folvy. Pisarlo sería tirar el trabajo del cocinero.
- `menu_item.vat_rate`, `packaging_*`, `target_food_cost_pct`, `notes_internal`, `tags`, `kitchen_name` — de
  Folvy; Last ni los tiene.
- `menu_item.archived_at` — archivar es un acto de Folvy. Esta función **no archiva ni desarchiva**.
- `modifier_group.group_type` — lo **infiere** `inferGroupType` por el nombre. Es una interpretación de
  Folvy y un humano puede haberla corregido: no se pisa cada pasada con el resultado de una heurística.
- `modifier_group.brand_id` — ver §1.
- `modifier_option.recipe_item_id` — de Folvy (hoy columna muerta, deuda ya declarada).

**Y sólo se escribe lo que de verdad cambia.** `numeric` vuelve de PostgREST como cadena (`"2.6"`), así que
comparar con `===` marcaría cada fila como cambiada en cada pasada y el informe diría «actualizadas: 500»
para siempre. `mismoValor` compara números como números. En régimen, `actualizadas` debe ser pequeño y
`sin_cambios` grande: si no lo es, el que miente es el comparador.

## §5 · `is_active`: decidido, pero detrás de un interruptor

La decisión 1 dice que Last manda también en activo/inactivo. Está implementado, y va detrás de
`aplicar_activo: true` en el cuerpo de la petición, **por defecto false**. Motivo: son cientos de filas que
pueden cambiar de estado en la PRIMERA pasada, y una pantalla que se vacía (o se llena) de golpe no se
distingue de una avería.

**Lo que no se puede desactivar es contarlo.** El informe siempre trae
`sobrantes.platos_inactivos_que_last_si_sirve` (los que se encenderían) y
`sobrantes.platos_que_last_no_sirve` **con nombre y marca, hasta 15 de ejemplo**. Con el número delante,
Julio dice «aplícalo» y es una pasada más. Regla 7: se cuenta y se lista, no se esconde; y regla 8: la
respuesta lleva contenido, no un visto.

## §6 · Lo que sobra se cuenta, no se borra

Tres cifras nuevas, ninguna destructiva:

- `platos_que_last_no_sirve` — vivos en Folvy, de marcas cedidas, que la carta de Last ya no trae.
- `platos_inactivos_que_last_si_sirve` — lo que encendería `aplicar_activo`.
- `asignaciones_que_last_no_tiene` — grupo→plato que Folvy tiene y Last ya no manda. **Es la cifra que dirá
  si la pantalla de Modificadores está enseñando preguntas que el cliente ya no ve.** Si la medición falla a
  medias devuelve `null`, no media cifra.

Un plato que desaparece de la carta de Last puede ser una baja de verdad o una pasada incompleta de Last, y
la diferencia no se ve desde dentro de una pasada. Borrar eso es decisión de Julio con la lista delante.

## §7 · Verificación

- `deno check` verde en `lastapp-catalog-import`, `_shared/lastapp.ts` y `last-catalog-sync` (intacta, sigue
  con su copia: deuda declarada del §7.4).
- `npm run build` verde (B42: build, no `tsc --noEmit`).
- **Sin tocar `src/`**: el diff de la rama contra `main` no incluye un solo fichero de `src/` ni de `tests/`,
  así que el lint y las pruebas son los mismos a los dos lados por construcción.
- **Las 6 pruebas rojas que hay hoy son de `main`, no de esta rama.** Medido a los dos lados (regla 31): en
  la rama, 6 fallos / 983 pasan; en un worktree de `origin/main`, los **mismos tres ficheros y los mismos 6
  fallos**. Son pruebas viejas que se han quedado detrás del código: `routes.test.ts` afirma
  «PUBLIC_AUTH_ROUTES tiene exactamente 4» y hoy tiene 5 (entró `/acceso`), y los dos mappers de
  multitenancy esperan `null` donde el código devuelve `undefined`. **No es mío y no lo he tocado**: va a la
  lista de deudas.
- La prueba de verdad de esto es el `dry_run` contra producción, que es lo que no puedo lanzar yo (el proxy
  del agente devuelve `403 CONNECT` para `*.supabase.co/functions`).

## §8 · Qué mirar en el `dry_run`, y contra qué

Misma vara a los dos lados. Del `dry_run` de v53 (§7.5) tenemos: **71 catálogos, 186 products, 41 combos,
8 `brands_in_use`, 11 `skipped_empty`, 1 `unresolved` («Van Van»), 0 warnings.**

| campo | qué debe salir | qué significa si no |
|---|---|---|
| `catalogs_discovered` | **71** | si baja, el descubrimiento se ha vuelto a romper |
| `products` | **186** | si cambia mucho, Last movió la carta |
| `brands_unresolved` | **[]** | «Van Van» ya no debe salir: está descartada |
| `brands_discarded` | «Van Van», «FOODINT» | la lista de descartes a propósito |
| `marcas_por_id` | > 0, idealmente todas | si es 0, el mapa por id no está entrando |
| `marcas_por_nombre` | lo más corto posible | lo que falta por mapear en `external_brand_map` |
| `marcas_propias_rechazadas` | **[]** | si trae algo, un nombre de Last apunta a una carta cuya verdad es Folvy: **mirar antes de aplicar** |
| `tablas.menu_item.nuevas / .actualizadas / .sin_cambios` | — | el primer `actualizadas` de verdad; `cambios_ejemplo` trae hasta 10 con su antes y su después |
| `sobrantes.*` | — | lo que habría que dar de baja, con nombre |

## §9 · Dos preguntas para Julio, salidas de la medición

1. **«Lobbers» es una NOVENA marca cedida.** El §7.1 lista 8 y la base tiene 9 `licensed`. La de más es
   Lobbers: **11 platos vivos, todos del 20/06, todos etiquetados `lastapp`, y todos bebidas** (`FANTA
   LIMON`, `COCA-COLA ZERO`, `MAHOU 5 ESTRELLAS`, `AGUA 50 CL`, `COCA-COLA ORIGINAL`, en mayúsculas, frente
   a las «Coca-Cola Original Lata» de las propias). Es además **el único catálogo de los 55 que el recorrido
   no atribuye** (el hallazgo del §19). ¿Es una cedida de verdad que hay que importar, o un cadáver de junio
   que debería ir a `is_ignored` en `external_brand_map`? Si es cadáver, sus 11 bebidas dejan de ser las
   filas que compiten con las de las propias por el mismo `external_id`.
2. **`aplicar_activo`.** Por defecto va a false y el informe cuenta lo que cambiaría. Dime el número que
   veas y si lo enciendo.
