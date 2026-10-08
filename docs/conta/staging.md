# `staging-conta`: el entorno de pruebas del módulo de contabilidad

Rama persistente de Supabase, creada el 01/10/2026 desde el panel.

| | |
|---|---|
| Referencia del proyecto de la rama | `oseymswjlzplqoxrfjzi` |
| Proyecto padre (producción) | `xzmpnchlguibclvxyynt` |
| Persistente | sí (~10 $/mes, confirmado por Julio) |
| Datos | **ninguno de producción ni de Folvy Interno**; solo semillas |

## Por qué no se creó sola

La rama nació en `MIGRATIONS_FAILED` y con 0 tablas. El historial de
migraciones de producción (`supabase_migrations.schema_migrations`) empieza el
12/07/2026 (534 migraciones) y da por hechas tablas creadas antes, que no están
en el historial. Con solo el historial no se puede reconstruir la base desde
cero.

## Cómo se ha montado (para repetirlo)

Todo **lee** de producción y **escribe** solo en la rama.

### 1. Extensiones (por el conector de Supabase, en la rama)

```sql
create extension if not exists unaccent with schema public;
create extension if not exists pg_trgm  with schema public;
create extension if not exists postgis  with schema public;
create extension if not exists pg_cron  with schema pg_catalog;
create schema if not exists propuestas;
```

Mismas versiones que producción (`unaccent 1.1`, `pg_trgm 1.6`, `postgis 3.3.7`,
`pg_cron 1.6.4`). `pg_net` ya venía; en la rama está registrado en `extensions`
y en producción en `public`, pero sus funciones viven en `net` en las dos.

### 2. Estructura de `public` y `propuestas` (Julio, desde su equipo)

Con `pg_dump` 17 y `psql`, las cadenas de conexión del botón «Connect» de cada
proyecto (Session pooler):

```
pg_dump "<producción>" --schema-only --no-owner --schema=public --schema=propuestas -f estructura_prod.sql
psql "<staging-conta>" -f estructura_prod.sql > aplicar.log 2>&1
```

El log da 15 errores, todos explicados:

| Error | Cuántos | Qué se hizo |
|---|---|---|
| `schema "public"/"propuestas" already exists` | 2 | Inofensivo. |
| `deadlock detected` al crear la política `vacation_settings_read` | 1 | Julio la creó a mano con la sentencia exacta del volcado. |
| `permission denied to change default privileges` (`FOR ROLE supabase_admin`) | 12 | **No hay que replicarlos.** Los privilegios por defecto de la rama ya son idénticos a los de producción (comparado `pg_default_acl` fila a fila). La rama tiene 3 filas más, del esquema interno `supabase_functions`, que pone Supabase. |

### 3. Correcciones tras el volcado (por el conector, en la rama)

