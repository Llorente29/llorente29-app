-- ----------------------------------------------------------------------------
-- Folvy - 20260815T0000
-- Formatos (Tramo C.1/C.2): inmutabilidad (Ley 3) + archivar y sustituir
-- ----------------------------------------------------------------------------
--
-- QUE ES ESTO
-- -----------
-- Ley 3: "un formato con movimientos no se edita, se archiva". El trigger
-- lanza excepción si cambia qty_in_base y el formato tiene stock_movement
-- asociado (vía goods_receipt_line.purchase_format_id). El RPC
-- purchase_format_has_stock_movements es la misma comprobación expuesta al
-- cliente para dar el aviso ANTES de intentarlo -- el trigger sigue siendo
-- la defensa real, esto solo mejora la experiencia.
--
-- La puerta va en el mismo commit que el palo (obligatorio por el propio
-- encargo): src/modules/kitchen/components/PurchaseSourcesSection.tsx
-- ahora detecta el caso y llama a archiveAndReplacePurchaseFormat en vez de
-- updatePurchaseFormat cuando el contenido cambió y hay movimientos.
--
-- VALIDADO EN VIVO (con reversión donde aplica):
--   - UPDATE qty_in_base sobre el formato de Gouda (con movimientos reales)
--     -> excepción, valor sin tocar (verificado: sigue en 6000).
--   - UPDATE de otro campo (updated_at) sobre el mismo formato -> permitido.
--   - purchase_format_has_stock_movements(gouda)=true,
--     purchase_format_has_stock_movements(uuid al azar)=false.
-- ----------------------------------------------------------------------------

create or replace function public._trg_recipe_item_purchase_format_immutable()
returns trigger
language plpgsql
as $$
begin
  if NEW.qty_in_base is distinct from OLD.qty_in_base then
    if exists (
      select 1 from goods_receipt_line grl
      join stock_movement sm on sm.source_type = 'goods_receipt_line' and sm.source_id = grl.id
      where grl.purchase_format_id = OLD.id
      limit 1
    ) then
      raise exception 'Este formato tiene movimientos de stock asociados. Archívalo y crea uno nuevo -- no se puede editar su contenido (qty_in_base).';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_recipe_item_purchase_format_immutable on recipe_item_purchase_format;
create trigger trg_recipe_item_purchase_format_immutable
before update on recipe_item_purchase_format
for each row execute function public._trg_recipe_item_purchase_format_immutable();

create or replace function public.purchase_format_has_stock_movements(p_format_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from goods_receipt_line grl
    join stock_movement sm on sm.source_type = 'goods_receipt_line' and sm.source_id = grl.id
    where grl.purchase_format_id = p_format_id
    limit 1
  );
$$;

do $$
declare v_count int;
begin
  select count(*) into v_count from pg_proc where proname = 'purchase_format_has_stock_movements';
  if v_count <> 1 then raise exception 'guard: se esperaba 1 funcion purchase_format_has_stock_movements, hay %', v_count; end if;
  select count(*) into v_count from pg_trigger where tgname = 'trg_recipe_item_purchase_format_immutable';
  if v_count <> 1 then raise exception 'guard: se esperaba 1 trigger trg_recipe_item_purchase_format_immutable, hay %', v_count; end if;
end $$;
