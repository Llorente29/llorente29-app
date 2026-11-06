-- supabase/migrations/20261104T1640_s01p_recibido_con_factura.sql
--
-- S01p · Lo recibido sin factura se retira cuando llega la factura (Julio,
-- respuesta S01p·3, 04/11 16:07).
--
-- Lo que pasó, medido en producción el 04/11 (solo lectura):
--   · purchase_accrual ec0b1122 (Olimpo Gourmet, Foodint Alcalá, octubre,
--     149,44 €) se calculó el 01/11 a las 02:40 con el ALB-00217 del 19/10 aún
--     sin factura; sus dos asientos se propusieron (31/10 y su contrario el 01/11).
--   · La 26A/10965 (FAC-00304, del 21/10) entró el 01/11 a las 10:12 y enlazó el
--     albarán (goods_receipt_path.supplier_invoice_id). Desde ese momento el
--     albarán ya no estaba pendiente en octubre.
--   · Nadie retiró la pareja: _compras_fin_de_mes no quitaba una periodificación
--     que tuviera asientos, ni propuestos; y si cambiaba, actualizaba el importe
--     y dejaba las propuestas con el de antes. Y solo corría de noche.
-- Es la única periodificación de toda la base.
--
-- El arreglo, de raíz:
--   1. _compras_fin_de_mes: lo periodificado que ya no hace falta (su albarán
--      tiene factura del mes) o que ha cambiado, con asientos solo propuestos o
--      en borrador, pierde esos asientos: una propuesta no deja rastro en el
--      libro (como en bank_deshacer y conta_recibida_guardar). Después se quita
--      o se rehace con lo que queda pendiente. Lo validado no se toca: eso se
--      corrige en el libro diario.
--   2. Un disparador: cuando un albarán periodificado recibe su factura (cambia
--      su supplier_invoice_id), se rehace en el momento lo recibido sin factura
--      de su mes (conta_proponer_recibidos), sin esperar a la noche. Si no se
--      puede, queda en «Lo que no se propone» con su porqué.
--   3. La 1641 lo pasa sobre octubre de Foodint: fuera la pareja de Olimpo.
--
-- Nada en el camino del pedido.
-- sin hueco: lo que se retira es una propuesta de lo recibido sin factura; si sigue haciendo falta, la misma pasada (conta_proponer_recibidos, también desde el disparador) la rehace con lo que queda pendiente, y si no, es que el albarán ya tiene su factura.
--
-- cambia: public._compras_fin_de_mes · prueba: supabase/staging/sql/20261104_s01p_recibido_prueba.sql
-- cambia: public.goods_receipt_path · prueba: supabase/staging/sql/20261104_s01p_recibido_prueba.sql
--   (un disparador nuevo, AFTER, que no toca la fila del albarán)

do $$
declare
  f constant text := 'public._compras_fin_de_mes(uuid,date)';
  a constant text := E'  -- Lo que ya no está (se facturó dentro del mes) y no tiene asiento: fuera.\n';
  b constant text := E'  -- S01p: lo periodificado que ya no hace falta (su albarán tiene factura del\n'
    || E'  -- mes) o que ha cambiado, con asientos solo propuestos o en borrador: fuera\n'
    || E'  -- esos asientos (una propuesta no deja rastro en el libro), para que se quite\n'
    || E'  -- o se rehaga abajo. Lo validado no se toca: se corrige en el libro diario.\n'
    || E'  delete from journal_entry e using purchase_accrual a where a.company_id = p_empresa and a.month = v_ini and e.company_id = p_empresa\n'
    || E'     and e.source_type in (''purchase_accrual'', ''purchase_accrual_reversal'') and e.source_id = a.id\n'
    || E'     and e.status in (''propuesto'', ''borrador'')\n'
    || E'     and not exists (select 1 from journal_entry v where v.company_id = p_empresa and v.source_id = a.id\n'
    || E'                      and v.source_type in (''purchase_accrual'', ''purchase_accrual_reversal'') and v.status = ''validado'')\n'
    || E'     and not exists (select 1 from _fin_de_mes x where x.supplier_id = a.supplier_id and x.location_id is not distinct from a.location_id\n'
    || E'                      and x.base = a.base and x.receipts = a.receipts);\n\n'
    || a;
  v_def text; v_n int;
begin
  v_def := pg_get_functiondef(f::regprocedure);
  if strpos(v_def, '-- S01p: lo periodificado que ya no hace falta') > 0 then
    raise notice 'S01p·1640: % ya retira las propuestas de lo que no toca.', f; return;
  end if;
  v_n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if v_n <> 1 then raise exception 'S01p·1640: en % el trozo sale % veces y tenía que salir una: no se toca.', f, v_n; end if;
  perform public._respaldar_funcion(f, '20261104T1640_s01p_recibido_con_factura');
  execute replace(v_def, a, b);
end $$;

-- Cuando un albarán periodificado recibe su factura: lo recibido sin factura de su mes, al momento.
create or replace function public._tg_s01p_albaran_facturado()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_a record; v_empresa uuid;
begin
  if new.supplier_invoice_id is not distinct from old.supplier_invoice_id then return null; end if;
  v_empresa := coalesce(new.company_id,
    (select c.id from public.company c where c.account_id = new.account_id and c.is_active
      group by c.id having (select count(*) from public.company k where k.account_id = new.account_id and k.is_active) = 1));
  for v_a in
    select distinct a.company_id, a.month from public.purchase_accrual a
     where a.account_id = new.account_id and (v_empresa is null or a.company_id = v_empresa)
       and a.receipts @> jsonb_build_array(jsonb_build_object('id', new.goods_receipt_id))
       and not exists (select 1 from public.journal_entry v where v.company_id = a.company_id and v.source_id = a.id
                        and v.source_type in ('purchase_accrual', 'purchase_accrual_reversal') and v.status = 'validado')
  loop
    begin
      perform public.conta_proponer_recibidos(v_a.company_id, v_a.month, (v_a.month + interval '1 month - 1 day')::date, 'Sumied');
    exception when others then
      perform public._conta_no_propuesta(v_a.company_id, 'purchase_accrual', v_a.month::text, 'Recibido sin factura de ' || to_char(v_a.month, 'MM/YYYY'),
        'Un albarán ha recibido su factura y no se ha podido rehacer lo recibido sin factura del mes: ' || sqlerrm,
        'Compras y gastos › Facturas recibidas');
    end;
  end loop;
  return null;
end $$;
revoke all on function public._tg_s01p_albaran_facturado() from public, anon, authenticated;
drop trigger if exists s01p_albaran_facturado on public.goods_receipt_path;
create trigger s01p_albaran_facturado
  after update of supplier_invoice_id on public.goods_receipt_path
  for each row execute function public._tg_s01p_albaran_facturado();