| Fichero | Qué corrige |
|---|---|
| `staging/02_permisos_45_tablas.sql` | En 45 tablas, producción no da ningún permiso a `anon` (y a veces tampoco a `authenticated`). En la rama les quedaban `Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN), heredados de los privilegios por defecto, que el `REVOKE` del volcado no quitaba. Se rehacen con el ACL exacto de producción, en su mismo orden. |
| `staging/03_almacenamiento.sql` | Los 17 buckets (solo configuración, **vacíos**) y las 35 políticas de `storage.objects`. |
| `staging/04_realtime.sql` | Las 13 tablas de la publicación `supabase_realtime`. `pg_dump --schema` no las lleva. |

### 4. Historial de migraciones

Se copian `version` y `name` de las 534 migraciones de producción a
`supabase_migrations.schema_migrations` de la rama, para que las nuevas se
apliquen encima con normalidad. El texto SQL de cada una (`statements`) no se
copia: vive en producción y en el repositorio. Huella `md5(version:name)` igual
en los dos lados: `f1775a79e444501e8c82bdce012cbcca`.

## Comparación con producción

Medida con `staging/comparar_estructura.sql`: la **misma consulta** en los dos
lados. Cuenta y md5 de cada definición de `public` + `propuestas`, sin lo que
pertenece a extensiones.

| Categoría | Producción | Rama | ¿Igual? |
|---|---|---|---|
| tablas (columnas, tipos, NOT NULL, defaults, identity, generadas) | 331 · `f585991e` | 331 · `f585991e` | **sí** |
| vistas | 1 · `4a53521c` | 1 · `4a53521c` | **sí** |
| secuencias | 6 · `b6703f27` | 6 · `b6703f27` | **sí** |
| funciones (`pg_get_functiondef`) | 779 · `711347d8` | 779 · `711347d8` | **sí** |
| permisos de funciones | 779 · `6f0030fc` | 779 · `6f0030fc` | **sí** |
| índices | 874 · `fcb5b1c6` | 874 · `fcb5b1c6` | **sí** |
| triggers | 139 · `a2424ffb` | 139 · `a2424ffb` | **sí** |
| políticas RLS | 543 · `1685a065` | 543 · `1685a065` | **sí** |
| tablas con RLS activado | 310 · `430015c0` | 310 · `430015c0` | **sí** |
| permisos de tablas | 1.215 · `c5d78030` | 1.215 · `c5d78030` | **sí** (tras `02_…`) |
| comentarios de funciones | 121 · `4782625e` | 121 · `4782625e` | **sí** |
| comentarios de tablas y columnas | 372 · `37dca55e` | 372 · `082eb2b4` | equivalente (1) |
| restricciones | 1.380 · `5bc9ef61` | 1.380 · `869f4c4a` | equivalente (2) |

(1) Mismo texto en las 372. En 4 tablas (`article_supplier`, `brand`,
`channel_settlement_order`, `employees`) cambia el número de columna, porque
producción tiene una columna borrada en cada una y la rama no.

(2) Las 1.380 son las mismas. Solo `count_cadence_dias_razonables` se escribe
con otros paréntesis: la rama está en PostgreSQL 17.11 y producción en 17.6, y
la condición es idéntica.

Fuera de `public`:

| | Producción | Rama |
|---|---|---|
| buckets (configuración) | 17 · `02e23797` | 17 · `02e23797` |
| archivos en storage | (no se copian) | **0** |
| políticas de storage | 35 · `db401ae3` | 35 · `db401ae3` |
| tablas en `supabase_realtime` | 13 | 13 |
| migraciones registradas | 534 · `f1775a79` | 534 · `f1775a79` |
| filas en `public` + `propuestas` | — | **0** (solo `spatial_ref_sys`: 8.500 filas que trae PostGIS) |
| usuarios en `auth.users` | — | **0** |

**Los recuentos de Julio y los de esta tabla miden cosas distintas, y casan:**
- **Tablas:** Julio cuenta 329 en `public`, que son las 328 propias más
  `spatial_ref_sys` de PostGIS. Esta tabla cuenta 331, que son las 328 de
  `public` más las 3 de `propuestas`.
- **Vistas:** sus 3 son la propia más `geography_columns` y `geometry_columns`
  de PostGIS.
- **Funciones:** sus 1.558 de `public` incluyen las de PostGIS. Las propias son
  779.

## Semillas del C01

`supabase/seeds/conta/seed_c01_staging.sql`, cargado el 01/10/2026 a las 22:40
(UTC). Dos cuentas inventadas, una por lado de la prueba de aislamiento:

| | A · Taberna de Prueba Norte | B · Cocina de Prueba Sur |
|---|---|---|
| usuario (admin) | `a.admin@prueba.folvy.test` | `b.admin@prueba.folvy.test` |
| local | Norte Centro | Sur Mercado |
| proveedores | Hermanos Ruiz (email + teléfono + dirección), Bebidas Sol (teléfono), Panadería Luna (nada) | Carnes Sur (email), Limpiezas Brillo (nada) |
| factura aprobada | F-2026-0915 · 1.283,15 € | S-118 · 462,00 € |
| interruptor `conta` | **sí** | no |

Medido después de cargar: 2 cuentas, 2 `auth.users`, 2 `auth.identities`,
2 `user_profiles`, 2 locales, 5 proveedores, 2 facturas aprobadas (con su
código puesto por el disparador), 1 interruptor.

La contraseña de los dos usuarios **no está en el repositorio ni viaja en
claro**: el fichero lleva el marcador `__HASH_CLAVE_PRUEBAS__`, que se sustituye
por el hash bcrypt calculado en local (el comando va en la cabecera del
fichero). La clave la tiene Julio aparte.

La semilla se niega a correr si la base tiene alguna cuenta que no sea de
prueba (o sea, si no es `staging-conta`) o si ya está cargada.

## Cómo se aplica SQL en la rama: el workflow, no el conector

Desde el 02/10/2026 las migraciones y el SQL de staging-conta los aplica
`.github/workflows/aplicar-staging-conta.yml`. El conector de Supabase pide
confirmación para cualquier sentencia con `DROP` o `DELETE` y la petición
caduca a los 60 s: la estructura del C01 no entró dos veces, y ni siquiera un
`drop table if exists` de una tabla que no existe. Las lecturas por el
conector siguen sirviendo para comprobar.

**Cómo se usa.** Se escribe en `supabase/staging/aplicar.txt` la lista
ordenada de ficheros de esta tanda (una ruta por línea; `#` comenta) y se
empuja a una rama `conta/**`. Funciona desde la propia rama, sin estar en
`main`. Solo lo dispara un cambio en el manifiesto: tocar un `.sql` o el
propio workflow no aplica nada. El manifiesto es **la tanda de esa
ejecución**: para la siguiente se reescribe entero, no se añade debajo.

