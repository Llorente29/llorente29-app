-- scripts/conta/produccion/cuentas/validar-con-pdf.sql
--
-- C06b · LO QUE CUENTA LA TANDA DE LA RESPUESTA 8 (20261111T0720), antes y
-- después. Lo declara el manifiesto («cuenta: <este fichero>») y lo comparan
-- deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- Lo de Foodint, con su account_id (regla 9). Los asientos y documentos no
-- cambian con la tanda: tienen que salir iguales antes y después.
select clave, valor from (
  select 1 o, 'función conta_numero_previsto' clave, (to_regprocedure('public.conta_numero_previsto(uuid)') is not null)::text valor union all
  select 2, 'función journal_entry_validar_con_documento', (to_regprocedure('public.journal_entry_validar_con_documento(uuid, integer, text, text, text, integer, text)') is not null)::text union all
  select 3, 'disparador diferido trg_journal_entry_valida_con_pdf', (select count(*) from pg_trigger where tgname = 'trg_journal_entry_valida_con_pdf' and tgrelid = 'public.journal_entry'::regclass and tgdeferrable and tginitdeferred)::text union all
  select 4, 'asientos de Foodint por estado (no se tocan)', (select string_agg(status || ' ' || n, ' · ' order by status) from (select status, count(*) n from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) x) union all
  select 5, 'asientos de plataforma de Foodint validados sin PDF', (select count(*) from public.journal_entry e join public.sales_day_summary d on d.entry_id = e.id and d.account_id = e.account_id and d.channel_id is not null
       where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.status = 'validado'
         and not exists (select 1 from public.journal_entry_document x where x.entry_id = e.id and x.kind = 'resumen_ventas'))::text union all
  select 6, 'documentos de Foodint (no se tocan)', (select count(*) from public.journal_entry_document where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text
) t order by o;
