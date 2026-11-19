-- ============================================================================
-- R08 · Bancos: conciliar en un paso · Lo que prepara su e2e y su prueba. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/conta/r08/conciliar.spec.ts y la prueba de staging del R08. Crea una
-- función que se llama con la sesión de la persona de la cuenta del núcleo (semilla K02, o la
-- de su carril). Hace lo de e2e_e05_preparar (un banco propio con su extracto de octubre, en la
-- empresa general, que cierra en 1.214,10) y le añade noviembre, extracto a extracto (la cadena):
--   · 01–11/11: un ingreso de 6.000,00; cierra en 7.214,10;
--   · 12–16/11: el recibo que el banco NO cobró, el caso del 19/11 sin datos personales: −31,50
--     (Recibo Telefonía Ejemplo), −18,87, −0,30 y +19,17. El banco cierra donde estaba (7.214,10)
--     y la lectura se inventa la apertura (cierre − lo nuevo = 7.245,60): hueco de 31,50. El recibo
--     llega ya apartado («Anulado por el banco: no había saldo»), como lo deja la 2120;
--   · 19/11, en tres extractos que llegan uno detrás de otro (08:00, 09:00 y 10:00), cinco
--     nóminas inventadas («Nómina · Empleada A»…, 6.119,71 entre todas). El último cierra en
--     1.094,39: ése es el saldo del banco.
--   · La cuenta 46500000 «Remuneraciones pendientes de pago», si no está.
-- Guardas: aborta si al otro lado hay cuentas de producción; solo para la persona de la cuenta
-- del núcleo. Se puede aplicar dos veces (W07): create or replace, y la fila de abajo con
-- «not exists».
-- ============================================================================

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla R08 ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
end $$;

-- La misma fila que la semilla E05 (W07: así esta semilla escribe algo).
insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
select x.account_id, x.id, 'pymes', '62600000', '626', 'Servicios bancarios y similares', 'template', 'serie'
  from public.company x
 where x.id = 'c0e20000-0000-4000-8000-0000000000e2'
   and not exists (select 1 from public.company_account a where a.company_id = x.id and a.code = '62600000');

create or replace function public.e2e_r08_preparar(p_lado text, p_motor text)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  r jsonb; v_acc uuid; emp uuid; v_banco uuid; v_st uuid; v_m uuid; c record; x record; e record;
  v_sello text := upper(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint % 1679616));
  movs jsonb := '{}'::jsonb; nominas jsonb := '[]'::jsonb; v_saldo numeric := 1214.10;