**Qué hace con cada fichero.** `psql` 17 con `-X -v ON_ERROR_STOP=1 -1 -f`:
el fichero entero en una transacción, que el primer error revierte. Si uno
falla, los siguientes no se aplican. El log del job enseña la salida de cada
fichero (sus `NOTICE`, por ejemplo «C01 datos OK…») y el resumen del job, una
tabla con fichero, md5 y resultado.

**Qué ficheros acepta.** Solo `.sql` bajo `supabase/migrations/`,
`supabase/staging/sql/` o `supabase/seeds/conta/`, sin `..` y que existan. Una
ruta mala aborta la tanda antes de conectar.

**Por qué no puede tocar producción.** Usa un único secreto de base de datos,
`STAGING_CONTA_DB_URL`, y tres guardas antes de aplicar nada:

1. La URL contiene `oseymswjlzplqoxrfjzi` (staging-conta).
2. La URL **no** contiene `xzmpnchlguibclvxyynt` (producción).
3. Ya conectado, en `accounts` **no** están ni Foodint ni Folvy Interno.
   Producción tiene las dos siempre; staging-conta, ninguna. Esta guarda no se
   fía de la URL: mira qué base hay al otro lado.

La URL no sale en el log: su usuario, contraseña y host se enmascaran antes de
conectar.

**El registro en el historial** (`supabase_migrations.schema_migrations`) no
lo hace el workflow: se apunta después, comprobado con consultas, con la
versión y el nombre del fichero.

### Tandas aplicadas

