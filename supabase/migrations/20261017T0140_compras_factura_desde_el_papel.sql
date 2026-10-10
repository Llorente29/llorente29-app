-- ============================================================================
-- Compras · 5 · LA FACTURA SALE DEL PAPEL, Y LA APROBACIÓN LA IMPONE LA BASE
-- ----------------------------------------------------------------------------
-- cambia: public.goods_receipt_path · prueba: supabase/staging/sql/20261017_compras_factura_prueba.sql
--
-- Encargo «Contabilidad: las compras», §2.3 y §4.3 (10/10).
--
-- 1 · Cuando una recepción va por «factura» (0120: el papel es una factura o
--     un albarán-factura a nombre de la empresa), Folvy crea la factura del
--     proveedor DESDE EL MISMO DOCUMENTO: mismo fichero, mismo número, sus
--     líneas con su IVA, enlazada a la recepción. Quien recepciona no hace
--     nada nuevo. La factura nace «en_revision»: sigue el camino de aprobación
--     que ya existe, y aprobada, la propone el libro (propuestasLibroService).
--     Lo hace un disparador sobre goods_receipt_path, así que vale igual al
--     confirmar, al contestar «¿a nombre de quién va?» o al cambiar la ficha.
--
--     No se crea, y se dice en la fila del camino:
--       · si el papel no trae importes por línea con su IVA («factura_sin_importes»);
--       · si ya hay una factura viva del mismo proveedor con el mismo número:
--         la recepción se ENLAZA a ella («factura_repetida»), no se mete dos
--         veces el mismo papel;
--       · si la recepción es anterior al corte de la empresa (fiscal_year
--         .imported_until): ese mes lo lleva el programa anterior.
--     Si crearla FALLA, la fila se queda en «factura» con la pregunta «error»
--     y el mensaje; la recepción ya está confirmada y no se toca (encargo §8).
--
-- 2 · La factura sin recepción (servicios, suministros, alquiler) entra por
--     Compras con el mismo constructor: compras_factura_desde_papel.
--
-- 3 · supplier_invoice.company_id: de qué empresa es la factura (la que dice
--     el papel). Hasta hoy el libro la proponía en la empresa que se estuviera
--     mirando.
--
-- 4 · LA APROBACIÓN, EN LA BASE. Hasta hoy invoice_required_role solo lo
--     miraba el navegador (canApproveInvoice): cualquiera con acceso a la
--     cuenta podía poner «aprobada» por la API. Ahora un disparador lo impide
--     con las mismas reglas (invoice_approval_rule; sin regla, encargado) y
--     apunta quién y cuándo. Sin usuario (migraciones, procesos del servidor)
--     no se mira: no hay a quién preguntar.
--
-- No toca stock ni coste: las líneas de la factura nacen sin artículo, y
-- apply_invoice_costs solo actúa sobre líneas con artículo.
-- Vuelta atrás: supabase/vuelta-atras/20261017T0140_compras_factura_desde_el_papel.down.sql
-- ============================================================================

-- ── 1 · Columnas ───────────────────────────────────────────────────────────
alter table public.supplier_invoice add column if not exists company_id uuid references public.company(id);
comment on column public.supplier_invoice.company_id is
  'Compras (10/10). La empresa a cuyo nombre va la factura (la que dice el papel, goods_receipt_path.company_id). Vacío en las de antes: el libro las propone en la empresa que se mira.';
create index if not exists supplier_invoice_empresa on public.supplier_invoice (company_id) where company_id is not null;

alter table public.goods_receipt_path add column if not exists supplier_invoice_id uuid references public.supplier_invoice(id) on delete set null;
comment on column public.goods_receipt_path.supplier_invoice_id is 'Compras (10/10). La factura que salió de esta recepción, o a la que se enlazó.';

-- Dos preguntas más: amplía el CHECK (solo añade valores).
alter table public.goods_receipt_path drop constraint if exists goods_receipt_path_question_check;
alter table public.goods_receipt_path add constraint goods_receipt_path_question_check
  check (question in ('a_nombre_de', 'papel_y_ficha', 'ficha_sin_forma', 'sin_papel', 'a_nombre_de_otro', 'error',
                      'factura_sin_importes', 'factura_repetida'));

