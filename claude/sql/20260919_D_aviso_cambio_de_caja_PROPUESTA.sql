-- ---------------------------------------------------------------------------
-- PROPUESTA — 19/09/2026 — D · «La caja ha cambiado»
-- Encargo: «Los formatos de compra: que el artículo se pueda terminar de una vez»
--
-- ESTO NO SE HA EJECUTADO. Claude Code propone, Julio ejecuta y verifica.
-- Va entero dentro de una transacción y con guardas al final: si alguna no
-- cuadra, revienta y no queda nada a medias.
--
-- QUÉ RESUELVE (decisión 4 de Julio, 19/09): cuando el albarán trae una caja
-- que no es la que hay guardada, Folvy crea el formato nuevo EN ESPERA y avisa.
-- Nada se aplica hasta que una persona lo confirma. Lo pasado no se toca.
--
-- ─────────────────────────────────────────────────────────────────────
-- ANTES DE APLICAR — la banda de servicio (12:15–23:45, reloj de la base)
-- ─────────────────────────────────────────────────────────────────────
-- Las tres se MIDEN y se pegan al parte; no se opinan.
--
-- 1) ¿Está en el camino del pedido? Se cuenta, no se supone:
--      select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public'
--         and pg_get_functiondef(p.oid) ilike any (array[
--           '%purchase_format_pending%','%propose_format_change_from_receipt_line%',
--           '%resolve_pending_format%']);
--      select count(*) from cron.job
--       where command ilike '%purchase_format_pending%'
--          or command ilike '%propose_format_change%';
--      select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
--       where not t.tgisinternal and c.relname='purchase_format_pending';
--    Las tres deben dar 0 ANTES de aplicar (la tabla y las funciones no
--    existen todavía) y, después, solo las funciones que este fichero crea.
--    NO se crea ningún disparador, y NADA de esto lo llama el camino del
--    pedido: lo llama la aplicación al CONFIRMAR un albarán.
--
-- 2) ¿Toma cierre exclusivo sobre una tabla que el pedido lee o escribe?
--    No. `create table` de una tabla NUEVA no bloquea nada existente, y un
--    `create or replace function` tampoco toma cierre de tabla. No hay ningún
--    CHECK ni índice sobre tablas del camino del pedido.
--
-- 3) Se dice ANTES de aplicarlo, con la medida delante. Esto es ese «antes».
--
-- Aun así, y porque la duda va siempre a favor de esperar: esto NO es urgente.
-- Si hay dudas, a las 23:45.
--
-- ─────────────────────────────────────────────────────────────────────
-- REGLA 40 — los nombres que van dentro de comillas o de SQL no los mira el
-- compilador. Comprobados contra el esquema el 19/09/2026, y dos estaban MAL
-- en el primer borrador de este mismo fichero:
--   · `recipe_item_line` NO existe — la tabla del escandallo es `recipe_line`
--     (parent_item_id, child_item_id). Corregido.
--   · `stock_movement.qty` NO existe — la columna es `qty_base`. Corregido.
-- Comprobados y correctos: accounts, recipe_item, supplier, article_supplier,
-- recipe_item_purchase_format (con use_in_count), goods_receipt_line,
-- stock_movement(source_type, source_id, qty_base) y belongs_to_account().
-- ---------------------------------------------------------------------------

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 1 · El formato EN ESPERA
-- ─────────────────────────────────────────────────────────────────────
-- Tabla propia y no una columna en `recipe_item_purchase_format` a propósito:
-- un formato en espera NO es un formato. Si viviera en la misma tabla, todo lo
-- que hoy lee formatos (el conteo, el coste, el catálogo del proveedor, los
-- 50 nodos anidados vivos) tendría que aprender a ignorarlo, y el día que uno
-- se olvidara, un formato que nadie ha aprobado estaría costeando platos.

create table if not exists public.purchase_format_pending (
  id                        uuid primary key default gen_random_uuid(),
  account_id                uuid not null references public.accounts(id),
  item_id                   uuid not null references public.recipe_item(id),
  supplier_id               uuid not null references public.supplier(id),
  article_supplier_id       uuid references public.article_supplier(id),

  -- El formato que había cuando saltó el aviso (para el «antes»).
  current_format_id         uuid references public.recipe_item_purchase_format(id),
  current_qty_in_base       numeric,

  -- Lo que propone Folvy. Si `proposed_qty_per_parent` va relleno, es una caja
  -- con piezas: total = qty_per_parent × inner_qty_in_base, DERIVADO, nunca
  -- tecleado por separado (misma garantía que ensurePackTree).
  proposed_name             text    not null,
  proposed_qty_in_base      numeric not null check (proposed_qty_in_base > 0),
  proposed_qty_per_parent   numeric check (proposed_qty_per_parent > 0),
  proposed_inner_name       text,
  proposed_inner_qty_in_base numeric check (proposed_inner_qty_in_base > 0),

  -- De dónde salió, con su texto entero: el aviso lo cita (D1).
  source_line_id            uuid references public.goods_receipt_line(id),
  source_raw_text           text,

  status                    text not null default 'pending'
                              check (status in ('pending','accepted','rejected')),
  decided_at                timestamptz,
  decided_by                uuid,
  decided_by_name           text,
  -- Cuando se dice que no, queda apuntado POR QUÉ (o al menos que se dijo).
  decided_note              text,
  created_at                timestamptz not null default now(),

  -- El total y el desglose no pueden descuadrarse ni aquí.
  constraint purchase_format_pending_desglose_cuadra check (
    proposed_qty_per_parent is null
    or proposed_inner_qty_in_base is null
    or abs(proposed_qty_per_parent * proposed_inner_qty_in_base - proposed_qty_in_base)
       <= greatest(0.01, proposed_qty_in_base * 0.001)
  )
);

