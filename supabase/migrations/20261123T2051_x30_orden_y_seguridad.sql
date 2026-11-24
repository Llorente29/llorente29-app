-- supabase/migrations/20261123T2051_x30_orden_y_seguridad.sql
-- cambia: public.bank_importar · prueba: supabase/staging/sql/20261123_x30_conciliar_solo_prueba.sql
-- cambia: public.bank_match · prueba: supabase/staging/sql/20261123_x30_conciliar_solo_prueba.sql
-- cambia: public.treasury_account · prueba: supabase/staging/sql/20261123_x30_conciliar_solo_prueba.sql
--
-- X30 · Conciliar solo y reglas de verdad (respuesta X30 · 1, con el visto bueno de Julio):
--   1. bank_importar (trozos exactos, la misma firma; la de antes, guardada) escribe bank_movement.position (2050): el
--      orden de la línea en su extracto, de la más antigua a la más nueva. Si el fichero viene de la más nueva a la más
--      antigua (la última fecha antes que la primera), se le da la vuelta. Así el saldo línea a línea del mismo día sigue
--      el orden del banco (el «Cuadra ✗» del 16/11). Lo importado antes se queda sin orden: no hay de dónde sacarlo.
--   2. Un disparador before insert en bank_match (_bank_match_seguridad): el porcentaje con el que se concilia
--      (confidence_pct, 2050). 99 lo «seguro» de siempre (respuesta A: así el agente no cambia); si no, el de la
--      propuesta que estaba en el movimiento (proposal->seguridad). Si ya viene, no se toca.
--   3. Un disparador after insert en treasury_account (_bank_reglas_de_partida_al_dar_de_alta): la primera cuenta de
--      banco de una empresa le pone sus reglas de partida (2050), desde ese momento (respuesta C).
--
-- Nada en el camino del pedido. El real lo lanza Julio. Vuelta atrás: quita los dos disparadores y restaura bank_importar.

select public._respaldar_funcion(
  'public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)', '20261123T2051_x30_orden_y_seguridad');

-- 1 · bank_importar escribe el orden de cada línea -------------------------------------------------------------------------
do $do$
declare
  v_def text;
  a_viejo text := $v$v_nuevos int := 0; v_rep int := 0; v_borr int := 0;$v$;
  a_nuevo text := $n$v_nuevos int := 0; v_rep int := 0; v_borr int := 0;
  -- X30 · El orden del banco: cuántas líneas trae y si vienen de la más nueva a la más antigua.
  v_total int := jsonb_array_length(coalesce(p_movs, '[]'::jsonb));
  v_al_reves boolean := coalesce(jsonb_array_length(coalesce(p_movs, '[]'::jsonb)) > 1
    and (p_movs->0->>'fecha')::date > (p_movs->(jsonb_array_length(p_movs) - 1)->>'fecha')::date, false);$n$;
  b_viejo text := $v$before_cutover, status, reason, counterparty, movement_type)$v$;
  b_nuevo text := $n$before_cutover, status, reason, counterparty, movement_type, position)$n$;
  c_viejo text := $v$public._bank_contraparte_limpia(nullif(v_m->>'contraparte', '')), nullif(trim(v_m->>'tipo'), ''))$v$;
  c_nuevo text := $n$public._bank_contraparte_limpia(nullif(v_m->>'contraparte', '')), nullif(trim(v_m->>'tipo'), ''),
            -- X30 · Su orden en el extracto, de la más antigua a la más nueva.
            case when v_al_reves then v_total + 1 - v_pos else v_pos end)$n$;
  viejos text[]; nuevos text[];
begin
  v_def := pg_get_functiondef('public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)'::regprocedure);
  if strpos(v_def, 'X30 · Su orden en el extracto') > 0 then return; end if;   -- ya pasada
  viejos := array[a_viejo, b_viejo, c_viejo]; nuevos := array[a_nuevo, b_nuevo, c_nuevo];
  for k in 1 .. 3 loop
    if (length(v_def) - length(replace(v_def, viejos[k], ''))) / length(viejos[k]) <> 1 then
      raise exception 'X30 · 2051: bank_importar no es la medida (su trozo % no está una sola vez): no se toca.', k;
    end if;
    v_def := replace(v_def, viejos[k], nuevos[k]);
  end loop;
  execute v_def;
end $do$;

-- 2 · El porcentaje con el que se concilia ---------------------------------------------------------------------------------
create or replace function public._bank_match_seguridad()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  if new.confidence_pct is null then
    new.confidence_pct := case when new.confidence = 'seguro' then 99
      else (select case when m.proposal->>'seguridad' ~ '^\d{1,3}$' then least((m.proposal->>'seguridad')::int, 100) end
              from public.bank_movement m where m.id = new.movement_id) end;
  end if;
  return new;
end $function$;
comment on function public._bank_match_seguridad() is 'X30 · El porcentaje con el que se concilia: 99 lo seguro; si no, el de la propuesta del movimiento.';
revoke all on function public._bank_match_seguridad() from public, anon, authenticated;
drop trigger if exists trg_bank_match_seguridad on public.bank_match;
create trigger trg_bank_match_seguridad before insert on public.bank_match
  for each row execute function public._bank_match_seguridad();

-- 3 · La primera cuenta de banco de una empresa le pone sus reglas de partida ---------------------------------------------
create or replace function public._bank_reglas_de_partida_al_dar_de_alta()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  if new.kind = 'bank' and new.company_id is not null
     and not exists (select 1 from public.bank_rule r where r.company_id = new.company_id and r.seed = 'partida') then
    perform public._bank_reglas_de_partida(new.company_id, now());
  end if;
  return null;
end $function$;
comment on function public._bank_reglas_de_partida_al_dar_de_alta() is 'X30 · Al dar de alta el primer banco de una empresa, sus reglas de partida, desde ese momento.';
revoke all on function public._bank_reglas_de_partida_al_dar_de_alta() from public, anon, authenticated;
drop trigger if exists trg_bank_reglas_de_partida on public.treasury_account;
create trigger trg_bank_reglas_de_partida after insert on public.treasury_account
  for each row execute function public._bank_reglas_de_partida_al_dar_de_alta();
