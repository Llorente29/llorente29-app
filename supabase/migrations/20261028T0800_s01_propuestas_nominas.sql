-- supabase/migrations/20261028T0800_s01_propuestas_nominas.sql
--
-- S01 · PR 3 · Entrega 5 · ORIGEN 1 DE 5: LAS NÓMINAS (payroll).
-- Se proponen solas al llegar el resumen de la gestoría (al entrar en
-- payroll_summary) y en la pasada de noche. Se quedan en Asientos hasta Laboral
-- (encargo PC01, entrega 5, punto 6).
--
-- cambia: public.payroll_summary · prueba: supabase/staging/sql/20261028_s01_propuestas_nominas_prueba.sql
--
-- Añade, y pone un disparador nuevo en payroll_summary (0 filas en producción;
-- nadie la escribe hoy):
--   1. conta_propuesta_nomina(nómina): la regla de nomina() del navegador
--      (lib/asientosPropuestos.ts), en SQL puro, que solo lee. Devuelve la
--      propuesta con la forma de aJson ({entrada, lineas}) o {sin_propuesta,
--      que}. Una diferencia a propósito, dicha en el parte: el tipo de
--      retención es el de código «trabajo» del 111; el navegador cogía el
--      primero del 111 que le llegara (hoy en producción: administradores,
--      profesional o profesional en inicio). Sin él, lo dice («Falta el tipo de
--      retención de trabajo…»), que es lo que el navegador quería decir.
--   2. conta_proponer_nominas(empresa, desde, hasta, quién): propone las de
--      un rango (la llama el navegador, la pasada de noche y el disparador),
--      con su «no he podido» en conta_propuesta_pendiente. Como hoy, se
--      propone y no se valida sola (solo las ventas y las recibidas seguras se
--      validan solas).
--   3. El disparador de payroll_summary: una nómina que llega se propone sola.
--
-- Medido en producción el 28/10, solo lectura: 0 nóminas (payroll_summary
-- vacía en todas las cuentas) y ningún tipo de retención «trabajo». La regla
-- se compara con la del navegador sobre las nóminas que hay: las de la semilla
-- de staging (seed_c04_staging.sql); con Foodint no hay población (regla 31:
-- dicho en el parte).

