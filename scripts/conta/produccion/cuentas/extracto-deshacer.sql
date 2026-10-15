-- scripts/conta/produccion/cuentas/extracto-deshacer.sql
--
-- B01 · LO QUE CUENTA LA TANDA DE «DESHACER UN EXTRACTO» (20261101T0180),
-- antes y después. Lo declara el manifiesto («cuenta: <este fichero>») y lo
-- comparan deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- La tanda solo añade una función: los extractos, movimientos, casados y el
-- registro no se mueven al aplicarla. TABLA ENTERA, a propósito y dicho
-- (regla 9): todas las cuentas juntas, como huella de «esto no se ha movido».
select clave, valor from (
  select 1 o, 'función bank_extracto_deshacer' clave, (to_regprocedure('public.bank_extracto_deshacer(uuid, text)') is not null)::text valor union all
  select 2, 'extractos (todas las cuentas)', (select count(*) from public.bank_statement)::text union all
  select 3, 'movimientos por estado (todas las cuentas)', (select coalesce(string_agg(status || ' ' || n, ' · ' order by status), '') from (select status, count(*) n from public.bank_movement group by 1) x) union all
  select 4, 'casados por estado (todas las cuentas)', (select coalesce(string_agg(status || ' ' || n, ' · ' order by status), '') from (select status, count(*) n from public.bank_match group by 1) x) union all
  select 5, 'apuntes de «Lo que ha hecho» (todas las cuentas)', (select count(*) from public.bank_activity_log)::text
) t order by o;
