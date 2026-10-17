-- supabase/migrations/20261121T0160_s01_factura_descartada.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261121_s01_factura_descartada_prueba.sql
-- cambia: public.tg_supplier_invoice_no_repetida · prueba: supabase/staging/sql/20261121_s01_factura_descartada_prueba.sql
-- cambia: public.conta_documentos_recibidos · prueba: supabase/staging/sql/20261121_s01_factura_descartada_prueba.sql
--
-- S01 · «No es una factura» (maqueta 3; decisión 1 de Julio, 17/10): un
-- estado «descartada» con su motivo, quién y cuándo. Sale de «para revisar» y
-- se puede deshacer. Nada se borra.
--
--   1. AÑADE en supplier_invoice: discarded_at, discarded_by,
--      discarded_by_name, discard_reason y status_before_discard (nulas), y una
--      restricción: descartada ⇔ con fecha y motivo.
--   2. CAMBIA el CHECK de status (supplier_invoice_status_check): solo amplía,
--      con 'descartada'. Todo lo que lee por estados concretos (las propuestas
--      del libro, banco_facturas_recibidas_pendientes, Bancos) la deja fuera sin
--      tocarlo.
--   3. AÑADE conta_factura_descartar(p_invoice, p_motivo, p_quien_nombre) y
--      conta_factura_recuperar(p_invoice, p_quien_nombre): con el mismo permiso
--      que tocar la factura (ser de la cuenta), y cada una deja su línea en
--      document_activity («descartada»; «deshecha», con undo_of). No descarta
--      una pagada, con asiento vivo o con un pago casado en Bancos.
--   4. CAMBIA en caliente tg_supplier_invoice_no_repetida (misma firma; cuerpo
--      de producción, md5 a69d2408…): una descartada cuenta como una anulada.
--      Ni bloquea a la buena que llegue después con el mismo número y total,
--      ni se recupera si ya hay otra igual (para, como al desanular).
--   5. CAMBIA en caliente conta_documentos_recibidos (misma firma; cuerpo de
--      producción, md5 ea1dd614…): la descartada sale en N22 con su estado
--      «descartada» y su porqué, no en «para mirar» (regla 7: no se esconde).
--
-- Vuelta atrás: supabase/vuelta-atras/20261121T0160_s01_factura_descartada.down.sql
-- (para si hay alguna descartada: se perdería por qué).

alter table public.supplier_invoice
  add column if not exists discarded_at timestamptz,
  add column if not exists discarded_by uuid,
  add column if not exists discarded_by_name text,
  add column if not exists discard_reason text,
  add column if not exists status_before_discard text;
comment on column public.supplier_invoice.discard_reason is 'S01 (0160): por qué no es una factura («Es un albarán», «Es un presupuesto»…). Con discarded_at/by/by_name; status_before_discard es el estado al que vuelve al recuperarla.';

alter table public.supplier_invoice drop constraint if exists supplier_invoice_status_check;
alter table public.supplier_invoice add constraint supplier_invoice_status_check
  check (status = any (array['borrador', 'en_revision', 'aprobada', 'con_discrepancias', 'pagada', 'anulada', 'descartada']));
alter table public.supplier_invoice drop constraint if exists supplier_invoice_descartada_con_motivo;
alter table public.supplier_invoice add constraint supplier_invoice_descartada_con_motivo
  check ((status = 'descartada') = (discarded_at is not null and length(trim(coalesce(discard_reason, ''))) > 0 and status_before_discard is not null));

