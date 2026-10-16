-- scripts/conta/produccion/cuentas/centimo-iva.sql
--
-- C06b · LO QUE CUENTA LA TANDA DEL CÉNTIMO DE REDONDEO EN EL IVA
-- (20261113T0100), antes y después. Lo declara el manifiesto («cuenta: <este
-- fichero>») y lo comparan deshacer.sh y el ensayo de la vuelta atrás: tras
-- deshacer, las dos funciones tienen que tener la huella de antes. SOLO LEE.
--
-- Lo de Foodint, con su account_id (regla 9). La tanda no toca ningún
-- asiento: tienen que salir iguales antes y después.
select clave, valor from (
  select 1 o, 'huella de journal_entry_validar' clave, (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.journal_entry_validar(uuid,text)')) valor union all
  select 2, 'huella de conta_propuesta_ventas_unidad', (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.conta_propuesta_ventas_unidad(uuid,uuid,date,uuid,uuid)')) union all
  select 3, 'firmas de las dos (sin sobrecargas)', (select count(*) from pg_proc where proname in ('journal_entry_validar', 'conta_propuesta_ventas_unidad') and pronamespace = 'public'::regnamespace)::text union all
  select 4, 'asientos de Foodint por estado (no se tocan)', (select string_agg(status || ' ' || n, ' · ' order by status) from (select status, count(*) n from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) x) union all
  select 5, 'líneas de IVA de Foodint (no se tocan)', (select count(*) from public.journal_line where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and tax_rate_id is not null)::text
) t order by o;
