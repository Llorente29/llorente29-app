-- supabase/migrations/20261030T0901_s01d_modelo_de_la_4751_foodint.sql
--
-- S01d · El modelo de cada subcuenta de la 4751 de Foodint (respuesta 1 de
-- Julio, 30/10): la 47510000 es el 111 y la 47510019 el 115. De ahí sale el
-- modelo cuando Bancos propone el pago de una declaración. Toca datos: va con
-- «autorizo». En una base sin Foodint (staging) no hace nada.
--
-- Cada cuenta se busca por la cuenta de Foodint y su código (regla 9), tiene
-- que haber exactamente una y estar sin modelo; si no, para.
do $$
declare
  f constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  r record; n int;
begin
  if not exists (select 1 from public.accounts where id = f) then
    raise notice 'S01d 0901: esta base no tiene a Foodint: no hay nada que poner.';
    return;
  end if;
  for r in select * from (values ('47510000', '111'), ('47510019', '115')) v(code, modelo) loop
    update public.company_account set withholding_model = r.modelo
     where account_id = f and code = r.code and withholding_model is null;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'S01d 0901: la % de Foodint no está, hay más de una o ya tiene modelo (%).', r.code, n;
    end if;
  end loop;
end $$;
