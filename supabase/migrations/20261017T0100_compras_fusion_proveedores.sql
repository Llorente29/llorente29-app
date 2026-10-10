-- ============================================================================
-- Compras · 1 · UNIR DOS FICHAS DE PROVEEDOR (herramienta general)
-- ----------------------------------------------------------------------------
-- cambia: public.party_merge_do · prueba: supabase/staging/sql/20261017_compras_fusion_prueba.sql
-- cambia: public.party_merge_undo · prueba: supabase/staging/sql/20261017_compras_fusion_prueba.sql
--
-- El mismo proveedor dos veces (o cinco) le pasa a cualquier cliente: una
-- ficha nace en Cocina con el nombre del albarán, otra la trae Diez con el
-- NIF. «Unir» deja UNA ficha viva con todo lo de las dos.
--
-- La fusión de terceros (20261012T0120) no tocaba nada que colgara del
-- proveedor («moverlos sería tocar Cocina»). Esta sí, por orden de Julio
-- (10/10): recepciones, pedidos, compras, facturas, artículos y sus precios,
-- alias de emisor, contactos, propuestas, lo aprendido, documentos, avisos,
-- reglas de aprobación y las cuentas del proveedor. Y después fusiona sus
-- terceros con la de terceros, para que la ficha de Contabilidad sea una.
--
--   · Se mueve todo lo que se puede mover sin chocar con una clave única.
--   · Lo que choca NO se pisa: se queda en la ficha que se va (archivada) y
--     el rastro lo dice, fila a fila. Los choques posibles: el mismo artículo
--     con el mismo código en las dos (article_supplier), el mismo dato
--     aprendido (supplier_learning), dos contactos principales, la misma
--     propuesta, o una cuenta del proveedor con el mismo papel.
--   · Los datos de la ficha que la que queda tiene vacíos se rellenan con los
--     de la que se va (notify_group incluido: si no, los avisos que
--     confirm_goods_receipt encola por proveedor dejarían de salir).
--   · No se mueve nada de las copias de seguridad ni de los registros de
--     movimientos (_backup_*, c01b_*, c02_*): son historia.
--   · Lo validado no cambia de tercero: si el tercero de la que se va tiene
--     asientos validados, la fusión de terceros para y TODO se deshace.
--
-- Mover el proveedor de una recepción, un pedido o un artículo no dispara
-- nada (medido el 10/10: los disparadores de goods_receipt saltan con el
-- estado; los de article_supplier, con precio, formato, preferido y activo).
-- No cambia stock ni coste.
--
-- Las dos fusiones se separan en «quién puede» (supplier_merge_do,
-- party_merge_do: administrador o encargado de la cuenta) y «qué hace»
-- (_supplier_merge, _party_merge: sin comprobar quién, revocadas a todos),
-- para que una migración —que no lleva usuario— pueda unir fichas. La de
-- terceros sigue haciendo exactamente lo mismo que antes.
--
-- Vuelta atrás: supabase/vuelta-atras/20261017T0100_compras_fusion_proveedores.down.sql
-- ============================================================================

