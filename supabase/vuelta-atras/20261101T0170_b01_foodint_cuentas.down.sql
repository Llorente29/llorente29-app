-- Vuelta atrás de B01 · las fichas de banco que le faltaban a Foodint (0170).
-- Quita SOLO las dos fichas que creó la 0170 (ids fijos: md5 de la cuenta del
-- plan) y sus enlaces. PARA si alguna ya tiene extractos, movimientos,
-- tarjetas, un cierre de mes o una conexión del agregador: quitarla se
-- llevaría trabajo de verdad. La ficha de la 57200001 (de la migración de
-- Diez) no se toca.
do $$
declare
  v_cuenta constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_ids uuid[]; n int;
begin
  select coalesce(array_agg(md5('b01-0170:' || a.id::text)::uuid), '{}') into v_ids
    from public.company_account a where a.account_id = v_cuenta and a.code in ('57200002', '57200003');
  select count(*) into n from public.treasury_account where id = any (v_ids);
  if n = 0 then raise notice 'No hay fichas de la 0170: nada que quitar.'; return; end if;
  if to_regclass('public.bank_statement') is not null then
    execute 'select (select count(*) from public.bank_statement where treasury_account_id = any ($1))
                  + (select count(*) from public.bank_movement where treasury_account_id = any ($1))
                  + (select count(*) from public.bank_card where treasury_account_id = any ($1))' into n using v_ids;
    if n > 0 then raise exception 'Las fichas de la 0170 ya tienen % extractos, movimientos o tarjetas: no se quitan.', n; end if;
  end if;
  if to_regclass('public.bank_month_close') is not null then
    execute 'select (select count(*) from public.bank_month_close where treasury_account_id = any ($1))
                  + (select count(*) from public.bank_aggregator_link where treasury_account_id = any ($1))' into n using v_ids;
    if n > 0 then raise exception 'Las fichas de la 0170 ya tienen % cierres o conexiones: no se quitan.', n; end if;
  end if;
  delete from public.company_account_link where account_id = v_cuenta and entity = 'bank_account' and entity_id = any (select unnest(v_ids)::text);
  delete from public.treasury_account where id = any (v_ids);
  raise notice 'Quitadas las fichas de la 0170 y sus enlaces.';
end $$;
