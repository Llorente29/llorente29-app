-- scripts/conta/produccion/cuentas/nombre-pdf-base.sql
--
-- C06b · LO QUE CUENTA LA TANDA DEL NOMBRE DEL DOCUMENTO (20261129T0380),
-- antes y después. Lo declara el manifiesto («cuenta: <este fichero>») y lo
-- comparan deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- Lo de Foodint, con su account_id (regla 9). La 0380 no toca ninguna fila: los
-- documentos de Foodint, sus nombres y sus asientos tienen que salir iguales.
select clave, valor from (
  select 1 o, 'lo que añade la 0380 (columna, función y disparador)' clave, concat_ws(' · ',
      'original_name ' || exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'journal_entry_document' and column_name = 'original_name')::text,
      'conta_nombre_fichero ' || (to_regprocedure('public.conta_nombre_fichero(text)') is not null)::text,
      'disparador ' || exists (select 1 from pg_trigger where tgname = 'trg_journal_entry_document_nombre_limpio' and not tgisinternal)::text) valor union all
  select 2, 'el CHECK de file_name (la red, no se toca)', (select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conrelid = 'public.journal_entry_document'::regclass and pg_get_constraintdef(c.oid) like '%file_name%') union all
  select 3, 'documentos de Foodint por clase', (select coalesce(string_agg(kind || ' ' || n, ' · ' order by kind), 'ninguno') from (select kind, count(*) n from public.journal_entry_document
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by kind) x) union all
  select 4, 'huella de los nombres de Foodint (no se tocan)', (select md5(coalesce(string_agg(id::text || ':' || file_name, ',' order by id), '')) from public.journal_entry_document
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 5, 'asientos de Foodint por estado (no se tocan)', (select string_agg(status || ' ' || n, ' · ' order by status) from (select status, count(*) n from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) x)
) t order by o;
