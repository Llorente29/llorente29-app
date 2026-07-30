-- 20260730T1710_menu_item_stock_group_trigger.sql
-- ============================================================================
-- AUTO-HERENCIA de stock_group_id por external_id (Fase B, punto 4 del modelo).
--
-- Si un menu_item nace (INSERT) o cambia de external_id (UPDATE) SIN grupo
-- propio, y YA existe otro menu_item no archivado de la MISMA CUENTA con ese
-- MISMO external_id que SÍ tiene stock_group_id, el nuevo LO HEREDA solo.
-- Así una marca nueva importada de Last, con sus bebidas de siempre, se une
-- sola al grupo compartido sin que nadie tenga que clasificarla a mano.
--
-- PRINCIPIO DE SEGURIDAD: si NO hay ningún hermano agrupado (caso más común:
-- comida, o una bebida todavía sin clasificar), el item nace SIN grupo — por-
-- marca, aislado. Nunca se agrupa "por si acaso": un 86 cruzado accidental
-- solo puede pasar si YA hay un grupo explícito para heredar.
--
-- Cubre TODOS los caminos de alta de menu_item (manual, add_existing_product,
-- automapeo/create_dish_from_unmapped, recast-autopropagación, ofertas…) sin
-- tener que tocar cada uno: es un trigger, no depende de qué código inserta.
--
-- NO reasigna ni limpia un stock_group_id YA puesto a mano (el guard
-- `new.stock_group_id is null` solo actúa si el campo está vacío).
--
-- DDL sin BEGIN/COMMIT. Idempotente. Aplicada: —
-- ============================================================================

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
