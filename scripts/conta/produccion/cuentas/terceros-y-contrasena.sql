-- scripts/conta/produccion/cuentas/terceros-y-contrasena.sql
--
-- C06b · LO QUE CUENTA LA TANDA DE LA RESPUESTA 6 (20261111T0600 y 0610),
-- antes y después. Lo declara el manifiesto («cuenta: <este fichero>») y lo
-- comparan deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- Se puede tomar ANTES (la tabla conta_contrasena_intento aún no existe: se
-- mira con to_regclass y se cuenta por query_to_xml solo si existe) y DESPUÉS
-- de deshacerla: tiene que salir igual que antes.
--
-- TABLA ENTERA, a propósito y dicho (regla 9): la serie del mapeo no es de
-- ninguna cuenta (company_id null), y es lo que cambia la 0600.
select clave, valor from (
  select 1 o, 'filas de serie del mapeo del balance' clave, (select count(*) from public.annual_accounts_mapping where company_id is null and statement = 'balance')::text valor union all
  select 2, 'filas de serie por signo (by_balance)', (select count(*) from public.annual_accounts_mapping where company_id is null and statement = 'balance' and by_balance is not null)::text union all
  select 3, 'filas de serie de terceros (40x, 41, 43x, 44)', (select count(*) from public.annual_accounts_mapping where company_id is null and statement = 'balance'
       and account_prefix in ('400','401','403','404','405','41','430','431','432','433','434','435','436','44'))::text union all
  select 4, 'filas propias de las empresas (no se tocan)', (select count(*) from public.annual_accounts_mapping where company_id is not null)::text union all
  select 5, 'tabla conta_contrasena_intento', (to_regclass('public.conta_contrasena_intento') is not null)::text union all
  select 6, 'peticiones de contraseña apuntadas', case when to_regclass('public.conta_contrasena_intento') is null then 'sin tabla'
       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.conta_contrasena_intento', false, true, '')))[1]::text end union all
  select 7, 'funciones conta_contrasena_*', (select string_agg(p.proname, ' · ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'conta\_contrasena\_%')
) t order by o;
