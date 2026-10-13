-- supabase/staging/sql/20261021_d01_asiento_ensayo.sql
--
-- SOLO STAGING. El ENSAYO de 20261021T0240 (D01, el asiento de la recibida): el
-- fichero entero y su prueba en UNA transacción que acaba en ROLLBACK. Copiados tal cual.

begin;
-- ============================================================================
-- D01 · Tarea 5 · El asiento de la factura recibida: lo aprendido de Diez y el
-- documento. Todo AÑADE (funciones nuevas). Va detrás de la 0230.
--
--   1. conta_gasto_aprendido(empresa, proveedor): la cuenta de gasto a la que
--      fueron las facturas ANTERIORES de ese proveedor en la serie 2 (lo traído
--      de Diez y lo validado en Folvy), con su porqué (Julio, R1 punto 2):
--        · «Las 47 facturas anteriores de este proveedor fueron a Comida y
--          bebida · 60000000» — seguro si fueron todas a la misma;
--        · si fueron a dos o más, la de la MÁS RECIENTE, como probable, nunca
--          segura, y se dice a cuántas fue cada una.
--      Al confirmarlo, la pantalla rellena «Sus facturas se apuntan en» con
--      company_account_link_set(…, 'gasto', …, 'aprendido_diez') (0210).
--   2. conta_documento_factura_guardar: enlaza al asiento VALIDADO de una
--      factura recibida su PDF (kind 'factura_recibida') ya copiado a
--      conta-documentos. El original se queda en receipt-uploads; una foto se
--      convierte a PDF antes de subirla. Las mismas comprobaciones que el
--      resumen de ventas (R15): su cuenta, su ruta, el fichero subido, su
--      tamaño y que sea PDF; uno por asiento y no se cambia.
-- Vuelta atrás: supabase/vuelta-atras/20261021T0240_d01_asiento_recibida.down.sql
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
revoke all on function public.conta_gasto_aprendido(uuid, uuid) from public, anon;
grant execute on function public.conta_gasto_aprendido(uuid, uuid) to authenticated, service_role;

