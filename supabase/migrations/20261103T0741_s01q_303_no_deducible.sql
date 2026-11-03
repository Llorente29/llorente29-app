-- supabase/migrations/20261103T0741_s01q_303_no_deducible.sql
--
-- S01q·10 · El 303: una recibida con IVA NO deducible de un proveedor de fuera
-- (Julio, 03/11: las dos de Anthropic Ireland, 72MQQQA8-0007 y -0008, van a
-- su nombre y Anthropic cobra el IVA español a un particular: no son
-- intracomunitarias, y su IVA va al gasto).
--   · Ya no la marca «compra a un proveedor de fuera de España sin
--     autoliquidar»: con deducible 0 y cuota distinta de 0 no entra en el 303
--     (D07, 0850), sea de donde sea el proveedor.
--   · Medido el 03/11 en producción, todas las cuentas (solo lectura): cambia
--     solo esas 2 líneas del libro; ninguna otra deja de marcarse.
-- Misma firma, desde el cuerpo de producción y con su respaldo. No toca filas.
--
-- cambia: public.conta_impuesto_303_cajas · prueba: supabase/staging/sql/20261103_s01q_liquidaciones_prueba.sql

select public._respaldar_funcion('public.conta_impuesto_303_cajas(public.vat_book_entry)', '20261103T0741_s01q_303_no_deducible');
do $$
declare
  v_def text := pg_get_functiondef('public.conta_impuesto_303_cajas(public.vat_book_entry)'::regprocedure);
  v_antes constant text := $t$             and coalesce(v.counterpart_country, 'ES') <> 'ES' then 'extranjera_sin_isp'$t$;
  v_despues constant text := $t$             and coalesce(v.counterpart_country, 'ES') <> 'ES'
             -- S01q·10: con IVA no deducible no entra en el 303: no hay nada que autoliquidar.
             and not (coalesce(v.deductible_amount, 0) = 0 and coalesce(v.tax_amount, 0) <> 0) then 'extranjera_sin_isp'$t$;
  v_n int;
begin
  if (length(v_def) - length(replace(v_def, v_despues, ''))) / length(v_despues) = 1 then
    raise notice 'S01q·10: conta_impuesto_303_cajas ya lo tiene.'; return;
  end if;
  v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
  if v_n <> 1 then raise exception 'S01q·10: conta_impuesto_303_cajas no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada.', v_n; end if;
  execute replace(v_def, v_antes, v_despues);
end $$;
