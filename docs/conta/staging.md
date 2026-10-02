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

## Cómo se repite

1. Pasos 1 a 4 de arriba, en orden.
2. Ejecutar `staging/comparar_estructura.sql` en los dos lados y comparar
   cuentas y huellas con esta tabla.
3. Si producción ha cambiado entre medias, las huellas lo dirán. Se apunta la
   fecha de la copia.
