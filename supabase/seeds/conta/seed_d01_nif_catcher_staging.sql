-- supabase/seeds/conta/seed_d01_nif_catcher_staging.sql
--
-- SOLO STAGING. Todo inventado. El NIF de «Catcher Marketplace» de la semilla
-- de E05 (B00000055) no pasa su carácter de control y dejaba en rojo «Datos
-- maestros e impuestos» (Julio, 16/10). Pasa a B00000125, válido y sin dueño
-- en staging (lo comprobó C; medido otra vez: 0 fichas y 0 terceros con él).
--
-- seed_e05_staging.sql ya sale con el nuevo; esto arregla lo ya sembrado, que
-- esa semilla no vuelve a sembrar (on conflict do nothing): la ficha del
-- proveedor y su tercero. Medido antes, en staging: 1 ficha y 1 tercero con el
-- de antes, los dos de la cuenta A; ninguna factura lo lleva como emisor.
-- Se puede volver a lanzar: cada cambio mira antes si hace falta.

do $$
declare
  a     constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  catch constant uuid := 'e0500000-0000-4000-8000-000000000002';
  n int;
begin
  if not exists (select 1 from public.accounts where id = a) then raise exception 'NIF de Catcher: no está la cuenta A de prueba: esto no es staging-conta.'; end if;
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'NIF de Catcher: esta base tiene cuentas de producción: no es staging.';
  end if;
  if exists (select 1 from public.supplier where tax_id = 'B00000125' and id <> catch) then raise exception 'NIF de Catcher: B00000125 ya lo tiene otra ficha.'; end if;

  update public.supplier set tax_id = 'B00000125' where id = catch and account_id = a and tax_id = 'B00000055';
  update public.party p set tax_id = 'B00000125'
   where p.account_id = a and p.tax_id = 'B00000055'
     and exists (select 1 from public.party_role r where r.party_id = p.id and r.supplier_id = catch);
  update public.supplier_invoice set issuer_tax_id = 'B00000125' where account_id = a and issuer_tax_id = 'B00000055';

  select (select count(*) from public.supplier where account_id = a and tax_id = 'B00000055')
       + (select count(*) from public.party where account_id = a and tax_id = 'B00000055') into n;
  if n > 0 then raise exception 'NIF de Catcher: quedan % fichas o terceros con B00000055.', n; end if;
  raise notice 'NIF de Catcher: B00000125 en la ficha y en su tercero; quedan 0 con B00000055.';
end $$;
