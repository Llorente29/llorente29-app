-- supabase/migrations/20261102T0930_s01o3_anthropic_comun.sql
--
-- S01o·3 · Foodint: Anthropic es común a todos los locales (Julio, 02/11). Solo
-- su ficha: ninguna otra se toca sin que lo diga Julio. Mueve una fila: va con «autorizo».
-- Vuelta atrás: supabase/vuelta-atras/20261102T0930_s01o3_anthropic_comun.down.sql
do $$
declare v_n int;
begin
  if not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') then
    raise notice 'S01o·3: esta base no tiene Foodint: no se toca nada.';
    return;
  end if;
  update public.supplier set default_common = true, updated_at = now()
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and id = 'ff2629d5-e6d1-4093-98dd-1b00b3fe9cf8' and not default_common;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'S01o·3: esperaba poner común a Anthropic (1 ficha) y han sido %.', v_n; end if;
  raise notice 'S01o·3: Anthropic, común a todos los locales.';
end $$;
