-- Aplicada: 2026-08-07 por MCP (verificada: anon sin grants en social_n2_usage; solo SELECT en football_team_city)
-- F0.4 · Tablas SIN RLS con grants a anon.
-- Hallazgo: anon tenía SELECT/INSERT/UPDATE/DELETE en tablas sin RLS.
--   - social_n2_usage (tiene account_id): leak/tamper cross-tenant alcanzable por REST -> revocar anon.
--   - football_team_city (referencia pública): quitar escritura a anon, dejar SELECT.
--   - spatial_ref_sys (PostGIS): excepción documentada, no se toca (no somos owner; referencia pública).
-- Nota: las 19 tablas "RLS activa sin política" están en deny-all -> el RLS protege los verbos REST;
-- no son fuga. TRUNCATE no lo filtra RLS pero PostgREST no lo expone -> sin camino.

revoke all on table public.social_n2_usage from anon;
revoke insert, update, delete, truncate, references, trigger on table public.football_team_city from anon;

-- Guard: abortar si anon conserva algo en social_n2_usage o escritura en football_team_city.
do $$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants
  where table_schema='public' and grantee='anon'
    and ( table_name='social_n2_usage'
       or (table_name='football_team_city' and privilege_type <> 'SELECT') );
  if n <> 0 then
    raise exception 'F0.4 incompleta: anon conserva % privilegios', n;
  end if;
end $$;
