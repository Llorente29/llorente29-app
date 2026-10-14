-- supabase/staging/sql/20261021_d01_revisar_ensayo.sql
--
-- SOLO STAGING. El ENSAYO de 20261021T0290 (D01, N23 y «Pedírselas»): el
-- fichero entero y su prueba en UNA transacción que acaba en ROLLBACK.

begin;
-- ============================================================================
-- D01 · Tarea 6 · Lo que necesitan N23 (Revisar factura) y «Pedírselas». AÑADE
-- dos funciones nuevas; va detrás de la 0280.
--
--   1. conta_factura_para_revisar(factura): todo lo de N23 en una lectura, con
--      los permisos de quien mira: la factura, sus bases por tipo, lo leído
--      (comprobaciones, confianza y porqué), el proveedor (NIF, «Sus facturas se
--      apuntan en» con su origen, su contacto de Facturación), por dónde llegó
--      y su fichero, la recepción con la que casa, y su asiento si lo hay.
--   2. conta_factura_pedir(...): «Pedírselas». Guarda la petición CONFIRMADA
--      por la persona (Julio, R1 punto 5: el correo nunca sale sin que la
--      persona confirme) y, si lo pide, la dirección como contacto de
--      Facturación de la ficha. No envía nada: mientras el dominio de correo
--      no exista, el correo lo manda la persona desde el suyo (la pantalla lo
--      abre con el texto puesto) y aquí queda «confirmado», no «enviado».
--      Una por proveedor y mes (el índice de la 0200).
-- Vuelta atrás: supabase/vuelta-atras/20261021T0290_d01_revisar_y_pedir.down.sql
-- ============================================================================