create or replace function public.conta_factura_descartar(p_invoice uuid, p_motivo text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.supplier_invoice; v_act uuid; v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
begin
  select * into v_f from public.supplier_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then
    raise exception 'Esa factura no está.' using errcode = 'P0002';
  end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Dime por qué no es una factura.' using errcode = '22023'; end if;
  if v_f.status = 'descartada' then raise exception 'Ya estaba descartada.' using errcode = '22023'; end if;
  if v_f.status in ('pagada', 'anulada') then
    raise exception 'Está %: no se descarta.', v_f.status using errcode = '22023';
  end if;
  if exists (select 1 from public.journal_entry e where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice' and e.source_id = v_f.id
              and e.status in ('propuesto', 'borrador', 'validado')) then
    raise exception 'Tiene su asiento: anúlalo o descártalo en el libro antes.' using errcode = '22023';
  end if;
  if exists (select 1 from public.bank_match_item i join public.bank_match b on b.id = i.match_id
              where i.supplier_invoice_id = v_f.id and b.status = 'vivo') then
    raise exception 'Tiene un pago casado en Bancos: deshazlo allí antes.' using errcode = '22023';
  end if;
  update public.supplier_invoice
     set status_before_discard = status, status = 'descartada', discarded_at = now(), discarded_by = auth.uid(),
         discarded_by_name = v_quien, discard_reason = trim(p_motivo), updated_at = now()
   where id = v_f.id;
  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, actor_name, action, text, detail)
  values (v_f.account_id, v_f.company_id, v_f.inbox_id, v_f.id, 'persona', v_quien, 'descartada',
          'No es una factura: ' || trim(p_motivo) || '.', jsonb_build_object('antes', v_f.status))
  returning id into v_act;
  return jsonb_build_object('id', v_f.id, 'antes', v_f.status, 'actividad', v_act);
end $$;
comment on function public.conta_factura_descartar(uuid, text, text) is 'S01 (0160): «No es una factura». La deja descartada con su motivo, quién y cuándo, y lo apunta en document_activity. Se deshace con conta_factura_recuperar.';
revoke all on function public.conta_factura_descartar(uuid, text, text) from public, anon;
grant execute on function public.conta_factura_descartar(uuid, text, text) to authenticated;

create or replace function public.conta_factura_recuperar(p_invoice uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.supplier_invoice; v_desc uuid; v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
begin
  select * into v_f from public.supplier_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then
    raise exception 'Esa factura no está.' using errcode = 'P0002';
  end if;
  if v_f.status <> 'descartada' then raise exception 'No está descartada.' using errcode = '22023'; end if;
  -- Vuelve al estado de antes. Si ya hay otra igual, el disparador de repetidas lo para (23505).
  update public.supplier_invoice
     set status = v_f.status_before_discard, status_before_discard = null, discarded_at = null, discarded_by = null,
         discarded_by_name = null, discard_reason = null, updated_at = now()
   where id = v_f.id;
  select id into v_desc from public.document_activity
   where supplier_invoice_id = v_f.id and action = 'descartada' order by created_at desc limit 1;
  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, actor_name, action, text, detail, undo_of)
  values (v_f.account_id, v_f.company_id, v_f.inbox_id, v_f.id, 'persona', v_quien, 'deshecha',
          'Era una factura: vuelve a «' || v_f.status_before_discard || '» (la había descartado ' || coalesce(v_f.discarded_by_name, 'una persona')
            || ' el ' || to_char(v_f.discarded_at at time zone 'Europe/Madrid', 'DD/MM/YYYY') || ': ' || v_f.discard_reason || ').',
          jsonb_build_object('vuelve_a', v_f.status_before_discard, 'motivo', v_f.discard_reason), v_desc);
  return jsonb_build_object('id', v_f.id, 'estado', v_f.status_before_discard);
end $$;
comment on function public.conta_factura_recuperar(uuid, text) is 'S01 (0160): deshace «No es una factura»: vuelve al estado de antes y lo apunta en document_activity (deshecha, con undo_of).';
revoke all on function public.conta_factura_recuperar(uuid, text) from public, anon;
grant execute on function public.conta_factura_recuperar(uuid, text) to authenticated;

-- 4 · Repetidas: una descartada cuenta como una anulada.
create or replace function public.tg_supplier_invoice_no_repetida()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_otra public.supplier_invoice;
  v_k text := public.conta_clave_numero(new.invoice_number);
