-- scripts/conta/produccion/cuentas/v04-iva-reabrir.sql
--
-- V04 · Respuesta 5, punto 3 (27/10) · LO QUE CUENTA LA TANDA DE «REABRIR PARA
-- CORREGIR», antes y después. SOLO LEE. Las declaraciones y los asientos son de
-- Foodint (regla 9), con un corte fijo (W06). Lo que la tanda crea solo se
-- nombra dentro de cadenas.
-- Lo que tiene que cambiar: las tablas (0 → 2), los disparadores (0 → 4), el
-- cron (0 → 1) y las huellas de las dos funciones del candado. Lo demás, igual.
select clave, valor from (
  select 1 o, '303 de Foodint hasta el corte (presentados / todos)' clave,
    (select count(*) filter (where status in ('filed', 'booked', 'paid', 'offset', 'refunded')) || ' / ' || count(*) from public.tax_return
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and form_code = '303' and created_at < timestamptz '2026-10-27 06:00:00+00') valor union all
  select 2, 'asientos de Foodint con IVA hasta el corte',
    (select count(distinct e.id) from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.created_at < timestamptz '2026-10-27 06:00:00+00'
        and (l.vat_book is not null or a.code like '472%' or a.code like '477%'))::text union all
  select 3, 'las tablas de las reaperturas (base entera)',
    (select count(*) from unnest(array['vat_reopening', 'vat_reopening_entry']) t where to_regclass('public.' || t) is not null)::text union all
  select 4, 'los disparadores de la reapertura y el cron (base entera)',
    (select count(*) from pg_trigger where tgname in ('trg_tax_return_reapertura_cerrar', 'trg_journal_entry_iva_reabierto', 'trg_journal_line_iva_reabierto', 'trg_vat_book_entry_iva_reabierto'))::text
      || ' y ' || (select count(*) from cron.job where jobname = 'iva-reabierto-recordar')::text union all
  select 5, 'huella de conta_iva_presentado y conta_iva_presentados',
    (select string_agg(p.proname || ' ' || left(md5(pg_get_functiondef(p.oid)), 8), ', ' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('conta_iva_presentado', 'conta_iva_presentados'))
) t order by o;
