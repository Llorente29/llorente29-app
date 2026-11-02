-- supabase/migrations/20261101T1216_s01j2_ficha_liquidacion.sql
--
-- S01j·2 · La ficha de UNA liquidación de plataforma (maqueta 3, aprobada por
-- Julio el 01/11): de qué plataforma, marca, local y tienda es, su periodo
-- (o «sin periodo: vino de un fichero antiguo»), sus cifras (pedidos, ventas,
-- comisión, otros y lo que te ingresa), su factura de comisión, su cobro y el
-- correo del que salió, si salió de uno. Solo lee.
--
-- Solo añade: una función nueva. Ninguna fila cambia al aplicarla.
-- Vuelta atrás: supabase/vuelta-atras/20261101T1216_s01j2_ficha_liquidacion.down.sql

create or replace function public.conta_liquidacion_ficha(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare cs public.channel_settlement; v_fac jsonb; v_correo jsonb; v_tienda text; v_local uuid; v_local_nombre text; v_marca text; v_canal text;
begin
  select * into cs from public.channel_settlement where id = p_id;
  if cs.id is null or not public.belongs_to_account(cs.account_id) then
    raise exception 'Esa liquidación no está en tu cuenta.' using errcode = '42501';
  end if;
  select sc.name into v_canal from public.sales_channel sc where sc.id = cs.channel_id and sc.account_id = cs.account_id;
  select regexp_replace(coalesce(ps.external_text, cs.external_location_text, ''), '\s*\(.*$', ''), coalesce(cs.location_id, ps.location_id)
    into v_tienda, v_local
    from (select 1) x left join public.platform_store ps on ps.id = cs.store_id and ps.account_id = cs.account_id;
  select lo.name into v_local_nombre from public.locations lo where lo.id = v_local and lo.account_id = cs.account_id;
  select b.name into v_marca from public.brand b where b.id = cs.brand_id and b.account_id = cs.account_id;

  -- Su factura de comisión: la ligada (S01i), o la que apunta la propia liquidación.
  select jsonb_build_object('id', si.id, 'codigo', si.code, 'numero', si.invoice_number, 'fecha', si.invoice_date,
           'base', si.tax_base_total, 'iva', si.tax_total, 'total', si.grand_total, 'estado', si.status, 'en_revision', si.needs_review)
    into v_fac
    from public.supplier_invoice si
   where si.account_id = cs.account_id
     and si.id = coalesce((select k.supplier_invoice_id from public.channel_settlement_invoice k
                            where k.settlement_id = cs.id and k.account_id = cs.account_id order by k.created_at limit 1), cs.commission_invoice_id);

  -- El correo del que salió: el suyo, o el primero que lo nombra.
  select jsonb_build_object('email_id', l.email_id, 'fecha', l.received_at, 'de', l.from_address, 'asunto', l.subject, 'a', l.to_address,
           'adjuntos', coalesce(l.detail->'dejados', '[]'::jsonb), 'company_id', l.company_id)
    into v_correo
    from public.inbound_email_log l
   where l.account_id = cs.account_id
     and (l.email_id = cs.inbound_email_id
          or (cs.inbound_email_id is null and jsonb_typeof(l.detail->'liquidaciones') = 'array'
              and exists (select 1 from jsonb_array_elements(l.detail->'liquidaciones') x where x->>'id' = cs.id::text)))
   order by (l.email_id = cs.inbound_email_id) desc, l.received_at limit 1;

  return jsonb_build_object(
    'id', cs.id, 'plataforma', v_canal, 'canal_id', cs.channel_id, 'marca', coalesce(v_marca, nullif(cs.external_brand_text, '')), 'local', v_local_nombre, 'local_id', v_local,
    'tienda', nullif(v_tienda, ''), 'referencia', cs.settlement_ref,
    'desde', cs.period_from, 'hasta', cs.period_to, 'sin_periodo', cs.period_from is null,
    'origen', cs.source,
    'pedidos', cs.orders_count, 'ventas', cs.gross_sales, 'comision', cs.commission,
    'otros', coalesce(cs.delivery_transport, 0) + coalesce(cs.min_order_fee, 0) + coalesce(cs.other_cost, 0) + coalesce(cs.promo_product, 0)
             + coalesce(cs.promo_flash, 0) + coalesce(cs.incidents_cost, 0) + coalesce(cs.incidents_refund, 0) + coalesce(cs.access_fee, 0)
             + coalesce(cs.prime_fee, 0) + coalesce(cs.recurring_fee, 0) + coalesce(cs.other_earnings, 0) + coalesce(cs.adjustments, 0),
    'neto', cs.net_payout, 'pago_el', cs.settlement_date,
    'cobrado_el', cs.collected_on, 'cobrado', cs.collected_amount,
    'factura', v_fac, 'correo', v_correo,
    'revisar', case when cs.needs_review then coalesce(cs.review_note, 'Hay algo que mirar.') end);
end $$;
revoke all on function public.conta_liquidacion_ficha(uuid) from public, anon;
grant execute on function public.conta_liquidacion_ficha(uuid) to authenticated;
