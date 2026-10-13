-- ============================================================================
-- B01 · 4 · LO QUE LEE EL MOTOR DE CONCILIACIÓN
-- ----------------------------------------------------------------------------
-- Encargo B01, tarea 4. Todo NUEVO: funciones de solo lectura (stable,
-- security invoker: cada una ve lo que la RLS deja ver a quien llama).
--
--   bank_facturas_recibidas_pendientes(empresa)
--       LA ÚNICA puerta del banco a las facturas recibidas (encargo, «Trabajo en
--       paralelo»): el frente A las está rehaciendo; si cambia el modelo, solo
--       cambia esta función. Hoy lee supplier_invoice: aprobadas sin pagar, con
--       lo ya casado por el banco descontado, su proveedor y su cuenta.
--   bank_saldos_cuentas(empresa, hasta, prefijos)
--       saldo de cada cuenta del plan que empiece por esos prefijos (400, 410,
--       430, 465, 475, 476…), con lo traído de Diez dentro: el saldo pendiente
--       del proveedor del libro traído (respuesta 2.5), los clientes, nóminas e
--       impuestos.
--   bank_asientos_sin_movimiento(empresa, desde, hasta)
--       apuntes en la 572 de cada banco de Folvy que aún no tienen movimiento:
--       lo traído de Diez (antes del corte, P4) y los pagos o cobros apuntados a
--       mano (P2: se enlazan, no se duplican).
--   bank_historial(empresa, desde)
--       lo que ya se sabe por concepto: los casados vivos (concepto del banco →
--       cuenta) y los apuntes de banco traídos de Diez (concepto del asiento →
--       su contrapartida). El núcleo saca de ahí la contraparte y aprende.
--   bank_ventas_plataforma(empresa, desde, hasta)
--       lo que cada plataforma te debe por día (las ventas del día asentadas en
--       su 430): para casar un cobro sin liquidación (P7), nunca como seguro.
--
-- Vuelta atrás: supabase/vuelta-atras/20261101T0130_b01_lectura.down.sql
-- ============================================================================

create or replace function public.bank_facturas_recibidas_pendientes(p_company uuid)
returns table (id uuid, numero text, fecha date, total numeric, pagado numeric, proveedor text, alias text[], tercero_id uuid, cuenta_tercero text)
language sql stable security invoker set search_path = public as $$
  select si.id, si.invoice_number, si.invoice_date, si.grand_total,
         coalesce((select sum(i.amount) from public.bank_match_item i join public.bank_match b on b.id = i.match_id
                    where i.supplier_invoice_id = si.id and b.status = 'vivo'), 0),
         s.name, array_remove(array[s.name, s.legal_name], null), pr.party_id,
         (select ca.code from public.company_account_link l join public.company_account ca on ca.id = l.company_account_id
           where l.company_id = p_company and l.entity = 'supplier' and l.entity_id = s.id::text and l.role = 'principal' limit 1)
    from public.supplier_invoice si
    join public.company c on c.id = p_company and c.account_id = si.account_id
    left join public.supplier s on s.id = si.supplier_id
    left join public.party_role pr on pr.supplier_id = s.id and pr.role = 'supplier'
   where si.status = 'aprobada' and si.paid_at is null and coalesce(si.grand_total, 0) > 0
     and (si.company_id is null or si.company_id = p_company)
$$;
grant execute on function public.bank_facturas_recibidas_pendientes(uuid) to authenticated;

create or replace function public.bank_saldos_cuentas(p_company uuid, p_hasta date, p_prefijos text[])
returns table (cuenta text, nombre text, saldo numeric, tercero_entidad text, tercero_id text)
language sql stable security invoker set search_path = public as $$
  select ca.code, coalesce(ca.plain_name, ca.name), coalesce(sum(jl.debit - jl.credit), 0),
         (select l.entity from public.company_account_link l where l.company_account_id = ca.id and l.entity in ('supplier', 'customer') limit 1),
         (select l.entity_id from public.company_account_link l where l.company_account_id = ca.id and l.entity in ('supplier', 'customer') limit 1)
    from public.company_account ca
    left join public.journal_line jl on jl.company_account_id = ca.id
    left join public.journal_entry je on je.id = jl.entry_id
   where ca.company_id = p_company and ca.code like any (select p || '%' from unnest(p_prefijos) p)
     and (je.id is null or (je.status in ('validado', 'anulado', 'propuesto') and je.entry_date <= p_hasta and je.source_type not in ('closing')))
   group by ca.id, ca.code, ca.plain_name, ca.name
  having coalesce(sum(jl.debit - jl.credit), 0) <> 0
