-- supabase/migrations/20261025T2254_v02l_motor_cambia.sql
--
-- V02 · Entrega 2 · Lo que CAMBIA en caliente para el motor de liquidaciones,
-- todo con la misma firma (create or replace, sin sobrecargas: regla 2) y sin
-- tocar ninguna fila. Va después de la 2253, que crea lo que usa.
--
--   1. conta_liquidacion_resolucion.channel_id admite vacío: la diferencia de un
--      intermediario sin canal de venta (Stripe, Amazon…) se guarda por su
--      contacto (party_id, 2253). Hoy la tabla tiene 0 filas.
--   2. conta_liquidacion_registrar lee cualquier plataforma, no solo Uber: el
--      correo semanal de Uber (como hasta hoy, sin cambiar lo que guarda), el
--      informe «Detalles del pago» de Uber, la liquidación de Glovo y la de Just
--      Eat. Y:
--        · la tienda, por su ID si el documento lo trae (conta_tienda_reconocer);
--        · su marca y su local, los de su tramo el primer día del periodo;
--        · quien te paga, de alta sola con su primera liquidación
--          (conta_intermediario_asegurar);
--        · la misma tienda y el mismo periodo por otro camino (el correo y el
--          informe de la misma semana) no se duplica: se dice si cuadra;
--        · si el local está cerrado, se avisa (no impide que entre);
--        · la factura de comisión que dice su número se engancha sola.
--   3. conta_tienda_plataforma_asignar: dar marca o local a una tienda que no
--      los tenía vale desde siempre (como hoy); CAMBIAR los que tenía abre un
--      tramo nuevo desde hoy y lo de antes no se mueve (sus liquidaciones se
--      quedan con la marca y el local de entonces).
--   4. supplier_invoice: un disparador nuevo que, al llegar o cambiar una
--      factura recibida, engancha las liquidaciones que la esperan por su
--      número (_conta_liquidacion_factura_enganchar, 2253). Nunca impide guardar
--      la factura: si falla, se sigue.
--
-- Cuerpos de partida, los de PRODUCCIÓN (md5 del cuerpo, 25/10 21:55 UTC):
--   conta_liquidacion_registrar 1815512f8c0e408a2cf71a4811464ea3 ·
--   conta_tienda_plataforma_asignar 0146f39b86d5cc1b7e58b82dbb86cba1
--
-- Nada de esto está en el camino del pedido: no escribe en sale ni lo lee al
-- cerrar una venta.
--
-- cambia: public.conta_liquidacion_resolucion · prueba: supabase/staging/sql/20261025_v02l_motor_prueba.sql
-- cambia: public.conta_liquidacion_registrar · prueba: supabase/staging/sql/20261025_v02l_motor_prueba.sql
-- cambia: public.conta_tienda_plataforma_asignar · prueba: supabase/staging/sql/20261025_v02l_motor_prueba.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261025_v02l_motor_prueba.sql
--
-- Vuelta atrás: supabase/vuelta-atras/20261025T2254_v02l_motor_cambia.down.sql

