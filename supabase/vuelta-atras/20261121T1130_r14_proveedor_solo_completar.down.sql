-- supabase/vuelta-atras/20261121T1130_r14_proveedor_solo_completar.down.sql
--
-- R14 · Vuelta atrás de la 1130, en orden inverso:
--   2. lo completado AL APLICAR se deshace como su «Deshacer» (_conta_proveedor_solo_deshacer):
--      cada factura vuelve a no tener proveedor y lo que Sumied dio de alta sin nada más se va con
--      su subcuenta. PARA si alguna ya tiene su asiento validado (deshacerla pide anular antes el
--      asiento). Las que no se pudieron completar solo pierden su motivo;
--   1. las fichas sueltas unidas AL APLICAR a su plataforma vuelven a su tercero de antes, que
--      deja de estar archivado.
-- Va antes que la de la 1120.
do $$
declare r record; n int := 0; u int := 0;
begin
  if exists (select 1 from public.conta_proveedor_solo x
               join public.journal_entry e on e.source_type = 'supplier_invoice' and e.source_id = x.invoice_id and e.status = 'validado'
              where x.cuando = 'al_aplicar' and x.que <> 'no' and x.deshecho_at is null) then
    raise exception 'R14 · hay facturas completadas al aplicar que ya están validadas: no se deshacen solas.';
  end if;
  -- Primero las «ya estaba» y las de plataforma, y las de «alta» al final: si se deshiciera antes el alta,
  -- el proveedor no se borraría (aún le quedan facturas) y la vuelta atrás no dejaría todo como estaba
  -- (ensayo 44891384917: 6 de 34 medidas distintas). Todas se crean en el mismo instante: el orden lo da esto.
  for r in select invoice_id from public.conta_proveedor_solo where cuando = 'al_aplicar' and que <> 'no' and deshecho_at is null
            order by (que = 'alta'), created_at desc, invoice_id loop
    perform public._conta_proveedor_solo_deshacer(r.invoice_id, 'la vuelta atrás del R14');
    n := n + 1;
  end loop;
  delete from public.conta_proveedor_solo where cuando = 'al_aplicar';
  for r in select * from public.conta_proveedor_unido where cuando = 'al_aplicar' and party_antes is not null loop
    update public.party set archived_at = null, archived_note = null where id = r.party_antes and archived_note like 'Unido a la plataforma %(R14)';
    update public.party_role set party_id = r.party_antes where supplier_id = r.supplier_id and role = 'supplier' and party_id = r.party_plataforma;
    u := u + 1;
  end loop;
  delete from public.conta_proveedor_unido where cuando = 'al_aplicar';
  raise notice 'R14 · deshechas % facturas completadas al aplicar y % fichas unidas a su plataforma.', n, u;
end $$;
