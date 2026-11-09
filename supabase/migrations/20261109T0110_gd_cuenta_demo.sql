-- supabase/migrations/20261109T0110_gd_cuenta_demo.sql
--
-- GD · «Gestoría Demo»: la cuenta de demostración para QBO y para el congreso
-- (Julio, encargo GD y nº27). SOLO AÑADE: una cuenta nueva y lo suyo; no toca
-- ninguna fila de otra cuenta.
--
--   · La cuenta «Gestoría Demo» (de000000-…-a0): Sumied, asesoría, y DE
--     DEMOSTRACIÓN (accounts.is_demo): no manda nada fuera y solo lee los
--     sistemas de pruebas (el Bitrix24 de pruebas y el sandbox de GoCardless).
--   · Sus dos empresas emisoras, en sector Gestoría y con el alta terminada:
--       Gestoría Demo, S.L. (de000000-…-a9) · B00001008 · cobra con GoCardless;
--       Elena Campos Ortiz, autónoma (de000000-…-b9) · 00001000B · por transferencia.
--     Cada una con su banco de mentira (del banco 9999) y los cambios de tarifa
--     ENCENDIDOS: los datos son inventados (Julio, encargo GD).
--   · Su administrador: el superadministrador (Julio, nº27), con el nombre que
--     ya tiene en sus otras cuentas. Si no está (staging), la cuenta se crea
--     sin administrador y lo dice.
--
-- Los clientes no se siembran aquí: vienen del Bitrix24 de pruebas y del
-- sandbox (workflow «GD · sembrar pruebas») al conectarlos en Ajustes › Cobros.
-- Todo inventado (T11). Se puede pasar dos veces: si la cuenta ya está, no
-- hace nada. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261109T0110_gd_cuenta_demo.down.sql

do $$
declare
  v_cuenta   constant uuid := 'de000000-0000-4000-8000-0000000000a0';
  v_soc      constant uuid := 'de000000-0000-4000-8000-0000000000a9';
  v_aut      constant uuid := 'de000000-0000-4000-8000-0000000000b9';
  v_admin    constant uuid := 'e298629b-9d34-4d62-9a00-ff7c3fa29a1a';
  v_nombre   text;
  v_con_admin boolean;
begin
  if exists (select 1 from public.accounts where id = v_cuenta) then
    raise notice 'GD: «Gestoría Demo» ya estaba; no se toca.';
    return;
  end if;
  if exists (select 1 from public.accounts where slug = 'gestoria-demo') then
    raise exception 'GD: ya hay otra cuenta con el nombre corto «gestoria-demo».' using errcode = '23505';
  end if;

  v_con_admin := exists (select 1 from auth.users where id = v_admin) and exists (select 1 from public.platform_admins where user_id = v_admin and active);
  insert into public.accounts (id, name, legal_name, slug, status, business_type, product_brand, billing_email, is_demo, tax_advisor_since, tax_advisor_by)
  values (v_cuenta, 'Gestoría Demo', 'Gestoría Demo, S.L.', 'gestoria-demo', 'active', 'otra_actividad', 'sumied',
          'demo@example.com', true, now(), case when v_con_admin then v_admin end);
  insert into public.feature_flags (account_id, feature_key, enabled, source, grant_reason)
  values (v_cuenta, 'conta', true, 'manual_grant', 'GD: cuenta de demostración de Gestoría (QBO y congreso del 17/11).');

  insert into public.company (id, account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind,
    fiscal_street_type, fiscal_street, fiscal_number, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country,
    setup_step, setup_completed_at, is_hospitality, sector)
  values
    (v_soc, v_cuenta, 'Gestoría Demo, S.L.', 'Gestoría Demo', 'B00001008', 'nif_es', 'company',
     'Calle', 'Mayor', '1', '28001', 'Madrid', 'Madrid', 'ES', 'hecho', now(), false, 'gestoria'),
    (v_aut, v_cuenta, 'Elena Campos Ortiz', 'Elena Campos Asesora', '00001000B', 'nif_es', 'self_employed',
     'Calle', 'Mayor', '3', '28001', 'Madrid', 'Madrid', 'ES', 'hecho', now(), false, 'gestoria');
  insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits, tax_forms)
  values (v_soc, v_cuenta, 'pymes', 8, '{}'), (v_aut, v_cuenta, 'pymes', 8, '{}');

  -- Bancos de mentira, del banco 9999 (se ve que son inventados).
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_default)
  values (v_cuenta, v_soc, 'bank', 'Cuenta principal', 'ES4299990001490000000101', '572', true),
         (v_cuenta, v_aut, 'bank', 'Cuenta principal', 'ES5899990001470000000202', '572', true);

  -- Los cambios de tarifa, encendidos en las dos (datos inventados).
  insert into public.conta_gestoria_ajustes (company_id, account_id, cambios_de_tarifa)
  values (v_soc, v_cuenta, true), (v_aut, v_cuenta, true);

  -- El administrador: el superadministrador, si está.
  if v_con_admin then
    select display_name into v_nombre from public.user_profiles where user_id = v_admin and display_name is not null order by created_at limit 1;
    insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
    values (v_admin, v_cuenta, 'admin', true, coalesce(v_nombre, 'Administración'), now(), now());
    raise notice 'GD: creada «Gestoría Demo» con sus dos empresas; administrador, el superadministrador.';
  else
    raise notice 'GD: creada «Gestoría Demo» con sus dos empresas, SIN administrador (el superadministrador no está en esta base).';
  end if;
end $$;
