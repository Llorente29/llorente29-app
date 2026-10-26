-- supabase/vuelta-atras/20261025T2254_v02l_motor_cambia.down.sql
--
-- Vuelta atrás de 20261025T2254_v02l_motor_cambia. Deja todo como estaba:
--   · conta_liquidacion_registrar y conta_tienda_plataforma_asignar, con sus
--     cuerpos de PRODUCCIÓN del 25/10 (huellas 1815512f… y 0146f39b…);
--   · sin el disparador de supplier_invoice ni su función;
--   · conta_liquidacion_resolucion.channel_id otra vez obligatoria, sin el
--     índice por contacto. PARA si hay alguna diferencia sin canal (las de un
--     intermediario sin canal de venta): no se pierden en silencio.
-- Va antes que la de la 2253 (orden inverso).

do $$ begin
  if exists (select 1 from public.conta_liquidacion_resolucion where channel_id is null) then
    raise exception 'VUELTA ATRÁS 2254: hay diferencias resueltas de intermediarios sin canal; quitarlas antes (no se pierden en silencio).';
  end if;
end $$;

drop trigger if exists v02l_factura_comision_llega on public.supplier_invoice;
drop function if exists public._v02l_factura_comision_llega();
drop index if exists public.conta_liquidacion_resolucion_contacto_uq;
alter table public.conta_liquidacion_resolucion alter column channel_id set not null;

CREATE OR REPLACE FUNCTION public.conta_liquidacion_registrar(p_company uuid, p jsonb, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_acc uuid; v_prov text := coalesce(p->>'proveedor', ''); v_tienda text := btrim(coalesce(p->>'tienda', ''));
  v_desde date := nullif(p->>'desde', '')::date; v_hasta date := nullif(p->>'hasta', '')::date;
  v_s public.platform_store; v_canal uuid; v_clave text; v_ya public.channel_settlement; v_id uuid; v_fac jsonb; v_nueva boolean := false;
  v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), 'Liquidación por correo');
  v_neto numeric := nullif(p->>'neto', '')::numeric; v_texto text; v_solape text;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  -- La llama la función de entrada (sin persona) o, a mano, un administrador o encargado.
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta registra liquidaciones.' using errcode = '42501';
  end if;
  if v_prov <> 'uber' then raise exception 'Solo se leen todavía los resúmenes de Uber Eats.' using errcode = '22023'; end if;
  if v_tienda = '' then raise exception 'El resumen no dice de qué tienda es.' using errcode = '22023'; end if;
  if v_desde is null or v_hasta is null or v_hasta < v_desde then raise exception 'El resumen no dice de qué periodo es.' using errcode = '22023'; end if;
  if v_neto is null then raise exception 'El resumen no trae el pago neto.' using errcode = '22023'; end if;

  -- La tienda: la que ya estaba (por cómo la nombra la plataforma) o una nueva, sin asignar.
  select * into v_s from public.platform_store where account_id = v_acc and company_id = p_company and provider = v_prov and lower(btrim(external_text)) = lower(v_tienda);
  if v_s.id is null then
    select id into v_canal from public.sales_channel where account_id = v_acc and (slug = 'uber' or slug like 'uber%' or name ilike 'uber%') order by (slug = 'uber') desc, created_at limit 1;
    insert into public.platform_store (account_id, company_id, provider, external_text, channel_id, created_by_name)
    values (v_acc, p_company, v_prov, v_tienda, v_canal, v_quien) returning * into v_s;
    v_nueva := true;
  else
    update public.platform_store set last_seen_at = now() where id = v_s.id;
  end if;

  -- La misma semana de la misma tienda dos veces: nada nuevo, y se dice.
  v_clave := v_prov || '-correo:' || v_s.id::text || ':' || v_desde::text || ':' || v_hasta::text;
  select * into v_ya from public.channel_settlement where account_id = v_acc and import_key = v_clave;
  if v_ya.id is not null then
    return jsonb_build_object('liquidacion_id', v_ya.id, 'ya_estaba', true, 'tienda_id', v_s.id, 'tienda_nueva', false,
      'texto', 'Esta liquidación ya estaba (del ' || to_char(v_desde, 'DD/MM') || ' al ' || to_char(v_hasta, 'DD/MM/YYYY') || '): no se ha creado nada.');
  end if;

  insert into public.channel_settlement (
    account_id, channel_id, brand_id, location_id, external_brand_text, external_location_text, settlement_ref, period_from, period_to,
    settlement_date, period_grain, orders_count, gross_sales, base_amount, vat_amount,
    commission, other_cost, other_earnings, promo_charges, ads_spend, item_promotions, chargebacks, adjustments,
    net_payout, source, import_key, raw, needs_review, review_note, store_id, inbound_email_id, created_by_name)
  values (
    v_acc, v_s.channel_id, v_s.brand_id, v_s.location_id, nullif(p->>'marca', ''), v_tienda, nullif(p->>'referencia', ''), v_desde, v_hasta,
    coalesce(nullif(p->>'deposito_iniciado', '')::date, v_hasta + 1), case when v_hasta - v_desde = 6 then 'week' else 'weeks' end,
    nullif(p->>'pedidos', '')::int, (p->'ventas'->>'total')::numeric, (p->'ventas'->>'base')::numeric, (p->'ventas'->>'iva')::numeric,
    coalesce((p->'uber'->>'tasas')::numeric, 0), coalesce((p->'uber'->>'otros')::numeric, 0), (p->'ganancias'->>'otras')::numeric,
    (p->'marketing'->>'otrosPromo')::numeric, (p->'marketing'->>'anuncios')::numeric, (p->'marketing'->>'promociones')::numeric,
    (p->'modificaciones'->>'contracargo')::numeric, (p->'modificaciones'->>'ajustes')::numeric,
    v_neto, 'correo_' || v_prov, v_clave, p, true, null, v_s.id, nullif(p->>'email_id', ''), v_quien)
  returning id into v_id;
  -- Por aclarar (tienda, cuadre, solape): esta, y cada una con la que se solapa, que ahora lo dice también.
  v_solape := public._conta_liquidacion_solape(v_id);
  perform public._conta_liquidacion_marcar(v_id);
  perform public._conta_liquidacion_marcar(o.id) from public.channel_settlement o, public.channel_settlement c
    where c.id = v_id and o.account_id = c.account_id and o.store_id = c.store_id and o.id <> c.id
      and daterange(o.period_from, o.period_to, '[]') && daterange(c.period_from, c.period_to, '[]');

  v_fac := public.conta_liquidacion_factura_proponer(v_id, v_quien);
  v_texto := 'Liquidación del ' || to_char(v_desde, 'DD/MM') || ' al ' || to_char(v_hasta, 'DD/MM/YYYY') || ' leída: neto ' ||
             public.conta_euros_exactos(v_neto) || case when v_neto <= 0 then ' (sin cobro: pasa al siguiente)' else '' end || '. ' ||
             (v_fac->>'texto') || case when v_nueva then ' Tienda nueva: dale su marca y su local.' else '' end ||
             case when v_solape is not null then ' Por aclarar: ' || v_solape || ' (cada día cuenta una sola vez).' else '' end;
  return jsonb_build_object('liquidacion_id', v_id, 'ya_estaba', false, 'tienda_id', v_s.id, 'tienda_nueva', v_nueva,
                            'factura', v_fac, 'texto', v_texto);
