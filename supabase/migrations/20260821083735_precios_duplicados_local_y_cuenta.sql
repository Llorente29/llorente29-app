-- ENCARGO CODE (21/08) §5 — quitar los 9 precios de ámbito LOCAL que tienen
-- gemelo de ámbito CUENTA al MISMO precio. La comprobación de que ningún
-- precio publicado se mueve va DENTRO de la transacción: si alguno se moviera,
-- revierte entera. El trigger trg_menu_item_override_history deja el rastro.
do $$
declare
  v_account uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';  -- Foodint (PRODUCCIÓN)
  v_antes   jsonb;
  v_despues jsonb;
  v_borradas int;
  v_esperadas int;
begin
  if not exists (select 1 from public.accounts where id = v_account and name = 'Foodint') then
    raise exception 'La cuenta % no es Foodint. Abortado.', v_account;
  end if;

  create temp table _dup on commit drop as
  select loc.id, loc.menu_item_id, loc.channel_id, loc.location_id, loc.price
  from public.menu_item_override loc
  where loc.account_id = v_account
    and loc.location_id is not null
    and loc.channel_id is not null
    and loc.price is not null
    and exists (
      select 1 from public.menu_item_override cta
      where cta.account_id     = v_account
        and cta.menu_item_id   = loc.menu_item_id
        and cta.channel_id     = loc.channel_id
        and cta.location_id is null
        and cta.price is not null
        and cta.price = loc.price
    );

  select count(*) into v_esperadas from _dup;
  if v_esperadas <> 9 then
    raise exception 'Se esperaban 9 duplicados y hay %. Abortado.', v_esperadas;
  end if;

  select jsonb_agg(jsonb_build_object(
           'k', d.menu_item_id::text || '|' || d.channel_id::text || '|' || d.location_id::text,
           'p', public.effective_price(d.menu_item_id, d.channel_id, d.location_id)) order by 1)
    into v_antes from _dup d;

  delete from public.menu_item_override o using _dup d where o.id = d.id;
  get diagnostics v_borradas = row_count;
  if v_borradas <> 9 then
    raise exception 'Se borraron % filas y se esperaban 9. Abortado.', v_borradas;
  end if;

  select jsonb_agg(jsonb_build_object(
           'k', d.menu_item_id::text || '|' || d.channel_id::text || '|' || d.location_id::text,
           'p', public.effective_price(d.menu_item_id, d.channel_id, d.location_id)) order by 1)
    into v_despues from _dup d;

  if v_antes is distinct from v_despues then
    raise exception 'Un precio publicado ha cambiado. ANTES=% DESPUES=%. Abortado.', v_antes, v_despues;
  end if;

  if exists (
    select 1 from public.menu_item_override loc
    where loc.account_id = v_account and loc.location_id is not null
      and loc.channel_id is not null and loc.price is not null
      and exists (
        select 1 from public.menu_item_override cta
        where cta.account_id = v_account and cta.menu_item_id = loc.menu_item_id
          and cta.channel_id = loc.channel_id and cta.location_id is null
          and cta.price is not null)
  ) then
    raise exception 'Queda algún precio de local con gemelo de cuenta. Abortado.';
  end if;

  raise notice 'OK: 9 duplicados quitados, 0 precios publicados movidos.';
end $$;