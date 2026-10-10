-- ============================================================================
-- Compras · 7 · LA LIQUIDACIÓN MENSUAL, DESDE SUS DOCUMENTOS
-- ----------------------------------------------------------------------------
-- cambia: public.licensed_settlement · prueba: supabase/staging/sql/20261017_compras_liquidacion_prueba.sql
--
-- Encargo «Contabilidad: las compras», §2.5 y §4.5 (10/10). El proveedor que
-- liquida cada mes manda, por local, cinco documentos con una referencia. El
-- navegador los lee (lectorLiquidacionMensual.ts) y aquí se guarda lo leído;
-- el libro propone los tres asientos (liquidacionMensual en
-- asientosPropuestos.ts): su factura, la que le haces y la compensación.
--
-- 1 · licensed_settlement se conserva como cabecera (T1 §5), con una fórmula
--     nueva, «documentos». Las columnas de importes de siempre se rellenan
--     con lo de los documentos, así el panel de cedidas sigue leyendo:
--       service_revenue    = bases de servicios de la que le haces
--       materials_supplied = base del género que le pones tú
--       stock_invoice_cost = base de su factura
--       net_settlement     = el saldo (te paga si es positivo)
--     detail guarda la lectura entera, con sus bloqueos y avisos.
--     Una por empresa, local y número de la que le haces (import_key).
--
-- 2 · Confirmar (compras_liquidacion_confirmar): para si el lector dejó
--     bloqueos; registra su factura como factura recibida (aprobada: la
--     aprueba quien confirma, con las reglas de aprobación de la 0140) y deja
--     sus recepciones del mes consumidas. Las recepciones de este proveedor
--     no generan factura ni asiento propios (aceptación 8).
--
-- 3 · El contraste (compras_liquidacion_contraste), cada bloque con su cifra
--     de Folvy y la del documento, y sin explicar pedido a pedido:
--       · compras: la base de los papeles de sus recepciones del mes en ese
--         local, contra «compras valoradas» del inventario (Σ compras ×
--         precio);
--       · ventas: la base (taxable_base) de los pedidos CERRADOS de sus
--         marcas en ese local y mes —fecha de Madrid (regla 4)—, por
--         plataforma, contra su columna «Ventas» (va sin IVA; T1 §7);
--       · producto a producto, donde su nombre esté casado con un artículo
--         de Folvy: lo que dice que te mandó contra lo que recibiste.
--
-- 4 · Casar un producto suyo con un artículo de Folvy se hace una vez y se
--     recuerda (settlement_product_match), por proveedor.
--
-- No toca stock ni coste. Vuelta atrás:
-- supabase/vuelta-atras/20261017T0160_compras_liquidacion_mensual.down.sql
-- ============================================================================

-- ── 1 · La cabecera ────────────────────────────────────────────────────────
alter table public.licensed_settlement add column if not exists company_id uuid references public.company(id);
alter table public.licensed_settlement add column if not exists supplier_id uuid references public.supplier(id);
alter table public.licensed_settlement add column if not exists received_invoice_id uuid references public.supplier_invoice(id) on delete set null;
comment on column public.licensed_settlement.received_invoice_id is 'Compras (10/10). Su factura de la liquidación, registrada como factura recibida al confirmar.';

alter table public.licensed_settlement drop constraint if exists licensed_settlement_formula_check;
alter table public.licensed_settlement add constraint licensed_settlement_formula_check
  check (formula in ('anterior', 'compras_aportaciones_comision', 'documentos'));
alter table public.licensed_settlement drop constraint if exists licensed_settlement_nueva_completa;
alter table public.licensed_settlement add constraint licensed_settlement_nueva_completa
  check (formula = 'anterior'
         or (formula = 'documentos' and party_id is not null and location_id is not null and company_id is not null
             and supplier_id is not null and status is not null and settlement_ref is not null)
         or (party_id is not null and location_id is not null and status is not null and purchases_amount is not null
             and contributions_amount is not null and brand_sales_base is not null and commission_pct is not null
             and commission_amount is not null and amount is not null));

-- ── 2 · Lo casado a mano: un producto suyo es un artículo tuyo ─────────────
create table if not exists public.settlement_product_match (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  supplier_id     uuid not null references public.supplier(id) on delete cascade,
  name_norm       text not null,
  example         text,
  recipe_item_id  uuid references public.recipe_item(id) on delete cascade,
  not_ours        boolean not null default false,
  decided_by      uuid,
  decided_by_name text,
  decided_at      timestamptz not null default now(),
  constraint settlement_product_match_uno check ((recipe_item_id is not null) <> not_ours),
  constraint settlement_product_match_nombre unique (account_id, supplier_id, name_norm)
);
comment on table public.settlement_product_match is
  'Compras (10/10). Un producto del inventario de su liquidación, casado una vez a mano con un artículo de Folvy (o «no es nuestro»), por proveedor. Se recuerda para los meses siguientes.';
