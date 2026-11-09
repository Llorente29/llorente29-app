-- supabase/migrations/20261109T1300_gd_contabilidad_demo.sql
--
-- GD · La contabilidad de «Gestoría Demo» (Julio, nº37: la necesita Code 1 para
-- medir la pantalla y para la T5). Hoy sus dos empresas no tienen plan (0
-- subcuentas), ni actividad, ni ejercicio 2026, y la sociedad no tiene modelos
-- (el agente «Datos maestros» ya la marca: «sociedad fuera del SII sin el 347»).
--
--   demo_gestoria_contabilidad_sembrar(cuenta): SOLO cuentas de demostración y
--   SOLO la plataforma. Como el administrador de la cuenta, por los caminos de
--   la app (como Casa Lola), y repetible: lo que ya está se deja, lo que falta
--   se pone, y lo que es de la demo se pone como el primer día. En las dos
--   empresas (Gestoría Demo, S.L. y Elena Campos Ortiz, autónoma):
--     · el perfil fiscal: península, IVA trimestral, plan de pymes de 8 cifras y
--       los modelos de QBO (la sociedad: 111, 115, 180, 190, 200, 202, 303, 347
--       y 390; la autónoma: 111, 130, 190, 303 y 390);
--     · la actividad (IAE 1_842 la sociedad y 2_722 la autónoma; CNAE 6920) y,
--       en la sociedad, lo que piden el 200 y el depósito (inventado, T11);
--     · el ejercicio 2026, abierto;
--     · el plan («Activar el plan», company_chart_activate): trae de serie la
--       57200000, la 70500000 y la 47700021 (la del IVA al 21 %);
--     · la serie «1» de facturas: en la sociedad con el formato de QBO
--       ({año}/{serie}/{número}) desde la 2026/1/141; en la autónoma, desde la 1;
--     · los ajustes de cobro del G05: el código de cliente «lo pone Sumied», la
--       serie «1» y las cuentas de banco, ingresos e IVA.
--   Y en la sociedad, las subcuentas de GoCardless con el código de QBO:
--   57200002 «Plataforma GoCardless», 40000015 «GoCardless» y 62900007
--   «Comisiones de GoCardless». «Añadir subcuenta» (company_account_add) coge
--   la siguiente libre y no deja elegir el código: estas tres se crean con su
--   código, con los mismos campos y la misma línea en el registro del plan que
--   ella. Las 430 de cada cliente las crea el cobro.
--
-- Después la llama para «Gestoría Demo». Si no está o no tiene administrador,
-- no hace nada y lo dice. Solo toca la cuenta demo (regla 9). No hace asientos:
-- el agente «Libro diario» no tiene nada nuevo que mirar.
-- Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261109T1300_gd_contabilidad_demo.down.sql

