-- supabase/migrations/20261026T1835_pc01e2b_iban_de_las_facturas.sql
--
-- PC01 · Entrega 2b · El IBAN y la forma de pago de las facturas recibidas
-- (respuestas de Julio, 26/10, punto 3). No relee las facturas viejas ni toca
-- datos: vale desde que se aplica, para cada factura nueva que lea Sumied.
--
--   1. El lector guarda en la factura lo que trae el papel: la forma de pago
--      prevista (payment_method: transferencia, domiciliada, tarjeta o
--      contado) y el IBAN (read_iban). El IBAN solo si es para pagarle por
--      transferencia (o el papel no dice cómo), pasa el control (módulo 97) y
--      no es de una cuenta nuestra: en una domiciliada el IBAN que sale suele
--      ser el NUESTRO, el del cargo.
--   2. Con la factura ya con su proveedor (al leerla, o al darlo de alta o
--      elegirlo después), un disparador nuevo en supplier_invoice:
--        · si el proveedor no tiene IBAN, se lo pone en su ficha SIN CONFIRMAR
--          (supplier.iban_unconfirmed_invoice_id = esta factura), y lo dice en
--          el historial de la factura;
--        · si tiene otro, no toca la ficha: queda el antifraude de la C01b (la
--          factura no se paga hasta que alguien decida si es el nuevo) y lo
--          dice en el historial.
--   3. Un IBAN sin confirmar para la remesa como uno que ha cambiado
--      (_pc01e2_iban_como_esta → «cambiado», con la factura de la que salió):
--      no se descarga el fichero hasta confirmarlo. Confirmarlo en la remesa
--      (conta_remesa_iban_confirmar) lo deja confirmado en la ficha.
--   4. «Poner IBAN» en la barra de Pagar (conta_proveedor_iban_poner): se
--      escribe o se pega, se comprueba que es válido y queda apuntado quién y
--      cuándo (supplier.iban_set_*). Para cualquier cambio de la ficha que pone
--      un IBAN donde no había, el disparador del E2 apunta también quién y
--      cuándo; y si alguien pone otro, deja de estar «sin confirmar».
--   5. La remesa no admite una factura con un IBAN distinto del de la ficha y
--      sin decidir (antes paraba después, al casar el cargo, en el freno de la
--      C01b), y la lista de Pagos lo dice (iban_distinto, iban_leido4,
--      iban_sin_confirmar).
--
-- cambia: public.conta_factura_desde_lectura · prueba: supabase/staging/sql/20261026_pc01e2b_iban_prueba.sql
--   (misma firma: guarda read_iban y payment_method al crear la factura.)
-- cambia: public.supplier · prueba: supabase/staging/sql/20261026_pc01e2b_iban_prueba.sql
--   (tres columnas nuevas que admiten nulos, más la de la factura de la que se
--   leyó un IBAN sin confirmar; y el disparador del E2 —misma función, misma
--   firma— apunta también quién pone un IBAN donde no había.)
-- cambia: public._pc01e2_proveedor_iban_cambiado · prueba: supabase/staging/sql/20261026_pc01e2b_iban_prueba.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261026_pc01e2b_iban_prueba.sql
--   (un disparador nuevo AFTER INSERT OR UPDATE OF supplier_id, read_iban que
--   solo actúa con read_iban: hoy está vacío en todas.)
-- cambia: public._pc01e2_iban_como_esta · prueba: supabase/staging/sql/20261026_pc01e2b_iban_prueba.sql
-- cambia: public.conta_remesa_pagos_crear · prueba: supabase/staging/sql/20261026_pc01e2b_iban_prueba.sql
-- cambia: public.conta_remesa_iban_confirmar · prueba: supabase/staging/sql/20261026_pc01e2b_iban_prueba.sql
-- cambia: public.conta_pagos_lista · prueba: supabase/staging/sql/20261026_pc01e2b_iban_prueba.sql
--
-- No está en el camino del pedido. Dueño único (N8): lo escriben funciones
-- conta_* y el disparador; Folvy no lee ni escribe estas columnas.
-- Antes de escribirla, medido en producción (solo lectura, 26/10 18:20Z): las
-- seis funciones que cambia son byte a byte las del repositorio (md5 de
-- prosrc igual a los ficheros 0915 y d06): no hay deriva.

-- ── 0 · Las columnas de la ficha ───────────────────────────────────────────
alter table public.supplier add column if not exists iban_set_at timestamptz;
alter table public.supplier add column if not exists iban_set_by uuid;
alter table public.supplier add column if not exists iban_set_by_name text;
alter table public.supplier add column if not exists iban_unconfirmed_invoice_id uuid;
comment on column public.supplier.iban_set_at is 'PC01 · E2b · Cuándo se puso el IBAN donde no había (a mano, con «Poner IBAN» o leído de una factura).';
comment on column public.supplier.iban_set_by_name is 'PC01 · E2b · Quién puso el IBAN donde no había («Sumied» si se leyó de una factura).';
comment on column public.supplier.iban_unconfirmed_invoice_id is
  'PC01 · E2b · El IBAN de la ficha se leyó de esta factura y nadie lo ha confirmado: para la remesa hasta confirmarlo.';