-- ── La fusión de terceros, partida en «qué hace» y «quién puede» ───────────
create or replace function public._party_merge(p_queda uuid, p_se_va uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_a party; v_b party;
  v_mov jsonb := '{}'::jsonb; v_quedan jsonb := '[]'::jsonb; v_ids uuid[];
  v_validados int; v_n int := 0; v_resumen text; v_nif_movido boolean := false; v_merge uuid; v_prov uuid[]; r record;
begin
  if p_queda = p_se_va then raise exception 'Es la misma ficha.' using errcode = '22023'; end if;
  select * into v_a from party where id = p_queda for update;
  if v_a.id is null then raise exception 'Ese tercero no existe.' using errcode = 'P0002'; end if;
  v_cuenta := v_a.account_id;
  select * into v_b from party where id = p_se_va for update;
  if v_b.id is null or v_b.account_id <> v_cuenta then raise exception 'Las dos fichas tienen que ser de la misma cuenta.' using errcode = '42501'; end if;
  if exists (select 1 from party_merge m where m.undone_at is null and m.gone_party_id = p_queda) then
    raise exception '% ya se fusionó en otra ficha: fusiona con esa.', v_a.name using errcode = '22023';
  end if;

  select (select count(*) from journal_entry where party_id = p_se_va and status in ('validado', 'anulado'))
       + (select count(*) from journal_line l join journal_entry e on e.id = l.entry_id where l.party_id = p_se_va and e.status in ('validado', 'anulado'))
    into v_validados;
  if v_validados > 0 then
    raise exception '% sale en % asiento(s) o apunte(s) validados: lo validado no cambia de tercero. Anúlalos y rehazlos con %, y vuelve a fusionar.', v_b.name, v_validados, v_a.name
      using errcode = '23514';
  end if;

  select coalesce(array_agg(x.id), '{}') into v_ids from party_role x
   where x.party_id = p_se_va and not exists (select 1 from party_role y where y.party_id = p_queda and y.role = x.role);
  for r in select role from party_role where party_id = p_se_va and not (id = any(v_ids)) loop
    v_quedan := v_quedan || jsonb_build_object('que', 'papel', 'papel', r.role);
  end loop;
  update party_role set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('party_role', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  select coalesce(array_agg(l.id), '{}') into v_ids from company_account_link l
   where l.account_id = v_cuenta and l.entity = 'customer' and l.entity_id = p_se_va::text
     and not exists (select 1 from company_account_link x where x.company_id = l.company_id and x.entity = 'customer' and x.entity_id = p_queda::text and x.role = l.role);
  for r in select l.role, a.code from company_account_link l join company_account a on a.id = l.company_account_id
            where l.account_id = v_cuenta and l.entity = 'customer' and l.entity_id = p_se_va::text and not (l.id = any(v_ids)) loop
    v_quedan := v_quedan || jsonb_build_object('que', 'cuenta', 'papel', r.role, 'codigo', r.code);
  end loop;
  update company_account_link set entity_id = p_queda::text where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('company_account_link', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  if exists (select 1 from customer_fiscal where party_id = p_se_va) then
    if not exists (select 1 from customer_fiscal where party_id = p_queda) then
      update customer_fiscal set party_id = p_queda where party_id = p_se_va;
      v_mov := v_mov || jsonb_build_object('customer_fiscal', true); v_n := v_n + 1;
    else
      v_quedan := v_quedan || jsonb_build_object('que', 'datos_fiscales');
    end if;
  end if;

  select coalesce(array_agg(id), '{}') into v_ids from channel_settlement where party_id = p_se_va and account_id = v_cuenta;
  update channel_settlement set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('channel_settlement', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  select coalesce(array_agg(id), '{}') into v_ids from licensed_settlement where party_id = p_se_va and account_id = v_cuenta;
  update licensed_settlement set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('licensed_settlement', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  select coalesce(array_agg(id), '{}') into v_ids from brand_licensing_agreement where party_id = p_se_va and account_id = v_cuenta;
  update brand_licensing_agreement set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('brand_licensing_agreement', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  select coalesce(array_agg(id), '{}') into v_ids from brand_partner_contribution where party_id = p_se_va and account_id = v_cuenta;
  update brand_partner_contribution set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('brand_partner_contribution', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  select coalesce(array_agg(id), '{}') into v_ids from journal_entry where party_id = p_se_va and account_id = v_cuenta;
  update journal_entry set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('journal_entry', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);
  select coalesce(array_agg(id), '{}') into v_ids from journal_line where party_id = p_se_va and account_id = v_cuenta;
  update journal_line set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('journal_line', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  if v_a.tax_id is null and v_b.tax_id is not null then
    update party set tax_id = null where id = p_se_va;
    update party set tax_id = v_b.tax_id where id = p_queda;
    v_nif_movido := true;
  end if;

  select coalesce(array_agg(s.id), '{}') into v_prov from party_role pr join supplier s on s.id = pr.supplier_id
   where pr.party_id = p_se_va and s.archived_at is null;
  update supplier set archived_at = now() where id = any(v_prov);
  update party set archived_at = coalesce(archived_at, now()), archived_note = format('Fusionado con %s', v_a.name) where id = p_se_va;

  v_resumen := format('%s fusionado en %s: %s %s movido%s%s%s.', v_b.name, v_a.name, v_n, case when v_n = 1 then 'dato' else 'datos' end,
    case when v_n = 1 then '' else 's' end,
    case when v_nif_movido then format(', con su NIF %s', v_b.tax_id) else '' end,
    case when jsonb_array_length(v_quedan) > 0 then format('; se queda en %s (archivada) lo que %s ya tenía: %s', v_b.name, v_a.name,
      (select string_agg(case x->>'que' when 'papel' then 'su papel de ' || case x->>'papel' when 'supplier' then 'proveedor' when 'customer' then 'cliente' when 'platform' then 'plataforma' when 'brand_partner' then 'socio de marca' else x->>'papel' end when 'cuenta' then 'la cuenta ' || (x->>'codigo') else 'sus datos fiscales' end, ', ')
         from jsonb_array_elements(v_quedan) x)) else '' end);

  insert into party_merge (account_id, kept_party_id, gone_party_id, moved, kept_on_gone, summary, done_by, done_by_name)
  values (v_cuenta, p_queda, p_se_va,
          v_mov || jsonb_build_object('nif', v_nif_movido, 'antes', jsonb_build_object('archived_at', v_b.archived_at, 'archived_note', v_b.archived_note, 'tax_id', v_b.tax_id),
                                      'proveedores_archivados', to_jsonb(v_prov)),
          v_quedan, v_resumen, auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor()))
  returning id into v_merge;
  return jsonb_build_object('fusion', v_merge, 'resumen', v_resumen, 'movidos', v_n, 'se_quedan', v_quedan);
end $$;
revoke all on function public._party_merge(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.party_merge_do(p_queda uuid, p_se_va uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.party_cuenta(p_queda);  -- existe y quien llama es administrador o encargado de su cuenta
  return public._party_merge(p_queda, p_se_va, p_quien_nombre);
end $$;
revoke all on function public.party_merge_do(uuid, uuid, text) from public, anon;
grant execute on function public.party_merge_do(uuid, uuid, text) to authenticated;

create or replace function public._party_merge_undo(p_merge uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m party_merge; v_b uuid; v_a uuid; v_ids uuid[];
begin
  select * into v_m from party_merge where id = p_merge for update;
  if v_m.id is null then raise exception 'Esa fusión no existe.' using errcode = 'P0002'; end if;
  if v_m.undone_at is not null then raise exception 'Esa fusión ya está deshecha.' using errcode = '22023'; end if;
  v_a := v_m.kept_party_id; v_b := v_m.gone_party_id;
  v_ids := array(select jsonb_array_elements_text(v_m.moved->'journal_entry')::uuid);
  if exists (select 1 from journal_entry where id = any(v_ids) and status in ('validado', 'anulado')) then
    raise exception 'Desde la fusión se ha validado un asiento que era de la otra ficha: lo validado no cambia de tercero. Anúlalo antes de deshacer.' using errcode = '23514';
  end if;

  update journal_line set party_id = v_b where id = any(array(select jsonb_array_elements_text(v_m.moved->'journal_line')::uuid)) and party_id = v_a;
  update journal_entry set party_id = v_b where id = any(v_ids) and party_id = v_a;
  update brand_partner_contribution set party_id = v_b where id = any(array(select jsonb_array_elements_text(v_m.moved->'brand_partner_contribution')::uuid)) and party_id = v_a;
  update brand_licensing_agreement set party_id = v_b where id = any(array(select jsonb_array_elements_text(v_m.moved->'brand_licensing_agreement')::uuid)) and party_id = v_a;
  update licensed_settlement set party_id = v_b where id = any(array(select jsonb_array_elements_text(v_m.moved->'licensed_settlement')::uuid)) and party_id = v_a;
  update channel_settlement set party_id = v_b where id = any(array(select jsonb_array_elements_text(v_m.moved->'channel_settlement')::uuid)) and party_id = v_a;
  if (v_m.moved->>'customer_fiscal')::boolean then update customer_fiscal set party_id = v_b where party_id = v_a; end if;
  update company_account_link set entity_id = v_b::text where id = any(array(select jsonb_array_elements_text(v_m.moved->'company_account_link')::uuid)) and entity_id = v_a::text;
  update party_role set party_id = v_b where id = any(array(select jsonb_array_elements_text(v_m.moved->'party_role')::uuid)) and party_id = v_a;
  if (v_m.moved->>'nif')::boolean then
    update party set tax_id = null where id = v_a and tax_id = v_m.moved->'antes'->>'tax_id';
    update party set tax_id = v_m.moved->'antes'->>'tax_id' where id = v_b;
  end if;
  update supplier set archived_at = null where id = any(array(select jsonb_array_elements_text(v_m.moved->'proveedores_archivados')::uuid));
  update party set archived_at = (v_m.moved->'antes'->>'archived_at')::timestamptz, archived_note = v_m.moved->'antes'->>'archived_note' where id = v_b;
  update party_merge set undone_at = now(), undone_by = auth.uid(), undone_by_name = coalesce(p_quien_nombre, public.conta_nombre_actor()) where id = p_merge;
  return jsonb_build_object('fusion', p_merge, 'deshecha', true);
end $$;
revoke all on function public._party_merge_undo(uuid, text) from public, anon, authenticated;

create or replace function public.party_merge_undo(p_merge uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_queda uuid;
begin
  select kept_party_id into v_queda from party_merge where id = p_merge;
  if v_queda is null then raise exception 'Esa fusión no existe.' using errcode = 'P0002'; end if;
  perform public.party_cuenta(v_queda);
  return public._party_merge_undo(p_merge, p_quien_nombre);
end $$;
revoke all on function public.party_merge_undo(uuid, text) from public, anon;
grant execute on function public.party_merge_undo(uuid, text) to authenticated;

-- ── El rastro de la fusión de proveedores ──────────────────────────────────
create table if not exists public.supplier_merge (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  kept_supplier_id  uuid not null references public.supplier(id) on delete cascade,
  gone_supplier_id  uuid not null references public.supplier(id) on delete cascade,
  moved             jsonb not null,
  kept_on_gone      jsonb not null default '[]'::jsonb,
  filled            jsonb not null default '{}'::jsonb,
  party_merge_id    uuid references public.party_merge(id) on delete set null,
  summary           text not null,
  done_at           timestamptz not null default now(),
  done_by           uuid,
  done_by_name      text,
  undone_at         timestamptz,
  undone_by         uuid,
  undone_by_name    text,
  check (kept_supplier_id <> gone_supplier_id)
);
comment on table public.supplier_merge is
  'Compras (10/10). Cada fusión de dos fichas de proveedor: qué filas se movieron de la que se va a la que queda (moved, por tabla), lo que se quedó en la que se va por chocar con una clave única (kept_on_gone), los datos de ficha que se rellenaron (filled), la fusión de sus terceros (party_merge_id), quién y cuándo. La deshace supplier_merge_undo.';
create index if not exists supplier_merge_cuenta on public.supplier_merge (account_id, done_at desc);
create index if not exists supplier_merge_queda on public.supplier_merge (kept_supplier_id);
create index if not exists supplier_merge_se_va on public.supplier_merge (gone_supplier_id);
alter table public.supplier_merge enable row level security;
drop policy if exists supplier_merge_select on public.supplier_merge;
create policy supplier_merge_select on public.supplier_merge for select using ((select belongs_to_account(account_id)));
-- Se escribe solo desde las funciones (security definer).

-- ── Qué hace ───────────────────────────────────────────────────────────────
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

-- ── Quién puede ────────────────────────────────────────────────────────────
create or replace function public.supplier_merge_do(p_queda uuid, p_se_va uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from supplier where id = p_queda;
  if v_cuenta is null then raise exception 'Ese proveedor no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'No puedes unir fichas de proveedor de esta cuenta.' using errcode = '42501';
  end if;
  return public._supplier_merge(p_queda, p_se_va, p_quien_nombre);
end $$;
revoke all on function public.supplier_merge_do(uuid, uuid, text) from public, anon;
grant execute on function public.supplier_merge_do(uuid, uuid, text) to authenticated;

create or replace function public.supplier_merge_undo(p_merge uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from supplier_merge where id = p_merge;
  if v_cuenta is null then raise exception 'Esa fusión no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'No puedes deshacer fusiones de esta cuenta.' using errcode = '42501';
  end if;
  return public._supplier_merge_undo(p_merge, p_quien_nombre);
end $$;
revoke all on function public.supplier_merge_undo(uuid, text) from public, anon;
grant execute on function public.supplier_merge_undo(uuid, text) to authenticated;