create or replace function public.demo_gestoria_contabilidad_sembrar(p_cuenta uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_activa text := current_setting('folvy.cuenta_activa', true);
  v_admin uuid; v_quien text; v_soc uuid; v_aut uuid; v_emp uuid; v_plan text; v_hechas text[] := '{}'; r record;
begin
  if not exists (select 1 from public.accounts where id = p_cuenta and is_demo is true) then
    raise exception 'GD: % no es una cuenta de demostración: no se siembra nada.', p_cuenta using errcode = '42501';
  end if;
  select user_id, display_name into v_admin, v_quien from public.user_profiles where account_id = p_cuenta and role = 'admin' and active order by created_at limit 1;
  if v_admin is null then return jsonb_build_object('frase', 'La cuenta demo no tiene administrador: no se siembra la contabilidad.'); end if;
  select id into v_soc from public.company where account_id = p_cuenta and sector = 'gestoria' and entity_kind = 'company' order by created_at, id limit 1;
  select id into v_aut from public.company where account_id = p_cuenta and sector = 'gestoria' and entity_kind = 'self_employed' order by created_at, id limit 1;
  if v_soc is null then return jsonb_build_object('frase', 'La cuenta demo no tiene una sociedad de Gestoría: no se siembra la contabilidad.'); end if;

  -- Como el administrador de la cuenta, en la cuenta abierta (DM1: «usuario:cuenta»).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_admin::text || ':' || p_cuenta::text, true);

  -- 1 · Lo que piden el 200 y el depósito, en la sociedad (inventado y que se ve inventado, T11).
  update public.company set legal_form_code = 'nif_b', incorporated_on = date '2018-03-01', registry_name = 'Registro Mercantil de Madrid',
         registry_volume = '00000', registry_folio = '1', registry_sheet = 'M-000000', registry_entry = '1',
         phone = '900000000', email = 'contabilidad@example.com', dehu_email = 'notificaciones@example.com'
   where id = v_soc and account_id = p_cuenta;
  if not exists (select 1 from public.company_person where company_id = v_soc and account_id = p_cuenta) then
    insert into public.company_person (account_id, company_id, full_name, tax_id, roles, ownership_pct, started_on, signs_accounts, created_by)
    values (p_cuenta, v_soc, 'Administración Demo', '00000000T', array['administrator', 'partner'], 100, date '2018-03-01', true, v_admin);
  end if;

  for r in select * from (values
      (v_soc, array['111','115','180','190','200','202','303','347','390'], 'business', '1_842', 'Asesoría fiscal, contable y laboral'),
      (v_aut, array['111','130','190','303','390'], 'professional', '2_722', 'Asesora fiscal y contable')) x(emp, modelos, clase, iae, que)
    where x.emp is not null loop
    v_emp := r.emp;
    -- 2 · El perfil fiscal, como QBO.
    update public.company_tax_profile set tax_territory = 'peninsula_baleares', vat_period = 'quarterly', chart_kind = 'pymes', account_digits = 8,
           tax_forms = r.modelos, sii = false
     where company_id = v_emp and account_id = p_cuenta;
    -- 3 · La actividad (una sola, la de la demo).
    delete from public.company_activity where company_id = v_emp and account_id = p_cuenta;
    insert into public.company_activity (account_id, company_id, kind, iae_code, cnae_version, cnae_code, description, started_on, is_main, created_by)
    values (p_cuenta, v_emp, r.clase, r.iae, '2025', '6920', r.que, date '2018-03-01', true, v_admin);
    -- 4 · El ejercicio 2026, abierto.
    if not exists (select 1 from public.fiscal_year where company_id = v_emp and code = '2026') then
      insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, created_by)
      values (p_cuenta, v_emp, '2026', date '2026-01-01', date '2026-12-31', v_admin);
    end if;
    update public.fiscal_year set status = 'open', closed_at = null, closed_by = null where company_id = v_emp and code = '2026' and account_id = p_cuenta;
    -- 5 · El plan, como «Activar el plan» (si aún no está).
    if not exists (select 1 from public.company_account where company_id = v_emp) then
      perform public.company_chart_activate(v_emp, false, v_quien);
      v_hechas := array_append(v_hechas, 'plan');
    end if;
    -- 6 · La serie «1» de facturas.
    insert into public.invoice_series (account_id, company_id, code, name, doc_type, digits, reset_yearly, starts_at, is_default, is_active, formato, created_by)
    values (p_cuenta, v_emp, '1', 'Facturas de cuotas', 'invoice', 1, true, case when v_emp = v_soc then 141 else 1 end, true, true,
            case when v_emp = v_soc then '{año}/{serie}/{número}' end, v_admin)
    on conflict (company_id, code) do update set name = excluded.name, doc_type = excluded.doc_type, digits = excluded.digits, reset_yearly = excluded.reset_yearly,
      starts_at = excluded.starts_at, is_default = true, is_active = true, formato = excluded.formato;
    -- 7 · Los ajustes de cobro del G05.
    update public.conta_gestoria_ajustes set codigo_cliente_modo = 'sumied', serie_cobro = '1', cuenta_banco = '57200000', cuenta_ingresos = '70500000',
           cuenta_iva = '47700021', cuenta_plataforma = case when v_emp = v_soc then '57200002' end, updated_at = now(), updated_by_name = v_quien
     where company_id = v_emp and account_id = p_cuenta;
  end loop;

  -- 8 · Las subcuentas de GoCardless de la sociedad, con el código de QBO.
  select plan into v_plan from public.company_account where company_id = v_soc limit 1;
  for r in select * from (values ('57200002', '572', 'Plataforma GoCardless', 'Lo que GoCardless ha cobrado y aún no ha ingresado en el banco'),
                                 ('40000015', '4000', 'GoCardless', 'Proveedor: GoCardless'),
                                 ('62900007', '629', 'Comisiones de GoCardless', 'Lo que cobra GoCardless por cada recibo')) x(code, hoja, nombre, claro) loop
    if not exists (select 1 from public.company_account where company_id = v_soc and code = r.code) then
      if not exists (select 1 from public.pgc_account p where p.plan = v_plan and p.code = r.hoja and p.is_leaf and p.valid_to is null) then
        raise exception 'GD: la % no es una cuenta del plan en la que se pueda apuntar.', r.hoja using errcode = '22023';
      end if;
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, source, created_by, created_by_name)
      values (p_cuenta, v_soc, v_plan, r.code, r.hoja, r.nombre, r.claro, 'own', 'manual', v_admin, v_quien);
      insert into public.company_account_log (account_id, company_id, que, code, detalle, despues, source, done_by, done_by_name)
      values (p_cuenta, v_soc, 'subcuenta_creada', r.code, format('Subcuenta %s · %s, bajo la %s.', r.code, r.nombre, r.hoja),
              jsonb_build_object('code', r.code, 'name', r.nombre), 'manual', v_admin, v_quien);
      v_hechas := array_append(v_hechas, r.code::text);
    end if;
  end loop;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  return jsonb_build_object('frase', format(
    'Contabilidad de la demo al día: actividad, ejercicio 2026 abierto, modelos, serie «1» (la sociedad, desde la 2026/1/141) y ajustes de cobro en las dos empresas; %s.',
    case when cardinality(v_hechas) = 0 then 'el plan y sus subcuentas ya estaban' else 'hecho ahora: ' || array_to_string(v_hechas, ', ') end));
end $$;
comment on function public.demo_gestoria_contabilidad_sembrar(uuid) is
  'GD · Siembra (o pone al día) la contabilidad de una cuenta de demostración de Gestoría: perfil fiscal, actividad, ejercicio 2026, plan de 8 cifras con las subcuentas de GoCardless de QBO, serie y ajustes de cobro. Solo cuentas demo; solo la llama la plataforma.';
revoke all on function public.demo_gestoria_contabilidad_sembrar(uuid) from public, anon, authenticated;
grant execute on function public.demo_gestoria_contabilidad_sembrar(uuid) to service_role;

do $$
declare v jsonb;
begin
  if not exists (select 1 from public.accounts where id = 'de000000-0000-4000-8000-0000000000a0' and is_demo) then
    raise notice 'GD: no está «Gestoría Demo»: no se siembra la contabilidad.';
    return;
  end if;
  v := public.demo_gestoria_contabilidad_sembrar('de000000-0000-4000-8000-0000000000a0');
  raise notice 'GD: %', v->>'frase';
end $$;
