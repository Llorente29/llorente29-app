# Fase C · paquete 1 · §0: medir sin tocar

**12/09/2026, 10:30 (reloj de la base).** Nada escrito, nada tocado. Todo `SELECT`
y lectura de código.

El encargo íntegro vive **fuera del repositorio**. De su §0 tengo archivado un
solo punto explícito (el §0.1, sobre el publicador de catálogo). Lo he medido, y
he medido además el terreno que las cuatro pantallas del paquete 1 van a pisar.
**Si el §0 del encargo pide algo más que no esté aquí, dímelo y lo mido.**

---

## 1 · §0.1 · El publicador de catálogo: qué lo dispara, qué publica, cuánto tarda

### Qué lo dispara

**Nadie automáticamente.** `hubrise-catalog-publish` es un `Deno.serve` que sólo
acepta **POST** y valida el **JWT de una persona**. No hay cron, no hay trigger
de base de datos. Lo llaman:

- el front, desde `catalogPublishService.ts` (dos sitios: líneas 193 y 235);
- `hubrise-brand-connect`, al conectar una marca, reusándolo por HTTP con el
  mismo JWT.

**Consecuencia directa para la pantalla, y es la respuesta a la regla 35:** un
cambio en una pregunta o en una opción **no llega a Glovo, Uber ni la web hasta
que alguien pulsa publicar**. La pantalla SÍ necesita el aviso «Pendiente de
publicar». No es una precaución: es cómo funciona hoy.

### Qué publica

El catálogo **entero de UNA marca** (`catalog_source='folvy'`), a precio base:
categorías → products/skus → **`option_lists`, que son los modificadores** →
deals. De los modificadores sale así:

```
modifier_group_assignment  (por menu_item_id)
      -> modifier_group    (sólo los que tienen is_active !== false)
      -> opciones          (sólo las activas)
```

Y **un grupo sin ninguna opción válida se descarta con un aviso**, no se publica
vacío. Eso es una regla de negocio que la ficha de pregunta tiene que enseñar:
una pregunta sin opciones activas no existe para las plataformas.

### Cuánto tarda — medido, no estimado

De `catalog_publish.requested_at` a `max(catalog_publish_target.published_at)`:

| cuenta | publicaciones | más rápida | mediana | más lenta | última |
|---|---:|---:|---:|---:|---|
| Foodint | 100 | 0,7 s | **1,5 s** | 19,1 s | 12/09 08:46 |
| Folvy Interno | 6 | 1,0 s | 1,1 s | 1,4 s | 24/06 19:21 |

La última, la de hoy a las 08:46, tardó **1,0 s** con 1 destino.

**Pero no siempre sale, y eso importa más que el tiempo:**

- destinos: **102 ok, 9 en error** (los 9 sin `published_at`);
- publicaciones: **110 `done`, 6 `failed`, 1 `partial`**;
- el último error dice: `A 'catalog' write scope is required` — permisos de
  HubRise, no nuestros.

**Para la pantalla:** el aviso no puede ser «publicado» a secas. Es rápido (1,5 s
de mediana, así que se puede esperar en pantalla), pero **falla una de cada
doce**, así que el botón tiene que decir qué pasó — regla 8 — y `partial`
existe como estado real.

---

## 2 · El terreno que pisan las cuatro pantallas

Por cuenta, siempre (regla 9). La plantilla `Folvy Interno` comparte tablas y
nombres, y aquí se ve.

| tabla | Foodint | Folvy Interno |
|---|---:|---:|
| `modifier_group` (preguntas) | **65** | 44 |
| `modifier_option` (opciones) | **241** | 163 |
| `modifier_group_assignment` (pregunta puesta en plato) | **271** | 220 |
| `modifier_recipe_impact` | **115** `confirmed` | 3 `proposed` |

En Foodint:

