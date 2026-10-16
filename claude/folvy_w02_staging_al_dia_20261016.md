# W02 · Staging al día, la transición del 1c, `bank_deshacer` y la regla de la plantilla (16/10)

Respuesta a los cinco puntos. Ramas:

- `conta/w02-sin-esperas`: PR #212, listo para revisión y **sin fusionar**;
- `conta/w02-staging-al-dia`: nueva, creada desde la anterior.

**Nada en producción.** Producción solo se ha leído: el catálogo, con
`conta_lectura` desde el workflow, y el historial y los cuerpos de cinco
funciones por el conector.

**Desde tu aviso de las 15:3x no he lanzado ninguna e2e.** El run 426 ya había
acabado a las 15:30, en rojo: no había nada que cancelar. Lo que he empujado
después solo dispara la comparación, que son dos consultas al catálogo de unos
4 s.

**Ojo:** un empuje a `conta/w02-sin-esperas` sí lanza la e2e del push. No vuelvo
a empujar a esa rama sin pedirte hueco.

## 1 · La fusión del 1c: cómo conviven las ramas viejas y las nuevas

Está en la descripción del PR #212, con la tabla de quién coge qué cerrojo. En
corto:

- **La e2e vieja** coge `e2e.cerrojo` toda la e2e y escribe en la plantilla.
- **La e2e de carril** coge:
  - `(4202, 0)` compartido y `(4203, N)` exclusivo, todo el job;
  - **y `e2e.cerrojo` solo durante el clon**, unos 6 s.

  Así, ninguna e2e vieja escribe en la plantilla mientras un carril la copia.
- **`aplicar-staging-conta`** nuevo coge `(4202, 0)` exclusivo y `e2e.cerrojo`.
- **Mismo orden en todos**, primero `(4202, 0)` y luego `e2e.cerrojo`, así que
  no hay abrazo mortal.

Probado en staging, run 38921734363:

- `Cerrojo cogido (carril 1 clonando …) en el intento 1`;
- clon en 6.045 ms;
- `Cerrojo soltado`;
- `e2e.cerrojo después del clon: nadie`.

Lo prueba también `tests/unit/e2e/transicion.test.ts`. Commit `f1d6bf8b`.

## 2 · Que staging no se quede atrás de producción

### El registro

`aplicar-staging-conta` apunta cada fichero en
`supabase_migrations.schema_migrations`, con su huella md5, **en la misma
transacción** que el fichero:

```
psql -1 -f "$f" -f /tmp/registro.sql
```

- **El registro** es el de producción, pero con `on conflict (version) do update`,
  porque staging reaplica a propósito: semillas, pruebas y tandas que se
  corrigen. Lo escribe `analizar.mjs registro-staging`.
- **`real-en-staging.sh`** borra antes, en la misma transacción, un registro de
  ese fichero que haya puesto el manifiesto (`created_by like 'staging aplicar%'`).
  Así su `insert` sigue siendo exactamente el de producción y no choca.
- **Lo aplicado antes del 16/10** sigue sin registro. Hoy el historial de staging
  tiene 551 filas, de ellas 7 con huella. Producción tiene 698, con 159 con
  huella. Para lo de antes está la comparación.

**Sin probar contra la base**: no he aplicado nada en staging para no tocarla
mientras C tiene su tanda. Lo prueban las unitarias
(`tests/conta/staging/comparar.test.ts`). La primera tanda que se aplique desde
esta rama lo estrena.

### La comparación

Es `comparar-staging-produccion.yml`, con el método de C:

- la huella de `prosrc` de cada función de `public` y, aparte, la de sus
  atributos;
- las columnas de cada tabla;
- los disparadores.

**Cómo lee.** La misma consulta a los dos lados (`scripts/conta/staging/comparar.sql`),
solo del catálogo. En producción entra con `conta_lectura` y las cuatro guardas
del nocturno de cumplimiento.

**Qué sale en rojo.** Lo que no está aceptado por nombre exacto y con motivo en
`scripts/conta/staging/diferencias-aceptadas.txt`. Lo aceptado sale igual, en su
sección.

**Qué publica.** El resumen pasa por la puerta de salida: nombres de objetos del
esquema y huellas, nada de datos. Las firmas enteras van al artefacto.

**Cuándo corre:**

- cada noche (02:20 UTC);
- a mano;
- en `aplicar-staging-conta`, antes y después de la tanda. No la para: la tanda
  puede ser la que cierra una diferencia.

**Ensayado:** run 38923607587, contra las dos bases de verdad.

| | |
|---|---|
| Iguales | 458 tablas · 6.066 columnas · 1.057 funciones · 218 disparadores |
| Distintas | **52** |
| Aceptadas (en desarrollo / de staging) | 43 |
| **Rojas** | **9** |

