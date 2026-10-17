-- scripts/conta/produccion/cuentas/m01-esperan.sql
--
-- M01 · LO QUE CUENTA LA TANDA DE «ESPERAN» (20261117T0100), antes y después.
-- Lo declara el manifiesto («cuenta: <este fichero>») y lo comparan deshacer.sh
-- y el ensayo de la vuelta atrás: tras deshacer, las dos funciones que cambian
-- tienen que tener la huella de antes y las dos nuevas no existir. SOLO LEE.
--
-- Huellas de antes, medidas en producción en solo lectura el 16/10 a las 19:49
-- UTC y otra vez el 17/10 a las 05:40 UTC, iguales (con la tanda de C ya
-- aplicada): journal_entry_validar 798e4c43… (la de
-- 20261113T0100_c06b_centimo_iva) y tg_journal_entry_envio_por_aclarar
-- 7a2549b0… (la de 20261116T0100_c06b_promociones_envios). Son las que copia,
-- tal cual, la vuelta atrás.
--
-- Lo de Foodint, con su account_id (regla 9). La tanda no toca ningún asiento:
-- los asientos por estado y sus líneas tienen que salir iguales.
select clave, valor from (
  select 1 o, 'huella de journal_entry_validar' clave, (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.journal_entry_validar(uuid,text)')) valor union all
  select 2, 'huella de tg_journal_entry_envio_por_aclarar', (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.tg_journal_entry_envio_por_aclarar()')) union all
  select 3, 'firmas de las dos (sin sobrecargas)', (select count(*) from pg_proc where proname in ('journal_entry_validar', 'tg_journal_entry_envio_por_aclarar') and pronamespace = 'public'::regnamespace)::text union all
  select 4, 'lo que añade la 0100 (las dos funciones nuevas)', concat_ws(' · ',
      'conta_motivos_para_validar ' || (to_regprocedure('public.conta_motivos_para_validar(uuid)') is not null)::text,
      'conta_esperan ' || (to_regprocedure('public.conta_esperan(uuid,date,date)') is not null)::text) union all
  select 5, 'el freno de C sigue puesto', (select string_agg(tgname || ' ' || tgenabled::text,' · ') from pg_trigger where tgname = 'trg_journal_entry_envio_por_aclarar' and not tgisinternal) union all
  select 6, 'asientos de Foodint por estado (no se tocan)', (select string_agg(status || ' ' || n, ' · ' order by status) from (select status, count(*) n from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) x) union all
  select 7, 'líneas de Foodint (no se tocan)', (select count(*) from public.journal_line where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text
) t order by o;
