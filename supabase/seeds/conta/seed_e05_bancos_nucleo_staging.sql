-- ============================================================================
-- E05 · Bancos del núcleo · Lo que prepara su e2e, en su carril. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/conta/e05/bancos.spec.ts. Crea una función que la e2e llama con
-- la sesión de la persona de la cuenta del núcleo (semilla K02, o la de su
-- carril) y que monta, cada vez de nuevo, en su empresa general («Empresa de
-- Ejemplo Núcleo», la que se abre al entrar; NO en la gestoría, donde la e2e del
-- K02 cuenta los movimientos del banco):
--   · un banco propio («Banco E05 <lado>», IBAN del banco 9999) con su 572
--     (57200050 en adelante), para no tocar el de la K02 (sus 14 movimientos los
--     cuentan las e2e del K02 y el K03);
--   · su extracto de octubre de 2026, con saldo;
--   · cinco movimientos: dos seguros (comisión, a la 626, ya marcados), uno
--     probable (la luz, a la 628), uno sin saber (un ingreso) y uno casado solo
--     por Sumied (bank_casar, a la 628): el que se deshace.
-- Las propuestas llevan la versión del motor que le pasa la e2e
-- (MOTOR_BANCOS): con otra, confirmar las vuelve a calcular (como hoy).
--
-- Y da de alta la 62600000 y la 62800000 de esa empresa si no están.
-- Guardas: aborta si al otro lado hay cuentas de producción; solo para la
-- persona de la cuenta del núcleo. Se puede aplicar dos veces (W07): create or replace, y la
-- cuenta con «not exists».
-- ============================================================================

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla E05 ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
end $$;

-- La 626 de la empresa general de la plantilla, si no está (la función la da de alta también en
-- cada carril). Y así la semilla escribe una fila: la medida W07 no sabe medir una que solo crea funciones.
insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
select x.account_id, x.id, 'pymes', '62600000', '626', 'Servicios bancarios y similares', 'template', 'serie'
  from public.company x
 where x.id = 'c0e20000-0000-4000-8000-0000000000e2'
   and not exists (select 1 from public.company_account a where a.company_id = x.id and a.code = '62600000');

create or replace function public.e2e_e05_preparar(p_lado text, p_motor text)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  v_acc uuid; emp uuid; v_banco uuid; v_ca uuid; v_codigo text; v_st uuid; v_m uuid; v_n int;
  v_sello text := upper(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint % 1679616));
  r jsonb := '{}'::jsonb; c record; v_prop jsonb;
