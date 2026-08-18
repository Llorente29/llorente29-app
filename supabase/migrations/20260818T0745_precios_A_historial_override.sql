-- ============================================================================
-- ENCARGO CODE "Cimientos del gestor de precios" (18/08/2026) — BLOQUE A
-- Historial, autoria y validaciones defensivas de menu_item_override (deudas B5 y B7).
-- ============================================================================
-- 100% ADITIVO. No cambia ningun calculo. menu_item_channel_economics NO se toca.
-- El unico cambio sobre codigo existente son DOS lineas en set_menu_item_override:
-- las validaciones (A.5) y `updated_at = now()` en el DO UPDATE (A.4). Todo lo
-- demas de esa funcion se reproduce byte a byte.
--
-- POR QUE AHORA: la rejilla va a permitir cambiar decenas de precios de golpe y
-- publicarlos en Glovo/Uber/JustEat. Hoy menu_item_override no tiene NINGUN
-- trigger: ni historial, ni autoria, y updated_at nunca se escribe. No hay
-- deshacer. Se ponen los cimientos antes que la palanca.
--
-- COMPROBADO ANTES DE APLICAR (18/08 07:4x): las 62 filas existentes no violan
-- ninguna de las reglas nuevas -- 0 con precio negativo, 0 con location_id de
-- otra cuenta, 0 con location_id inexistente (de hecho las 62 son de ambito
-- cuenta: location_id IS NULL en todas).

-- (apply_migration envuelve en transaccion; sin BEGIN/COMMIT explicito)

-- ── A.1 · La tabla de historial ─────────────────────────────────────────────
-- SIN CLAVES AJENAS, a proposito. Un registro de auditoria tiene que SOBREVIVIR
-- al borrado de lo que audita: si menu_item_id apuntase a menu_item con FK, al
-- borrar un producto el trigger intentaria escribir la fila 'delete' contra una
-- fila que ya no existe y la propia auditoria bloquearia el borrado.
create table if not exists public.menu_item_override_history (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null,
  menu_item_id         uuid not null,
  location_id          uuid,            -- null = ambito cuenta
  channel_id           uuid,
  op                   text not null check (op in ('insert','update','delete')),
  price_before         numeric,
  price_after          numeric,
  is_available_before  boolean,
  is_available_after   boolean,
  changed_by           uuid,            -- auth.uid(); null cuando escribe un proceso
  changed_at           timestamptz not null default now(),
  operation_id         uuid             -- agrupa una operacion masiva (se usa en el encargo siguiente)
);

comment on table public.menu_item_override_history is
  'Auditoria de menu_item_override (deuda B5). Solo escribe el trigger trg_menu_item_override_history. Sin FKs: la auditoria sobrevive al borrado de lo auditado.';
comment on column public.menu_item_override_history.operation_id is
  'Agrupa los cambios de una misma operacion masiva. Preparada, todavia sin usar (18/08).';

create index if not exists idx_mioh_item_changed
  on public.menu_item_override_history (menu_item_id, changed_at desc);
create index if not exists idx_mioh_operation
  on public.menu_item_override_history (operation_id);

-- RLS: lectura por cuenta, igual que menu_item_override. NINGUNA politica de
-- escritura y NINGUN grant de escritura: a mano no escribe nadie. El trigger es
-- SECURITY DEFINER (lo ejecuta el propietario) y por eso si puede insertar.
alter table public.menu_item_override_history enable row level security;

drop policy if exists menu_item_override_history_read on public.menu_item_override_history;
create policy menu_item_override_history_read
  on public.menu_item_override_history
  for select
  using (account_id = any (current_user_account_ids()));

revoke all on public.menu_item_override_history from anon, authenticated;
grant select on public.menu_item_override_history to authenticated;
grant select on public.menu_item_override_history to service_role;

