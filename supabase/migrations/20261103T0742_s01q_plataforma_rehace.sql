-- supabase/migrations/20261103T0742_s01q_plataforma_rehace.sql
--
-- S01q·10 · La propuesta de una liquidación de plataforma se rehace sola
-- cuando la liquidación cambia (Julio, 03/11, «sí» a los puntos 1 a 3).
--   · Por qué hace falta: al entrar una liquidación, su disparador la propone
--     ANTES de que otros le enlacen la factura de comisión o la marquen «de
--     referencia»; cuando eso llega y el disparador vuelve a saltar,
--     _conta_proponer_plataforma veía que ya había una propuesta y no la
--     rehacía. Así quedaron 27 de Glovo que repiten la comisión y su IVA.
--   1. _conta_proponer_plataforma: si su propuesta está solo «propuesta» y
--      ya no vale —la liquidación es de referencia, o tiene su factura de
--      comisión y la propuesta lleva gasto o IVA soportado—, la quita y la
--      vuelve a proponer. Una validada (o en borrador) no se toca nunca. En
--      un día cerrado no toca nada.
--   2. _conta_plataforma_entrada: si su factura de comisión aún no está
--      contabilizada (ni en Sumied ni en Diez), la liquidación espera, y lo
--      dice: «Sin propuesta hasta que se aclare su factura de comisión <nº>:
--      <su porqué>» (Julio: la del I170326000551592, que difiere 170,61 €).
--      Lo recoge la pasada de noche cuando la factura se contabiliza.
-- Misma firma las dos, con su respaldo. No toca filas.
--
-- sin hueco: el fichero no retira nada al aplicarse; el «delete from journal_entry»
-- va dentro de la función, solo quita una PROPUESTA que ya no vale y en la misma
-- llamada la vuelve a proponer (o dice por qué no).
--
-- cambia: public._conta_proponer_plataforma · prueba: supabase/staging/sql/20261103_s01q_liquidaciones_prueba.sql
-- cambia: public._conta_plataforma_entrada · prueba: supabase/staging/sql/20261103_s01q_liquidaciones_prueba.sql

select public._respaldar_funcion('public._conta_proponer_plataforma(uuid,uuid,text)', '20261103T0742_s01q_plataforma_rehace');
select public._respaldar_funcion('public._conta_plataforma_entrada(uuid,uuid)', '20261103T0742_s01q_plataforma_rehace');