-- Un solo aviso vivo por (artículo, proveedor): si el albarán vuelve a traer
-- la misma caja nueva, se actualiza el que hay, no se apilan cinco.
create unique index if not exists purchase_format_pending_uno_vivo
  on public.purchase_format_pending (account_id, item_id, supplier_id)
  where status = 'pending';

create index if not exists purchase_format_pending_por_cuenta
  on public.purchase_format_pending (account_id, status);

comment on table public.purchase_format_pending is
  'Formato de compra que Folvy propone al ver un albarán que no cuadra con el vigente. En espera del sí de una persona: NO costea, NO cuenta y NO lo ve nadie más que el aviso. Encargo 19/09, decisión 4 de Julio.';

alter table public.purchase_format_pending enable row level security;

-- RLS con la misma llave que el resto del módulo: `belongs_to_account`.
drop policy if exists purchase_format_pending_rw on public.purchase_format_pending;
create policy purchase_format_pending_rw on public.purchase_format_pending
  for all
  using (public.belongs_to_account(account_id))
  with check (public.belongs_to_account(account_id));

-- ─────────────────────────────────────────────────────────────────────
-- 2 · Aceptar el aviso
-- ─────────────────────────────────────────────────────────────────────
-- Crea el formato nuevo (plano o árbol), repunta el enlace del proveedor y
-- marca el aviso. LO PASADO NO SE TOCA: el formato viejo se ARCHIVA, no se
-- borra ni se edita, así que las líneas de albarán y los movimientos de stock
-- que apuntan a su id siguen apuntando a lo mismo y siguen cuadrando. Por eso
-- tampoco hace falta pelearse con `trg_recipe_item_purchase_format_immutable`:
-- no se cambia ningún `qty_in_base`, se crea uno nuevo.

