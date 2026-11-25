-- scripts/conta/produccion/cuentas/q10-emitir.sql
--
-- Q10 · Emitir las cuotas (1610) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Lo que tiene que cambiar: la función existe (0 → 1). Lo demás, igual: aplicar la tanda no emite nada (las facturas
-- de la serie «1» y lo atado en conta_gc_cobro_factura de las dos empresas de la gestoría, las mismas).
select clave, valor from (
  select 1 o, 'función conta_cuotas_emitir' clave, (to_regprocedure('public.conta_cuotas_emitir(uuid,text,int,text,jsonb)') is not null)::text valor
  union all
  select 2, 'facturas de la serie 1 · ' || c.legal_name,
    -- quieta: solo las escribe la emisión de esta tanda, que la lanza Julio desde la pantalla, no el ensayo ni el real
    (select count(*) from public.customer_invoice i where i.company_id = c.id and i.series_code = '1')::text
    from public.company c where c.account_id = 'f4e8032d-510a-4e57-914c-4b67732d8655'
  union all
  select 3, 'facturas atadas a su cobro',
    -- quieta: la escribe solo la emisión (Julio, desde la pantalla); sin la tabla del #816, «sin la tabla»
    case when to_regclass('public.conta_gc_cobro_factura') is null then 'sin la tabla'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_gc_cobro_factura where account_id = ''f4e8032d-510a-4e57-914c-4b67732d8655''', false, true, '')))[1]::text end
) t order by o, clave;