Las mismas que encontró C más una que no estaba en su lista:
`conta_propuesta_ventas_unidad`, con otro cuerpo. Hay 27 funciones solo en
staging, no 26: 25 del TPV de mesas, `order_for_print` y la de la semilla.
Ninguna diferencia en atributos ni en disparadores.

### De dónde sale cada diferencia (no he arreglado ninguna)

| Diferencia | Origen | |
|---|---|---|
| `journal_entry_validar`, `conta_propuesta_ventas_unidad` (cuerpo) | Staging tiene las de **antes del céntimo**: casan, md5 a md5, con `20261019T0160_diez_numeracion` y `20261020T0100_ventas_por_plataforma`. Producción tiene las de `20261113T0100_c06b_centimo_iva`. | roja; se cierra cuando C la aplique |
| `create_account_tx` (cuerpo) | Producción: `20261008124905 alta_de_cuenta_sin_permission_sets`, por el conector el 08/10. Su fichero **solo está en la rama sin fusionar** `fix/alta-de-cuenta-sin-permission-sets` (a106ac28). Es una corrección que vive en producción y no en `main`: la regla 1. | roja |
| `dosier_visita` (solo producción) | `20261006110719` y `20261006114129` en producción. Los ficheros están en `main` (`20261006T1200`, `T1400`). Nunca se aplicaron en staging. | roja |
| `c01b_columnas_eliminadas` (solo producción) y `supplier.address`, `email`, `phone` y `usual_vat_rates` (solo staging) | Una sola migración, `20261006T0140_c01b_elimina`: copia esas 4 columnas a esa tabla y las borra. Está en el historial de producción y nunca entró en el manifiesto de staging. | roja (5) |
| 21 funciones de mesas, `sale_fire`, `sale_line_void` y 8 columnas de `sale` y `sale_line` | **TPV Sala S1 parte B**, `20261009T0040`, en `main` desde el 08/10. En staging, por el conector y `staging/sql/20261008_tpv_sala_s1_lo_que_falta_en_staging.sql`. En producción no, porque va fuera de banda. La parte A sí está (`20261008114424`). | aceptada, en desarrollo |
| `order_for_print`: `(text,uuid)` en producción y `(text,uuid,uuid)` en staging | S1B, punto 6.4 (DROP + CREATE con `p_fire_id`). | aceptada |
| `tg_auto_print_on_accept`, `upsert_pos_sale`, `pos_open_sales` (cuerpo) | S1B, puntos 6.1–6.3. Los parchea con `regexp_replace` sobre la definición, y por eso no casan con el texto de ningún fichero. La diferencia es `table_id`. | aceptada |
| `sale_table_move`, `sale.merged_into_sale_id`, `_pos_dest_table`, `_pos_print_table_notice`, `pos_table_move`, `pos_table_move_lines` | **TPV Sala S2**, `20261009T0050`. **Solo en la rama sin fusionar** `claude/affectionate-albattani-6lv2af`, y aplicada en staging desde ella. | aceptada, en desarrollo |
| `e2e_c06_recorrido_base` (solo staging) | La semilla `seeds/conta/seed_c06_recorrido_staging.sql`. Es de staging a propósito. | aceptada |

Dos cosas que deciden otros:

1. **`create_account_tx`**: el arreglo de producción no está en `main`. Hasta que
   se fusione, el siguiente despliegue desde el repositorio no lo borra, porque
   es SQL y no una función de borde. Pero staging, y cualquiera que reconstruya
   desde `main`, no lo tiene.
2. **TPV Sala S2** vive en staging desde una rama sin fusionar. La he aceptado
   como «en desarrollo», como dijiste de las mesas. Si esa rama se abandona, en
   staging quedan objetos que no salen de ningún sitio de `main`.

## 3 · Propuesta: que un frente no rompa las enteras de otro con la plantilla

Solo propuesta, no he construido nada. **La plantilla** son las cuentas A, B y
C, Diez y las solas: lo que copia el carril y lo que leen las pruebas de todos.

1. **La plantilla solo se cambia con un fichero de la rama.** Una semilla en
   `supabase/seeds/conta/` o un `supabase/staging/sql/`, aplicado por
   `aplicar-staging-conta`. Nunca a mano, ni por el conector, ni desde una
   prueba que no deshaga lo suyo. Con el registro de hoy, cada cambio queda en
   el historial con su huella, quién y qué rama.
