-- ============================================================================
-- C06b · «Comercio de Prueba Diez, S.L.» con su plan COMPLETO, como lo deja el
-- alta. SOLO STAGING. Respuesta 5 de Julio, punto 4.
--
-- La semilla del C06 (seed_c06_diez_staging.sql) le dejó el plan elegido
-- (pymes, 8 dígitos) y UNA cuenta, la del banco. El agente «Plan contable»
-- cuenta, con razón, 615 cuentas de serie que le faltan y 6 tipos de IVA sin
-- su cuenta (soportado y repercutido de 21, 10 y 4 %).
--
-- Lo que hace, por la misma puerta que el alta, sin copiar su lógica:
--   1. company_chart_activate(empresa) —la función con la que el alta activa
--      el plan—: las hojas de serie, las subcuentas de IVA por tipo vigente y
--      sus enlaces, retenciones y tipos de gasto. Esa función exige un
--      administrador de la cuenta y un plan sin ninguna cuenta: para eso, un
--      administrador que SOLO existe dentro de esta transacción (se crea y se
--      borra aquí; nadie entra en la empresa, como dice la semilla del C06), y
--      la 57200001 que puso esa semilla —mía, sin ningún apunte— se aparta
--      antes y vuelve después, igual que la deja el paso del banco del alta.
--   2. Comprueba lo que el agente pedía: 0 hojas de serie sin su cuenta y
--      todos los tipos de IVA vigentes con soportado y repercutido.
--
-- Se puede volver a aplicar: con el plan ya activado (más de una cuenta), no
-- hace nada. Nada real: la empresa y el usuario de un rato son inventados.
-- ============================================================================

do $$
declare
  v_cuenta  constant uuid := 'c0600000-0000-4000-8000-0000000000d0';
  v_empresa constant uuid := 'c0600000-0000-4000-8000-0000000000d1';
  v_admin   constant uuid := 'c06b0000-0000-4000-8000-0000000000d9';
  v_banco record; r jsonb; n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla C06b plan ABORTADA: al otro lado hay cuentas de producción.';
  end if;
  if not exists (select 1 from public.company where id = v_empresa and account_id = v_cuenta) then
    raise exception 'Semilla C06b plan: falta la empresa de la semilla C06 (seed_c06_diez_staging.sql). Aplícala antes.';
  end if;
  if (select count(*) from public.company_account where company_id = v_empresa) > 1 then
    raise notice 'Semilla C06b plan: el plan ya estaba activado (% cuentas). No se toca nada.', (select count(*) from public.company_account where company_id = v_empresa);
    return;
  end if;
  -- Solo la cuenta del banco de la semilla C06, y sin apuntes: es lo único que se aparta.
  select * into v_banco from public.company_account where company_id = v_empresa;
  if v_banco.id is not null and (v_banco.code <> '57200001' or exists (select 1 from public.journal_line l where l.company_account_id = v_banco.id)
     or exists (select 1 from public.company_account_link k where k.company_account_id = v_banco.id)) then
    raise exception 'Semilla C06b plan: la cuenta que hay (%) no es la del banco de la semilla C06 sin usar. No se toca nada.', v_banco.code;
  end if;
  delete from public.company_account where id = v_banco.id;

  -- Un administrador de un rato, para entrar por la puerta del alta.
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated', 'plan.semilla@c06b-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (v_admin, v_cuenta, 'admin', true, 'Semilla C06b', now(), now());
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  r := public.company_chart_activate(v_empresa, false, 'Folvy (semilla C06b)');

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.user_profiles where user_id = v_admin;
  delete from auth.users where id = v_admin;

  -- El banco, como lo deja el paso del banco del alta.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (v_cuenta, v_empresa, 'pymes', '57200001', '572', 'Bancos · Cuenta principal', 'own', 'serie');

  -- Lo que pedía el agente.
  select count(*) into n from public.pgc_account a
   where a.plan = 'pymes' and a.is_leaf and a.valid_to is null
     and not exists (select 1 from public.company_account c where c.company_id = v_empresa and c.template_code = a.code);
  if n <> 0 then raise exception 'Semilla C06b plan: siguen faltando % hojas de serie.', n; end if;
  select count(*) into n from public.tax_rate t
   where t.tax_system = 'iva' and t.treatment = 'taxed' and t.rate > 0 and (t.valid_to is null or t.valid_to >= current_date) and t.is_system
     and (select count(distinct k.role) from public.company_account_link k
           where k.company_id = v_empresa and k.entity = 'tax_rate' and k.entity_id = t.id::text and k.role in ('soportado', 'repercutido')) < 2;
  if n <> 0 then raise exception 'Semilla C06b plan: % tipos de IVA siguen sin soportado y repercutido.', n; end if;
  raise notice 'Semilla C06b plan OK: % cuentas de serie, % subcuentas de IVA, % enlaces; el banco 57200001 de vuelta; 0 hojas sin cuenta y 0 tipos sin sus dos cuentas.',
    r ->> 'cuentas', r ->> 'subcuentas', r ->> 'enlaces';
end $$;
