-- scripts/conta/produccion/cuentas/s01-esqueleto.sql
--
-- S01 · LO QUE CUENTA LA TANDA DEL ESQUELETO (0100–0150), antes y después.
-- SOLO LEE. Recuentos de Foodint (regla 9) y huellas cortas de las dos
-- funciones que cambian en caliente; ningún nombre ni importe.
-- Lo que crea la propia tanda ANTES no existe: Postgres resuelve las tablas y
-- columnas de la consulta al analizarla (ensayo #89 de E05), así que se cuenta
-- con query_to_xml, que solo analiza su texto si se llega a llamar.
select clave, valor from (
  select 1 o, 'tablas nuevas (conta_user_pref, conta_eje_analitico)' clave,
    (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('conta_user_pref', 'conta_eje_analitico'))::text valor union all
  select 2, 'columnas nuevas de company (is_hospitality, logo_path)',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name in ('is_hospitality', 'logo_path'))::text union all
  select 3, 'empresas de Foodint', (select count(*) from public.company where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 4, 'empresas de Foodint de hostelería (sí / no / sin decir)',
    case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'is_hospitality') then 'sin columna'
    else (xpath('/row/c/text()', query_to_xml('select count(*) filter (where is_hospitality) || '' / '' || count(*) filter (where not is_hospitality) || '' / '' || count(*) filter (where is_hospitality is null) as c from public.company where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710''', false, true, '')))[1]::text end union all
  select 5, 'ejes de analítica de Foodint encendidos (local / marca)',
    case when to_regclass('public.conta_eje_analitico') is null then 'sin tabla'
    else (xpath('/row/c/text()', query_to_xml('select count(*) filter (where eje = ''local'' and activo) || '' / '' || count(*) filter (where eje = ''marca'' and activo) as c from public.conta_eje_analitico where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710''', false, true, '')))[1]::text end union all
  select 6, 'preferencias guardadas de Foodint',
    case when to_regclass('public.conta_user_pref') is null then 'sin tabla'
    else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.conta_user_pref where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710''', false, true, '')))[1]::text end union all
  select 7, 'el bucket company-logos', (select count(*) from storage.buckets where id = 'company-logos')::text union all
  select 8, 'políticas company_logos_*', (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'company\_logos\_%')::text union all
  select 9, 'huella corta de conta_motivos_para_validar(uuid)',
    coalesce((select left(md5(pg_get_functiondef(to_regprocedure('public.conta_motivos_para_validar(uuid)'))), 8)), 'no existe') union all
  select 10, 'huella corta de banco_facturas_recibidas_pendientes(uuid, date)',
    coalesce((select left(md5(pg_get_functiondef(to_regprocedure('public.banco_facturas_recibidas_pendientes(uuid, date)'))), 8)), 'no existe') union all
  select 11, 'asientos de Foodint (todos)', (select count(*) from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text
) t order by o;
