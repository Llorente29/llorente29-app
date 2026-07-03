-- 20260703T2570_delete_campaign.sql
-- Aplicada: (pendiente)
--
-- G2·D4 (parte 3) — Eliminar campaña. RPC con guard de cuenta + guard de sistema +
-- guard de CANJES: si la campaña tiene coupon_redemption, NO se borra (el histórico de
-- rendimiento es dato) -> reason 'has_redemptions' (la UI ofrece pausar). Sin canjes ->
-- delete físico de coupon (campaign_scope cae por FK on delete cascade).
--
-- No se prueba en la tx que la crea.

begin;

create or replace function public.delete_campaign(p_account uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_c coupon%rowtype;
begin
  if not (p_account = any(current_user_account_ids())) then raise exception 'forbidden'; end if;

  select * into v_c from coupon where id = p_id and account_id = p_account;
  if v_c.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  -- Sistema = bienvenida (standard auto/first) o frecuencia: NUNCA se eliminan aquí.
  if v_c.kind = 'frequency' or (v_c.kind = 'standard' and (v_c.auto_apply or v_c.first_order_only)) then
    return jsonb_build_object('ok', false, 'reason', 'system');
  end if;

  -- Con canjes: el histórico manda. No se borra físico; la UI ofrece pausar.
  if exists (select 1 from coupon_redemption where coupon_id = p_id) then
    return jsonb_build_object('ok', false, 'reason', 'has_redemptions');
  end if;

  -- Sin canjes: borrado físico. campaign_scope cae por FK on delete cascade.
  delete from coupon where id = p_id and account_id = p_account;

  return jsonb_build_object('ok', true);
end;
$fn$;

grant execute on function public.delete_campaign(uuid, uuid) to authenticated;

commit;