| Fecha (UTC) | Ejecución | Ficheros | Resultado |
|---|---|---|---|
| 02/10 06:07 | [36971337003](https://github.com/Llorente29/llorente29-app/actions/runs/36971337003) (2.º intento; el 1.º falló en la guarda 3 por la contraseña del secreto, sin aplicar nada) | `20261002T0100_c01_ficha_proveedor_estructura.sql` (md5 `331acd7a`), `20261002T0110_c01_ficha_proveedor_datos.sql` (`7828b3e8`), `staging/sql/20261002_borrar_c01_prueba_conector.sql` | los 3 aplicados; «C01 datos OK: 3 contactos principales y 1 propuestas de dirección»; 1 fila de prueba borrada |
| 02/10 06:12 | [36972413440](https://github.com/Llorente29/llorente29-app/actions/runs/36972413440) | `staging/sql/20261002_ensayo_c01_caminos.sql` | ensayo de 17 caminos, sin dejar nada escrito (abajo) |

Registradas después en el historial, con la hora en que se aplicaron:
`20261002060717 c01_ficha_proveedor_estructura` y
`20261002060718 c01_ficha_proveedor_datos` (536 filas en total).

**Ensayo de los caminos del C01** (02/10, como admin de A y de B con su JWT):

| # | Camino | Resultado |
|---|---|---|
| 1 | `compliance_docs_due` con un certificado de banco que caduca | `Hermanos Ruiz → pedidos@hermanosruiz.test` (el email sale del contacto principal) |
| 2 | Qué ve A | 3 proveedores, 2 contactos, 1 propuesta, 1 factura, 12 tipos de gasto; de B, 0 y 0 |
| 3 | Marcar como pagada | `pagada`, 2026-10-01, transferencia, «Admin Norte» |
| 4 | Deshacer | vuelve a `aprobada`, sin fecha ni forma de pago |
| 5 | Cambiar vencimiento | 2026-10-24, «Admin Norte» |
| 6 | Rastro | `paid`, `unpaid`, `due_date_changed`, los tres con su nombre |
| 7–9 | A paga, deshace o cambia el vencimiento de una factura de B | rechazado: «No encuentro esa factura.» |
| 10–11 | A edita o borra un contacto de B | 0 filas |
| 12–13 | A crea un contacto en B, o uno suyo colgado de un proveedor de B | rechazado por el disparador de misma cuenta |
| 14 | Escribir el rastro a mano | rechazado: sin permiso de INSERT |
| 15 | A crea una propuesta en B | rechazado por la RLS |
| 16 | `refresh_supplier_proposals` sin lecturas automáticas | 0 |
| 17 | Qué ve B | 2 proveedores, 1 contacto, 0 propuestas, 0 rastro; su contacto, intacto |

Después, medido por el conector: 0 documentos de cumplimiento, 0 filas de
rastro, las dos facturas en `aprobada` sin vencimiento ni pago.

### Tandas del C00

| Fecha (UTC) | Ejecución | Ficheros | Resultado |
|---|---|---|---|
| 02/10 17:07 | [37038618070](https://github.com/Llorente29/llorente29-app/actions/runs/37038618070) | migraciones `0100`, `0110` y `0120` del C00 y `staging/sql/20261003_ensayo_c00_reglas.sql` | aplicadas; ensayo de 25 casos con A y B sin dejar nada escrito |
| 02/10 18:33 | [37048236943](https://github.com/Llorente29/llorente29-app/actions/runs/37048236943) | `seeds/conta/seed_c00_catalogo_iva_cocina.sql`, `0130` (md5 en el registro), `ensayo_c00_d1.sql`, `0140` (`a566166e`), `ensayo_c00_d1.sql` otra vez | ver D1 abajo |
| 02/10 18:4x | la del commit `8a1ffb2` | `seeds/conta/seed_c00_empresas_prueba.sql` | A «Taberna de Prueba Norte» (península; 303, 390, 111, 115, 202; 1 banco y 1 serie) y B «Cocina de Prueba Sur» (Canarias; 111) |

| 02/10 23:49 | [37079327827](https://github.com/Llorente29/llorente29-app/actions/runs/37079327827) | `0150` (md5 `c704f6e7`) y `staging/sql/20261003_ensayo_c00_t5.sql` (`3fa90a65`) | ver «Ensayo de la tarea 5» abajo |
| 03/10 05:35 | [37100317334](https://github.com/Llorente29/llorente29-app/actions/runs/37100317334) | `0160` (base de la IA), `staging/sql/20261003_ensayo_c00_ia.sql` (`5123a7ee`) y `seeds/conta/seed_c00_sugerencia_prueba.sql` | ver «Ensayo de la IA» abajo; 1 alquiler al 19 % de prueba en B |
| 03/10 05:55 | [37101379040](https://github.com/Llorente29/llorente29-app/actions/runs/37101379040) | `seeds/conta/seed_c00_sugerencia_prueba.sql` otra vez, ya con A | el mismo alquiler de prueba en A, para el e2e del alta |

Registradas después en el historial: `20261003000100 c00_catalogos_oficiales`,
`20261003000110 c00_empresa`, `20261003000120 c00_tablas_generales`,
`20261003000130 c00_valores_de_serie` y `20261003000140
c00_vat_rate_lee_de_impuestos` (541 filas en total) y, tras la 5.ª tanda,
`20261003000150 c00_actividad_principal` (542) y, tras la 6.ª,
`20261003000160 c00_ia_base` (543).

**Lo que dejó la 0130**, medido por el conector: 1.432 epígrafes del IAE (los
1.438 del ISTAC menos 6 códigos técnicos: `_N`, `_O`, `_T`, `_U`, `_X`, `_Z`),
1.060 de la CNAE-2025, 275 países, 280 monedas, 14 impuestos, 5 retenciones,
4 formas de pago, 4 plazos, 4 textos, 9 modelos, los 12 tipos de gasto con su
referencia y 6 filas del puente.

**D1, con la misma vara a los dos lados** (5 categorías × cada día de 2024 a
2026 = 5.480 pares; solo lectura):

| | `vat_rate_for` lee de | pares | con tipo | ≠ consulta de la 0140 | ≠ `vat_rate_for` |
|---|---|---|---|---|---|
| antes de la 0140 | `vat_rate` | 5.480 | 3.742 | 0 | 0 |
| después de la 0140 | `tax_rate` (vista `vat_category_rate`) | 5.480 | 3.742 | 0 | 0 |

**Ensayo de la tarea 5** (con A y B y su token; nada escrito: el recuento de
actividades, ejercicios, cierres y socios de la empresa de A y la huella de su
perfil fiscal, iguales antes y después): A cambia la actividad principal en un
paso; no puede hacer principal una terminada; abre el ejercicio 2026, cierra
enero, no puede cerrar marzo con febrero abierto, no reabre sin motivo y
reabre con motivo («reabierto por Admin Norte»); cambia su registro mercantil
y su criterio de caja; añade una socia y la ve. B no puede hacer principal una
actividad de A, cambia 0 filas del nombre o los impuestos de A, ve 0 socios de
A y no puede cerrar un mes de A. Los mismos 13 resultados en local que en
staging.

**Ensayo de la IA** (0160; A y B con su token; nada escrito: orígenes,
registro, sugerencias, actividades y proveedores de A, su nombre comercial y
sus modelos, iguales antes y después). La IA pone el nombre comercial y queda
su origen con el motivo y el valor; la persona lo cambia y el origen deja de
coincidir (sin marca); deshacer entonces se niega («Ese dato ya lo cambió
alguien después: no lo deshago para no pisarlo»); sin cambio en medio,
deshacer devuelve el valor y quita el origen. La IA no puede cambiar el NIF ni
actuar sin porqué, ni poner un epígrafe que no está en el IAE; sí el 677.9, y
se deshace. Nadie escribe el registro a mano. Con un alquiler al 19 % y una
gestoría al 15 %: 2 sugerencias; rechazada la del 115, no vuelve; aceptada la
del 111, pone el modelo, queda en el registro y se deshace. B no pone ni
deshace nada en A y ve 0 filas de su registro y sus sugerencias. Los mismos 16
resultados en local que en staging.

**Dato de prueba, dicho:** la sugerencia que se ve en staging sale de una
regla real (alquiler de la cuenta 621 con un 19 % de retención y la empresa sin
el 115) sobre un proveedor INVENTADO, «Locales del Norte/Sur (alquiler)», en A
y en B. En producción no puede salir todavía: las columnas de la ficha de
proveedor (C01) no están allí.

La vara sabe fallar: en local, con un 5 % puesto a propósito en
`alimento_basico` dentro de una transacción revertida, da 730 diferencias (los
días de 2025 y 2026 de esa categoría).

## Lo que NO se copia, a propósito

- **Datos**: ni una fila de producción ni de Folvy Interno. Solo semillas
  (`supabase/seeds/conta/…`).
- **Crons** (`cron.job`, 56 en producción): son configuración que llama a
  funciones y a URL de producción. En la rama no tiene que correr nada solo. Los
  agentes de cumplimiento tendrán sus propios crons cuando lleguen.
- **Secretos del Vault** y **edge functions**: cuando haga falta una en la
  rama, se despliega aparte.
- `auth`, `storage`, `realtime`: los pone Supabase. Solo se copian los buckets
  y las políticas de storage.

## Entrar a mano: funciones, hook y vista previa de Vercel (02/10)

Para que Julio pruebe la ficha él mismo en la vista previa de la rama.

**Edge functions desplegadas en la rama** (los ids son los de producción, pero
las versiones no: producción no se ha tocado).

| Función | Versión en staging-conta | Producción | Comprobado |
|---|---|---|---|
| `check-account-status` | v59 | v56, intacta | desplegada desde el fichero de la rama; leída de vuelta el 02/10: mismo código (`index.ts`, `_shared/cors.ts`, `deno.json`), `verify_jwt = true` |
| `conta-vies-check` | v1 | no existe todavía | md5 `38c17cb3…` = fichero de la rama |

**Hook de claims** (`custom_access_token_hook`): la función es idéntica en los
dos lados (md5 `7d1f1daf…`, mismos permisos). Pero en la rama **no está
activado en la configuración de Auth**, y sin él `check-account-status` no ve
los claims `folvy.*` y el login se queda en la primera pantalla. Activarlo no
se hace por SQL ni hay herramienta para ello: se hace en el panel,
**Authentication → Hooks → Customize Access Token → Postgres →
`public.custom_access_token_hook`**.

**Usuario para entrar a mano:** se crea en el panel (**Authentication → Users →
Add user**, con contraseña y «Auto confirm»), nunca en el repositorio. Después
se le da `user_profiles` admin de la cuenta de prueba A por el workflow de
aplicar SQL, con sus guardas.

**Vercel:** dos variables de **vista previa limitadas a la rama**
`conta/c01-ficha-proveedor`, `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`,
las dos de staging-conta. Las generales de vista previa siguen apuntando a
producción. Ojo: una variable solo entra en los builds que **empiezan después**
de crearla. El despliegue de `1ac5dbe` empezó 36 s antes que las variables y,
por tanto, va contra **producción**: no se usa. Los despliegues desde `62f0bcf`
van contra staging. Cómo se comprueba sin abrir el JS: la franja de arriba
dice «base de pruebas staging-conta: los datos son inventados».

Las pruebas e2e no dependen de nada de esto: entran por la API y dejan la
sesión en el navegador.

## Vista previa del C00 (03/10)

Para que Julio pruebe el C00 con su usuario (tarea 9 del encargo).

- **Vercel:** las dos variables de vista previa, **limitadas a la rama**
  `conta/c00-empresa-y-tablas` (`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`,
  de staging-conta), creadas el 03/10. Las generales de vista previa siguen
  apuntando a producción. **Antes de esa hora, cada push a la rama desplegó una
  vista previa contra PRODUCCIÓN: no se usan.** Vale el primer despliegue que
  empezó después de crearlas, y los siguientes. Se comprueba igual que en el
  C01, sin abrir el JS: la franja de arriba dice «base de pruebas staging-conta:
  los datos son inventados».
- **Usuario:** el de Julio ya existe en staging-conta desde el C01, como
  administrador de la cuenta de prueba A (Taberna de Prueba Norte). Con él ve
  la empresa de A, las tablas, el registro de la IA y la sugerencia del 115.
- **Hook de claims:** igual que en el C01. Si el login se queda en la primera
  pantalla, falta activarlo en el panel (**Authentication → Hooks → Customize
  Access Token → Postgres → `public.custom_access_token_hook`**).
- **Para ver el alta desde cero** hace falta una cuenta sin empresa terminada.
  Con A, el alta se abre desde el menú: «Cambiar de empresa → + Dar de alta otra
  empresa». La empresa que cree se queda en A; la limpieza del e2e borra las
  que se queden **a medias**.

## Cómo se repite

1. Pasos 1 a 4 de arriba, en orden.
2. Ejecutar `staging/comparar_estructura.sql` en los dos lados y comparar
   cuentas y huellas con esta tabla.
3. Si producción ha cambiado entre medias, las huellas lo dirán. Se apunta la
   fecha de la copia.

## Vista previa del C02 y la guarda (05/10)

- **Lo que pasó:** la vista previa de `conta/c02-plan-contable` iba contra
  **producción**. La rama no tenía sus dos variables de vista previa y Vercel
  cogió las generales. Julio vio sus locales reales, sin Conta y sin franja.
  Yo la había dado por lista porque Vercel decía «success». Es la tercera vez,
  después del C00 y del R02.
- **Arreglo:** las dos variables (`VITE_SUPABASE_URL` y
  `VITE_SUPABASE_ANON_KEY` de staging-conta), solo «Preview» y solo la rama
  `conta/c02-plan-contable`, creadas el 05/10. Valen los despliegues que
  empiezan después.
- **Para que no vuelva a pasar: `build/guardaVistaPrevia.ts`.** En Vercel, el
  build de una vista previa de una rama `conta/**` o `reparto-**` **falla** si
  la URL o la clave anónima no son de staging-conta. Así el despliegue sale en
  rojo en el PR y no hay vista previa que dar por buena.
  - Está en el build porque es el único sitio que ve a la vez la rama y la base.
    `antes-de-subir.sh` no ve Vercel; sí pasa sus pruebas
    (`tests/unit/build/guardaVistaPrevia.test.ts`).
  - Cuando compila, el log del despliegue dice contra qué base lo hizo
    («[guarda de la vista previa] … se construye contra staging-conta»).
  - **Rama nueva `conta/**` o `reparto-**`:** primero las dos variables en
    Vercel y después el primer push. Si no, el primer despliegue sale en rojo,
    que es lo que tiene que pasar.

## Producción a cualquier hora (W01, 08/10)

**Desde el W01 no hay franja.** La de 00:30–12:15 fue una prudencia del C00:
el 07/10 paró la tanda del C04 con los negocios cerrados porque una tabla
**nueva** (`sales_day_summary`) se llamaba como las del pedido. Julio: «según
crezcamos no va a haber horas libres para nada». La forma de trabajar es la de
un SaaS: cambios que no rompen lo que está en marcha, a cualquier hora. Lo que
protege ya no es el reloj, sino **qué hace cada fichero contra lo que existe**.

`aplicar-produccion-conta.yml`, en este orden:

1. **Sin franja fija.** No hay guarda de horario ni campo `fuera_de_ventana`.
   El informe sigue diciendo la hora de Madrid.
2. **Ya aplicado no se reaplica.** El workflow lee el historial de producción
   (`supabase_migrations.schema_migrations`, donde cada fichero aplicado por
   el workflow queda con su versión y su huella md5). Un fichero ya registrado
   con la **misma** huella se quita de la tanda y se dice; con huella
   **distinta**, para (alguien ha cambiado un fichero ya aplicado). Un fichero
   sin registrar que solo crea cosas que **ya existen** también para: parece
   aplicado antes de que hubiera registro (el ensayo del C04 del 07/10 arrastró
   la tanda entera del C03).
3. **Cada sentencia se clasifica por lo que hace**, contra lo que existe en
   producción (se pregunta a la base, en solo lectura):
   - **Añadir**: crear tabla, vista o función; columna que admite vacío o con
     valor por defecto; índice con `concurrently`, o sin él en una tabla nueva
     o pequeña que no sea del camino del pedido; política RLS nueva; `insert
     … on conflict do nothing`; permisos; comentarios. **Pasa siempre.**
   - **Cambiar en caliente lo que existe**: reemplazar una función con la
     misma firma (o `drop` + `create` para cambiarle la firma), quitar y
     volver a poner una restricción (añadir un valor a un CHECK), un
     disparador o una política, una restricción o un disparador **nuevos** en
     una tabla que existe, reemplazar una vista, alterar una tabla. **Pasa**
     si el fichero lo declara en su cabecera y la prueba de staging lo cubre:
     ```sql
     -- cambia: public.conta_reabrir_mes · prueba: supabase/staging/sql/20261011_c04_prueba_agente.sql
     ```
     (la prueba tiene que existir en `supabase/staging/sql/` y nombrar el
     objeto: es lo que se puede comprobar sin ejecutarla). Si toca el **camino
     del pedido**, además, `autorizo`. Sin cabecera, para y no se autoriza: se
     arregla el fichero.
   - **Destruir o mover**: borrar o renombrar tabla, columna, vista o función;
     `update`/`delete`/`truncate` o `insert … on conflict do update` sobre una
     tabla que existe; cambiar el tipo de una columna (también ampliarlo: hoy
     no se distingue) o hacerla obligatoria; quitar una restricción, política o
     disparador sin volver a ponerlo; índice sin `concurrently` en una tabla
     grande (más de 100 000 filas estimadas) o del camino del pedido (`sale`
     tiene 13 475: frena las escrituras mientras se construye). **Solo con
     `autorizo`.** Borrar o renombrar exige además
     **prueba de que nada lo usa** —vistas, funciones y disparadores de la base,
     y el front del commit buscado en `src/`— y que la tanda **no expanda lo
     mismo que contrae**: añadir lo nuevo y quitar lo viejo van en dos tandas
     distintas («expandir y contraer»). El informe dice cuántas filas tiene la
     tabla y qué bloqueo toma.
   - **Crear una función con otra firma** de una que ya existe es una
     sobrecarga (regla 2 de CLAUDE.md): para; se hace `drop` + `create`.
4. **Camino del pedido** = tablas que **existen** y están en la lista de
   siempre (`CAMINO_TABLAS`), las funciones de `CAMINO_FUNCIONES` y las que
   disparan esas tablas o llama un cron. Una tabla que crea la propia tanda
   no está en el camino del pedido, se llame como se llame.
5. **Ensayo** como siempre: todo en una transacción, D1 y recuento dentro, y
   ROLLBACK. Obligatorio antes del real, del mismo commit. Después, en otra
   transacción que también se deshace, se ensaya la **vuelta atrás**: la tanda
   y sus `*.down.sql` en orden inverso. El informe dice si la vuelta atrás
   automática funcionaría.
6. **Real**: un fichero por transacción, y en la misma transacción su registro
   en el historial (`version` = el nombre del fichero sin `.sql`, porque los
   prefijos de fecha se repiten en 33 ficheros antiguos; `statements` = una
   línea con la huella md5). Para al primer fallo; la comprobación de después
   corre igual sobre lo que sí entró.
7. **Después, comprobación y vuelta atrás.** Tras el real: D1, recuento de
   filas de serie, los agentes de solo lectura (datos maestros y libro
   diario, antes y después: solo cuenta lo que se ha puesto en rojo con la
   tanda) y la **salud del camino del pedido**: si en los 15 minutos de antes
   entraron 3 o más pedidos de Foodint (hay servicio), en los 15 minutos de
   después tiene que haber al menos un cambio de estado (aceptado, listo,
   entregado al rider, entregado o cerrado). Medido sobre 30 días: con 3 o más
   pedidos en 15 minutos, la ventana siguiente se queda sin ningún cambio de
   estado 1 vez de 532; con la señal «no entra ningún pedido nuevo» habría
   saltado el 7 % de las veces. Sin servicio, no se mide y se dice. Si algo
   falla, el workflow aplica los `*.down.sql` de lo aplicado en orden inverso
   (cada uno con el borrado de su registro) y avisa; si la vuelta atrás
   tampoco pasa, para y avisa en rojo con lo que queda a medias.
8. **Las guardas de siempre no cambian**: la URL es la de producción y no la
   de staging, y al otro lado está Foodint, antes de cualquier conexión. Los
   agentes de después usan `PROD_CONTA_RO_DB_URL` (usuario `conta_lectura`).

**Ejemplo de lo que cambia, con la tanda real del C04** (prueba en
`tests/conta/produccion/w01.test.ts`): la 0100 ya no para por el nombre de
`sales_day_summary` (la crea ella), pero bloquea por otra cosa: pone CHECK y
un disparador en `fiscal_year` y `fiscal_period_lock`, que ya existían, sin
declararlo. Con la regla nueva, ese fichero lleva su cabecera `-- cambia:`
con la prueba de staging que lo cubre.

### Front compatible en los dos sentidos

Mientras dura una transición, el front publicado y el nuevo tienen que
funcionar con el esquema de antes y con el de después. Por eso lo que se borra
se borra **después** de que ningún front lo lea: `scripts/conta/antes-de-subir.sh`
busca en el `src/` de `origin/main` (lo publicado) y en el del commit que se
sube los nombres que la tanda de producción borra o renombra, y para si
alguno se usa todavía.
