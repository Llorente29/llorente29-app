-- scripts/conta/produccion/cuentas/dm1-casa-lola-contabilidad.sql
--
-- DM1 · La contabilidad de demo de Casa Lola (03/11) · LO QUE CUENTA LA TANDA
-- (1350), antes y después. SOLO LEE, y solo lo de Casa Lola (su account_id).
-- Antes: sin marca de demo, sin empresa, 0 asientos, 0 movimientos, ningún 303
-- y la función sin crear. Después: marcada, una empresa, sus asientos validados,
-- su extracto con tres sin casar, el 303 del 3T presentado y el del 4T en borrador.
-- Tras la vuelta atrás: como antes.
select clave, valor from (
  select 1 o, 'Casa Lola marcada como demo (antes no, después sí)' clave,
    -- quieta: la marca solo la cambia el superadministrador o esta tanda
    coalesce((select is_demo from public.accounts where id = '623d946a-a0ce-4f34-8c00-9761dfed8331'), false)::text valor union all
  select 2, 'empresas de Casa Lola (antes 0, después 1)',
    -- quieta: Casa Lola no tiene empresa hasta esta tanda; nadie más la crea
    (select count(*) from public.company where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331')::text union all
  select 3, 'asientos validados de Casa Lola (antes 0)',
    -- quieta: sin empresa no se asienta nada de Casa Lola; solo esta tanda los crea
    (select count(*) from public.journal_entry where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and status = 'validado')::text union all
  select 4, 'asientos sin validar de Casa Lola (antes 0, después 0)',
    -- quieta: sin empresa no se propone nada de Casa Lola
    (select count(*) from public.journal_entry where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and status <> 'validado')::text union all
  select 5, 'movimientos del banco de Casa Lola, sin casar (antes 0, después 3)',
    -- quieta: Casa Lola no tiene banco hasta esta tanda
    (select count(*) from public.bank_movement where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and status = 'pendiente')::text union all
  select 6, 'recibidas de Casa Lola (antes 0, después 18)',
    -- quieta: Casa Lola no recibe facturas hasta esta tanda
    (select count(*) from public.supplier_invoice where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331')::text union all
  select 7, 'el 303 de Casa Lola, por trimestre (antes ninguno; después 3T presentado y 4T en borrador)',
    -- quieta: sin empresa no hay declaraciones
    coalesce((select string_agg(period || ' ' || status, ', ' order by period) from public.tax_return
               where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and form_code = '303'), 'ninguno') union all
  select 8, 'la función demo_contabilidad_sembrar existe (antes false, después true)',
    (to_regprocedure('public.demo_contabilidad_sembrar(uuid)') is not null)::text
) t order by o;
