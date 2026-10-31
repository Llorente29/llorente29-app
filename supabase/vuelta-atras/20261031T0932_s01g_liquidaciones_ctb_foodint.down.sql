-- supabase/vuelta-atras/20261031T0932_s01g_liquidaciones_ctb_foodint.down.sql
--
-- Vuelta atrás de la 0932: las liquidaciones de CTB de Foodint traídas del
-- sistema de antes vuelven a quedarse sin proveedor (como estaban).
-- sin prueba con datos: solo actúa sobre Foodint (cuenta 51ad1792…), que no
-- está en staging; la prueba es el ensayo de producción (tanda y vuelta atrás
-- en una transacción, con la cuenta de liquidaciones sin proveedor antes y después).
do $$
declare f constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
begin
  if not exists (select 1 from public.accounts where id = f) then
    raise notice 'S01g 0932 (vuelta atrás): esta base no tiene a Foodint: nada que deshacer.';
    return;
  end if;
  update public.licensed_settlement l set supplier_id = null, updated_at = now()
   where l.account_id = f and l.source = 'ctb_settlement'
     and l.supplier_id = (select s.id from public.supplier s where s.account_id = f
                           and s.name = 'CLOUDTOWN BRANDS, S.L.' and s.invoicing_mode = 'monthly_settlement');
end $$;