-- ── A.2 · Trigger de historial ──────────────────────────────────────────────
-- En UPDATE solo se registra si price o is_available cambian DE VERDAD. La
-- comparacion es NUMERICA (price es numeric): 15.90 y 15.9 son el mismo numero,
-- asi que reguardar el mismo precio escrito distinto NO deja fila.
create or replace function public.tg_menu_item_override_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := auth.uid();   -- null si escribe un proceso sin JWT
begin
  if tg_op = 'INSERT' then
    insert into menu_item_override_history (
      account_id, menu_item_id, location_id, channel_id, op,
      price_before, price_after, is_available_before, is_available_after, changed_by)
    values (
      new.account_id, new.menu_item_id, new.location_id, new.channel_id, 'insert',
      null, new.price, null, new.is_available, v_actor);

  elsif tg_op = 'UPDATE' then
    if (new.price IS DISTINCT FROM old.price)
       or (new.is_available IS DISTINCT FROM old.is_available) then
      insert into menu_item_override_history (
        account_id, menu_item_id, location_id, channel_id, op,
        price_before, price_after, is_available_before, is_available_after, changed_by)
      values (
        new.account_id, new.menu_item_id, new.location_id, new.channel_id, 'update',
        old.price, new.price, old.is_available, new.is_available, v_actor);
    end if;

  else -- DELETE
    insert into menu_item_override_history (
      account_id, menu_item_id, location_id, channel_id, op,
      price_before, price_after, is_available_before, is_available_after, changed_by)
    values (
      old.account_id, old.menu_item_id, old.location_id, old.channel_id, 'delete',
      old.price, null, old.is_available, null, v_actor);
  end if;

  return null;  -- AFTER trigger: el valor de retorno se ignora
end;
$$;

drop trigger if exists trg_menu_item_override_history on public.menu_item_override;
create trigger trg_menu_item_override_history
  after insert or update or delete on public.menu_item_override
  for each row execute function public.tg_menu_item_override_history();

-- ── A.3 · updated_at se escribe solo ────────────────────────────────────────
-- La columna existe desde siempre y no la escribia nadie.
create or replace function public.tg_menu_item_override_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_menu_item_override_touch on public.menu_item_override;
create trigger trg_menu_item_override_touch
  before update on public.menu_item_override
  for each row execute function public.tg_menu_item_override_touch();

-- ── A.4 + A.5 · set_menu_item_override ──────────────────────────────────────
-- Reproduccion EXACTA de la funcion actual mas: las dos validaciones (A.5) y
-- `updated_at = now()` en el DO UPDATE (A.4). Firma, LANGUAGE, SECURITY DEFINER
-- y search_path intactos. Ningun otro cambio.
CREATE OR REPLACE FUNCTION public.set_menu_item_override(
  p_menu_item_id uuid,
  p_channel_id uuid,
  p_price numeric DEFAULT NULL::numeric,
  p_is_available boolean DEFAULT true,
  p_location_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT mi.account_id INTO v_account_id FROM menu_item mi WHERE mi.id = p_menu_item_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Producto % no encontrado', p_menu_item_id;
  END IF;
  IF NOT (current_user_is_admin() OR current_user_is_admin_or_manager_of(v_account_id)) THEN
    RAISE EXCEPTION 'Sin permiso para editar precios de este producto';
  END IF;

  -- A.5 (deuda B7): dos validaciones defensivas, ni una mas.
  IF p_price IS NOT NULL AND p_price < 0 THEN
    RAISE EXCEPTION 'El precio no puede ser negativo (recibido %)', p_price;
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM locations l
        WHERE l.id = p_location_id AND l.account_id = v_account_id) THEN
    RAISE EXCEPTION 'El local % no pertenece a la cuenta de este producto', p_location_id;
  END IF;

  INSERT INTO menu_item_override (account_id, menu_item_id, channel_id, location_id, price, is_available)
  VALUES (v_account_id, p_menu_item_id, p_channel_id, p_location_id, p_price, p_is_available)
  ON CONFLICT (menu_item_id,
               COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
               COALESCE(channel_id,  '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET price = EXCLUDED.price, is_available = EXCLUDED.is_available, updated_at = now();
END;
$function$;

