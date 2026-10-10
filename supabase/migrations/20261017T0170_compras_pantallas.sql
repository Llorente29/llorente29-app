-- ============================================================================
-- Compras · 8 · LO QUE LEEN LAS PANTALLAS (Compras, la ficha y la recepción)
-- ----------------------------------------------------------------------------
-- cambia: public.goods_receipt_path · prueba: supabase/staging/sql/20261017_compras_pantallas_prueba.sql
--
-- Encargo «Contabilidad: las compras», §6 (10/10). Solo lectura más una
-- escritura pequeña (cerrar una pregunta):
--
-- 1 · compras_mirar(cuenta): «Qué tienes que mirar», ya en filas: la pregunta
--     de cada recepción (con proveedor, local, día e importe), las recepciones
--     confirmadas desde el corte que no tienen camino (si apuntarlo falló del
--     todo) y lo que les falta a las fichas de los proveedores con compras
--     abiertas. Sin umbral: es una pantalla que se abre a propósito (regla 7).
-- 2 · compras_liquidaciones(cuenta, mes): por proveedor que liquida y local,
--     lo recibido ese mes y su liquidación si ha llegado.
-- 3 · compras_cerrar_pregunta(recepción, nota): «dejarlo así». La pregunta no
--     vuelve aunque se redecida (goods_receipt_path.question_closed).
-- 4 · compras_ultimos_papeles(proveedor): lo que dicen sus últimos papeles
--     («Sus 5 últimas entregas vinieron con albarán»), para la ficha.
-- 5 · compras_camino_de(recepción): la frase al confirmar en el local.
--
-- No toca stock ni coste. Vuelta atrás:
-- supabase/vuelta-atras/20261017T0170_compras_pantallas.down.sql
-- ============================================================================

alter table public.goods_receipt_path add column if not exists question_closed text;
alter table public.goods_receipt_path add column if not exists question_closed_note text;
alter table public.goods_receipt_path add column if not exists question_closed_by_name text;
alter table public.goods_receipt_path add column if not exists question_closed_at timestamptz;
comment on column public.goods_receipt_path.question_closed is
  'Compras (10/10). La pregunta que alguien cerró («dejarlo así»). Si al redecidir sale la misma, no se vuelve a enseñar.';

-- ── 3 · Cerrar una pregunta ────────────────────────────────────────────────
create or replace function public.compras_cerrar_pregunta(p_recepcion uuid, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p goods_receipt_path;
begin
  select * into p from goods_receipt_path where goods_receipt_id = p_recepcion;
  if p.id is null then raise exception 'Esa recepción no tiene camino.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(p.account_id) then raise exception 'No puedes decidir esto en esta cuenta.' using errcode = '42501'; end if;
  if p.question is null then raise exception 'Esa recepción no tiene nada que mirar.' using errcode = '22023'; end if;
  update goods_receipt_path set question_closed = question, question_closed_note = nullif(btrim(p_nota), ''),
         question_closed_by_name = public.conta_nombre_actor(), question_closed_at = now()
   where id = p.id;
  return jsonb_build_object('recepcion', p_recepcion, 'pregunta', p.question);
end $$;
revoke all on function public.compras_cerrar_pregunta(uuid, text) from public, anon;
grant execute on function public.compras_cerrar_pregunta(uuid, text) to authenticated;

-- ── 1 · Qué tienes que mirar ───────────────────────────────────────────────
create or replace function public.compras_mirar(p_cuenta uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_recepciones jsonb; v_sin_camino jsonb; v_fichas jsonb; v_desde date;
begin
  if not (select belongs_to_account(p_cuenta)) then raise exception 'Esa cuenta no es tuya.' using errcode = '42501'; end if;
  -- Desde el día siguiente al corte más tardío de las empresas de la cuenta.
  select coalesce(max(fy.imported_until) + 1, date '2000-01-01') into v_desde
    from fiscal_year fy join company c on c.id = fy.company_id where c.account_id = p_cuenta;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', 'recepcion', 'recepcion', g.id, 'codigo', g.code, 'fecha', g.receipt_date,
           'proveedor', g.supplier_id, 'proveedor_nombre', s.name, 'local', g.location_id, 'local_nombre', l.name,
           'base', public._compras_base_recepcion(g.id), 'papel', p.doc_type, 'a_nombre_de', p.bill_to_name,
           'camino', p.path, 'pregunta', p.question, 'detalle', p.question_detail, 'frase', p.reason, 'error', p.error,
           'factura', p.supplier_invoice_id, 'sesion', g.ai_session_id)
         order by g.receipt_date, g.code), '[]'::jsonb)
    into v_recepciones
    from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
    left join supplier s on s.id = g.supplier_id left join locations l on l.id = g.location_id
   where p.account_id = p_cuenta and p.question is not null and p.question is distinct from p.question_closed
     and g.status = 'confirmado';

  select coalesce(jsonb_agg(jsonb_build_object('tipo', 'sin_camino', 'recepcion', g.id, 'codigo', g.code, 'fecha', g.receipt_date,
           'proveedor_nombre', s.name, 'local_nombre', l.name) order by g.receipt_date), '[]'::jsonb)
    into v_sin_camino
    from goods_receipt g left join supplier s on s.id = g.supplier_id left join locations l on l.id = g.location_id
   where g.account_id = p_cuenta and g.status = 'confirmado' and g.receipt_date >= v_desde
     and not exists (select 1 from goods_receipt_path p where p.goods_receipt_id = g.id);

  -- Las fichas de los proveedores con compras abiertas (factura o pendiente) o que liquidan.
  select coalesce(jsonb_agg(jsonb_build_object('tipo', 'ficha', 'proveedor', x.id, 'proveedor_nombre', x.name, 'falta', x.falta) order by x.name), '[]'::jsonb)
    into v_fichas
    from (select s.id, s.name, public.compras_ficha_le_falta(s.id) falta from supplier s
           where s.account_id = p_cuenta and s.archived_at is null
             and (s.invoicing_mode = 'monthly_settlement'
                  or exists (select 1 from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
                              where g.supplier_id = s.id and p.path in ('factura', 'pendiente_factura', 'liquidacion')))) x
   where jsonb_array_length(x.falta) > 0;

  return jsonb_build_object('recepciones', v_recepciones, 'sin_camino', v_sin_camino, 'fichas', v_fichas);
