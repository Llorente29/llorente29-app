-- supabase/migrations/20261121T2350_r15b_rehacer_dias.sql
--
-- R15b · El día del TPV en el libro de IVA, como manda la ley. 2 de 2: los días que YA
-- ESTABAN contabilizados (los 31 de octubre de Frango y los que haya al aplicarse) se
-- rehacen en el libro como los nuevos (2347): una fila por serie, cada factura con NIF y
-- cada devolución (R5) en la suya. Va detrás de la 2347.
-- Escribe sobre lo que existe (el libro de IVA de esos días): pide autorizo.
--
--   · El ASIENTO de cada día no se toca: mismo número, su PDF sigue enlazado, la cadena de
--     huellas intacta. Solo se reparten sus filas del libro (_conta_tpv_libro_repartir,
--     origen «rehecho»), con lo de antes guardado en conta_tpv_libro_antes.
--   · Regla 31 por día, dentro de la misma función: la base y la cuota de cada tipo, al
--     céntimo, las mismas antes y después; si un día no da lo mismo, PARA todo.
--   · Un día de un periodo con el 303 ya presentado no se toca (el candado del libro para).
-- Lo que cuenta antes y después, día a día: scripts/conta/produccion/cuentas/r15b-libro-del-dia.sql.
-- Se puede pasar dos veces (la segunda no encuentra nada).
-- Vuelta atrás: supabase/vuelta-atras/20261121T2350_r15b_rehacer_dias.down.sql

do $$
declare d record; v_dias int := 0; v_filas int := 0;
begin
  for d in
    select t.id, t.entry_id
      from public.conta_tpv_dia t join public.journal_entry e on e.id = t.entry_id and e.account_id = t.account_id
     where t.estado = 'contabilizado' and e.status = 'validado'
       and not exists (select 1 from public.conta_tpv_libro_antes a where a.entry_id = t.entry_id)
     order by t.account_id, t.company_id, t.dia
  loop
    v_filas := v_filas + public._conta_tpv_libro_repartir(d.id, d.entry_id, 'rehecho');
    v_dias := v_dias + 1;
  end loop;
  raise notice 'R15b · 2350: % días rehechos en el libro de IVA, con % filas.', v_dias, v_filas;
end $$;