create or replace function public.accept_pending_format(
  p_pending_id uuid,
  p_actor_id   uuid default null,
  p_actor_name text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v        purchase_format_pending%rowtype;
  v_inner  uuid;
  v_caja   uuid;
begin
  select * into v from purchase_format_pending where id = p_pending_id for update;
  if not found then
    raise exception 'accept_pending_format: el aviso % no existe', p_pending_id;
  end if;
  if not belongs_to_account(v.account_id) then
    raise exception 'accept_pending_format: sin acceso a la cuenta %', v.account_id;
  end if;
  if v.status <> 'pending' then
    raise exception 'accept_pending_format: el aviso % ya estaba %', p_pending_id, v.status;
  end if;

  if v.proposed_qty_per_parent is not null and v.proposed_inner_qty_in_base is not null then
    -- La PIEZA primero (es el padre: parent_format_id de la caja apunta a ella).
    insert into recipe_item_purchase_format
      (account_id, item_id, name, qty_in_base, source, created_by, created_by_name)
    values
      (v.account_id, v.item_id, coalesce(nullif(btrim(v.proposed_inner_name), ''), 'Ud'),
       v.proposed_inner_qty_in_base, 'albaran', p_actor_id, p_actor_name)
    returning id into v_inner;

    insert into recipe_item_purchase_format
      (account_id, item_id, name, qty_in_base, parent_format_id, qty_per_parent,
       source, created_by, created_by_name)
    values
      (v.account_id, v.item_id, v.proposed_name, v.proposed_qty_in_base,
       v_inner, v.proposed_qty_per_parent, 'albaran', p_actor_id, p_actor_name)
    returning id into v_caja;
  else
    insert into recipe_item_purchase_format
      (account_id, item_id, name, qty_in_base, source, created_by, created_by_name)
    values
      (v.account_id, v.item_id, v.proposed_name, v.proposed_qty_in_base,
       'albaran', p_actor_id, p_actor_name)
    returning id into v_caja;
  end if;

  if v.article_supplier_id is not null then
    update article_supplier
       set purchase_format_id = v_caja, updated_at = now()
     where id = v.article_supplier_id;
  end if;

  -- El viejo se archiva. ARCHIVAR NO ES BORRAR: su id sigue vivo en los
  -- albaranes y en stock_movement, y esos siguen valiendo lo que valían.
  if v.current_format_id is not null then
    update recipe_item_purchase_format
       set is_active = false, archived_at = now(), use_in_count = false, updated_at = now()
     where id = v.current_format_id;
  end if;

  update purchase_format_pending
     set status = 'accepted', decided_at = now(),
         decided_by = p_actor_id, decided_by_name = p_actor_name
   where id = p_pending_id;

  return v_caja;
end;
$$;

comment on function public.accept_pending_format(uuid, uuid, text) is
  'Convierte un aviso de cambio de caja en formato real: crea el nuevo (plano o árbol), repunta el enlace del proveedor y archiva el viejo. No toca ni una entrada ni un coste de antes.';

-- ─────────────────────────────────────────────────────────────────────
-- 3 · Decir que no
-- ─────────────────────────────────────────────────────────────────────
-- El aviso se descarta Y QUEDA APUNTADO. Nunca se borra la fila: si nadie
-- guarda el «no», el mismo albarán vuelve a proponer lo mismo la semana que
-- viene y el operario aprende a ignorar los avisos.

create or replace function public.reject_pending_format(
  p_pending_id uuid,
  p_actor_id   uuid default null,
  p_actor_name text default null,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v purchase_format_pending%rowtype;
begin
  select * into v from purchase_format_pending where id = p_pending_id for update;
  if not found then
    raise exception 'reject_pending_format: el aviso % no existe', p_pending_id;
  end if;
  if not belongs_to_account(v.account_id) then
    raise exception 'reject_pending_format: sin acceso a la cuenta %', v.account_id;
  end if;
  if v.status <> 'pending' then
    raise exception 'reject_pending_format: el aviso % ya estaba %', p_pending_id, v.status;
  end if;

  update purchase_format_pending
     set status = 'rejected', decided_at = now(),
         decided_by = p_actor_id, decided_by_name = p_actor_name,
         decided_note = p_note
   where id = p_pending_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4 · A qué platos afecta (D4)
-- ─────────────────────────────────────────────────────────────────────
-- Por su NOMBRE, que es lo que pide la maqueta. Lectura pura.

create or replace function public.pending_format_affected_dishes(p_pending_id uuid)
returns table (dish_id uuid, dish_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select distinct parent.id, parent.name
  from purchase_format_pending p
  join recipe_line rl on rl.child_item_id = p.item_id
  join recipe_item parent  on parent.id = rl.parent_item_id
  where p.id = p_pending_id
    and belongs_to_account(p.account_id)
    and parent.account_id = p.account_id
    and parent.is_active
  order by parent.name;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- GUARDAS — si algo no quedó como se dice, esto revienta y no se aplica nada
-- ─────────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from pg_class where relname = 'purchase_format_pending';
  if n <> 1 then raise exception 'guarda: se esperaba 1 tabla purchase_format_pending, hay %', n; end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'accept_pending_format';
  if n <> 1 then raise exception 'guarda: se esperaba 1 accept_pending_format, hay % (¿sobrecarga?)', n; end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'reject_pending_format';
  if n <> 1 then raise exception 'guarda: se esperaba 1 reject_pending_format, hay %', n; end if;

  -- NINGÚN disparador nuevo: esto no entra en el camino del pedido.
  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relname = 'purchase_format_pending';
  if n <> 0 then raise exception 'guarda: purchase_format_pending no debe tener disparadores, hay %', n; end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- CÓMO SE ENSAYA ANTES (regla 10: por sus CAMINOS, no por su fórmula)
-- ---------------------------------------------------------------------------
-- Dentro de una transacción que se REVIERTE, y con la cuenta delante:
--
--   begin;
--   -- 1 · cerrar una venta de un plato que use el artículo
--   -- 2 · recibir un albarán con ese artículo
--   -- 3 · apuntar una merma
--   -- 4 · aprobar un recuento
--   -- ... y DESPUÉS aceptar un aviso, y repetir los cuatro.
--   -- El punto no es «¿sale el número?», es «¿quién escribe esto y qué le
--   -- pasa a esa escritura». Si alguno no se puede ensayar, ESO es el
--   -- hallazgo y se dice.
--   rollback;
--
-- Y la comprobación de que lo pasado no se movió, con la query delante y no
-- de palabra:
--
--   select count(*) as movimientos, sum(sm.qty_base) as total_movido
--     from stock_movement sm
--     join goods_receipt_line grl
--       on sm.source_type = 'goods_receipt_line' and sm.source_id = grl.id
--    where grl.purchase_format_id = '<el formato viejo>';
--   -- El mismo número, antes y después de aceptar el aviso.
-- ---------------------------------------------------------------------------
