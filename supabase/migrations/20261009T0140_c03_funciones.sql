-- ============================================================================
-- C03 · 5 · LO QUE SE HACE DESDE LA FICHA (funciones)
-- ----------------------------------------------------------------------------
-- Todas comprueban que quien llama es administrador o encargado de la cuenta
-- del tercero (party_cuenta) y devuelven lo que ha pasado, para que la pantalla
-- lo diga (regla 8 de CLAUDE.md: un botón confirma o falla en pantalla).
--   · party_save_customer        alta o edición de un cliente (un NIF, un tercero)
--   · party_add_role             añadir un papel (cliente, plataforma, socio)
--   · party_set_archived         archivar y recuperar (con su proveedor)
--   · channel_settlement_collect / _uncollect   apuntar o quitar un cobro
--   · channel_settlement_confirm_period         el periodo propuesto pasa a ser el periodo
--   · brand_partner_settlement_compute          la liquidación del socio, calculada (no escribe)
--   · brand_partner_settlement_prepare / _confirm   borrador por local y confirmar
--   · brand_licensing_agreement_set_party       enlazar un acuerdo a su socio
-- Vuelta atrás: supabase/vuelta-atras/20261009T0140_c03_funciones.down.sql
-- ============================================================================

-- La cuenta del tercero, si quien llama puede tocarla.
create or replace function public.party_cuenta(p_party uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select account_id into v from party where id = p_party;
  if v is null then raise exception 'Ese tercero no existe.' using errcode = 'P0002'; end if;
  if not current_user_is_admin_or_manager_of(v) then
    raise exception 'No puedes cambiar este tercero.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function public.party_cuenta(uuid) from public, anon, authenticated;

-- ── Alta o edición de un cliente ────────────────────────────────────────────
-- p_party nulo = alta. Si el NIF ya es de otro tercero, para con su nombre: la
-- pantalla propone «es el mismo que tu proveedor X: añadirle el papel de
-- cliente» (party_add_role) en vez de crear otro.
create or replace function public.party_save_customer(
  p_account uuid, p_party uuid, p_nombre text, p_nif text, p_datos jsonb default '{}'::jsonb, p_quien_nombre text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_party uuid := p_party; v_nif text := public.party_nif(p_nif); v_otro record; v_nuevo boolean := p_party is null;
begin
  if not current_user_is_admin_or_manager_of(p_account) then
    raise exception 'No puedes dar de alta clientes en esta cuenta.' using errcode = '42501';
  end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Ponle un nombre.' using errcode = '22023'; end if;
  if v_party is not null and (select account_id from party where id = v_party) is distinct from p_account then
    raise exception 'Ese tercero no es de esta cuenta.' using errcode = '42501';
  end if;
  if v_nif is not null then
    select p.id, p.name into v_otro from party p where p.account_id = p_account and p.tax_id = v_nif and p.id is distinct from v_party;
    if found then
      raise exception 'MISMO_NIF %: % ya tiene el NIF %.', v_otro.id, v_otro.name, v_nif using errcode = '23505';
    end if;
  end if;
  if v_nuevo then
    insert into party (account_id, name, tax_id, source, created_by, created_by_name)
    values (p_account, trim(p_nombre), v_nif, 'manual', auth.uid(), p_quien_nombre) returning id into v_party;
  else
    -- El nombre de un tercero con proveedor lo manda su ficha de Cocina.
    update party set name = case when exists (select 1 from party_role where party_id = v_party and role = 'supplier') then name else trim(p_nombre) end,
                     tax_id = v_nif
     where id = v_party;
  end if;
  insert into party_role (account_id, party_id, role, created_by) values (p_account, v_party, 'customer', auth.uid())
  on conflict (party_id, role) do nothing;
  insert into customer_fiscal (party_id, account_id) values (v_party, p_account) on conflict (party_id) do nothing;
  update customer_fiscal set
    legal_name             = case when p_datos ? 'legalName'          then nullif(trim(p_datos->>'legalName'), '') else legal_name end,
    tax_id_type            = case when p_datos ? 'taxIdType'          then p_datos->>'taxIdType' else tax_id_type end,
    country_code           = case when p_datos ? 'countryCode'        then coalesce(nullif(p_datos->>'countryCode', ''), 'ES') else country_code end,
    entity_kind            = case when p_datos ? 'entityKind'         then p_datos->>'entityKind' else entity_kind end,
    tax_id_check_status    = case when p_datos ? 'taxIdCheckStatus'   then p_datos->>'taxIdCheckStatus' else tax_id_check_status end,
    tax_id_checked_at      = case when p_datos ? 'taxIdCheckStatus'   then now() else tax_id_checked_at end,
    tax_id_verified_at     = case when p_datos->>'taxIdCheckStatus' = 'valid' then now()
                                  when p_datos ? 'taxIdCheckStatus'   then null else tax_id_verified_at end,
    fiscal_street          = case when p_datos ? 'fiscalStreet'       then nullif(trim(p_datos->>'fiscalStreet'), '') else fiscal_street end,
    fiscal_postal_code     = case when p_datos ? 'fiscalPostalCode'   then nullif(trim(p_datos->>'fiscalPostalCode'), '') else fiscal_postal_code end,
    fiscal_city            = case when p_datos ? 'fiscalCity'         then nullif(trim(p_datos->>'fiscalCity'), '') else fiscal_city end,
    fiscal_province        = case when p_datos ? 'fiscalProvince'     then nullif(trim(p_datos->>'fiscalProvince'), '') else fiscal_province end,
    equivalence_surcharge  = case when p_datos ? 'equivalenceSurcharge' then (p_datos->>'equivalenceSurcharge')::boolean else equivalence_surcharge end,
    withholding_rate_id    = case when p_datos ? 'withholdingRateId'  then nullif(p_datos->>'withholdingRateId', '')::uuid else withholding_rate_id end,
    operation_scope        = case when p_datos ? 'operationScope'     then p_datos->>'operationScope' else operation_scope end,
    exclude_347            = case when p_datos ? 'exclude347'         then (p_datos->>'exclude347')::boolean else exclude_347 end,
    exclude_347_reason     = case when p_datos ? 'exclude347Reason'   then nullif(trim(p_datos->>'exclude347Reason'), '') else exclude_347_reason end,
    payment_method         = case when p_datos ? 'paymentMethod'      then nullif(p_datos->>'paymentMethod', '') else payment_method end,
    payment_terms_days     = case when p_datos ? 'paymentTermsDays'   then nullif(p_datos->>'paymentTermsDays', '')::int else payment_terms_days end,
    payment_fixed_days     = case when p_datos ? 'paymentFixedDays'   then (select array_agg(x::int) from jsonb_array_elements_text(p_datos->'paymentFixedDays') x) else payment_fixed_days end,
    collection_treasury_id = case when p_datos ? 'collectionTreasuryId' then nullif(p_datos->>'collectionTreasuryId', '')::uuid else collection_treasury_id end,
    iban                   = case when p_datos ? 'iban'               then nullif(upper(regexp_replace(p_datos->>'iban', '\s', '', 'g')), '') else iban end,
    sepa_mandate_ref       = case when p_datos ? 'sepaMandateRef'     then nullif(trim(p_datos->>'sepaMandateRef'), '') else sepa_mandate_ref end,
    sepa_mandate_date      = case when p_datos ? 'sepaMandateDate'    then nullif(p_datos->>'sepaMandateDate', '')::date else sepa_mandate_date end
  where party_id = v_party;
  -- La cuenta donde cobra, de esta empresa y de esta cuenta.
  if exists (select 1 from customer_fiscal cf join treasury_account t on t.id = cf.collection_treasury_id
              where cf.party_id = v_party and t.account_id <> p_account) then
    raise exception 'Esa cuenta de cobro no es de esta cuenta.' using errcode = '23514';
  end if;
  return jsonb_build_object('party_id', v_party, 'nuevo', v_nuevo);
end $$;
revoke all on function public.party_save_customer(uuid, uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.party_save_customer(uuid, uuid, text, text, jsonb, text) to authenticated;

-- ── Añadir un papel ─────────────────────────────────────────────────────────
-- platform: {channelId, settlementEvery, commissionPct}; al darle el canal, sus
--   liquidaciones de ese canal quedan enlazadas a este tercero.
-- brand_partner: {contributionKinds: [...]}.
-- customer: sin nada (los datos van con party_save_customer).
create or replace function public.party_add_role(p_party uuid, p_role text, p_config jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public.party_cuenta(p_party); v_canal uuid; n int := 0;
begin
  if p_role not in ('customer', 'platform', 'brand_partner') then
    raise exception 'Ese papel no se añade desde aquí (el de proveedor llega con su ficha de Cocina).' using errcode = '22023';
  end if;
  if p_role = 'platform' then
    v_canal := nullif(p_config->>'channelId', '')::uuid;
    insert into party_role (account_id, party_id, role, channel_id, settlement_every, commission_pct, created_by)
    values (v_cuenta, p_party, 'platform', v_canal, nullif(p_config->>'settlementEvery', ''), nullif(p_config->>'commissionPct', '')::numeric, auth.uid())
    on conflict (party_id, role) do update set channel_id = excluded.channel_id, settlement_every = excluded.settlement_every,
                                                commission_pct = excluded.commission_pct;
    if v_canal is not null then
      update channel_settlement set party_id = p_party
       where account_id = v_cuenta and channel_id = v_canal and party_id is distinct from p_party;
      get diagnostics n = row_count;
    end if;
  elsif p_role = 'brand_partner' then
    insert into party_role (account_id, party_id, role, contribution_kinds, created_by)
    values (v_cuenta, p_party, 'brand_partner',
            coalesce((select array_agg(x) from jsonb_array_elements_text(p_config->'contributionKinds') x), array['marketing', 'packaging']), auth.uid())
    on conflict (party_id, role) do update set contribution_kinds = excluded.contribution_kinds;
  else
    insert into party_role (account_id, party_id, role, created_by) values (v_cuenta, p_party, 'customer', auth.uid())
    on conflict (party_id, role) do nothing;
    insert into customer_fiscal (party_id, account_id) values (p_party, v_cuenta) on conflict (party_id) do nothing;
  end if;
  return jsonb_build_object('party_id', p_party, 'role', p_role, 'liquidaciones_enlazadas', n);
end $$;
revoke all on function public.party_add_role(uuid, text, jsonb) from public, anon;
grant execute on function public.party_add_role(uuid, text, jsonb) to authenticated;

-- ── Archivar y recuperar ────────────────────────────────────────────────────
-- Archivar no borra nada: cuentas, movimientos, liquidaciones e histórico se
-- quedan. Sale de listas y propuestas; se recupera con un clic. Su ficha de
-- proveedor de Cocina va con él.
create or replace function public.party_set_archived(p_party uuid, p_archivar boolean, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public.party_cuenta(p_party); v_cuando timestamptz := case when p_archivar then now() end;
begin
  update party set archived_at = v_cuando, archived_note = case when p_archivar then nullif(trim(p_nota), '') end where id = p_party;
  update supplier s set archived_at = v_cuando
    from party_role r where r.party_id = p_party and r.supplier_id = s.id and s.archived_at is distinct from v_cuando;
  return jsonb_build_object('party_id', p_party, 'archivado', p_archivar);
end $$;
revoke all on function public.party_set_archived(uuid, boolean, text) from public, anon;
grant execute on function public.party_set_archived(uuid, boolean, text) to authenticated;

-- ── Cobro de una liquidación de plataforma ──────────────────────────────────
-- Se apunta lo que llegó al banco, tal cual. Si no es el neto, la ficha dice
-- «con diferencia» y la cifra. Nunca se cuadra sola.
create or replace function public.channel_settlement_collect(p_id uuid, p_fecha date, p_importe numeric, p_nota text default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cs channel_settlement;
begin
  select * into v_cs from channel_settlement where id = p_id;
  if not found then raise exception 'Esa liquidación no existe.' using errcode = 'P0002'; end if;
  if not current_user_is_admin_or_manager_of(v_cs.account_id) then raise exception 'No puedes apuntar cobros en esta cuenta.' using errcode = '42501'; end if;
  if p_fecha is null or p_importe is null then raise exception 'Hace falta la fecha y el importe que llegó.' using errcode = '22023'; end if;
  update channel_settlement set collected_on = p_fecha, collected_amount = p_importe, collection_note = nullif(trim(p_nota), ''),
         collected_by = auth.uid(), collected_by_name = p_quien_nombre, updated_at = now()
   where id = p_id;
  return jsonb_build_object('id', p_id, 'neto', v_cs.net_payout, 'cobrado', p_importe,
                            'diferencia', case when v_cs.net_payout is null then null else round(p_importe - v_cs.net_payout, 2) end);
end $$;
revoke all on function public.channel_settlement_collect(uuid, date, numeric, text, text) from public, anon;
grant execute on function public.channel_settlement_collect(uuid, date, numeric, text, text) to authenticated;

create or replace function public.channel_settlement_uncollect(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from channel_settlement where id = p_id;
  if v_cuenta is null then raise exception 'Esa liquidación no existe.' using errcode = 'P0002'; end if;
  if not current_user_is_admin_or_manager_of(v_cuenta) then raise exception 'No puedes quitar cobros en esta cuenta.' using errcode = '42501'; end if;
  update channel_settlement set collected_on = null, collected_amount = null, collection_note = null, collected_by = null,
         collected_by_name = null, updated_at = now() where id = p_id;
end $$;
revoke all on function public.channel_settlement_uncollect(uuid) from public, anon;
grant execute on function public.channel_settlement_uncollect(uuid) to authenticated;

-- ── Confirmar el periodo propuesto ──────────────────────────────────────────
create or replace function public.channel_settlement_confirm_period(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cs channel_settlement;
begin
  select * into v_cs from channel_settlement where id = p_id;
  if not found then raise exception 'Esa liquidación no existe.' using errcode = 'P0002'; end if;
  if not current_user_is_admin_or_manager_of(v_cs.account_id) then raise exception 'No puedes cambiar esta liquidación.' using errcode = '42501'; end if;
  if v_cs.proposed_period_from is null then raise exception 'Esta liquidación no tiene periodo propuesto.' using errcode = '22023'; end if;
  if v_cs.period_from is not null then raise exception 'Esta liquidación ya tiene periodo.' using errcode = '22023'; end if;
  update channel_settlement set period_from = proposed_period_from, period_to = proposed_period_to,
         period_confirmed_at = now(), period_confirmed_by = auth.uid(), updated_at = now()
   where id = p_id;
  return jsonb_build_object('id', p_id, 'desde', v_cs.proposed_period_from, 'hasta', v_cs.proposed_period_to);
end $$;
revoke all on function public.channel_settlement_confirm_period(uuid) from public, anon;
grant execute on function public.channel_settlement_confirm_period(uuid) to authenticated;

-- ── La liquidación del socio de marca, calculada (no escribe nada) ──────────
-- Por local y periodo: compras del local (líneas de sus albaranes confirmados,
-- valoradas) − aportaciones del socio en ese local + comisión sobre las ventas
-- sin IVA de sus marcas en ese local (el % de cada acuerdo). Las ventas se
-- cortan por la fecha de Madrid (regla 4 de CLAUDE.md: sold_at está en UTC).
-- «faltan» dice lo que impide cerrarla: una línea de albarán sin precio, una
-- venta sin base imponible, ninguna marca con acuerdo, o ninguna venta de sus
-- marcas en el periodo (las ventas no han llegado).
create or replace function public.brand_partner_settlement_compute(p_party uuid, p_location uuid, p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cuenta uuid;
  v_compras numeric := 0; v_albaranes int := 0; v_sin_precio jsonb;
  v_aport numeric := 0; v_aport_n int := 0;
  v_base numeric := 0; v_comision numeric := 0; v_ventas int := 0; v_sin_base int := 0; v_marcas jsonb;
  v_faltan jsonb := '[]'::jsonb; v_pct numeric;
begin
  select account_id into v_cuenta from party where id = p_party;
  if v_cuenta is null or not belongs_to_account(v_cuenta) then raise exception 'Ese tercero no existe.' using errcode = 'P0002'; end if;
  if not exists (select 1 from party_role where party_id = p_party and role = 'brand_partner') then
    raise exception 'Ese tercero no es socio de marca.' using errcode = '22023';
  end if;
  if p_hasta < p_desde then raise exception 'El periodo acaba antes de empezar.' using errcode = '22023'; end if;

  -- Compras: las líneas de los albaranes confirmados a su ficha de proveedor, en ese local.
  select coalesce(sum(coalesce(l.doc_amount, l.qty_received * l.unit_cost)), 0),
         count(distinct g.id),
         coalesce(jsonb_agg(jsonb_build_object('albaran', g.code, 'linea', coalesce(l.product_name, l.raw_text)))
                    filter (where l.doc_amount is null and (l.qty_received is null or l.unit_cost is null)), '[]'::jsonb)
    into v_compras, v_albaranes, v_sin_precio
    from goods_receipt g
    join party_role r on r.supplier_id = g.supplier_id and r.party_id = p_party
    join goods_receipt_line l on l.goods_receipt_id = g.id
   where g.account_id = v_cuenta and g.location_id = p_location and g.status = 'confirmado'
     and g.receipt_date between p_desde and p_hasta;
  if jsonb_array_length(v_sin_precio) > 0 then
    v_faltan := v_faltan || jsonb_build_object('fuente', 'compras', 'texto',
      case when jsonb_array_length(v_sin_precio) = 1 then '1 línea de albarán sin precio: complétala en el albarán.'
           else format('%s líneas de albarán sin precio: complétalas en el albarán.', jsonb_array_length(v_sin_precio)) end,
      'lineas', v_sin_precio);
  end if;

  -- Aportaciones del socio en ese local.
  select coalesce(sum(amount), 0), count(*) into v_aport, v_aport_n
    from brand_partner_contribution
   where party_id = p_party and location_id = p_location and contributed_on between p_desde and p_hasta;

  -- Ventas de sus marcas en ese local, por marca, con el % de cada acuerdo.
  with m as (
    select a.brand_id, a.revenue_share_pct pct, b.name from brand_licensing_agreement a join brand b on b.id = a.brand_id
     where a.party_id = p_party and a.account_id = v_cuenta
       and (a.starts_on is null or a.starts_on <= p_hasta) and (a.ends_on is null or a.ends_on >= p_desde)
  ), v as (
    select m.brand_id, m.name, m.pct, count(s.id) n,
           count(s.id) filter (where s.taxable_base is null) sin_base,
           coalesce(sum(s.taxable_base), 0) base
      from m left join sale s on s.brand_id = m.brand_id and s.account_id = v_cuenta and s.location_id = p_location
       and s.status = 'closed' and s.cancelled_at is null and s.is_active
       and (s.sold_at at time zone 'Europe/Madrid')::date between p_desde and p_hasta
     group by m.brand_id, m.name, m.pct
  )
  select coalesce(sum(base), 0), coalesce(sum(round(base * pct / 100, 2)), 0), coalesce(sum(n), 0), coalesce(sum(sin_base), 0),
         coalesce(jsonb_agg(jsonb_build_object('brand_id', brand_id, 'marca', name, 'pct', pct, 'ventas', n, 'base', base,
                                               'comision', round(base * pct / 100, 2)) order by name), '[]'::jsonb)
    into v_base, v_comision, v_ventas, v_sin_base, v_marcas
    from v;
  if jsonb_array_length(v_marcas) = 0 then
    v_faltan := v_faltan || jsonb_build_object('fuente', 'ventas', 'texto', 'Ninguna marca tiene acuerdo con este socio en el periodo: falta el % de comisión.');
  elsif v_ventas = 0 then
    v_faltan := v_faltan || jsonb_build_object('fuente', 'ventas', 'texto', 'No hay ninguna venta de sus marcas en este local y periodo: las ventas no han llegado.');
  end if;
  if v_sin_base > 0 then
    v_faltan := v_faltan || jsonb_build_object('fuente', 'ventas', 'texto', case when v_sin_base = 1 then '1 venta de sus marcas sin base imponible.' else format('%s ventas de sus marcas sin base imponible.', v_sin_base) end);
  end if;
  v_pct := case when v_base > 0 then round(v_comision * 100 / v_base, 2)
                else (select max((x->>'pct')::numeric) from jsonb_array_elements(v_marcas) x) end;

  return jsonb_build_object(
    'party_id', p_party, 'location_id', p_location, 'desde', p_desde, 'hasta', p_hasta,
    'compras', round(v_compras, 2), 'albaranes', v_albaranes,
    'aportaciones', round(v_aport, 2), 'aportaciones_n', v_aport_n,
    'base_ventas', round(v_base, 2), 'ventas', v_ventas, 'comision_pct', coalesce(v_pct, 0), 'comision', round(v_comision, 2), 'marcas', v_marcas,
    'importe', round(v_compras - v_aport + v_comision, 2),
    'faltan', v_faltan);
end $$;
revoke all on function public.brand_partner_settlement_compute(uuid, uuid, date, date) from public, anon;
grant execute on function public.brand_partner_settlement_compute(uuid, uuid, date, date) to authenticated;

-- Prepara (o rehace) el borrador de un local y periodo. Una confirmada no se rehace.
create or replace function public.brand_partner_settlement_prepare(p_party uuid, p_location uuid, p_desde date, p_hasta date, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public.party_cuenta(p_party); c jsonb; v_id uuid; v_estado text;
begin
  if not exists (select 1 from locations where id = p_location and account_id = v_cuenta) then
    raise exception 'Ese local no es de esta cuenta.' using errcode = '23514';
  end if;
  select id, status into v_id, v_estado from licensed_settlement
   where party_id = p_party and location_id = p_location and period_from = p_desde and period_to = p_hasta and formula = 'compras_aportaciones_comision';
  if v_estado is not null and v_estado <> 'borrador' then
    raise exception 'La liquidación de ese local y periodo ya está confirmada: no se rehace.' using errcode = '22023';
  end if;
  c := public.brand_partner_settlement_compute(p_party, p_location, p_desde, p_hasta);
  if v_id is null then
    insert into licensed_settlement (account_id, location_id, period_from, period_to, period_grain, formula, party_id, status,
                                     purchases_amount, contributions_amount, brand_sales_base, commission_pct, commission_amount, amount,
                                     detail, source, created_by, created_by_name, updated_at)
    values (v_cuenta, p_location, p_desde, p_hasta, 'month', 'compras_aportaciones_comision', p_party, 'borrador',
            (c->>'compras')::numeric, (c->>'aportaciones')::numeric, (c->>'base_ventas')::numeric, (c->>'comision_pct')::numeric,
            (c->>'comision')::numeric, (c->>'importe')::numeric, c, 'folvy', auth.uid(), p_quien_nombre, now())
    returning id into v_id;
  else
    update licensed_settlement set purchases_amount = (c->>'compras')::numeric, contributions_amount = (c->>'aportaciones')::numeric,
           brand_sales_base = (c->>'base_ventas')::numeric, commission_pct = (c->>'comision_pct')::numeric,
           commission_amount = (c->>'comision')::numeric, amount = (c->>'importe')::numeric, detail = c, updated_at = now()
     where id = v_id;
  end if;
  return c || jsonb_build_object('id', v_id, 'estado', 'borrador');
end $$;
revoke all on function public.brand_partner_settlement_prepare(uuid, uuid, date, date, text) from public, anon;
grant execute on function public.brand_partner_settlement_prepare(uuid, uuid, date, date, text) to authenticated;

-- Confirmar: se recalcula en el momento; si falta una fuente, no se cierra; si
-- el cálculo ya no es el del borrador, tampoco (que lo vuelva a mirar).
create or replace function public.brand_partner_settlement_confirm(p_id uuid, p_importe_visto numeric, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v licensed_settlement; c jsonb;
begin
  select * into v from licensed_settlement where id = p_id and formula = 'compras_aportaciones_comision';
  if not found then raise exception 'Esa liquidación no existe.' using errcode = 'P0002'; end if;
  perform public.party_cuenta(v.party_id);
  if v.status <> 'borrador' then raise exception 'Ya estaba confirmada.' using errcode = '22023'; end if;
  c := public.brand_partner_settlement_compute(v.party_id, v.location_id, v.period_from, v.period_to);
  if jsonb_array_length(c->'faltan') > 0 then
    raise exception 'No se cierra: %', (select string_agg(x->>'texto', ' ') from jsonb_array_elements(c->'faltan') x) using errcode = '22023';
  end if;
  if (c->>'importe')::numeric is distinct from p_importe_visto then
    raise exception 'Ha cambiado algo desde el borrador (ahora sale % €): vuelve a prepararla.', c->>'importe' using errcode = '22023';
  end if;
  update licensed_settlement set status = 'confirmada', detail = c, amount = (c->>'importe')::numeric,
         confirmed_at = now(), confirmed_by = auth.uid(), confirmed_by_name = p_quien_nombre, updated_at = now()
   where id = p_id;
  return c || jsonb_build_object('id', p_id, 'estado', 'confirmada');
end $$;
revoke all on function public.brand_partner_settlement_confirm(uuid, numeric, text) from public, anon;
grant execute on function public.brand_partner_settlement_confirm(uuid, numeric, text) to authenticated;

-- ── Un acuerdo de cesión, a su socio ────────────────────────────────────────
create or replace function public.brand_licensing_agreement_set_party(p_agreement uuid, p_party uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public.party_cuenta(p_party);
begin
  if not exists (select 1 from party_role where party_id = p_party and role = 'brand_partner') then
    raise exception 'Ese tercero no es socio de marca.' using errcode = '22023';
  end if;
  update brand_licensing_agreement set party_id = p_party, updated_at = now() where id = p_agreement and account_id = v_cuenta;
  if not found then raise exception 'Ese acuerdo no es de esta cuenta.' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.brand_licensing_agreement_set_party(uuid, uuid) from public, anon;
grant execute on function public.brand_licensing_agreement_set_party(uuid, uuid) to authenticated;
