-- scripts/conta/produccion/cuentas/r14-proveedor-solo.sql
--
-- R14 · El proveedor que se da de alta solo · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta y empresa (regla 9: agrupa por account_id y company_id, sin anclar por nombre;
-- los ids van cortados a 8, sin nombres ni NIF):
--   1. las recibidas leídas (con lectura de factura) SIN proveedor que la 1130 mira (no
--      validadas, pagadas, descartadas ni anuladas), por lo que trae su NIF: ninguno, el de
--      la propia empresa, el de una plataforma de la cuenta, el de un proveedor que ya está,
--      uno nuevo que valida o uno que no valida;
--   2. las que la 1130 no mira: sin proveedor con su asiento validado, o pagadas,
--      descartadas o anuladas (lo validado no se toca: tiene que dar lo mismo después);
--   3. los proveedores dados de alta desde una factura (created_from = 'factura') y las
--      subcuentas 4000/4100 de cada empresa.
-- Corte fijo: lo creado antes del 21/11/2026 a las 00:00 de Madrid (lo que entre durante el
-- ensayo no cuenta: W06). Después de deshacer la tanda, todo tiene que dar como antes.
with r as (
  select i.account_id, i.company_id, i.id, i.status,
         public._conta_nif_clave(i.reading->'factura'->'proveedor'->>'nif') nif,
         public._conta_nif_clave(c.tax_id) nif_empresa,
         exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = i.id and e.status = 'validado') validada
    from public.supplier_invoice i
    join public.company c on c.id = i.company_id and c.account_id = i.account_id
   where i.supplier_id is null and coalesce(i.reading, '{}'::jsonb) ? 'factura'
     and i.created_at < timestamptz '2026-11-21 00:00:00+01'
), m as (
  select r.*, case
    when r.validada or r.status in ('pagada', 'descartada', 'anulada') then 'no la mira (validada, pagada, descartada o anulada)'
    when r.nif is null then 'sin NIF'
    when r.nif = r.nif_empresa then 'NIF de la propia empresa'
    when exists (select 1 from public.party p join public.party_role pr on pr.party_id = p.id and pr.role = 'platform'
                  where p.account_id = r.account_id and public._conta_nif_clave(p.tax_id) = r.nif) then 'NIF de una plataforma'
    when exists (select 1 from public.supplier s where s.account_id = r.account_id and s.archived_at is null and public._conta_nif_clave(s.tax_id) = r.nif) then 'NIF de un proveedor que ya está'
    when public._verifactu_nif_es_valido(r.nif) or (r.nif ~ '^[A-Z]{2}' and public._verifactu_nif_iva_ue_valido(left(r.nif, 2), substr(r.nif, 3))) then 'NIF nuevo que valida'
    else 'NIF que no valida' end clase
    from r
)
select clave, valor from (
  select 1 o, 'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) || ' · leídas sin proveedor · ' || clase clave,
         count(*)::text || ' facturas · ' || count(distinct nif) || ' NIF distintos' valor
    from m group by account_id, company_id, clase
  union all
  select 2, 'tabla entera · leídas sin proveedor', count(*)::text from m
  union all
  select 3, 'cuenta ' || left(s.account_id::text, 8) || ' · proveedores dados de alta desde una factura', count(*)::text
    from public.supplier s where s.created_from = 'factura' and s.created_at < timestamptz '2026-11-21 00:00:00+01' group by s.account_id
  union all
  select 4, 'cuenta ' || left(a.account_id::text, 8) || ' · empresa ' || left(a.company_id::text, 8) || ' · subcuentas de la ' || a.template_code, count(*)::text
    from public.company_account a where a.template_code in ('4000', '4100') and a.kind = 'own'
     and a.created_at < timestamptz '2026-11-21 00:00:00+01' group by a.account_id, a.company_id, a.template_code
) t order by o, clave;