begin
  if new.status in ('anulada', 'descartada') or new.not_duplicate_confirmed_at is not null or new.supplier_id is null
     or v_k is null or new.grand_total is null then return new; end if;
  -- En un cambio, solo si cambia lo que decide (número, proveedor, total o que deje de estar anulada o descartada).
  if tg_op = 'UPDATE' and v_k is not distinct from public.conta_clave_numero(old.invoice_number)
     and new.supplier_id is not distinct from old.supplier_id
     and round(new.grand_total * 100) is not distinct from round(old.grand_total * 100)
     and not (old.status in ('anulada', 'descartada') and new.status not in ('anulada', 'descartada')) then return new; end if;
  select * into v_otra from public.supplier_invoice i
   where i.account_id = new.account_id and i.supplier_id = new.supplier_id
     and public.conta_clave_numero(i.invoice_number) = v_k
     and round(i.grand_total * 100) = round(new.grand_total * 100)
     and i.id <> new.id and i.status not in ('anulada', 'descartada') and i.not_duplicate_confirmed_at is null
   order by i.created_at limit 1;
  if v_otra.id is not null then
    raise exception 'Repetida: ya está la factura % de este proveedor (%), con el mismo total. No entra dos veces; si no es la misma, márcala «No es repetida».',
      v_otra.invoice_number, coalesce(v_otra.code, v_otra.id::text) using errcode = '23505';
  end if;
  return new;
end $$;

