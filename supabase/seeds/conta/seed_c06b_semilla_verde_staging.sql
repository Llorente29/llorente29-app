-- supabase/seeds/conta/seed_c06b_semilla_verde_staging.sql
--
-- SOLO STAGING. Todo inventado. La semilla de staging, sin los rojos que eran
-- suyos y no de la app (C06b, Julio, 15/10): «Datos maestros e impuestos»
-- salía en rojo cada noche en main por datos de prueba mal puestos, y un rojo
-- fijo tapa los rojos de verdad. No se afloja ninguna comprobación: se
-- arreglan los datos, con datos inventados válidos.
--
--   1. Dos NIF de la semilla de compras no pasaban su carácter de control
--      (B00000092 y B00000093). Ahora B00000109 y B00000117, válidos y sin
--      dueño en la semilla. También en la liquidación de septiembre de Aurora,
--      que los lleva dentro.
--   2. Dos sociedades fuera del SII sin su 347 (la «Sola» del C06 y la de
--      Diez). Ahora lo tienen, como cualquier sociedad fuera del SII.
--   3. La empresa B (Cocina de Prueba Sur, Canarias) no tenía el impuesto de
--      sus ventas y el cierre del día no pudo proponer el 04/10. Ahora IGIC
--      general (7 %), y se proponen los días que tenga pendientes.
--
-- Los ficheros de semilla de cada cosa ya salen así (seed_compras_staging,
-- seed_c06_diez_staging, seed_c00_empresas_prueba y la e2e de la «Sola»); esto
-- arregla lo que ya estaba sembrado, porque esas semillas no vuelven a sembrar
-- lo que existe. Se puede volver a lanzar: cada cambio mira antes si hace falta.
--
-- Lo que NO toca: el NIF B00000055 de «Catcher Marketplace». Es de la semilla
-- del frente A (seed_e05_staging.sql, rama conta/d01-catcher, sin fusionar):
-- si se cambia aquí, su semilla lo vuelve a poner. Se arregla en esa rama.

do $$
declare
  a     constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  carnes constant uuid := 'c0c00000-0000-4000-8000-000000000003';
  aurora constant uuid := 'c0c00000-0000-4000-8000-000000000004';
  emp_b constant uuid := '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6';
  n int; r jsonb;
begin
  -- Guarda: esto es la semilla de staging (la cuenta A de prueba existe y Foodint no).
  if not exists (select 1 from public.accounts where id = a) then raise exception 'Semilla verde: no está la cuenta A de prueba: esto no es staging-conta.'; end if;
  if exists (select 1 from public.accounts where id = '51ad1792-6629-4ef7-833a-b57b09a86710') then raise exception 'Semilla verde: esta base tiene Foodint: no es staging.'; end if;

  -- 1 · Los dos NIF, en la ficha del proveedor, en su tercero y en la liquidación.
  update public.supplier set tax_id = 'B00000109' where id = carnes and account_id = a and tax_id = 'B00000092';
  update public.supplier set tax_id = 'B00000117' where id = aurora and account_id = a and tax_id = 'B00000093';
  update public.party p set tax_id = case p.tax_id when 'B00000092' then 'B00000109' else 'B00000117' end
   where p.account_id = a and p.tax_id in ('B00000092', 'B00000093')
     and exists (select 1 from public.party_role r where r.party_id = p.id and r.supplier_id in (carnes, aurora));
  update public.licensed_settlement l
     set detail = replace(replace(l.detail::text, 'B00000092', 'B00000109'), 'B00000093', 'B00000117')::jsonb,
         raw    = replace(replace(l.raw::text,    'B00000092', 'B00000109'), 'B00000093', 'B00000117')::jsonb
   where l.account_id = a and (l.detail::text ~ 'B0000009[23]' or l.raw::text ~ 'B0000009[23]');
  select count(*) into n from public.supplier where account_id = a and tax_id in ('B00000092', 'B00000093');
  if n > 0 then raise exception 'Semilla verde · 1: quedan % proveedores con el NIF de antes.', n; end if;
  raise notice 'Semilla verde · 1: NIF de Carnes y Aurora válidos (B00000109, B00000117).';

  -- 2 · El 347 de las sociedades fuera del SII de la semilla del C06.
  update public.company_tax_profile p set tax_forms = p.tax_forms || array['347']
    from public.company c join public.accounts ac on ac.id = c.account_id
   where p.company_id = c.id and ac.slug in ('c06-prueba-sola', 'c06-comercio-prueba-diez')
     and c.entity_kind = 'company' and not coalesce(p.sii, false) and not ('347' = any(p.tax_forms));
  get diagnostics n = row_count;
  raise notice 'Semilla verde · 2: % sociedades fuera del SII reciben su 347.', n;

  -- 3 · La empresa B: el IGIC de sus ventas, y los días que tenga pendientes.
  update public.company_tax_profile set sales_tax_rate_code = 'igic_general'
   where company_id = emp_b and sales_tax_rate_code is null and tax_territory = 'canarias';
  r := public.conta_proponer_dias(emp_b);
  raise notice 'Semilla verde · 3: empresa B con IGIC general; cierre del día: %', r;
end $$;
