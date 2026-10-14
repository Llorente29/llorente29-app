-- scripts/conta/produccion/cuentas/cuenta-lectura.sql
--
-- C06b · LO QUE CUENTA LA TANDA DEL AVISO #178 (20261111T0500 y 0510), antes y
-- después. Lo declara el manifiesto («cuenta: <este fichero>») y lo comparan
-- deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- Se puede tomar ANTES de la tanda (la columna company_account.import_run_id
-- aún no existe: se mira con information_schema y se cuenta por query_to_xml
-- solo si existe) y DESPUÉS de deshacerla: tiene que salir igual que antes.
--
-- TABLA ENTERA, a propósito y dicho (regla 9): todas las cuentas juntas. Es
-- una huella de «esto no se ha movido».
select clave, valor from (
  select 1 o, 'subcuentas (company_account)' clave, (select count(*) from public.company_account)::text valor union all
  select 2, 'subcuentas «migrated» sin importación del plan', (select count(*) from public.company_account where source = 'migrated' and import_id is null)::text union all
  select 3, 'columna company_account.import_run_id', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'company_account' and column_name = 'import_run_id')::text union all
  select 4, 'subcuentas con su lectura del histórico', case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_account' and column_name = 'import_run_id') then 'sin columna'
       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.company_account where import_run_id is not null', false, true, '')))[1]::text end union all
  select 5, 'md5 de conta_diez_subcuentas', md5(pg_get_functiondef('public.conta_diez_subcuentas(uuid,uuid,jsonb)'::regprocedure)) union all
  select 6, 'lecturas de otro programa (import_run)', (select count(*) from public.import_run)::text union all
  select 7, 'apuntes (journal_line)', (select count(*) from public.journal_line)::text
) t order by o;
