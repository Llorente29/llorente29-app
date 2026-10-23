-- supabase/vuelta-atras/20261208T0820_d07a_diez_reenviar_descripcion.down.sql
--
-- Vuelta atrás de 20261208T0820_d07a_diez_reenviar_descripcion: los envíos
-- que siguen «pendiente» con el motivo que les puso la 0820 vuelven EXACTAMENTE
-- a como estaban —attempts, next_try_at, last_error y updated_at—, desde el
-- respaldo que guardó la 0850 justo antes (public.conta_respaldo_d07a_envios).
-- Los que ya llegaron a Diez se quedan como están: están allí.
--
-- Antes (hasta el 23/10, run 190) ponía attempts = 3 y dejaba el last_error de
-- la 0820: lo que cuenta la tanda no volvía a ser lo de antes y el ensayo paró.
-- Sin respaldo (staging, o la 0850 ya deshecha), no toca nada y lo dice.
do $$
declare v_n int;
begin
  if to_regclass('public.conta_respaldo_d07a_envios') is null then
    raise notice 'D07a 0820 vuelta atrás: no hay respaldo (0850): no se toca ningún envío.';
    return;
  end if;
  update public.external_send x
     set attempts = r.attempts, next_try_at = r.next_try_at, last_error = r.last_error, updated_at = r.updated_at
    from public.conta_respaldo_d07a_envios r
   where x.id = r.id and x.status = 'pendiente'
     and x.last_error like 'Se vuelve a mandar con la descripción en 40 caracteres (D07a).%';
  get diagnostics v_n = row_count;
  raise notice 'D07a 0820 vuelta atrás: % envíos, como estaban antes de la 0820.', v_n;
end $$;
