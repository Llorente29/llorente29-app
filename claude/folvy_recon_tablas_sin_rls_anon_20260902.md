# RECON · Las catorce tablas sin RLS con escritura de `anon`

**02/09/2026 · Solo reconocimiento. NO se ha ejecutado ni un `enable row level
security`, ni un `revoke`, ni un `drop`.**

Encargo de Julio: los catorce nombres, quién escribe legítimamente en cada una y
quién las lee, ANTES de tocar nada — porque activar RLS a ciegas rompe lo que
escriba de verdad y se descubriría en cocina. Verificación con
`has_table_privilege`, no leyendo el ACL.

---

## LA RESPUESTA CORTA, Y LA QUE MÁS IMPORTABA

**No es un incidente.** Ninguna de las dos copias de permisos —ni ninguna de las
otras once— la lee NADA en producción.

Y la evidencia no es «no he encontrado nada»: es que `pg_stat_database.stats_reset`
está a **NULL**, así que los contadores de `pg_stat_user_tables` cubren **toda la
vida de la base de datos**, no una ventana. Sobre esa base:

- **`pg_stat_statements`**: TODAS las consultas que han tocado estas trece
  tablas, sin excepción, las ejecutó el rol **`postgres`**, y todas son
  `create table … as` o un `select count(*)` de verificación del mismo guion que
  las creó, en agosto. Ni una de `anon`, `authenticated` ni `service_role`.
- **Objetos de la base**: cero. Ninguna función, vista, vista materializada,
  trigger, política, `cron.job` ni dependencia `pg_depend` nombra a ninguna.
- **Código de la aplicación**: cero lecturas. Hay tres apariciones en el
  repositorio y las tres son inertes — dos migraciones que las CREARON y un
  comentario en `src/native/print/printWorker.ts:301` que menciona
  `_backup_kds_fn_20260811` para explicar el incidente del 11/08. Comprobado
  abriendo la línea, no por el `grep`.

**Qué contienen las copias de permisos:** `id, account_id, name, description,
is_system, permissions, active, created_at, updated_at, created_by` (4 filas) y
`id, user_profile_id, permission_set_id, assigned_at, assigned_by` (2 filas). Son
UUID internos y el modelo de permisos. **No hay credenciales, ni contraseñas, ni
tokens.** Y como no las lee ningún camino de autorización, escribir en ellas **no
eleva privilegios a nadie**: lo que hay es divulgación de una copia muerta y una
puerta abierta que no hace falta.

Calibrado, para que la palabra no se infle: es **deuda de seguridad real**, no un
incidente. La clave anónima va en el bundle del navegador y es pública, así que
cualquiera puede leer y borrar estas trece tablas — pero borrar un backup muerto
no rompe producción, y leerlo no abre ninguna puerta.

---

## LAS CATORCE, UNA A UNA

Privilegios de `anon` verificados con `has_table_privilege(...)`, no con el
texto del ACL. En las trece primeras el resultado es idéntico: **SELECT, INSERT,
UPDATE y DELETE = true, y RLS desactivada.**

| Tabla | Filas | Quién la escribió | Quién la lee HOY | Último acceso (de por vida) |
|---|---:|---|---|---|
| `_a1_anuladas` | 9 | Auditoría de la cadena de stock, 25/08 (`claude/sql/20260825_A1_A2_A3_A5_ejecutado.sql`) | nadie | 25/08 06:49, rol `postgres` |
| `_a2_cache_antes` | 716 | ídem, foto previa | nadie | 25/08 06:49, `postgres` |
| `_a3_antes` | 641 | ídem, foto del ledger | nadie | 25/08 06:49, `postgres` |
| `_a3_cola` | 641 | ídem, cola de reproceso de combos | nadie | 25/08 06:47, `postgres` |
| `_backup_article_supplier_20260810` | 247 | copia previa a la migración del 10/08 | nadie | **nunca leída** |
| `_backup_article_supplier_20260815` | 511 | `20260815T0300_ficha_por_producto_clave.sql` | nadie | 14/08 22:02, `postgres` |
| `_backup_article_supplier_ctb_20260811` | 88 | copia previa CTB, 11/08 | nadie | 22/08 07:12, `postgres` |
| `_backup_kds_fn_20260811` | 13 | freno en caliente del incidente KDS del 11/08 | nadie (solo un comentario en `printWorker.ts:301`) | **nunca leída** |
| `_backup_kds_fn_20260811_pre0901` | 13 | ídem, segunda foto | nadie | **nunca leída** |
| `_backup_permission_set_assignments_20260814` | 2 | `20260814T1400_f0_a1_drop_permission_sets.sql` | nadie | 21/08 15:52, `postgres` |
| `_backup_permission_sets_20260814` | 4 | ídem | nadie | 14/08 11:56, `postgres` |
| `_backup_purchase_format_20260810` | 307 | copia previa a la migración del 10/08 | nadie | **nunca leída** |
| `_backup_purchase_order_20260810` | 26 | ídem | nadie | **nunca leída** |
| `spatial_ref_sys` | 8.500 | **PostGIS. No es nuestra** | PostGIS, por dentro | — |