create or replace function public.conta_propuesta_nomina(p_payroll uuid)
returns jsonb language sql stable set search_path = public as $$
  with n as (
    select ps.*, (date_trunc('month', ps.period_month) + interval '1 month - 1 day')::date as fin,
           to_char(ps.period_month, 'MM/YYYY') as mes
      from public.payroll_summary ps where ps.id = p_payroll
  ), c as (
    select n.*,
      coalesce((select ca.code from public.company_account ca where ca.company_id = n.company_id and ca.kind = 'template' and ca.status is distinct from 'cerrada' and ca.template_code = '640' order by ca.code limit 1), '64000000') as c_sueldos,
      coalesce((select ca.code from public.company_account ca where ca.company_id = n.company_id and ca.kind = 'template' and ca.status is distinct from 'cerrada' and ca.template_code = '642' order by ca.code limit 1), '64200000') as c_ss_empresa,
      coalesce((select ca.code from public.company_account ca where ca.company_id = n.company_id and ca.kind = 'template' and ca.status is distinct from 'cerrada' and ca.template_code = '476' order by ca.code limit 1), '47600000') as c_ss_acreedora,
      coalesce((select ca.code from public.company_account ca where ca.company_id = n.company_id and ca.kind = 'template' and ca.status is distinct from 'cerrada' and ca.template_code = '4751' order by ca.code limit 1), '47510000') as c_irpf,
      coalesce((select ca.code from public.company_account ca where ca.company_id = n.company_id and ca.kind = 'template' and ca.status is distinct from 'cerrada' and ca.template_code = '465' order by ca.code limit 1), '46500000') as c_remuneraciones,
      (select w.id from public.withholding_rate w where w.filed_in = '111' and w.code = 'trabajo'
          and (w.account_id is null or w.account_id = n.account_id) and (w.company_id is null or w.company_id = n.company_id)
        order by w.company_id nulls last, w.account_id nulls last limit 1) as ret
      from n
  ), l as (
    select c.*, jsonb_build_array(
        jsonb_build_object('cuenta', c_sueldos, 'debe', gross, 'haber', 0),
        jsonb_build_object('cuenta', c_ss_empresa, 'debe', employer_ss, 'haber', 0),
        jsonb_build_object('cuenta', c_ss_acreedora, 'debe', 0, 'haber', round(employer_ss + employee_ss, 2)),
        jsonb_build_object('cuenta', c_irpf, 'debe', 0, 'haber', irpf, 'retencion', jsonb_build_object('tipo_id', ret, 'base', gross, 'modelo', '111')),
        jsonb_build_object('cuenta', c_remuneraciones, 'debe', 0, 'haber', net)) as crudas
      from c
  )
  select case
    when not exists (select 1 from n) then jsonb_build_object('sin_propuesta', 'La nómina no existe.', 'que', 'Nóminas')
    when round(l.gross * 100) <> round(l.employee_ss * 100) + round(l.irpf * 100) + round(l.other_deductions * 100) + round(l.net * 100) then
      jsonb_build_object('que', 'Nóminas de ' || l.mes,
        'sin_propuesta', format('Bruto %s ≠ SS del trabajador + IRPF + otras + líquido: revisa el resumen de la gestoría.', public.conta_euros_exactos(l.gross)))
    when round(l.other_deductions * 100) <> 0 then
      jsonb_build_object('que', 'Nóminas de ' || l.mes, 'sin_propuesta', 'El resumen trae otras deducciones (embargos, anticipos): dime a qué cuenta van antes de proponerla.')
    when round(l.irpf * 100) <> 0 and l.ret is null then
      jsonb_build_object('que', 'Nóminas de ' || l.mes, 'sin_propuesta', 'Falta el tipo de retención de trabajo en Tablas › Retenciones.')
    else jsonb_build_object('que', 'Nóminas de ' || l.mes, 'propuesta', jsonb_build_object(
      'entrada', jsonb_build_object(
        'series', 9, 'fecha', l.fin, 'concepto', 'Nóminas de ' || l.mes, 'source_type', 'payroll', 'source_id', l.id,
        'confianza', case when l.location_id is not null then 'seguro' else 'probable' end,
        'porque', 'El resumen de la gestoría: sueldos y SS de la empresa como gasto; SS, IRPF y líquido como lo que se debe.',
        'razones', jsonb_build_array(jsonb_build_object('decision', format('IRPF %s a la 4751', public.conta_euros_exactos(l.irpf)),
                                                        'porque', 'retenciones de trabajo: van al 111 del trimestre')),
        'party_id', null, 'documento', null),
      'lineas', (select coalesce(jsonb_agg(x.v || jsonb_build_object('concepto', null, 'local_id', l.location_id, 'comun', l.location_id is null,
                                                                    'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null)
                                           || case when x.v ? 'retencion' then '{}'::jsonb else jsonb_build_object('retencion', null) end
                                           order by x.o), '[]'::jsonb)
                   from jsonb_array_elements(l.crudas) with ordinality x(v, o)
                  where round(((x.v->>'debe')::numeric + (x.v->>'haber')::numeric) * 100) > 0
                    and not (x.v ? 'retencion' and round(l.irpf * 100) = 0))))
    end
  from (select 1) uno left join l on true
$$;
comment on function public.conta_propuesta_nomina(uuid) is
  'S01 · PR 3: la regla de una nómina (nomina() del navegador), en SQL puro: {entrada, lineas} como aJson, o {sin_propuesta}. Solo lee.';

create or replace function public.conta_proponer_nominas(p_company uuid, p_desde date, p_hasta date, p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; r record; x jsonb; v_res jsonb;
        v_prop int := 0; v_ya int := 0; v_desc int := 0; v_sin jsonb := '[]'::jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  -- Una persona, solo si administra o encarga la cuenta; desde un disparador propone Sumied.
  if auth.uid() is not null and pg_trigger_depth() = 0 and not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta propone asientos.' using errcode = '42501';
  end if;
  for r in select ps.id from public.payroll_summary ps
            where ps.company_id = p_company and ps.account_id = v_cuenta and ps.entry_id is null
              and ps.period_month >= date_trunc('month', p_desde)::date and ps.period_month <= p_hasta
            order by ps.period_month desc loop
    x := public.conta_propuesta_nomina(r.id);
    if x ? 'sin_propuesta' then
      perform public._conta_no_propuesta(p_company, 'payroll', r.id::text, x->>'que', x->>'sin_propuesta', 'Contabilidad › Asientos');
      v_sin := v_sin || jsonb_build_array(jsonb_build_object('que', x->>'que', 'porque', x->>'sin_propuesta'));
      continue;
    end if;
    if not public.conta_dia_abierto(p_company, (x->'propuesta'->'entrada'->>'fecha')::date) then continue; end if;
    v_res := public._conta_proponer(p_company, x->'propuesta', p_quien);
    if (v_res->>'descartada')::boolean then v_desc := v_desc + 1;
    elsif (v_res->>'existente')::boolean then v_ya := v_ya + 1;
    else v_prop := v_prop + 1; end if;
  end loop;
  return jsonb_build_object('propuestas', v_prop, 'yaEstaban', v_ya, 'descartadas', v_desc, 'sinPropuesta', v_sin);
end $$;
revoke all on function public.conta_proponer_nominas(uuid, date, date, text) from public, anon;
grant execute on function public.conta_proponer_nominas(uuid, date, date, text) to authenticated, service_role;
comment on function public.conta_proponer_nominas(uuid, date, date, text) is
  'S01 · PR 3: propone las nóminas de un rango (navegador, pasada de noche, disparador); lo que no puede, a conta_propuesta_pendiente. No valida.';

-- Una nómina que llega se propone sola (si falla, la nómina entra igual y la pasada de noche lo repite).
create or replace function public.tg_conta_nomina_proponer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.conta_proponer_nominas(new.company_id, new.period_month, (date_trunc('month', new.period_month) + interval '1 month - 1 day')::date, 'Sumied (al llegar de la gestoría)');
  exception when others then
    perform public._conta_no_propuesta(new.company_id, 'payroll', new.id::text, 'Nóminas de ' || to_char(new.period_month, 'MM/YYYY'),
      'No he podido proponerla al llegar: ' || sqlerrm, 'Contabilidad › Asientos');
  end;
  return null;
end $$;
revoke all on function public.tg_conta_nomina_proponer() from public, anon, authenticated;
drop trigger if exists conta_nomina_proponer on public.payroll_summary;
create trigger conta_nomina_proponer after insert on public.payroll_summary
  for each row execute function public.tg_conta_nomina_proponer();
