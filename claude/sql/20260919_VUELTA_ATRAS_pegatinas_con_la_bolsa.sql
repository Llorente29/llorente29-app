-- ---------------------------------------------------------------------------
-- VUELTA ATRÁS de 20260919T1530_las_pegatinas_salen_con_la_bolsa.sql
--
-- Escrita ANTES de aplicar el cambio, no después.
--
-- Devuelve las dos funciones EXACTAMENTE a lo que está desplegado hoy
-- 19/09/2026 a las 15:00. No es una reconstrucción a partir del fichero de
-- migración: es `pg_get_functiondef` de la base, copiado tal cual. Sus md5:
--   tg_auto_print_on_accept      ec875f94cb19cdc1eca148c646fcff72
--   tg_auto_print_bag_on_ready   e5cd73be1ec8530b8afdb305c5b64253
-- y las dos guardas de abajo comprueban que se ha vuelto justo a eso.
--
-- CUÁNDO USARLA: si tras aplicar, un pedido nuevo de Alcalá no saca cocina,
-- o no saca bolsa, o salen pegatinas duplicadas. Es un `create or replace`:
-- tarda lo que tarde un commit y no toma cierre de ninguna tabla.
--
-- QUÉ NO DESHACE, y hay que saberlo: los `print_job` que ya se hayan
-- encolado con el comportamiento nuevo siguen encolados. Si hace falta,
-- se anulan a mano con su id; esta vuelta atrás no borra filas a ciegas.
-- ---------------------------------------------------------------------------

begin;

CREATE OR REPLACE FUNCTION public.tg_auto_print_on_accept()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_printer record; v_doc text; v_i int;
  v_fire boolean := false;
  v_bag_on_ready boolean := false;
begin
  if new.order_status = 'accepted' then
    if TG_OP = 'INSERT' then v_fire := true;
    elsif old.order_status is distinct from new.order_status then v_fire := true;
    end if;
  end if;

  if v_fire then
    begin
      select coalesce(k.bag_on_ready, false) into v_bag_on_ready
      from kitchen_time_config k where k.location_id = new.location_id;
      v_bag_on_ready := coalesce(v_bag_on_ready, false);

      if not exists (
        select 1 from printer
        where account_id = new.account_id and location_id = new.location_id and is_active
      ) then
        -- Fallo mudo evitado (11/08): sin esto, el pedido se acepta y JAMAS
        -- imprime nada, sin que nadie se entere. Dedup: 1 rastro por local
        -- cada 30min, no uno por pedido.
        insert into print_route_failure_log (account_id, location_id, sale_id, doc_type, detail)
        select new.account_id, new.location_id, new.id, null,
               'tg_auto_print_on_accept: sin impresoras activas en el local'
        where not exists (
          select 1 from print_route_failure_log
          where location_id = new.location_id
            and detail = 'tg_auto_print_on_accept: sin impresoras activas en el local'
            and created_at >= now() - interval '30 minutes'
        );
      end if;

      for v_printer in
        select id, doc_types, copies from printer
        where account_id = new.account_id and location_id = new.location_id and is_active
      loop
        foreach v_doc in array v_printer.doc_types loop
          -- La BOLSA se salta aqui SOLO si este local imprime bolsa al "Listo".
          if not (v_doc = 'bag' and v_bag_on_ready)
             and not exists (
               select 1 from print_job pj
               where pj.sale_id = new.id and pj.source = 'auto'
                 and pj.doc_type = v_doc and pj.printer_id = v_printer.id
             ) then
            for v_i in 1..greatest(1, coalesce(v_printer.copies, 1)) loop
              insert into print_job (account_id, location_id, printer_id, sale_id, doc_type, payload, source, status)
              values (new.account_id, new.location_id, v_printer.id, new.id, v_doc,
                      jsonb_build_object('sale_id', new.id, 'mode', 'by_order'), 'auto', 'pending');
            end loop;
          end if;
        end loop;
      end loop;
    exception when others then
      -- Antes: `null` — se tragaba CUALQUIER error en silencio absoluto.
      raise warning 'tg_auto_print_on_accept: fallo inesperado para sale %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_auto_print_bag_on_ready()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_printer record; v_i int; v_on boolean := false;
begin
  if new.order_status = 'awaiting_collection'
     and old.order_status is distinct from new.order_status then
    begin
      select coalesce(k.bag_on_ready, false) into v_on
      from kitchen_time_config k where k.location_id = new.location_id;
      if not coalesce(v_on, false) then return new; end if;

      if not exists (
        select 1 from printer
        where account_id = new.account_id and location_id = new.location_id
          and is_active and 'bag' = any(doc_types)
      ) then
        insert into print_route_failure_log (account_id, location_id, sale_id, doc_type, detail)
        select new.account_id, new.location_id, new.id, 'bag',
               'tg_auto_print_bag_on_ready: bag_on_ready activo pero sin impresora activa con doc_type bag'
        where not exists (
          select 1 from print_route_failure_log
          where location_id = new.location_id
            and detail = 'tg_auto_print_bag_on_ready: bag_on_ready activo pero sin impresora activa con doc_type bag'
            and created_at >= now() - interval '30 minutes'
        );
      end if;

      for v_printer in
        select id, copies from printer
        where account_id = new.account_id and location_id = new.location_id
          and is_active and 'bag' = any(doc_types)
      loop
        if not exists (
          select 1 from print_job pj
          where pj.sale_id = new.id and pj.source = 'auto'
            and pj.doc_type = 'bag' and pj.printer_id = v_printer.id
        ) then
          for v_i in 1..greatest(1, coalesce(v_printer.copies, 1)) loop
            insert into print_job (account_id, location_id, printer_id, sale_id, doc_type, payload, source, status)
            values (new.account_id, new.location_id, v_printer.id, new.id, 'bag',
                    jsonb_build_object('sale_id', new.id, 'mode', 'by_order'), 'auto', 'pending');
          end loop;
        end if;
      end loop;
    exception when others then
      raise warning 'tg_auto_print_bag_on_ready: fallo inesperado para sale %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

-- ── GUARDA: se ha vuelto EXACTAMENTE a lo que había ──────────────────
do $$
declare v_md5 text;
begin
  select md5(pg_get_functiondef(p.oid)) into v_md5
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='tg_auto_print_on_accept';
  if v_md5 is distinct from 'ec875f94cb19cdc1eca148c646fcff72' then
    raise exception 'vuelta atras INCOMPLETA en tg_auto_print_on_accept: md5 %', coalesce(v_md5,'(no existe)');
  end if;

  select md5(pg_get_functiondef(p.oid)) into v_md5
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='tg_auto_print_bag_on_ready';
  if v_md5 is distinct from 'e5cd73be1ec8530b8afdb305c5b64253' then
    raise exception 'vuelta atras INCOMPLETA en tg_auto_print_bag_on_ready: md5 %', coalesce(v_md5,'(no existe)');
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
