-- VUELTA ATRÁS de 20261009T0040_tpv_sala_s1_mesas_comensales_envios.sql
--
-- ⚠️ Fuera de banda, como la ida. Borra los datos de sala (zonas, mesas,
--    envíos, anulaciones). Las ventas de mesa que existan quedan como ventas
--    normales del TPV, sin mesa; su service_type 'dine_in' se pasa a 'pickup'
--    para que el CHECK de antes vuelva a valer (se cuentan y se dicen antes).

do $$
declare v_h time := (now() at time zone 'Europe/Madrid')::time; n int;
begin
  if v_h >= time '12:15' or v_h < time '00:30' then
    raise exception 'vuelta atrás tpv_sala_s1: son las % — dentro de la banda. Esperar.', v_h;
  end if;
  select count(*) into n from sale where service_type = 'dine_in';
  raise notice 'ventas dine_in que pasan a pickup: %', n;
end $$;

-- 1. Las funciones que ya existían, a su forma de antes (inversa exacta).
do $$
declare v_def text; v_new text; c int;
begin
  v_def := pg_get_functiondef('public.tg_auto_print_on_accept()'::regprocedure);
  v_new := regexp_replace(v_def,
    E'\n  -- TPV sala \\(S1\\): una MESA imprime por envíos \\(pos_table_fire\\), nunca el\n  -- pedido entero al aceptarse\\.\n  if v_fire and new\\.table_id is not null then v_fire := false; end if;\n\n', E'\n');
  if v_new = v_def then raise exception 'tg_auto_print_on_accept: no se encontró el añadido — parar'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public.upsert_pos_sale(uuid,uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure);
  v_new := regexp_replace(v_def,
    E'    -- TPV sala \\(S1\\): una cuenta de mesa no pasa por aquí\\. Su borrar-y-reinsertar\n    -- destruiría las líneas ya enviadas a cocina\\.\n    if v_result\\.table_id is not null then\n      raise exception ''upsert_pos_sale: es la cuenta de una mesa — se trabaja desde Sala'';\n    end if;\n', '');
  if v_new = v_def then raise exception 'upsert_pos_sale: no se encontró el añadido — parar'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public.pos_open_sales(uuid,uuid,integer)'::regprocedure);
  v_new := regexp_replace(v_def, E'    and s\\.table_id is null\n', '');
  if v_new = v_def then raise exception 'pos_open_sales: no se encontró el añadido — parar'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public.order_for_print(text,uuid,uuid)'::regprocedure);
  v_new := replace(v_def, 'public.order_for_print(p_device_token text, p_sale_id uuid, p_fire_id uuid DEFAULT NULL::uuid)',
                          'public.order_for_print(p_device_token text, p_sale_id uuid)');
  v_new := regexp_replace(v_new, E'      -- TPV sala \\(S1\\): con envío, solo sus líneas; nunca las anuladas\\.\n      and \\(p_fire_id is null or sl\\.fire_id = p_fire_id\\)\n      and sl\\.voided_at is null\n', '');
  v_new := regexp_replace(v_new, E'  -- TPV sala \\(S1\\): mesa, zona, comensales y envío para la cabecera del ticket\\.\n.*?\n  end if;\n\n  return v_result;', E'  return v_result;');
  select count(*) into c from regexp_matches(v_new, 'p_fire_id|dining_|sale_fire|voided_at', 'g');
  if c <> 0 then raise exception 'order_for_print: quedan % restos de S1 tras deshacer — parar', c; end if;
  drop function public.order_for_print(text, uuid, uuid);
  execute v_new;
  grant execute on function public.order_for_print(text, uuid) to anon, authenticated, service_role;
end $$;

-- 2. Lo nuevo, fuera.
drop function if exists public.pos_floor(uuid, uuid);
drop function if exists public.pos_table_open(uuid, integer, uuid, text);
drop function if exists public.pos_table_detail(uuid);
drop function if exists public.pos_table_add_lines(uuid, jsonb);
drop function if exists public.pos_table_set_pending_qty(uuid, numeric);
drop function if exists public.pos_table_remove_pending_line(uuid);
drop function if exists public.pos_table_fire(uuid, jsonb, text);
drop function if exists public.pos_void_reasons(uuid);
drop function if exists public.pos_table_void_line(uuid, uuid, text, text);
drop function if exists public.pos_table_request_bill(uuid);
drop function if exists public.pos_table_charge(uuid, text);
drop function if exists public.pos_table_clear(uuid);
drop function if exists public._pos_table_state(sale);
drop function if exists public._pos_table_assert_open(sale);
drop function if exists public._pos_enqueue_print(sale, text, jsonb);
drop function if exists public._pos_table_recalc_totals(uuid);
drop function if exists public._pos_insert_order_line(uuid, jsonb);
drop function if exists public._pos_device_for(text, uuid, uuid);
drop function if exists public._pos_actor_name(uuid);
drop function if exists public._pos_table_sale(uuid);
drop function if exists public._pos_sala_channel_id(uuid);

alter table public.sale_line drop column if exists fire_id, drop column if exists voided_at;
drop index if exists public.sale_one_live_per_table_uq;
alter table public.sale drop constraint if exists sale_table_needs_covers;
update public.sale set service_type = 'pickup' where service_type = 'dine_in';
alter table public.sale drop constraint if exists sale_service_type_check;
alter table public.sale add constraint sale_service_type_check
  check (service_type is null or service_type = any (array['platform_delivery', 'own_delivery', 'pickup']));
alter table public.sale
  drop column if exists table_id, drop column if exists covers, drop column if exists served_by,
  drop column if exists served_by_name, drop column if exists bill_requested_at, drop column if exists table_cleared_at;

drop table if exists public.sale_line_void;
drop table if exists public.void_reason;
drop table if exists public.sale_fire;
drop table if exists public.dining_config;
drop table if exists public.dining_table;
drop table if exists public.dining_zone;
drop function if exists public.tg_dining_table_same_location();

notify pgrst, 'reload schema';
