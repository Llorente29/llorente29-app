-- supabase/migrations/20261113T1136_s01p_uber_sin_tienda.sql
--
-- S01p·18 · punto 6 (Julio, 12/11 y 13/11) · Las liquidaciones de Uber a las que les
-- falta la tienda. Medido el 13/11 (solo lectura): 8 liquidaciones de Uber de Foodint
-- con su tienda (store_id) pero sin local ni marca en la propia liquidación (1 de la
-- semana al 11/10, 7 de la semana al 18/10, una de ellas del 07/09 al 18/10). Sus tiendas
-- sí tenían local y marca en esas fechas (conta_tienda_en). Como el mes casa cada
-- liquidación por su local y su marca, esas 8 no salían en ninguna fila, y las semanas
-- de esas tiendas decían «No ha llegado su liquidación»: estaban en los libros.
--
-- Solo la pantalla (Julio, 13/11): los datos de las 8 los arregla D en su DL1_24. Aquí
-- se AÑADE:
--   · conta_liquidaciones_sin_tienda(empresa, desde, hasta): las liquidaciones de las
--     tiendas de la empresa que pisan esas fechas y no tienen local o marca, cada una
--     con lo que le daría su tienda en su fecha (o por qué no se puede).
--   · conta_liquidacion_asignar_tienda(liquidación, quién): le pone el local y la marca
--     que su tienda tenía en su fecha (solo los que le faltan), la vuelve a marcar
--     (_conta_liquidacion_marcar) y lo dice. Una a una, con su botón.
--
-- Nada en el camino del pedido. La tanda no mueve ninguna fila: asigna quien pulsa.

create or replace function public.conta_liquidaciones_sin_tienda(p_company uuid, p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', cs.id, 'canal', coalesce(sc.name, 'Plataforma'), 'tienda', ps.external_text, 'store_id', ps.id,
             'desde', cs.period_from, 'hasta', cs.period_to, 'neto', cs.net_payout,
             'marca_id', t.brand_id, 'marca', b.name, 'local_id', t.location_id, 'local', l.name,
             'porque', case when t.brand_id is null or t.location_id is null
                            then 'Su tienda no tenía local o marca en esas fechas: dáselos en Sus tiendas.' end)
           order by cs.period_from, sc.name, ps.external_text)
      from public.channel_settlement cs
      join public.platform_store ps on ps.id = cs.store_id and ps.account_id = cs.account_id
      left join public.sales_channel sc on sc.id = cs.channel_id
      cross join lateral public.conta_tienda_en(ps.id, coalesce(cs.period_from, cs.settlement_date)) t
      left join public.brand b on b.id = coalesce(cs.brand_id, t.brand_id)
      left join public.locations l on l.id = coalesce(cs.location_id, t.location_id)
     where cs.account_id = v_cuenta and ps.company_id = p_company
       and (cs.brand_id is null or cs.location_id is null)
       and coalesce(cs.period_from, cs.settlement_date) <= p_hasta and coalesce(cs.period_to, cs.settlement_date) >= p_desde), '[]'::jsonb);
end $$;
revoke all on function public.conta_liquidaciones_sin_tienda(uuid, date, date) from public, anon;
grant execute on function public.conta_liquidaciones_sin_tienda(uuid, date, date) to authenticated;

create or replace function public.conta_liquidacion_asignar_tienda(p_settlement uuid, p_quien_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cs public.channel_settlement; v_t record; v_marca text; v_local text; v_canal text; v_tienda text;
begin
  select * into v_cs from public.channel_settlement where id = p_settlement;
  if v_cs.id is null or not public.belongs_to_account(v_cs.account_id) then raise exception 'Esa liquidación no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cs.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta asigna una liquidación.' using errcode = '42501';
  end if;
  if v_cs.store_id is null then raise exception 'Esta liquidación no tiene tienda: asígnala desde Sus tiendas.' using errcode = '22023'; end if;
  select coalesce(sc.name, 'la plataforma'), ps.external_text into v_canal, v_tienda
    from public.platform_store ps left join public.sales_channel sc on sc.id = v_cs.channel_id where ps.id = v_cs.store_id;
  if v_cs.brand_id is not null and v_cs.location_id is not null then
    return jsonb_build_object('id', p_settlement, 'ya_estaba', true, 'texto', 'Esta liquidación ya tenía su local y su marca.');
  end if;
  select * into v_t from public.conta_tienda_en(v_cs.store_id, coalesce(v_cs.period_from, v_cs.settlement_date));
  if v_t.brand_id is null or v_t.location_id is null then
    raise exception 'La tienda «%» no tenía local o marca en esas fechas: dáselos en Sus tiendas y vuelve.', v_tienda using errcode = '22023';
  end if;
  update public.channel_settlement set brand_id = coalesce(brand_id, v_t.brand_id), location_id = coalesce(location_id, v_t.location_id), updated_at = now()
   where id = p_settlement returning * into v_cs;
  perform public._conta_liquidacion_marcar(p_settlement);
  select name into v_marca from public.brand where id = v_cs.brand_id;
  select name into v_local from public.locations where id = v_cs.location_id;
  return jsonb_build_object('id', p_settlement, 'ya_estaba', false,
    'texto', format('Asignada: la liquidación de %s del %s al %s (%s €) es de %s · %s, como su tienda en esas fechas.',
                    v_canal, to_char(v_cs.period_from, 'DD/MM'), to_char(v_cs.period_to, 'DD/MM'),
                    replace(to_char(v_cs.net_payout, 'FM999999990.00'), '.', ','), v_marca, v_local));
end $$;
revoke all on function public.conta_liquidacion_asignar_tienda(uuid, text) from public, anon;
grant execute on function public.conta_liquidacion_asignar_tienda(uuid, text) to authenticated;
comment on function public.conta_liquidacion_asignar_tienda(uuid, text) is
  'S01p·18 · 6. Pone a una liquidación de plataforma el local y la marca que su tienda tenía en su fecha (solo los que le faltan), la vuelve a marcar y lo dice.';
