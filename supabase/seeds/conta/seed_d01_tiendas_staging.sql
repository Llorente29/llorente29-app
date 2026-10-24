-- supabase/seeds/conta/seed_d01_tiendas_staging.sql
--
-- D01 · «Sus tiendas» (16/10): una plataforma de reparto en el canal Uber Eats
-- de la cuenta A, con tres tiendas sin asignar, para la e2e y sus capturas.
-- SOLO STAGING. Todo inventado; nada copiado de producción. Se puede volver a
-- lanzar: ids fijos y, si ya está, no hace nada.
--
-- Las tiendas, con la forma que tienen en producción (medida el 16/10, solo el
-- recuento: las 7 son «Marca (dirección, ciudad, país, código postal)»):
--   · Burger Norte (…): se llama como una marca de A → la pantalla la propone;
--   · Pita del Sur (…): también;
--   · Marca Rara Inventada (…): no se llama como ninguna → no se propone nada.
-- Las tiendas nacen así en producción, al leer su primer resumen
-- (conta_liquidacion_registrar); aquí se ponen como las dejaría él: sin marca,
-- local ni banco. El papel de plataforma, como lo deja «Como plataforma de
-- reparto» en la ficha.

do $$
declare
  a     constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  uber  constant uuid := 'e0200000-0000-4000-8000-00000000a0c2';
  p     constant uuid := 'd1d00000-0000-4000-8000-000000000001';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla tiendas: esta base tiene cuentas de producción. No se siembra nada.';
  end if;
  if not exists (select 1 from public.sales_channel where id = uber and account_id = a) then
    raise exception 'Semilla tiendas: falta el canal Uber Eats de la cuenta A.';
  end if;
  if exists (select 1 from public.party where id = p) then
    raise notice 'Semilla tiendas: ya estaba sembrada; no hago nada.';
    return;
  end if;

  insert into public.party (id, account_id, name, source, created_by_name)
  values (p, a, 'Reparto Rápido Inventado', 'manual', 'semilla tiendas');
  insert into public.party_role (account_id, party_id, role, channel_id, settlement_every, commission_pct)
  values (a, p, 'platform', uber, 'weekly', 30);
  insert into public.platform_store (id, account_id, company_id, provider, external_text, channel_id, created_by_name) values
    ('d1d00000-0000-4000-8000-000000000011', a, emp, 'uber', 'Burger Norte (Calle Inventada 7, Madrid, ES, 28001)', uber, 'semilla tiendas'),
    ('d1d00000-0000-4000-8000-000000000012', a, emp, 'uber', 'Pita del Sur (Avenida Inventada 9, Madrid, ES, 28005)', uber, 'semilla tiendas'),
    ('d1d00000-0000-4000-8000-000000000013', a, emp, 'uber', 'Marca Rara Inventada (Plaza Inventada 2, Madrid, ES, 28004)', uber, 'semilla tiendas')
  on conflict do nothing;
  raise notice 'Semilla tiendas: Reparto Rápido Inventado (plataforma en Uber Eats) y 3 tiendas sin asignar.';
end $$;