-- 1 · Rehacer la propuesta que ya no vale.
create or replace function public._conta_proponer_plataforma(p_company uuid, p_liq uuid, p_quien text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare x jsonb; v_res jsonb; v_fecha date; v_prev public.journal_entry; v_cs public.channel_settlement; v_vieja boolean := false;
begin
  select * into v_prev from public.journal_entry e
   where e.company_id = p_company and e.source_type = 'channel_settlement' and e.source_id = p_liq and e.status in ('propuesto', 'borrador', 'validado')
   order by (e.status = 'validado') desc, (e.status = 'borrador') desc, e.created_at desc limit 1;
  if v_prev.id is not null then
    -- S01q·10: solo una «propuesta» que ya no vale se rehace; validada o en borrador, nunca.
    if v_prev.status = 'propuesto' then
      select * into v_cs from public.channel_settlement where id = p_liq;
      v_vieja := coalesce(v_cs.is_reference, false)
              or (v_cs.commission_invoice_id is not null
                  and exists (select 1 from public.journal_line l join public.company_account ca on ca.id = l.company_account_id
                               where l.entry_id = v_prev.id and (ca.code like '6%' or l.vat_book = 'received')));
    end if;
    if not v_vieja then
      return jsonb_build_object('propuestas', 0, 'yaEstaban', 1, 'descartadas', 0, 'sinPropuesta', '[]'::jsonb);
    end if;
  end if;
  select coalesce(collected_on, settlement_date) into v_fecha from public.channel_settlement where id = p_liq;
  if v_fecha is null or not public.conta_dia_abierto(p_company, v_fecha) then
    return jsonb_build_object('propuestas', 0, 'yaEstaban', case when v_prev.id is not null then 1 else 0 end, 'descartadas', 0, 'sinPropuesta', '[]'::jsonb);
  end if;
  if v_vieja then
    delete from public.journal_entry e where e.id = v_prev.id and e.status = 'propuesto';
  end if;
  x := public.conta_propuestas_plataforma(p_company, p_liq);
  if x ? 'sin_propuesta' then
    perform public._conta_no_propuesta(p_company, 'channel_settlement', p_liq::text, x->>'que', x->>'sin_propuesta', 'Ventas › Liquidaciones');
    return jsonb_build_object('propuestas', 0, 'yaEstaban', 0, 'descartadas', 0, 'sinPropuesta', jsonb_build_array(jsonb_build_object('que', x->>'que', 'porque', x->>'sin_propuesta')));
  end if;
  v_res := public._conta_proponer(p_company, x->'propuesta', p_quien);
  return jsonb_build_object('propuestas', case when (v_res->>'descartada')::boolean or (v_res->>'existente')::boolean then 0 else 1 end,
    'yaEstaban', case when (v_res->>'existente')::boolean then 1 else 0 end, 'descartadas', case when (v_res->>'descartada')::boolean then 1 else 0 end, 'sinPropuesta', '[]'::jsonb);
end $$;
revoke all on function public._conta_proponer_plataforma(uuid, uuid, text) from public, anon, authenticated;

-- 2 · Esperar a la factura de comisión sin contabilizar, y decirlo.
do $$
declare
  v_def text := pg_get_functiondef('public._conta_plataforma_entrada(uuid,uuid)'::regprocedure); v_n int; i int;
  a text[] := array[
    $t$             where si.id = k.commission_invoice_id and si.account_id = k.account_id) as factura,$t$,
    $t$    when n.correo and n.needs_review is true then jsonb_build_object('que', n.que, 'fecha', n.fecha,$t$];
  b text[] := array[
    $t$             where si.id = k.commission_invoice_id and si.account_id = k.account_id) as factura,
           -- S01q·10 · Su factura de comisión, sin contabilizar (ni en Sumied ni en Diez): la liquidación espera.
           case when k.commission_invoice_id is not null
                 and not exists (select 1 from public.journal_entry s where s.account_id = k.account_id and s.source_type = 'supplier_invoice'
                                    and s.source_id = k.commission_invoice_id and s.status = 'validado')
                 and not exists (select 1 from public.supplier_invoice si join public.journal_entry d on d.id = si.journal_entry_id
                                  where si.id = k.commission_invoice_id and si.account_id = k.account_id and d.status = 'validado')
                then (select 'Sin propuesta hasta que se aclare su factura de comisión ' || coalesce(nullif(si.invoice_number, ''), 'sin número') || ': '
                             || coalesce(nullif(lower(left(a.porque, 1)) || substr(a.porque, 2), ''), 'aún no está contabilizada.')
                        from public.supplier_invoice si left join public.supplier_invoice_auto a on a.invoice_id = si.id
                       where si.id = k.commission_invoice_id and si.account_id = k.account_id) end as fa_espera,$t$,
    $t$    when n.fa is not null and n.fa_espera is not null then jsonb_build_object('que', n.que, 'fecha', n.fecha, 'sin_propuesta', n.fa_espera)
    when n.correo and n.needs_review is true then jsonb_build_object('que', n.que, 'fecha', n.fecha,$t$];
begin
  if strpos(v_def, 'as fa_espera,') > 0 then raise notice 'S01q·10: _conta_plataforma_entrada ya espera a su factura.'; return; end if;
  for i in 1..2 loop
    v_n := (length(v_def) - length(replace(v_def, a[i], ''))) / length(a[i]);
    if v_n <> 1 then raise exception 'S01q·10: _conta_plataforma_entrada no tiene una sola vez el trozo % (lo tiene % veces): no se cambia nada.', i, v_n; end if;
    v_def := replace(v_def, a[i], b[i]);
  end loop;
  execute v_def;
end $$;
