-- Bloque 1: las trece tablas de trabajo sin RLS, a anon y a authenticated.
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

-- Las dos que la F0.4 del 07/08 dejo a medias: cerro anon y no toco authenticated.
-- social_n2_usage tiene account_id y no tiene RLS: cualquier usuario logueado de
-- cualquier cuenta podia leer el consumo de las otras y poner su propio contador
-- a cero. Su unica escritora legitima es claim_n2_budget, que es SECURITY
-- DEFINER y que authenticated NI SIQUIERA PUEDE EJECUTAR: revocar no la rompe.
revoke all on table public.social_n2_usage from authenticated;

-- football_team_city es catalogo de referencia (0 filas, la llena la edge
-- function sports-events como service_role). Se le quita la escritura y se le
-- deja el SELECT, igual que hizo la F0.4 con anon.
revoke insert, update, delete, truncate, references, trigger
  on table public.football_team_city from authenticated;

-- Guarda: aborta si algo quedo abierto. Con has_table_privilege, no leyendo el ACL.
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

  -- football_team_city se queda con SELECT a proposito; solo se comprueba que
  -- no le quede escritura a nadie de los dos.
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