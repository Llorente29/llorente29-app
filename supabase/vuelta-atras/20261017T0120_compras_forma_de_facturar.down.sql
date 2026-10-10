-- ============================================================================
-- Vuelta atrás de Compras · 3 · cómo te factura cada proveedor.
-- Para si alguna fila de camino ya la usó una factura, un casado o una
-- liquidación (consumed_at): eso se deshace antes, con su propia vuelta atrás.
-- Devuelve la fusión de proveedores a la de la 0100 (texto exacto), quita el
-- disparador, las funciones, las dos tablas y las dos columnas.
-- ============================================================================
do $$
begin
  if exists (select 1 from public.goods_receipt_path where consumed_at is not null) then
    raise exception 'Hay recepciones cuyo camino ya usó una factura o una liquidación: deshaz eso antes.';
  end if;
  if exists (select 1 from public.supplier_merge where undone_at is null
              and (moved ? 'purchase_bill_to' and jsonb_array_length(moved->'purchase_bill_to') > 0
                   or moved ? 'goods_receipt_path' and jsonb_array_length(moved->'goods_receipt_path') > 0)) then
    raise exception 'Hay fusiones de proveedor que movieron filas de compras: deshazlas antes.';
  end if;
end $$;

drop trigger if exists trg_goods_receipt_compras_camino on public.goods_receipt;
drop function if exists public.tg_goods_receipt_compras_camino();
drop function if exists public.compras_ficha_le_falta(uuid);
drop function if exists public._compras_camino_rellena(uuid, date);
drop function if exists public.compras_forma_facturar(uuid, text, boolean, text);
drop function if exists public._compras_forma_facturar(uuid, text, boolean, text);
drop function if exists public.compras_destinatario_decide(uuid, text, uuid, uuid, boolean);
drop function if exists public._compras_destinatario_decide(uuid, text, uuid, uuid, boolean, text);
drop function if exists public._compras_camino_guarda(uuid);
drop function if exists public.compras_camino_calcula(uuid);
drop function if exists public._compras_camino_calcula(uuid);
drop function if exists public._compras_destinatario(uuid, text, text);

-- La fusión de la 0100, tal cual (antes de quitar las tablas que nombra la nueva).
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
                             'compliance_document', 'ctb_notification_queue', 'invoice_approval_rule', 'supplier_learning_log'] loop
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
                             'notify_group', 'invoicing_frequency', 'currency', 'related_party_kind', 'usual_tax_rate_ids', 'early_payment_discount_pct'] loop
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
                             'supplier_learning', 'supplier_contact', 'supplier_proposal'] loop
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

drop table if exists public.goods_receipt_path;
drop table if exists public.purchase_bill_to;
drop function if exists public.compras_nif_norm(text);
drop function if exists public.compras_nombre_norm(text);
alter table public.supplier drop column if exists invoicing_per_location;
alter table public.supplier drop column if exists invoicing_mode;
