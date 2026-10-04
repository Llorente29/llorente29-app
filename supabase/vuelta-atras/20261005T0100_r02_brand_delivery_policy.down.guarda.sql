-- Guarda de 20261005T0100_r02_brand_delivery_policy.down.sql: si en
-- brand_delivery_policy hay decisiones de personas (manual) o aceptadas de la
-- IA (ai_accepted), quitar la tabla las perdería: para sin tocar nada. SOLO LEE.
do $$
declare n int;
begin
  if to_regclass('public.brand_delivery_policy') is not null then
    execute 'select count(*) from public.brand_delivery_policy where source <> ''migrated''' into n;
    if n > 0 then
      raise exception 'VUELTA ATRÁS 0100 (R02): hay % celdas decididas por personas o aceptadas de la IA; quitar la tabla las perdería. No se toca nada.', n;
    end if;
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosrc like '%resolve_delivery_by%'
                and p.proname not in ('resolve_delivery_by', 'reparto_guardar_celda', 'reparto_cambiar_desde_pedido')) then
    raise exception 'VUELTA ATRÁS 0100 (R02): todavía hay funciones que leen resolve_delivery_by. Primero las vueltas atrás de 0140, 0130 y 0120. No se toca nada.';
  end if;
end $$;
