-- ============================================================================
-- SOLO STAGING · R9 (13/10) · la regla de ventas para la empresa A
-- ----------------------------------------------------------------------------
-- Lo que la 0120 hace con Foodint en producción, aquí con la empresa A de
-- staging (que no tiene Foodint, así que la 0120 no hace nada): Glovo por
-- marca y Uber por plataforma; Casa Lola, a 70000001. Va en la tanda de
-- staging (supabase/staging/tanda-de-produccion.txt) entre la 0120 y la 0130,
-- para que la 0130 tenga asientos del día entero que retirar: sin regla, no
-- retira nada, y la prueba no podría fallar.
-- Vuelta atrás: supabase/staging/vuelta-atras/20261020T0125_ventas_por_plataforma_regla_a.down.sql
-- ============================================================================
do $$
declare
  v_acc   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_marca constant uuid := '7e000000-0000-4000-8000-000000000b01';   -- Casa Lola, propia
  v_glovo constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  v_uber  constant uuid := 'e0200000-0000-4000-8000-00000000a0c2';
  v_quien constant text := 'Folvy (R9, staging: regla de la empresa A)';
  v_e uuid; v_cta uuid;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Regla de la empresa A: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  if v_e is null then raise exception 'Regla de la empresa A: no encuentro la empresa de la cuenta A.'; end if;
  if exists (select 1 from public.conta_ventas_canal where company_id = v_e) then
    raise exception 'Regla de la empresa A: ya tiene regla de ventas; no se pisa.';
  end if;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, status, created_by_name)
  values (v_acc, v_e, 'pymes', '70000001', '700', 'VENTAS CASA LOLA', 'own', 'manual', 'activa', v_quien)
  on conflict (company_id, code) do nothing;
  select id into v_cta from public.company_account where company_id = v_e and code = '70000001';
  insert into public.conta_ventas_canal (company_id, account_id, channel_id, por_marca, created_by_name) values
    (v_e, v_acc, v_glovo, true, v_quien), (v_e, v_acc, v_uber, false, v_quien);
  insert into public.conta_ventas_marca (company_id, account_id, brand_id, papel, company_account_id, created_by_name)
  values (v_e, v_acc, v_marca, 'ventas', v_cta, v_quien);
  raise notice 'Regla de la empresa A (staging): Glovo por marca, Uber por plataforma; Casa Lola a 70000001.';
end $$;
