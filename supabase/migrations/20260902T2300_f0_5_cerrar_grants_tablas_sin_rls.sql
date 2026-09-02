-- 20260902T2300_f0_5_cerrar_grants_tablas_sin_rls.sql
-- APLICADA y verificada el 02/09 con `has_table_privilege`, antes y después.
-- Decidida ANTES del cambio bajo el criterio F2 de la banda de operación: una
-- revocación sobre objetos que nadie lee no toca cocina, pedidos ni escaparate.
--
-- ── LO QUE CIERRA ──────────────────────────────────────────────────────────
-- Las TRECE tablas de trabajo sin RLS que el RECON del frente 19 midió una a
-- una: cero funciones, vistas, triggers, crons y dependencias las nombran; cero
-- lecturas desde la aplicación; y todas las consultas de su vida las hizo
-- `postgres`, que es dueño y `BYPASSRLS`. Por eso basta el `revoke` y no hace
-- falta activar RLS: activarla sobre una tabla que nadie lee añade una política
-- que mantener sin quitar la puerta.
--
-- ── Y LAS DOS QUE LA F0.4 DEL 07/08 DEJÓ A MEDIAS ──────────────────────────
-- `20260807T1600_f0_4_close_no_rls_table_holes.sql` hizo bien su trabajo: se
-- comprobó y `anon` está cerrado en las dos, exactamente como dice su cabecera.
-- Lo que pasa es que **su alcance era `anon`** —lo dice el título— y
-- `authenticated` se quedó fuera. En una tabla con `account_id` y sin RLS,
-- `authenticated` es el rol peligroso: es cualquier usuario logueado de
-- cualquiera de las tres cuentas.
--
--   · `social_n2_usage` (account_id, day, count) — 40 filas, VIVA: la escribe
--     `claim_n2_budget`, y el último acceso es de hoy 02/09 a las 12:08 UTC.
--     Es el contador diario del agente Social. Sin RLS y con INSERT/UPDATE/
--     DELETE para `authenticated`, cualquier usuario logueado podía leer el
--     consumo de las otras cuentas y poner su propio contador a cero, o sea
--     darse presupuesto ilimitado.
--
--     REVOCAR NO LA ROMPE, y esto se comprobó antes de tocar nada:
--     `claim_n2_budget` es `SECURITY DEFINER`, su dueño es `postgres` —que
--     conserva INSERT y UPDATE— y **ni `anon` ni `authenticated` pueden
--     ejecutarla**. La escritura no pasa nunca por el grant del usuario.
--
--   · `football_team_city` — catálogo de referencia, 0 filas, nunca leída, sin
--     `account_id`. La llena la edge function `sports-events` como
--     `service_role`. Se le quita la escritura a `authenticated` y se le deja
--     el SELECT, que es exactamente lo que la F0.4 hizo con `anon`.
--
-- `spatial_ref_sys` NO se toca aquí: es de PostGIS y va en su propio bloque.
--
-- ── VERIFICADO DESPUÉS ─────────────────────────────────────────────────────
-- Las trece más `social_n2_usage`: `anon` y `authenticated` a false en SELECT,
-- INSERT, UPDATE y DELETE. `football_team_city`: SELECT true, escritura false
-- en los dos. `service_role` conserva lectura en las quince. Con
-- `has_table_privilege`, no leyendo el ACL — que ya nos mordió con `=X/postgres`.

revoke all on table public._a1_anuladas                               from anon, authenticated;
revoke all on table public._a2_cache_antes                            from anon, authenticated;
revoke all on table public._a3_antes                                  from anon, authenticated;
revoke all on table public._a3_cola                                   from anon, authenticated;
revoke all on table public._backup_article_supplier_20260810          from anon, authenticated;
revoke all on table public._backup_article_supplier_20260815          from anon, authenticated;
revoke all on table public._backup_article_supplier_ctb_20260811      from anon, authenticated;
revoke all on table public._backup_kds_fn_20260811                    from anon, authenticated;
revoke all on table public._backup_kds_fn_20260811_pre0901            from anon, authenticated;
revoke all on table public._backup_permission_set_assignments_20260814 from anon, authenticated;
revoke all on table public._backup_permission_sets_20260814           from anon, authenticated;
revoke all on table public._backup_purchase_format_20260810           from anon, authenticated;
revoke all on table public._backup_purchase_order_20260810            from anon, authenticated;

revoke all on table public.social_n2_usage from authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.football_team_city from authenticated;

-- Guarda: aborta si algo quedó abierto. `has_table_privilege`, no el ACL.
do $guarda$
declare
  t text;
  abiertas text := '';
begin
  foreach t in array array[
    '_a1_anuladas','_a2_cache_antes','_a3_antes','_a3_cola',
    '_backup_article_supplier_20260810','_backup_article_supplier_20260815',
    '_backup_article_supplier_ctb_20260811','_backup_kds_fn_20260811',
    '_backup_kds_fn_20260811_pre0901','_backup_permission_set_assignments_20260814',
    '_backup_permission_sets_20260814','_backup_purchase_format_20260810',
    '_backup_purchase_order_20260810','social_n2_usage'
  ] loop
    if has_table_privilege('anon', 'public.'||quote_ident(t), 'select')
    or has_table_privilege('anon', 'public.'||quote_ident(t), 'insert')
    or has_table_privilege('anon', 'public.'||quote_ident(t), 'update')
    or has_table_privilege('anon', 'public.'||quote_ident(t), 'delete')
    or has_table_privilege('authenticated', 'public.'||quote_ident(t), 'select')
    or has_table_privilege('authenticated', 'public.'||quote_ident(t), 'insert')
    or has_table_privilege('authenticated', 'public.'||quote_ident(t), 'update')
    or has_table_privilege('authenticated', 'public.'||quote_ident(t), 'delete')
    then
      abiertas := abiertas || t || ' ';
    end if;
  end loop;

  if has_table_privilege('anon','public.football_team_city','insert')
  or has_table_privilege('anon','public.football_team_city','update')
  or has_table_privilege('anon','public.football_team_city','delete')
  or has_table_privilege('authenticated','public.football_team_city','insert')
  or has_table_privilege('authenticated','public.football_team_city','update')
  or has_table_privilege('authenticated','public.football_team_city','delete')
  then
    abiertas := abiertas || 'football_team_city(escritura) ';
  end if;

  if abiertas <> '' then
    raise exception 'F0.5 incompleta, siguen abiertas: %', abiertas;
  end if;
end
$guarda$;
