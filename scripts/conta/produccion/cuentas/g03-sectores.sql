-- scripts/conta/produccion/cuentas/g03-sectores.sql
--
-- G03 · El sector de cada empresa · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE. La misma vara a los dos lados (regla 31): el sector se lee con
-- to_jsonb, así la consulta vale con la columna y sin ella. Todas las cuentas
-- a propósito (la tanda es de la tabla entera), salvo las filas 7 y 8.
-- Medido antes el 07/11 (solo lectura). Lo que tiene que pasar:
--   1. La columna company.sector: no → sí.
--   2. El disparador que mantiene is_hospitality: 0 → 1.
--   3. Empresas sin sector: 7 → 0.
--   4. Empresas por sector: general 0 → 0, hostelería 0 → 5, gestoría 0 → 2.
--   5. is_hospitality sí / no / nula: 4 / 2 / 1 → 5 / 2 / 0 (Casa Lola, de nula a sí).
--   6. Empresas cuyo sector no cuadra con is_hospitality (con sector): 0 → 0.
--   7. Foodint (51ad1792…): sector — → hostelería; is_hospitality sí → sí.
--   8. Asesoría QBO (f4e8032d…): 2 empresas, sector — → gestoría las dos.
select clave, valor from (
  select 1 o, 'La columna company.sector' clave,
    (select (count(*) > 0)::text from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'sector') valor union all
  select 2, 'El disparador company_sector_al_dia',
    (select count(*)::text from pg_catalog.pg_trigger where tgrelid = 'public.company'::regclass and tgname = 'company_sector_al_dia') union all
  select 3, 'Empresas sin sector (todas las cuentas)',
    (select count(*)::text from public.company c where to_jsonb(c)->>'sector' is null) union all
  select 4, 'Empresas por sector (todas las cuentas): general / hostelería / gestoría',
    (select concat_ws(' / ', count(*) filter (where to_jsonb(c)->>'sector' = 'general'), count(*) filter (where to_jsonb(c)->>'sector' = 'hosteleria'),
      count(*) filter (where to_jsonb(c)->>'sector' = 'gestoria')) from public.company c) union all
  select 5, 'is_hospitality sí / no / nula (todas las cuentas)',
    (select concat_ws(' / ', count(*) filter (where is_hospitality), count(*) filter (where not is_hospitality), count(*) filter (where is_hospitality is null)) from public.company) union all
  select 6, 'Empresas con sector que no cuadra con is_hospitality (todas las cuentas)',
    (select count(*)::text from public.company c where to_jsonb(c)->>'sector' is not null and (to_jsonb(c)->>'sector' = 'hosteleria') is distinct from coalesce(c.is_hospitality, false)) union all
  select 7, 'Foodint: sector · is_hospitality',
    (select string_agg(coalesce(to_jsonb(c)->>'sector', '—') || ' · ' || coalesce(c.is_hospitality::text, 'nula'), ', ') from public.company c where c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 8, 'Asesoría QBO: sector de cada empresa',
    (select count(*) || ' · ' || coalesce(string_agg(coalesce(to_jsonb(c)->>'sector', '—'), ', ' order by c.created_at), '') from public.company c where c.account_id = 'f4e8032d-510a-4e57-914c-4b67732d8655')
) q order by o;
