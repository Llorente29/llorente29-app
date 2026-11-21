-- scripts/conta/produccion/cuentas/s01p-linea-socio.sql
--
-- S01p·18 · punto 1 · La línea desconocida del socio (1755) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
--   1. Lo que proponen las liquidaciones del socio de Foodint (todas las guardadas): la misma huella antes y después
--      (ninguna trae líneas contestadas: la 1755 no cambia lo que ya proponían).
--   2. Lo que se recuerda de las líneas del socio: no existe antes; 0 después.
--   3. La 40090000 de Foodint: no se mueve (la tanda no apunta nada; los 770,00 son el 3392 de Julio).
select clave, valor from (
  -- corte: las liquidaciones del socio de Foodint guardadas antes del 13/11/2026
  select 1 o, 'Huella de lo que proponen las liquidaciones del socio de Foodint' clave,
    (select md5(string_agg(l.id::text || ':' || public.conta_propuestas_socio(l.company_id, l.id)::text, '|' order by l.id))
       from public.licensed_settlement l
      where l.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and l.company_id is not null and l.created_at < timestamptz '2026-11-13 00:00+00') valor
  union all
  -- quieta: la tabla es nueva y la tanda no escribe ninguna regla
  select 2, 'Reglas de las líneas del socio',
    case when to_regclass('public.socio_linea_regla') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.socio_linea_regla where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710''', false, true, '')))[1]::text end
  union all
  -- quieta: la tanda no apunta nada
  select 3, 'Foodint · 40090000 (Haber − Debe, lo vivo)',
    (select coalesce(sum(l.credit - l.debit), 0)::numeric(14,2)::text from public.journal_line l join public.journal_entry e on e.id = l.entry_id
       join public.company_account a on a.id = l.company_account_id
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.status in ('propuesto', 'borrador', 'validado') and a.code = '40090000')
) t order by o;
