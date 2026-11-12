-- scripts/conta/produccion/cuentas/s01p-cierre-socio.sql
--
-- S01p·18 · punto 4 · El correo del cierre del socio (0015) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
--   1. La bandeja de Foodint: sus llegadas por clase, igual antes y después (la tanda no mueve ninguna).
--   2. Las llegadas con su liquidación del socio: la columna no existe antes; 0 después.
select clave, valor from (
  -- quieta: la tanda no mueve ninguna llegada
  select 1 o, 'Foodint · llegadas de la bandeja por clase' clave,
    (select string_agg(k || '=' || n, ' · ' order by k) from (
       select coalesce(doc_kind, '—') || '/' || status k, count(*)::text n from public.document_inbox
        where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by 1) x) valor
  union all
  -- quieta: la columna es nueva y la tanda no la rellena
  select 2, 'Foodint · llegadas con su liquidación del socio',
    case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'document_inbox' and column_name = 'licensed_settlement_id') then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.document_inbox where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710'' and licensed_settlement_id is not null', false, true, '')))[1]::text end
) t order by o;
