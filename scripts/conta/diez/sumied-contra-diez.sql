-- scripts/conta/diez/sumied-contra-diez.sql
--
-- B01r·25 · Lo que necesita sumied-contra-diez.ts de Sumied, en un JSON, con
-- conta_lectura (solo lectura) y solo la empresa :emp (Foodint; regla 9):
--   · asientos: 2026 con la vara única, con su referencia de Diez si vino de
--     Diez, sus documentos y sus líneas en céntimos;
--   · envios: external_send, con la referencia que Diez le dio;
--   · foto / foto_n: la foto de Diez del 12/10 (external_entry_snapshot) de
--     enero a septiembre, por mes y subcuenta, y los asientos por mes.
--   · cuentas: no se usa para salir nada; solo recuento.
-- No se publica: se queda en el runner.
select json_build_object(
  'asientos', (
    select coalesce(json_agg(json_build_object(
      'id', e.id, 'fecha', e.entry_date, 'serie', e.series, 'numero', e.number, 'estado', e.status,
      'anulado', e.voided_at is not null, 'contra', e.reverses_entry_id is not null,
      'ext', case when e.external_number is not null then coalesce(e.external_year, '2026') || '/' || e.external_series || '/' || e.external_number end,
      'docs', (select count(*) from public.journal_entry_document d where d.entry_id = e.id),
      'lineas', (select json_agg(json_build_array(a.code, round(l.debit * 100)::bigint, round(l.credit * 100)::bigint))
                   from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = e.id))), '[]'::json)
      from public.journal_entry e
     where e.company_id = :'emp'::uuid and e.entry_date between date '2026-01-01' and date '2026-12-31'
       and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)),
  'envios', (
    select coalesce(json_agg(json_build_object('entry_id', s.entry_id, 'kind', s.kind, 'status', s.status,
      'ext', case when s.ext_number is not null then s.ext_year || '/' || s.ext_series || '/' || s.ext_number end,
      'documento', s.document_status)), '[]'::json)
      from public.external_send s where s.company_id = :'emp'::uuid),
  'foto', (
    select coalesce(json_agg(json_build_array(x.mes, x.cuenta, x.c)), '[]'::json) from (
      select to_char(f.entry_date, 'YYYYMM') mes, l->>'cuenta' cuenta, sum((l->>'debe')::bigint - (l->>'haber')::bigint) c
        from public.external_entry_snapshot f, jsonb_array_elements(f.lines) l
       where f.company_id = :'emp'::uuid and f.entry_date between date '2026-01-01' and date '2026-09-30'
       group by 1, 2) x),
  'foto_n', (
    select coalesce(json_agg(json_build_array(x.mes, x.n)), '[]'::json) from (
      select to_char(f.entry_date, 'YYYYMM') mes, count(*) n from public.external_entry_snapshot f
       where f.company_id = :'emp'::uuid and f.entry_date between date '2026-01-01' and date '2026-09-30' group by 1) x),
  'cuentas', '[]'::json
);
