-- supabase/vuelta-atras/20261101T1614_b01p_pagos_salida.down.sql
--
-- Vuelta atrás de la 1614 (B01 Revolut · PR 2b): quita las funciones de la
-- salida al banco y «Activar pagos», devuelve la vista del estado de una
-- remesa a la de la 0915 y el CHECK del tipo a fichero | a_mano.
-- Si ya hay alguna remesa «banco» (un pago mandado a Revolut), para: deshacer
-- el tipo dejaría esos pagos sin su remesa, y eso no se hace a ciegas.

do $$ begin
  if exists (select 1 from public.conta_pago_remesa where kind = 'banco') then
    raise exception 'Vuelta atrás de la 1614: hay % remesas mandadas al banco. No se deshace el tipo «banco» con pagos dentro.',
      (select count(*) from public.conta_pago_remesa where kind = 'banco') using errcode = '55000';
  end if;
end $$;

drop function if exists public.conta_pago_activar(uuid, uuid);
drop function if exists public.conta_pago_por_saber(uuid);
drop function if exists public.conta_pago_banco_dice(uuid, text, text, text);
drop function if exists public.conta_pago_mandar_empezar(uuid);

create or replace view public.conta_pago_remesa_estado with (security_invoker = true) as
  with l as (
    select remesa_id,
           count(*) filter (where estado not in ('sacada', 'rechazada')) as vivas,
           count(*) filter (where estado = 'pagada') as pagadas,
           count(*) filter (where estado = 'por_confirmar') as por_confirmar,
           count(*) filter (where estado = 'rechazada') as rechazadas,
           coalesce(sum(amount) filter (where estado not in ('sacada', 'rechazada')), 0)::numeric(14,2) as total,
           coalesce(sum(amount) filter (where estado in ('pendiente', 'por_confirmar')), 0)::numeric(14,2) as por_cargar
      from public.conta_pago_remesa_linea_estado group by remesa_id
  )
  select r.*, coalesce(l.vivas, 0) as vivas, coalesce(l.pagadas, 0) as pagadas, coalesce(l.por_confirmar, 0) as por_confirmar,
         coalesce(l.rechazadas, 0) as rechazadas, coalesce(l.total, 0) as total, coalesce(l.por_cargar, 0) as por_cargar,
         case
           when coalesce(l.vivas, 0) = 0 then 'vacia'
           when l.pagadas = l.vivas then 'pagada'
           when r.kind = 'a_mano' or r.file_at is not null then 'en_banco'
           when l.por_confirmar > 0 then 'preparada'
           else 'fichero'
         end as estado
    from public.conta_pago_remesa r
    left join l on l.remesa_id = r.id;
grant select on public.conta_pago_remesa_estado to authenticated;
comment on view public.conta_pago_remesa_estado is 'PC01 · E2 · El estado de cada remesa de pagos, calculado de sus líneas: preparada, fichero, en_banco, pagada o vacia.';

set local lock_timeout = '5s';
alter table public.conta_pago_remesa
  drop constraint if exists conta_pago_remesa_kind_check,
  add constraint conta_pago_remesa_kind_check check (kind in ('fichero', 'a_mano'));
comment on column public.conta_pago_remesa.kind is null;
