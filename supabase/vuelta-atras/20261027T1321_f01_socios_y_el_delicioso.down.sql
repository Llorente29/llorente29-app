-- supabase/vuelta-atras/20261027T1321_f01_socios_y_el_delicioso.down.sql
--
-- Vuelta atrás de la 1321: quita SOLO lo que lleva su firma ('F01 · tanda').
--   · Las fichas de socio que puso (las demás se quedan).
--   · El alta de El Delicioso: su registro de alta, sus locales y plataformas,
--     los vínculos de sus 9 platos de antes con su artículo (vuelven a no
--     tenerlo), los platos y artículos que creó y sus precios por plataforma.
-- PARA si algún pedido ya apunta a un plato de El Delicioso creado por la tanda:
-- quitarlo dejaría esas líneas sin plato. Entonces no se deshace: se decide.
-- La marca El Delicioso no se toca: ya existía.

do $$
declare
  v_cuenta constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';  -- Foodint
  v_brand  uuid;
  v_n      integer;
begin
  select b.id into v_brand from public.brand b where b.account_id = v_cuenta and b.name = 'El Delicioso Latin Food' and b.archived_at is null;

  if v_brand is not null then
    select count(*) into v_n from public.sale_line sl
      join public.menu_item mi on mi.id = sl.menu_item_id
     where sl.account_id = v_cuenta and mi.account_id = v_cuenta and mi.brand_id = v_brand and mi.created_by_name = 'F01 · tanda';
    if v_n > 0 then
      raise exception 'F01: % líneas de pedidos ya apuntan a platos de El Delicioso creados por la tanda: no se deshace sin decidirlo.', v_n;
    end if;

    -- Los platos de antes, sin el artículo que les puso la tanda.
    update public.menu_item mi set recipe_item_id = null, updated_at = now()
     where mi.account_id = v_cuenta and mi.brand_id = v_brand and mi.created_by_name is distinct from 'F01 · tanda'
       and mi.recipe_item_id in (select ri.id from public.recipe_item ri where ri.account_id = v_cuenta and ri.created_by_name = 'F01 · tanda');
    delete from public.menu_item_override o
     where o.account_id = v_cuenta and o.menu_item_id in (select mi.id from public.menu_item mi where mi.account_id = v_cuenta and mi.brand_id = v_brand);
    delete from public.menu_item mi where mi.account_id = v_cuenta and mi.brand_id = v_brand and mi.created_by_name = 'F01 · tanda';
    delete from public.recipe_item ri where ri.account_id = v_cuenta and ri.created_by_name = 'F01 · tanda'
       and not exists (select 1 from public.menu_item mi where mi.recipe_item_id = ri.id);
    delete from public.brand_channel where account_id = v_cuenta and brand_id = v_brand and created_by_name = 'F01 · tanda';
    delete from public.brand_location_availability where account_id = v_cuenta and brand_id = v_brand and notes = 'F01 · alta de una marca de Last';
    delete from public.external_brand_alta where account_id = v_cuenta and brand_id = v_brand and created_by_name = 'F01 · tanda';
  end if;

  delete from public.brand_licensing_agreement where created_by_name = 'F01 · tanda';
end $$;
