-- ENCARGO CODE (14/08) feat/recepcion-oficina-cierre — CREATE OR REPLACE con
-- una lista de parámetros distinta crea una SOBRECARGA nueva en Postgres, no
-- sustituye la función: la de 6 argumentos (sin p_not_goods, RETURNS void,
-- cuerpo viejo con movement_type='ajuste' siempre) seguía viva y una llamada
-- posicional de 6 args habría resuelto a ESA, no a la nueva. Se elimina para
-- que solo quede la de 8 args (con default) — misma función para llamadas
-- viejas y nuevas.
drop function if exists public.adjust_goods_receipt_line(uuid, uuid, uuid, numeric, numeric, text);

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='adjust_goods_receipt_line'
      and pg_get_function_arguments(p.oid) = 'p_line_id uuid, p_recipe_item_id uuid, p_purchase_format_id uuid, p_qty_received numeric, p_unit_cost numeric, p_discrepancy_reason text'
  ) then
    raise exception 'A.3: la sobrecarga vieja de 6 argumentos sigue existiendo';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='adjust_goods_receipt_line') <> 1 then
    raise exception 'A.3: debería quedar EXACTAMENTE una función adjust_goods_receipt_line';
  end if;
end $$;

notify pgrst, 'reload schema';