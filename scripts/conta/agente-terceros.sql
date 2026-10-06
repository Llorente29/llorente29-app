-- scripts/conta/agente-terceros.sql
--
-- Agente «Datos maestros e impuestos», parte del C03: los terceros (clientes,
-- plataformas, socios de marca), sus liquidaciones y sus subcuentas. SOLO LEE.
-- Fichero aparte de agente-datos-maestros.sql porque nombra tablas del C03:
-- los workflows lo corren solo si public.party existe (antes del C03 en
-- producción, no). Lo revisa scripts/conta/lib/terceros.mjs.
--
-- Regla 9: cada fila lleva su account_id; el informe dice de qué cuenta es.

select json_build_object(
  'terceros', (select coalesce(json_agg(json_build_object(
      'account_id', p.account_id, 'id', p.id, 'name', p.name, 'tax_id', p.tax_id,
      'tax_id_type', coalesce(f.tax_id_type, s.tax_id_type), 'archived', p.archived_at is not null) order by p.account_id, p.name), '[]')
    from public.party p
    left join public.customer_fiscal f on f.party_id = p.id
    left join public.party_role r on r.party_id = p.id and r.role = 'supplier'
    left join public.supplier s on s.id = r.supplier_id),
  -- Subcuentas de cada tercero por papel y empresa: cliente (entity customer =
  -- el tercero) y proveedor (entity supplier = su ficha de proveedor).
  'cuentas', (select coalesce(json_agg(json_build_object(
      'account_id', x.account_id, 'company_id', x.company_id, 'entity', x.entity, 'entity_id', x.party_id, 'codes', x.codes)), '[]')
    from (
      select l.account_id, l.company_id, l.entity, coalesce(r.party_id::text, l.entity_id) party_id,
             array_agg(distinct a.code order by a.code) codes
        from public.company_account_link l
        join public.company_account a on a.id = l.company_account_id
        left join public.party_role r on l.entity = 'supplier' and r.supplier_id::text = l.entity_id
       where l.entity in ('customer', 'supplier')
       group by 1, 2, 3, 4
    ) x),
  'liquidaciones', (select coalesce(json_agg(json_build_object(
      'account_id', c.account_id, 'id', c.id, 'party_id', c.party_id, 'ref', c.settlement_ref,
      'gross_sales', c.gross_sales, 'commission', c.commission, 'net_payout', c.net_payout, 'needs_review', c.needs_review,
      -- Los mismos otros cargos que la app (tercerosService.ts, COSTES).
      'otros', json_build_array(c.delivery_transport, c.promo_product, c.promo_flash, c.offer_flash_credit, c.access_fee,
                                c.prime_fee, c.recurring_fee, c.incidents_cost, c.incidents_refund, c.min_order_fee, c.other_cost))
      order by c.account_id, c.settlement_date), '[]')
    from public.channel_settlement c),
  -- Lo vendido por cada plataforma y lo que cobró de comisión, por año (fecha
  -- de la liquidación, o el final de su periodo), con su modelo: comisionista o
  -- revendedor (party_role.platform_model; null = sin decir). El 347 depende
  -- de eso (RD 1065/2007, art. 34.3).
  'ventas_anio', (select coalesce(json_agg(json_build_object('account_id', v.account_id, 'party_id', v.party_id, 'anio', v.anio,
      'ventas', v.ventas, 'comisiones', v.comisiones, 'modelo', r.platform_model)), '[]')
    from (select c.account_id, c.party_id, extract(year from coalesce(c.period_to, c.proposed_period_to, c.settlement_date))::int anio,
                 sum(c.gross_sales) ventas, sum(abs(coalesce(c.commission, 0))) comisiones
            from public.channel_settlement c
           where c.party_id is not null and coalesce(c.period_to, c.proposed_period_to, c.settlement_date) is not null
           group by 1, 2, 3) v
    left join public.party_role r on r.party_id = v.party_id and r.role = 'platform'),
  'excluidos_347', (select coalesce(json_agg(json_build_object('account_id', f.account_id, 'party_id', f.party_id, 'motivo', f.exclude_347_reason)), '[]')
    from public.customer_fiscal f where f.exclude_347)
);