-- 1 · La diferencia de un intermediario sin canal ----------------------------------------------
alter table public.conta_liquidacion_resolucion alter column channel_id drop not null;
create unique index if not exists conta_liquidacion_resolucion_contacto_uq on public.conta_liquidacion_resolucion
  (company_id, party_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), period_from, period_to,
   coalesce(sale_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where channel_id is null;

-- 2 · Registrar una liquidación leída, de cualquier plataforma ------------------------------
-- p (lo que da el lector):
--   proveedor (uber · glovo · justeat · …), origen (correo · informe · excel · pdf · csv),
--   tienda (como la nombra), tienda_id (su ID en la plataforma, si lo trae), marca,
--   desde, hasta, referencia, pedidos, ventas {total, base, iva}, neto,
--   comision (lo que se queda, en positivo), otros (lo demás, con su signo sobre el pago),
--   factura {numero, base, iva, total}, pago_el, intermediario {nombre, nif}.
--   El correo de Uber trae además uber {tasas, otros}, ganancias, marketing y
--   modificaciones (lo de siempre, que se guarda igual que hasta hoy).
create or replace function public.conta_liquidacion_registrar(p_company uuid, p jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_prov text := lower(btrim(coalesce(p->>'proveedor', ''))); v_origen text := lower(btrim(coalesce(p->>'origen', 'correo')));
  v_tienda text := nullif(btrim(coalesce(p->>'tienda', '')), ''); v_tid text := nullif(btrim(coalesce(p->>'tienda_id', '')), '');
  v_desde date := nullif(p->>'desde', '')::date; v_hasta date := nullif(p->>'hasta', '')::date;
  v_s public.platform_store; v_canal uuid; v_clave text; v_ya public.channel_settlement; v_id uuid; v_fac jsonb; v_nueva boolean := false;
  v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), 'Liquidación por correo');
  v_neto numeric := nullif(p->>'neto', '')::numeric; v_texto text; v_solape text; v_rec jsonb; v_rol uuid; v_party uuid;
  v_marca uuid; v_local uuid; v_local_abierto boolean; v_local_nombre text; v_uber boolean; v_inv uuid; v_aviso text; v_nombre_plat text;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  -- La llama la función de entrada (sin persona) o, a mano, un administrador o encargado.
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta registra liquidaciones.' using errcode = '42501';
  end if;
  if v_prov = '' then raise exception 'La liquidación no dice de qué plataforma es.' using errcode = '22023'; end if;
  if v_tienda is null and v_tid is null then raise exception 'El resumen no dice de qué tienda es.' using errcode = '22023'; end if;
  if v_desde is null or v_hasta is null or v_hasta < v_desde then raise exception 'El resumen no dice de qué periodo es.' using errcode = '22023'; end if;
  if v_neto is null then raise exception 'El resumen no trae el pago neto.' using errcode = '22023'; end if;
  v_uber := v_prov = 'uber' and v_origen = 'correo';
  v_nombre_plat := case v_prov when 'uber' then 'Uber' when 'glovo' then 'Glovo' when 'justeat' then 'Just Eat' else initcap(v_prov) end;

  -- El canal de venta de la plataforma (el de sus tiendas, o por su nombre).
  select channel_id into v_canal from public.platform_store where account_id = v_acc and company_id = p_company and provider = v_prov and channel_id is not null limit 1;
  if v_canal is null then
    select id into v_canal from public.sales_channel
     where account_id = v_acc and (slug = v_prov or slug like v_prov || '%' or replace(lower(name), ' ', '') like replace(v_prov, ' ', '') || '%')
     order by (slug = v_prov) desc, created_at limit 1;
  end if;
  -- La tienda: por su ID, o por un nombre ya visto; nueva si no.
  v_rec := public.conta_tienda_reconocer(p_company, v_prov, v_tid, v_tienda, v_canal, v_quien);
  select * into v_s from public.platform_store where id = (v_rec->>'tienda_id')::uuid;
  v_nueva := (v_rec->>'nueva')::boolean;
  -- Quien te paga, de alta sola con su primera liquidación.
  v_rol := public.conta_intermediario_asegurar(p_company, v_prov, coalesce(v_s.channel_id, v_canal), p->'intermediario'->>'nombre', p->'intermediario'->>'nif', v_quien);
  select party_id into v_party from public.party_role where id = v_rol;
  -- Su marca y su local: los de su tramo el primer día del periodo.
  select t.brand_id, t.location_id into v_marca, v_local from public.conta_tienda_en(v_s.id, v_desde) t;
  select active, name into v_local_abierto, v_local_nombre from public.locations where id = v_local;

  -- La misma tienda y el mismo periodo, por este camino o por otro: nada nuevo, y se dice.
  v_clave := case when v_uber then 'uber-correo:' else v_prov || '-' || v_origen || ':' end || v_s.id::text || ':' || v_desde::text || ':' || v_hasta::text;
  select * into v_ya from public.channel_settlement where account_id = v_acc and import_key = v_clave;
  if v_ya.id is null then
    select * into v_ya from public.channel_settlement where account_id = v_acc and store_id = v_s.id and period_from = v_desde and period_to = v_hasta
     order by created_at limit 1;
  end if;
  if v_ya.id is not null then
    return jsonb_build_object('liquidacion_id', v_ya.id, 'ya_estaba', true, 'tienda_id', v_s.id, 'tienda_nueva', false,
      'aprendido_id', (v_rec->>'aprendido_id')::boolean, 'cambio', v_rec->'cambio',
      'texto', 'Esta liquidación ya estaba (del ' || to_char(v_desde, 'DD/MM') || ' al ' || to_char(v_hasta, 'DD/MM/YYYY') || '): no se ha creado nada' ||
               case when v_ya.net_payout is null or abs(v_ya.net_payout - v_neto) < 0.005 then '.'
                    else ', pero esta dice que paga ' || public.conta_euros_exactos(v_neto) || ' y la que estaba ' || public.conta_euros_exactos(v_ya.net_payout) || ': revísala.' end ||
               case when (v_rec->>'aprendido_id')::boolean then ' Aprendido el ID de su tienda.' else '' end);
  end if;

  insert into public.channel_settlement (
    account_id, channel_id, party_id, brand_id, location_id, external_brand_text, external_location_text, settlement_ref, period_from, period_to,
    settlement_date, period_grain, orders_count, gross_sales, base_amount, vat_amount,
    commission, other_cost, other_earnings, promo_charges, ads_spend, item_promotions, chargebacks, adjustments,
    net_payout, source, import_key, raw, needs_review, review_note, store_id, inbound_email_id, created_by_name)
  values (
    v_acc, coalesce(v_s.channel_id, v_canal), v_party, v_marca, v_local, nullif(p->>'marca', ''), coalesce(v_tienda, v_s.external_text), nullif(p->>'referencia', ''), v_desde, v_hasta,
    coalesce(nullif(p->>'deposito_iniciado', '')::date, nullif(p->>'pago_el', '')::date, v_hasta + 1),
    case when v_hasta - v_desde = 6 then 'week' when v_hasta - v_desde between 13 and 15 then 'quincena' when v_hasta - v_desde between 27 and 30 then 'mes'
         when v_uber then 'weeks' else 'periodo' end,
    nullif(p->>'pedidos', '')::int, (p->'ventas'->>'total')::numeric, (p->'ventas'->>'base')::numeric, (p->'ventas'->>'iva')::numeric,
    coalesce((p->'uber'->>'tasas')::numeric, -abs(nullif(p->>'comision', '')::numeric), 0), coalesce((p->'uber'->>'otros')::numeric, nullif(p->>'otros', '')::numeric, 0),
    (p->'ganancias'->>'otras')::numeric,
    (p->'marketing'->>'otrosPromo')::numeric, (p->'marketing'->>'anuncios')::numeric, (p->'marketing'->>'promociones')::numeric,
    (p->'modificaciones'->>'contracargo')::numeric, (p->'modificaciones'->>'ajustes')::numeric,
    v_neto, case when v_uber then 'correo_uber' else v_origen || '_' || v_prov end, v_clave, p, true, null, v_s.id, nullif(p->>'email_id', ''), v_quien)
  returning id into v_id;
  -- Por aclarar (tienda, cuadre, solape): esta, y cada una con la que se solapa, que ahora lo dice también.
  v_solape := public._conta_liquidacion_solape(v_id);
  perform public._conta_liquidacion_marcar(v_id);
  perform public._conta_liquidacion_marcar(o.id) from public.channel_settlement o, public.channel_settlement c
    where c.id = v_id and o.account_id = c.account_id and o.store_id = c.store_id and o.id <> c.id
      and daterange(o.period_from, o.period_to, '[]') && daterange(c.period_from, c.period_to, '[]');

  v_fac := public.conta_liquidacion_factura_proponer(v_id, v_quien);
  v_inv := public._conta_liquidacion_factura_enganchar(v_id);
  -- Un local cerrado no recibe ventas: si llega una liquidación suya, se avisa (nunca impide que entre).
  if v_local is not null and v_local_abierto is false then
    v_aviso := 'Llegan ventas de ' || v_local_nombre || ', que está cerrado: revisa de qué local es la tienda.';
    begin
      perform public.encolar_alerta(
        p_kind            => 'liquidacion_local_cerrado',
        p_subject         => 'Llega una liquidación de un local cerrado',
        p_message         => format('%s Tienda «%s», del %s al %s.', v_aviso, coalesce(v_tienda, v_s.external_text), to_char(v_desde, 'DD/MM'), to_char(v_hasta, 'DD/MM/YYYY')),
        p_debounce_kind   => 'liquidacion_local_cerrado:' || v_s.id::text,
        p_debounce_window => interval '7 days',
        p_account_id      => v_acc,
        p_location_id     => v_local,
        p_brand_id        => v_marca,
        p_severity        => 'aviso');
    exception when others then
      raise notice 'liquidacion_local_cerrado: no se pudo encolar el aviso (%)', sqlerrm;
    end;
  end if;
  v_texto := 'Liquidación de ' || v_nombre_plat || ' del ' || to_char(v_desde, 'DD/MM') || ' al ' || to_char(v_hasta, 'DD/MM/YYYY') || ' leída: neto ' ||
             public.conta_euros_exactos(v_neto) || case when v_neto <= 0 then ' (sin cobro: pasa al siguiente)' else '' end || '. ' ||
             case when v_inv is not null then 'Su factura de comisión ya estaba: enganchada.'
                  when v_uber or v_fac->>'estado' in ('referencia', 'sin_factura', 'ya_estaba') then coalesce(v_fac->>'texto', '')
                  when nullif(p->'factura'->>'numero', '') is not null then 'Su factura de comisión (' || (p->'factura'->>'numero') || ') se engancha sola cuando entre en Compras.'
                  else coalesce(v_fac->>'texto', '') end ||
             case when v_nueva then ' Tienda nueva: dale su marca y su local.' else '' end ||
             case when (v_rec->>'aprendido_id')::boolean then ' Aprendido el ID de su tienda.' else '' end ||
             case when v_rec->>'cambio' is not null then ' La tienda llega con otro nombre o en otra dirección: confírmalo.' else '' end ||
             case when v_aviso is not null then ' ' || v_aviso else '' end ||
             case when v_solape is not null then ' Por aclarar: ' || v_solape || ' (cada día cuenta una sola vez).' else '' end;
  return jsonb_build_object('liquidacion_id', v_id, 'ya_estaba', false, 'tienda_id', v_s.id, 'tienda_nueva', v_nueva,
                            'aprendido_id', (v_rec->>'aprendido_id')::boolean, 'cambio', v_rec->'cambio', 'intermediario_id', v_rol,
                            'factura', v_fac, 'factura_id', v_inv, 'texto', v_texto);
