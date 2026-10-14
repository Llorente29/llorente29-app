# B01 · El aviso #178 de producción: 27 rojos «Plan traído» de Foodint

Respuesta 6 del B01, punto 3: «explica qué marca cada rojo, agrupado por
comprobación, solo con recuentos y códigos de cuenta; di de dónde viene; di
quién debería arreglarlo y cómo. No lo arregles tú.»

Todo medido en producción el 14/10/2026, **solo leyendo** (`select`). Aquí solo
hay recuentos y códigos de cuenta: ni nombres de terceros ni importes. **No he
cambiado nada.**

## 1. Qué marca cada rojo

El agente «Plan contable» (`scripts/conta/agente-plan-contable.mjs`) revisa los
planes traídos con `revisarImportaciones` (`scripts/conta/lib/agentePlan.mjs`,
líneas 152–180). Foodint tiene 157 cuentas con `source = 'migrated'`. Cada
comprobación, con lo que da hoy:

| Comprobación | Línea | Rojos |
|---|---|---:|
| La cuenta dice venir de otro programa y **no tiene importación** (`import_id` vacío) | 160 | **27** |
| Su importación no está «traída» | 161 | 0 |
| Su código no es ninguno de los que traía el fichero | 162 | 0 |
| No guarda el nombre que tenía en el otro programa | 163 | 0 |
| Un enlace apunta a una cuenta que ya no existe | 168 | 0 |
| El mismo enlace dos veces con el mismo papel | 170 | 0 |
| Una importación deshecha deja cuentas o fichas | 177 | 0 |

**Los 27 son la misma comprobación**, la de la línea 160. Por grupo:

| Grupo | Cuentas | Códigos | Apuntes traídos de Diez | Apuntes de Folvy |
|---|---:|---|---:|---:|
| 410 | 7 | 41000034 a 41000040 | 46 | 0 |
| 572 | 1 | 57200003 | 154 | 0 |
| 624 | 1 | 62400002 | 2 | 0 |
| 627 | 2 | 62700002, 62700003 | 74 | 0 |
| 629 | 1 | 62900006 | 9 | 0 |
| 700 | 9 | 70000001 a 70000008, 70000011 | 496 | 177 (los 55 asientos de ventas de octubre, propuestos) |
| 708 | 6 | 70800001, 70800002, 70800004, 70800005, 70800006, 70800011 | 29 | 0 |
| **Total** | **27** | | **810** | **177** |

Lo que tienen en común las 27:

- Las creó «Diez (traída)» el **12/10 a las 21:04 UTC**, a la vez, en la única
  lectura del histórico de Diez (`import_run`, tipo `historico`, estado
  `hecho`, de 21:04 a 21:04).
- Ninguna venía en el fichero del plan que se trajo el 06/10: la importación de
  Foodint (una, «traída») solo trae los otros 130 códigos.
- Todas tienen el nombre de Diez guardado (`name_source`), cuelgan de una hoja
  del plan (`own`) y están activas.
- **Todas tienen apuntes**: 987 en total, todos de 2026. Son cuentas de verdad.

## 2. De dónde viene

**No son datos mal ni un fallo del plan traído (C02c): es una regla del agente
que se quedó corta cuando llegó un segundo camino de entrada.**

- El agente se escribió con el C02c (traer el plan de otro programa). Entonces
  la única forma de que una cuenta fuese `migrated` era una importación del plan
  (`company_chart_import`), y la regla dice: «si dice venir de otro programa,
  tiene que tener su importación».
- El C04b (T3, el escritor del histórico de Diez,
  `supabase/migrations/20261019T0150_diez_importar.sql`,
  `conta_diez_subcuentas`, líneas 100–108) abrió un segundo camino. Al traer
  los asientos de Diez, da de alta las subcuentas que usan esos asientos y que
  no estaban en el fichero del plan. Las marca `source = 'migrated'` y
  `import_id = null` **a propósito**: no vienen de ninguna importación del plan,
  sino de una lectura del histórico (`import_run`). Pero en `company_account` no
  queda escrito de qué lectura vienen, así que el agente no tiene dónde mirarlo.
- Que las cuentas existan y estén así es lo correcto: sin ellas, los 810 apuntes
  traídos no tendrían cuenta, y los asientos de ventas de octubre no tendrían
  sus 700. Lo que falta es **dejar escrita su procedencia**, y que el agente la
  acepte.

Una nota para el B01: la **57200003** es una de las 27. La 0170 de la tanda del
B01 le da su ficha de banco y no toca la cuenta, así que no cambia nada de esto.

## 3. Quién debería arreglarlo y cómo

**Quién:** el frente de **C04b**, dueño del escritor del histórico. Y el del
**C02c**, dueño de la regla del agente, para que la regla cambie con el mismo
criterio. No lo arreglo yo.

**Cómo, lo que propongo (dos pasos, cada uno en su tanda):**

1. **Que la procedencia quede escrita.**
   - Una columna nueva que admite nulos, `company_account.import_run_id` (añadir: pasa siempre).
   - `conta_diez_subcuentas` la rellena con la lectura en curso (cambiar en caliente una función con la misma firma, con su prueba de staging).
   - Rellenar las 27 que ya existen con la lectura del 12/10. Esto **cambia filas que ya existen**, así que pide «autorizo».
   - No se borra ni se vuelve a crear ninguna cuenta: las 700 las usan los asientos de ventas de octubre.
2. **Que el agente acepte los dos caminos** (`agentePlan.mjs`, línea 160).
   - Una cuenta `migrated` es buena si tiene su importación del plan (como hasta ahora) **o** su lectura del histórico en estado `hecho` y de la misma cuenta.
   - En el segundo caso, en vez de «su código venía en el fichero», comprueba que la cuenta tiene apuntes traídos de esa lectura.
   - La prueba, escrita contra estas 27 de verdad (regla 31), en recuentos y códigos.

**Lo que no recomiendo:** que el agente perdone las cuentas por
`created_by_name = 'Diez (traída)'`. Es un nombre dentro de una cadena: no prueba
de dónde vino la cuenta, y cualquier cosa escrita con ese nombre pasaría.

Mientras no se arregle, el #178 seguirá saliendo cada noche con los mismos 27, y
un rojo de verdad en el plan de Foodint quedaría tapado entre ellos (regla 7).