begin
  r := public.e2e_e05_preparar(p_lado, p_motor);
  v_acc := (r->>'cuenta')::uuid; emp := (r->>'empresa')::uuid; v_banco := (r->>'banco')::uuid;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  select v_acc, emp, 'pymes', '46500000', '465', 'Remuneraciones pendientes de pago', 'template', 'serie'
   where not exists (select 1 from public.company_account a where a.company_id = emp and a.code = '46500000');

  create temp table if not exists _r08 (n int, caso text, dia date, importe numeric, banco text, limpio text) on commit drop;
  -- Los extractos de noviembre, en la cadena.
  for e in select * from (values
      (1, date '2026-11-01', date '2026-11-11', timestamptz '2026-11-12 03:00:00+01'),
      (2, date '2026-11-12', date '2026-11-16', timestamptz '2026-11-17 03:00:00+01'),
      (3, date '2026-11-19', date '2026-11-19', timestamptz '2026-11-19 08:00:00+01'),
      (4, date '2026-11-19', date '2026-11-19', timestamptz '2026-11-19 09:00:00+01'),
      (5, date '2026-11-19', date '2026-11-19', timestamptz '2026-11-19 10:00:00+01')) t(n, desde, hasta, llego) loop
    -- Lo que trae cada uno: (caso, día, importe, lo que dice el banco). «truncate», no «delete» sin
    -- «where»: staging no lo deja (safeupdate; e2e 44607984575).
    truncate _r08;
    insert into _r08 select * from (values
      (1, 'ingreso', date '2026-11-05', 6000.00::numeric, 'TRANSFERENCIA RECIBIDA CLIENTE EJEMPLO', 'Cliente Ejemplo'),
      (2, 'telefonia', date '2026-11-12', -31.50, 'RECIBO TELEFONIA EJEMPLO', 'Recibo Telefonía Ejemplo'),
      (2, 'gasto1', date '2026-11-13', -18.87, 'COMPRA TARJETA PAPELERIA EJEMPLO', 'Papelería Ejemplo'),
      (2, 'gasto2', date '2026-11-14', -0.30, 'COMISION PAGO TARJETA', 'Comisión pago tarjeta'),
      (2, 'devolucion', date '2026-11-16', 19.17, 'DEVOLUCION PAPELERIA EJEMPLO', 'Devolución Papelería Ejemplo'),
      (3, 'nomina1', date '2026-11-19', -1012.06, 'TRANSFERENCIA NOMINA EMPLEADA A', 'Nómina · Empleada A'),
      (3, 'nomina2', date '2026-11-19', -1231.86, 'TRANSFERENCIA NOMINA EMPLEADO B', 'Nómina · Empleado B'),
      (4, 'nomina3', date '2026-11-19', -1126.42, 'TRANSFERENCIA NOMINA EMPLEADA C', 'Nómina · Empleada C'),
      (4, 'nomina4', date '2026-11-19', -1434.43, 'TRANSFERENCIA NOMINA EMPLEADA D', 'Nómina · Empleada D'),
      (5, 'nomina5', date '2026-11-19', -1314.94, 'TRANSFERENCIA NOMINA EMPLEADA E', 'Nómina · Empleada E')) v(n, caso, dia, importe, banco, limpio)
     where v.n = e.n;
    -- El cierre: lo que de verdad hay en el banco (el recibo de telefonía no se cobró).
    select v_saldo + coalesce(sum(importe) filter (where caso <> 'telefonia'), 0) as cierre, coalesce(sum(importe), 0) as nuevo, count(*) as cuantos into x from _r08;
    insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, period_from, period_to,
      movements_count, new_count, repeated_count, continuity, continuity_gap, opening_balance, closing_balance, balanced, imported_at, imported_by_name)
    values (v_acc, emp, v_banco, 'agregador:prueba', 'agregador:prueba', format('Banco de prueba · del %s al %s · %s', e.desde, e.hasta, e.n), e.desde, e.hasta,
      x.cuantos, x.cuantos, 0, case when x.cierre - x.nuevo = v_saldo then 'sigue' else 'hueco' end,
      case when x.cierre - x.nuevo = v_saldo then null else (x.cierre - x.nuevo) - v_saldo end,
      x.cierre - x.nuevo, x.cierre, true, e.llego, 'Prueba e2e R08')
    returning id into v_st;
    for c in select * from _r08 order by dia, importe loop
      insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount,
        bank_concept, clean_concept, fingerprint, soft_fingerprint, status, reason, ignored_reason)
      values (v_acc, emp, v_banco, v_st, c.dia, c.dia, c.importe, c.banco, c.limpio,
        format('r08-%s-%s-%s', p_lado, c.caso, v_sello), format('r08-suave-%s-%s-%s', p_lado, c.caso, v_sello),
        -- El recibo que el banco no cobró, ya apartado como lo deja bank_apartar_no_cobrados (2120): la e2e
        -- de la rama corre contra staging sin la 2120 (lo que cambia una función no va de verdad desde una rama).
        case when c.caso = 'telefonia' then 'ignorado' else 'por_aclarar' end, 'No sé qué es.',
        case when c.caso = 'telefonia' then 'Anulado por el banco: no había saldo' end)
      returning id into v_m;
      movs := movs || jsonb_build_object(c.caso, v_m);
      if c.caso like 'nomina%' then nominas := nominas || to_jsonb(v_m); end if;
    end loop;
    v_saldo := x.cierre;
  end loop;
  return r || jsonb_build_object('noviembre', movs, 'nominas', nominas, 'saldoBanco', v_saldo);
end $function$;
comment on function public.e2e_r08_preparar(text, text) is 'SOLO STAGING (semilla R08): lo de e2e_e05_preparar y noviembre en cinco extractos: un recibo que el banco no cobró y cinco nóminas el 19/11, para su e2e y su prueba.';
revoke all on function public.e2e_r08_preparar(text, text) from public, anon;
grant execute on function public.e2e_r08_preparar(text, text) to authenticated;
