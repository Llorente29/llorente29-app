-- 20260708T1800_retire_stale_agent_shop_offers.sql
--
-- Rotación diaria del Shop (v3 · 3a): retira las PROPUESTAS de Shop del agente
-- (item_percent, active=false, sin aprobar) creadas en días ANTERIORES (hora Madrid),
-- para que cada día se presente una tanda fresca. Idempotente y seguro: solo toca
-- propuestas del agente sin publicar (las aprobadas/publicadas, active=true, se respetan).
--
-- La llama el offers-agent al inicio de cada corrida (higiene). Con el cron horario,
-- la primera corrida del día limpia la tanda de ayer; las siguientes del mismo día no
-- borran nada (las de hoy no son "de días anteriores") → estable dentro del día.
--
-- Devuelve cuántos cupones retiró. SECURITY DEFINER, GRANT a service_role.

create or replace function public.retire_stale_agent_shop_offers(p_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_n   integer;
begin
  select array_agg(id) into v_ids
  from coupon
  where account_id = p_account_id
    and origin = 'agent'
    and active = false
    and kind = 'item_percent'
    and 'shop' = any(channels)
    and (created_at at time zone 'Europe/Madrid')::date
        < (now() at time zone 'Europe/Madrid')::date;

  if v_ids is null then return 0; end if;

  delete from campaign_scope where coupon_id = any(v_ids);
  delete from coupon         where id = any(v_ids);

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.retire_stale_agent_shop_offers(uuid) from public;
grant execute on function public.retire_stale_agent_shop_offers(uuid) to service_role;