---

## POR QUÉ REVOCAR NO PUEDE ROMPER NADA — comprobado, no supuesto

Era la pregunta de Julio: si activo esto a ciegas, ¿rompo lo que escribe de
verdad? Quien escribe de verdad es el rol `postgres`, y:

```
rolname          rolsuper  rolbypassrls
postgres         false     TRUE
service_role     false     TRUE
authenticated    false     false
anon             false     false
```

`postgres` es **dueño** de las tablas y además **`BYPASSRLS`**. Ni el `revoke` a
`anon`/`authenticated` ni un `enable row level security` le afectan. `service_role`
—los edge functions— también es `BYPASSRLS`, y de todos modos nunca las ha tocado.

**Conclusión operativa: para estas trece, el `revoke` es suficiente y la RLS ni
siquiera hace falta.** Activar RLS sobre una tabla que nadie lee añade una
política que mantener sin quitar la puerta; el `revoke` quita la puerta.

### `spatial_ref_sys` es el único caso con riesgo, y es de SELECT

Es tabla de PostGIS y **sí se usa**: `resolve_delivery_zone`,
`shop_check_delivery`, `upsert_delivery_zone_polygon` y
`upsert_delivery_zone_radius` hacen trabajo de SRID, y `shop_check_delivery` es
la que consulta la tienda pública.

Ahora bien, **las cuatro son `SECURITY DEFINER`** (verificado en `pg_proc.prosecdef`),
así que corren con los permisos de su dueño y el grant de `anon` les da igual. Y
ningún fichero de `src/` ni de `supabase/functions/` nombra `spatial_ref_sys`.

Aun así, la propuesta es conservadora: **quitarle a `anon` solo INSERT, UPDATE y
DELETE, y dejarle el SELECT.** `ST_Transform` lee esa tabla; escribirla no hace
falta nunca en tiempo de ejecución. Es el cambio con riesgo cero y toda la
ganancia.

*(De paso, y por si alguien se lo pregunta al ver que `anon` puede EJECUTAR
`upsert_delivery_zone_*`: las dos llevan `current_user_is_admin_of(v_account)`
dentro. Comprobado abriendo el cuerpo. Un anónimo se lleva un «Sin permiso». No
es un frente.)*

---

## LA PROPUESTA, EN TRES BLOQUES SEPARADOS

Separados a propósito: el primero es reversible y no puede romper nada; el
tercero borra datos y no se mezcla con los otros dos.

**Bloque 1 — cerrar la puerta (reversible, riesgo cero).**
Las trece nuestras, a `anon` y a `authenticated`. Ninguna pantalla las lee, así
que no hay nada que pueda dejar de funcionar.

**Bloque 2 — `spatial_ref_sys`, solo escritura.**
`revoke insert, update, delete`; el `select` se queda. Aparte del bloque 1
porque es tabla de una extensión y merece su propia línea en el registro.

**Bloque 3 — tirar lo que ya no se va a restaurar.**
Ocho `_backup_*` de agosto y cuatro `_a*` del 25/08. Un backup que nadie va a
restaurar es solo superficie. Esto lo decide Julio tabla por tabla; el bloque 1
ya deja el sistema seguro sin borrar nada, así que el 3 puede esperar todo lo
que haga falta.

---

## LO QUE ESTE RECON NO CUBRE

Las **272 tablas restantes** que también dan INSERT/UPDATE/DELETE a `anon` por el
default de Supabase y que **sí tienen RLS**. Ahí la política aguanta el golpe y
por eso no son de este frente, pero el grant sigue siendo innecesario: cada vez
que alguien cree una tabla y se olvide de la RLS, aparece una catorceava. La
cura de raíz es
`alter default privileges in schema public revoke insert, update, delete on tables from anon`,
y eso es otra conversación, con su propia verificación.
