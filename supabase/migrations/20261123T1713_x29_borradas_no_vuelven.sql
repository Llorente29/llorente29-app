-- supabase/migrations/20261123T1713_x29_borradas_no_vuelven.sql
-- cambia: public.bank_importar · prueba: supabase/staging/sql/20261123_x29_extractos_prueba.sql
-- cambia: public.bank_movement · prueba: supabase/staging/sql/20261123_x29_extractos_prueba.sql
--
-- X29 · Una línea borrada del extracto no vuelve (respuesta X29 · 2, con el visto bueno de Julio):
--   1. bank_importar (trozos exactos, la misma firma; la de antes, guardada): antes de meter cada línea, si su huella
--      está en bank_movimiento_borrado (1712) no entra, y CUENTA APARTE de las repetidas: devuelve «borradas», y su
--      registro dice «3 que ya estaban · 1 borrada antes». Así se sabe por qué no ha entrado.
--   2. Un disparador before insert en bank_movement (_bank_movimiento_no_borrado): la misma comprobación como red,
--      para cualquier otro camino que meta líneas. Con el índice único por banco y huella (1712), una búsqueda por
--      línea: lo medido con un extracto de 1.000 líneas va en el PR.
--
-- Nada en el camino del pedido. El real lo lanza Julio. Vuelta atrás: quita el disparador y bank_importar, restaurada.

select public._respaldar_funcion(
  'public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)', '20261123T1713_x29_borradas_no_vuelven');

-- 1 · bank_importar: las borradas no entran y cuentan aparte --------------------------------------------------------------
do $do$
declare
  v_def text;
  a_viejo text := $v$v_nuevos int := 0; v_rep int := 0;$v$;
  a_nuevo text := $n$v_nuevos int := 0; v_rep int := 0; v_borr int := 0;$n$;
  b_viejo text := $v$    v_pos := v_pos + 1;
$v$;
  b_nuevo text := $n$    v_pos := v_pos + 1;
    -- X29 · Borrada a mano: no vuelve, y se cuenta aparte de las repetidas.
    if exists (select 1 from public.bank_movimiento_borrado d where d.treasury_account_id = p_treasury and d.fingerprint = v_m->>'huella') then
      v_borr := v_borr + 1;
      continue;
    end if;
$n$;
  c_viejo text := $v$format('%s: %s movimientos nuevos y %s que ya estaban, del %s al %s', v_t.name, v_nuevos, v_rep, to_char(p_desde, 'DD/MM'), to_char(p_hasta, 'DD/MM'))$v$;
  c_nuevo text := $n$format('%s: %s movimientos nuevos y %s que ya estaban%s, del %s al %s', v_t.name, v_nuevos, v_rep,
           case when v_borr > 0 then format(' · %s borrada%s antes', v_borr, case when v_borr = 1 then '' else 's' end) else '' end,
           to_char(p_desde, 'DD/MM'), to_char(p_hasta, 'DD/MM'))$n$;
  d_viejo text := $v$'nuevos', v_nuevos, 'repetidos', v_rep,$v$;
  d_nuevo text := $n$'nuevos', v_nuevos, 'repetidos', v_rep, 'borradas', v_borr,$n$;
  viejos text[]; nuevos text[];
begin
  v_def := pg_get_functiondef('public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)'::regprocedure);
  if strpos(v_def, 'X29 · Borrada a mano') > 0 then return; end if;   -- ya pasada
  viejos := array[a_viejo, b_viejo, c_viejo, d_viejo]; nuevos := array[a_nuevo, b_nuevo, c_nuevo, d_nuevo];
  for k in 1 .. 4 loop
    if (length(v_def) - length(replace(v_def, viejos[k], ''))) / length(viejos[k]) <> 1 then
      raise exception 'X29 · 1713: bank_importar no es la medida (su trozo % no está una sola vez): no se toca.', k;
    end if;
    v_def := replace(v_def, viejos[k], nuevos[k]);
  end loop;
  execute v_def;
end $do$;

-- 2 · El disparador, como red para cualquier otro camino ----------------------------------------------------------------
create or replace function public._bank_movimiento_no_borrado()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  if exists (select 1 from public.bank_movimiento_borrado d where d.treasury_account_id = new.treasury_account_id and d.fingerprint = new.fingerprint) then
    return null;   -- borrada a mano: no vuelve (bank_movimiento_borrado_quitar la deja volver)
  end if;
  return new;
end $function$;
comment on function public._bank_movimiento_no_borrado() is 'X29 · Una línea del extracto borrada a mano no vuelve a entrar en bank_movement.';
revoke all on function public._bank_movimiento_no_borrado() from public, anon, authenticated;
drop trigger if exists trg_bank_movimiento_no_borrado on public.bank_movement;
create trigger trg_bank_movimiento_no_borrado before insert on public.bank_movement
  for each row execute function public._bank_movimiento_no_borrado();
