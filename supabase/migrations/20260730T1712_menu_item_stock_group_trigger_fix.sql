-- 20260730T1712_menu_item_stock_group_trigger_fix.sql
-- ============================================================================
-- CORRECTIVA — 20260730T1710 reportó "Success" pero el trigger
-- trg_menu_item_inherit_stock_group NO existe en menu_item (confirmado por
-- Julio: solo están menu_item_price_snapshot_ins/upd y
-- set_menu_item_updated_at). El fichero 20260730T1710 en sí está completo y
-- correcto (función + CREATE TRIGGER con nombre y tabla correctos) — la
-- discrepancia es de ejecución, no de autoría. Se re-aplica aquí, con GUARD
-- real contra pg_trigger (no se vuelve a dar por hecho el CREATE).
--
-- No se edita 20260730T1710 (ya "aplicada"). Idempotente: CREATE OR REPLACE
-- + DROP TRIGGER IF EXISTS / CREATE TRIGGER, seguro re-ejecutar.
-- Aplicada: —
-- ============================================================================

begin;

create or replace function public.tg_menu_item_inherit_stock_group()
returns trigger
language plpgsql
as $$
declare
  v_group uuid;
begin
  if new.stock_group_id is null and new.external_id is not null then
    select mi.stock_group_id into v_group
    from menu_item mi
    where mi.account_id = new.account_id
      and mi.external_id = new.external_id
      and mi.stock_group_id is not null
      and mi.archived_at is null
      and mi.id <> new.id
    limit 1;

    if v_group is not null then
      new.stock_group_id := v_group;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_menu_item_inherit_stock_group on public.menu_item;
create trigger trg_menu_item_inherit_stock_group
  before insert or update of external_id on public.menu_item
  for each row
  execute function public.tg_menu_item_inherit_stock_group();

-- GUARD: verificar contra pg_trigger que quedó de verdad creado — no dar por
-- hecho el CREATE (mismo patrón que el índice de stock_group en 20260730T1750).
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_menu_item_inherit_stock_group'
      and tgrelid = 'public.menu_item'::regclass
  ) then
    raise exception 'trg_menu_item_inherit_stock_group no quedó creado en menu_item — abortando';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- select tgname, tgenabled, tgrelid::regclass
-- from pg_trigger
-- where tgrelid = 'public.menu_item'::regclass and not tgisinternal;
-- Debe listar trg_menu_item_inherit_stock_group junto a los ya existentes
-- (menu_item_price_snapshot_ins/upd, set_menu_item_updated_at).
