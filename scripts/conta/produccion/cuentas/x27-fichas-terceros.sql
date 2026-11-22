-- scripts/conta/produccion/cuentas/x27-fichas-terceros.sql
--
-- X27 · Las fichas de proveedor y de cliente (1315) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1315 añade columnas vacías a supplier y a customer_fiscal y dos disparadores que solo escriben en lo vacío de una
-- recibida nueva cuando la ficha de su proveedor tiene algo escrito en ellas (al aplicar, ninguna). Se mide, por
-- cuenta (regla 9), que las fichas y las recibidas son las mismas: la huella de cada ficha de proveedor y de cliente
-- (lo que ya guardaban) y, de las recibidas, cuántas tienen % deducible, «No incluir en 347», marca, y cuántas líneas
-- tienen plataforma.
-- Corte fijo: lo creado y cambiado antes del 22/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'cuenta ' || s.account_id || ' · fichas de proveedor (cuántas · huella)' clave,
         count(*) || ' · ' || md5(string_agg(concat_ws('|', s.id, s.name, s.legal_name, s.tax_id, s.tax_id_type, s.country_code,
           s.fiscal_street, s.fiscal_postal_code, s.fiscal_city, s.fiscal_province, s.phone, s.email, s.notes, s.vat_regime,
           s.usual_tax_rate_ids::text, s.irpf_withholding_pct, s.default_location_id, s.payment_method, s.payment_terms_days, s.iban),
           ',' order by s.id)) valor
    from public.supplier s
   where s.created_at < timestamptz '2026-11-22 00:00:00+01' and s.updated_at < timestamptz '2026-11-22 00:00:00+01'
   group by s.account_id
  union all
  select 2, 'cuenta ' || c.account_id || ' · fichas de cliente (cuántas · huella)',
         count(*) || ' · ' || md5(string_agg(concat_ws('|', c.party_id, c.legal_name, c.tax_id_type, c.country_code, c.fiscal_street,
           c.fiscal_postal_code, c.fiscal_city, c.fiscal_province, c.equivalence_surcharge, c.withholding_rate_id, c.operation_scope,
           c.exclude_347, c.payment_method, c.payment_terms_days, c.collection_treasury_id, c.iban), ',' order by c.party_id))
    from public.customer_fiscal c
   where c.created_at < timestamptz '2026-11-22 00:00:00+01' and c.updated_at < timestamptz '2026-11-22 00:00:00+01'
   group by c.account_id
  union all
  select 3, 'cuenta ' || i.account_id || ' · recibidas (con % deducible · no 347 · marca)',
         count(i.vat_deductible_pct) || ' · ' || count(*) filter (where i.exclude_from_347) || ' · ' || count(i.brand_id)
    from public.supplier_invoice i where i.created_at < timestamptz '2026-11-22 00:00:00+01'
   group by i.account_id
  union all
  select 4, 'cuenta ' || d.account_id || ' · líneas de recibida con plataforma', count(*)::text
    from public.supplier_invoice_expense_dato d where d.channel_id is not null and d.updated_at < timestamptz '2026-11-22 00:00:00+01'
   group by d.account_id
) t order by o, clave;
