-- supabase/migrations/20261102T1217_s01q_foodint_tiendas.sql
--
-- S01q · Foodint: el local y la marca de sus tiendas de plataforma (Julio, 02/11,
-- respuesta 1, decisiones 1 a 4). Mueve filas: va con autorizo.
--   · Glovo: el local de la etiqueta del nombre, por encima de la dirección
--     («Camichi 4» → Carabanchel, «C. Cañaveral» → Plaza Castilla, «C. de
--     Florencio Llorente» → Alcalá): 11 tiendas mal o sin local.
--   · «C. de Juan Antonio Bardem»: la etiqueta no decide; cada tienda, la suya
--     (Julio): «Scandal Burger» → Carabanchel; «French Tacos Club» es Lovers
--     Burgers, de Alcalá (Glovo no renombró la tienda). French Tacos no es marca.
--   · La marca, por el nombre, a las que no la tienen (31: 30 por su nombre y
--     French Tacos Club → Lovers Burgers).
-- No se toca ninguna tienda confirmada a mano (updated_by_name). El cambio vale
-- desde siempre (su tramo abierto): estaban mal desde que llegaron. Sus
-- liquidaciones toman el local y la marca de su tienda, y vuelven a decir si
-- quedan por aclarar. Lo de antes queda en conta_s01q_tienda_antes, para la
-- vuelta atrás. Sin Foodint (staging), no hace nada.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_alcala constant uuid := '38158159-cd71-4056-950b-53425afac1ce';
  v_carabanchel constant uuid := '92d7656e-082e-452a-8ebc-236b2d6ebf5f';
  v_lovers uuid; v_n_local int; v_n_marca int; r record;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01q: sin la cuenta de Foodint, no hay nada que corregir.';
    return;
  end if;
  select id into v_lovers from public.brand where account_id = v_acc and name = 'Lovers Burgers';
  if v_lovers is null then raise exception 'S01q: Foodint no tiene la marca «Lovers Burgers»: no se toca nada.'; end if;

  create temp table s01q_tienda on commit drop as
  select ps.id, ps.provider, ps.external_text, ps.brand_id as marca_antes, ps.location_id as local_antes,
    case
      when ps.provider = 'glovo' and ps.external_text ~* 'French Tacos Club - MAD - C\. de Juan Antonio Bardem' then v_alcala
      when ps.provider = 'glovo' and ps.external_text ~* 'Scandal Burger - MAD - C\. de Juan Antonio Bardem' then v_carabanchel
      when ps.provider = 'glovo' and public._conta_tienda_etiqueta(ps.external_text) is not null
        then coalesce(public._conta_local_de_texto(v_acc, array[public._conta_tienda_etiqueta(ps.external_text)]), ps.location_id)
      else coalesce(ps.location_id, public.conta_local_de_tienda(v_acc, ps.external_text))
    end as local_nuevo,
    case
      when ps.brand_id is not null then ps.brand_id
      when ps.provider = 'glovo' and ps.external_text ~* 'French Tacos Club' then v_lovers
      else public.conta_marca_de_tienda(v_acc, ps.external_text)
    end as marca_nueva
    from public.platform_store ps
   where ps.account_id = v_acc and ps.updated_by_name is null;

  select count(*) filter (where local_nuevo is distinct from local_antes), count(*) filter (where marca_nueva is distinct from marca_antes)
    into v_n_local, v_n_marca from s01q_tienda;
  if v_n_local <> 13 or v_n_marca <> 31 then
    raise exception 'S01q: medí 13 tiendas con otro local y 31 con marca nueva; ahora salen % y %: no se toca nada.', v_n_local, v_n_marca;
  end if;
  if exists (select 1 from s01q_tienda where local_nuevo is null or marca_nueva is null) then
    raise exception 'S01q: queda alguna tienda sin local o sin marca: no se toca nada.';
  end if;

  -- Lo de antes, para la vuelta atrás: la tienda, su tramo abierto y sus liquidaciones.
  create table if not exists public.conta_s01q_tienda_antes (
    tabla text not null, fila uuid not null, location_id uuid, brand_id uuid, primary key (tabla, fila));
  insert into public.conta_s01q_tienda_antes (tabla, fila, location_id, brand_id)
  select 'platform_store', t.id, t.local_antes, t.marca_antes from s01q_tienda t
   where t.local_nuevo is distinct from t.local_antes or t.marca_nueva is distinct from t.marca_antes
  union all
  select 'platform_store_tramo', x.id, x.location_id, x.brand_id from public.platform_store_tramo x join s01q_tienda t on t.id = x.store_id
   where x.account_id = v_acc and x.valid_to is null and (t.local_nuevo is distinct from t.local_antes or t.marca_nueva is distinct from t.marca_antes)
  union all
  select 'channel_settlement', cs.id, cs.location_id, cs.brand_id from public.channel_settlement cs join s01q_tienda t on t.id = cs.store_id
   where cs.account_id = v_acc and (t.local_nuevo is distinct from t.local_antes or t.marca_nueva is distinct from t.marca_antes)
  on conflict do nothing;

  for r in select * from s01q_tienda where local_nuevo is distinct from local_antes or marca_nueva is distinct from marca_antes loop
    update public.platform_store set location_id = r.local_nuevo, brand_id = r.marca_nueva, updated_at = now()
     where id = r.id and account_id = v_acc;
    update public.platform_store_tramo set location_id = r.local_nuevo, brand_id = r.marca_nueva
     where store_id = r.id and account_id = v_acc and valid_to is null;
    update public.channel_settlement
       set location_id = case when r.local_nuevo is distinct from r.local_antes then r.local_nuevo else coalesce(location_id, r.local_nuevo) end,
           brand_id = coalesce(brand_id, r.marca_nueva), updated_at = now()
     where store_id = r.id and account_id = v_acc;
    perform public._conta_liquidacion_marcar(cs.id) from public.channel_settlement cs where cs.store_id = r.id and cs.account_id = v_acc;
  end loop;
  raise notice 'S01q: % tiendas con su local bueno y % con su marca.', v_n_local, v_n_marca;
end $$;
