-- supabase/vuelta-atras/20261112T0140_e05_datos.down.sql
-- Deshace la 0140 (los datos de Foodint para Catcher). Va antes que la de la 0130.
-- Freno: si la 40700001 ya tiene apuntes, o ya se ha subido alguna quincena, no
-- se borra nada (se perdería el saldo o las facturas se quedarían sin tienda).
do $$
declare
  a constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  n int; m int;
begin
  select count(*) into n from public.journal_line l join public.company_account ca on ca.id = l.company_account_id
   where ca.account_id = a and ca.company_id = e and ca.code = '40700001';
  select count(*) into m from public.supplier_batch where account_id = a and company_id = e;
  if n > 0 or m > 0 then
    raise exception 'VUELTA ATRÁS 0140 PARADA: la 40700001 tiene % apunte(s) y hay % quincena(s) subida(s): no se toca nada.', n, m using errcode = 'P0001';
  end if;
  delete from public.supplier_rate where account_id = a and company_id = e and provider = 'catcher' and created_by_name = 'Tanda E05';
  delete from public.supplier_batch_store where account_id = a and company_id = e and provider = 'catcher' and created_by_name = 'Tanda E05';
  delete from public.company_account_link l using public.company_account ca
   where ca.id = l.company_account_id and l.account_id = a and l.company_id = e and l.entity = 'supplier' and l.role = 'gasto' and ca.code = '62400001'
     and l.entity_id in (select l2.entity_id from public.company_account_link l2 join public.company_account c2 on c2.id = l2.company_account_id
                          where l2.account_id = a and l2.company_id = e and l2.role = 'principal' and c2.code = '41000100');
  delete from public.company_account where account_id = a and company_id = e and code = '40700001' and created_by_name = 'Tanda E05';
end $$;
