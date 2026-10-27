-- scripts/conta/produccion/cuentas/v04-iva-candado.sql
--
-- V04 · Respuesta 5 (27/10) · LO QUE CUENTA LA TANDA DEL CANDADO DEL IVA, antes
-- y después. SOLO LEE. Los asientos y el libro son de Foodint (regla 9), con un
-- corte fijo (W06). Lo que la tanda crea solo se nombra dentro de cadenas.
-- Lo que tiene que cambiar: los disparadores del candado (0 → 3), sus
-- funciones (0 → 14) y la huella de _journal_entry_proponer. Lo demás, igual:
-- los asientos con IVA y el libro de Foodint hasta el corte, los 303
-- presentados, y lo que hay de Sumied (no traído) en un periodo presentado (0).
select clave, valor from (
  select 1 o, 'asientos de Foodint con IVA hasta el corte (traídos / de Sumied)' clave,
    (select count(distinct e.id) filter (where e.source_type = 'migrated') || ' / ' || count(distinct e.id) filter (where e.source_type <> 'migrated')
       from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.created_at < timestamptz '2026-10-27 06:00:00+00'
        and (l.vat_book is not null or a.code like '472%' or a.code like '477%')) valor union all
  select 2, 'anotaciones del libro de IVA de Foodint hasta el corte',
    (select count(*) from public.vat_book_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-10-27 06:00:00+00')::text union all
  select 3, '303 de Foodint presentados hasta el corte',
    (select count(*) from public.tax_return where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and form_code = '303'
        and status in ('filed', 'booked', 'paid', 'offset', 'refunded') and filed_at < timestamptz '2026-10-27 06:00:00+00')::text union all
  select 4, 'asientos de Sumied con IVA en un periodo presentado de Foodint',
    -- quieta: con los meses hasta septiembre cerrados y el corte de lo traído en el 30/09, nada de Sumied entra ahí
    (select count(distinct e.id) from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
      join public.tax_return r on r.company_id = e.company_id and r.form_code = '303' and r.status in ('filed', 'booked', 'paid', 'offset', 'refunded')
       and r.fiscal_year = extract(year from e.entry_date)::int and r.period = ((extract(month from e.entry_date)::int - 1) / 3 + 1)::text || 'T'
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.source_type not in ('migrated', 'vat_settlement', 'opening', 'closing')
        and (l.vat_book is not null or a.code like '472%' or a.code like '477%'))::text union all
  select 5, 'disparadores del candado (base entera)',
    (select count(*) from pg_trigger where tgname in ('trg_journal_entry_0_iva_presentado', 'trg_journal_line_0_iva_presentado', 'trg_vat_book_entry_0_iva_presentado'))::text union all
  select 6, 'funciones del candado (base entera)',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('conta_iva_presentado', 'conta_iva_periodo_nombre', 'conta_iva_periodo_frase', 'conta_iva_periodo_de', 'conta_primer_dia_iva_abierto',
                        'conta_iva_presentado_mensaje', '_conta_iva_exento', '_conta_iva_asiento_con_iva', '_conta_iva_dia_del_libro', '_conta_iva_candado_asiento',
                        '_conta_iva_candado_apunte', '_conta_iva_candado_libro', '_conta_iva_ajustar_propuesta', 'conta_iva_presentados'))::text union all
  select 7, 'huella de _journal_entry_proponer',
    (select left(md5(pg_get_functiondef(p.oid)), 8) from pg_proc p where p.oid = 'public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)'::regprocedure)
) t order by o;
