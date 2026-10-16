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

**Ensayado** contra las dos bases de verdad. Primero el run 38923607587, a
las 15:24; con las cifras buenas, el run 38926005313, a las 15:42.

| | 15:24 | 15:42 |
|---|---:|---:|
| Iguales | 458 tablas · 6.066 columnas · 1.057 funciones · 218 disparadores | 458 · 6.066 · **1.055** · 218 |
| Distintas | **52** | **54** |
| Aceptadas (en desarrollo / de staging) | — | 43 |
| **Rojas** | 52 | **11** |

**Las 2 de más de las 15:42** son `compras_ficha_le_falta` y `compras_mirar`:
staging ya tiene las de `20261118T0100_d01_compras_ficha`, la tanda de A (casan
md5 a md5), aplicada hacia las 15:30 y todavía no en producción. Es staging
**por delante**. Se cierra cuando la tanda llegue a producción, así que no la
acepto. La comparación la vio sola, a los diez minutos de entrar.

**Un fallo mío, arreglado antes de dar las cifras.**

- **Qué pasaba.** La primera rama del `union` fijaba `nombre` en el tipo
  `name`, que corta a 63 caracteres, y 503 firmas pasan de 63.
- **Cómo se vio.** Las 10 aceptadas de firmas largas no casaban, y el resumen,
  con lo largo de cada firma roja, dio 63 en todas.
- **El arreglo.** Va en `a993a3d9`, con su prueba.
- **Qué escondía.** Nada: el total coincide.

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
| `conta/w02-staging-al-dia` | `74ec3048` | En una función roja, cuánto mide su firma |
| `conta/w02-staging-al-dia` | `a993a3d9` | Las firmas no se cortan a 63 |

Antes de cada empuje, `antes-de-subir.sh`: todo en verde.

## Segunda vuelta (16/10, noche): lo que pediste en tu segunda respuesta

1. **`create_account_tx`: PR #217 a `main`**, un solo fichero,
   `supabase/migrations/20261008124905_alta_de_cuenta_sin_permission_sets.sql`.
   - Es exactamente el texto que guarda el historial de producción: md5
     `e9677bdd…` a los dos lados.
   - Byte a byte contra la función viva: aplicado con un `SELECT` sobre la
     función de antes, que aún tiene staging (`4effd0a8…`), da el cuerpo de
     producción, `d82fbbc5…`.
   - Sin tanda. Lo fusiona Julio.
2. **Staging al día, preparado y sin aplicar** hasta que digas «hueco».

   **El manifiesto, en este orden:**
   1. `20261006T1200_dosier_visita`
   2. `20261006T1400_dosier_visita_lugar`
   3. `20261006T0140_c01b_elimina`
   4. `20261008124905_alta_de_cuenta_sin_permission_sets`

   **Lo comprobado:**
   - **`c01b_elimina`** es la de producción: la huella del historial es la del
     fichero.
   - **Su guarda hoy pasaría en staging**:
     - los lectores son los esperados;
     - no falta ninguno de los 22 proveedores;
     - copiaría 4 con datos.
   - **`dosier_visita`** difiere en bytes de lo que guardó el conector en
     producción (1.233 frente a 815). Por el tamaño serán los comentarios; se
     confirma con la comparación de después.

   **Quién usa las 4 columnas de `supplier`** (`email`, `phone`, `address`,
   `usual_vat_rates`):
   - **Pruebas e2e y front: nadie.** Ni `tests/e2e` ni `src` las leen (salvo
     los tipos generados).
   - **Las semillas que las escriben**, que fallarían si se volvieran a pasar
     después: `seed_c01_staging.sql` (email, phone, address),
     `seed_c01b_staging.sql` (phone, address) y `seed_c01_capturas.sql`
     (usual_vat_rates). El carril no las vuelve a pasar: copia.
   - **Pruebas de staging de SQL que las leen**:
     `20261006_c01b_prueba_movimiento.sql`, `20261006_c01b_prueba_elimina.sql`
     (la de esta migración) y `20261004_prueba_vuelta_atras.sql`, y el script
     `scripts/conta/c01b_antes_despues.sql`.
   - **Una unitaria comprueba que la columna existe**:
     `tests/unit/modules/conta/tablasC00.test.ts:199` («las columnas del
     proveedor que lee "Los que usas" existen»). Mira `usual_vat_rates` en el
     texto de las migraciones, no en la base: no se rompe, pero comprueba una
     columna que producción ya no tiene.
