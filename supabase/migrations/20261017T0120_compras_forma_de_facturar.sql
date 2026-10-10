-- ============================================================================
-- Compras · 3 · CÓMO TE FACTURA CADA PROVEEDOR, Y QUÉ DICE CADA PAPEL
-- ----------------------------------------------------------------------------
-- cambia: public._supplier_merge · prueba: supabase/staging/sql/20261017_compras_camino_prueba.sql
-- cambia: public._supplier_merge_undo · prueba: supabase/staging/sql/20261017_compras_camino_prueba.sql
--
-- Encargo «Contabilidad: las compras», §2.1, §2.2 y §2.6 (10/10).
--
-- 1 · La forma de facturar es un dato de la ficha (supplier.invoicing_mode):
--       per_delivery                «Con cada entrega»: el papel que llega
--                                   con el género ya es la factura.
--       delivery_note_then_invoice  «Entrega con albarán y factura después».
--                                   Cada cuánto: invoicing_frequency (la que
--                                   ya existía); por local: invoicing_per_location.
--       monthly_settlement          «Liquidación mensual»: no factura las
--                                   entregas; cada mes una factura suya y una
--                                   tuya, y se paga la diferencia.
--     Vacío = no se sabe todavía, y se dice (compras_ficha_le_falta).
--
-- 2 · La ficha da la costumbre; CADA PAPEL decide (goods_receipt_path, una
--     fila por recepción confirmada). Lo que se lee del papel
--     (goods_receipt_ai_session.parsed_result.document):
--       · a nombre de la empresa, factura o albarán-factura → «factura»;
--       · a nombre de la empresa, albarán                    → «pendiente_factura»;
--       · a nombre de un proveedor que liquida cada mes      → «liquidacion»;
--       · a nombre de otro                                   → «a_nombre_de_otro»
--         (aviso: así no se puede deducir el IVA);
--       · a nombre de alguien que Folvy no reconoce          → «sin_decidir», y
--         la pregunta «¿a nombre de quién va?». La respuesta se RECUERDA
--         (purchase_bill_to) y vale para todos los papeles con ese nombre.
--     Si el papel no cuadra con la ficha, el camino lo pone el papel y queda
--     la pregunta «papel_y_ficha», con la opción de cambiar la costumbre. No
--     se decide en silencio.
--
--     Quién es el destinatario: primero por NIF (cuando el lector lo traiga:
--     bill_to_tax_id, tarea 2c), luego por lo recordado, luego por nombre
--     normalizado contra la razón social y el nombre comercial de las
--     empresas de la cuenta y contra los proveedores vivos. Medido en Foodint
--     el 10/10 sobre 290 papeles: 75 se reconocen como la empresa por el
--     nombre y 39 como el socio; los demás llevan el nombre de un centro o
--     del local («… EL HORNO BOUTIQUE», «LLORENTE», «KAMICHI»): unos 13
--     nombres distintos, que se preguntan una vez cada uno.
--
-- 3 · Confirmar una recepción NO puede fallar por esto (encargo §8). El
--     disparador corre DESPUÉS del cambio de estado y dentro de su propio
--     bloque de excepción: si decidir falla, la recepción se confirma igual y
--     la fila queda con camino «error» y el mensaje, que sale en «Qué tienes
--     que mirar». Y si ni eso se puede escribir, la recepción confirmada sin
--     fila de camino también sale ahí (compras_mirar, tarea 6).
--
-- 4 · La fusión de proveedores (0100) mueve también lo recordado y el camino,
--     y rellena las dos columnas nuevas: se redefine con la misma firma.
--
-- No toca stock ni coste: lee la recepción y escribe en sus tablas.
-- goods_receipt no está en el camino del pedido; el disparador es nuevo.
-- Vuelta atrás: supabase/vuelta-atras/20261017T0120_compras_forma_de_facturar.down.sql
-- ============================================================================

-- ── 1 · La forma de facturar ───────────────────────────────────────────────
alter table public.supplier add column if not exists invoicing_mode text
  constraint supplier_invoicing_mode_check check (invoicing_mode in ('per_delivery', 'delivery_note_then_invoice', 'monthly_settlement'));
alter table public.supplier add column if not exists invoicing_per_location boolean;
comment on column public.supplier.invoicing_mode is
  'Compras (10/10). Cómo te factura: per_delivery «Con cada entrega» · delivery_note_then_invoice «Entrega con albarán y factura después» · monthly_settlement «Liquidación mensual». Vacío: no se sabe. Es la costumbre: cada papel decide (goods_receipt_path).';
comment on column public.supplier.invoicing_per_location is
  'Compras (10/10). Con delivery_note_then_invoice: una factura por cada local (true) o una para todos. Cada cuánto: invoicing_frequency.';

-- ── 2 · El nombre del destinatario, normalizado ────────────────────────────
-- Minúsculas, sin acentos, sin el código de cliente delante («046935- …»),
-- sin signos y sin la forma jurídica al final («S.L.», «, SOCIEDAD
-- LIMITADA», «SL», «S.A.U.»…). Probado sobre los 24 nombres distintos de
-- Foodint (10/10): las cuatro variantes de la razón social de la empresa dan
-- lo mismo; «LLORENTE29 FOOD SL564» (mal leído) no.
create or replace function public.compras_nombre_norm(p text)
returns text language sql immutable parallel safe set search_path = public as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
    ' ' || lower(public.unaccent(coalesce(p, ''))) || ' ',
    '^\s*[0-9]+\s*-\s*', ' '),
    '[^a-z0-9]+', ' ', 'g'),
    '( (s l u|s l l|s l|s a u|s a|sl|slu|sll|sa|sau|s coop|sociedad limitada|sociedad anonima|unipersonal))+ *$', ' ', 'g')), '')
