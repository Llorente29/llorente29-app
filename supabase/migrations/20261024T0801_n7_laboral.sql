-- N7 · Laboral por la puerta (paso 10 de la auditoría C09): el IRPF y la SS del
-- trabajador en payroll_cost, y fuente_nominas_mes_v1, la novena de la puerta.
--
-- SOLO AÑADE:
--   · payroll_cost.irpf y payroll_cost.employee_ss, numeric(14,2), que admiten
--     nulos, con un CHECK (>= 0) que solo mira la columna que añade este
--     fichero. No se rellenan: hoy la nómina leída del correo trae las
--     deducciones juntas (raw→parsed→payslip→deductions_total), sin separar el
--     IRPF de la SS del trabajador. Las rellenará quien las lea por separado
--     (el extractor o el resumen de la gestoría), en otro encargo.
--   · public.fuente_nominas_mes_v1(empresa, mes): el coste de personal del mes,
--     por local. Todavía no la llama nadie.
-- No cambia ninguna función, vista ni pantalla que exista. payroll_cost no está
-- en el camino del pedido.
--
-- El contrato, el de la puerta v1 (N6): SECURITY DEFINER con search_path fijo,
-- comprueba la empresa (para con 42501 si el usuario no puede verla; sin
-- usuario, el servidor, pasa), importes en numeric(14,2). Las comprobaciones
-- de empresa y de locales van dentro, para no depender de fuente__cuenta y
-- fuente__locales, que llegan con el N6 en otro PR.
--
-- Por trabajador y mes, la nómina «definitiva» si la hay; si no, el
-- «borrador» (y se cuenta en «borradores»). ss_trabajador e irpf salen
-- sumados solo si TODAS las nóminas del local los traen; si no, nulos, y
-- desglose_completo = false. «deducciones» es siempre bruto − líquido.
--
-- Ejecutan authenticated y service_role; anon y public, no.
-- Se puede pasar dos veces (add column if not exists, create or replace).
-- Prueba: supabase/staging/sql/20261024_n7_laboral_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261024T0801_n7_laboral.down.sql

alter table public.payroll_cost
  add column if not exists irpf numeric(14,2) check (irpf >= 0),
  add column if not exists employee_ss numeric(14,2) check (employee_ss >= 0);

comment on column public.payroll_cost.irpf is
  'N7 (24/10). Retención de IRPF de la nómina. Nula si no se ha leído por separado.';
comment on column public.payroll_cost.employee_ss is
  'N7 (24/10). Cuota de la Seguridad Social a cargo del trabajador. Nula si no se ha leído por separado.';

create or replace function public.fuente_nominas_mes_v1(p_empresa uuid, p_mes date)
 returns table(local_id uuid, mes date, trabajadores integer, borradores integer,
               bruto numeric(14,2), ss_empresa numeric(14,2), ss_trabajador numeric(14,2),
               irpf numeric(14,2), deducciones numeric(14,2), liquido numeric(14,2),
               coste_total numeric(14,2), desglose_completo boolean)
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare v_cuenta uuid; v_una boolean; v_mes date := date_trunc('month', p_mes)::date; v_locales uuid[];
begin
  if p_mes is null then
    raise exception 'fuente_nominas_mes_v1: falta el mes.' using errcode = '22023';
  end if;
  select c.account_id into v_cuenta from public.company c where c.id = p_empresa;
  if v_cuenta is null then
    raise exception 'La empresa % no existe.', p_empresa using errcode = 'P0002';
  end if;
  if auth.uid() is not null and not public.conta_impuesto_puede_ver(p_empresa) then
    raise exception 'No puedes leer los datos de esa empresa.' using errcode = '42501';
  end if;
  select count(*) = 1 into v_una from public.company c where c.account_id = v_cuenta;

  -- Los locales de la empresa, como fuente__locales (N6).
  if to_regclass('public.location_company') is null then
    select array_agg(l.id) into v_locales from public.locations l where l.account_id = v_cuenta;
  else
    execute
      'select array_agg(l.id) from public.locations l
         left join public.location_company lc on lc.location_id = l.id
        where l.account_id = $1 and (lc.company_id = $2 or (lc.location_id is null and $3))'
      into v_locales using v_cuenta, p_empresa, v_una;
  end if;

  return query
    with n as (
      -- Una por trabajador y mes: la definitiva si la hay.
      select distinct on (p.employee_id) p.*, e.location_id as local
        from public.payroll_cost p
        join public.employees e on e.id = p.employee_id and e.account_id = p.account_id
       where p.account_id = v_cuenta
         and p.period_year = extract(year from v_mes)::int
         and p.period_month = extract(month from v_mes)::int
         and (e.location_id = any(coalesce(v_locales, '{}'::uuid[])) or (e.location_id is null and v_una))
       order by p.employee_id, (p.status = 'definitiva') desc, p.updated_at desc
    )
    select n.local, v_mes,
           count(*)::int,
           (count(*) filter (where n.status = 'borrador'))::int,
           coalesce(sum(n.gross), 0)::numeric(14,2),
           coalesce(sum(n.employer_ss), 0)::numeric(14,2),
           (case when bool_and(n.employee_ss is not null) then sum(n.employee_ss) end)::numeric(14,2),
           (case when bool_and(n.irpf is not null) then sum(n.irpf) end)::numeric(14,2),
           coalesce(sum(n.gross - n.net), 0)::numeric(14,2),
           coalesce(sum(n.net), 0)::numeric(14,2),
           coalesce(sum(coalesce(n.total_cost, n.gross + n.employer_ss)), 0)::numeric(14,2),
           bool_and(n.employee_ss is not null and n.irpf is not null)
      from n
     group by n.local
     order by n.local nulls last;
end
$function$;

revoke execute on function public.fuente_nominas_mes_v1(uuid, date) from public, anon;
grant execute on function public.fuente_nominas_mes_v1(uuid, date) to authenticated, service_role;
comment on function public.fuente_nominas_mes_v1(uuid, date) is
  'N7 (24/10). Puerta v1 de Sumied hacia Folvy: el coste de personal del mes por local. Solo lectura, comprueba la empresa, importes numeric(14,2).';