create or replace function public.conta_documento_factura_guardar(p_entry uuid, p_ruta text, p_nombre text, p_sha256 text, p_bytes integer, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  v_e public.journal_entry;
  v_x public.journal_entry_document;
  v_obj record;
  v_prefijo text;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null or not public.belongs_to_account(v_e.account_id) then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_or_manager_of(v_e.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta guarda el documento de un asiento.' using errcode = '42501';
  end if;
  if v_e.status <> 'validado' then
    raise exception 'El documento se guarda con el asiento validado; este está %.', v_e.status using errcode = '23514';
  end if;
  if v_e.source_type <> 'supplier_invoice' or not exists (select 1 from public.supplier_invoice i where i.id = v_e.source_id and i.account_id = v_e.account_id) then
    raise exception 'Ese asiento no es de una factura recibida.' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'La huella del documento no es un sha256.' using errcode = '22023';
  end if;

  select * into v_x from public.journal_entry_document where entry_id = v_e.id and kind = 'factura_recibida';
  if v_x.id is not null then
    if v_x.sha256 = p_sha256 and v_x.storage_path = p_ruta then
      return jsonb_build_object('id', v_x.id, 'ruta', v_x.storage_path, 'nombre', v_x.file_name, 'ya_estaba', true);
    end if;
    raise exception 'Ese asiento ya tiene su factura (guardada el % por %): no se cambia.',
      to_char(v_x.created_at at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), coalesce(v_x.created_by_name, 'alguien') using errcode = '23505';
  end if;

  v_prefijo := v_e.account_id::text || '/' || v_e.id::text || '/';
  if p_ruta is null or left(p_ruta, length(v_prefijo)) <> v_prefijo or substr(p_ruta, length(v_prefijo) + 1) !~ '^[0-9a-f]{16,64}\.pdf$' then
    raise exception 'La ruta del documento no es la de este asiento (%<huella>.pdf).', v_prefijo using errcode = '22023';
  end if;
  select o.name, (o.metadata->>'size')::bigint as bytes, o.metadata->>'mimetype' as tipo into v_obj
    from storage.objects o where o.bucket_id = 'conta-documentos' and o.name = p_ruta;
  if v_obj.name is null then
    raise exception 'La factura no está subida (%): no se enlaza nada.', p_ruta using errcode = 'P0002';
  end if;
  if v_obj.bytes is not null and v_obj.bytes <> p_bytes then
    raise exception 'La factura subida tiene % bytes y se dijeron %: no se enlaza.', v_obj.bytes, p_bytes using errcode = '22023';
  end if;
  if v_obj.tipo is not null and v_obj.tipo <> 'application/pdf' then
    raise exception 'La factura subida no es un PDF (%): una foto se convierte a PDF antes.', v_obj.tipo using errcode = '22023';
  end if;

  insert into public.journal_entry_document (account_id, company_id, entry_id, kind, storage_path, file_name, sha256, size_bytes, created_by, created_by_name)
  values (v_e.account_id, v_e.company_id, v_e.id, 'factura_recibida', p_ruta, p_nombre, p_sha256, p_bytes, auth.uid(), p_quien_nombre)
  returning * into v_x;
  return jsonb_build_object('id', v_x.id, 'ruta', v_x.storage_path, 'nombre', v_x.file_name, 'ya_estaba', false);
end $$;
comment on function public.conta_documento_factura_guardar(uuid, text, text, text, integer, text) is
  'D01 · Enlaza al asiento validado de una factura recibida su PDF ya copiado a conta-documentos (kind factura_recibida). Comprueba ruta, fichero, tamaño y tipo; uno por asiento, y no se cambia.';
revoke all on function public.conta_documento_factura_guardar(uuid, text, text, text, integer, text) from public, anon;
grant execute on function public.conta_documento_factura_guardar(uuid, text, text, text, integer, text) to authenticated;

-- ── La prueba ──
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 asiento: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_t10 constant uuid := '5bbab66f-a022-44a6-b146-ac577a2988d3';
  v_p uuid; v_sub text; r jsonb; v_ids uuid[] := '{}'; v_i uuid; f record;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Aprende Prueba D01', 'Aprende Prueba D01, S.L.', 'B00000033', true, 'Prueba D01') returning id into v_p;
  r := public.company_account_add(v_e, '400', 'Aprende Prueba D01', null, 'supplier', v_p::text, 'Prueba D01');
  v_sub := r->>'code';
  perform set_config('prueba.p', v_p::text, true);

  -- 1 · sin historia
  r := public.conta_gasto_aprendido(v_e, v_p);
  if r->>'cuenta' is not null or (r->>'facturas')::int <> 0 then raise exception 'PRUEBA D01 asiento · 1: sin historia ha aprendido algo: %', r; end if;
  raise notice 'PRUEBA D01 asiento · 1: subcuenta %; sin historia: %', v_sub, r->>'porque';

  -- 2 y 3 · tres facturas validadas: dos a la 600 y la más reciente a la 629
  for f in select * from (values ('PD01-A-1', '2026-09-03'::date, '60000000'), ('PD01-A-2', '2026-09-10'::date, '60000000'), ('PD01-A-3', '2026-09-24'::date, '62900000')) x(num, fecha, gasto) loop
    insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
    values (v_acc, v_p, v_e, f.num, f.fecha, 'aprobada', 'manual', 110, 100, 10, 'Prueba D01') returning id into v_i;
    r := public.journal_entry_proponer(v_e,
      jsonb_build_object('series', 2, 'fecha', f.fecha, 'concepto', 'Factura Aprende Prueba D01 · ' || f.num, 'source_type', 'supplier_invoice', 'source_id', v_i,
                         'confianza', 'seguro', 'porque', 'Prueba D01', 'documento', f.num),
      jsonb_build_array(
        jsonb_build_object('cuenta', f.gasto, 'debe', 100, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', f.num),
        jsonb_build_object('cuenta', '47200010', 'debe', 10, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', f.num,
                           'iva', jsonb_build_object('tipo_id', v_t10, 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
        jsonb_build_object('cuenta', v_sub, 'debe', 0, 'haber', 110, 'local_id', v_loc, 'comun', false, 'documento', f.num)),
      null, 'Prueba D01');
    perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba D01');
    v_ids := v_ids || (r->>'id')::uuid;
    if f.num = 'PD01-A-2' then
      r := public.conta_gasto_aprendido(v_e, v_p);
      if r->>'cuenta' <> '60000000' or r->>'confianza' <> 'seguro' or (r->>'facturas')::int <> 2 or r->>'porque' not like 'Las 2 facturas anteriores de este proveedor fueron a % · 60000000.' then
        raise exception 'PRUEBA D01 asiento · 2: no aprende la 600 segura de dos facturas: %', r;
      end if;
      raise notice 'PRUEBA D01 asiento · 2: % (%; %).', r->>'porque', r->>'confianza', r->>'origen';
    end if;
  end loop;
  r := public.conta_gasto_aprendido(v_e, v_p);
  if r->>'cuenta' <> '62900000' or r->>'confianza' <> 'probable' or jsonb_array_length(r->'reparto') <> 2 then
    raise exception 'PRUEBA D01 asiento · 3: con dos cuentas no propone la más reciente como probable: %', r;
  end if;
  raise notice 'PRUEBA D01 asiento · 3: % (%).', r->>'porque', r->>'confianza';
  perform set_config('prueba.entry', v_ids[3]::text, true);
end $$;

-- 4 · el documento
do $$
declare
  v_acc constant text := 'c01a0000-0000-4000-8000-00000000000a';
  v_entry uuid := current_setting('prueba.entry')::uuid;
  v_ruta text := v_acc || '/' || current_setting('prueba.entry') || '/0123456789abcdef.pdf';
  v_otro uuid;
  r jsonb;
begin
  -- Un asiento validado que no es de factura recibida (si staging tiene alguno de A).
  select id into v_otro from public.journal_entry where account_id = v_acc::uuid and status = 'validado' and source_type <> 'supplier_invoice' limit 1;
  if v_otro is not null then
    begin
      perform public.conta_documento_factura_guardar(v_otro, v_acc || '/' || v_otro || '/0123456789abcdef.pdf', 'f.pdf', repeat('ab', 32), 1234, 'Prueba');
      raise exception 'PRUEBA D01 asiento · 4: ha guardado una factura en un asiento que no es de factura recibida.';
    exception when sqlstate '22023' then null; end;
  end if;
  begin
    perform public.conta_documento_factura_guardar(v_entry, v_ruta, 'PD01-A-3.pdf', repeat('ab', 32), 1234, 'Prueba');
    raise exception 'PRUEBA D01 asiento · 4: ha enlazado una factura que no está subida.';
  exception when sqlstate 'P0002' then null; end;
  insert into storage.objects (bucket_id, name, metadata) values ('conta-documentos', v_ruta, '{"size": 1234, "mimetype": "application/pdf"}');
  r := public.conta_documento_factura_guardar(v_entry, v_ruta, 'PD01-A-3.pdf', repeat('ab', 32), 1234, 'Prueba');
  if (r->>'ya_estaba')::boolean then raise exception 'PRUEBA D01 asiento · 4: la primera vez dice que ya estaba.'; end if;
  r := public.conta_documento_factura_guardar(v_entry, v_ruta, 'PD01-A-3.pdf', repeat('ab', 32), 1234, 'Prueba');
  if not (r->>'ya_estaba')::boolean then raise exception 'PRUEBA D01 asiento · 4: la segunda vez ha hecho otro.'; end if;
  if (select kind from public.journal_entry_document where entry_id = v_entry) <> 'factura_recibida' then raise exception 'PRUEBA D01 asiento · 4: no es kind factura_recibida.'; end if;
  raise notice 'PRUEBA D01 asiento · 4: otro tipo de asiento no (%); sin fichero no; con fichero sí (factura_recibida), y la segunda vez el mismo.', case when v_otro is null then 'no había ninguno que probar' else 'probado' end;
end $$;
reset role;

-- 5 · B
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_gasto_aprendido('3b34403a-a7d6-4a48-a8d7-737e8cababdc', current_setting('prueba.p')::uuid);
    raise exception 'PRUEBA D01 asiento · 5: B ha aprendido de A.';
  exception when insufficient_privilege then null; end;
  begin
    perform public.conta_documento_factura_guardar(current_setting('prueba.entry')::uuid, 'x', 'x.pdf', repeat('ab', 32), 1, 'B');
    raise exception 'PRUEBA D01 asiento · 5: B ha guardado en A.';
  exception when sqlstate 'P0002' then null; end;
  raise notice 'PRUEBA D01 asiento · 5: B ni aprende de A ni le guarda documentos.';
end $$;
reset role;

rollback;