-- ── 1 · ¿Es un IBAN de verdad? (ISO 13616, módulo 97) ──────────────────────
create or replace function public._pc01e2b_iban_valido(p text)
returns boolean language plpgsql immutable set search_path = public as $$
declare s text := public._pc01e2_iban(p); r text; n text := ''; c text; i int;
begin
  if s is null or s !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then return false; end if;
  if left(s, 2) = 'ES' and length(s) <> 24 then return false; end if;
  r := substr(s, 5) || left(s, 4);
  for i in 1..length(r) loop
    c := substr(r, i, 1);
    n := n || case when c ~ '[A-Z]' then (ascii(c) - 55)::text else c end;
  end loop;
  return n::numeric % 97 = 1;
end $$;
revoke all on function public._pc01e2b_iban_valido(text) from public, anon;
grant execute on function public._pc01e2b_iban_valido(text) to authenticated;

-- ── 2 · El lector guarda la forma de pago y el IBAN de cada factura nueva ──
-- La de la d06 (20261207T0800), con cuatro cambios marcados «PC01 · E2b».
CREATE OR REPLACE FUNCTION public.conta_factura_desde_lectura(p_inbox uuid, p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_in public.document_inbox;
  v_s record;
  l jsonb; f jsonb;
  v_nif text; v_prov uuid; v_rep record; v_fac uuid; v_conf text; v_texto text;
  v_doc text; v_total numeric; v_estado text; v_validada boolean;
  v_forma text; v_iban text;
begin
  select * into v_in from public.document_inbox where id = p_inbox for update;
  if v_in.id is null then raise exception 'Esa llegada no está.' using errcode = 'P0002'; end if;
  if not (coalesce(auth.role(), '') = 'service_role' or public.current_user_is_admin_or_manager_of(v_in.account_id)) then
    raise exception 'Solo un administrador o un encargado de la cuenta.' using errcode = '42501';
  end if;
  if v_in.supplier_invoice_id is not null then
    return jsonb_build_object('estado', 'factura', 'factura_id', v_in.supplier_invoice_id, 'texto', 'Ya tenía su factura.');
  end if;
  select s.id, s.validation, s.parsed_result into v_s from public.goods_receipt_ai_session s where s.id = p_session and s.account_id = v_in.account_id;
  if v_s.id is null then raise exception 'Esa lectura no es de esta cuenta.' using errcode = 'P0002'; end if;
  l := v_s.validation->'factura';
  if l is null then raise exception 'La lectura no se hizo con el modo factura.' using errcode = '22023'; end if;
  f := l->'factura';

  -- ¿Es una factura? Sin número, ni total, ni bases, no lo es.
  if f->>'numero' is null and f->>'total' is null and coalesce(jsonb_array_length(f->'tipos'), 0) = 0 then
    update public.document_inbox set status = 'no_es_factura', ai_session_id = p_session, reason = 'No he leído número, total ni bases: no parece una factura.', updated_at = now() where id = p_inbox;
    return jsonb_build_object('estado', 'no_es_factura', 'texto', 'No parece una factura: no trae número, total ni bases.');
  end if;

  -- El proveedor, por su NIF, en la cuenta.
  v_nif := f->'proveedor'->>'nif';
  select s.id into v_prov from public.supplier s
   where s.account_id = v_in.account_id and s.archived_at is null and v_nif is not null
     and regexp_replace(upper(regexp_replace(coalesce(s.tax_id, ''), '[^A-Za-z0-9]', '', 'g')), '^ES(?=[A-Z0-9]{9}$)', '') = v_nif
   order by s.created_at limit 1;

  -- ¿Repetida?
  select * into v_rep from public.supplier_invoice_repetida(v_in.account_id, v_prov, v_nif, f->>'numero', nullif(f->>'fecha', '')::date, nullif(f->>'total', '')::numeric) limit 1;
  if v_rep.nivel = 'repetida' then
    -- D06 · El PDF bueno de una que entró con foto (o sin documento): el mismo proveedor, el mismo
    -- número y el mismo total. Ocupa el sitio de la foto, que queda en su historial como documento
    -- anterior, y no se crea otra factura. No con su asiento validado: su documento va con el asiento.
    select i.raw_document_url, i.grand_total, i.status,
           exists (select 1 from public.journal_entry e where e.account_id = i.account_id and e.source_type = 'supplier_invoice'
                     and e.source_id = i.id and e.status = 'validado')
      into v_doc, v_total, v_estado, v_validada
      from public.supplier_invoice i where i.id = v_rep.invoice_id and i.account_id = v_in.account_id for update;
    if v_in.file_path is not null and (v_in.mime_type = 'application/pdf' or v_in.file_path ~* '\.pdf$')
       and (v_doc is null or v_doc ~* '\.(jpe?g|png|webp|heic|heif)$')
       and v_total is not null and round(v_total, 2) = round(nullif(f->>'total', '')::numeric, 2)
       and v_estado not in ('anulada', 'descartada') and not v_validada then
      update public.supplier_invoice
         set raw_document_url = v_in.file_path, no_document_at = null, no_document_reason = null, no_document_by_name = null, updated_at = now()
       where id = v_rep.invoice_id;
      -- El D02: el PDF hecho de la foto ya no vale; la pasada del minuto mira el nuevo (un PDF no se convierte).
      delete from public.conta_recibida_pdf r where r.invoice_id = v_rep.invoice_id;
      insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
      values (v_in.account_id, v_rep.invoice_id, 'Folvy', 'papel',
              jsonb_build_array(jsonb_build_object('campo', 'documento', 'antes', v_doc, 'ahora', v_in.file_path,
                                                   'nombre', regexp_replace(v_in.file_path, '^.*/', ''), 'motivo', 'pdf_sustituye_foto')));
      update public.document_inbox set status = 'repetida', ai_session_id = p_session, duplicate_of_invoice_id = v_rep.invoice_id,
             reason = 'Es el PDF de la ' || coalesce(v_rep.invoice_number, 'factura') || ', que había entrado ' ||
                      case when v_doc is null then 'sin documento' else 'con una foto' end || ': lo pongo en su lugar' ||
                      case when v_doc is null then '.' else ' y la foto queda en su historial.' end, updated_at = now()
       where id = p_inbox;
      insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
      values (v_in.account_id, v_in.company_id, p_inbox, v_rep.invoice_id, 'folvy', 'corregida',
              'Ha llegado el PDF de la ' || coalesce(v_rep.invoice_number, 'factura') || ': sustituye ' ||
              case when v_doc is null then 'a la falta de documento' else 'a la foto, que queda como documento anterior' end || '. No es otra factura.',
              jsonb_build_object('pdf_sustituye_foto', true, 'antes', v_doc, 'ahora', v_in.file_path));
      return jsonb_build_object('estado', 'pdf_sustituye_foto', 'factura_id', v_rep.invoice_id,
        'texto', 'Es el PDF de la ' || coalesce(v_rep.invoice_number, 'factura') || ': ' ||
                 case when v_doc is null then 'ya tiene su documento' else 'sustituye a la foto, que queda en su historial' end || '. No se crea otra factura.');
    end if;
    update public.document_inbox set status = 'repetida', ai_session_id = p_session, duplicate_of_invoice_id = v_rep.invoice_id,
           reason = 'Ya está: el mismo proveedor y el mismo número (' || coalesce(v_rep.invoice_number, '') || '). No la apunto dos veces.', updated_at = now()
     where id = p_inbox;
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text)
    values (v_in.account_id, v_in.company_id, p_inbox, v_rep.invoice_id, 'folvy', 'repetida', 'Repetida: ya estaba la ' || coalesce(v_rep.invoice_number, 'factura') || '. No la he apuntado dos veces.');
    return jsonb_build_object('estado', 'repetida', 'factura_id', v_rep.invoice_id, 'texto', 'Ya estaba la ' || coalesce(v_rep.invoice_number, 'factura') || ': no se apunta dos veces.');
  end if;

  v_conf := case when v_prov is null then 'duda' else l->>'confianza' end;
  -- PC01 · E2b · La forma de pago y el IBAN que trae el papel. El IBAN solo se guarda si es para
  -- pagarle por transferencia (o no lo dice), pasa el control y no es de una cuenta nuestra: en una
  -- domiciliada, o con tarjeta o al contado, el IBAN que sale suele ser el NUESTRO, el del cargo.
  v_forma := case when f->>'forma' in ('transfer', 'direct_debit', 'card', 'cash') then f->>'forma' end;
  v_iban := public._pc01e2_iban(f->>'iban');
  if v_iban is not null and (coalesce(v_forma, 'transfer') <> 'transfer' or not public._pc01e2b_iban_valido(v_iban)
     or exists (select 1 from public.treasury_account t where t.account_id = v_in.account_id and public._pc01e2_iban(t.iban) = v_iban)) then
    v_iban := null;
  end if;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, due_date, status, source, ai_session_id,
                                       raw_document_url, tax_base_total, tax_total, surcharge_total, grand_total, withholding_amount,
                                       needs_review, notes, created_by_name, arrival_channel, reading, reading_confidence, inbox_id,
                                       read_iban, payment_method)
  values (v_in.account_id, v_in.company_id, v_prov,
          case when f->>'clase' = 'rectificativa' or nullif(f->>'total', '')::numeric < 0 then 'credit_note' else 'invoice' end,
          f->>'numero', nullif(f->>'fecha', '')::date, nullif(f->>'vencimiento', '')::date, 'en_revision', 'ocr', p_session,
          v_in.file_path, nullif(f->>'base', '')::numeric, nullif(f->>'cuota', '')::numeric, nullif(f->>'recargo', '')::numeric, nullif(f->>'total', '')::numeric,
          nullif(f->'retencion'->>'importe', '')::numeric,
          v_conf <> 'seguro',
          case when v_rep.nivel = 'posible' then '¿Repetida? El mismo proveedor, la misma fecha y el mismo total que la ' || coalesce(v_rep.invoice_number, 'sin número') || '.' end,
          'Folvy', v_in.channel, l, v_conf, p_inbox,
          v_iban, v_forma)
  returning id into v_fac;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount, surcharge_pct, surcharge_amount)
  select v_in.account_id, v_fac, (t->>'tipo')::numeric, (t->>'base')::numeric, (t->>'cuota')::numeric, nullif(t->>'recargoTipo', '')::numeric, coalesce(nullif(t->>'recargo', '')::numeric, 0)
    from jsonb_array_elements(coalesce(f->'tipos', '[]'::jsonb)) t;
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position)
  select v_fac, coalesce(x->>'raw_text', '—'), nullif(x->>'quantity', '')::numeric, nullif(x->>'unit_price_net', '')::numeric,
         nullif(x->>'line_amount', '')::numeric, nullif(x->>'vat_pct', '')::numeric, o::int
    from jsonb_array_elements(coalesce(v_s.parsed_result->'lines', '[]'::jsonb)) with ordinality as e(x, o);

  update public.document_inbox set status = 'factura', ai_session_id = p_session, supplier_invoice_id = v_fac,
         reason = case when v_prov is null then 'No tengo a este proveedor: lo doy de alta con lo leído si me dices que sí.' end, updated_at = now()
   where id = p_inbox;
  v_texto := 'He leído la ' || coalesce(f->>'numero', 'factura') || coalesce(' de ' || (f->'proveedor'->>'nombre'), '') ||
             case v_conf when 'seguro' then ': todo cuadra.' when 'probable' then ': cuadra, pero hay algo que mirar.' else ': hay algo que aclarar.' end;
  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
  values (v_in.account_id, v_in.company_id, p_inbox, v_fac, 'folvy', 'leida', v_texto, jsonb_build_object('confianza', v_conf, 'porque', l->'porque'));
  if v_prov is null then
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text)
    values (v_in.account_id, v_in.company_id, p_inbox, v_fac, 'folvy', 'proveedor_propuesto',
            'No tengo a ' || coalesce(f->'proveedor'->>'nombre', 'este proveedor') || coalesce(' (NIF ' || v_nif || ')', '') || ': lo doy de alta con lo leído si me dices que sí.');
  end if;
  return jsonb_build_object('estado', 'factura', 'factura_id', v_fac, 'confianza', v_conf, 'texto', v_texto, 'proveedor_nuevo', v_prov is null, 'posible_repetida', v_rep.nivel = 'posible');