begin
  if p_lado is null or p_lado !~ '^[a-z0-9]{1,12}$' then raise exception 'E05 e2e: el lado en minúsculas.'; end if;
  if coalesce(p_motor, '') = '' then raise exception 'E05 e2e: falta la versión del motor.'; end if;
  -- La cuenta del núcleo de quien llama, en la plantilla o en un carril (el segundo grupo es el carril).
  select up.account_id into v_acc from public.user_profiles up
   where up.user_id = auth.uid() and up.role = 'admin' and up.active
     and up.account_id::text ~ '^c0e20000-[0-9a-f]{4}-4000-8000-0000000000e0$'
   order by up.created_at limit 1;
  if v_acc is null then raise exception 'E05 e2e: solo para la persona de la cuenta del núcleo (o la de su carril).' using errcode = '42501'; end if;
  select id into emp from public.company where account_id = v_acc and legal_name = 'Empresa de Ejemplo Núcleo, S.L.';
  if emp is null then raise exception 'E05 e2e: falta la empresa general de la cuenta del núcleo (semilla K02).'; end if;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  select v_acc, emp, 'pymes', x.code, left(x.code, 3), x.name, 'template', 'serie'
    from (values ('62600000', 'Servicios bancarios y similares'), ('62800000', 'Suministros')) x(code, name)
   where not exists (select 1 from public.company_account a where a.company_id = emp and a.code = x.code);

  -- Su banco y su 572, cada vez otro.
  select 50 + count(*) into v_n from public.company_account where company_id = emp and code ~ '^57200[0-9]{3}$' and code >= '57200050';
  v_codigo := '57200' || lpad(v_n::text, 3, '0');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (v_acc, emp, 'pymes', v_codigo, '572', 'Banco E05 ' || p_lado, 'own', 'manual') returning id into v_ca;
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_active)
  values (v_acc, emp, 'bank', 'Banco E05 ' || p_lado, 'ES00' || '9999' || lpad(v_n::text, 16, '0'), '572', true) returning id into v_banco;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, emp, v_ca, 'bank_account', v_banco::text, 'principal', 'manual');
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, period_from, period_to,
    movements_count, new_count, repeated_count, continuity, opening_balance, closing_balance, balanced, imported_by_name)
  values (v_acc, emp, v_banco, 'fichero', 'n43', 'extracto-e05.n43', date '2026-10-01', date '2026-10-31', 5, 5, 0, 'primero', 1000, 1214.10, true, 'Prueba e2e E05')
  returning id into v_st;

  for c in select * from (values
      ('seguro1', date '2026-10-06', -12.50::numeric, 'COMISION MANTENIMIENTO CUENTA', 'Comisión de mantenimiento', 'seguro', '62600000'),
      ('seguro2', date '2026-10-13', -8.40::numeric, 'COMISION TRANSFERENCIA', 'Comisión de transferencia', 'seguro', '62600000'),
      ('probable', date '2026-10-20', -45.00::numeric, 'RECIBO ELECTRICIDAD EJEMPLO', 'Electricidad Ejemplo', 'probable', '62800000'),
      ('aclarar', date '2026-10-24', 300.00::numeric, 'INGRESO EFECTIVO', 'Ingreso efectivo', null, null),
      ('casado', date '2026-10-27', -20.00::numeric, 'RECIBO AGUA EJEMPLO', 'Agua Ejemplo', 'seguro', '62800000')) t(caso, fecha, importe, banco, limpio, confianza, cuenta) loop
    v_prop := case when c.cuenta is null then null else jsonb_build_object(
      'que', case when c.cuenta = '62600000' then 'Es una comisión del banco.' else 'Es la luz o el agua.' end,
      'destino', jsonb_build_object('tipo', 'cuenta', 'concepto', c.limpio, 'lineas', jsonb_build_array(jsonb_build_object('cuenta', c.cuenta, 'importe', abs(c.importe)))),
      'preseleccionar', c.confianza = 'seguro', 'motor', p_motor) end;
    insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount,
      bank_concept, clean_concept, fingerprint, soft_fingerprint, status, confidence, reason, proposal)
    values (v_acc, emp, v_banco, v_st, c.fecha, c.fecha, c.importe, c.banco, c.limpio,
      format('e05-%s-%s-%s', p_lado, c.caso, v_sello), format('e05-suave-%s-%s-%s', p_lado, c.caso, v_sello),
      case when c.cuenta is null then 'por_aclarar' else 'propuesto' end, c.confianza,
      case when c.cuenta is null then 'No sé qué es: un ingreso en efectivo sin nada que lo nombre.'
           when c.confianza = 'seguro' then 'Mismo texto que las comisiones de siempre.' else 'El texto se parece al de la luz de otros meses.' end,
      v_prop)
    returning id into v_m;
    if c.caso = 'casado' then
      perform public.bank_casar(v_m, v_prop->'destino', 'seguro', 'Casado solo: el agua de todos los meses.', '[]'::jsonb, 'folvy', null);
    end if;
    r := r || jsonb_build_object(c.caso, v_m);
  end loop;
  return jsonb_build_object('cuenta', v_acc, 'empresa', emp, 'banco', v_banco, 'cuenta572', v_codigo, 'movs', r);
end $function$;
comment on function public.e2e_e05_preparar(text, text) is 'SOLO STAGING (semilla E05): un banco con su extracto y cinco movimientos (seguros, probable, sin saber, casado) en la empresa general de la cuenta del núcleo, para su e2e.';
revoke all on function public.e2e_e05_preparar(text, text) from public, anon;
grant execute on function public.e2e_e05_preparar(text, text) to authenticated;
