-- ============================================================================
-- C06 · Una empresa INVENTADA del frente C con su base de Diez: la C0009 (la
-- copia de pruebas). SOLO STAGING. Para la prueba del traer de Diez
-- generalizado: el workflow lee la base de ESTA tabla (no del código) y lee la
-- C0009 solo con GET; nada de lo que lee se escribe en staging.
--
--   «Comercio de Prueba Diez, S.L.» · cuenta solo de contabilidad (marca de
--   pruebas), otra actividad, sin usuarios: nadie entra en ella. Con su plan
--   elegido (pymes, 8 dígitos), como queda una empresa tras el alta.
--
-- La base la pone Folvy por la puerta de verdad (conta_diez_base_poner). Se
-- puede volver a aplicar: lo que ya está se deja.
-- ============================================================================

do $$
declare
  v_cuenta  constant uuid := 'c0600000-0000-4000-8000-0000000000d0';
  v_empresa constant uuid := 'c0600000-0000-4000-8000-0000000000d1';
  r jsonb;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla C06 Diez ABORTADA: al otro lado hay cuentas de producción.';
  end if;
  if not exists (select 1 from public.accounts where id = v_cuenta) then
    insert into public.accounts (id, name, slug, status, business_type, product_brand)
    values (v_cuenta, 'Comercio de Prueba Diez', 'c06-comercio-prueba-diez', 'active', 'otra_actividad', 'contabilidad');
  end if;
  if not exists (select 1 from public.company where id = v_empresa) then
    insert into public.company (id, account_id, legal_name, tax_id, tax_id_type, entity_kind, setup_step)
    values (v_empresa, v_cuenta, 'Comercio de Prueba Diez, S.L.', 'B12345674', 'nif_es', 'company', 'hecho');
  end if;
  -- El alta, terminada (respuesta 3: el paso 1 de los cuatro antes de traer de Diez).
  update public.company set setup_completed_at = now() where id = v_empresa and setup_completed_at is null;
  -- Lo que una empresa de verdad tiene tras el alta y el importador necesita:
  -- su plan elegido (pymes, 8 dígitos, como Diez).
  if not exists (select 1 from public.company_tax_profile where company_id = v_empresa) then
    insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits, tax_forms)
    values (v_empresa, v_cuenta, 'pymes', 8, array['303', '347', '390']);
  end if;
  -- Y su cuenta de banco, como la deja el alta («Bancos · Cuenta principal»):
  -- los datos del Diez simulado la traen SIN nombre, y el importador no
  -- inventa nombres (la rechaza si no la encuentra ya en el plan).
  if not exists (select 1 from public.company_account where company_id = v_empresa and code = '57200001') then
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    values (v_cuenta, v_empresa, 'pymes', '57200001', '572', 'Bancos · Cuenta principal', 'own', 'serie');
  end if;
  r := public.conta_diez_base_poner(v_empresa, 'C0009', 'Prueba del traer de Diez generalizado (C06): la copia de pruebas, solo lectura.', 'Folvy (semilla C06)');
  raise notice 'Semilla C06 Diez OK: % con la base % (%).', v_empresa, r ->> 'base', case when (r ->> 'cambia')::boolean then 'nueva' else 'ya estaba' end;
end $$;