end $function$;
revoke all on function public.conta_liquidacion_registrar(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_liquidacion_registrar(uuid, jsonb, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.conta_tienda_plataforma_asignar(p_store uuid, p_marca uuid, p_local uuid, p_banco uuid DEFAULT NULL::uuid, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s public.platform_store;
begin
  select * into v_s from public.platform_store where id = p_store for update;
  if v_s.id is null or not public.belongs_to_account(v_s.account_id) then raise exception 'Esa tienda no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_s.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta asigna las tiendas.' using errcode = '42501';
  end if;
  if p_marca is not null and not exists (select 1 from public.brand where id = p_marca and account_id = v_s.account_id) then raise exception 'Esa marca no es de esta cuenta.' using errcode = '22023'; end if;
  if p_local is not null and not exists (select 1 from public.locations where id = p_local and account_id = v_s.account_id) then raise exception 'Ese local no es de esta cuenta.' using errcode = '22023'; end if;
  if p_banco is not null and not exists (select 1 from public.treasury_account where id = p_banco and account_id = v_s.account_id and company_id = v_s.company_id) then
    raise exception 'Esa cuenta del banco no es de esta empresa.' using errcode = '22023';
  end if;
  update public.platform_store set brand_id = p_marca, location_id = p_local, treasury_account_id = p_banco,
         updated_at = now(), updated_by = auth.uid(), updated_by_name = coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor())
   where id = p_store returning * into v_s;
  -- Sus liquidaciones aún sin marca ni local las toman ahora (las que ya tenían, no se tocan),
  -- y cada una vuelve a decir si queda por aclarar: asignar la tienda no arregla un solape
  -- ni lo que no cuadró al leer.
  update public.channel_settlement set brand_id = coalesce(brand_id, p_marca), location_id = coalesce(location_id, p_local), updated_at = now()
   where store_id = p_store and (brand_id is null or location_id is null);
  perform public._conta_liquidacion_marcar(x.id) from public.channel_settlement x where x.store_id = p_store;
  return to_jsonb(v_s);
end $function$;
revoke all on function public.conta_tienda_plataforma_asignar(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.conta_tienda_plataforma_asignar(uuid, uuid, uuid, uuid, text) to authenticated;
