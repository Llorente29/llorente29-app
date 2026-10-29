-- supabase/migrations/20261029T1012_s01c_facturas_solas.sql
-- cambia: public._compras_camino_calcula · prueba: supabase/staging/sql/20261029_s01c_facturas_solas_prueba.sql
-- cambia: public.tg_goods_receipt_path_factura · prueba: supabase/staging/sql/20261029_s01c_facturas_solas_prueba.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261029_s01c_facturas_solas_prueba.sql
--
-- S01c · LAS FACTURAS DE PROVEEDOR ENTRAN SOLAS POR CORREO Y CASAN CON SU
-- ALBARÁN (encargo de Julio, 29/10; visto bueno al paso 0 el mismo día).
--
--   1. La ficha manda (cambia _compras_camino_calcula, misma firma). Hasta hoy,
--      si el papel no cuadraba con la ficha, «el camino lo pone el papel» (la
--      0120): un albarán de Olimpo leído como «albarán-factura» se convirtió en
--      FAC-00100 aunque su ficha dice «albarán y factura después». Ahora:
--        · con la ficha dicha, el camino es el de la ficha; si el papel dice
--          otra cosa queda el aviso «papel_y_ficha» y no se crea nada;
--        · con la ficha vacía, el papel decide y se pregunta («ficha_sin_forma»).
--   2. El disparador de la 0140 (cambia tg_goods_receipt_path_factura) no crea
--      ninguna factura con una pregunta abierta. Al cerrarla, sí.
--   3. «Cuándo llegan las facturas» en la ficha del proveedor
--      (supplier.invoice_arrival, nueva, admite nulos): «al momento» (lo de
--      siempre) o «todas juntas a primeros del mes siguiente» (Amirsa).
--      compras_cuando_llegan_poner la guarda y dice qué ha guardado.
--   4. «Esperando factura», albarán a albarán (compras_esperando_detalle,
--      nueva): los días que lleva y hasta cuándo es normal esperar, según cómo
--      factura su proveedor y cuándo manda las facturas. También los de
--      liquidación mensual (Nobleza). El plazo pone la etiqueta «retrasado»,
--      nunca quita una fila (regla 7).
--   5. Casar sola la factura que llega (disparador nuevo en supplier_invoice,
--      _compras_casar_solo): con el albarán del mismo proveedor que espera y
--      cuyo total leído es el de la factura; si no hay uno, con los albaranes
--      del mes cuyos totales suman lo de la factura (la factura mensual). Lo
--      cuenta en la actividad de la factura: «Casa con el albarán 26/13024 del
--      19/10», «Difiere en 52,00 €: el albarán tiene líneas sin leer» o
--      «Espera su albarán». Usa _compras_casar (la 0150), no lo cambia.
--   6. El hueco de un albarán que no cuadra (goods_receipt.unread_gap_*,
--      nuevas, admiten nulos): compras_hueco_recepcion lo guarda con su motivo
--      para la oficina, y compras_recepcion_linea_anadir añade en oficina la
--      línea que no se leyó, por el mismo camino que al recibir
--      (_post_goods_receipt_lines, solo lo que no ha entrado: su movimiento de
--      stock «recepcion» y su coste) y dice cuánto falta todavía.
--   7. El correo de facturas de una empresa (conta_correo_facturas, nueva,
--      solo lee): su dirección, si recibe, el último correo, la confirmación de
--      Gmail con su código y su enlace, y qué se hizo con cada correo.
--   8. La factura contra sus albaranes, línea a línea (compras_factura_lineas,
--      nueva, solo lee): cada línea de la factura con la de su albarán (por
--      artículo, por código del proveedor o por el mismo texto), y si cuadra,
--      difiere en cantidad o en importe, o está solo en un lado. Se calcula al
--      leerla: la factura que llega por correo se crea antes que sus líneas.
--
-- Nada del camino del pedido. No toca filas: lo de Foodint va en la 1013.

-- ── 1 · Cuándo llegan las facturas, y el hueco de un albarán ───────────────
alter table public.supplier add column if not exists invoice_arrival text
  check (invoice_arrival in ('al_momento', 'inicio_mes_siguiente'));
comment on column public.supplier.invoice_arrival is
  'S01c. Cuándo llegan sus facturas: al_momento (o nulo) o inicio_mes_siguiente (todas juntas a primeros del mes siguiente, como Amirsa). Solo cambia hasta cuándo es normal esperarlas.';