$$;
grant execute on function public.bank_saldos_cuentas(uuid, date, text[]) to authenticated;

create or replace function public.bank_asientos_sin_movimiento(p_company uuid, p_desde date, p_hasta date)
returns table (entry_id uuid, treasury_account_id uuid, fecha date, importe numeric, concepto text, origen text)
language sql stable security invoker set search_path = public as $$
  select je.id, t.id, je.entry_date, jl.debit - jl.credit, je.concept,
         case when je.source_type = 'migrated' then 'traido' when je.source_type = 'supplier_payment' then 'pago_factura'
              when je.source_type = 'channel_settlement' then 'liquidacion' else 'otro' end
    from public.treasury_account t
    join public.company_account_link l on l.entity = 'bank_account' and l.entity_id = t.id::text and l.role = 'principal'
    join public.journal_line jl on jl.company_account_id = l.company_account_id
    join public.journal_entry je on je.id = jl.entry_id
   where t.company_id = p_company and je.status in ('propuesto', 'borrador', 'validado') and je.series <> 9
     and je.source_type not in ('bank', 'opening', 'closing') and je.entry_date between p_desde and p_hasta
     and not exists (select 1 from public.bank_match b where b.journal_entry_id = je.id and b.status = 'vivo')
$$;
grant execute on function public.bank_asientos_sin_movimiento(uuid, date, date) to authenticated;

create or replace function public.bank_historial(p_company uuid, p_desde date)
returns table (concepto text, cuenta text, tercero_id uuid, origen text)
language sql stable security invoker set search_path = public as $$
  -- Lo casado en Bancos: el concepto del banco y la otra cuenta del asiento.
  select coalesce(nullif(m.clean_concept, ''), m.bank_concept), ca.code, jl.party_id, 'banco'
    from public.bank_match b
    join public.bank_movement m on m.id = b.movement_id
    join public.journal_line jl on jl.entry_id = b.journal_entry_id
    join public.company_account ca on ca.id = jl.company_account_id
   where b.company_id = p_company and b.status = 'vivo' and b.kind <> 'traspaso' and ca.code not like '57%'
  union all
  -- Lo traído de Diez: el concepto del asiento de banco y su contrapartida.
  select je.concept, jl.external_counterpart, null::uuid, 'diez'
    from public.journal_line jl
    join public.journal_entry je on je.id = jl.entry_id
    join public.company_account ca on ca.id = jl.company_account_id
   where jl.company_id = p_company and ca.code like '572%' and je.source_type = 'migrated' and je.series <> 9
     and je.entry_date >= p_desde and jl.external_counterpart is not null and jl.external_counterpart not like '57%'
$$;
grant execute on function public.bank_historial(uuid, date) to authenticated;

create or replace function public.bank_ventas_plataforma(p_company uuid, p_desde date, p_hasta date)
returns table (cuenta text, fecha date, importe numeric)
language sql stable security invoker set search_path = public as $$
  select ca.code, je.entry_date, sum(jl.debit - jl.credit)
    from public.journal_line jl
    join public.journal_entry je on je.id = jl.entry_id
    join public.company_account ca on ca.id = jl.company_account_id
   where jl.company_id = p_company and ca.code like '430%' and je.source_type in ('sales_day', 'sales_adjustment')
     and je.status in ('propuesto', 'validado') and je.entry_date between p_desde and p_hasta
   group by ca.code, je.entry_date
$$;
grant execute on function public.bank_ventas_plataforma(uuid, date, date) to authenticated;
