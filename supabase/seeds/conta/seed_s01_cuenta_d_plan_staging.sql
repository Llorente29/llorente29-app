-- ============================================================================
-- S01 · «Asesoría de Prueba Oeste, S.L.» (la cuenta D, sin hostelería) con su
-- plan COMPLETO, como lo deja el alta. SOLO STAGING.
--
-- La semilla de la cuenta D (seed_s01_cuenta_d_sin_hosteleria_staging.sql) le
-- dejó el plan elegido (pymes, 8 dígitos) y UNA cuenta, la del banco. El agente
-- «Plan contable» cuenta, con razón, 615 cuentas de serie que le faltan y 6
-- tipos de IVA sin su cuenta (soportado y repercutido de 21, 10 y 4 %): lo
-- mismo que pasó con la empresa de Diez y arregló seed_c06b_diez_plan_staging.sql.
--
-- Lo mismo y por la misma puerta que el alta, sin copiar su lógica:
--   1. company_chart_activate(empresa), como su administrador (el de la semilla
--      de D, que ya existe): las hojas de serie, las subcuentas de IVA por tipo
--      vigente y sus enlaces, retenciones y tipos de gasto. Esa función exige un
--      plan sin ninguna cuenta: la 57200001 de la semilla —sin ningún apunte ni
--      enlace— se aparta antes y vuelve después, como la deja el paso del banco.
--   2. Comprueba lo que el agente pedía: 0 hojas de serie sin su cuenta y todos
--      los tipos de IVA vigentes con soportado y repercutido.
--
-- Se puede volver a aplicar: con el plan ya activado (más de una cuenta), no
-- hace nada. Nada real: la empresa es inventada.
-- ============================================================================

do $$
declare
  d_cuenta  constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  d_user    constant uuid := 'c01d0000-0000-4000-8000-0000000000d1';
  d_empresa constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_banco record; r jsonb; n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla S01 plan de D ABORTADA: al otro lado hay cuentas de producción.';
  end if;
  if not exists (select 1 from public.company where id = d_empresa and account_id = d_cuenta) then
    raise exception 'Semilla S01 plan de D: falta la empresa de la semilla de D (seed_s01_cuenta_d_sin_hosteleria_staging.sql). Aplícala antes.';
  end if;
  if (select count(*) from public.company_account where company_id = d_empresa) > 1 then
    raise notice 'Semilla S01 plan de D: el plan ya estaba activado (% cuentas). No se toca nada.', (select count(*) from public.company_account where company_id = d_empresa);
    return;
  end if;
  -- Solo la cuenta del banco de la semilla de D, y sin apuntes ni enlaces: es lo único que se aparta.
  select * into v_banco from public.company_account where company_id = d_empresa;
  if v_banco.id is not null and (v_banco.code <> '57200001' or exists (select 1 from public.journal_line l where l.company_account_id = v_banco.id)
     or exists (select 1 from public.company_account_link k where k.company_account_id = v_banco.id)) then
    raise exception 'Semilla S01 plan de D: la cuenta que hay (%) no es la del banco de la semilla sin usar. No se toca nada.', v_banco.code;
  end if;
  delete from public.company_account where id = v_banco.id;

  -- Por la puerta del alta, como el administrador de D.
  perform set_config('request.jwt.claims', json_build_object('sub', d_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', d_user::text, true);
  r := public.company_chart_activate(d_empresa, false, 'Folvy (semilla S01)');
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- El banco, como lo deja el paso del banco del alta.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (d_cuenta, d_empresa, 'pymes', '57200001', '572', 'Bancos · Cuenta principal', 'own', 'serie');

  -- Lo que pedía el agente.
  select count(*) into n from public.pgc_account a
   where a.plan = 'pymes' and a.is_leaf and a.valid_to is null
     and not exists (select 1 from public.company_account c where c.company_id = d_empresa and c.template_code = a.code);
  if n <> 0 then raise exception 'Semilla S01 plan de D: siguen faltando % hojas de serie.', n; end if;
  select count(*) into n from public.tax_rate t
   where t.tax_system = 'iva' and t.treatment = 'taxed' and t.rate > 0 and (t.valid_to is null or t.valid_to >= current_date) and t.is_system
     and (select count(distinct k.role) from public.company_account_link k
           where k.company_id = d_empresa and k.entity = 'tax_rate' and k.entity_id = t.id::text and k.role in ('soportado', 'repercutido')) < 2;
  if n <> 0 then raise exception 'Semilla S01 plan de D: % tipos de IVA siguen sin soportado y repercutido.', n; end if;
  raise notice 'Semilla S01 plan de D OK: % cuentas de serie, % subcuentas de IVA, % enlaces; el banco 57200001 de vuelta; 0 hojas sin cuenta y 0 tipos sin sus dos cuentas.',
    r ->> 'cuentas', r ->> 'subcuentas', r ->> 'enlaces';
end $$;
