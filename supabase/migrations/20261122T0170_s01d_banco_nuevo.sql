-- supabase/migrations/20261122T0170_s01d_banco_nuevo.sql
--
-- S01d · DAR DE ALTA UN BANCO QUE AÚN NO ESTÁ EN EL PLAN (encargo S01b, 18/10:
-- «salir del círculo de "Dar de alta un banco"»). Hasta hoy un banco solo se
-- daba de alta desde una subcuenta 572 del plan que aún no tuviera banco; y
-- esas subcuentas solo las crea la activación del plan, una por banco que ya
-- existía. Sin ningún banco, la lista estaba vacía y todos los enlaces
-- mandaban otra vez a Cuentas y extractos: un círculo.
--
--   bank_cuenta_nueva(empresa, tipo, nombre, IBAN, local, común, quién)
--     Crea la subcuenta siguiente de 572 («Bancos · <nombre>», como la
--     activación del plan) y da de alta el banco enlazado a ella con
--     bank_cuenta_alta, en la misma transacción. Si la empresa aún no tiene el
--     plan activado, da de alta el banco sin subcuenta: la activación se la
--     crea después, como a todos. Devuelve el banco y la subcuenta, para que la
--     pantalla diga lo que ha hecho (regla 8).
--
-- Solo AÑADE una función: bank_cuenta_alta y company_account_siguiente no cambian.
-- Vuelta atrás: supabase/vuelta-atras/20261122T0170_s01d_banco_nuevo.down.sql
-- ============================================================================

create function public.bank_cuenta_nueva(p_company uuid, p_kind text, p_nombre text, p_iban text,
                                         p_local uuid, p_comun boolean, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public._bank_cuenta_de_empresa(p_company);
  v_plan text; v_d int; v_code text; v_id uuid; v_banco uuid;
begin
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Escribe el nombre del banco o de la tarjeta.' using errcode = '23514';
  end if;
  -- (_bank_cuenta_de_empresa ya ha comprobado que es un administrador o un encargado de la cuenta.)
  -- Sin plan activado: el banco, sin subcuenta (la activación la crea después).
  select a.plan into v_plan from public.company_account a where a.company_id = p_company and a.account_id = v_cuenta limit 1;
  if v_plan is null then
    v_banco := public.bank_cuenta_alta(p_company, p_kind, p_nombre, p_iban, null, p_local, p_comun);
    return jsonb_build_object('banco', v_banco, 'cuenta', null,
      'porque', 'El plan contable de la empresa aún no está activado: al activarlo, el banco tendrá su subcuenta 572.');
  end if;
  select p.account_digits into v_d from public.company_tax_profile p where p.company_id = p_company;
  v_code := public.company_account_siguiente(p_company, '572', coalesce(v_d, 8));
  if v_code is null then
    raise exception 'No queda numeración libre en 572 para un banco más.' using errcode = '23514';
  end if;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by, created_by_name)
  values (v_cuenta, p_company, v_plan, v_code, '572', 'Bancos · ' || trim(p_nombre), 'own', 'manual', auth.uid(), p_quien_nombre)
  returning id into v_id;
  v_banco := public.bank_cuenta_alta(p_company, p_kind, p_nombre, p_iban, v_code, p_local, p_comun);
  return jsonb_build_object('banco', v_banco, 'cuenta', v_code, 'cuenta_id', v_id,
    'porque', format('Nueva subcuenta %s · Bancos · %s, enlazada al banco.', v_code, trim(p_nombre)));
end $$;
comment on function public.bank_cuenta_nueva(uuid, text, text, text, uuid, boolean, text) is
  'S01d · Da de alta un banco que aún no está en el plan: crea su subcuenta 572 siguiente y lo enlaza (o, sin plan activado, el banco solo). Sale del círculo de «Dar de alta un banco».';
revoke all on function public.bank_cuenta_nueva(uuid, text, text, text, uuid, boolean, text) from public, anon;
grant execute on function public.bank_cuenta_nueva(uuid, text, text, text, uuid, boolean, text) to authenticated;