3. **La regla de la plantilla**, en `conta/w02-staging-al-dia` (`2a257e93`), con
   sus pruebas contra los ficheros reales:
   - **La cabecera**: el paso 10b de `antes-de-subir.sh`
     (`scripts/conta/plantilla.mjs`).
   - **La huella nocturna**: el job «plantilla» de
     `comparar-staging-produccion.yml`. Primera foto: 344 tablas, 27 s de
     lectura (run 38959280375).
   - **Medida contra los 160 ficheros de semillas y `staging/sql`**: 131 tocan
     la plantilla. De esos, la mayoría la leen entre 4 y 12 pruebas.
4. **Las mesas del TPV**, S1 y S2: no las toco y siguen aceptadas.
5. **#212**: listo y sin fusionar.

**La comparación a las 22:02** se ha movido mucho desde las 15:42, por las tandas
de esta tarde:

- **Staging por delante:** reparto (columnas de entrega en `sale`,
  `trg_sale_entrega_desde_raw`, `decidir_quien_reparte`, `r03_entrega_relleno`…)
  y la entrada de documentos (`company_inbound_sender`, `conta_entrada_remitente`).
- **Producción por delante:** `conta_envio_aclarado`, `conta_ventas_canal_cuenta`,
  `conta_cargos_de_pedidos`, `conta_envio_aclarar` y
  `tg_journal_entry_envio_por_aclarar`.

No he buscado su origen.

**Una línea se quedó retenida en la puerta.** Su clave pasaba de 48 caracteres:
es un disparador de producción, con nombre de tabla y disparador largos. El
total de rojas lo cuenta igual.

## Tercera vuelta (16/10, noche)

### El manifiesto del hueco (preparado, sin empujar)

Va en este orden y se empuja solo con «hueco». Cada fichero, comprobado contra
el historial de producción:

