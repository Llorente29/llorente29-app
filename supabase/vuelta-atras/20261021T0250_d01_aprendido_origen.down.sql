-- Vuelta atrás de 20261021T0250 (D01): la función como la dejó la 0240 (origen
-- siempre «aprendido de Diez»). Sin datos que proteger: es una lectura.
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
    select e.id, e.entry_date from public.journal_entry e
     where e.account_id = v_acc and e.company_id = p_company and e.series = 2 and e.status = 'validado'
       and exists (select 1 from public.journal_line l where l.entry_id = e.id and l.company_account_id = v_prov and l.credit > 0)
  ), gasto as (
    select f.id, f.entry_date, a.id as cuenta_id, a.code, a.name
      from facturas f join public.journal_line l on l.entry_id = f.id and l.debit > 0
      join public.company_account a on a.id = l.company_account_id and a.company_id = p_company and a.code like '6%'
     group by f.id, f.entry_date, a.id, a.code, a.name
  ), por_cuenta as (
    select cuenta_id, code, name, count(distinct id) as n, max(entry_date) as ultima from gasto group by 1, 2, 3
  )
  select (select count(distinct id) from gasto),
         (select count(*) from por_cuenta),
         (select jsonb_agg(jsonb_build_object('cuenta', code, 'nombre', name, 'facturas', n, 'ultima', ultima) order by ultima desc, n desc) from por_cuenta)
    into v_total, v_n_cuentas, v_reparto;

  if coalesce(v_total, 0) = 0 then
    return jsonb_build_object('cuenta', null, 'facturas', 0, 'porque', 'No hay facturas anteriores de este proveedor en el libro: no hay nada que aprender.');
  end if;
  -- La más reciente manda (si fueron a varias, es la que vale hoy).
  select x->>'cuenta' as code, x->>'nombre' as name, (x->>'facturas')::int as n into v_top from jsonb_array_elements(v_reparto) x limit 1;
  return jsonb_build_object(
    'cuenta', v_top.code,
    'cuenta_id', (select id from public.company_account where company_id = p_company and code = v_top.code),
    'nombre', v_top.name,
    'facturas', v_total,
    'confianza', case when v_n_cuentas = 1 then 'seguro' else 'probable' end,
    'origen', 'aprendido de Diez',
    'reparto', v_reparto,
    'porque', case
      when v_n_cuentas = 1 and v_total = 1 then format('La factura anterior de este proveedor fue a %s · %s.', v_top.name, v_top.code)
      when v_n_cuentas = 1 then format('Las %s facturas anteriores de este proveedor fueron a %s · %s.', v_total, v_top.name, v_top.code)
      else format('Las %s facturas anteriores de este proveedor fueron a %s cuentas; la más reciente, a %s · %s (%s de %s). Probable, no segura: confírmalo.',
                  v_total, v_n_cuentas, v_top.name, v_top.code, v_top.n, v_total) end);
end $$;
comment on function public.conta_gasto_aprendido(uuid, uuid) is
  'D01 · La cuenta de gasto aprendida de las facturas anteriores del proveedor (serie 2, validadas: lo traído de Diez y lo de Folvy), con su porqué. Seguro si fueron todas a una; si a varias, la más reciente y probable.';