create or replace function public.conta_factura_para_revisar(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_i public.supplier_invoice;
  v_company uuid;
  v_apr jsonb;
begin
  select * into v_i from public.supplier_invoice where id = p_invoice;
  if v_i.id is null or not public.belongs_to_account(v_i.account_id) then
    raise exception 'Esa factura no está.' using errcode = 'P0002';
  end if;
  v_company := coalesce(v_i.company_id, (select id from public.company where account_id = v_i.account_id order by created_at limit 1));
  -- Lo aprendido de sus facturas anteriores (0250): de ahí sale el origen de
  -- verdad, «aprendido de Diez» o «aprendido de tus facturas» (la más reciente).
  if v_i.supplier_id is not null and v_company is not null then
    v_apr := public.conta_gasto_aprendido(v_company, v_i.supplier_id);
  end if;
  return jsonb_build_object(
    'id', v_i.id, 'account_id', v_i.account_id, 'company_id', v_company, 'estado', v_i.status,
    'numero', v_i.invoice_number, 'fecha', v_i.invoice_date, 'vence', v_i.due_date, 'clase', v_i.doc_kind,
    'base', v_i.tax_base_total, 'cuota', v_i.tax_total, 'recargo', v_i.surcharge_total, 'retencion', v_i.withholding_amount, 'total', v_i.grand_total,
    'canal', v_i.arrival_channel, 'confianza', v_i.reading_confidence, 'lectura', v_i.reading,
    'no_repetida', v_i.not_duplicate_confirmed_at is not null,
    'tipos', coalesce((select jsonb_agg(jsonb_build_object('tipo', t.vat_pct, 'base', t.base, 'cuota', t.vat_amount, 'recargo', t.surcharge_amount) order by t.vat_pct desc)
                         from public.supplier_invoice_tax t where t.supplier_invoice_id = v_i.id), '[]'::jsonb),
    'lineas', coalesce((select jsonb_agg(jsonb_build_object('texto', l.raw_text, 'cantidad', l.qty, 'importe', l.line_amount, 'iva', l.vat_pct) order by l.position nulls last, l.created_at)
                          from public.supplier_invoice_line l where l.supplier_invoice_id = v_i.id), '[]'::jsonb),
    'proveedor', (select jsonb_build_object(
        'id', s.id, 'nombre', s.name, 'razon', s.legal_name, 'nif', s.tax_id,
        'subcuenta', (select a.code from public.company_account_link k join public.company_account a on a.id = k.company_account_id
                       where k.company_id = v_company and k.entity = 'supplier' and k.entity_id = s.id::text and k.role = 'principal' limit 1),
        -- «Sus facturas se apuntan en», con su origen dicho para una persona.
        -- Con cuenta en la ficha: si se puso aceptando lo aprendido y sigue
        -- siendo lo aprendido, el origen es el de la historia (Diez o tus
        -- facturas); si la eligió una persona, «elegida en su ficha». Sin
        -- cuenta en la ficha, lo aprendido tal cual.
        'gasto', coalesce(
          (select jsonb_build_object('cuenta', a.code, 'nombre', a.name,
                    'origen', case when k.source in ('ai_accepted', 'aprendido_diez') and v_apr->>'cuenta' = a.code then v_apr->>'origen'
                                   when k.source = 'manual' then 'elegida en su ficha' else 'de su ficha' end)
             from public.company_account_link k join public.company_account a on a.id = k.company_account_id
            where k.company_id = v_company and k.entity = 'supplier' and k.entity_id = s.id::text and k.role = 'gasto' limit 1),
          case when v_apr->>'cuenta' is not null then jsonb_build_object('cuenta', v_apr->>'cuenta', 'nombre', v_apr->>'nombre', 'origen', v_apr->>'origen') end),
        'facturacion', (select jsonb_build_object('nombre', c.name, 'email', c.email) from public.supplier_contact c
                         where c.supplier_id = s.id and c.account_id = s.account_id and c.role = 'billing' and c.email is not null order by c.created_at limit 1))
      from public.supplier s where s.id = v_i.supplier_id and s.account_id = v_i.account_id),
    'propuesto', case when v_i.supplier_id is null then jsonb_build_object('nombre', v_i.reading->'factura'->'proveedor'->>'nombre', 'nif', v_i.reading->'factura'->'proveedor'->>'nif') end,
    'llegada', (select jsonb_build_object('canal', d.channel, 'archivo', d.file_name, 'ruta', d.file_path, 'tipo', d.mime_type, 'de', d.email_from, 'a', d.email_to, 'cuando', d.created_at)
                  from public.document_inbox d where d.id = v_i.inbox_id and d.account_id = v_i.account_id),
    'papel', v_i.raw_document_url,
    'recepcion', (select jsonb_build_object('fecha', gr.receipt_date, 'local', l.name)
                    from public.supplier_invoice_receipt r join public.goods_receipt gr on gr.id = r.goods_receipt_id
                    left join public.locations l on l.id = gr.location_id
                   where r.supplier_invoice_id = v_i.id order by gr.receipt_date desc limit 1),
    'asiento', (select jsonb_build_object('id', e.id, 'estado', e.status, 'numero', e.number)
                  from public.journal_entry e
                 where e.account_id = v_i.account_id and e.source_type = 'supplier_invoice' and e.source_id = v_i.id and e.status in ('propuesto', 'borrador', 'validado')
                 order by (e.status = 'validado') desc, e.created_at desc limit 1));
end $$;
comment on function public.conta_factura_para_revisar(uuid) is
  'D01 · N23: todo lo de una factura recibida para revisarla (lo leído, su proveedor con «Sus facturas se apuntan en» y su contacto de Facturación, su llegada y fichero, su recepción y su asiento). Solo para los de la cuenta.';
revoke all on function public.conta_factura_para_revisar(uuid) from public, anon;
grant execute on function public.conta_factura_para_revisar(uuid) to authenticated;

create or replace function public.conta_factura_pedir(
  p_company uuid, p_supplier uuid, p_periodo date, p_email text, p_contacto text, p_guardar_contacto boolean,
  p_asunto text, p_cuerpo text, p_quien_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid;
  v_id uuid;
  v_mes date := date_trunc('month', p_periodo)::date;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta pide facturas.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.supplier where id = p_supplier and account_id = v_acc) then
    raise exception 'Ese proveedor no es de esta cuenta.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Esa dirección de correo no es válida.' using errcode = '22023'; end if;
  if coalesce(trim(p_quien_nombre), '') = '' then raise exception 'Falta quién la pide: sin persona no se confirma.' using errcode = '22023'; end if;

  select id into v_id from public.supplier_invoice_request
   where supplier_id = p_supplier and period = v_mes and status in ('confirmado', 'enviado');
  if v_id is not null then return jsonb_build_object('id', v_id, 'ya_estaba', true); end if;

  if p_guardar_contacto and not exists (select 1 from public.supplier_contact where supplier_id = p_supplier and lower(email) = v_email) then
    insert into public.supplier_contact (account_id, supplier_id, name, role, email, created_by, created_by_name)
    values (v_acc, p_supplier, coalesce(nullif(trim(p_contacto), ''), 'Facturación'), 'billing', v_email, auth.uid(), p_quien_nombre);
  end if;
  insert into public.supplier_invoice_request (account_id, company_id, supplier_id, expected_id, period, to_email, subject, body, status, confirmed_at, confirmed_by, confirmed_by_name)
  values (v_acc, p_company, p_supplier,
          (select id from public.supplier_expected_invoice where company_id = p_company and supplier_id = p_supplier),
          v_mes, v_email, p_asunto, p_cuerpo, 'confirmado', now(), auth.uid(), p_quien_nombre)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'ya_estaba', false);
