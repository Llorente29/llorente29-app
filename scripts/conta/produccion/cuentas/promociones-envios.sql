-- scripts/conta/produccion/cuentas/promociones-envios.sql
--
-- C06b · LO QUE CUENTA LA TANDA DE PROMOCIONES Y ENVÍOS (20261116T0100 y
-- T0110), antes y después. Lo declara el manifiesto («cuenta: <este fichero>»)
-- y lo comparan deshacer.sh y el ensayo de la vuelta atrás: tras deshacer,
-- todo tiene que salir como antes. SOLO LEE.
--
-- Lo de Foodint, con su account_id (regla 9). La tanda no toca ningún
-- asiento: los asientos por estado y sus líneas tienen que salir iguales.
select clave, valor from (
  select 1 o, 'huella de conta_propuesta_ventas_unidad' clave, (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.conta_propuesta_ventas_unidad(uuid,uuid,date,uuid,uuid)')) valor union all
  select 2, 'huella de conta_resumen_ventas', (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.conta_resumen_ventas(uuid)')) union all
  select 3, 'firmas de las dos (sin sobrecargas)', (select count(*) from pg_proc where proname in ('conta_propuesta_ventas_unidad', 'conta_resumen_ventas') and pronamespace = 'public'::regnamespace)::text union all
  select 4, 'lo que añade la 0100 (tablas, funciones y el freno)', concat_ws(' · ',
      'conta_ventas_canal_cuenta ' || (to_regclass('public.conta_ventas_canal_cuenta') is not null)::text,
      'conta_envio_aclarado ' || (to_regclass('public.conta_envio_aclarado') is not null)::text,
      'conta_cargos_de_pedidos ' || (to_regprocedure('public.conta_cargos_de_pedidos(uuid,uuid[])') is not null)::text,
      'conta_envio_aclarar ' || (to_regprocedure('public.conta_envio_aclarar(uuid,text,text,text)') is not null)::text,
      'freno ' || exists (select 1 from pg_trigger where tgname = 'trg_journal_entry_envio_por_aclarar' and not tgisinternal)::text) union all
  select 5, 'subcuentas 70009001–70009003 y 70500001 de Foodint', (select string_agg(code || ' ' || name, ' · ' order by code) from public.company_account
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and code in ('70009001', '70009002', '70009003', '70500001')) union all
  -- La tabla la crea la propia tanda: antes no existe, así que se cuenta por query_to_xml solo si existe.
  select 6, 'enlaces de promociones y envíos de Foodint', case when to_regclass('public.conta_ventas_canal_cuenta') is null then 'sin la tabla'
      else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.' || 'conta_ventas_canal_cuenta where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710''', false, true, '')))[1]::text end union all
  select 7, 'asientos de Foodint por estado (no se tocan)', (select string_agg(status || ' ' || n, ' · ' order by status) from (select status, count(*) n from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) x) union all
  select 8, 'líneas de Foodint (no se tocan)', (select count(*) from public.journal_line where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text
) t order by o;