-- 5 · N22: la descartada sale con su estado y su porqué.
create or replace function public.conta_documentos_recibidos(p_company uuid, p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_filas jsonb;
  v_esperadas jsonb;
  v_correo record;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'El periodo no es válido.' using errcode = '22023';
  end if;

  with facturas as (
    select i.*, s.name as proveedor_nombre,
           (select jsonb_build_object('id', e.id, 'estado', e.status, 'solo', coalesce(e.validated_by_name, '') like 'Folvy (apunta solo%')
              from public.journal_entry e
             where e.account_id = v_acc and e.company_id = p_company and e.source_type = 'supplier_invoice' and e.source_id = i.id
               and e.status in ('propuesto', 'borrador', 'validado')
             order by (e.status = 'validado') desc, e.created_at desc limit 1) as asiento,
           (select jsonb_build_object('fecha', gr.receipt_date, 'local', l.name)
              from public.supplier_invoice_receipt r join public.goods_receipt gr on gr.id = r.goods_receipt_id
              left join public.locations l on l.id = gr.location_id
             where r.supplier_invoice_id = i.id order by gr.receipt_date desc limit 1) as recepcion,
           -- R5 · 6: cuántas facturas suyas había antes de esta (para decir «es la primera»).
           (select count(*) from public.supplier_invoice p
             where p.account_id = v_acc and p.supplier_id = i.supplier_id and p.id <> i.id and p.status not in ('anulada', 'descartada')
               and (coalesce(p.invoice_date, (p.created_at at time zone 'Europe/Madrid')::date), p.created_at) < (coalesce(i.invoice_date, (i.created_at at time zone 'Europe/Madrid')::date), i.created_at)) as previas,
           -- R5 · 7: el fichero de la llegada (una foto o un PDF), para decir cómo llegó de verdad.
           (select d.mime_type from public.document_inbox d where d.id = i.inbox_id and d.account_id = v_acc) as llegada_tipo
      from public.supplier_invoice i
      left join public.supplier s on s.id = i.supplier_id and s.account_id = i.account_id
     where i.account_id = v_acc and (i.company_id = p_company or i.company_id is null)
       and i.status <> 'anulada'
       and coalesce(i.invoice_date, (i.created_at at time zone 'Europe/Madrid')::date) between p_desde and p_hasta
  ), gasto0 as (
    -- Lo que Folvy ha entendido: la cuenta del asiento si lo hay; si no, la de la ficha.
    select f.id, f.supplier_id,
           coalesce(
             (select jsonb_build_object('cuenta', a.code, 'nombre', a.name, 'origen', 'del asiento')
                from public.journal_line l join public.company_account a on a.id = l.company_account_id
               where l.entry_id = (f.asiento->>'id')::uuid and a.code like '6%' and l.debit > 0 order by l.position limit 1),
             (select jsonb_build_object('cuenta', a.code, 'nombre', a.name, 'origen', 'de su ficha')
                from public.company_account_link k join public.company_account a on a.id = k.company_account_id
               where k.company_id = p_company and k.entity = 'supplier' and k.entity_id = f.supplier_id::text and k.role = 'gasto' limit 1)) as entendido
      from facturas f
  ), gasto as (
    -- R5 · 6: sin cuenta en el asiento ni en la ficha, lo aprendido de sus
    -- facturas anteriores (0250), como en N23, con su porqué. Si no hay nada
    -- que aprender, también se dice (la pantalla explica qué hacer).
    select g.id, g.entendido,
           case when g.entendido is null and g.supplier_id is not null then public.conta_gasto_aprendido(p_company, g.supplier_id) end as aprendido
      from gasto0 g
  ), filas_f as (
    select jsonb_build_object(
      'id', f.id, 'tipo', 'factura',
      -- S01 (0160): la descartada sale, con su estado y su porqué (regla 7: no se esconde).
      'estado', case when f.status = 'descartada' then 'descartada'
                     when f.asiento->>'estado' = 'validado' then 'apuntada'
                     when f.supplier_id is null or f.reading_confidence = 'duda' or f.status = 'con_discrepancias' then 'por_aclarar'
                     else 'para_mirar' end,
      'proveedor', jsonb_build_object('id', f.supplier_id, 'nombre', coalesce(f.proveedor_nombre, f.reading->'factura'->'proveedor'->>'nombre')),
      'numero', f.invoice_number, 'fecha', f.invoice_date, 'total', f.grand_total,
      -- R5 · 7: por dónde llegó DE VERDAD. Sin canal apuntado: leída del papel
      -- de su recepción (Cocina), leída en Compras, o escrita a mano.
      'canal', coalesce(f.arrival_channel, case when f.source = 'ocr' and f.recepcion is not null then 'cocina' when f.source = 'ocr' then 'compras' else 'a_mano' end),
      'llegada_tipo', f.llegada_tipo,
      'previas', f.previas,
      'confianza', f.reading_confidence,
      'porque', case when f.status = 'descartada'
                  then 'No es una factura: ' || coalesce(f.discard_reason, 'sin motivo') || ' (' || coalesce(f.discarded_by_name, 'una persona') || ', ' || to_char(f.discarded_at at time zone 'Europe/Madrid', 'DD/MM/YYYY') || ').'
                  else coalesce(f.reading->'porque'->>0, case when f.supplier_id is null then 'No reconozco el emisor: dime quién es.' end) end,
      'entendido', coalesce(g.entendido, case when g.aprendido->>'cuenta' is not null then jsonb_build_object(
                     'cuenta', g.aprendido->>'cuenta', 'nombre', g.aprendido->>'nombre', 'origen', g.aprendido->>'origen', 'sin_confirmar', true) end),
      'aprendido', case when g.aprendido is not null then jsonb_build_object('cuenta', g.aprendido->>'cuenta', 'facturas', coalesce((g.aprendido->>'facturas')::int, 0),
                     'confianza', g.aprendido->>'confianza', 'porque', g.aprendido->>'porque') end,
      'recepcion', f.recepcion, 'asiento', f.asiento,
      'llego', f.created_at) as fila
      from facturas f join gasto g on g.id = f.id
  ), recepciones as (
    -- R6 · Una recepción cuyo papel es «factura» o «albarán-factura» ES una
    -- factura recibida. Desde el corte, Compras ya la hace factura con el mismo
    -- papel (0140) y sale arriba, en filas_f. Aquí, las que NO son factura:
    --   · de antes del corte: las llevó el programa anterior. Se enlazan con su
    --     asiento traído de Diez (mismo proveedor, su número en el concepto y
    --     el mismo total), nunca se apuntan otra vez (la base no deja asentar
    --     antes del corte: 0120 de C04);
    --   · desde el corte, sin factura: la recepción no pudo hacerla (su
    --     pregunta lo dice): por aclarar, no se esconde (regla 7).
    -- Lo leído es el de la recepción: no se vuelve a leer con el modelo.
    select g.id, g.receipt_date, g.supplier_id, g.raw_document_url, g.created_at, s.name as proveedor_nombre,
           a.parsed_result->'document' as doc, p.question, p.reason as camino_porque,
           upper(regexp_replace(coalesce(nullif(a.parsed_result->'document'->>'doc_number', ''), g.supplier_doc_number, ''), '[^A-Za-z0-9]', '', 'g')) as clave,
           nullif(a.parsed_result->'document'->>'grand_total', '')::numeric as total,
           exists (select 1 from public.fiscal_year y
                    where y.company_id = p_company and y.account_id = v_acc and g.receipt_date between y.starts_on and y.ends_on
                      and y.imported_until is not null and g.receipt_date <= y.imported_until) as antes_del_corte,
           (select k.company_account_id from public.company_account_link k
             where k.company_id = p_company and k.account_id = v_acc and k.entity = 'supplier' and k.entity_id = g.supplier_id::text and k.role = 'principal' limit 1) as subcuenta
      from public.goods_receipt g
      join public.goods_receipt_ai_session a on a.id = g.ai_session_id and a.account_id = g.account_id
      left join public.goods_receipt_path p on p.goods_receipt_id = g.id and p.account_id = g.account_id
      left join public.supplier s on s.id = g.supplier_id and s.account_id = g.account_id
     where g.account_id = v_acc and g.status = 'confirmado'
       and a.parsed_result->'document'->>'doc_type' in ('factura', 'albaran_factura')
       and g.receipt_date between p_desde and p_hasta
       -- De esta empresa: la del camino; sin camino (las de antes de Compras), la
       -- del NIF a cuyo nombre va el papel, o la única de la cuenta si solo hay una.
       and coalesce(p.company_id,
             (select c.id from public.company c
               where c.account_id = v_acc and nullif(regexp_replace(upper(coalesce(c.tax_id, '')), '[^A-Z0-9]', '', 'g'), '')
                     = regexp_replace(regexp_replace(upper(coalesce(a.parsed_result->'document'->>'bill_to_tax_id', '')), '[^A-Z0-9]', '', 'g'), '^ES(?=[A-Z0-9]{9}$)', '')
               limit 1),
             (select c.id from public.company c where c.account_id = v_acc and (select count(*) from public.company c2 where c2.account_id = v_acc) = 1)) = p_company
       and p.supplier_invoice_id is null
       and not exists (select 1 from public.supplier_invoice_receipt x join public.supplier_invoice si on si.id = x.supplier_invoice_id
                        where x.goods_receipt_id = g.id and si.status <> 'anulada')
  ), recepciones_diez as (
    select r.*,
           (select jsonb_build_object('id', e.id, 'serie', e.series, 'numero', e.number, 'fecha', e.entry_date)
              from public.journal_entry e join public.journal_line l on l.entry_id = e.id
             where r.antes_del_corte and e.account_id = v_acc and e.company_id = p_company and e.series = 2 and e.external_program = 'diez' and e.status = 'validado'
               and l.company_account_id = r.subcuenta and l.credit > 0 and round(l.credit * 100) = round(r.total * 100)
               -- El número de Diez va en el concepto (medido: ninguna línea traída trae su justificante), o en el justificante si lo trae.
               and length(r.clave) >= 3
               and (position(r.clave in upper(regexp_replace(coalesce(e.concept, ''), '[^A-Za-z0-9]', '', 'g'))) > 0
                    or upper(regexp_replace(coalesce(l.external_voucher, l.document_ref, ''), '[^A-Za-z0-9]', '', 'g')) = r.clave)
             order by abs(e.entry_date - r.receipt_date) limit 1) as diez
      from recepciones r
  ), filas_r as (
    select jsonb_build_object(
      'id', r.id, 'tipo', 'recepcion',
      'estado', case when r.antes_del_corte then 'en_diez' else 'por_aclarar' end,
      'proveedor', jsonb_build_object('id', r.supplier_id, 'nombre', coalesce(r.proveedor_nombre, r.doc->>'supplier_name')),
      'numero', nullif(r.doc->>'doc_number', ''), 'fecha', coalesce(nullif(r.doc->>'doc_date', '')::date, r.receipt_date), 'total', r.total,
      'canal', 'cocina', 'confianza', null,
      'porque', case
        when r.antes_del_corte and r.diez is not null then 'Es de antes del corte y ya está en Diez (asiento ' || (r.diez->>'serie') || '/' || (r.diez->>'numero') || ', mismo proveedor, número y total): no se vuelve a apuntar.'
        when r.antes_del_corte then 'Es de antes del corte: la llevó el programa anterior y no se vuelve a apuntar. No la encuentro en Diez por su número y su total: míralo allí.'
        when r.question = 'factura_sin_importes' then 'La recepción la leyó, pero el papel no trae importes por línea con su IVA: no he podido hacer la factura. Súbela o díctamela.'
        when r.question is not null then 'La recepción la leyó, pero no he podido hacer la factura: ' || coalesce(r.camino_porque, 'falta algo en la recepción') || '.'
        else 'La recepción la leyó y aún no es factura: ábrela en Compras.' end,
      'entendido', null, 'recepcion', jsonb_build_object('fecha', r.receipt_date, 'local', null),
      'asiento', case when r.diez is not null then jsonb_build_object('id', r.diez->>'id', 'estado', 'validado', 'solo', false, 'diez', true) end,
      'diez', r.diez, 'papel', r.raw_document_url,
      'llego', r.created_at) as fila
      from recepciones_diez r
  ), filas_l as (
    -- Lo que llegó y no es (todavía) una factura: por aclarar, con su motivo.
    select jsonb_build_object(
      'id', d.id, 'tipo', 'llegada',
      'estado', case when d.status = 'repetida' then 'repetida' else 'por_aclarar' end,
      'proveedor', jsonb_build_object('id', null, 'nombre', null),
      'numero', null, 'fecha', (d.created_at at time zone 'Europe/Madrid')::date, 'total', null,
      'canal', d.channel, 'confianza', null,
      'porque', coalesce(d.reason, case d.status when 'falta_pdf' then 'Falta el PDF: el correo trae un enlace.' when 'leyendo' then 'Leyéndola.' when 'recibido' then 'Recibida, sin leer todavía.' else 'Hay algo que aclarar.' end),
      'entendido', null, 'recepcion', null, 'asiento', null, 'llego', d.created_at, 'archivo', d.file_name) as fila
      from public.document_inbox d
     where d.account_id = v_acc and (d.company_id = p_company or d.company_id is null)
       and d.supplier_invoice_id is null and d.status <> 'descartado'
       and (d.created_at at time zone 'Europe/Madrid')::date between p_desde and p_hasta
  )
  select coalesce(jsonb_agg(fila order by (fila->>'llego') desc), '[]'::jsonb) into v_filas
    from (select fila from filas_f union all select fila from filas_l union all select fila from filas_r) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.periodo, x.supplier_name), '[]'::jsonb) into v_esperadas
    from public.conta_esperadas_no_llegadas(p_company, least(v_hoy, p_hasta + 1)) x;

  select a.local_part || '@' || a.domain as direccion, a.active into v_correo
    from public.company_inbound_address a where a.company_id = p_company and a.account_id = v_acc limit 1;

  return jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'correo', jsonb_build_object('activo', coalesce(v_correo.active, false), 'direccion', v_correo.direccion),
    'recibe_mercancia', public.conta_recibe_mercancia(p_company),
    'filas', v_filas,
    'esperadas', v_esperadas,
    'cifras', jsonb_build_object(
      -- R5 · 8: las del periodo elegido, no «esta semana».
      'llegadas', jsonb_array_length(v_filas),
      'llegadas_por_canal', (select coalesce(jsonb_object_agg(c, n), '{}'::jsonb) from (select f->>'canal' c, count(*) n from jsonb_array_elements(v_filas) f group by 1) y),
      'apuntadas_solas', (select count(*) from jsonb_array_elements(v_filas) f where f->>'estado' = 'apuntada' and (f->'asiento'->>'solo')::boolean),
      'apuntadas', (select count(*) from jsonb_array_elements(v_filas) f where f->>'estado' = 'apuntada'),
      'para_mirar', (select count(*) from jsonb_array_elements(v_filas) f where f->>'estado' = 'para_mirar'),
      'por_aclarar', (select count(*) from jsonb_array_elements(v_filas) f where f->>'estado' = 'por_aclarar'),
      'esperadas_no_llegadas', jsonb_array_length(v_esperadas)));
end $$;
