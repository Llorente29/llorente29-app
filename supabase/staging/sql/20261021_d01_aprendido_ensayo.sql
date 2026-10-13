-- supabase/staging/sql/20261021_d01_aprendido_ensayo.sql
--
-- SOLO STAGING. El ENSAYO de 20261021T0250 (D01 R2, el origen de lo aprendido):
-- el fichero entero y su prueba en UNA transacción que acaba en ROLLBACK.

begin;
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


-- ── La prueba ──
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 aprendido: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
-- Una factura de Folvy, propuesta y validada: la función que hace el libro.
create or replace function pg_temp.factura_folvy(p_prov uuid, p_sub text, p_num text, p_fecha date) returns uuid language plpgsql as $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_i uuid; r jsonb;
begin
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values (v_acc, p_prov, v_e, p_num, p_fecha, 'aprobada', 'manual', 110, 100, 10, 'Prueba D01') returning id into v_i;
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', p_fecha, 'concepto', 'Factura Origen Prueba D01 · ' || p_num, 'source_type', 'supplier_invoice', 'source_id', v_i,
                       'confianza', 'seguro', 'porque', 'Prueba D01', 'documento', p_num),
    jsonb_build_array(
      jsonb_build_object('cuenta', '60000000', 'debe', 100, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', p_num),
      jsonb_build_object('cuenta', '47200010', 'debe', 10, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', p_num,
                         'iva', jsonb_build_object('tipo_id', '5bbab66f-a022-44a6-b146-ac577a2988d3', 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', p_sub, 'debe', 0, 'haber', 110, 'local_id', v_loc, 'comun', false, 'documento', p_num)),
    null, 'Prueba D01');
  perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba D01');
  return (r->>'id')::uuid;
end $$;

do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid; r jsonb; v_entry uuid;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', 'Origen Prueba D01', 'Origen Prueba D01, S.L.', 'B00000044', true, 'Prueba D01') returning id into v_p;
  r := public.company_account_add(v_e, '4000', 'Origen Prueba D01', null, 'supplier', v_p::text, 'Prueba D01');
  perform set_config('prueba.p', v_p::text, true);
  perform set_config('prueba.sub', r->>'code', true);
  v_entry := pg_temp.factura_folvy(v_p, r->>'code', 'PD01-O-1', '2026-09-03');
  perform set_config('prueba.entry1', v_entry::text, true);
  r := public.conta_gasto_aprendido(v_e, v_p);
  if r->>'origen' <> 'aprendido de tus facturas' or (r->>'facturas')::int <> 1 then raise exception 'PRUEBA D01 aprendido · 1: %', r; end if;
  raise notice 'PRUEBA D01 aprendido · 1: % (%).', r->>'porque', r->>'origen';
end $$;
reset role;

-- 2 · una traída de Diez, más reciente (como conta_diez_importar)
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_id uuid; v_seq bigint; v_prev text; v_hash text;
  v_y uuid := (select fiscal_year_id from public.journal_entry where id = current_setting('prueba.entry1')::uuid);
begin
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, reasons,
                                    external_program, external_year, external_series, external_number, external_hash, created_by_name)
  values (v_acc, v_e, v_y, 2, '2026-09-20', 'Factura traída de prueba', 'migrated', 'borrador', '[{"decision":"traido-de-diez","porque":"Prueba D01"}]',
          'diez', '2026', '2', '990001', repeat('d', 32), 'Diez (traído)') returning id into v_id;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept)
  values (v_acc, v_e, v_id, 1, (select id from public.company_account where company_id = v_e and code = '60000000'), 100, 0, 'Prueba'),
         (v_acc, v_e, v_id, 2, (select id from public.company_account where company_id = v_e and code = current_setting('prueba.sub')), 0, 100, 'Prueba');
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || v_e, 0));
  select chain_seq, hash into v_seq, v_prev from public.journal_entry where company_id = v_e and chain_seq is not null order by chain_seq desc limit 1;
  update public.journal_entry set number = 990001, status = 'validado', validated_at = now(), validated_by_name = 'Diez (traído)',
         chain_seq = coalesce(v_seq, 0) + 1, prev_hash = v_prev, hash = 'pendiente' where id = v_id;
  v_hash := public.journal_huella(v_prev, public.journal_entry_canonico(v_id));
  perform set_config('folvy.journal_huella', v_id::text, true);
  update public.journal_entry set hash = v_hash where id = v_id;
  perform set_config('folvy.journal_huella', '', true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid := current_setting('prueba.p')::uuid; r jsonb;
begin
  r := public.conta_gasto_aprendido(v_e, v_p);
  if r->>'origen' <> 'aprendido de Diez' or (r->>'facturas')::int <> 2 or r->>'confianza' <> 'seguro' then raise exception 'PRUEBA D01 aprendido · 2: %', r; end if;
  raise notice 'PRUEBA D01 aprendido · 2: % (%; %).', r->>'porque', r->>'origen', r->>'confianza';
  perform pg_temp.factura_folvy(v_p, current_setting('prueba.sub'), 'PD01-O-3', '2026-09-28');
  r := public.conta_gasto_aprendido(v_e, v_p);
  if r->>'origen' <> 'aprendido de tus facturas' or (r->>'facturas')::int <> 3 then raise exception 'PRUEBA D01 aprendido · 3: %', r; end if;
  raise notice 'PRUEBA D01 aprendido · 3: % (%).', r->>'porque', r->>'origen';
end $$;
reset role;

rollback;
