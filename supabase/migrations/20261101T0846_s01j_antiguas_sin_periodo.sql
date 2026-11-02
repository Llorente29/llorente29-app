-- supabase/migrations/20261101T0846_s01j_antiguas_sin_periodo.sql
-- cambia: public.channel_settlement · prueba: supabase/staging/sql/20261101_s01j_correo_prueba.sql
--
-- S01j · Las liquidaciones antiguas sin periodo se completan con la que llega
-- por correo (Julio, Respuesta S01j · 1, punto 3).
--
-- Medido el 01/11 en Foodint: 53 de Just Eat (import_csv_je, clave «je:<número>»)
-- y 96 de Glovo (import_csv_glovo, «glovo:<número>»), del 15/04 al 30/06, sin
-- periodo ni tienda, y sin nada ligado: 0 asientos, 0 cobros, 0 facturas, 0
-- casadas con el banco, raw vacío. Cuando entra una liquidación de Just Eat o de
-- Glovo cuyo número (el de su factura, o el del asunto del correo de Just Eat)
-- es el de una antigua, la nueva —con su periodo, su tienda y sus cifras— se
-- queda, y la antigua se quita: así no hay dos. Solo si la antigua sigue sin
-- nada ligado (asiento, cobro, factura, casación, pedidos, cobros de factura);
-- si tiene algo, se quedan las dos y nada se toca. La nueva guarda en raw de
-- cuál viene («sustituye»).
-- Sin raw, el periodo de las que no lleguen no se puede sacar sin adivinar: se
-- quedan como están (la ficha lo dice).
--
-- Disparador nuevo en una tabla que existe; no toca ninguna fila al aplicarse.
-- Vuelta atrás: supabase/vuelta-atras/20261101T0846_s01j_antiguas_sin_periodo.down.sql

create or replace function public._s01j_liquidacion_sustituye()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_prov text; v_pre text; v_claves text[]; v_old public.channel_settlement;
begin
  if new.period_from is null or new.raw is null then return null; end if;
  v_prov := new.raw->>'proveedor';
  v_pre := case v_prov when 'justeat' then 'je:' when 'glovo' then 'glovo:' end;
  if v_pre is null then return null; end if;
  v_claves := array_remove(array[v_pre || nullif(btrim(new.raw->>'referencia'), ''), v_pre || nullif(btrim(new.raw->>'referencia_asunto'), '')], null);
  if array_length(v_claves, 1) is null then return null; end if;
  begin
    for v_old in
      select o.* from public.channel_settlement o
       where o.account_id = new.account_id and o.id <> new.id and o.period_from is null and o.import_key = any(v_claves)
         and o.journal_entry_id is null and o.collected_on is null and o.commission_invoice_id is null
         and not exists (select 1 from public.bank_match_item i where i.channel_settlement_id = o.id)
         and not exists (select 1 from public.channel_settlement_invoice k where k.settlement_id = o.id)
         and not exists (select 1 from public.channel_settlement_order r where r.settlement_id = o.id)
         and not exists (select 1 from public.customer_invoice_payment c where c.settlement_id = o.id)
    loop
      delete from public.channel_settlement where id = v_old.id;
      update public.channel_settlement
         set raw = raw || jsonb_build_object('sustituye', jsonb_build_object('import_key', v_old.import_key, 'source', v_old.source, 'settlement_date', v_old.settlement_date))
       where id = new.id;
    end loop;
  exception when others then
    -- Nunca impide registrar la nueva: si algo falla, se quedan las dos.
    raise log 'S01j · no se ha podido sustituir la antigua de la liquidación %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists s01j_liquidacion_sustituye on public.channel_settlement;
create trigger s01j_liquidacion_sustituye after insert on public.channel_settlement
  for each row when (pg_trigger_depth() = 0) execute function public._s01j_liquidacion_sustituye();