- **`group_type`**: `choice` 46 · `extras` 12 · `removal` 6 · `cross_sell` 1.
- **`impact_type`**: `add_item` 66 · `bundle` 42 · `none` 4 · `remove_item` 3.
- **`external_source`**: `lastapp` 51 · propios (NULL) 14.
- **activas 56, apagadas 9.**

Las 9 apagadas importan para la lista: **una lista de preguntas que sólo enseñe
las activas esconde 9 filas que existen.** Es la regla 7 — el estado ordena y
etiqueta, no decide la existencia.

**RLS:** las cuatro tablas la tienen activada, con una política de lectura y una
de escritura (`ALL`) cada una. No hace falta abrir nada nuevo para las pantallas.

---

## 3 · LO QUE YA ESTÁ CONSTRUIDO, y el hueco exacto

`src/modules/kitchen/services/modifierEditService.ts` (404 líneas) ya tiene casi
todo el trabajo de escritura del paquete 1:

| ya existe | |
|---|---|
| `getProductModifierGroupsEditable` | las preguntas de un plato |
| `createGroupForProduct` | crear pregunta |
| `updateGroup` | editar pregunta |
| `assignExistingGroup` / `unassignGroupFromProduct` | poner y quitar de un plato |
| `addModifierOption` / `updateModifierOption` / `deleteModifierOption` | opciones |
| `listAssignableGroups` | preguntas que se pueden asignar |

**El hueco es de PUNTO DE VISTA, no de funciones.** Todo lo de arriba está
centrado en el **PLATO**: se entra por un plato y se le cuelgan preguntas. El
paquete 1 pide lo contrario — centrado en la **PREGUNTA**:

1. **Lista de preguntas** — todas las de la cuenta, no las de un plato. No existe.
2. **Crear una pregunta** — hoy sólo se puede crear *para un plato*
   (`createGroupForProduct`). Crear una suelta, no.
3. **Ponerla en platos** — existe al revés (`assignExistingGroup(productId, …)`).
   Falta el camino pregunta → muchos platos.
4. **Ficha de pregunta** — no existe. Y es la que necesita enseñar: sus opciones,
   en cuántos platos está, su impacto en el escandallo y si está publicada.

Lo que yo propondría, y es propuesta: **no duplicar** `modifierEditService`. Un
servicio nuevo con la vista por pregunta que reuse esas funciones donde ya
sirven, y añada sólo lo que falta (listar todas, crear suelta, asignar a varios).
Dos servicios escribiendo lo mismo por caminos distintos es cómo se consigue que
una pantalla diga una cosa y la otra diga otra.

---

## 4 · Lo que sigue sin decidir, y ya estaba dicho el 11/09

**El tablero 7 y «enseñar a Folvy el código».** En Last el código es de Last
(`organizationModifierId` → `modifier_option.pos_modifier_id`) y hay dónde
escribirlo. **En HubRise no hay columna, y el código no es suyo: es nuestro**
(`_modifier_option_ref` devuelve `mo.external_id` o `'mo_' || mo.id`). Así que
para una línea de HubRise con una referencia que Folvy no conoce, «guardar la
relación código → extra» **no tiene hoy dónde escribirse**. O se añade una
columna/tabla de referencias aprendidas por origen, o para HubRise el arreglo es
republicar el catálogo. Sigue sin decidir, y el tablero 7 no es del paquete 1,
así que no corre — pero conviene decidirlo antes de llegar.

---

## 5 · Resumen para decidir

1. **El aviso «Pendiente de publicar» va**, y con contenido: publicar es manual,
   tarda 1,5 s de mediana y falla 1 de cada 12.
2. **La lista de preguntas enseña las 65, no las 56.** Las 9 apagadas se
   etiquetan, no se esconden.
3. **Una pregunta sin opciones activas no existe para las plataformas** — el
   publicador la descarta. La ficha tiene que decirlo.
4. **Hay que decidir si el servicio nuevo es por pregunta reusando el que hay**,
   que es lo que propongo, o algo distinto.

Con eso contestado, el §1 puede empezar.