| Fichero | Contra producción |
|---|---|
| `20261006T0140_c01b_elimina` | md5 = huella (`bf3da856…`) |
| `20261006T1200_dosier_visita` y `T1400_dosier_visita_lugar` | lo dirá la comparación de después (el conector no guardó los comentarios) |
| `20261008124905_alta_de_cuenta_sin_permission_sets` | el texto exacto de su registro (#217) |
| **`20261113T0100_c06b_centimo_iva`** | md5 = huella (`b806958a…`) |
| `20261116T0100_c06b_promociones_envios` | md5 = huella (`2111d047…`) |
| `20261116T0110_c06b_promociones_envios_datos` | md5 = huella (`3fb2e375…`) |

- **El céntimo va aunque no estaba en la lista.** Staging no la tiene: a las
  22:02 `journal_entry_validar` seguía con el cuerpo de la `20261019T0160`, y
  el historial de staging no tiene ni la `20261113` ni las `20261116`. La
  `20261116T0100` vuelve a escribir `conta_propuesta_ventas_unidad` encima de
  la del céntimo, así que va detrás.
- **Se puede repetir sin daño**: son dos `create or replace` con la misma firma.
  Si C la aplica esta noche, no pasa nada.
- **La `0110` no hace nada en staging**: su propio `notice` dice «esta base no
  tiene Foodint; no se hace nada».

### Las semillas y las pruebas de staging con las 4 columnas de `supplier`

El PR va suelto **después** de aplicar `c01b_elimina`, como pediste. Lo que va
dentro:

| Fichero | Qué hace hoy con las columnas | El cambio (sin tocar lo que prueba) |
|---|---|---|
| `seeds/conta/seed_c01_staging.sql` | Deja correo, teléfono y dirección en las columnas viejas, para que la migración del C01 tuviera algo que pasar | Deja lo que dejó la migración, copiado de staging hoy: Hermanos Ruiz (principal de pedidos con teléfono, comercial con correo y su dirección como propuesta `fiscal_address`), Bebidas Sol (principal con teléfono) y Carnes Sur (principal con correo) |
| `seeds/conta/seed_c01b_staging.sql` | Mercados del Norte, con teléfono y dirección viejos | Principal con teléfono y propuesta de dirección, como está hoy |
| `seeds/conta/seed_c01_capturas.sql` | `usual_vat_rates = '{10,21}'` | `usual_tax_rate_ids` con los tipos del 10 y el 21 |
| `staging/sql/20261006_c01b_prueba_movimiento.sql` (línea 133) | Mira si quedan datos en las columnas viejas | Lo mismo, en el contacto principal |
| `staging/sql/20261004_prueba_vuelta_atras.sql` | Pone y lista `usual_vat_rates` | `usual_tax_rate_ids` |

Las semillas tocan la plantilla, así que llevarán la cabecera nueva
(`-- plantilla: … · lo leen: …`).

**No se tocan**, porque existen para medir esas columnas: la prueba de la propia
`c01b_elimina` (`20261006_c01b_prueba_elimina.sql`) y su medida de antes y
después (`scripts/conta/c01b_antes_despues.sql`). Quedan como registro de la
migración. Sí les pondré una línea arriba: «solo antes de la 0140».

### Las cuentas que deja el recorrido del C06 (propuesta, sin borrar nada)

**Medido en staging (solo lectura, 16/10 22:3x):**

- **248 cuentas** «Recorrido de Prueba C06 …» (no 150), de las **258** que
  tiene staging. La primera es del 13/10 y la última, de las 17:43 de hoy.
- **Cada una lleva** su perfil y un usuario de `@c06-prueba.test` que no está
  en ninguna otra cuenta: 248 usuarios de auth.
- **Ni una tiene** empresa, asientos ni base de Diez enlazada.
- **Lo que arrastran:** 986 filas en 4 tablas.

  | Tabla | Filas |
  |---|---:|
  | `conta_diez_base_registro` | 250 |
  | `feature_flags` | 248 |
  | `user_profiles` | 248 |
  | `conta_programa_anterior_registro` | 240 |

- **Todas las creó el administrador de plataforma de prueba del C06**
  (`created_by = c0600000-…-0000000000f0`).
- **Ningún disparador impide borrarlas** (`accounts`, `user_profiles`,
  `feature_flags` y los dos registros).

**Limpiarlas, una vez:** un `staging/sql` con su ensayo dentro de una
transacción que acaba en `rollback`.

- **Qué borra:** solo las cuentas con ese nombre, `product_brand = 'contabilidad'`,
  creadas por ese usuario y sin empresa. Con ellas, sus filas y sus usuarios
  de auth, y solo los que no pertenecen a ninguna otra cuenta.
- **Topes:** como mucho 300 cuentas, y la plantilla intacta antes y después.
- **Con el recuento de antes y después pegado.** Lo aplica
  `aplicar-staging-conta`, con su registro.

**Que no se acumulen**, cuando el #212 esté en `main`, con el carril:

- En un carril, el usuario de plataforma es la copia del carril. Las cuentas
  del recorrido nacen con `created_by` = ese usuario del carril.
- `scripts/e2e/carril/borrar.sql` borraría también las cuentas que creó
  cualquier usuario del carril, con los mismos topes.
- Así se van al acabar cada run, salga verde o rojo, sin depender de que la
  prueba llegue a su final.

Si prefieres que lo haga la propia prueba, su alternativa es una función de
staging, `e2e_c06_recorrido_borrar`, como la `e2e_c06_recorrido_base` que ya
existe, llamada en un `afterAll`. **Recomiendo la del carril**: no depende de que
la prueba acabe, y vale para cualquier otra prueba que cree cuentas.