$$;
grant execute on function public.compras_nombre_norm(text) to authenticated;

create or replace function public.compras_nif_norm(p text)
returns text language sql immutable parallel safe as $$
  select nullif(regexp_replace(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g'), '^ES(?=[A-Z0-9]{9}$)', ''), '')
$$;
grant execute on function public.compras_nif_norm(text) to authenticated;

-- ── 3 · Lo recordado: a nombre de quién va un nombre ───────────────────────
create table if not exists public.purchase_bill_to (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  name_norm        text not null,
  example          text,
  company_id       uuid references public.company(id) on delete cascade,
  supplier_id      uuid references public.supplier(id) on delete cascade,
  is_other         boolean not null default false,
  decided_by       uuid,
  decided_by_name  text,
  decided_at       timestamptz not null default now(),
  constraint purchase_bill_to_uno check (num_nonnulls(company_id, supplier_id) + (case when is_other then 1 else 0 end) = 1),
  constraint purchase_bill_to_nombre unique (account_id, name_norm)
);
comment on table public.purchase_bill_to is
  'Compras (10/10). Lo que una persona contestó a «¿a nombre de quién va este papel?»: el nombre normalizado (compras_nombre_norm) va a una empresa de la cuenta, a un proveedor (el que liquida) o a otro. Vale para todos los papeles con ese nombre.';
create index if not exists purchase_bill_to_proveedor on public.purchase_bill_to (supplier_id) where supplier_id is not null;
alter table public.purchase_bill_to enable row level security;
drop policy if exists purchase_bill_to_select on public.purchase_bill_to;
create policy purchase_bill_to_select on public.purchase_bill_to for select using ((select belongs_to_account(account_id)));
-- Se escribe solo desde compras_destinatario_decide.

-- ── 4 · El camino de cada recepción ────────────────────────────────────────
create table if not exists public.goods_receipt_path (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  goods_receipt_id  uuid not null references public.goods_receipt(id) on delete cascade,
  path              text not null constraint goods_receipt_path_path_check
                      check (path in ('factura', 'pendiente_factura', 'liquidacion', 'a_nombre_de_otro', 'sin_decidir', 'anulada', 'error')),
  supplier_id       uuid references public.supplier(id),
  company_id        uuid references public.company(id),
  doc_type          text,
  bill_to_name      text,
  bill_to_tax_id    text,
  bill_to_how       text constraint goods_receipt_path_how_check
                      check (bill_to_how in ('nif', 'recordado', 'nombre', 'ficha', 'sin_dato', 'desconocido')),
  question          text constraint goods_receipt_path_question_check
                      check (question in ('a_nombre_de', 'papel_y_ficha', 'ficha_sin_forma', 'sin_papel', 'a_nombre_de_otro', 'error')),
  question_detail   jsonb,
  reason            text not null,
  error             text,
  decided_at        timestamptz not null default now(),
  consumed_at       timestamptz,
  constraint goods_receipt_path_recepcion unique (goods_receipt_id)
);
comment on table public.goods_receipt_path is
  'Compras (10/10). Por dónde va cada recepción confirmada: factura, pendiente de factura, liquidación del mes, a nombre de otro o sin decidir; con la pregunta si la hay. supplier_id: de quién es a efectos de compras (el de la recepción, o el que liquida). consumed_at: ya la usó una factura, un casado o una liquidación, y no se vuelve a decidir.';
comment on column public.goods_receipt_path.reason is 'La frase, en palabras, de por qué va por ahí.';
create index if not exists goods_receipt_path_cuenta on public.goods_receipt_path (account_id, path);
create index if not exists goods_receipt_path_proveedor on public.goods_receipt_path (supplier_id);
create index if not exists goods_receipt_path_pregunta on public.goods_receipt_path (account_id) where question is not null;
alter table public.goods_receipt_path enable row level security;
drop policy if exists goods_receipt_path_select on public.goods_receipt_path;
create policy goods_receipt_path_select on public.goods_receipt_path for select using ((select belongs_to_account(account_id)));
-- Se escribe solo desde las funciones de abajo (security definer).

-- ── 5 · Quién es el destinatario ───────────────────────────────────────────
-- kind: empresa | proveedor | otro | desconocido | sin_dato.
-- Un nombre que da DOS proveedores vivos, o dos empresas, es «desconocido»:
-- se pregunta, no se elige uno.
create or replace function public._compras_destinatario(p_cuenta uuid, p_nombre text, p_nif text)
returns table (kind text, company_id uuid, supplier_id uuid, how text)
language plpgsql stable security definer set search_path = public as $$
declare v_nif text := public.compras_nif_norm(p_nif); v_nom text := public.compras_nombre_norm(p_nombre);
        v_ids uuid[]; r purchase_bill_to;
begin
  if v_nif is not null then
    v_ids := array(select c.id from company c where c.account_id = p_cuenta and c.is_active and public.compras_nif_norm(c.tax_id) = v_nif);
    if cardinality(v_ids) = 1 then return query select 'empresa'::text, v_ids[1], null::uuid, 'nif'::text; return; end if;
    v_ids := array(select s.id from supplier s where s.account_id = p_cuenta and s.archived_at is null and public.compras_nif_norm(s.tax_id) = v_nif);
    if cardinality(v_ids) = 1 then return query select 'proveedor'::text, null::uuid, v_ids[1], 'nif'::text; return; end if;
  end if;
  if v_nom is null then
    return query select (case when v_nif is null then 'sin_dato' else 'desconocido' end)::text, null::uuid, null::uuid,
                        (case when v_nif is null then 'sin_dato' else 'desconocido' end)::text;
    return;
  end if;
  select * into r from purchase_bill_to b where b.account_id = p_cuenta and b.name_norm = v_nom;
  if r.id is not null then
    return query select (case when r.company_id is not null then 'empresa' when r.supplier_id is not null then 'proveedor' else 'otro' end)::text,
                        r.company_id, r.supplier_id, 'recordado'::text;
    return;
  end if;
  v_ids := array(select c.id from company c where c.account_id = p_cuenta and c.is_active
                   and v_nom in (public.compras_nombre_norm(c.legal_name), public.compras_nombre_norm(c.trade_name)));
  if cardinality(v_ids) = 1 then return query select 'empresa'::text, v_ids[1], null::uuid, 'nombre'::text; return; end if;
  if cardinality(v_ids) = 0 then
    v_ids := array(select s.id from supplier s where s.account_id = p_cuenta and s.archived_at is null
                     and v_nom in (public.compras_nombre_norm(s.name), public.compras_nombre_norm(s.legal_name)));
    if cardinality(v_ids) = 1 then return query select 'proveedor'::text, null::uuid, v_ids[1], 'nombre'::text; return; end if;
  end if;
  return query select 'desconocido'::text, null::uuid, null::uuid, 'desconocido'::text;
end $$;
revoke all on function public._compras_destinatario(uuid, text, text) from public, anon, authenticated;

-- ── 6 · El camino de una recepción, calculado (no escribe nada) ────────────
create or replace function public._compras_camino_calcula(p_recepcion uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  g goods_receipt; s supplier; sp supplier; d record; v_doc jsonb; v_tipo text; v_nombre text; v_nif text;
  v_unica uuid; v_es_factura boolean; v_path text; v_company uuid; v_sup uuid; v_how text;
  v_q text; v_qd jsonb; v_reason text; v_modo text; v_sugerida text;
  c_modo constant jsonb := '{"per_delivery": "con cada entrega", "delivery_note_then_invoice": "entrega con albarán y factura después", "monthly_settlement": "liquidación mensual"}';
begin
  select * into g from goods_receipt where id = p_recepcion;
  if g.id is null then raise exception 'Esa recepción no existe.' using errcode = 'P0002'; end if;
  if g.status = 'anulado' then
    return jsonb_build_object('path', 'anulada', 'supplier_id', g.supplier_id, 'reason', 'La recepción está anulada.');
  end if;
  select * into s from supplier where id = g.supplier_id;
  v_modo := s.invoicing_mode;
  v_unica := (select case when count(*) = 1 then min(c.id::text)::uuid end from company c where c.account_id = g.account_id and c.is_active);
  select a.parsed_result->'document' into v_doc from goods_receipt_ai_session a where a.id = g.ai_session_id;
  v_tipo := nullif(v_doc->>'doc_type', '');
  v_nombre := nullif(btrim(v_doc->>'bill_to_name'), '');
  v_nif := nullif(btrim(v_doc->>'bill_to_tax_id'), '');
  v_sup := g.supplier_id;

  if s.id is null then
    v_path := 'sin_decidir'; v_how := 'ficha'; v_q := 'sin_papel';
    v_reason := 'La recepción no tiene proveedor: no se sabe cómo factura.';
  elsif v_tipo is null then
    -- Sin papel leído: manda la ficha.
    v_how := 'ficha'; v_company := v_unica;
    if v_modo = 'monthly_settlement' then
      v_path := 'liquidacion'; v_reason := format('No hay papel leído; %s liquida cada mes.', s.name);
    elsif v_modo = 'delivery_note_then_invoice' then
      v_path := 'pendiente_factura'; v_reason := format('No hay papel leído; %s manda la factura después.', s.name);
    else
      v_path := 'pendiente_factura'; v_q := 'sin_papel';
      v_reason := case when v_modo = 'per_delivery'
        then format('No hay papel leído y %s factura con cada entrega: sube su factura.', s.name)
        else format('No hay papel leído y no se sabe cómo factura %s: queda pendiente de factura.', s.name) end;
    end if;
  else
    v_es_factura := v_tipo in ('factura', 'albaran_factura');
    select * into d from public._compras_destinatario(g.account_id, v_nombre, v_nif);
    v_how := d.how;
    if d.kind = 'empresa' then
      v_company := d.company_id;
      v_path := case when v_es_factura then 'factura' else 'pendiente_factura' end;
      v_reason := case when v_es_factura then 'Es una factura a nombre de tu empresa.' else 'Es un albarán a nombre de tu empresa: queda pendiente de factura.' end;
      v_sugerida := case when v_es_factura then 'per_delivery' else 'delivery_note_then_invoice' end;
      if v_modo is null then
        v_q := 'ficha_sin_forma';
      elsif v_modo = 'per_delivery' and not v_es_factura then
        v_q := 'papel_y_ficha';
      elsif v_modo = 'delivery_note_then_invoice' and v_es_factura then
        v_q := 'papel_y_ficha';
      elsif v_modo = 'monthly_settlement' then
        v_q := 'papel_y_ficha'; v_sugerida := null;
        v_reason := v_reason || format(' La ficha dice que %s liquida cada mes.', s.name);
      end if;
      if v_q is not null then
        v_qd := jsonb_build_object('ficha', v_modo, 'ficha_dice', c_modo->>v_modo, 'papel', v_tipo, 'sugerida', v_sugerida, 'sugerida_dice', c_modo->>v_sugerida);
      end if;
    elsif d.kind = 'proveedor' then
      select * into sp from supplier where id = d.supplier_id;
      if sp.invoicing_mode = 'monthly_settlement' then
        v_path := 'liquidacion'; v_sup := sp.id; v_company := v_unica;
        v_reason := case when sp.id = s.id then format('Va a nombre de %s, que liquida cada mes: entra en su liquidación.', sp.name)
                         else format('Lo trae %s a nombre de %s, que liquida cada mes: entra en su liquidación.', s.name, sp.name) end;
      elsif sp.invoicing_mode is null then
        v_path := 'sin_decidir'; v_q := 'a_nombre_de';
        v_reason := format('Va a nombre de %s, y su ficha no dice si liquida cada mes.', sp.name);
        v_qd := jsonb_build_object('nombre', v_nombre, 'nombre_norm', public.compras_nombre_norm(v_nombre), 'proveedor', sp.id, 'proveedor_nombre', sp.name);
      else
        v_path := 'a_nombre_de_otro'; v_q := 'a_nombre_de_otro'; v_sup := g.supplier_id;
        v_reason := format('Va a nombre de %s, no de tu empresa: así no se puede deducir el IVA.', sp.name);
      end if;
    elsif d.kind = 'otro' then
      v_path := 'a_nombre_de_otro'; v_q := 'a_nombre_de_otro';
      v_reason := format('Va a nombre de «%s», no de tu empresa: así no se puede deducir el IVA.', v_nombre);
    else
      v_path := 'sin_decidir'; v_q := 'a_nombre_de';
      v_reason := case when v_nombre is null then 'El papel no dice a nombre de quién va.'
                       else format('El papel va a nombre de «%s», y Folvy no sabe quién es.', v_nombre) end;
      v_qd := jsonb_build_object('nombre', v_nombre, 'nombre_norm', public.compras_nombre_norm(v_nombre),
        -- Candidatos para contestar: las empresas de la cuenta y los proveedores
        -- que liquidan. Primero el que empieza por la misma palabra: ordena, no decide.
        'candidatos', (select coalesce(jsonb_agg(x order by x->>'orden', x->>'nombre'), '[]'::jsonb) from (
          select jsonb_build_object('tipo', 'empresa', 'id', c.id, 'nombre', coalesce(c.legal_name, c.trade_name),
                   'orden', case when split_part(public.compras_nombre_norm(coalesce(c.legal_name, c.trade_name)), ' ', 1) = split_part(public.compras_nombre_norm(v_nombre), ' ', 1) then '0' else '1' end) x
            from company c where c.account_id = g.account_id and c.is_active
          union all
          select jsonb_build_object('tipo', 'proveedor', 'id', p.id, 'nombre', p.name,
                   'orden', case when split_part(public.compras_nombre_norm(p.name), ' ', 1) = split_part(public.compras_nombre_norm(v_nombre), ' ', 1) then '0' else '1' end)
            from supplier p where p.account_id = g.account_id and p.archived_at is null
             and (p.invoicing_mode = 'monthly_settlement' or p.id = g.supplier_id)) y));
    end if;
  end if;

  return jsonb_build_object('path', v_path, 'supplier_id', v_sup, 'company_id', v_company, 'doc_type', v_tipo,
    'bill_to_name', v_nombre, 'bill_to_tax_id', v_nif, 'bill_to_how', v_how,
    'question', v_q, 'question_detail', v_qd, 'reason', v_reason);
end $$;
revoke all on function public._compras_camino_calcula(uuid) from public, anon, authenticated;

-- Lo mismo, para leerlo desde la pantalla (sin escribir).
create or replace function public.compras_camino_calcula(p_recepcion uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from goods_receipt g where g.id = p_recepcion and (select belongs_to_account(g.account_id))) then
    raise exception 'Esa recepción no es de tu cuenta.' using errcode = '42501';
  end if;
  return public._compras_camino_calcula(p_recepcion);
end $$;
revoke all on function public.compras_camino_calcula(uuid) from public, anon;
grant execute on function public.compras_camino_calcula(uuid) to authenticated;

-- ── 7 · Guardarlo (no pisa lo que ya usó una factura o una liquidación) ────
create or replace function public._compras_camino_guarda(p_recepcion uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_cuenta uuid;
begin
  select account_id into v_cuenta from goods_receipt where id = p_recepcion;
  if exists (select 1 from goods_receipt_path where goods_receipt_id = p_recepcion and consumed_at is not null) then
    return null;
  end if;
  v := public._compras_camino_calcula(p_recepcion);
  insert into goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, company_id, doc_type, bill_to_name, bill_to_tax_id,
                                  bill_to_how, question, question_detail, reason, error, decided_at)
  values (v_cuenta, p_recepcion, v->>'path', (v->>'supplier_id')::uuid, (v->>'company_id')::uuid, v->>'doc_type', v->>'bill_to_name',
          v->>'bill_to_tax_id', v->>'bill_to_how', v->>'question', nullif(v->'question_detail', 'null'::jsonb), v->>'reason', null, now())
  on conflict (goods_receipt_id) do update set
    path = excluded.path, supplier_id = excluded.supplier_id, company_id = excluded.company_id, doc_type = excluded.doc_type,
    bill_to_name = excluded.bill_to_name, bill_to_tax_id = excluded.bill_to_tax_id, bill_to_how = excluded.bill_to_how,
    question = excluded.question, question_detail = excluded.question_detail, reason = excluded.reason, error = null, decided_at = now();
  return v;
end $$;
revoke all on function public._compras_camino_guarda(uuid) from public, anon, authenticated;

-- ── 8 · Al confirmar (o anular) una recepción ──────────────────────────────
-- Nunca hace fallar la recepción. Si decidir falla: fila «error» con el
-- mensaje. Si ni eso: un warning, y la recepción sin fila sale en «Qué tienes
-- que mirar» (la busca compras_mirar por su ausencia, no por este aviso).
create or replace function public.tg_goods_receipt_compras_camino()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirmado' or (new.status = 'anulado' and exists (select 1 from goods_receipt_path where goods_receipt_id = new.id)) then
    begin
      perform public._compras_camino_guarda(new.id);
    exception when others then
      begin
        insert into goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, question, reason, error)
        values (new.account_id, new.id, 'error', new.supplier_id, 'error', 'Folvy no pudo decidir por dónde va esta recepción.', sqlerrm)
        on conflict (goods_receipt_id) do update set path = 'error', question = 'error', reason = excluded.reason, error = excluded.error, decided_at = now()
          where goods_receipt_path.consumed_at is null;
      exception when others then
        raise warning 'compras: no se pudo apuntar el camino de la recepción %: %', new.id, sqlerrm;
      end;
    end;
  end if;
  return null;
end $$;
revoke all on function public.tg_goods_receipt_compras_camino() from public, anon, authenticated;
drop trigger if exists trg_goods_receipt_compras_camino on public.goods_receipt;
create trigger trg_goods_receipt_compras_camino after update of status on public.goods_receipt
  for each row when (old.status is distinct from new.status)
  execute function public.tg_goods_receipt_compras_camino();

-- ── 9 · Contestar: a nombre de quién va un nombre ──────────────────────────
-- Una de las tres: p_empresa, p_proveedor, o p_otro = true. Se recuerda y se
-- vuelven a decidir todas las recepciones abiertas con ese nombre.
create or replace function public._compras_destinatario_decide(p_cuenta uuid, p_nombre text, p_empresa uuid, p_proveedor uuid, p_otro boolean, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nom text := public.compras_nombre_norm(p_nombre); v_n int := 0; r record;
begin
  if v_nom is null then raise exception 'Sin nombre no hay nada que recordar.' using errcode = '22023'; end if;
  if num_nonnulls(p_empresa, p_proveedor) + (case when coalesce(p_otro, false) then 1 else 0 end) <> 1 then
    raise exception 'Elige una: tu empresa, el proveedor o «otro».' using errcode = '22023';
  end if;
  if p_empresa is not null and not exists (select 1 from company where id = p_empresa and account_id = p_cuenta) then
    raise exception 'Esa empresa no es de esta cuenta.' using errcode = '42501';
  end if;
  if p_proveedor is not null and not exists (select 1 from supplier where id = p_proveedor and account_id = p_cuenta) then
    raise exception 'Ese proveedor no es de esta cuenta.' using errcode = '42501';
  end if;
  insert into purchase_bill_to (account_id, name_norm, example, company_id, supplier_id, is_other, decided_by, decided_by_name)
  values (p_cuenta, v_nom, p_nombre, p_empresa, p_proveedor, coalesce(p_otro, false), auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor()))
  on conflict (account_id, name_norm) do update set
    example = excluded.example, company_id = excluded.company_id, supplier_id = excluded.supplier_id, is_other = excluded.is_other,
    decided_by = excluded.decided_by, decided_by_name = excluded.decided_by_name, decided_at = now();
  for r in select p.goods_receipt_id from goods_receipt_path p
            where p.account_id = p_cuenta and p.consumed_at is null and public.compras_nombre_norm(p.bill_to_name) = v_nom loop
    perform public._compras_camino_guarda(r.goods_receipt_id); v_n := v_n + 1;
  end loop;
  return jsonb_build_object('nombre', v_nom, 'recepciones', v_n);
end $$;
revoke all on function public._compras_destinatario_decide(uuid, text, uuid, uuid, boolean, text) from public, anon, authenticated;

create or replace function public.compras_destinatario_decide(p_cuenta uuid, p_nombre text, p_empresa uuid, p_proveedor uuid, p_otro boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin_or_manager_of(p_cuenta) then
    raise exception 'No puedes decidir esto en esta cuenta.' using errcode = '42501';
  end if;
  return public._compras_destinatario_decide(p_cuenta, p_nombre, p_empresa, p_proveedor, p_otro, null);
end $$;
revoke all on function public.compras_destinatario_decide(uuid, text, uuid, uuid, boolean) from public, anon;
grant execute on function public.compras_destinatario_decide(uuid, text, uuid, uuid, boolean) to authenticated;

-- ── 10 · Cambiar la costumbre de la ficha ──────────────────────────────────
-- Y volver a decidir sus recepciones abiertas (las del proveedor y las que
-- van a su nombre).
create or replace function public._compras_forma_facturar(p_proveedor uuid, p_modo text, p_por_local boolean, p_frecuencia text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record; v_cuenta uuid;
begin
  select account_id into v_cuenta from supplier where id = p_proveedor;
  if v_cuenta is null then raise exception 'Ese proveedor no existe.' using errcode = 'P0002'; end if;
  update supplier set invoicing_mode = p_modo,
         invoicing_per_location = case when p_modo = 'delivery_note_then_invoice' then p_por_local else null end,
         invoicing_frequency = case when p_modo = 'delivery_note_then_invoice' then coalesce(p_frecuencia, invoicing_frequency)
                                    when p_modo = 'per_delivery' then 'per_delivery'
                                    when p_modo = 'monthly_settlement' then 'monthly' else invoicing_frequency end
   where id = p_proveedor;
  for r in select p.goods_receipt_id from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
            where p.account_id = v_cuenta and p.consumed_at is null
              and (g.supplier_id = p_proveedor or p.supplier_id = p_proveedor
                   or (p.question = 'a_nombre_de' and (p.question_detail->>'proveedor')::uuid = p_proveedor)) loop
    perform public._compras_camino_guarda(r.goods_receipt_id); v_n := v_n + 1;
  end loop;
  return jsonb_build_object('proveedor', p_proveedor, 'modo', p_modo, 'recepciones', v_n);
end $$;
revoke all on function public._compras_forma_facturar(uuid, text, boolean, text) from public, anon, authenticated;

create or replace function public.compras_forma_facturar(p_proveedor uuid, p_modo text, p_por_local boolean default null, p_frecuencia text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from supplier where id = p_proveedor;
  if v_cuenta is null then raise exception 'Ese proveedor no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'No puedes cambiar esta ficha.' using errcode = '42501';
  end if;
  return public._compras_forma_facturar(p_proveedor, p_modo, p_por_local, p_frecuencia);
end $$;
revoke all on function public.compras_forma_facturar(uuid, text, boolean, text) from public, anon;
grant execute on function public.compras_forma_facturar(uuid, text, boolean, text) to authenticated;

-- ── 11 · Rellenar el camino de las recepciones ya confirmadas ──────────────
-- Para las que se confirmaron antes de existir el disparador (octubre de
-- Foodint, tarea 7). Solo las que no tienen fila.
create or replace function public._compras_camino_rellena(p_cuenta uuid, p_desde date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  for r in select g.id from goods_receipt g
            where g.account_id = p_cuenta and g.status = 'confirmado' and g.receipt_date >= p_desde
              and not exists (select 1 from goods_receipt_path p where p.goods_receipt_id = g.id)
            order by g.receipt_date, g.created_at loop
    perform public._compras_camino_guarda(r.id); v_n := v_n + 1;
  end loop;
  return jsonb_build_object('recepciones', v_n);
end $$;
revoke all on function public._compras_camino_rellena(uuid, date) from public, anon, authenticated;

-- ── 12 · Lo que le falta a una ficha (§2.6) ────────────────────────────────
-- Se dice, no se tapa. El NIF que viene en los papeles se OFRECE (el más
-- leído, con cuántas veces y si hay otros distintos); no se escribe: lo
-- comprueba lib/nif.ts y lo acepta una persona.
create or replace function public.compras_ficha_le_falta(p_proveedor uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s supplier; v jsonb := '[]'::jsonb; v_nif record; v_otros int; v_ultimo text;
begin
  select * into s from supplier where id = p_proveedor;
  if s.id is null or not (select belongs_to_account(s.account_id)) then
    raise exception 'Ese proveedor no es de tu cuenta.' using errcode = '42501';
  end if;
  if s.tax_id is null then
    select public.compras_nif_norm(a.parsed_result->'document'->>'supplier_tax_id') nif, count(*) veces into v_nif
      from goods_receipt g join goods_receipt_ai_session a on a.id = g.ai_session_id
     where g.account_id = s.account_id and g.supplier_id = s.id and g.status <> 'anulado'
       and public.compras_nif_norm(a.parsed_result->'document'->>'supplier_tax_id') is not null
     group by 1 order by 2 desc, 1 limit 1;
    select count(distinct public.compras_nif_norm(a.parsed_result->'document'->>'supplier_tax_id')) - 1 into v_otros
      from goods_receipt g join goods_receipt_ai_session a on a.id = g.ai_session_id
     where g.account_id = s.account_id and g.supplier_id = s.id and g.status <> 'anulado'
       and public.compras_nif_norm(a.parsed_result->'document'->>'supplier_tax_id') is not null;
    v := v || jsonb_build_object('falta', 'nif', 'ofrece', v_nif.nif, 'veces', v_nif.veces, 'otros_distintos', greatest(coalesce(v_otros, 0), 0));
  end if;
  if s.expense_category_id is null then
    v := v || jsonb_build_object('falta', 'tipo_gasto');
  end if;
  if s.invoicing_mode is null then
    select a.parsed_result->'document'->>'doc_type' into v_ultimo
      from goods_receipt g join goods_receipt_ai_session a on a.id = g.ai_session_id
     where g.account_id = s.account_id and g.supplier_id = s.id and g.status <> 'anulado' and a.parsed_result->'document'->>'doc_type' is not null
     order by g.receipt_date desc, g.created_at desc limit 1;
    v := v || jsonb_build_object('falta', 'forma_facturar', 'ultimo_papel', v_ultimo);
  end if;
  return v;
end $$;
revoke all on function public.compras_ficha_le_falta(uuid) from public, anon;
grant execute on function public.compras_ficha_le_falta(uuid) to authenticated;

-- ── 13 · La fusión de proveedores mueve también lo de compras ──────────────
-- La misma función de la 0100, con la misma firma, y tres cambios: mueve (y
-- devuelve al deshacer) purchase_bill_to y goods_receipt_path, y rellena
-- invoicing_mode e invoicing_per_location si la que queda no los tiene.
create or replace function public._supplier_merge(p_queda uuid, p_se_va uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_a supplier; v_b supplier; v_cuenta uuid;
  v_mov jsonb := '{}'::jsonb; v_quedan jsonb := '[]'::jsonb; v_relleno jsonb := '{}'::jsonb;
  v_ids uuid[]; v_n int := 0; v_t text; v_c text;
  v_party_a uuid; v_party_b uuid; v_pm jsonb; v_pm_id uuid; v_merge uuid; v_resumen text; v_choques int;
begin
  if p_queda = p_se_va then raise exception 'Es la misma ficha.' using errcode = '22023'; end if;
  select * into v_a from supplier where id = p_queda for update;
  if v_a.id is null then raise exception 'Ese proveedor no existe.' using errcode = 'P0002'; end if;
  select * into v_b from supplier where id = p_se_va for update;
  if v_b.id is null or v_b.account_id <> v_a.account_id then raise exception 'Las dos fichas tienen que ser de la misma cuenta.' using errcode = '42501'; end if;
  v_cuenta := v_a.account_id;
  if exists (select 1 from supplier_merge m where m.undone_at is null and m.gone_supplier_id = p_queda) then
    raise exception '% ya se unió a otra ficha: únelo con esa.', v_a.name using errcode = '22023';
  end if;

  -- 1 · Lo que no tiene clave única por proveedor: se mueve entero.
  foreach v_t in array array['goods_receipt', 'purchase_order', 'purchase', 'supplier_invoice', 'supplier_alias',
                             'compliance_document', 'ctb_notification_queue', 'invoice_approval_rule', 'supplier_learning_log',
                             'purchase_bill_to', 'goods_receipt_path'] loop
    execute format('select coalesce(array_agg(id), ''{}'') from public.%I where supplier_id = $1 and account_id = $2', v_t)
      into v_ids using p_se_va, v_cuenta;
    execute format('update public.%I set supplier_id = $1 where id = any($2)', v_t) using p_queda, v_ids;
    v_mov := v_mov || jsonb_build_object(v_t, to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);
  end loop;

  -- 2 · Artículos y sus precios: lo que no choca con las tres claves únicas.
  select coalesce(array_agg(x.id), '{}') into v_ids from article_supplier x
   where x.supplier_id = p_se_va and x.account_id = v_cuenta
     and not (x.supplier_code is not null and exists (select 1 from article_supplier y where y.supplier_id = p_queda and y.supplier_code = x.supplier_code and y.recipe_item_id = x.recipe_item_id))
     and not (x.supplier_code is null and exists (select 1 from article_supplier y where y.supplier_id = p_queda and y.supplier_code is null and y.recipe_item_id = x.recipe_item_id))
     and not (x.is_preferred and exists (select 1 from article_supplier y where y.supplier_id = p_queda and y.is_preferred and y.recipe_item_id = x.recipe_item_id));
  -- Dos filas de la que se va que chocarían ENTRE ELLAS al llegar no existen: ya cumplían las mismas claves con el mismo proveedor.
  select count(*) into v_choques from article_supplier where supplier_id = p_se_va and account_id = v_cuenta and not (id = any(v_ids));
  if v_choques > 0 then v_quedan := v_quedan || jsonb_build_object('que', 'articulos', 'filas', v_choques); end if;
  update article_supplier set supplier_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('article_supplier', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  -- 3 · Lo aprendido, dato a dato.
  select coalesce(array_agg(x.id), '{}') into v_ids from supplier_learning x
   where x.supplier_id = p_se_va and not exists (select 1 from supplier_learning y where y.supplier_id = p_queda and y.campo = x.campo);
  select count(*) into v_choques from supplier_learning where supplier_id = p_se_va and not (id = any(v_ids));
  if v_choques > 0 then v_quedan := v_quedan || jsonb_build_object('que', 'aprendido', 'filas', v_choques); end if;
  update supplier_learning set supplier_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('supplier_learning', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  -- 4 · Contactos: todos, salvo un segundo principal.
  select coalesce(array_agg(x.id), '{}') into v_ids from supplier_contact x
   where x.supplier_id = p_se_va and not (x.is_primary and exists (select 1 from supplier_contact y where y.supplier_id = p_queda and y.is_primary));
  select count(*) into v_choques from supplier_contact where supplier_id = p_se_va and not (id = any(v_ids));
  if v_choques > 0 then v_quedan := v_quedan || jsonb_build_object('que', 'contacto_principal', 'filas', v_choques); end if;
  update supplier_contact set supplier_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('supplier_contact', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  -- 5 · Propuestas sobre la ficha, si la que queda no tiene ya la misma.
  select coalesce(array_agg(x.id), '{}') into v_ids from supplier_proposal x
   where x.supplier_id = p_se_va and not exists (select 1 from supplier_proposal y where y.supplier_id = p_queda and y.field = x.field and y.source = x.source
                                                  and coalesce(y.source_id, '00000000-0000-0000-0000-000000000000') = coalesce(x.source_id, '00000000-0000-0000-0000-000000000000'));
  select count(*) into v_choques from supplier_proposal where supplier_id = p_se_va and not (id = any(v_ids));
  if v_choques > 0 then v_quedan := v_quedan || jsonb_build_object('que', 'propuestas', 'filas', v_choques); end if;
  update supplier_proposal set supplier_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('supplier_proposal', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  -- 6 · Sus cuentas (400/410, gasto, pago…), papel a papel, si la que queda no tiene ya una con ese papel.
  select coalesce(array_agg(l.id), '{}') into v_ids from company_account_link l
   where l.account_id = v_cuenta and l.entity = 'supplier' and l.entity_id = p_se_va::text
     and not exists (select 1 from company_account_link x where x.company_id = l.company_id and x.entity = 'supplier' and x.entity_id = p_queda::text and x.role = l.role);
  select count(*) into v_choques from company_account_link where account_id = v_cuenta and entity = 'supplier' and entity_id = p_se_va::text and not (id = any(v_ids));
  if v_choques > 0 then v_quedan := v_quedan || jsonb_build_object('que', 'cuentas', 'filas', v_choques); end if;
  update company_account_link set entity_id = p_queda::text where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('company_account_link', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  -- 7 · La ficha: lo que la que queda tiene vacío y la que se va no.
  foreach v_c in array array['tax_id', 'legal_name', 'tax_id_type', 'country_code', 'entity_kind', 'fiscal_street', 'fiscal_postal_code',
                             'fiscal_city', 'fiscal_province', 'vat_regime', 'irpf_withholding_pct', 'expense_category_id', 'default_location_id',
                             'payment_method', 'payment_terms_days', 'payment_fixed_days', 'iban', 'bank_name', 'bic', 'website', 'health_registry_no',
                             'notify_group', 'invoicing_frequency', 'currency', 'related_party_kind', 'usual_tax_rate_ids', 'early_payment_discount_pct',
                             'invoicing_mode', 'invoicing_per_location'] loop
    if (to_jsonb(v_a) -> v_c) in ('null'::jsonb) and coalesce(to_jsonb(v_b) -> v_c, 'null'::jsonb) <> 'null'::jsonb then
      execute format('update public.supplier set %I = (select %I from public.supplier where id = $2) where id = $1', v_c, v_c) using p_queda, p_se_va;
      v_relleno := v_relleno || jsonb_build_object(v_c, to_jsonb(v_b) -> v_c);
    end if;
  end loop;

  -- 8 · Sus terceros, fusionados (si son dos) ANTES de archivar: así la de
  --     terceros apunta el estado real de la que se va y su deshacer lo deja
  --     como estaba. Ella misma archiva la ficha de proveedor de la que se va.
  select party_id into v_party_a from party_role where supplier_id = p_queda;
  select party_id into v_party_b from party_role where supplier_id = p_se_va;
  if v_party_a is not null and v_party_b is not null and v_party_a <> v_party_b then
    v_pm := public._party_merge(v_party_a, v_party_b, p_quien_nombre);
    v_pm_id := (v_pm->>'fusion')::uuid;
  end if;
  update supplier set archived_at = coalesce(archived_at, now()),
         notes = trim(both from coalesce(notes, '') || E'\n' || format('Unida a %s el %s.', v_a.name, to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY')))
   where id = p_se_va;

  v_resumen := format('%s unida a %s: %s %s movido%s%s.', v_b.name, v_a.name, v_n, case when v_n = 1 then 'dato' else 'datos' end,
    case when v_n = 1 then '' else 's' end,
    case when jsonb_array_length(v_quedan) > 0 then format('; se queda en %s (archivada) lo que %s ya tenía: %s', v_b.name, v_a.name,
      (select string_agg(format('%s %s', x->>'filas', case x->>'que' when 'articulos' then 'artículo(s)' when 'aprendido' then 'dato(s) aprendido(s)'
                                       when 'contacto_principal' then 'contacto principal' when 'propuestas' then 'propuesta(s)' else 'cuenta(s)' end), ', ')
         from jsonb_array_elements(v_quedan) x)) else '' end);

  insert into supplier_merge (account_id, kept_supplier_id, gone_supplier_id, moved, kept_on_gone, filled, party_merge_id, summary, done_by, done_by_name)
  values (v_cuenta, p_queda, p_se_va,
          v_mov || jsonb_build_object('antes', jsonb_build_object('archived_at', v_b.archived_at, 'notes', v_b.notes)),
          v_quedan, v_relleno, v_pm_id, v_resumen, auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor()))
  returning id into v_merge;
  return jsonb_build_object('fusion', v_merge, 'resumen', v_resumen, 'movidos', v_n, 'se_quedan', v_quedan, 'rellenados', v_relleno, 'terceros', v_pm);
end $$;
revoke all on function public._supplier_merge(uuid, uuid, text) from public, anon, authenticated;

create or replace function public._supplier_merge_undo(p_merge uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m supplier_merge; v_t text; v_c text; v_ids uuid[];
begin
  select * into v_m from supplier_merge where id = p_merge for update;
  if v_m.id is null then raise exception 'Esa fusión no existe.' using errcode = 'P0002'; end if;
  if v_m.undone_at is not null then raise exception 'Esa fusión ya está deshecha.' using errcode = '22023'; end if;
  -- Primero los terceros (para si hay algo validado), luego lo del proveedor.
  if v_m.party_merge_id is not null then perform public._party_merge_undo(v_m.party_merge_id, p_quien_nombre); end if;
  foreach v_t in array array['goods_receipt', 'purchase_order', 'purchase', 'supplier_invoice', 'supplier_alias', 'compliance_document',
                             'ctb_notification_queue', 'invoice_approval_rule', 'supplier_learning_log', 'article_supplier',
                             'supplier_learning', 'supplier_contact', 'supplier_proposal', 'purchase_bill_to', 'goods_receipt_path'] loop
    v_ids := array(select jsonb_array_elements_text(coalesce(v_m.moved->v_t, '[]'::jsonb))::uuid);
    execute format('update public.%I set supplier_id = $1 where id = any($2) and supplier_id = $3', v_t) using v_m.gone_supplier_id, v_ids, v_m.kept_supplier_id;
  end loop;
  update company_account_link set entity_id = v_m.gone_supplier_id::text
   where id = any(array(select jsonb_array_elements_text(coalesce(v_m.moved->'company_account_link', '[]'::jsonb))::uuid)) and entity_id = v_m.kept_supplier_id::text;
  for v_c in select jsonb_object_keys(v_m.filled) loop
    execute format('update public.supplier set %I = null where id = $1', v_c) using v_m.kept_supplier_id;
  end loop;
  update supplier set archived_at = (v_m.moved->'antes'->>'archived_at')::timestamptz, notes = v_m.moved->'antes'->>'notes' where id = v_m.gone_supplier_id;
  update supplier_merge set undone_at = now(), undone_by = auth.uid(), undone_by_name = coalesce(p_quien_nombre, public.conta_nombre_actor()) where id = p_merge;
  return jsonb_build_object('fusion', p_merge, 'deshecha', true);
end $$;
revoke all on function public._supplier_merge_undo(uuid, text) from public, anon, authenticated;
