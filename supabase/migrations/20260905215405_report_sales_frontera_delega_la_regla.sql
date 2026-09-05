-- La frontera DELEGA la regla de ventanas en vez de llevar su propia copia.
--
-- Al sacarla a `_report_ventanas_validas` para poder probarla, quedaron DOS
-- implementaciones de la misma regla: la de dentro y la de fuera. Eso es
-- exactamente la enfermedad de B73 y B75 —dos formas de calcular lo mismo que
-- pueden divergir— y no se deja abierta ni una noche. Una regla, un sitio.
--
-- Misma firma y mismo tipo de retorno, asi que REPLACE no crea sobrecarga
-- (regla 2 solo obliga a DROP + CREATE cuando cambia la firma).
create or replace function public.report_sales(
  p_account        uuid,
  p_from           timestamptz,
  p_to             timestamptz,
  p_prev_from      timestamptz,
  p_prev_to        timestamptz,
  p_ejes           text[]   default array['local'],
  p_location_ids   uuid[]   default null,
  p_brand_ids      uuid[]   default null,
  p_ownership      text     default null,
  p_channel_ids    uuid[]   default null,
  p_service_types  text[]   default null,
  p_calendario     boolean  default false
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $fn$
declare
  v_tz     text;
  v_dur    interval;
  v_dur_p  interval;
  v_filas  jsonb;
  v_esp    jsonb;
  v_dias   jsonb;
  v_tot    record;
begin
  if not (p_account = any(current_user_account_ids())) then
    raise exception 'report_sales: sin acceso a la cuenta %', p_account;
  end if;

  -- Una regla, un sitio. Lanza excepcion si las ventanas no son comparables.
  perform _report_ventanas_validas(p_from, p_to, p_prev_from, p_prev_to, p_calendario);

  select coalesce(a.timezone, 'Europe/Madrid') into v_tz from accounts a where a.id = p_account;
  v_dur   := p_to - p_from;
  v_dur_p := p_prev_to - p_prev_from;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.neto desc), '[]'::jsonb) into v_filas
  from _report_sales_rows(p_account, p_from, p_to, p_ejes,
                          p_location_ids, p_brand_ids, p_ownership, p_channel_ids, p_service_types) r;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.neto desc), '[]'::jsonb) into v_esp
  from _report_sales_rows(p_account, p_prev_from, p_prev_to, p_ejes,
                          p_location_ids, p_brand_ids, p_ownership, p_channel_ids, p_service_types) r;

  -- El desglose diario va SIEMPRE, en las dos ventanas y con los mismos ejes.
  -- Un «−22 %» de semana no se puede accionar; «lunes, martes y miércoles» sí.
  select jsonb_build_object(
    'actual', coalesce((select jsonb_agg(to_jsonb(r) order by r.dims->>'dia')
                        from _report_sales_rows(p_account, p_from, p_to, p_ejes || array['dia'],
                              p_location_ids, p_brand_ids, p_ownership, p_channel_ids, p_service_types) r),
                       '[]'::jsonb),
    'espejo', coalesce((select jsonb_agg(to_jsonb(r) order by r.dims->>'dia')
                        from _report_sales_rows(p_account, p_prev_from, p_prev_to, p_ejes || array['dia'],
                              p_location_ids, p_brand_ids, p_ownership, p_channel_ids, p_service_types) r),
                       '[]'::jsonb)
  ) into v_dias;

  -- Totales de la ventana actual, sin ejes: es el denominador de la cobertura.
  select * into v_tot from _report_sales_rows(p_account, p_from, p_to, array[]::text[],
                        p_location_ids, p_brand_ids, p_ownership, p_channel_ids, p_service_types);

  return jsonb_build_object(
    'meta', jsonb_build_object(
      'zona', v_tz,
      'ventana_actual', jsonb_build_object(
        'desde', to_char(p_from      at time zone v_tz, 'YYYY-MM-DD HH24:MI'),
        'hasta', to_char(p_to        at time zone v_tz, 'YYYY-MM-DD HH24:MI'),
        'horas', round(extract(epoch from v_dur)/3600.0, 2)),
      'ventana_espejo', jsonb_build_object(
        'desde', to_char(p_prev_from at time zone v_tz, 'YYYY-MM-DD HH24:MI'),
        'hasta', to_char(p_prev_to   at time zone v_tz, 'YYYY-MM-DD HH24:MI'),
        'horas', round(extract(epoch from v_dur_p)/3600.0, 2)),
      'ejes', to_jsonb(p_ejes),
      'filtros', jsonb_strip_nulls(jsonb_build_object(
        'locales', to_jsonb(p_location_ids), 'marcas', to_jsonb(p_brand_ids),
        'propiedad', p_ownership, 'canales', to_jsonb(p_channel_ids),
        'servicios', to_jsonb(p_service_types))),
      'regla',
        'account_id = la cuenta · is_active · status <> cancelled · cortes en ' || v_tz ||
        ' · Neto = sale.total · Bruto = neto + descuentos · Devoluciones no se pintan: refund_amount es 0,00 en el 100 % de las ventas',
      -- LA COBERTURA VA EN DOS NIVELES Y CON LOS DOS DENOMINADORES.
      -- Uno solo miente por omision: 85,1 % es del DINERO y 83,3 % de los
      -- PEDIDOS, y no son la misma pregunta (regla 31).
      -- Y el nivel B existe porque el A no ve su propio hueco: que la linea
      -- padre tenga coste no prueba que el coste este completo.
      'cobertura_coste', jsonb_build_object(
        'pedidos', v_tot.pedidos,
        'neto',    v_tot.neto,
        'con_coste', jsonb_build_object(
          'pedidos', v_tot.pedidos_costeados,
          'neto',    v_tot.neto_costeado,
          'pct_pedidos', case when coalesce(v_tot.pedidos,0) <> 0
                              then round(100.0 * v_tot.pedidos_costeados / v_tot.pedidos, 1) end,
          'pct_importe', case when coalesce(v_tot.neto,0) <> 0
                              then round(100 * v_tot.neto_costeado / v_tot.neto, 1) end,
          'regla', 'Un pedido cuenta como costeado si TODAS sus lineas product no ignoradas tienen coste. Las combo_item y modifier no entran: su computed_cost es NULL siempre y por diseno, el motor cuelga el coste de la linea padre.'),
        'sin_hueco_de_modificador', jsonb_build_object(
          'pedidos', v_tot.pedidos_sin_hueco,
          'neto',    v_tot.neto_sin_hueco,
          'pct_pedidos', case when coalesce(v_tot.pedidos,0) <> 0
                              then round(100.0 * v_tot.pedidos_sin_hueco / v_tot.pedidos, 1) end,
          'pct_importe', case when coalesce(v_tot.neto,0) <> 0
                              then round(100 * v_tot.neto_sin_hueco / v_tot.neto, 1) end,
          'pedidos_con_modificador_cobrado_sin_impacto', v_tot.pedidos_mod_sin_impacto,
          'regla', 'Ademas de lo anterior, el pedido no lleva ningun modificador COBRADO sin impacto confirmado. Ese modificador mete su comida en el precio y no en el coste: el pedido cuenta como costeado y el margen sale mejor de lo que es. OJO al restar: de esos pedidos, solo los que estaban dentro del nivel anterior lo reducen.'),
        'sesgo_no_medido', 'El envase (packaging_cost) NO entra en el coste congelado (B73): el margen sale sistematicamente mejor de lo que es en una cantidad que todavia nadie ha medido. Un hueco declarado se puede ensenar; un sesgo sin medir, no.')
    ),
    'filas',  v_filas,
    'espejo', v_esp,
    'dias',   v_dias
  );
end;
$fn$;

grant execute on function public.report_sales(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], uuid[], uuid[], text, uuid[], text[], boolean) to authenticated;
