# RECON · Un admin acotado a un local (José Quintana → Carabanchel)

**01/09/2026.** Encargo: un usuario con **todas** las capacidades de admin
—publicar cartas, cerrar marcas, agotar, albaranes, fichajes, cuadrantes,
informes— pero **solo** sobre Foodint Carabanchel
(`92d7656e-082e-452a-8ebc-236b2d6ebf5f`). Ni ver ni tocar Alcalá ni Plaza
Castilla.

**Nada construido. Esto es solo lo medido.**

---

## Titular: el alcance por local no existe. En ningún sitio.

No es que esté a medias o que unas pantallas lo respeten y otras no. **El modelo
de autorización de Folvy no tiene el concepto de local.** Todo se decide por
CUENTA y por ROL:

| Función | Qué contesta |
|---|---|
| `current_user_account_ids()` | las cuentas del usuario |
| `belongs_to_account(uuid)` | ¿esta cuenta es mía? |
| `current_user_is_admin_or_manager_of(uuid)` | ¿soy admin/manager **en esa cuenta**? |
| `current_user_is_admin()` | ¿soy platform admin? (ve TODO) |

`user_profiles` tiene `account_id` y `role`. **No tiene `location_id`.** Y **no
existe ninguna tabla `user_location`.**

Consecuencia directa, que es lo que hay que entender antes de decidir nada: hoy
**no se puede crear un admin acotado**. Cualquier `role='admin'` en la cuenta
Foodint ve y toca los tres locales, y no hay ni un sitio donde escribir
«solo Carabanchel».

---

## 1 · Inventario de decisiones por rol

### Políticas RLS

| | |
|---|---|
| Políticas totales | **529** |
| Tablas con RLS | **264** |
| Que deciden por rol (`is_admin_or_manager`) | **160** |
| Que deciden por cuenta (`belongs_to_account`) | **80** |
| **Que mencionan el local** | **9** |
| De escritura (insert/update/delete/all) | **310** |

**9 de 529.** Ése es el tamaño real del agujero.

### Funciones

| | |
|---|---|
| `SECURITY DEFINER` totales | **536** |
| Que miran el rol | **111** |
| **Que escriben** (insert/update/delete) | **254** |
| De ésas, con parámetro de local | **32** |

### Las de escritura que nombra el encargo, una a una

| Función | ¿acepta local? | ¿mira rol? | ¿mira cuenta? | **¿mira los locales DEL USUARIO?** |
|---|---|---|---|---|
| `set_brand_status` | sí | sí | — | **no** |
| `set_product_availability` | sí | sí | — | **no** |
| `set_products_availability_bulk` | sí | sí | — | **no** |
| `set_modifier_option_availability` | sí | — | sí | **no** |
| `confirm_goods_receipt` | — | — | sí | **no** |
| `add_manual_clock_entry` | — | — | — | **no** |
| `availability_report` | sí | sí | — | **no** |
| `ctb_receipt_differences` | — | — | sí | **no** |

La columna que importa es la última, y es **«no» en las ocho**. Varias aceptan
un `p_location_id`, pero lo usan para **filtrar**, no para **autorizar**: nadie
comprueba que ese local sea de los tuyos. Un admin acotado que llamara a
`set_brand_status` con el id de Alcalá cerraría Alcalá.

**Separación escritura/lectura que pedías:** las 254 funciones que escriben son
las que pueden hacer daño desde el local equivocado; las de lectura «solo»
filtran información. Pero en este caso las de lectura importan casi igual,
porque el encargo dice **ni verlos** — y ahí el agujero es el mismo.

---

## 2 · Pantallas que asumen «admin ve todo»

El selector global de local (`AppContext.activeLocationId`, leído por
`useLocationScope`) admite el valor **`'all'` = modo consolidado**, y la lista
sale de `fetchLocations(accountId)`: **todos los locales de la cuenta**, sin
filtrar por usuario. Hay además **13 componentes** que deciden algo mirando el
rol.

Con un admin acotado y sin tocar nada:
- vería los tres locales en el desplegable;
- `'all'` le daría los tres consolidados;
- y el servidor le dejaría operar sobre cualquiera de ellos.

**Y aquí la regla que tú mismo pones:** filtrar la lista del selector NO es la
solución. Una pantalla no oculta un botón que el servidor deja pulsar. El
selector es donde se NOTA, no donde se arregla.

---

## 3 · Forma del alcance: tabla, no campo

Recomiendo **`user_location(user_id, location_id)`**, y no un campo único en
`user_profiles`, por tres razones medidas:

1. **Julio no puede necesitar filas.** Es admin sin acotar. Con una tabla, la
   regla es «sin filas = todos los locales», y Julio no se toca. Con un campo
   único habría que inventarle un valor centinela (`NULL` = todos), que es la
   clase de convención que alguien interpreta al revés dentro de seis meses.
2. **José va a uno hoy y puede ir a dos mañana.** Un campo obliga a migrar.
3. Encaja con las 89 tablas que ya tienen `location_id`.

El criterio nuevo sería una función, `current_user_location_ids()`, hermana de
`current_user_account_ids()`, y **una sola**: el criterio no se reescribe en
cada política (Regla 10, que ya mordió hoy).

---

## 4 · Lo que NO puede pasar — comprobado

Cuatro sitios donde José vería Alcalá. Los cuatro fallan hoy, **y por la misma
causa**: el guard mira cuenta, no local.

| Dónde | Qué pasa hoy |
|---|---|
| **Informes** | `availability_report` mira rol y cuenta. Sin filtro de local devuelve los tres. |
| **El 86** | `set_product_availability` / `set_modifier_option_availability` aceptan cualquier `location_id` de la cuenta. |
| **Cierre de marca** | `set_brand_status` igual: el local es un parámetro, no una autorización. |
| **Banner de Orders** | Se alimenta de las mismas lecturas por cuenta. |

Es **el mismo agujero que se tapó esta mañana con el 86 por local**, pero un
piso más abajo: allí el problema era que una pantalla no distinguía locales;
aquí es que **el servidor no distingue usuarios**.

---

## Estado de partida

- Roles en uso: **`admin` y `worker`**. `manager` existe en el código y **no lo
  usa nadie**.
- Admins activos: **3**, uno por cuenta. En Foodint, **solo Julio**.
- Platform admins: **1**.
- **José Quintana no existe todavía** como usuario.

---

## Por qué esto no era de un día, con los números delante

529 políticas, 254 funciones que escriben, 89 tablas con local. No hay parche
intermedio honesto: o el alcance está en la base de datos y lo respetan todas, o
hay un admin que cree estar acotado y no lo está — que es peor que no tenerlo,
porque se opera con confianza.

## Lo que hay que decidir antes de escribir una línea

1. **¿Se acota la lectura además de la escritura?** El encargo dice «ni verlos»,
   así que sí — pero eso toca las 529 políticas, no las 310 de escritura.
2. **¿Qué pasa con `'all'`** en el selector para un usuario acotado: ¿desaparece,
   o significa «todos los MÍOS»? Lo segundo es más útil y más peligroso de
   implementar mal.
3. **¿Los datos que cruzan locales** —escandallos, cartas, artículos de
   almacén— se acotan también, o son de cuenta? Un producto no vive en un local;
   su disponibilidad sí. Sin esta línea trazada, se acota de más y José no puede
   trabajar.
4. **Orden de ataque.** Propuesta: primero las de ESCRITURA que nombra el
   encargo (8), con pruebas por usuario, y solo después la lectura. Es la mitad
   que puede hacer daño real desde el local equivocado.
