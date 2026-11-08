-- supabase/vuelta-atras/20261108T0930_g04_tarifa_y_clientes.down.sql
--
-- G04 · La vuelta atrás de la 0930: todo como antes. Fuera las vistas nuevas,
-- las funciones nuevas, las tablas nuevas (con lo que se haya escrito en ellas)
-- y las columnas nuevas de conta_linea y conta_gc_suscripcion. Lo importado en
-- el G01 no se tocó y no se toca.
--
-- Lo que un «Cambiar precios» aplicado hubiera cambiado en conta_tarifa (el
-- final de un precio importado) vuelve a como estaba con sus «efectos» antes de
-- borrar la tabla. Las líneas de conta_linea creadas con las funciones nuevas
-- («+ Añadir», «Cambiar de nivel») se quitan; las que cerró «Cambiar de nivel»
-- recuperan su final de antes.
-- sin prueba con datos: la prueba de staging (20261108_g04_tarifa_y_clientes_prueba.sql) la pasa en ROLLBACK, con datos inventados, y comprueba que todo queda como antes; el ensayo de producción la pasa entera, en ROLLBACK.

-- Lo que un «Cambiar precios» aplicado cerró en conta_tarifa, como estaba.
do $$
declare v_e jsonb; v_ref text;
begin
  if to_regclass('public.conta_cambio_precios') is null then return; end if;
  for v_e in select e from public.conta_cambio_precios c, jsonb_array_elements(c.efectos) e where c.estado = 'aplicado' order by c.aplicado_at desc loop
    v_ref := v_e->>'acaba';
    continue when v_ref is null or split_part(v_ref, ':', 1) <> 'tarifa';
    update public.conta_tarifa set hasta = (v_e->>'hastaAntes')::date where id = split_part(v_ref, ':', 2)::uuid;
  end loop;
end $$;

-- «Cambiar de nivel»: la línea cerrada recupera su final (el de la línea nueva), y la nueva se va.
do $$
declare r record;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_linea' and column_name = 'nivel_id') then return; end if;
  for r in select n.id as nueva, v.id as vieja, n.hasta
             from public.conta_linea n join public.conta_linea v
               on v.party_id = n.party_id and v.company_id = n.company_id and v.servicio_id = n.servicio_id and v.hasta = (n.desde - interval '1 month')::date
              and v.empleado_nombre is not distinct from n.empleado_nombre and v.detalle is not distinct from n.detalle
            where n.nivel_id is not null and n.origen = 'manual' loop
    update public.conta_linea set hasta = r.hasta where id = r.vieja;
  end loop;
  delete from public.conta_linea where nivel_id is not null;
end $$;

drop view if exists public.conta_consulta_que_hacer;
drop view if exists public.conta_consulta_cargo_devuelto;
drop view if exists public.conta_consulta_proximo_cobro;
drop view if exists public.conta_consulta_cliente_empresa;
drop view if exists public.conta_consulta_asignacion;
drop view if exists public.conta_consulta_tarifa_precio;

drop function if exists public.conta_gc_cobro_otra_via_quitar(uuid, text);
drop function if exists public.conta_gc_cobro_otra_via(uuid, text, text, date, text);
drop function if exists public.conta_tarifa_cambio_deshacer(uuid);
drop function if exists public.conta_tarifa_cambio_aplicar(uuid);
drop function if exists public.conta_tarifa_cambio_ensayar(uuid, jsonb, jsonb);
drop function if exists public.conta_tarifa_nivel_cambiar(uuid, uuid, date, boolean);
drop function if exists public.conta_tarifa_servicio_anadir(uuid, uuid, uuid, uuid, uuid, date, jsonb, boolean);
drop function if exists public.conta_tarifa_precio_guardar(uuid, uuid, uuid, uuid, uuid, text, text, numeric, jsonb, date, boolean);
drop function if exists public.conta_tarifa_paquete_guardar(uuid, uuid, text, text, numeric, jsonb, boolean);
drop function if exists public.conta_tarifa_nivel_guardar(uuid, uuid, uuid, text, integer, text[], boolean, boolean);
drop function if exists public.conta_gestoria_ajustes_guardar(uuid, text);
drop function if exists public._conta_precio_insertar(uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, jsonb, date, date, uuid, text);
drop function if exists public._conta_tarifa_nombre(uuid, uuid, uuid);
drop function if exists public._conta_tarifa_huella(uuid);
drop function if exists public._conta_tarifa_mes(date);
drop function if exists public._conta_tarifa_puede(uuid, boolean);

alter table public.conta_gc_suscripcion drop column if exists proximo_cobro_importe;
alter table public.conta_gc_suscripcion drop column if exists proximo_cobro_fecha;
alter table public.conta_linea drop column if exists baja_el;
alter table public.conta_linea drop column if exists alta_el;
alter table public.conta_linea drop column if exists nivel_id;

drop table if exists public.conta_gc_cobro_otra_via;
drop table if exists public.conta_cambio_precios_linea;
drop table if exists public.conta_cambio_precios;
drop table if exists public.conta_cliente_paquete;
drop table if exists public.conta_precio_tramo;
drop table if exists public.conta_precio;
drop table if exists public.conta_paquete_linea;
drop table if exists public.conta_paquete;
drop table if exists public.conta_servicio_nivel;
drop table if exists public.conta_gestoria_ajustes;