2. **El fichero que cambia la plantilla lo dice en la cabecera**:
   `-- plantilla: <qué cambia> · lo leen: <pruebas>`. La sección «lo leen» sale
   de buscar en `tests/e2e` los ids y nombres que toca. Lo puede comprobar
   `antes-de-subir.sh`, como hoy comprueba `-- cambia:`.
3. **Quien cambia la plantilla arregla las pruebas de los demás que rompe**, en
   su rama y antes de aplicarlo. El ensayo cabe con el carril: aplicar el
   fichero en una copia y correr ahí las pruebas que lo leen, sin tocar la
   plantilla de nadie. De las 9 rojas:
   - las 7 de `c01b/flujos:161` («409 repetidas») las rompió una guarda de D01;
   - las 2 del NIF de `catcher` las rompió un cambio de la ficha.

   Las dos se habrían visto ahí.
4. **Las pruebas no fijan lo que la plantilla puede cambiar.** Un NIF, un nombre
   o un recuento se leen de la semilla, no se escriben en la prueba. Para A,
   pendiente desde la entrega del 1c: que `catcher` lea el NIF de la ficha
   sembrada.
5. **Una huella de la plantilla, cada noche, junto a la comparación de
   estructura.** Un md5 por tabla de las filas de las cuentas de la plantilla.
   Si cambia sin un fichero registrado esa noche, sale en rojo y se sabe que
   alguien la tocó a mano.

## 4 · `bank_deshacer`: no es el clon

**Las 1.400 conciliaciones viejas no pintan nada.** En los tres bancos de B01
de la plantilla hay 1.400 casados:

| `bank_match` (bancos B01, plantilla) | casados | asientos |
|---|---:|---:|
| `deshecho`, cuenta | 92 | 0 |
| `deshecho`, factura_recibida | 327 | 0 |
| `deshecho`, liquidacion | 327 | 0 |
| `deshecho`, traspaso | 654 | 0 |

Ninguno está `vivo` y ninguno tiene asiento. `bank_deshacer` filtra
`status = 'vivo'` y `deshacerTodo` (en `b01/datos.ts`) también: no toca ninguno.
Las tablas que mira son pequeñas: `bank_match` tiene 4.213 filas y la mayor
clave ajena a `journal_entry` sin índice, 806. **El clon no se toca.**

**Tampoco es el volumen de la función.** Lo dice `pg_stat_statements` de staging:

| Llamada | Veces | Media | Máximo |
|---|---:|---:|---:|
| `bank_deshacer` (las que acabaron) | 1.222 | 29 ms | 4.727 ms |
| Lista de `bank_activity_log` | 1.257 | 374 ms | — |

Las que pasan de 8 s no salen: se cortan antes.

**Para B, con la causa probable.** Run 421, a las 14:39, con la e2e de D
corriendo a la vez. `bank_deshacer` agotó los 8 s de `statement_timeout` de
`authenticated`, en el `finally` de `conciliar.spec.ts:241`: la limpieza de
después de la prueba. Lo que sé:

- La función solo coge cerrojos de fila y de su empresa: `for update` y el
  consultivo de numeración. No hay ninguno global. Los disparadores de las
  tablas que toca tampoco hacen nada global.
- La prueba duró 55,6 s, lo normal. El cuerpo llegó hasta el final y la
  limpieza arrancó con la página todavía abierta.
- **Causa probable** (sin poder medirla ya): la página aún tenía en marcha el
  motor de `bancosNucleo.ts`, que llama `bank_casar` y `bank_proponer` sobre los
  mismos movimientos y retiene esas filas. Con staging cargado, la espera pasó
  de 8 s. Con 8 s de `statement_timeout` y 8 s de `lock_timeout`, una espera de
  cerrojo así acaba en 57014.
- **Para B:**
  - que la limpieza espere a que la página no tenga peticiones en vuelo, o la
    cierre antes de deshacer;
  - que el `finally` no tape el error del cuerpo de la prueba (hoy lo
    sustituye).
- **Aparte, también para B:** la lista de `bank_activity_log` tarda 374 ms de
  media con las 7.400 filas viejas de la plantilla.

## 5 · 4 trozos

En 2 por defecto. No mido 4 hasta que me digas que staging está en Small.

## Commits

| Rama | Commit | Qué |
|---|---|---|
| `conta/w02-sin-esperas` | `f1d6bf8b` | La transición: el clon coge `e2e.cerrojo` |
| `conta/w02-staging-al-dia` | `4c142a80` | Registro y comparación |
| `conta/w02-staging-al-dia` | `79761f40` | Arreglo de la guarda 4 de la comparación |
| `conta/w02-staging-al-dia` | `e58699ec` | Aceptadas y origen en `docs/conta/staging.md` |

Antes de cada empuje, `antes-de-subir.sh`: todo en verde.