end $$;
revoke all on function public.compras_mirar(uuid) from public, anon;
grant execute on function public.compras_mirar(uuid) to authenticated;

-- ── 2 · Liquidaciones del mes ──────────────────────────────────────────────
create or replace function public.compras_liquidaciones(p_cuenta uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ini date := date_trunc('month', p_mes)::date; v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date; v jsonb;
begin
  if not (select belongs_to_account(p_cuenta)) then raise exception 'Esa cuenta no es tuya.' using errcode = '42501'; end if;
  with rec as (
    select coalesce(p.supplier_id, g.supplier_id) proveedor, g.location_id, count(*) n, sum(public._compras_base_recepcion(g.id)) base
      from goods_receipt g left join goods_receipt_path p on p.goods_receipt_id = g.id
      join supplier s on s.id = coalesce(p.supplier_id, g.supplier_id)
     where g.account_id = p_cuenta and g.status = 'confirmado' and g.receipt_date between v_ini and v_fin
       and s.invoicing_mode = 'monthly_settlement' and (p.id is null or p.path = 'liquidacion')
     group by 1, 2),
  liq as (
    select l.id, l.supplier_id proveedor, l.location_id, l.status, l.settlement_ref, l.net_settlement,
           jsonb_array_length(coalesce(l.detail->'bloqueos', '[]'::jsonb)) bloqueos
      from licensed_settlement l
     where l.account_id = p_cuenta and l.formula = 'documentos' and l.period_from = v_ini),
  pares as (select proveedor, location_id from rec union select proveedor, location_id from liq)
  select coalesce(jsonb_agg(jsonb_build_object(
           'proveedor', x.proveedor, 'proveedor_nombre', s.name, 'local', x.location_id, 'local_nombre', lo.name,
           'recepciones', coalesce(r.n, 0), 'base', coalesce(r.base, 0),
           'liquidacion', q.id, 'estado', q.status, 'referencia', q.settlement_ref, 'saldo', q.net_settlement, 'bloqueos', q.bloqueos)
         order by s.name, lo.name), '[]'::jsonb) into v
    from pares x join supplier s on s.id = x.proveedor left join locations lo on lo.id = x.location_id
    left join rec r on r.proveedor = x.proveedor and r.location_id is not distinct from x.location_id
    left join liq q on q.proveedor = x.proveedor and q.location_id is not distinct from x.location_id;
  return jsonb_build_object('mes', v_ini, 'filas', v);
end $$;
revoke all on function public.compras_liquidaciones(uuid, date) from public, anon;
grant execute on function public.compras_liquidaciones(uuid, date) to authenticated;

-- ── 4 · Sus últimos papeles ────────────────────────────────────────────────
create or replace function public.compras_ultimos_papeles(p_proveedor uuid, p_cuantos int default 5)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid; v jsonb;
begin
  select account_id into v_cuenta from supplier where id = p_proveedor;
  if v_cuenta is null or not (select belongs_to_account(v_cuenta)) then raise exception 'Ese proveedor no es de tu cuenta.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x.doc_type order by x.receipt_date desc), '[]'::jsonb) into v
    from (select a.parsed_result->'document'->>'doc_type' doc_type, g.receipt_date
            from goods_receipt g join goods_receipt_ai_session a on a.id = g.ai_session_id
           where g.supplier_id = p_proveedor and g.status <> 'anulado' and a.parsed_result->'document'->>'doc_type' is not null
           order by g.receipt_date desc, g.created_at desc limit greatest(p_cuantos, 1)) x;
  return v;
end $$;
revoke all on function public.compras_ultimos_papeles(uuid, int) from public, anon;
grant execute on function public.compras_ultimos_papeles(uuid, int) to authenticated;

-- ── 5 · La frase al confirmar en el local ──────────────────────────────────
create or replace function public.compras_camino_de(p_recepcion uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p goods_receipt_path; v_socio text;
begin
  select * into p from goods_receipt_path where goods_receipt_id = p_recepcion;
  if p.id is null then return null; end if;
  if not (select belongs_to_account(p.account_id)) then raise exception 'Esa recepción no es de tu cuenta.' using errcode = '42501'; end if;
  select name into v_socio from supplier where id = p.supplier_id;
  return jsonb_build_object('camino', p.path,
    'frase', case p.path
      when 'factura' then 'Este papel es una factura. Ya ha pasado a la oficina. No tienes que hacer nada más.'
      when 'pendiente_factura' then 'Este papel es un albarán. La oficina esperará la factura.'
      when 'liquidacion' then format('Este género es de %s. Entra en la cuenta del mes.', rtrim(v_socio, '.'))
      else 'Recibido. La oficina lo revisará.' end);
end $$;
revoke all on function public.compras_camino_de(uuid) from public, anon;
grant execute on function public.compras_camino_de(uuid) to authenticated;