end $function$;


-- ── 3 · Con su proveedor: ponerle el IBAN sin confirmar, o avisar de que es otro ──
create or replace function public._pc01e2b_iban_de_la_factura()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_s public.supplier; v_leido text := public._pc01e2_iban(new.read_iban); v_ficha text;
begin
  if tg_op = 'UPDATE' and new.supplier_id is not distinct from old.supplier_id and v_leido is not distinct from public._pc01e2_iban(old.read_iban) then return null; end if;
  if new.status in ('anulada', 'descartada', 'pagada') or coalesce(new.payment_method, 'transfer') <> 'transfer' then return null; end if;
  select * into v_s from public.supplier where id = new.supplier_id and account_id = new.account_id for update;
  if v_s.id is null or v_s.archived_at is not null then return null; end if;
  -- Domiciliado, con tarjeta, al contado o prepago en su ficha, y la factura no dice otra cosa: no se le paga por transferencia.
  if new.payment_method is null and coalesce(v_s.payment_method, 'transfer') <> 'transfer' then return null; end if;
  v_ficha := public._pc01e2_iban(v_s.iban);
  if v_ficha is null then
    update public.supplier set iban = v_leido, iban_set_at = now(), iban_set_by = null, iban_set_by_name = 'Sumied',
           iban_unconfirmed_invoice_id = new.id, updated_at = now()
     where id = v_s.id;
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
    values (new.account_id, new.company_id, new.inbox_id, new.id, 'folvy', 'corregida',
            format('%s no tenía IBAN: le pongo el de esta factura (···· %s), sin confirmar. Se confirma la primera vez que se le paga por remesa.', v_s.name, right(v_leido, 4)),
            jsonb_build_object('iban_puesto', true, 'iban4', right(v_leido, 4), 'supplier_id', v_s.id));
  elsif v_ficha <> v_leido and new.iban_decision is null then
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
    values (new.account_id, new.company_id, new.inbox_id, new.id, 'folvy', 'leida',
            format('Esta factura trae otro IBAN (···· %s) que el de la ficha de %s (···· %s). No se paga hasta que alguien decida si es el nuevo.', right(v_leido, 4), v_s.name, right(v_ficha, 4)),
            jsonb_build_object('iban_distinto', true, 'iban4', right(v_leido, 4), 'ficha4', right(v_ficha, 4), 'supplier_id', v_s.id));
  end if;
  return null;