end $$;
comment on function public.conta_factura_pedir(uuid, uuid, date, text, text, boolean, text, text, text) is
  'D01 · «Pedírselas»: guarda la petición CONFIRMADA por la persona (una por proveedor y mes) y, si lo pide, la dirección como contacto de Facturación. No envía: el correo lo manda la persona mientras no haya dominio.';
revoke all on function public.conta_factura_pedir(uuid, uuid, date, text, text, boolean, text, text, text) from public, anon;
grant execute on function public.conta_factura_pedir(uuid, uuid, date, text, text, boolean, text, text, text) to authenticated;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 revisar: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
-- Los datos de la prueba, con la identidad del administrador de A pero como
-- dueño: el IVA por tipo de una factura solo lo escriben las funciones (la
-- persona no tiene INSERT en supplier_invoice_tax). Lo que se PRUEBA va después,
-- como usuario.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid; v_sub text; v_i uuid;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Revisar Prueba D01', 'Revisar Prueba D01, S.L.', 'B00000077', true, 'Prueba D01') returning id into v_p;
  v_sub := public.company_account_add(v_e, '4000', 'Revisar Prueba D01', null, 'supplier', v_p::text, 'Prueba D01')->>'code';
  perform public.company_account_link_set(v_e, 'supplier', v_p::text, 'gasto', (select id from public.company_account where company_id = v_e and code = '60000000'), 'Prueba D01', 'manual');
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name, arrival_channel, reading_confidence, reading)
  values (v_acc, v_p, v_e, 'PD01-R-1', '2026-10-11', 'en_revision', 'ocr', 110, 100, 10, 'Prueba D01', 'correo', 'seguro', '{"porque":["Todo cuadra y trae lo que pide la norma."],"comprobaciones":[]}')
  returning id into v_i;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (v_acc, v_i, 10, 100, 10);
  perform set_config('prueba.i', v_i::text, true);
  perform set_config('prueba.p', v_p::text, true);
  perform set_config('prueba.sub', v_sub, true);
end $$;

set local role authenticated;
do $$
declare
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid := current_setting('prueba.p')::uuid;
  v_i uuid := current_setting('prueba.i')::uuid;
  v_sub text := current_setting('prueba.sub');
  r jsonb; v_id uuid;
