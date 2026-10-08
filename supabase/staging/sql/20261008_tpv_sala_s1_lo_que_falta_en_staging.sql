-- STAGING-CONTA (oseymswjlzplqoxrfjzi) · TPV Sala S1 · lo que el conector no
-- puede aplicar solo. NUNCA en producción: allí va la parte B entera.
--
-- Por qué a mano: el conector de Supabase pide confirmación para todo lo que
-- lleve `delete` o `drop`, y el aviso no llega: se agota a los 60 s. El resto
-- de A y B ya está aplicado en staging por el conector (08/10, 13:2x–13:5x),
-- incluidas 6.1–6.3. Faltan:
--   · pos_table_remove_pending_line (lleva un `delete` de la línea sin enviar)
--   · 6.4 order_for_print + p_fire_id (DROP + CREATE)
-- Copia literal de la parte B; nada nuevo.

do $g$
begin
  if exists (select 1 from public.accounts where id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'Esto es producción (existe Folvy Interno). Aquí va la parte B entera, no este fichero. Parar.';
  end if;
end $g$;

create or replace function public.pos_table_remove_pending_line(p_line_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l sale_line; v_s sale;
begin
  select * into v_l from sale_line where id = p_line_id and parent_sale_line_id is null;
  if v_l.id is null then raise exception 'Esa línea no existe.'; end if;
  v_s := public._pos_table_sale(v_l.sale_id);
  perform public._pos_table_assert_open(v_s);
  if v_l.fire_id is not null then raise exception 'Esa línea ya está en cocina: se anula, no se borra.'; end if;
  delete from sale_line where id = p_line_id;   -- las hijas caen por la FK en cascada
  perform public._pos_table_recalc_totals(v_s.id);
  perform public.generate_sale_consumption(v_s.id);   -- el borrado no dispara el consumo
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.pos_table_remove_pending_line(uuid) to authenticated;

do $$
declare
  v_def text; v_new text; c int; v_acl_before text; v_acl_after text;
begin
  -- 6.4 order_for_print + p_fire_id. AÑADIR PARÁMETRO = DROP + CREATE (regla 2).
  select p.proacl::text into v_acl_before from pg_proc p where p.oid = 'public.order_for_print(text,uuid)'::regprocedure;
  v_def := pg_get_functiondef('public.order_for_print(text,uuid)'::regprocedure);

  select count(*) into c from regexp_matches(v_def, 'public\.order_for_print\(p_device_token text, p_sale_id uuid\)', 'g');
  if c <> 1 then raise exception 'tpv_sala_s1: order_for_print, firma aparece % veces — parar', c; end if;
  v_new := regexp_replace(v_def, 'public\.order_for_print\(p_device_token text, p_sale_id uuid\)',
                          'public.order_for_print(p_device_token text, p_sale_id uuid, p_fire_id uuid DEFAULT NULL::uuid)');

  select count(*) into c from regexp_matches(v_new, 'where sl\.sale_id = p_sale_id and sl\.parent_sale_line_id is null\n', 'g');
  if c <> 1 then raise exception 'tpv_sala_s1: order_for_print, filtro de padres aparece % veces — parar', c; end if;
  v_new := regexp_replace(v_new, 'where sl\.sale_id = p_sale_id and sl\.parent_sale_line_id is null\n',
    E'where sl.sale_id = p_sale_id and sl.parent_sale_line_id is null\n      -- TPV sala (S1): con envío, solo sus líneas; nunca las anuladas.\n      and (p_fire_id is null or sl.fire_id = p_fire_id)\n      and sl.voided_at is null\n');

  select count(*) into c from regexp_matches(v_new, E'\n  return v_result;\nend;', 'g');
  if c <> 1 then raise exception 'tpv_sala_s1: order_for_print, «return v_result» aparece % veces — parar', c; end if;
  v_new := regexp_replace(v_new, E'\n  return v_result;\nend;',
    E'\n  -- TPV sala (S1): mesa, zona, comensales y envío para la cabecera del ticket.\n  if v_result is not null then\n    v_result := v_result || coalesce((\n      select jsonb_build_object(\n        ''table_name'', dt.name, ''zone_name'', z.name, ''covers'', s.covers,\n        ''served_by_name'', s.served_by_name,\n        ''fire_number'', f.fire_number, ''fired_at'', f.fired_at,\n        ''fire_count'', (select count(*) from sale_fire ff where ff.sale_id = s.id))\n      from sale s\n      join dining_table dt on dt.id = s.table_id\n      join dining_zone z on z.id = dt.zone_id\n      left join sale_fire f on f.id = p_fire_id and f.sale_id = s.id\n      where s.id = p_sale_id and s.account_id = v_account_id), ''{}''::jsonb);\n  end if;\n\n  return v_result;\nend;');

  drop function public.order_for_print(text, uuid);
  execute v_new;
  grant execute on function public.order_for_print(text, uuid, uuid) to anon, authenticated, service_role;

  select p.proacl::text into v_acl_after from pg_proc p where p.oid = 'public.order_for_print(text,uuid,uuid)'::regprocedure;
  -- Los permisos de antes eran PUBLIC + anon + authenticated + service_role.
  if v_acl_after is null
     or position('anon=X' in v_acl_after) = 0
     or position('authenticated=X' in v_acl_after) = 0
     or position('service_role=X' in v_acl_after) = 0 then
    raise exception 'tpv_sala_s1: permisos de order_for_print no restaurados (antes %, ahora %) — parar', v_acl_before, v_acl_after;
  end if;
  raise notice 'order_for_print permisos antes %, ahora %', v_acl_before, v_acl_after;

  if (select count(*) from pg_proc where proname = 'order_for_print' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'tpv_sala_s1: order_for_print tiene más de una firma — parar';
  end if;
end $$;

notify pgrst, 'reload schema';

select pg_get_function_identity_arguments('public.order_for_print'::regproc) as firma_order_for_print,
       to_regprocedure('public.pos_table_remove_pending_line(uuid)') is not null as quitar_linea;
