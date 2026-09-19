-- ---------------------------------------------------------------------------
-- 19/09/2026 — Las pegatinas dejan de salir al entrar el pedido
--
-- Julio: «ayer fue mucho caos por no ser bueno el sistema».
--
-- UN SOLO CAMBIO: las pegatinas de artículo pasan a encolarse en el MISMO
-- momento en que ya se encola el ticket de bolsa. No se inventa ningún
-- disparador: el de la bolsa ya está escrito y funcionando desde el 11/08.
--
-- La cocina NO se toca: necesita su ticket en cuanto entra el pedido.
--
-- ─────────────────────────────────────────────────────────────────────
-- POR QUÉ ASÍ: las pegatinas VIAJAN CON LA BOLSA, no a una hora nueva
-- ─────────────────────────────────────────────────────────────────────
-- `bag_on_ready` es por local y decide cuándo sale la bolsa. Las pegatinas
-- se enganchan a esa misma decisión:
--   · local con bag_on_ready = true  → la bolsa sale al «Listo», y las
--     pegatinas con ella;
--   · local con bag_on_ready = false → la bolsa sale al entrar, y las
--     pegatinas siguen saliendo al entrar, como hoy.
-- Así no hay un tercer momento que explicar, y ningún local cambia de
-- comportamiento sin que su bolsa cambie con él.
--
-- MEDIDO EL 19/09, a quién afecta esto de verdad:
--
--   local                 impresora   doc_types            activa  bag_on_ready
--   Foodint Alcalá        Cocina      {kitchen}              sí       true
--   Foodint Alcalá        Pase        {bag}                  sí       true
--   Foodint Alcalá        Pegatina    {labels}               sí       true   ← el caso
--   Foodint Carabanchel   Cocina      {bag,kitchen,labels}   NO       false
--   Foodint Carabanchel   Impre       {kitchen,bag}          sí       false  ← sin labels: intacto
--   Foodint Plaza Castilla NT311      {bag,kitchen,labels}   sí       false  ← 0 impresiones en 7 días
--
--   · Las 528 pegatinas de los últimos 7 días son TODAS de Alcalá.
--   · Carabanchel no se activa: su impresora viva no tiene `labels`.
--   · Plaza Castilla tiene `labels` pero `bag_on_ready` = false, así que
--     para él no cambia nada (su bolsa también sale al entrar).
--
--   segundos tras entrar el pedido, 7 días, source='auto':
--     kitchen   0 s   ← no se toca
--     labels    1 s   ← lo que se mueve
--     bag     756 s (Alcalá 1.291 s)
--
-- ─────────────────────────────────────────────────────────────────────
-- LO QUE HAY QUE CUIDAR, comprobado uno por uno
-- ─────────────────────────────────────────────────────────────────────
-- 1 · LA REIMPRESIÓN SIGUE FUNCIONANDO, y no hace falta tocarla.
--     `reprint_order(p_sale_id, p_doc_type)` recorre `printer.doc_types`
--     genéricamente y no depende de estos disparadores para nada: con
--     p_doc_type='labels' saca las pegatinas en la impresora Pegatina.
--     Leído hoy en la definición viva. 12 reimpresiones de bolsa en 7 días:
--     alguien las usa y va a seguir pudiendo.
--
-- 2 · NO SE ENCOLAN DOS VECES si el pedido se cierra, se reabre y se
--     vuelve a cerrar. La guarda es la de siempre —`not exists` por
--     (sale_id, source='auto', doc_type, printer_id)— y ahora se evalúa
--     POR CADA doc_type, no una vez para la bolsa.
--
-- 3 · CARABANCHEL NO SE ACTIVA. Su impresora viva no tiene `labels` en
--     `doc_types`, así que el bucle no llega a producir ninguna.
--
-- 4 · EL REGISTRO DE FALLO MUDO SE QUEDA COMO ESTÁ, a propósito. Hoy avisa
--     cuando `bag_on_ready` está activo y no hay impresora de bolsa; eso
--     sigue cubriendo el caso nuevo, porque si no hay bolsa tampoco hay
--     pegatinas. Añadir un aviso de «sin impresora de labels» gritaría en
--     todos los locales que no llevan pegatinas, que es la mayoría.
--
-- 5 · LO QUE SE PIERDE, dicho con su número: un pedido que se acepta y
--     NUNCA llega a «Listo» ya no saca pegatinas solo. En Alcalá, 7 días:
--     528 aceptados, 510 llegaron a bolsa, **18 no (3,4 %)** — estados
--     accepted, cancelled, completed y delivery_failed. Para esos, las
--     pegatinas se sacan por la reimpresión, que es lo que dice el encargo.
--
-- ─────────────────────────────────────────────────────────────────────
-- LA BANDA DE SERVICIO — esto SÍ está en el camino del pedido
-- ─────────────────────────────────────────────────────────────────────
-- Condición 1 de la banda: NO se cumple. Son dos funciones de disparador
-- sobre `sale`. Se dice, no se esconde.
-- Condición 2: sí se cumple. Un `create or replace` de función no toma
-- cierre sobre ninguna tabla.
-- Condición 3: esto es el «se dice antes».
--
-- Lo que acota el daño, y se puede leer en el código: **todo el cuerpo de
-- las dos funciones va dentro de un `begin … exception when others then
-- raise warning … end`**. Si este cambio fallara, el pedido se acepta
-- igual y lo que se pierde es la impresión, no la venta. No es el caso del
-- 10/09, donde la excepción se llevaba la transacción entera por delante.
--
-- Aun así: LA APLICA JULIO, no yo, y con el hueco medido.
-- ---------------------------------------------------------------------------