-- ── 2 · El constructor: una factura desde un papel leído ───────────────────
-- Devuelve {factura, creada, repetida, sin_importes, motivo}. No escribe nada
-- si sin_importes. Si repetida, devuelve la que ya había.
create or replace function public._compras_factura_desde_papel(
  p_cuenta uuid, p_sesion uuid, p_proveedor uuid, p_local uuid, p_empresa uuid,
  p_recepcion uuid default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_doc jsonb; v_lineas jsonb; v_num text; v_fecha date; v_id uuid; v_ok int; v_total int;
  v_base numeric; v_cuota numeric; v_url text;
begin
  select a.parsed_result->'document', coalesce(a.parsed_result->'lines', '[]'::jsonb) into v_doc, v_lineas
    from goods_receipt_ai_session a where a.id = p_sesion and a.account_id = p_cuenta;
  if v_doc is null then raise exception 'Ese papel no está leído en esta cuenta.' using errcode = 'P0002'; end if;
  if not exists (select 1 from supplier where id = p_proveedor and account_id = p_cuenta) then
    raise exception 'Ese proveedor no es de esta cuenta.' using errcode = '42501';
  end if;

  v_num := nullif(btrim(v_doc->>'doc_number'), '');
  if v_num is null and p_recepcion is not null then
    select nullif(btrim(supplier_doc_number), '') into v_num from goods_receipt where id = p_recepcion;
  end if;
  begin v_fecha := (v_doc->>'doc_date')::date; exception when others then v_fecha := null; end;
  if v_fecha is null and p_recepcion is not null then select receipt_date into v_fecha from goods_receipt where id = p_recepcion; end if;
  v_fecha := coalesce(v_fecha, current_date);

  -- El mismo papel dos veces: mismo proveedor y mismo número, o la misma lectura.
  select si.id into v_id from supplier_invoice si
   where si.account_id = p_cuenta and si.status <> 'anulada'
     and (si.ai_session_id = p_sesion
          or (v_num is not null and si.supplier_id = p_proveedor
              and upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(v_num, '[^A-Za-z0-9]', '', 'g'))))
   order by si.created_at limit 1;
  if v_id is not null then
    if p_recepcion is not null then
      insert into supplier_invoice_receipt (supplier_invoice_id, goods_receipt_id) values (v_id, p_recepcion) on conflict do nothing;
    end if;
    return jsonb_build_object('factura', v_id, 'creada', false, 'repetida', true,
      'motivo', format('Esta factura ya estaba (%s): se enlaza a ella, no se crea otra.', (select code from supplier_invoice where id = v_id)));
  end if;

  -- Importes: cada línea con su importe neto y su IVA.
  select count(*) filter (where jsonb_typeof(l->'line_amount') = 'number' and jsonb_typeof(l->'vat_pct') = 'number'), count(*)
    into v_ok, v_total from jsonb_array_elements(v_lineas) l;
  if v_total = 0 or v_ok < v_total then
    return jsonb_build_object('factura', null, 'creada', false, 'sin_importes', true,
      'motivo', case when v_total = 0 then 'El papel no trae líneas: sube la factura en Compras.'
                     else format('El papel trae %s línea(s) sin importe o sin IVA: sube la factura en Compras o complétala.', v_total - v_ok) end);
  end if;

  select sum((l->>'line_amount')::numeric), sum(round((l->>'line_amount')::numeric * (l->>'vat_pct')::numeric / 100, 2))
    into v_base, v_cuota from jsonb_array_elements(v_lineas) l;
  if p_recepcion is not null then select raw_document_url into v_url from goods_receipt where id = p_recepcion; end if;

  insert into supplier_invoice (account_id, supplier_id, location_id, company_id, doc_kind, invoice_number, invoice_date, status,
                                source, ai_session_id, raw_document_url, tax_base_total, tax_total, grand_total, needs_review,
                                notes, created_by, created_by_name)
  values (p_cuenta, p_proveedor, p_local, p_empresa, 'invoice', v_num, v_fecha, 'en_revision',
          'ocr', p_sesion, v_url,
          coalesce((v_doc->>'tax_base_total')::numeric, v_base), coalesce((v_doc->>'tax_total')::numeric, v_cuota),
          coalesce((v_doc->>'grand_total')::numeric, v_base + v_cuota),
          -- Lo que dice la cabecera contra lo que suman las líneas: si no cuadra, se revisa.
          abs(coalesce((v_doc->>'tax_base_total')::numeric, v_base) - v_base) > 0.02,
          case when p_recepcion is not null then 'Creada al confirmar la recepción ' || (select code from goods_receipt where id = p_recepcion) || '.' end,
          auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor(), 'Folvy'))
  returning id into v_id;

  insert into supplier_invoice_line (supplier_invoice_id, raw_text, supplier_code, qty, unit_price, line_amount, vat_pct, position)
  select v_id, l->>'raw_text', nullif(l->>'supplier_code', ''),
         case when jsonb_typeof(l->'quantity') = 'number' then (l->>'quantity')::numeric end,
         case when jsonb_typeof(l->'unit_price_net') = 'number' then (l->>'unit_price_net')::numeric end,
         (l->>'line_amount')::numeric, (l->>'vat_pct')::numeric, (n - 1)::int
    from jsonb_array_elements(v_lineas) with ordinality as t(l, n);

  if p_recepcion is not null then
    insert into supplier_invoice_receipt (supplier_invoice_id, goods_receipt_id) values (v_id, p_recepcion) on conflict do nothing;
  end if;
  return jsonb_build_object('factura', v_id, 'creada', true, 'repetida', false,
    'motivo', format('Factura %s creada desde el papel: %s € de base, %s € de IVA.', coalesce(v_num, 'sin número'), v_base, v_cuota));
