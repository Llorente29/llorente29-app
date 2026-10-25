-- supabase/vuelta-atras/20261025T2253_v02l_motor_liquidaciones.down.sql
--
-- Vuelta atrás de 20261025T2253_v02l_motor_liquidaciones. Va después de la de
-- la 2254. Quita las funciones del motor, las tres tablas de las tiendas y las
-- columnas nuevas. PARA si después de aplicarla se ha trabajado con ellas
-- (algo que se perdería en silencio):
--   · un cambio de tienda decidido, o un tramo con fecha (una tienda cambiada);
--   · una tienda que ya sabe su ID gracias a esta tanda (ID aprendido, o tienda
--     nueva creada por un documento con ID);
--   · lo reclamado que ya llegó, o una diferencia guardada por contacto;
--   · un método de cobro con su intermediario.
-- Las liquidaciones registradas o apuntadas después siguen siendo liquidaciones
-- (channel_settlement es de antes): no se tocan.

do $$ begin
  if to_regclass('public.platform_store_cambio') is not null
     and (xpath('/row/n/text()', query_to_xml('select count(*) n from public.platform_store_cambio where decided_at is not null', false, true, '')))[1]::text::int > 0 then
    raise exception 'VUELTA ATRÁS 2253: hay cambios de tienda ya decididos; no se pierden en silencio.';
  end if;
  if to_regclass('public.platform_store_tramo') is not null
     and (xpath('/row/n/text()', query_to_xml('select count(*) n from public.platform_store_tramo where valid_from is not null', false, true, '')))[1]::text::int > 0 then
    raise exception 'VUELTA ATRÁS 2253: hay tiendas con tramos con fecha (cambiadas); no se pierden en silencio.';
  end if;
  if exists (select 1 from public.platform_store where external_id is not null) then
    raise exception 'VUELTA ATRÁS 2253: hay tiendas que ya saben su ID de la plataforma; no se pierde en silencio.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_liquidacion_resolucion' and column_name = 'arrived_on')
     and (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_liquidacion_resolucion where arrived_on is not null or party_id is not null', false, true, '')))[1]::text::int > 0 then
    raise exception 'VUELTA ATRÁS 2253: hay reclamaciones llegadas o diferencias por contacto; no se pierden en silencio.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_method' and column_name = 'party_id')
     and (xpath('/row/n/text()', query_to_xml('select count(*) n from public.payment_method where party_id is not null', false, true, '')))[1]::text::int > 0 then
    raise exception 'VUELTA ATRÁS 2253: hay métodos de cobro con su intermediario; no se pierden en silencio.';
  end if;
end $$;

drop function if exists public.conta_liquidaciones(uuid, date, date);
drop function if exists public._conta_periodo_de(text, date);
drop function if exists public.conta_reclamacion_llegada(uuid, date, numeric, text, text);
drop function if exists public.conta_liquidacion_resolver(uuid, uuid, uuid, date, date, text, numeric, text, date, jsonb, text);
drop function if exists public.conta_liquidacion_apuntar(uuid, jsonb, text);
drop function if exists public._conta_liquidacion_factura_enganchar(uuid);
drop function if exists public._conta_intermediario_de(uuid, uuid, uuid);
drop function if exists public.conta_intermediario_asegurar(uuid, text, uuid, text, text, text);
drop function if exists public.conta_tienda_cambio_decidir(uuid, boolean, uuid, uuid, date, text);
drop function if exists public.conta_tienda_reconocer(uuid, text, text, text, uuid, text);
drop function if exists public._conta_tienda_nombre(text);
drop function if exists public._conta_tienda_direccion(text);
drop function if exists public.conta_tienda_en(uuid, date);

drop table if exists public.platform_store_cambio;
drop table if exists public.platform_store_tramo;
drop table if exists public.platform_store_alias;

alter table public.payment_method drop column if exists party_id;
alter table public.conta_liquidacion_resolucion drop column if exists arrived_by_name;
alter table public.conta_liquidacion_resolucion drop column if exists arrived_note;
alter table public.conta_liquidacion_resolucion drop column if exists arrived_amount;
alter table public.conta_liquidacion_resolucion drop column if exists arrived_on;
alter table public.conta_liquidacion_resolucion drop column if exists party_id;