end $$;
revoke all on function public.conta_liquidacion_registrar(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_liquidacion_registrar(uuid, jsonb, text) to authenticated, service_role;

-- 3 · Dar o cambiar la marca y el local de una tienda, con fecha -------------------------------
create or replace function public.conta_tienda_plataforma_asignar(p_store uuid, p_marca uuid, p_local uuid, p_banco uuid default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s public.platform_store; v_antes public.platform_store; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor()); v_t record;
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
  v_antes := v_s;
  -- V02 · E2: cambiar la marca o el local que YA tenía es un cambio con fecha: lo
  -- de antes se queda con los de antes (sus liquidaciones sin marca o local los
  -- toman de su tramo) y el tramo nuevo empieza hoy. Darlos a una tienda que no
  -- los tenía vale desde siempre, como hasta ahora.
  if (v_antes.brand_id is not null and p_marca is distinct from v_antes.brand_id)
     or (v_antes.location_id is not null and p_local is distinct from v_antes.location_id) then
    for v_t in select cs.id, (public.conta_tienda_en(v_s.id, coalesce(cs.period_from, cs.settlement_date))).* from public.channel_settlement cs
                where cs.store_id = v_s.id and cs.account_id = v_s.account_id and coalesce(cs.period_from, cs.settlement_date) < public.conta_hoy()
                  and (cs.brand_id is null or cs.location_id is null) loop
      update public.channel_settlement set brand_id = coalesce(brand_id, v_t.brand_id), location_id = coalesce(location_id, v_t.location_id), updated_at = now() where id = v_t.id;
    end loop;
    update public.platform_store_tramo set valid_to = public.conta_hoy() - 1
     where store_id = v_s.id and valid_to is null and (valid_from is null or valid_from < public.conta_hoy());
    delete from public.platform_store_tramo where store_id = v_s.id and valid_from >= public.conta_hoy();
    insert into public.platform_store_tramo (account_id, store_id, brand_id, location_id, valid_from, motivo, created_by_name)
    values (v_s.account_id, v_s.id, p_marca, p_local, public.conta_hoy(), 'Cambiada a mano en Sus tiendas.', v_quien);
  else
    update public.platform_store_tramo set brand_id = coalesce(p_marca, brand_id), location_id = coalesce(p_local, location_id)
     where store_id = v_s.id and valid_to is null;
    if not found then
      insert into public.platform_store_tramo (account_id, store_id, brand_id, location_id, valid_from, motivo, created_by_name)
      values (v_s.account_id, v_s.id, p_marca, p_local, null, 'Asignada en Sus tiendas: desde siempre.', v_quien);
    end if;
  end if;
  update public.platform_store set brand_id = p_marca, location_id = p_local, treasury_account_id = p_banco,
         updated_at = now(), updated_by = auth.uid(), updated_by_name = v_quien
   where id = p_store returning * into v_s;
  -- Sus liquidaciones aún sin marca ni local las toman ahora (las que ya tenían, no se tocan),
  -- y cada una vuelve a decir si queda por aclarar: asignar la tienda no arregla un solape
  -- ni lo que no cuadró al leer.
  update public.channel_settlement set brand_id = coalesce(brand_id, p_marca), location_id = coalesce(location_id, p_local), updated_at = now()
   where store_id = p_store and (brand_id is null or location_id is null);
  perform public._conta_liquidacion_marcar(x.id) from public.channel_settlement x where x.store_id = p_store;
  return to_jsonb(v_s);
end $$;
revoke all on function public.conta_tienda_plataforma_asignar(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.conta_tienda_plataforma_asignar(uuid, uuid, uuid, uuid, text) to authenticated;

-- 4 · La factura de comisión que llega a Compras se engancha sola a su liquidación ---------------
create or replace function public._v02l_factura_comision_llega()
returns trigger language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if nullif(btrim(coalesce(new.invoice_number, '')), '') is null or new.status in ('anulada', 'descartada') then return null; end if;
  if tg_op = 'UPDATE' and new.invoice_number is not distinct from old.invoice_number and new.supplier_id is not distinct from old.supplier_id
     and new.status is not distinct from old.status and new.issuer_tax_id is not distinct from old.issuer_tax_id then return null; end if;
  begin
    for v in select cs.id from public.channel_settlement cs
              where cs.account_id = new.account_id and cs.commission_invoice_id is null
                and upper(regexp_replace(coalesce(cs.raw->'factura'->>'numero', ''), '\s', '', 'g')) = upper(regexp_replace(new.invoice_number, '\s', '', 'g')) loop
      perform public._conta_liquidacion_factura_enganchar(v);
    end loop;
  exception when others then
    -- Nunca impide guardar la factura: la liquidación sigue diciendo «Falta su factura».
    null;
  end;
  return null;
end $$;
revoke all on function public._v02l_factura_comision_llega() from public, anon, authenticated;
drop trigger if exists v02l_factura_comision_llega on public.supplier_invoice;
create trigger v02l_factura_comision_llega after insert or update of invoice_number, supplier_id, status, issuer_tax_id on public.supplier_invoice
  for each row execute function public._v02l_factura_comision_llega();
