-- ============================================================================
-- D01 · R2 punto 3 · El ORIGEN de lo aprendido dice de dónde vino de verdad.
--
-- cambia: public.conta_gasto_aprendido · prueba: supabase/staging/sql/20261021_d01_aprendido_prueba.sql
--
-- La 0240 ponía siempre «aprendido de Diez», también cuando las facturas eran
-- de Folvy (lo dijo su prueba en staging, que las había validado en Folvy).
-- Ahora: «aprendido de Diez» si la factura más reciente de esa cuenta se trajo
-- de Diez (external_program = 'diez'); «aprendido de tus facturas» si se
-- apuntó en Folvy. Si hay de los dos, sale el de la más reciente (Julio, R2).
-- La misma firma: se reemplaza en caliente.
-- Vuelta atrás: supabase/vuelta-atras/20261021T0250_d01_aprendido_origen.down.sql
-- ============================================================================

create or replace function public.conta_gasto_aprendido(p_company uuid, p_supplier uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid;
  v_prov uuid;
  v_total int;
  v_top record;
  v_n_cuentas int;
  v_reparto jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (public.belongs_to_account(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  -- La subcuenta del proveedor (400/410), la de su ficha.
  select k.company_account_id into v_prov from public.company_account_link k
   where k.company_id = p_company and k.account_id = v_acc and k.entity = 'supplier' and k.entity_id = p_supplier::text and k.role = 'principal';
  if v_prov is null then
    return jsonb_build_object('cuenta', null, 'porque', 'El proveedor no tiene su subcuenta en el plan: no hay historia que mirar.');
  end if;

  with facturas as (
    select e.id, e.entry_date, e.created_at, e.external_program from public.journal_entry e
     where e.account_id = v_acc and e.company_id = p_company and e.series = 2 and e.status = 'validado'
       and exists (select 1 from public.journal_line l where l.entry_id = e.id and l.company_account_id = v_prov and l.credit > 0)
  ), gasto as (
    select f.id, f.entry_date, f.created_at, f.external_program, a.id as cuenta_id, a.code, a.name
      from facturas f join public.journal_line l on l.entry_id = f.id and l.debit > 0
      join public.company_account a on a.id = l.company_account_id and a.company_id = p_company and a.code like '6%'
     group by f.id, f.entry_date, f.created_at, f.external_program, a.id, a.code, a.name
  ), por_cuenta as (
    -- De dónde vino de verdad: la factura MÁS RECIENTE de esa cuenta manda
    -- (traída de Diez, o apuntada en Folvy).
    select g.cuenta_id, g.code, g.name, count(distinct g.id) as n, max(g.entry_date) as ultima,
           (array_agg(case when g.external_program = 'diez' then 'aprendido de Diez' else 'aprendido de tus facturas' end
                      order by g.entry_date desc, g.created_at desc))[1] as origen
      from gasto g group by 1, 2, 3
  )
  select (select count(distinct id) from gasto),
         (select count(*) from por_cuenta),
         (select jsonb_agg(jsonb_build_object('cuenta', code, 'nombre', name, 'facturas', n, 'ultima', ultima, 'origen', origen) order by ultima desc, n desc) from por_cuenta)
    into v_total, v_n_cuentas, v_reparto;

  if coalesce(v_total, 0) = 0 then
    return jsonb_build_object('cuenta', null, 'facturas', 0, 'porque', 'No hay facturas anteriores de este proveedor en el libro: no hay nada que aprender.');
  end if;
  -- La más reciente manda (si fueron a varias, es la que vale hoy).
  select x->>'cuenta' as code, x->>'nombre' as name, (x->>'facturas')::int as n, x->>'origen' as origen into v_top from jsonb_array_elements(v_reparto) x limit 1;
  return jsonb_build_object(
    'cuenta', v_top.code,
    'cuenta_id', (select id from public.company_account where company_id = p_company and code = v_top.code),
    'nombre', v_top.name,
    'facturas', v_total,
    'confianza', case when v_n_cuentas = 1 then 'seguro' else 'probable' end,
    'origen', v_top.origen,
    'reparto', v_reparto,
    'porque', case
      when v_n_cuentas = 1 and v_total = 1 then format('La factura anterior de este proveedor fue a %s · %s.', v_top.name, v_top.code)
      when v_n_cuentas = 1 then format('Las %s facturas anteriores de este proveedor fueron a %s · %s.', v_total, v_top.name, v_top.code)
      else format('Las %s facturas anteriores de este proveedor fueron a %s cuentas; la más reciente, a %s · %s (%s de %s). Probable, no segura: confírmalo.',
                  v_total, v_n_cuentas, v_top.name, v_top.code, v_top.n, v_total) end);
end $$;
comment on function public.conta_gasto_aprendido(uuid, uuid) is
  'D01 · La cuenta de gasto aprendida de las facturas anteriores del proveedor (serie 2, validadas), con su porqué y su origen de verdad: «aprendido de Diez» o «aprendido de tus facturas», el de la más reciente. Seguro si fueron todas a una; si a varias, la más reciente y probable.';
revoke all on function public.conta_gasto_aprendido(uuid, uuid) from public, anon;
grant execute on function public.conta_gasto_aprendido(uuid, uuid) to authenticated, service_role;

