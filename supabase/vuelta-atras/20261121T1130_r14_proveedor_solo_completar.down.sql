-- supabase/vuelta-atras/20261121T1130_r14_proveedor_solo_completar.down.sql
--
-- R14 · Vuelta atrás de la 1130: lo que se completó AL APLICAR se deshace como su
-- «Deshacer» (_conta_proveedor_solo_deshacer): cada factura vuelve a no tener proveedor y
-- lo que Sumied dio de alta sin nada más, se va con su subcuenta. PARA si alguna de esas
-- facturas ya tiene su asiento validado: deshacerla pide anular antes el asiento.
-- Las que no se pudieron completar solo pierden su motivo. Va antes que la de la 1120.
do $$
declare r record; n int := 0;
begin
  if exists (select 1 from public.conta_proveedor_solo x
               join public.journal_entry e on e.source_type = 'supplier_invoice' and e.source_id = x.invoice_id and e.status = 'validado'
              where x.cuando = 'al_aplicar' and x.que <> 'no' and x.deshecho_at is null) then
    raise exception 'R14 · hay facturas completadas al aplicar que ya están validadas: no se deshacen solas.';
  end if;
  for r in select invoice_id from public.conta_proveedor_solo where cuando = 'al_aplicar' and que <> 'no' and deshecho_at is null order by created_at desc loop
    perform public._conta_proveedor_solo_deshacer(r.invoice_id, 'la vuelta atrás del R14');
    n := n + 1;
  end loop;
  delete from public.conta_proveedor_solo where cuando = 'al_aplicar';
  raise notice 'R14 · deshechas % facturas completadas al aplicar.', n;
end $$;