alter table public.settlement_product_match enable row level security;
drop policy if exists settlement_product_match_select on public.settlement_product_match;
create policy settlement_product_match_select on public.settlement_product_match for select using ((select belongs_to_account(account_id)));

create or replace function public.compras_liquidacion_casar_producto(p_proveedor uuid, p_nombre text, p_articulo uuid, p_no_es_nuestro boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_nom text := public.compras_nombre_norm(p_nombre);
begin
  select account_id into v_cuenta from supplier where id = p_proveedor;
  if v_cuenta is null then raise exception 'Ese proveedor no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then raise exception 'No puedes casar productos en esta cuenta.' using errcode = '42501'; end if;
  if v_nom is null then raise exception 'Sin nombre no hay nada que casar.' using errcode = '22023'; end if;
  if p_articulo is not null and not exists (select 1 from recipe_item where id = p_articulo and account_id = v_cuenta) then
    raise exception 'Ese artículo no es de esta cuenta.' using errcode = '42501';
  end if;
  if p_articulo is null and not coalesce(p_no_es_nuestro, false) then
    delete from settlement_product_match where account_id = v_cuenta and supplier_id = p_proveedor and name_norm = v_nom;
    return jsonb_build_object('nombre', v_nom, 'casado', false);
  end if;
  insert into settlement_product_match (account_id, supplier_id, name_norm, example, recipe_item_id, not_ours, decided_by, decided_by_name)
  values (v_cuenta, p_proveedor, v_nom, p_nombre, p_articulo, coalesce(p_no_es_nuestro, false), auth.uid(), public.conta_nombre_actor())
  on conflict (account_id, supplier_id, name_norm) do update set example = excluded.example, recipe_item_id = excluded.recipe_item_id,
    not_ours = excluded.not_ours, decided_by = excluded.decided_by, decided_by_name = excluded.decided_by_name, decided_at = now();
  return jsonb_build_object('nombre', v_nom, 'casado', true);
end $$;
revoke all on function public.compras_liquidacion_casar_producto(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.compras_liquidacion_casar_producto(uuid, text, uuid, boolean) to authenticated;

-- ── 3 · Guardar lo leído ───────────────────────────────────────────────────
-- p_lectura: lo que devuelve leerLiquidacion (emitida, recibida, transaccion,
-- ventas, inventario, periodo, bloqueos, avisos). Vuelve a guardar mientras no
-- esté confirmada.
create or replace function public._compras_liquidacion_guardar(p_empresa uuid, p_proveedor uuid, p_local uuid, p_lectura jsonb, p_quien_nombre text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; s supplier; v_party uuid; v_id uuid; v_num text; v_desde date; v_hasta date; v_clave text;
  v_serv numeric; v_merc numeric; v_stock numeric; v_saldo numeric;
begin
  select account_id into v_cuenta from company where id = p_empresa;
  select * into s from supplier where id = p_proveedor;
  if v_cuenta is null or s.account_id is distinct from v_cuenta then raise exception 'La empresa y el proveedor tienen que ser de la misma cuenta.' using errcode = '42501'; end if;
  if not exists (select 1 from locations where id = p_local and account_id = v_cuenta) then raise exception 'Ese local no es de esta cuenta.' using errcode = '42501'; end if;
  if s.invoicing_mode is distinct from 'monthly_settlement' then
    raise exception 'La ficha de % no dice que liquida cada mes: cámbiala antes («Cómo te factura»).', s.name using errcode = '22023';
  end if;
  select party_id into v_party from party_role where supplier_id = p_proveedor limit 1;
  if v_party is null then raise exception '% no tiene su ficha de tercero.', s.name using errcode = '22023'; end if;
  v_num := nullif(p_lectura->'emitida'->>'numero', '');
  if v_num is null then raise exception 'Sin la factura que le haces no hay liquidación que guardar.' using errcode = '22023'; end if;
  v_desde := (p_lectura->'periodo'->>'desde')::date; v_hasta := (p_lectura->'periodo'->>'hasta')::date;
  if v_desde is null or v_hasta is null then raise exception 'Los documentos no dicen el periodo.' using errcode = '22023'; end if;
  v_clave := format('doc_%s_%s_%s', p_empresa, p_local, v_num);
  if exists (select 1 from licensed_settlement where import_key = v_clave and status <> 'borrador') then
    raise exception 'La liquidación % ya está confirmada: no se vuelve a guardar.', v_num using errcode = '22023';
  end if;
  select coalesce(sum((l->>'base')::numeric) filter (where (l->>'concepto') !~* 'mercader'), 0),
         coalesce(sum((l->>'base')::numeric) filter (where (l->>'concepto') ~* 'mercader'), 0)
    into v_serv, v_merc from jsonb_array_elements(coalesce(p_lectura->'emitida'->'lineas', '[]'::jsonb)) l;
  select coalesce(sum((l->>'base')::numeric), 0) into v_stock from jsonb_array_elements(coalesce(p_lectura->'recibida'->'lineas', '[]'::jsonb)) l;
  v_saldo := coalesce((p_lectura->'transaccion'->'saldo'->>'importe')::numeric,
                      (p_lectura->'emitida'->>'total')::numeric - coalesce((p_lectura->'recibida'->>'total')::numeric, 0));

  insert into licensed_settlement (account_id, company_id, supplier_id, party_id, location_id, settlement_ref, period_from, period_to, period_grain,
                                   service_revenue, materials_supplied, stock_invoice_cost, net_settlement, source, import_key, formula, status,
                                   detail, raw, created_by, created_by_name, updated_at)
  values (v_cuenta, p_empresa, p_proveedor, v_party, p_local, v_num, v_desde, v_hasta, 'month',
          v_serv, v_merc, v_stock, v_saldo, 'documentos', v_clave, 'documentos', 'borrador',
          p_lectura, null, auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor()), now())
  on conflict (import_key) do update set
    service_revenue = excluded.service_revenue, materials_supplied = excluded.materials_supplied, stock_invoice_cost = excluded.stock_invoice_cost,
    net_settlement = excluded.net_settlement, period_from = excluded.period_from, period_to = excluded.period_to, detail = excluded.detail, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public._compras_liquidacion_guardar(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;

create or replace function public.compras_liquidacion_guardar(p_empresa uuid, p_proveedor uuid, p_local uuid, p_lectura jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from company where id = p_empresa;
  if v_cuenta is null or not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'No puedes guardar liquidaciones en esta cuenta.' using errcode = '42501';
  end if;
  return public._compras_liquidacion_guardar(p_empresa, p_proveedor, p_local, p_lectura, null);
end $$;
revoke all on function public.compras_liquidacion_guardar(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.compras_liquidacion_guardar(uuid, uuid, uuid, jsonb) to authenticated;

-- ── 4 · El contraste ───────────────────────────────────────────────────────
create or replace function public._compras_liquidacion_contraste(p_liq uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  l licensed_settlement; v_compras jsonb; v_ventas jsonb; v_productos jsonb; v_doc_compras numeric;
begin
  select * into l from licensed_settlement where id = p_liq;
  if l.id is null then raise exception 'Esa liquidación no existe.' using errcode = 'P0002'; end if;

  -- Compras: sus recepciones del mes en ese local (las suyas, o las de otro
  -- a su nombre que van a su liquidación), por la base de sus papeles.
  with rec as (
    select g.id, public._compras_base_recepcion(g.id) base
      from goods_receipt g left join goods_receipt_path p on p.goods_receipt_id = g.id
     where g.account_id = l.account_id and g.location_id = l.location_id and g.status = 'confirmado'
       and g.receipt_date between l.period_from and l.period_to
       and ((p.id is not null and p.path = 'liquidacion' and p.supplier_id = l.supplier_id)
            or (p.id is null and g.supplier_id = l.supplier_id)))
  select jsonb_build_object('folvy', coalesce(sum(base), 0), 'recepciones', count(*), 'sin_base', count(*) filter (where base is null)) into v_compras from rec;
  select round(sum((x->>'compras')::numeric * (x->>'precio')::numeric), 2) into v_doc_compras
    from jsonb_array_elements(coalesce(l.detail->'inventario'->'productos', '[]'::jsonb)) x;
  v_compras := v_compras || jsonb_build_object('documento', v_doc_compras,
    'diferencia', case when v_doc_compras is null then null else round((v_compras->>'folvy')::numeric - v_doc_compras, 2) end);

  -- Ventas: pedidos cerrados de sus marcas en ese local y mes (fecha de Madrid), por plataforma.
  with folvy as (
    select lower(regexp_replace(public.unaccent(c.name), '[^a-zA-Z]', '', 'g')) plat, c.name nombre, sum(s.taxable_base) base, count(*) pedidos
      from sale s join sales_channel c on c.id = s.channel_id
     where s.account_id = l.account_id and s.location_id = l.location_id and s.status = 'closed' and coalesce(s.is_active, true)
       and (s.sold_at at time zone 'Europe/Madrid')::date between l.period_from and l.period_to
       and s.brand_id in (select a.brand_id from brand_licensing_agreement a where a.party_id = l.party_id)
     group by 1, 2),
  doc as (
    select lower(regexp_replace(public.unaccent(x->>'plataforma'), '[^a-zA-Z]', '', 'g')) plat, x->>'plataforma' nombre,
           (x->'totales'->>'ventas')::numeric ventas, (x->'totales'->>'total')::numeric total
      from jsonb_array_elements(coalesce(l.detail->'ventas'->'plataformas', '[]'::jsonb)) x)
  select coalesce(jsonb_agg(jsonb_build_object('plataforma', coalesce(d.nombre, f.nombre), 'documento', d.ventas, 'folvy', round(f.base, 2),
           'pedidos', f.pedidos, 'diferencia', round(coalesce(f.base, 0) - coalesce(d.ventas, 0), 2)) order by coalesce(d.nombre, f.nombre)), '[]'::jsonb)
    into v_ventas from doc d full join folvy f on f.plat = d.plat;

  -- Producto a producto, donde está casado: lo que dice que te mandó contra
  -- lo que recibiste (en la unidad base de la dimensión: g, ml o ud).
  with doc as (
    select x->>'nombre' nombre, public.compras_nombre_norm(x->>'nombre') nom, (x->>'compras')::numeric compras, x->>'unidad' unidad,
           case lower(x->>'unidad') when 'kg' then 1000 when 'g' then 1 when 'lt' then 1000 when 'l' then 1000 when 'ml' then 1 else 1 end factor,
           case lower(x->>'unidad') when 'kg' then 'weight' when 'g' then 'weight' when 'lt' then 'volume' when 'l' then 'volume' when 'ml' then 'volume' else 'unit' end dim
      from jsonb_array_elements(coalesce(l.detail->'inventario'->'productos', '[]'::jsonb)) x),
  casado as (
    select d.*, m.recipe_item_id, m.not_ours from doc d
      left join settlement_product_match m on m.account_id = l.account_id and m.supplier_id = l.supplier_id and m.name_norm = d.nom),
  recibido as (
    select gl.recipe_item_id, sum(gl.qty_in_base * u.factor_to_base) qty, max(u.dimension) dim
      from goods_receipt g join goods_receipt_line gl on gl.goods_receipt_id = g.id
      join recipe_item r on r.id = gl.recipe_item_id join kitchen_unit u on u.id = r.base_unit_id
      left join goods_receipt_path p on p.goods_receipt_id = g.id
     where g.account_id = l.account_id and g.location_id = l.location_id and g.status = 'confirmado'
       and g.receipt_date between l.period_from and l.period_to
       and ((p.id is not null and p.path = 'liquidacion' and p.supplier_id = l.supplier_id) or (p.id is null and g.supplier_id = l.supplier_id))
     group by gl.recipe_item_id)
  select jsonb_build_object(
    'casados', count(*) filter (where c.recipe_item_id is not null),
    'no_nuestros', count(*) filter (where c.not_ours),
    'sin_casar', count(*) filter (where c.recipe_item_id is null and not coalesce(c.not_ours, false)),
    'sin_casar_con_compras', count(*) filter (where c.recipe_item_id is null and not coalesce(c.not_ours, false) and c.compras <> 0),
    'no_coinciden', coalesce(jsonb_agg(jsonb_build_object('nombre', c.nombre, 'articulo', c.recipe_item_id, 'documento', c.compras, 'unidad', c.unidad,
                     'folvy', case when r.dim is null then 0 when r.dim = c.dim then round(r.qty / c.factor, 3) end,
                     'comparable', r.dim is null or r.dim = c.dim))
                   filter (where c.recipe_item_id is not null and (r.dim is distinct from c.dim and r.dim is not null
                           or abs(coalesce(r.qty, 0) - c.compras * c.factor) > greatest(0.01 * c.compras * c.factor, 0.001))), '[]'::jsonb))
    into v_productos from casado c left join recibido r on r.recipe_item_id = c.recipe_item_id;

  return jsonb_build_object('liquidacion', l.id, 'compras', v_compras, 'ventas', v_ventas, 'productos', v_productos);
end $$;
revoke all on function public._compras_liquidacion_contraste(uuid) from public, anon, authenticated;

create or replace function public.compras_liquidacion_contraste(p_liq uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from licensed_settlement l where l.id = p_liq and (select belongs_to_account(l.account_id))) then
    raise exception 'Esa liquidación no es de tu cuenta.' using errcode = '42501';
  end if;
  return public._compras_liquidacion_contraste(p_liq);
end $$;
revoke all on function public.compras_liquidacion_contraste(uuid) from public, anon;
grant execute on function public.compras_liquidacion_contraste(uuid) to authenticated;

-- ── 5 · Confirmar ──────────────────────────────────────────────────────────
create or replace function public._compras_liquidacion_confirmar(p_liq uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l licensed_settlement; v_fv uuid; v_n int; r jsonb;
begin
  select * into l from licensed_settlement where id = p_liq for update;
  if l.id is null then raise exception 'Esa liquidación no existe.' using errcode = 'P0002'; end if;
  if l.formula <> 'documentos' then raise exception 'Esta liquidación no sale de sus documentos.' using errcode = '22023'; end if;
  if l.status <> 'borrador' then raise exception 'La liquidación % ya está confirmada.', l.settlement_ref using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(l.detail->'bloqueos', '[]'::jsonb)) > 0 then
    raise exception 'No se puede confirmar: %', (select string_agg(b, ' ') from jsonb_array_elements_text(l.detail->'bloqueos') b) using errcode = '22023';
  end if;
  r := l.detail->'recibida';
  -- Su factura, como factura recibida. Aprobada por quien confirma (las reglas de aprobación, en la base).
  insert into supplier_invoice (account_id, supplier_id, location_id, company_id, doc_kind, invoice_number, invoice_date, status, source,
                                tax_base_total, tax_total, grand_total, notes, created_by, created_by_name)
  values (l.account_id, l.supplier_id, l.location_id, l.company_id, 'invoice', r->>'numero', (r->>'fecha')::date, 'aprobada', 'manual',
          l.stock_invoice_cost, (r->>'total')::numeric - l.stock_invoice_cost, (r->>'total')::numeric,
          format('Su factura de la liquidación %s (%s a %s).', l.settlement_ref, to_char(l.period_from, 'DD/MM/YYYY'), to_char(l.period_to, 'DD/MM/YYYY')),
          auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor()))
  returning id into v_fv;
  insert into supplier_invoice_line (supplier_invoice_id, raw_text, line_amount, vat_pct, position)
  select v_fv, x->>'concepto', (x->>'base')::numeric, (x->>'tipo')::numeric, (n - 1)::int
    from jsonb_array_elements(coalesce(r->'lineas', '[]'::jsonb)) with ordinality t(x, n);
  -- Sus recepciones del mes en ese local quedan cubiertas por la liquidación.
  update goods_receipt_path p set consumed_at = now()
    from goods_receipt g
   where g.id = p.goods_receipt_id and p.account_id = l.account_id and p.path = 'liquidacion' and p.supplier_id = l.supplier_id
     and g.location_id = l.location_id and g.receipt_date between l.period_from and l.period_to and p.consumed_at is null;
  get diagnostics v_n = row_count;
  update licensed_settlement set status = 'confirmada', confirmed_at = now(), confirmed_by = auth.uid(),
         confirmed_by_name = coalesce(p_quien_nombre, public.conta_nombre_actor()), received_invoice_id = v_fv, updated_at = now()
   where id = p_liq;
  return jsonb_build_object('liquidacion', p_liq, 'factura', v_fv, 'recepciones', v_n,
    'frase', format('Confirmada. Su factura %s queda registrada y %s recepción(es) del mes, cubiertas. Los tres asientos los propone el libro.', r->>'numero', v_n));
end $$;
revoke all on function public._compras_liquidacion_confirmar(uuid, text) from public, anon, authenticated;

create or replace function public.compras_liquidacion_confirmar(p_liq uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from licensed_settlement where id = p_liq;
  if v_cuenta is null or not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'No puedes confirmar liquidaciones en esta cuenta.' using errcode = '42501';
  end if;
  return public._compras_liquidacion_confirmar(p_liq, null);
end $$;
revoke all on function public.compras_liquidacion_confirmar(uuid) from public, anon;
grant execute on function public.compras_liquidacion_confirmar(uuid) to authenticated;
