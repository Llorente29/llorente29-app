-- scripts/conta/produccion/cuentas/contabilidad-sola.sql
--
-- C06 · LO QUE CUENTA LA TANDA DE «CONTABILIDAD SOLA» (20261111T0100, 0200 y
-- 0300), antes y después. Lo declara el manifiesto («cuenta: <este fichero>»)
-- y lo comparan deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- Se puede tomar ANTES de la tanda (conta_diez_base y las columnas
-- accounts.product_brand y company_account.name_pending aún no existen: se miran con to_regclass / information_schema y se cuentan
-- por query_to_xml solo si existen) y DESPUÉS de deshacerla: tiene que salir
-- igual que antes.
--
-- TABLA ENTERA, a propósito y dicho (regla 9): todas las cuentas juntas. Es
-- una huella de «esto no se ha movido».
select clave, valor from (
  select 1 o, 'cuentas (accounts)' clave, (select count(*) from public.accounts)::text valor union all
  select 2, 'cuentas con marca (product_brand)', case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'product_brand') then 'sin columna'
       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.accounts where product_brand is not null', false, true, '')))[1]::text end union all
  select 3, 'restricciones de accounts', (select string_agg(conname, ' · ' order by conname) from pg_constraint where conrelid = 'public.accounts'::regclass and contype = 'c') union all
  select 4, 'interruptores conta (feature_flags)', (select count(*) from public.feature_flags where feature_key = 'conta')::text union all
  select 5, 'funciones de la tanda (conta_crear_cuenta_sola, conta_contrasena_de_marca, conta_diez_*)', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and (p.proname in ('conta_crear_cuenta_sola', 'conta_contrasena_de_marca', 'company_account_nombre_puesto') or p.proname like 'conta\_diez\_%'))::text union all
  select 6, 'subcuentas (company_account)', (select count(*) from public.company_account)::text union all
  select 7, 'columna company_account.name_pending', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'company_account' and column_name = 'name_pending')::text union all
  select 8, 'subcuentas sin nombre (name_pending)', case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_account' and column_name = 'name_pending') then 'sin columna'
       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.company_account where name_pending', false, true, '')))[1]::text end union all
  select 9, 'disparadores de company_account', (select string_agg(tgname, ' · ' order by tgname) from pg_trigger where tgrelid = 'public.company_account'::regclass and not tgisinternal) union all
  select 10, 'tabla conta_diez_base', (to_regclass('public.conta_diez_base') is not null)::text union all
  select 11, 'bases de Diez registradas', case when to_regclass('public.conta_diez_base') is null then 'sin tabla'
       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.conta_diez_base', false, true, '')))[1]::text end union all
  select 12, 'md5 de conta_diez_subcuentas', md5(pg_get_functiondef('public.conta_diez_subcuentas(uuid,uuid,jsonb)'::regprocedure)) union all
  select 13, 'lecturas de Diez (import_run, program diez)', (select count(*) from public.import_run where program = 'diez')::text
) t order by o;
