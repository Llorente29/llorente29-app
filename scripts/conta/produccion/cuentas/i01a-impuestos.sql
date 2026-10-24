-- scripts/conta/produccion/cuentas/i01a-impuestos.sql
--
-- I01a · LO QUE CUENTA LA TANDA DE IMPUESTOS POR DENTRO (0100–0150), antes y
-- después. SOLO LEE. Recuentos de Foodint (regla 9), sin nombres, NIF, CSV ni
-- importes. Lo que crea la propia tanda ANTES no existe: Postgres resuelve las
-- tablas de la consulta al analizarla, así que se cuenta con query_to_xml, que
-- solo analiza su texto si se llega a llamar.
--
-- Lo que tiene que pasar: las tablas de impuestos, 16 más (tax_form y
-- tax_rate ya estaban); los modelos de
-- Foodint en tax_forms, iguales antes y después (la 0110 los copia a
-- tax_obligation sin tocar la columna); las obligaciones vigentes de Foodint,
-- de «sin tabla» a tantas como modelos; los secretos del Vault, los mismos
-- (la 0130 crea la función que guarda, no guarda nada); 0 declaraciones y 0
-- certificados.
select clave, valor from (
  select 1 o, 'tablas de impuestos (tax_*, company_tax_facts, company_tax_presenter)' clave,
    (select count(*) from information_schema.tables where table_schema = 'public'
      and (table_name like 'tax\_%' or table_name in ('company_tax_facts', 'company_tax_presenter')))::text valor union all
  select 2, 'funciones conta_impuesto_* y conta_cert_*',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'conta\_impuesto\_%' or proname like 'conta\_cert\_%'))::text union all
  select 3, 'empresas de Foodint con perfil fiscal',
    (select count(*) from public.company_tax_profile p join public.company c on c.id = p.company_id where c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 4, 'modelos de Foodint en tax_forms (en orden)',
    (select coalesce(string_agg(array_to_string(p.tax_forms, ','), ' | ' order by p.company_id), 'ninguno') from public.company_tax_profile p
       join public.company c on c.id = p.company_id where c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 5, 'obligaciones vigentes de Foodint (activas / quitadas)',
    case when to_regclass('public.tax_obligation') is null then 'sin tabla'
    else (xpath('/row/c/text()', query_to_xml('select count(*) filter (where active) || '' / '' || count(*) filter (where not active) as c from public.tax_obligation where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710'' and valid_to is null', false, true, '')))[1]::text end union all
  select 6, 'disparador de tax_forms en company_tax_profile',
    (select count(*) from pg_trigger where tgrelid = 'public.company_tax_profile'::regclass and tgname = 'company_tax_profile_tax_forms')::text union all
  select 7, 'fuentes oficiales (todas / las dos del BOE de festivos)',
    (select count(*) || ' / ' || count(*) filter (where key in ('boe-fiestas-laborales-2026', 'boe-fiestas-laborales-2027')) from public.official_source) union all
  select 8, 'festivos cargados',
    case when to_regclass('public.tax_holiday') is null then 'sin tabla'
    else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.tax_holiday', false, true, '')))[1]::text end union all
  select 9, 'declaraciones de Foodint',
    case when to_regclass('public.tax_return') is null then 'sin tabla'
    else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.tax_return where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710''', false, true, '')))[1]::text end union all
  select 10, 'certificados de Foodint',
    case when to_regclass('public.tax_certificate') is null then 'sin tabla'
    else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.tax_certificate where owner_account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710''', false, true, '')))[1]::text end union all
  select 11, 'secretos en el Vault (cuántos)', (select count(*) from vault.secrets)::text union all
  select 12, 'asientos de Foodint (todos)', (select count(*) from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text
) t order by o;