end $$;
revoke all on function public._pc01e2b_iban_de_la_factura() from public, anon, authenticated;
create or replace trigger pc01e2b_iban_de_la_factura after insert or update of supplier_id, read_iban on public.supplier_invoice
  for each row when (new.read_iban is not null and new.supplier_id is not null) execute function public._pc01e2b_iban_de_la_factura();

-- ── 4 · «Poner IBAN» desde la barra de Pagar ───────────────────────────────
create or replace function public.conta_proveedor_iban_poner(p_supplier uuid, p_iban text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s public.supplier; v_quien text := coalesce(public.conta_nombre_actor(), 'Sumied');
  v_iban text := public._pc01e2_iban(regexp_replace(coalesce(p_iban, ''), '[-.]', '', 'g'));
begin
  select * into v_s from public.supplier where id = p_supplier for update;
  if v_s.id is null or not public.current_user_is_admin_or_manager_of(v_s.account_id) then
    raise exception 'Ese proveedor no está, o no puedes cambiar su ficha.' using errcode = 'P0002';
  end if;
  if public._pc01e2_iban(v_s.iban) is not null then
    raise exception '% ya tiene IBAN (···· %): para cambiarlo, ve a su ficha.', v_s.name, right(public._pc01e2_iban(v_s.iban), 4) using errcode = '23514';
  end if;
  if v_iban is null then raise exception 'Escribe el IBAN.' using errcode = '22023'; end if;
  if not public._pc01e2b_iban_valido(v_iban) then raise exception 'Ese IBAN no es correcto: revisa los dígitos.' using errcode = '22023'; end if;
  if exists (select 1 from public.treasury_account t where t.account_id = v_s.account_id and public._pc01e2_iban(t.iban) = v_iban) then
    raise exception 'Ese IBAN es de una cuenta vuestra, no de %.', v_s.name using errcode = '23514';
  end if;
  update public.supplier set iban = v_iban, iban_set_at = now(), iban_set_by = auth.uid(), iban_set_by_name = v_quien,
         iban_unconfirmed_invoice_id = null, updated_at = now()
   where id = p_supplier;
  return jsonb_build_object('iban4', right(v_iban, 4),
    'frase', format('IBAN de %s puesto (···· %s). Queda apuntado: %s, el %s a las %s.', v_s.name, right(v_iban, 4), v_quien,
                    to_char(now() at time zone 'Europe/Madrid', 'DD/MM'), to_char(now() at time zone 'Europe/Madrid', 'HH24:MI')));
end $$;
revoke all on function public.conta_proveedor_iban_poner(uuid, text) from public, anon;
grant execute on function public.conta_proveedor_iban_poner(uuid, text) to authenticated;
comment on function public.conta_proveedor_iban_poner(uuid, text) is
  'PC01 · E2b · «Poner IBAN» en la barra de Pagar: a un proveedor sin IBAN, comprobado (módulo 97) y con quién y cuándo.';

-- ── 5 · El disparador del E2 en supplier: también quién pone un IBAN donde no había ──
create or replace function public._pc01e2_proveedor_iban_cambiado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public._pc01e2_iban(old.iban) is not null and public._pc01e2_iban(new.iban) is distinct from public._pc01e2_iban(old.iban)
     and new.iban_changed_at is not distinct from old.iban_changed_at then
    new.iban_previous := old.iban;
    new.iban_changed_at := now();
    new.iban_changed_by := auth.uid();
    new.iban_changed_by_name := coalesce(public.conta_nombre_actor(), 'Sumied');
  end if;
  -- PC01 · E2b · Quién pone un IBAN donde no había (si no lo dice ya quien lo pone).
  if public._pc01e2_iban(old.iban) is null and public._pc01e2_iban(new.iban) is not null and new.iban_set_at is not distinct from old.iban_set_at then
    new.iban_set_at := now();
    new.iban_set_by := auth.uid();
    new.iban_set_by_name := coalesce(public.conta_nombre_actor(), 'Sumied');
  end if;
  -- PC01 · E2b · Si alguien pone otro, el leído de una factura deja de estar «sin confirmar».
  if public._pc01e2_iban(new.iban) is distinct from public._pc01e2_iban(old.iban) and new.iban_unconfirmed_invoice_id is not distinct from old.iban_unconfirmed_invoice_id then
    new.iban_unconfirmed_invoice_id := null;
  end if;
  return new;
end $$;
revoke all on function public._pc01e2_proveedor_iban_cambiado() from public, anon, authenticated;

-- ── 6 · Un IBAN sin confirmar para la remesa como uno que ha cambiado ──────
create or replace function public._pc01e2_iban_como_esta(p_supplier uuid, p_iban text)
returns table (estado text, nota text) language plpgsql stable security definer set search_path = public as $$
declare v_s public.supplier; v_antes text[];
begin
  select * into v_s from public.supplier where id = p_supplier;
  select array_agg(distinct l.iban) into v_antes from public.conta_pago_remesa_linea_estado l
   where l.supplier_id = p_supplier and l.estado = 'pagada' and l.iban is not null;
  if v_antes is not null and not (p_iban = any(v_antes)) then
    return query select 'cambiado'::text, format('No coincide con el de sus pagos anteriores (···· %s).', right(v_antes[1], 4)); return;
  end if;
  -- PC01 · E2b · Leído de una factura y sin confirmar: se para como uno que ha cambiado.
  if v_s.iban_unconfirmed_invoice_id is not null and public._pc01e2_iban(v_s.iban) = p_iban then
    return query select 'cambiado'::text, format('Sin confirmar: lo leí de la factura %s el %s.',
      coalesce((select i.invoice_number from public.supplier_invoice i where i.id = v_s.iban_unconfirmed_invoice_id), 'de este proveedor'),
      coalesce(to_char(v_s.iban_set_at at time zone 'Europe/Madrid', 'DD/MM'), '—')); return;
  end if;
  if v_s.iban_changed_at is not null and v_s.iban_changed_at > now() - interval '30 days' then
    return query select 'cambiado'::text, format('El IBAN de su ficha cambió el %s%s.', to_char(v_s.iban_changed_at at time zone 'Europe/Madrid', 'DD/MM'),
      case when v_s.iban_previous is not null then format(' (antes, ···· %s)', right(public._pc01e2_iban(v_s.iban_previous), 4)) else '' end); return;
  end if;
  if v_antes is not null or (v_s.iban_verified_at is not null and (v_s.iban_changed_at is null or v_s.iban_verified_at > v_s.iban_changed_at)) then
    return query select 'comprobado'::text, null::text; return;
  end if;
  return query select 'primer_pago'::text, 'Primer pago a este IBAN desde Sumied.'::text;
end $$;
revoke all on function public._pc01e2_iban_como_esta(uuid, text) from public, anon, authenticated;

-- ── 7 · La remesa no admite una factura con otro IBAN sin decidir ──────────
create or replace function public.conta_remesa_pagos_crear(p_company uuid, p_treasury uuid, p_fecha date, p_facturas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public._pc01e2_empresa(p_company); v_t public.treasury_account; v_r uuid; v_code text;
  v_f jsonb; v_inv public.supplier_invoice; v_s public.supplier; v_pend numeric; v_imp numeric; v_iban text; v_metodo text;
  v_chk record; v_l uuid; v_n int := 0; v_total numeric := 0; v_conf int := 0; v_vistas uuid[] := '{}';
begin
  select * into v_t from public.treasury_account where id = p_treasury and company_id = p_company and is_active;
  if v_t.id is null then raise exception 'Esa cuenta del banco no es de la empresa.' using errcode = '23514'; end if;
  if public._pc01e2_iban(v_t.iban) is null then raise exception 'La cuenta «%» no tiene IBAN: el banco no sabría de dónde sacar el dinero.', v_t.name using errcode = '23514'; end if;
  if p_fecha is null then raise exception 'Falta la fecha de pago.' using errcode = '22023'; end if;
  if p_fecha < public.conta_hoy() then raise exception 'La fecha de pago no puede ser anterior a hoy.' using errcode = '22023'; end if;
  if jsonb_typeof(p_facturas) <> 'array' or jsonb_array_length(p_facturas) = 0 then raise exception 'Elige al menos una factura.' using errcode = '22023'; end if;
  v_code := public._pc01e2_codigo(p_company, p_fecha);
  insert into public.conta_pago_remesa (account_id, company_id, code, kind, treasury_account_id, pay_date, created_by, created_by_name)
  values (v_cuenta, p_company, v_code, 'fichero', p_treasury, p_fecha, auth.uid(), coalesce(public.conta_nombre_actor(), 'Sumied'))
  returning id into v_r;
  for v_f in select * from jsonb_array_elements(p_facturas) loop
    select * into v_inv from public.supplier_invoice where id = (v_f->>'id')::uuid and account_id = v_cuenta for update;
    if v_inv.id is null or coalesce(v_inv.company_id, p_company) <> p_company then raise exception 'Esa factura no es de la empresa.' using errcode = '23514'; end if;
    if v_inv.id = any(v_vistas) then raise exception 'La factura % está dos veces.', coalesce(v_inv.invoice_number, '') using errcode = '23514'; end if;
    v_vistas := v_vistas || v_inv.id;
    if v_inv.status <> 'aprobada' then raise exception 'La factura % no está por pagar (está %).', coalesce(v_inv.invoice_number, ''), v_inv.status using errcode = '23514'; end if;
    select * into v_s from public.supplier where id = v_inv.supplier_id;
    v_metodo := coalesce(v_inv.payment_method, v_s.payment_method);
    if v_metodo in ('direct_debit', 'card', 'prepaid', 'cash') then
      raise exception 'La factura % de % no se paga por remesa: %.', coalesce(v_inv.invoice_number, ''), coalesce(v_s.name, 'su proveedor'),
        case v_metodo when 'direct_debit' then 'la paga el banco solo (domiciliada)' when 'card' then 'se paga con tarjeta' when 'prepaid' then 'se paga del saldo prepago' else 'se paga en efectivo' end
        using errcode = '23514';
    end if;
    v_iban := public._pc01e2_iban(v_s.iban);
    if v_iban is null then raise exception '% no tiene IBAN en su ficha: pónselo con «Poner IBAN» en la barra de Pagar.', coalesce(v_s.name, 'Su proveedor') using errcode = '23514'; end if;
    -- PC01 · E2b · La factura trae otro IBAN y nadie ha decidido: antes paraba al casar el cargo (freno de la C01b); ahora, aquí.
    if public._pc01e2_iban(v_inv.read_iban) is not null and v_inv.iban_decision is null and public._pc01e2_iban(v_inv.read_iban) <> v_iban then
      raise exception 'La factura % trae otro IBAN (···· %) que el de la ficha de % (···· %): decide en su ficha si es el nuevo antes de pagarla.',
        coalesce(v_inv.invoice_number, ''), right(public._pc01e2_iban(v_inv.read_iban), 4), v_s.name, right(v_iban, 4) using errcode = '23514';
    end if;
    if public._pc01e2_cuenta_proveedor(p_company, v_s.id) is null then
      raise exception '% no tiene su cuenta de proveedor (400) en el plan: sin ella el pago no tendría asiento.', v_s.name using errcode = '23514';
    end if;
    select pendiente into v_pend from public.conta_recibida_pago where invoice_id = v_inv.id;
    v_pend := coalesce(v_pend, 0) - public._pc01e2_en_remesa(v_inv.id);
    v_imp := coalesce(nullif(v_f->>'importe', '')::numeric, v_pend);
    if v_imp <= 0 or v_imp > v_pend + 0.005 then
      raise exception 'La factura % tiene pendientes % sin remesa: no se le pueden pagar %.', coalesce(v_inv.invoice_number, ''),
        public.conta_euros_exactos(greatest(v_pend, 0)), public.conta_euros_exactos(v_imp) using errcode = '23514';
    end if;
    select * into v_chk from public._pc01e2_iban_como_esta(v_s.id, v_iban);
    insert into public.conta_pago_remesa_linea (account_id, company_id, remesa_id, invoice_id, supplier_id, amount, iban, iban_check, iban_note)
    values (v_cuenta, p_company, v_r, v_inv.id, v_s.id, v_imp, v_iban, v_chk.estado, v_chk.nota) returning id into v_l;
    if v_chk.estado = 'cambiado' then
      v_conf := v_conf + 1;
      perform public._pc01e2_evento(v_cuenta, v_r, v_l, format('El IBAN de %s no se ha confirmado: %s Se para hasta confirmarlo.', v_s.name, v_chk.nota));
    end if;
    v_n := v_n + 1; v_total := v_total + v_imp;
  end loop;
  perform public._pc01e2_evento(v_cuenta, v_r, null, format('Prepara la remesa con %s %s por %s, desde %s, para pagar el %s.',
    v_n, case when v_n = 1 then 'factura' else 'facturas' end, public.conta_euros_exactos(v_total), v_t.name, to_char(p_fecha, 'DD/MM/YYYY')));
  return jsonb_build_object('remesa', v_r, 'codigo', v_code, 'pagos', v_n, 'total', v_total, 'por_confirmar', v_conf,
    'frase', format('Remesa %s preparada: %s %s, %s.%s', v_code, v_n, case when v_n = 1 then 'pago' else 'pagos' end, public.conta_euros_exactos(v_total),
      case when v_conf = 0 then ' Ya puedes descargar el fichero para el banco.'
           when v_conf = 1 then ' Antes de descargar el fichero, confirma 1 IBAN que ha cambiado.'
           else format(' Antes de descargar el fichero, confirma %s IBAN que han cambiado.', v_conf) end));
end $$;
revoke all on function public.conta_remesa_pagos_crear(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.conta_remesa_pagos_crear(uuid, uuid, date, jsonb) to authenticated;
comment on function public.conta_remesa_pagos_crear(uuid, uuid, date, jsonb) is
  'PC01 · E2 · «Pagar N facturas»: prepara la remesa de transferencias. Para sin crear nada si una factura no se puede pagar por remesa, y dice por qué.';

-- ── 8 · Confirmarlo en la remesa lo deja confirmado en la ficha ────────────
create or replace function public.conta_remesa_iban_confirmar(p_linea uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.conta_pago_remesa_linea_estado := public._pc01e2_linea(p_linea); v_s text;
begin
  -- Respuesta 7: también el de un primer pago (no para la remesa, pero sin confirmar su asiento no se valida solo).
  if not (v.estado = 'por_confirmar' or (v.estado = 'pendiente' and v.iban_check = 'primer_pago' and v.iban_confirmed_at is null)) then
    raise exception 'Ese IBAN no está esperando confirmación.' using errcode = '23514';
  end if;
  update public.conta_pago_remesa_linea set iban_confirmed_at = now(), iban_confirmed_by = auth.uid(),
         iban_confirmed_by_name = coalesce(public.conta_nombre_actor(), 'Sumied') where id = p_linea;
  -- PC01 · E2b · Si era el leído de una factura, queda confirmado en la ficha.
  update public.supplier set iban_unconfirmed_invoice_id = null
   where id = v.supplier_id and iban_unconfirmed_invoice_id is not null and public._pc01e2_iban(iban) = v.iban;
  select name into v_s from public.supplier where id = v.supplier_id;
  perform public._pc01e2_evento(v.account_id, v.remesa_id, p_linea, format('Confirma el IBAN ···· %s de %s.', right(v.iban, 4), coalesce(v_s, '—')));
  return jsonb_build_object('frase', format('IBAN de %s confirmado (···· %s). Queda apuntado quién y cuándo.', coalesce(v_s, 'su proveedor'), right(v.iban, 4)));
end $$;
revoke all on function public.conta_remesa_iban_confirmar(uuid) from public, anon;
grant execute on function public.conta_remesa_iban_confirmar(uuid) to authenticated;

-- ── 9 · La lista de Pagos: el IBAN distinto y el sin confirmar ─────────────
create or replace function public.conta_pagos_lista(p_company uuid, p_mes date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with f as (
    select si.id, si.supplier_id, s.name as proveedor, si.invoice_number as numero, si.invoice_date as fecha, rp.vence, rp.total, rp.pagado, rp.pendiente,
           rp.estado, rp.dias_vencida, coalesce(si.payment_method, s.payment_method) as forma, si.location_id, lo.name as local,
           right(public._pc01e2_iban(s.iban), 4) as iban4, (public._pc01e2_iban(s.iban) is not null) as con_iban,
           (s.iban_unconfirmed_invoice_id is not null) as iban_sin_confirmar, right(public._pc01e2_iban(si.read_iban), 4) as iban_leido4,
           (public._pc01e2_iban(si.read_iban) is not null and si.iban_decision is null and public._pc01e2_iban(s.iban) is not null
              and public._pc01e2_iban(si.read_iban) <> public._pc01e2_iban(s.iban)) as iban_distinto,
           exists (select 1 from public.company_account_link l where l.company_id = p_company and l.entity = 'supplier' and l.entity_id = s.id::text and l.role = 'principal') as con_cuenta,
           s.payment_terms_days as plazo,
           (select jsonb_build_object('id', r.id, 'codigo', r.code, 'importe', sum(l.amount))
              from public.conta_pago_remesa_linea_estado l join public.conta_pago_remesa r on r.id = l.remesa_id
             where l.invoice_id = si.id and l.estado in ('pendiente', 'por_confirmar') group by r.id, r.code order by r.code desc limit 1) as remesa
      from public.supplier_invoice si
      join public.conta_recibida_pago rp on rp.invoice_id = si.id
      left join public.supplier s on s.id = si.supplier_id
      left join public.locations lo on lo.id = si.location_id
     where si.account_id = (select account_id from public.company where id = p_company)
       and coalesce(si.company_id, p_company) = p_company
       and si.status in ('aprobada', 'pagada')
  )
  select jsonb_build_object(
    'filas', coalesce((select jsonb_agg(to_jsonb(f) order by f.vence nulls last, f.fecha) from f), '[]'::jsonb),
    'pagado_mes', (select coalesce(sum(p.amount), 0) from public.supplier_invoice_payment p join f on f.id = p.invoice_id
                    where p.entry_id is not null and p.paid_on >= date_trunc('month', p_mes)::date and p.paid_on < (date_trunc('month', p_mes) + interval '1 month')::date),
    'pagadas_mes', (select count(distinct p.invoice_id) from public.supplier_invoice_payment p join f on f.id = p.invoice_id
                     where p.entry_id is not null and p.paid_on >= date_trunc('month', p_mes)::date and p.paid_on < (date_trunc('month', p_mes) + interval '1 month')::date),
    'sin_plazo', coalesce((select jsonb_agg(distinct jsonb_build_object('id', f.supplier_id, 'nombre', f.proveedor))
                            from f where f.estado = 'sin_vencimiento' and f.plazo is null and f.supplier_id is not null), '[]'::jsonb))
$$;
grant execute on function public.conta_pagos_lista(uuid, date) to authenticated;
comment on function public.conta_pagos_lista(uuid, date) is 'PC01 · E2 · Compras › Pagos: las recibidas por pagar y pagadas de la empresa, con su estado, su remesa y lo pagado en el mes.';