begin;

-- ── GUARDA DE DERIVA ────────────────────────────────────────────────
-- Lo desplegado hoy es, byte a byte, la migración 20260811094226.
-- Si alguien lo ha cambiado entre que escribo esto y que se ejecuta, para.
do $$
declare v_md5 text;
begin
  select md5(pg_get_functiondef(p.oid)) into v_md5
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='tg_auto_print_on_accept';
  if v_md5 is distinct from 'ec875f94cb19cdc1eca148c646fcff72' then
    raise exception 'DERIVA en tg_auto_print_on_accept: esperaba ec875f94… y hay %. Parar y mirar qué se desplegó.', coalesce(v_md5,'(no existe)');
  end if;

  select md5(pg_get_functiondef(p.oid)) into v_md5
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='tg_auto_print_bag_on_ready';
  if v_md5 is distinct from 'e5cd73be1ec8530b8afdb305c5b64253' then
    raise exception 'DERIVA en tg_auto_print_bag_on_ready: esperaba e5cd73be… y hay %. Parar y mirar qué se desplegó.', coalesce(v_md5,'(no existe)');
  end if;
end $$;

-- ── 1 · AL ENTRAR: las pegatinas se saltan igual que la bolsa ────────
-- Cambia UNA línea respecto a lo desplegado. Todo lo demás es idéntico.
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
          -- La BOLSA y las PEGATINAS se saltan aqui SOLO si este local
          -- imprime bolsa al "Listo" (19/09): las pegatinas viajan con la
          -- bolsa. La COCINA nunca se salta: la necesita al entrar.
          if not (v_doc = any (array['bag','labels']) and v_bag_on_ready)
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

-- ── 2 · AL «LISTO»: sale la bolsa y salen las pegatinas ──────────────
-- El nombre se queda (renombrar obligaria a tocar el disparador y eso si
-- es riesgo); lo que hace ahora es "el papel del pase", no solo la bolsa.
CREATE OR REPLACE FUNCTION public.tg_auto_print_bag_on_ready()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_printer record; v_doc text; v_i int; v_on boolean := false;
begin
  if new.order_status = 'awaiting_collection'
     and old.order_status is distinct from new.order_status then
    begin
      select coalesce(k.bag_on_ready, false) into v_on
      from kitchen_time_config k where k.location_id = new.location_id;
      if not coalesce(v_on, false) then return new; end if;

      -- El rastro de fallo mudo se queda MIRANDO LA BOLSA a proposito: si no
      -- hay impresora de bolsa tampoco va a haber pegatinas, y un aviso de
      -- "sin impresora de labels" gritaria en todos los locales que no
      -- llevan pegatinas, que son la mayoria.
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
        select id, doc_types, copies from printer
        where account_id = new.account_id and location_id = new.location_id
          and is_active and doc_types && array['bag','labels']::text[]
      loop
        -- Orden fijo: primero la bolsa, luego las pegatinas.
        foreach v_doc in array array['bag','labels']::text[] loop
          if v_doc = any (v_printer.doc_types)
             and not exists (
               -- La MISMA guarda de siempre, ahora por doc_type: cerrar,
               -- reabrir y volver a cerrar no encola nada dos veces.
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
      raise warning 'tg_auto_print_bag_on_ready: fallo inesperado para sale %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

-- ── GUARDAS DE SALIDA ───────────────────────────────────────────────
do $$
declare n int;
begin
  -- Regla 2: replace no crea sobrecargas si la firma no cambia, y no ha
  -- cambiado. Se comprueba en vez de suponerlo.
  select count(*) into n from pg_proc
   where pronamespace='public'::regnamespace and proname='tg_auto_print_on_accept';
  if n <> 1 then raise exception 'guarda: se esperaba 1 tg_auto_print_on_accept, hay %', n; end if;

  select count(*) into n from pg_proc
   where pronamespace='public'::regnamespace and proname='tg_auto_print_bag_on_ready';
  if n <> 1 then raise exception 'guarda: se esperaba 1 tg_auto_print_bag_on_ready, hay %', n; end if;

  -- Los disparadores siguen enganchados donde estaban.
  select count(*) into n from pg_trigger t
   join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     and p.proname in ('tg_auto_print_on_accept','tg_auto_print_bag_on_ready');
  if n < 2 then raise exception 'guarda: esperaba al menos 2 disparadores enganchados, hay %', n; end if;
end $$;

commit;

notify pgrst, 'reload schema';
