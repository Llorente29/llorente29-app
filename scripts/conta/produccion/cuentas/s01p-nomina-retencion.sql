-- scripts/conta/produccion/cuentas/s01p-nomina-retencion.sql
--
-- S01p·12 · La retención de la nómina de octubre de Foodint (0045) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
--   1. Líneas de la 4751 del asiento de la nómina de octubre con su retención (tipo, base y 111): 0 → 1.
--   2. Motivos para no validar ese asiento: 1 → 0.
select clave, valor from (
  -- corte: el asiento propuesto de la nómina de octubre de 2026 de Foodint (31/10, serie 9)
  select 1 o, 'La 4751 de la nómina de octubre con su retención' clave,
    (select count(*)::text from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and e.source_type = 'payroll' and e.series = 9 and e.entry_date = '2026-10-31' and e.created_at < timestamptz '2026-11-05 01:00+00' and a.code = '47510000'
        and l.withholding_rate_id is not null and l.withholding_base is not null and l.withholding_model = '111') valor
  union all
  -- corte: el asiento propuesto de la nómina de octubre de 2026 de Foodint (31/10, serie 9)
  select 2, 'Motivos para no validar la nómina de octubre',
    (select count(*)::text from public.journal_entry e cross join lateral public.conta_motivos_para_validar(e.id) m
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and e.source_type = 'payroll' and e.series = 9 and e.entry_date = '2026-10-31' and e.status = 'propuesto' and e.created_at < timestamptz '2026-11-05 01:00+00')
) t order by o;