begin
  -- 1
  r := public.conta_factura_para_revisar(v_i);
  if r->>'numero' <> 'PD01-R-1' or r->>'confianza' <> 'seguro' or jsonb_array_length(r->'tipos') <> 1 or (r->'tipos'->0->>'base')::numeric <> 100
     or r->'proveedor'->>'subcuenta' <> v_sub or r->'proveedor'->'gasto'->>'cuenta' <> '60000000' or r->'proveedor'->'gasto'->>'origen' <> 'elegida en su ficha'
     or r->'lectura'->'porque'->>0 is null or r->'asiento' <> 'null'::jsonb then
    raise exception 'PRUEBA D01 revisar · 1: %', r;
  end if;
  raise notice 'PRUEBA D01 revisar · 1: factura, 1 tipo, subcuenta %, sus facturas se apuntan en % (%), sin asiento.', v_sub, r->'proveedor'->'gasto'->>'cuenta', r->'proveedor'->'gasto'->>'origen';

  -- 2
  r := public.conta_factura_pedir(v_e, v_p, '2026-09-15', 'Facturas@Proveedor-Prueba.test', 'Administración', true, 'Factura de septiembre', 'Hola: nos falta la factura de septiembre.', 'Prueba D01');
  v_id := (r->>'id')::uuid;
  if (r->>'ya_estaba')::boolean then raise exception 'PRUEBA D01 revisar · 2: la primera dice que ya estaba.'; end if;
  if (select status from public.supplier_invoice_request where id = v_id) <> 'confirmado' or (select confirmed_by_name from public.supplier_invoice_request where id = v_id) <> 'Prueba D01'
     or (select period from public.supplier_invoice_request where id = v_id) <> '2026-09-01' then
    raise exception 'PRUEBA D01 revisar · 2: la petición no queda confirmada por quien la pide, del mes 1.';
  end if;
  if not exists (select 1 from public.supplier_contact where supplier_id = v_p and role = 'billing' and email = 'facturas@proveedor-prueba.test') then
    raise exception 'PRUEBA D01 revisar · 2: no ha guardado el contacto de Facturación.';
  end if;
  if (public.conta_factura_pedir(v_e, v_p, '2026-09-30', 'otra@prueba.test', null, false, 'x', 'y', 'Prueba D01')->>'id')::uuid <> v_id then
    raise exception 'PRUEBA D01 revisar · 2: el mismo mes ha hecho otra petición.';
  end if;
  begin
    perform public.conta_factura_pedir(v_e, v_p, '2026-10-01', 'no es un correo', null, false, 'x', 'y', 'Prueba D01');
    raise exception 'PRUEBA D01 revisar · 2: ha aceptado una dirección mal escrita.';
  exception when sqlstate '22023' then null; end;
  r := public.conta_factura_para_revisar(v_i);
  if r is null or r->'proveedor'->'facturacion'->>'email' <> 'facturas@proveedor-prueba.test' then
    raise exception 'PRUEBA D01 revisar · 2: la ficha no trae el contacto de Facturación: %', r->'proveedor';
  end if;
  raise notice 'PRUEBA D01 revisar · 2: confirmada por quien la pide (no «enviada»), contacto de Facturación guardado, una por mes, y una dirección mal escrita no.';
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_factura_para_revisar(current_setting('prueba.i')::uuid);
    raise exception 'PRUEBA D01 revisar · 3: B ha leído la factura de A.';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform public.conta_factura_pedir('3b34403a-a7d6-4a48-a8d7-737e8cababdc', current_setting('prueba.p')::uuid, '2026-10-01', 'b@prueba.test', null, false, 'x', 'y', 'B');
    raise exception 'PRUEBA D01 revisar · 3: B ha pedido en nombre de A.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA D01 revisar · 3: B ni la lee ni pide en nombre de A.';
end $$;
reset role;

rollback;
