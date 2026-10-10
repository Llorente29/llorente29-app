-- ============================================================================
-- Compras · 10 · EL REPASO DE LAS PANTALLAS (lo que pide la base)
-- ----------------------------------------------------------------------------
-- cambia: public._compras_destinatario · prueba: supabase/staging/sql/20261017_compras_repaso_prueba.sql
--
-- Repaso de Julio del 10/10 contra las maquetas, lo que no se puede hacer
-- solo con el front:
--
-- 1 · Un papel a nombre de «Contado», «Varios», «Cliente»… no pregunta de
--     quién es: es un aviso de que así no se descuenta el IVA. El nombre
--     genérico se trata como «no es nuestro» (camino a_nombre_de_otro).
--     _compras_destinatario, misma firma; solo añade ese caso al final, y
--     el CHECK de goods_receipt_path.bill_to_how admite «generico».
-- 2 · «Apuntarla sin descontar el IVA»: supplier_invoice.vat_non_deductible y
--     compras_sin_iva(recepción, empresa), que registra la factura de su papel
--     con esa marca y cierra la pregunta. El asiento lo propone el libro con
--     el IVA como más gasto, sin 472 y fuera del libro de recibidas.
-- 3 · compras_liquidacion_recepciones(liquidación): los albaranes que cuenta
--     el contraste de compras («Ver los N albaranes»).
--
-- No toca stock ni coste. Vuelta atrás:
-- supabase/vuelta-atras/20261017T0190_compras_repaso.down.sql
-- ============================================================================

-- ── 1 · Los nombres que no son de nadie ────────────────────────────────────
create or replace function public.compras_nombre_generico(p text)
returns boolean language sql immutable parallel safe set search_path = public as $$
  select public.compras_nombre_norm(p) in (
    'contado', 'al contado', 'venta al contado', 'cliente contado', 'clientes contado', 'contado cliente',
    'cliente', 'clientes', 'cliente varios', 'clientes varios', 'varios', 'varios clientes',
    'particular', 'particulares', 'consumidor final', 'publico', 'cliente final', 'mostrador', 'cliente mostrador')
$$;
grant execute on function public.compras_nombre_generico(text) to authenticated;

-- El cómo del destinatario admite «generico» (el CHECK de la 0120 solo amplía).
alter table public.goods_receipt_path drop constraint if exists goods_receipt_path_how_check;
alter table public.goods_receipt_path add constraint goods_receipt_path_how_check
  check (bill_to_how in ('nif', 'recordado', 'nombre', 'ficha', 'sin_dato', 'desconocido', 'generico'));

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
  -- Repaso (10/10): «Contado», «Varios»… no es de nadie: no se pregunta, se avisa.
  if public.compras_nombre_generico(p_nombre) then
    return query select 'otro'::text, null::uuid, null::uuid, 'generico'::text; return;
  end if;
  return query select 'desconocido'::text, null::uuid, null::uuid, 'desconocido'::text;
end $$;
revoke all on function public._compras_destinatario(uuid, text, text) from public, anon, authenticated;

-- ── 2 · Apuntarla sin descontar el IVA ─────────────────────────────────────
alter table public.supplier_invoice add column if not exists vat_non_deductible boolean not null default false;
comment on column public.supplier_invoice.vat_non_deductible is
  'Compras (10/10). La factura no va a nombre de la empresa: su IVA es más gasto, no va a la 472 ni al libro de recibidas como deducible.';

create or replace function public.compras_sin_iva(p_recepcion uuid, p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p goods_receipt_path; g goods_receipt; v jsonb; v_factura uuid;
begin
  select * into p from goods_receipt_path where goods_receipt_id = p_recepcion for update;
  if p.id is null then raise exception 'Esa recepción no tiene camino.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(p.account_id) then raise exception 'No puedes decidir esto en esta cuenta.' using errcode = '42501'; end if;
  if p.path <> 'a_nombre_de_otro' then raise exception 'Solo se apunta sin IVA un papel que va a nombre de otro.' using errcode = '22023'; end if;
  if not exists (select 1 from company where id = p_empresa and account_id = p.account_id) then
    raise exception 'Esa empresa no es de esta cuenta.' using errcode = '42501';
  end if;
  select * into g from goods_receipt where id = p_recepcion;
  if g.ai_session_id is null then raise exception 'La recepción no tiene papel leído.' using errcode = '22023'; end if;
  -- Sin que el disparador de la 0140 intente crearla otra vez.
  perform set_config('folvy.compras_factura', 'si', true);
  v := public._compras_factura_desde_papel(g.account_id, g.ai_session_id, g.supplier_id, g.location_id, p_empresa, g.id, null);
  perform set_config('folvy.compras_factura', '', true);
  if coalesce((v->>'sin_importes')::boolean, false) or v->>'factura' is null then
    raise exception '%', v->>'motivo' using errcode = '22023';
  end if;
  v_factura := (v->>'factura')::uuid;
  update supplier_invoice set vat_non_deductible = true where id = v_factura;
  update goods_receipt_path set path = 'factura', company_id = p_empresa, supplier_invoice_id = v_factura, consumed_at = now(),
         question_closed = question, question_closed_note = 'Apuntada sin descontar el IVA.',
         question_closed_by_name = public.conta_nombre_actor(), question_closed_at = now(),
         reason = format('Va a nombre de «%s», no de tu empresa: se apunta sin descontar el IVA.', coalesce(bill_to_name, 'otro'))
   where id = p.id;
  return jsonb_build_object('factura', v_factura, 'repetida', coalesce((v->>'repetida')::boolean, false),
    'frase', format('Apuntada sin descontar el IVA: %s. Su IVA va como más gasto; no va a la 472 ni al libro de facturas recibidas como deducible.', v->>'motivo'));
end $$;
revoke all on function public.compras_sin_iva(uuid, uuid) from public, anon;
grant execute on function public.compras_sin_iva(uuid, uuid) to authenticated;

-- ── 3 · Los albaranes del contraste de compras ─────────────────────────────
-- La misma selección que _compras_liquidacion_contraste (0160).
create or replace function public.compras_liquidacion_recepciones(p_liq uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l licensed_settlement; v jsonb;
begin
  select * into l from licensed_settlement where id = p_liq;
  if l.id is null then raise exception 'Esa liquidación no existe.' using errcode = 'P0002'; end if;
  if not (select belongs_to_account(l.account_id)) then raise exception 'Esa liquidación no es de tu cuenta.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('recepcion', g.id, 'codigo', g.code, 'fecha', g.receipt_date,
           'base', public._compras_base_recepcion(g.id)) order by g.receipt_date, g.code), '[]'::jsonb) into v
    from goods_receipt g left join goods_receipt_path p on p.goods_receipt_id = g.id
   where g.account_id = l.account_id and g.location_id = l.location_id and g.status = 'confirmado'
     and g.receipt_date between l.period_from and l.period_to
     and ((p.id is not null and p.path = 'liquidacion' and p.supplier_id = l.supplier_id)
          or (p.id is null and g.supplier_id = l.supplier_id));
  return v;
end $$;
revoke all on function public.compras_liquidacion_recepciones(uuid) from public, anon;
grant execute on function public.compras_liquidacion_recepciones(uuid) to authenticated;
