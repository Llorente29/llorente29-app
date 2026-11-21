-- supabase/migrations/20261114T0757_b01r26_traspaso_cerrojo.sql
--
-- B01r26 (14/11) · UNA TANDA DEL TRASPASO A LA VEZ. En el ensayo de octubre en la
-- C0009 corrieron dos tandas del mismo traspaso a la vez (05:40, 05:44, 05:52,
-- 06:13 y 06:14, hora UTC: dos POST juntos de conta-diez-traspaso): las dos leen la
-- misma lista y pueden mandar el mismo asiento dos veces. El cerrojo: la tanda
-- toma el traspaso hasta una hora (tanda_hasta) y lo suelta al acabar; si otra
-- lo tiene, la segunda no manda nada y lo dice. Si una tanda se corta (504), el
-- cerrojo caduca solo.
--
-- SOLO AÑADE: una columna que admite nulos y dos funciones nuevas. Nada en el
-- camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261114T0757_b01r26_traspaso_cerrojo.down.sql

alter table public.conta_diez_traspaso add column if not exists tanda_hasta timestamptz;
comment on column public.conta_diez_traspaso.tanda_hasta is
  'B01r26 · Hasta cuándo lo tiene una tanda de conta-diez-traspaso (el cerrojo: una a la vez). Nulo: libre. Ver 20261114T0757.';

-- Tomarlo: true si estaba libre (o caducado) y ahora es de esta tanda, hasta p_segundos.
create or replace function public.conta_traspaso_tomar_tanda(p_traspaso uuid, p_segundos integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_segundos is null or p_segundos < 10 or p_segundos > 600 then
    raise exception 'El cerrojo de la tanda va de 10 a 600 segundos.' using errcode = '22023';
  end if;
  update public.conta_diez_traspaso
     set tanda_hasta = now() + make_interval(secs => p_segundos)
   where id = p_traspaso and (tanda_hasta is null or tanda_hasta < now());
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;
comment on function public.conta_traspaso_tomar_tanda(uuid, integer) is
  'B01r26 · Toma el traspaso para una tanda (true) o dice que ya lo tiene otra (false). Caduca solo. Solo el servidor (conta-diez-traspaso).';
revoke all on function public.conta_traspaso_tomar_tanda(uuid, integer) from public, anon, authenticated;
grant execute on function public.conta_traspaso_tomar_tanda(uuid, integer) to service_role;

-- Soltarlo al acabar la tanda.
create or replace function public.conta_traspaso_soltar_tanda(p_traspaso uuid)
returns void
language sql security definer set search_path = public as $$
  update public.conta_diez_traspaso set tanda_hasta = null where id = p_traspaso;
$$;
comment on function public.conta_traspaso_soltar_tanda(uuid) is
  'B01r26 · Suelta el cerrojo de la tanda del traspaso. Solo el servidor (conta-diez-traspaso).';
revoke all on function public.conta_traspaso_soltar_tanda(uuid) from public, anon, authenticated;
grant execute on function public.conta_traspaso_soltar_tanda(uuid) to service_role;