end $$;
revoke all on function public._compras_factura_desde_papel(uuid, uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;

-- La factura sin recepción, por Compras (quien sube el papel ya lo ha leído
-- con ocr-albaran, que deja la sesión).
create or replace function public.compras_factura_desde_papel(p_sesion uuid, p_proveedor uuid, p_local uuid, p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from goods_receipt_ai_session where id = p_sesion;
  if v_cuenta is null then raise exception 'Ese papel no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'No puedes registrar facturas en esta cuenta.' using errcode = '42501';
  end if;
  if p_empresa is not null and not exists (select 1 from company where id = p_empresa and account_id = v_cuenta) then
    raise exception 'Esa empresa no es de esta cuenta.' using errcode = '42501';
  end if;
  return public._compras_factura_desde_papel(v_cuenta, p_sesion, p_proveedor, p_local, p_empresa, null, null);
end $$;
revoke all on function public.compras_factura_desde_papel(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.compras_factura_desde_papel(uuid, uuid, uuid, uuid) to authenticated;

-- ── 3 · Desde la recepción: el disparador del camino ───────────────────────
-- AFTER INSERT OR UPDATE en goods_receipt_path: si el camino es «factura» y
-- todavía no tiene factura, la crea (o enlaza) y deja la fila consumida.
-- AFTER y no BEFORE: con «insert … on conflict do update» (lo que hace
-- _compras_camino_guarda), un BEFORE INSERT salta también para la fila
-- PROPUESTA aunque acabe en update, y la factura se crearía dos veces. Su
-- propio update no lo vuelve a disparar (marca de la transacción). En su
-- propio bloque: si falla, la fila lo dice y nada más se deshace.
create or replace function public.tg_goods_receipt_path_factura()
returns trigger language plpgsql security definer set search_path = public as $$
declare g goods_receipt; v jsonb; v_corte date;
begin
  if current_setting('folvy.compras_factura', true) = 'si' then return null; end if;
  if new.path <> 'factura' or new.supplier_invoice_id is not null or new.consumed_at is not null then
    return null;
  end if;
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
             question_detail = jsonb_build_object('motivo', 'Folvy no pudo crear la factura desde el papel.')
       where id = new.id;
    end;
  end if;
  perform set_config('folvy.compras_factura', '', true);
  return null;
end $$;
revoke all on function public.tg_goods_receipt_path_factura() from public, anon, authenticated;
drop trigger if exists trg_goods_receipt_path_factura on public.goods_receipt_path;
create trigger trg_goods_receipt_path_factura after insert or update on public.goods_receipt_path
  for each row execute function public.tg_goods_receipt_path_factura();

-- ── 4 · La aprobación, en la base ──────────────────────────────────────────
-- Las mismas reglas que invoice_required_role (la primera activa que
-- encaja por importe, proveedor y local, por prioridad; sin regla, encargado),
-- calculadas sobre la fila que se va a guardar.
create or replace function public.supplier_invoice_aprobacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text;
begin
  if new.status <> 'aprobada' or (tg_op = 'UPDATE' and old.status = 'aprobada') then
    return new;
  end if;
  if auth.uid() is null then return new; end if;   -- sin usuario: migración o proceso del servidor
  select r.required_role into v_rol from invoice_approval_rule r
   where r.account_id = new.account_id and r.active
     and (r.min_amount is null or coalesce(new.grand_total, 0) >= r.min_amount)
     and (r.max_amount is null or coalesce(new.grand_total, 0) <= r.max_amount)
     and (r.supplier_id is null or r.supplier_id = new.supplier_id)
     and (r.location_id is null or r.location_id = new.location_id)
   order by r.priority asc limit 1;
  v_rol := coalesce(v_rol, 'manager');
  if v_rol = 'admin' and not public.current_user_is_admin_of(new.account_id) then
    raise exception 'Esta factura la tiene que aprobar un administrador.' using errcode = '42501';
  elsif v_rol <> 'admin' and not public.current_user_is_admin_or_manager_of(new.account_id) then
    raise exception 'No puedes aprobar facturas: hace falta un encargado o un administrador.' using errcode = '42501';
  end if;
  new.approved_at := coalesce(new.approved_at, now());
  new.approved_by := coalesce(new.approved_by, auth.uid());
  new.approved_by_name := coalesce(new.approved_by_name, public.conta_nombre_actor());
  return new;
end $$;
revoke all on function public.supplier_invoice_aprobacion() from public, anon, authenticated;
drop trigger if exists trg_supplier_invoice_aprobacion on public.supplier_invoice;
create trigger trg_supplier_invoice_aprobacion before insert or update of status on public.supplier_invoice
  for each row execute function public.supplier_invoice_aprobacion();
