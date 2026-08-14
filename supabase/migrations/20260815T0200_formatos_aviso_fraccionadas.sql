-- ----------------------------------------------------------------------------
-- Folvy - 20260815T0200
-- Formatos (Tramo D.3): aviso de cantidades fraccionadas
-- ----------------------------------------------------------------------------
--
-- QUE ES ESTO
-- -----------
-- goods_receipt_fractional_warnings: líneas con qty_received no entera en
-- artículos medidos en UNIDADES (kitchen_unit.dimension='unit'). "¿0,5
-- cajas? Si el paquete real es más pequeño, el formato está mal."
--
-- CORRECCIÓN DE JULIO (14/08, tras el hallazgo de Code) sobre la línea base
-- del propio encargo canónico: el encargo citaba "29 líneas en 10
-- artículos", pero esa cifra solo sale SIN filtrar por dimensión -- incluye
-- artículos de PESO (Tomate Pera a 3,3 kg es una cantidad normal, no un
-- fallo). Filtrando por dimension='unit' (lo que el propio texto describe,
-- con el ejemplo de la Bolsa SOS) salen 10 líneas en 5 artículos -- el
-- criterio correcto, confirmado por Julio, y no necesita Ley 5
-- (is_weighted) para nada: la dimensión del artículo ya basta.
--
-- Validado en vivo: la Bolsa SOS del propio caso testigo del encargo
-- (0,5 cajas) sale marcada.
-- ----------------------------------------------------------------------------

create or replace function public.goods_receipt_fractional_warnings(p_account_id uuid, p_receipt_id uuid)
returns table (
  line_id uuid,
  recipe_item_id uuid,
  product_name text,
  qty_received numeric,
  format_name text
)
security definer
set search_path to 'public'
language plpgsql
as $$
begin
  if not belongs_to_account(p_account_id) then
    raise exception 'No autorizado para esta cuenta.';
  end if;

  return query
  select grl.id, grl.recipe_item_id, ri.name,
         grl.qty_received::numeric, f.name
  from goods_receipt_line grl
  join goods_receipt gr on gr.id = grl.goods_receipt_id
  join recipe_item ri on ri.id = grl.recipe_item_id
  join kitchen_unit ku on ku.id = ri.base_unit_id
  left join recipe_item_purchase_format f on f.id = grl.purchase_format_id
  where gr.id = p_receipt_id and gr.account_id = p_account_id
    and ku.dimension = 'unit'
    and grl.qty_received is not null
    and grl.qty_received <> round(grl.qty_received::numeric);
end;
$$;

do $$
declare v_count int;
begin
  select count(*) into v_count from pg_proc where proname = 'goods_receipt_fractional_warnings';
  if v_count <> 1 then raise exception 'guard: se esperaba 1 funcion goods_receipt_fractional_warnings, hay %', v_count; end if;
end $$;