alter table public.goods_receipt add column if not exists unread_gap_amount numeric;
alter table public.goods_receipt add column if not exists unread_gap_reason text;
alter table public.goods_receipt add column if not exists unread_gap_by_name text;
alter table public.goods_receipt add column if not exists unread_gap_at timestamptz;
comment on column public.goods_receipt.unread_gap_reason is
  'S01c. Por qué se confirmó un albarán cuyas líneas leídas no suman su base (unread_gap_amount, lo que falta): queda marcado para la oficina.';

-- ── 2 · La ficha manda ────────────────────────────────────────────────────
-- Lo de antes, guardado con el respaldo de la casa (_respaldar_funcion, con su
-- huella): la vuelta atrás lo restaura byte a byte. Producción no es el texto
-- de la 0120 (la 0370 cambió sus frases), así que no se copia de ningún fichero.
select public._respaldar_funcion('public._compras_camino_calcula(uuid)', '20261029T1012_s01c_facturas_solas');
select public._respaldar_funcion('public.tg_goods_receipt_path_factura()', '20261029T1012_s01c_facturas_solas');

create or replace function public._compras_camino_calcula(p_recepcion uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  g goods_receipt; s supplier; sp supplier; d record; v_doc jsonb; v_tipo text; v_nombre text; v_nif text;
  v_unica uuid; v_es_factura boolean; v_path text; v_company uuid; v_sup uuid; v_how text;
  v_q text; v_qd jsonb; v_reason text; v_modo text; v_sugerida text; v_papel text;
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
      v_path := 'liquidacion'; v_reason := format('No hay documento leído; %s liquida cada mes.', s.name);
    elsif v_modo = 'delivery_note_then_invoice' then
      v_path := 'pendiente_factura'; v_reason := format('No hay documento leído; %s manda la factura después.', s.name);
    else
      v_path := 'pendiente_factura'; v_q := 'sin_papel';
      v_reason := case when v_modo = 'per_delivery'
        then format('No hay documento leído y %s factura con cada entrega: sube su factura.', s.name)
        else format('No hay documento leído y no se sabe cómo factura %s: queda pendiente de factura.', s.name) end;
    end if;
  else
    v_es_factura := v_tipo in ('factura', 'albaran_factura');
    v_papel := case v_tipo when 'albaran' then 'un albarán' when 'factura' then 'una factura' when 'albaran_factura' then 'un albarán-factura' else 'otro documento' end;
    select * into d from public._compras_destinatario(g.account_id, v_nombre, v_nif);
    v_how := d.how;
    if d.kind = 'empresa' then
      v_company := d.company_id;
      v_sugerida := case when v_es_factura then 'per_delivery' else 'delivery_note_then_invoice' end;
      if v_modo is null then
        -- S01c: sin ficha, decide el papel y se pregunta (el disparador no crea nada con la pregunta abierta).
        v_path := case when v_es_factura then 'factura' else 'pendiente_factura' end;
        v_reason := case when v_es_factura then 'Es una factura a nombre de tu empresa. La ficha no dice cómo factura: dímelo y la apunto.'
                         else 'Es un albarán a nombre de tu empresa: queda pendiente de factura.' end;
        v_q := 'ficha_sin_forma';
      elsif v_modo = 'per_delivery' then
        v_path := case when v_es_factura then 'factura' else 'pendiente_factura' end;
        v_reason := case when v_es_factura then 'Es una factura a nombre de tu empresa.'
                         when s.invoice_arrival = 'inicio_mes_siguiente'
                         then format('%s hace una factura por entrega y las manda todas juntas a primeros del mes siguiente: queda pendiente de su factura.', s.name)
                         else format('%s factura con cada entrega y esto es un albarán: queda pendiente de su factura.', s.name) end;
        -- Con sus facturas a primeros de mes, el albarán de la entrega es lo normal: no se pregunta.
        if not v_es_factura and s.invoice_arrival is distinct from 'inicio_mes_siguiente' then v_q := 'papel_y_ficha'; end if;
      elsif v_modo = 'delivery_note_then_invoice' then
        -- S01c: manda la ficha. Lo que el papel diga no crea ninguna factura.
        v_path := 'pendiente_factura';
        v_reason := case when v_es_factura
          then format('%s factura aparte; este papel es el albarán (se leyó como %s). Queda pendiente de su factura.', s.name, v_papel)
          else 'Es un albarán a nombre de tu empresa: queda pendiente de factura.' end;
        if v_es_factura then v_q := 'papel_y_ficha'; end if;
      else
        v_path := 'liquidacion'; v_company := coalesce(v_company, v_unica);
        v_reason := format('%s liquida cada mes: entra en su liquidación%s.', s.name,
                           case when v_es_factura then format(' (el papel se leyó como %s)', v_papel) else '' end);
        if v_es_factura then v_q := 'papel_y_ficha'; v_sugerida := null; end if;
      end if;
      if v_q = 'papel_y_ficha' then
        v_qd := jsonb_build_object('ficha', v_modo, 'ficha_dice', c_modo->>v_modo, 'papel', v_tipo, 'sugerida', v_sugerida, 'sugerida_dice', c_modo->>v_sugerida, 'manda', 'ficha');
      elsif v_q = 'ficha_sin_forma' then
        v_qd := jsonb_build_object('ficha', null, 'papel', v_tipo, 'sugerida', v_sugerida, 'sugerida_dice', c_modo->>v_sugerida);
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
      v_reason := format(case when v_nombre is null then '%s no dice a nombre de quién va.'
                              else '%s va a nombre de «%s», y Folvy no sabe quién es.' end,
                         case v_tipo when 'albaran' then 'El albarán' when 'factura' then 'La factura'
                                     when 'albaran_factura' then 'El albarán-factura' else 'El documento' end,
                         v_nombre);
      v_qd := jsonb_build_object('nombre', v_nombre, 'nombre_norm', public.compras_nombre_norm(v_nombre),
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
end $function$;

-- ── 3 · Ninguna factura con una pregunta abierta ──────────────────────────
create or replace function public.tg_goods_receipt_path_factura()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare g goods_receipt; v jsonb; v_corte date;
begin
  if current_setting('folvy.compras_factura', true) = 'si' then return null; end if;
  if new.path <> 'factura' or new.supplier_invoice_id is not null or new.consumed_at is not null then
    return null;
  end if;
  -- S01c: con una pregunta abierta (la ficha y el papel no dicen lo mismo, o la ficha
  -- no dice cómo factura) no se crea nada. Al cerrarla, este mismo disparador la crea.
  -- (Cerrar una pregunta copia su nombre en question_closed: compras_cerrar_pregunta.)
  if new.question is not null and new.question_closed is distinct from new.question then return null; end if;
  select * into g from goods_receipt where id = new.goods_receipt_id;
  if g.status <> 'confirmado' or g.ai_session_id is null then return null; end if;
  select max(fy.imported_until) into v_corte from fiscal_year fy where fy.company_id = new.company_id;
  perform set_config('folvy.compras_factura', 'si', true);
  if v_corte is not null and g.receipt_date <= v_corte then
    update goods_receipt_path set reason = reason || format(' Es anterior al corte (%s): la lleva el programa anterior.', to_char(v_corte, 'DD/MM/YYYY'))
     where id = new.id and reason not like '%anterior al corte%';
  else
    begin
      v := public._compras_factura_desde_papel(g.account_id, g.ai_session_id, g.supplier_id, g.location_id, new.company_id, g.id, null);
      if coalesce((v->>'sin_importes')::boolean, false) then
        update goods_receipt_path set question = 'factura_sin_importes', question_detail = jsonb_build_object('motivo', v->>'motivo')
         where id = new.id;
      else
        update goods_receipt_path set supplier_invoice_id = (v->>'factura')::uuid, consumed_at = now(),
               question = case when coalesce((v->>'repetida')::boolean, false) then 'factura_repetida' else question end,
               question_detail = case when coalesce((v->>'repetida')::boolean, false)
                                      then jsonb_build_object('motivo', v->>'motivo', 'factura', v->>'factura') else question_detail end
         where id = new.id;
      end if;
    exception when others then
      perform set_config('folvy.compras_factura', 'si', true);
      update goods_receipt_path set question = 'error', error = sqlerrm,
             question_detail = jsonb_build_object('motivo', 'Folvy no pudo crear la factura desde el documento.')
       where id = new.id;
    end;
  end if;
  perform set_config('folvy.compras_factura', '', true);
  return null;
end $function$;

-- ── 4 · «Cuándo llegan las facturas» ──────────────────────────────────────
create or replace function public.compras_cuando_llegan_poner(p_proveedor uuid, p_valor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s supplier;
begin
  select * into s from supplier where id = p_proveedor;
  if s.id is null then raise exception 'Ese proveedor no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(s.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta cambia la ficha.' using errcode = '42501';
  end if;
  if p_valor is not null and p_valor not in ('al_momento', 'inicio_mes_siguiente') then
    raise exception 'Sus facturas llegan «al momento» o «todas juntas a primeros del mes siguiente».' using errcode = '22023';
  end if;
  update supplier set invoice_arrival = p_valor, updated_at = now() where id = s.id;
  return jsonb_build_object('ok', true, 'mensaje', format('Guardado: las facturas de %s llegan %s.', s.name,
    case when p_valor = 'inicio_mes_siguiente' then 'todas juntas a primeros del mes siguiente; sus albaranes del mes no salen como retrasados hasta el día 10'
         else 'al momento' end));
end $$;
revoke all on function public.compras_cuando_llegan_poner(uuid, text) from public, anon;
grant execute on function public.compras_cuando_llegan_poner(uuid, text) to authenticated;

-- ── 5 · «Esperando factura», albarán a albarán ────────────────────────────
-- Hasta cuándo es normal esperar (pone la etiqueta, no quita filas):
--   · liquidación mensual, o «todas juntas a primeros del mes siguiente»: el
--     día 10 del mes siguiente a la entrega;
--   · «con cada entrega»: 7 días;
--   · «albarán y factura después», o la ficha sin decir: 15 días.
create or replace function public.compras_esperando_detalle(p_cuenta uuid, p_hoy date default null)
returns table (goods_receipt_id uuid, code text, doc_number text, receipt_date date, supplier_id uuid, supplier_name text, location_name text,
               camino text, forma text, llegada text, base numeric, total_papel numeric, lineas_sin_leer numeric, motivo_hueco text,
               espera_hasta date, dias int, retrasado boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_hoy date := coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date);
begin
  if not (select belongs_to_account(p_cuenta)) then raise exception 'Esa cuenta no es tuya.' using errcode = '42501'; end if;
  return query
  with x as (
    select g.id, g.code, g.supplier_doc_number, g.receipt_date, g.supplier_id, s.name sname, l.name lname, p.path, s.invoicing_mode, s.invoice_arrival,
           public._compras_base_recepcion(g.id) base,
           nullif(a.parsed_result->'document'->>'grand_total', '')::numeric total_papel,
           case when coalesce((a.validation->>'cuadra')::boolean, true) = false and g.unread_gap_reason is null
                then coalesce(g.unread_gap_amount, greatest(round(coalesce((a.validation->>'base_declared')::numeric, 0) - coalesce((a.validation->>'lines_sum')::numeric, 0), 2), 0)) end hueco,
           g.unread_gap_reason,
           case when p.path = 'liquidacion' or s.invoicing_mode = 'monthly_settlement' or s.invoice_arrival = 'inicio_mes_siguiente'
                then (date_trunc('month', g.receipt_date) + interval '1 month' + interval '9 days')::date
                when s.invoicing_mode = 'per_delivery' then g.receipt_date + 7
                else g.receipt_date + 15 end hasta
      from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
      join supplier s on s.id = g.supplier_id left join locations l on l.id = g.location_id
      left join goods_receipt_ai_session a on a.id = g.ai_session_id
     where p.account_id = p_cuenta and p.path in ('pendiente_factura', 'liquidacion') and p.consumed_at is null and g.status = 'confirmado'
  )
  select x.id, x.code, x.supplier_doc_number, x.receipt_date, x.supplier_id, x.sname, x.lname, x.path, x.invoicing_mode, x.invoice_arrival,
         x.base, x.total_papel, nullif(x.hueco, 0), x.unread_gap_reason, x.hasta, (v_hoy - x.receipt_date)::int, v_hoy > x.hasta
    from x order by (v_hoy > x.hasta) desc, x.receipt_date, x.sname;
end $$;
revoke all on function public.compras_esperando_detalle(uuid, date) from public, anon;
grant execute on function public.compras_esperando_detalle(uuid, date) to authenticated;

-- ── 6 · Casar sola la factura que llega ───────────────────────────────────
create or replace function public._compras_casar_solo(p_factura uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f supplier_invoice; s supplier; v_ids uuid[]; v_r jsonb; v_hueco numeric; v_texto text; v_alb text; v_n int;
  e text := 'FM999G999G990D00';
begin
  select * into f from supplier_invoice where id = p_factura;
  if f.id is null or f.supplier_id is null or f.status in ('anulada', 'descartada') or f.grand_total is null then return null; end if;
  if exists (select 1 from supplier_invoice_receipt where supplier_invoice_id = f.id) then return null; end if;
  select * into s from supplier where id = f.supplier_id;
  -- Los que esperan factura de este proveedor, recibidos hasta la fecha de la factura, con su total leído.
  create temp table if not exists _s01c_cand (id uuid, code text, doc text, fecha date, total numeric) on commit drop;
  delete from _s01c_cand where true;
  insert into _s01c_cand
  select g.id, g.code, g.supplier_doc_number, g.receipt_date, nullif(a.parsed_result->'document'->>'grand_total', '')::numeric
    from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
    left join goods_receipt_ai_session a on a.id = g.ai_session_id
   where p.account_id = f.account_id and p.path = 'pendiente_factura' and p.consumed_at is null and g.status = 'confirmado'
     and g.supplier_id = f.supplier_id and g.receipt_date <= coalesce(f.invoice_date, current_date);
  -- a) Un albarán con el mismo total.
  select array_agg(id) into v_ids from _s01c_cand where abs(total - f.grand_total) < 0.005;
  if coalesce(array_length(v_ids, 1), 0) <> 1 then
    -- b) La factura del mes: los albaranes de su mes, si suman su total.
    select array_agg(id) into v_ids from _s01c_cand
     where date_trunc('month', fecha) = date_trunc('month', coalesce(f.invoice_date, current_date) - (case when extract(day from coalesce(f.invoice_date, current_date)) <= 10 then 15 else 0 end))
     having count(*) > 1 and count(total) = count(*) and abs(sum(total) - f.grand_total) < 0.005;
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    v_texto := format('Espera su albarán: no hay ningún albarán de %s esperando factura por %s €.', s.name, translate(to_char(f.grand_total, e), ',.', '.,'));
    insert into document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
    values (f.account_id, f.company_id, f.inbox_id, f.id, 'folvy', 'propuesta', v_texto, jsonb_build_object('espera_albaran', true));
    return jsonb_build_object('casada', false, 'texto', v_texto);
  end if;
  v_r := public._compras_casar(f.id, v_ids);
  select string_agg(format('%s del %s', coalesce(c.doc, c.code), to_char(c.fecha, 'DD/MM')), ', ' order by c.fecha), count(*)
    into v_alb, v_n from _s01c_cand c where c.id = any(v_ids);
  -- Lo que el albarán tiene sin leer (su base contra lo que suman sus líneas leídas), si nadie dijo por qué.
  select coalesce(sum(coalesce(g.unread_gap_amount, greatest(coalesce((a.validation->>'base_declared')::numeric, 0) - coalesce((a.validation->>'lines_sum')::numeric, 0), 0))), 0)
    into v_hueco
    from goods_receipt g join goods_receipt_ai_session a on a.id = g.ai_session_id
   where g.id = any(v_ids) and coalesce((a.validation->>'cuadra')::boolean, true) = false and g.unread_gap_reason is null;
  v_texto := format('Casa con %s %s.', case when v_n = 1 then 'el albarán' else format('los %s albaranes', v_n) end, v_alb)
    || case when v_hueco >= 0.005 then format(' Difiere en %s €: el albarán tiene líneas sin leer.', translate(to_char(v_hueco, e), ',.', '.,'))
            when abs(coalesce((v_r->>'diferencia')::numeric, 0)) >= 0.005 then ' ' || (v_r->>'frase')
            else '' end;
  if v_hueco >= 0.005 then update supplier_invoice set match_status = 'con_diferencias' where id = f.id; end if;
  insert into document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
  values (f.account_id, f.company_id, f.inbox_id, f.id, 'folvy', 'casada', v_texto,
          jsonb_build_object('recepciones', to_jsonb(v_ids), 'diferencia', v_r->'diferencia', 'lineas_sin_leer', v_hueco));
  return jsonb_build_object('casada', true, 'texto', v_texto, 'recepciones', to_jsonb(v_ids), 'lineas_sin_leer', v_hueco);
end $$;
revoke all on function public._compras_casar_solo(uuid) from public, anon, authenticated;

create or replace function public.tg_supplier_invoice_casar_sola()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.inbox_id is null or new.supplier_id is null then return null; end if;
  if tg_op = 'UPDATE' and old.supplier_id is not null then return null; end if;
  -- En su propio bloque: si no puede casar, la factura entra igual y lo dice.
  begin
    perform public._compras_casar_solo(new.id);
  exception when others then
    insert into document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text)
    values (new.account_id, new.company_id, new.inbox_id, new.id, 'folvy', 'error', 'No he podido casarla con su albarán: ' || sqlerrm);
  end;
  return null;
end $$;
drop trigger if exists supplier_invoice_casar_sola on public.supplier_invoice;
create trigger supplier_invoice_casar_sola after insert or update of supplier_id on public.supplier_invoice
  for each row execute function public.tg_supplier_invoice_casar_sola();

-- ── 7 · El hueco de un albarán que no cuadra ──────────────────────────────
create or replace function public.compras_hueco_recepcion(p_recepcion uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g goods_receipt; v_hueco numeric; v_quien text := public.conta_nombre_actor();
  e text := 'FM999G999G990D00';
begin
  select * into g from goods_receipt where id = p_recepcion for update;
  if g.id is null then raise exception 'Esa recepción no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(g.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) = 0 then raise exception 'Dime por qué faltan esas líneas.' using errcode = '22023'; end if;
  select greatest(round(coalesce((a.validation->>'base_declared')::numeric, 0) - coalesce((a.validation->>'lines_sum')::numeric, 0), 2), 0)
    into v_hueco from goods_receipt_ai_session a where a.id = g.ai_session_id;
  update goods_receipt set unread_gap_amount = v_hueco, unread_gap_reason = btrim(p_motivo), unread_gap_by_name = v_quien, unread_gap_at = now(),
         needs_review = true, updated_at = now()
   where id = g.id;
  return jsonb_build_object('ok', true, 'mensaje', format('Apuntado: en %s faltan %s € de líneas sin leer, porque «%s». Queda marcado para la oficina.',
    coalesce(g.code, 'el albarán'), translate(to_char(coalesce(v_hueco, 0), e), ',.', '.,'), btrim(p_motivo)));
end $$;
revoke all on function public.compras_hueco_recepcion(uuid, text) from public, anon;
grant execute on function public.compras_hueco_recepcion(uuid, text) to authenticated;

-- ── 7b · Añadir en oficina la línea que no se leyó ────────────────────────
-- La línea entra por el MISMO camino que al recibir: se inserta y la coloca
-- _post_goods_receipt_lines en modo «solo lo que no ha entrado nunca» (su
-- movimiento de stock «recepcion», con su coste). No toca las líneas que ya
-- estaban. Lo que falta se recalcula: cuando ya no falta nada, queda dicho.
create or replace function public.compras_recepcion_linea_anadir(p_recepcion uuid, p_articulo uuid, p_cantidad numeric, p_importe numeric, p_texto text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g goods_receipt; v_nombre text; v_pos int; v_linea uuid; v_hueco numeric; v_anadido numeric; v_queda numeric; v_quien text := public.conta_nombre_actor();
  e text := 'FM999G999G990D00';
begin
  select * into g from goods_receipt where id = p_recepcion for update;
  if g.id is null then raise exception 'Esa recepción no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(g.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta.' using errcode = '42501';
  end if;
  if g.status not in ('recibido', 'confirmado') then raise exception 'Solo se añaden líneas a una recepción recibida o confirmada (esta está %).', g.status using errcode = '22023'; end if;
  select name into v_nombre from recipe_item where id = p_articulo and account_id = g.account_id;
  if v_nombre is null then raise exception 'Ese artículo no es de esta cuenta.' using errcode = 'P0002'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad tiene que ser mayor que cero.' using errcode = '22023'; end if;
  if p_importe is null or p_importe <= 0 then raise exception 'El importe de la línea tiene que ser mayor que cero.' using errcode = '22023'; end if;
  select coalesce(max(position), 0) + 1 into v_pos from goods_receipt_line where goods_receipt_id = g.id;
  insert into goods_receipt_line (account_id, goods_receipt_id, product_name, raw_text, qty_received, recipe_item_id, qty_in_base, unit_cost, doc_amount, position, discrepancy_reason)
  values (g.account_id, g.id, v_nombre, coalesce(nullif(btrim(p_texto), ''), v_nombre), p_cantidad, p_articulo, p_cantidad, round(p_importe / p_cantidad, 6), p_importe, v_pos,
          'Añadida en oficina: no se leyó del albarán')
  returning id into v_linea;
  perform public._post_goods_receipt_lines(g.id, true);
  -- Lo que faltaba (la base del albarán contra lo que sumaban sus líneas leídas) menos lo añadido en oficina.
  select greatest(round(coalesce((a.validation->>'base_declared')::numeric, 0) - coalesce((a.validation->>'lines_sum')::numeric, 0), 2), 0)
    into v_hueco from goods_receipt_ai_session a where a.id = g.ai_session_id;
  select coalesce(sum(round(l.qty_received * l.unit_cost, 2)), 0) into v_anadido
    from goods_receipt_line l where l.goods_receipt_id = g.id and l.discrepancy_reason = 'Añadida en oficina: no se leyó del albarán';
  v_queda := greatest(coalesce(v_hueco, 0) - v_anadido, 0);
  update goods_receipt set unread_gap_amount = v_queda,
         unread_gap_reason = case when v_queda < 0.01 then 'Añadidas en oficina las líneas que no se leyeron.' else unread_gap_reason end,
         unread_gap_by_name = v_quien, unread_gap_at = now(), updated_at = now()
   where id = g.id;
  return jsonb_build_object('ok', true, 'linea', v_linea, 'queda', v_queda,
    'mensaje', format('Añadida a %s: %s de %s por %s €; ha entrado al almacén.%s', coalesce(g.code, 'la recepción'),
                      trim(to_char(p_cantidad, 'FM999G990D###')), v_nombre, translate(to_char(p_importe, e), ',.', '.,'),
                      case when v_queda < 0.01 then ' Ya no falta nada por leer.' else format(' Aún faltan %s €.', translate(to_char(v_queda, e), ',.', '.,')) end));
end $$;
revoke all on function public.compras_recepcion_linea_anadir(uuid, uuid, numeric, numeric, text) from public, anon;
grant execute on function public.compras_recepcion_linea_anadir(uuid, uuid, numeric, numeric, text) to authenticated;

-- ── 8 · El correo de facturas de una empresa (solo lee) ───────────────────
create or replace function public.conta_correo_facturas(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a company_inbound_address; v_conf inbound_email_log; v_ult timestamptz; v_lleg jsonb;
begin
  if not exists (select 1 from company c where c.id = p_company and public.belongs_to_account(c.account_id)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  select * into a from company_inbound_address where company_id = p_company and kind = 'facturas';
  if a.id is null then return jsonb_build_object('direccion', null); end if;
  select max(received_at) into v_ult from inbound_email_log
   where company_id = p_company and lower(split_part(to_address, '@', 1)) = lower(a.local_part);
  select * into v_conf from inbound_email_log
   where company_id = p_company and outcome = 'confirmacion' and lower(split_part(to_address, '@', 1)) = lower(a.local_part)
   order by received_at desc limit 1;
  select coalesce(jsonb_agg(x order by x->>'fecha' desc), '[]') into v_lleg from (
    select jsonb_build_object('fecha', l.received_at, 'de', l.from_address, 'asunto', l.subject, 'resultado', l.outcome,
             'llegada', d.status, 'motivo', d.reason,
             'factura', case when si.id is not null then jsonb_build_object('id', si.id, 'codigo', si.code, 'numero', si.invoice_number, 'total', si.grand_total,
                                                                         'proveedor', sp.name, 'casada', exists (select 1 from supplier_invoice_receipt r where r.supplier_invoice_id = si.id)) end,
             'dicho', (select da.text from document_activity da where da.supplier_invoice_id = coalesce(d.supplier_invoice_id, d.duplicate_of_invoice_id)
                         and da.action in ('casada', 'propuesta') order by da.created_at desc limit 1)) x
      from inbound_email_log l
      left join document_inbox d on d.email_id = l.email_id and d.company_id = p_company
      left join supplier_invoice si on si.id = coalesce(d.supplier_invoice_id, d.duplicate_of_invoice_id)
      left join supplier sp on sp.id = si.supplier_id
     where l.company_id = p_company and lower(split_part(l.to_address, '@', 1)) = lower(a.local_part)
     order by l.received_at desc limit 30) y;
  return jsonb_build_object('direccion', a.local_part || '@' || a.domain, 'activa', a.active, 'ultimo', v_ult,
    'confirmacion', case when v_conf.id is not null then jsonb_build_object('fecha', v_conf.received_at, 'codigo', v_conf.detail->>'codigo', 'enlace', v_conf.detail->>'enlace') end,
    'llegadas', v_lleg);
end $$;
revoke all on function public.conta_correo_facturas(uuid) from public, anon;
grant execute on function public.conta_correo_facturas(uuid) to authenticated;

-- ── 9 · La factura contra sus albaranes, línea a línea (solo lee) ─────────
create or replace function public._compras_texto_norm(p text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(lower(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun')), '[^a-z0-9]+', ' ', 'g'))
$$;
revoke all on function public._compras_texto_norm(text) from public, anon, authenticated;

create or replace function public._compras_lineas_comparar(p_factura uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_alb jsonb; v_out jsonb := '[]'; fl record; v_hit int; a jsonb; v_res text;
  n_ok int := 0; n_dif int := 0; n_fac int := 0; n_alb int := 0; n_lin int := 0;
begin
  -- Las líneas de los albaranes casados con la factura, en su orden.
  select coalesce(jsonb_agg(jsonb_build_object(
           'albaran', coalesce(g.supplier_doc_number, g.code), 'art', l.recipe_item_id, 'cod', nullif(lower(btrim(l.supplier_code)), ''),
           'txt', public._compras_texto_norm(coalesce(l.raw_text, l.product_name)), 'texto', coalesce(l.product_name, l.raw_text),
           'cant', coalesce(l.doc_qty, l.qty_received), 'importe', coalesce(l.doc_amount, round(l.qty_received * l.unit_cost, 2)), 'usada', false)
           order by g.receipt_date, g.code, l.position, l.created_at), '[]')
    into v_alb
    from supplier_invoice_receipt r join goods_receipt g on g.id = r.goods_receipt_id
    join goods_receipt_line l on l.goods_receipt_id = g.id
   where r.supplier_invoice_id = p_factura;
  for fl in
    select il.recipe_item_id, nullif(lower(btrim(il.supplier_code)), '') cod, public._compras_texto_norm(il.raw_text) txt,
           il.raw_text, il.qty, il.line_amount
      from supplier_invoice_line il where il.supplier_invoice_id = p_factura order by il.position, il.created_at
  loop
    n_lin := n_lin + 1;
    -- Su línea del albarán: el mismo artículo, si no el mismo código del proveedor, si no el mismo texto.
    select x.i - 1 into v_hit from jsonb_array_elements(v_alb) with ordinality x(e, i)
     where not (x.e->>'usada')::boolean
       and ((fl.recipe_item_id is not null and x.e->>'art' = fl.recipe_item_id::text)
         or (fl.cod is not null and x.e->>'cod' = fl.cod)
         or (fl.txt <> '' and x.e->>'txt' = fl.txt))
     order by case when x.e->>'art' = fl.recipe_item_id::text then 1 when x.e->>'cod' = fl.cod then 2 else 3 end, x.i
     limit 1;
    if v_hit is null then
      n_fac := n_fac + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object('resultado', 'solo_factura', 'texto_factura', fl.raw_text,
                 'cant_factura', fl.qty, 'importe_factura', fl.line_amount));
      continue;
    end if;
    a := v_alb->v_hit;
    v_alb := jsonb_set(v_alb, array[v_hit::text, 'usada'], 'true');
    v_res := case when fl.qty is not null and (a->>'cant') is not null and abs(fl.qty - (a->>'cant')::numeric) > 0.001 then 'cantidad'
                  when fl.line_amount is not null and (a->>'importe') is not null and abs(fl.line_amount - (a->>'importe')::numeric) > 0.02 then 'importe'
                  else 'cuadra' end;
    if v_res = 'cuadra' then n_ok := n_ok + 1; else n_dif := n_dif + 1; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('resultado', v_res, 'texto_factura', fl.raw_text, 'albaran', a->>'albaran',
               'texto_albaran', a->>'texto', 'cant_factura', fl.qty, 'cant_albaran', (a->>'cant')::numeric,
               'importe_factura', fl.line_amount, 'importe_albaran', (a->>'importe')::numeric));
  end loop;
  -- Lo que está en el albarán y la factura no trae.
  for a in select x.e from jsonb_array_elements(v_alb) x(e) where not (x.e->>'usada')::boolean loop
    n_alb := n_alb + 1;
    v_out := v_out || jsonb_build_array(jsonb_build_object('resultado', 'solo_albaran', 'albaran', a->>'albaran', 'texto_albaran', a->>'texto',
               'cant_albaran', (a->>'cant')::numeric, 'importe_albaran', (a->>'importe')::numeric));
  end loop;
  return jsonb_build_object('lineas_factura', n_lin, 'cuadran', n_ok, 'difieren', n_dif, 'solo_factura', n_fac, 'solo_albaran', n_alb, 'lineas', v_out);
end $$;
revoke all on function public._compras_lineas_comparar(uuid) from public, anon, authenticated;

create or replace function public.compras_factura_lineas(p_factura uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f supplier_invoice;
begin
  select * into f from supplier_invoice where id = p_factura;
  if f.id is null or not public.belongs_to_account(f.account_id) then
    raise exception 'Esa factura no está.' using errcode = 'P0002';
  end if;
  return public._compras_lineas_comparar(f.id);
end $$;
revoke all on function public.compras_factura_lineas(uuid) from public, anon;
grant execute on function public.compras_factura_lineas(uuid) to authenticated;
