-- ENSAYO de 20260925T0100_el_ultimo_plato_tambien_descuenta.sql
-- Todo dentro de UN bloque que termina en RAISE EXCEPTION: no queda nada
-- escrito (ni la función auxiliar de pg_temp, ni el disparador nuevo, ni un
-- solo movimiento). El resultado viaja en el mensaje del error.
--
-- Ingesta REAL, no inventada (regla 31): se re-adapta con adapt_lastapp_order,
-- que borra y re-inserta las líneas en el orden que traía el pedido, igual que
-- cuando Last reenvía un pedido.
--   U093  01bff565-...  abierto · el extra del último plato (Sweet Chili T)
--   U622  35773fc0-...  cerrado · un único producto y es COMBO; vendido 24/09
--                       22:50, después del recuento de las 20:36 (sin corte)
--
-- E1  disparador de HOY    → re-adaptar → lo asentado contra lo que pide el motor
-- E2  disparador DIFERIDO  → re-adaptar → SET CONSTRAINTS ALL IMMEDIATE
--                            (lo mismo que hace el COMMIT) → lo mismo
-- E3  una pasada por venta → marcas que deja el disparador (= llamadas a generate)
-- E4  enclavamiento del recasado en frío: desarmar → cambiar menu_item_id →
--     rearmar → commit simulado → el consumo NO se mueve
-- E5  el cierre sobre lo ya asentado → generate no cambia nada (guarda FV001)

do $ensayo$
declare
  v_u093 constant uuid := '01bff565-271f-4ee8-b993-7c95003cd529';
  v_u622 constant uuid := '35773fc0-2f20-4504-b39b-a6fb548e0b8d';
  v_out  text := '';
  v_id   uuid;
  v_hijo uuid; v_menu uuid;
  v_a text; v_b text; v_n int;
begin
  -- Auxiliar de lectura: lo que falta o sobra en una venta, comparando lo que
  -- pide el motor HOY con lo asentado. Vive en pg_temp y muere con el rollback.
  execute $f$
    create function pg_temp.dif(p uuid) returns text language sql as $q$
      with pide as (
        select r.raw_item_id i, sum(r.qty_base) q from public.sale_line sl
        cross join lateral public._sale_line_raw_consumption(sl.id) r
        where sl.sale_id=p and coalesce(sl.line_type,'product')='product' and sl.ignored_at is null
          and r.raw_item_id is not null group by 1 having sum(r.qty_base)<>0),
      tiene as (
        select sm.recipe_item_id i, -sum(sm.qty_base) q from public.stock_movement sm
        join public.sale s on s.id=p and s.account_id=sm.account_id
        where sm.source_type='sale' and sm.movement_type='consumo' and sm.source_id=p group by 1)
      select format('%s movs · %s ingr pedidos · faltan/sobran: %s',
        (select count(*) from public.stock_movement sm join public.sale s on s.id=p and s.account_id=sm.account_id
          where sm.source_type='sale' and sm.movement_type='consumo' and sm.source_id=p),
        (select count(*) from pide),
        coalesce((select string_agg(ri.name||' pide '||round(coalesce(pi.q,0),1)||' tiene '||round(coalesce(t.q,0),1), '; ' order by ri.name)
           from pide pi full join tiene t on t.i=pi.i join public.recipe_item ri on ri.id=coalesce(pi.i,t.i)
          where abs(coalesce(pi.q,0)-coalesce(t.q,0))>0.0001), 'NADA'))
    $q$ $f$;

  foreach v_id in array array[v_u093, v_u622] loop
    v_out := v_out || format(E'\n[%s] ANTES   %s', left(v_id::text,4), pg_temp.dif(v_id));
  end loop;

  -- ══ E1 · disparador de hoy, ingesta real ═════════════════════════════════
  foreach v_id in array array[v_u093, v_u622] loop
    perform public.adapt_lastapp_order(v_id);
    v_out := v_out || format(E'\n[%s] E1 hoy  %s', left(v_id::text,4), pg_temp.dif(v_id));
  end loop;

  -- ══ La migración, literal (sin begin/commit) ═════════════════════════════
  execute $m$
create or replace function public.tg_sale_line_consumption()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_sale_id uuid; v_sale record; v_n integer; v_state text; v_msg text;
  v_huella  text; v_marca text; v_hechas text;
begin
  v_sale_id := new.sale_id;
  if v_sale_id is null then return null; end if;
  select id, status, order_status, is_active into v_sale
    from public.sale where id = v_sale_id;
  if not found then return null; end if;
  if coalesce(v_sale.status,'') = 'cancelled'
     or coalesce(v_sale.order_status,'') in ('cancelled','rejected')
     or not coalesce(v_sale.is_active, true) then
    return null;
  end if;
  select md5(coalesce(string_agg(
           sl.id::text || '|' || coalesce(sl.line_type,'') || '|'
           || coalesce(sl.parent_sale_line_id::text,'') || '|'
           || coalesce(sl.menu_item_id::text,'') || '|'
           || coalesce(sl.modifier_option_id::text,'') || '|'
           || coalesce(sl.quantity::text,'') || '|'
           || coalesce(sl.ignored_at::text,''),
           ',' order by sl.id), ''))
    into v_huella
    from public.sale_line sl where sl.sale_id = v_sale_id;
  v_marca  := v_sale_id::text || ':' || v_huella;
  v_hechas := coalesce(current_setting('folvy.consumo_lineas_hecho', true), '');
  if strpos(v_hechas, v_marca) > 0 then
    return null;
  end if;
  v_n := public.generate_sale_consumption(v_sale_id);
  perform set_config('folvy.consumo_lineas_hecho', v_hechas || ' ' || v_marca, true);
  perform public._resolver_fallo_de_consumo(v_sale_id, v_n);
  return null;
exception when others then
  v_state := sqlstate;
  v_msg   := sqlerrm;
  begin
    perform public._registrar_fallo_de_consumo(v_sale_id, v_state, v_msg);
  exception when others then
    raise warning 'tg_sale_line_consumption: no se pudo apuntar el fallo de la venta % : %',
      v_sale_id, sqlerrm;
  end;
  if v_marca is not null then
    perform set_config('folvy.consumo_lineas_hecho',
                       coalesce(v_hechas,'') || ' ' || v_marca, true);
  end if;
  raise warning 'tg_sale_line_consumption: venta % : %', v_sale_id, v_msg;
  return null;
end;
$fn$;
  $m$;
  execute 'drop trigger if exists trg_sale_line_consumption on public.sale_line';
  execute $t$create constraint trigger trg_sale_line_consumption
    after insert or update of menu_item_id on public.sale_line
    deferrable initially deferred
    for each row execute function public.tg_sale_line_consumption()$t$;

  -- ══ E2 · diferido, misma ingesta real ════════════════════════════════════
  perform set_config('folvy.consumo_lineas_hecho', '', true);
  foreach v_id in array array[v_u093, v_u622] loop
    perform public.adapt_lastapp_order(v_id);
    v_out := v_out || format(E'\n[%s] E2 antes del commit  %s', left(v_id::text,4), pg_temp.dif(v_id));
  end loop;
  set constraints all immediate;   -- lo que hace el COMMIT
  set constraints all deferred;
  foreach v_id in array array[v_u093, v_u622] loop
    v_out := v_out || format(E'\n[%s] E2 tras el commit   %s', left(v_id::text,4), pg_temp.dif(v_id));
  end loop;

  -- ══ E3 · cuántas pasadas por venta ═══════════════════════════════════════
  foreach v_id in array array[v_u093, v_u622] loop
    select count(*) into v_n
      from regexp_split_to_table(current_setting('folvy.consumo_lineas_hecho', true), ' ') m
     where m like v_id::text || ':%';
    select count(*) into v_a from public.sale_line where sale_id = v_id;
    v_out := v_out || format(E'\n[%s] E3 %s lineas insertadas -> %s pasada(s) de generate',
                             left(v_id::text,4), v_a, v_n);
  end loop;

  -- ══ E4 · enclavamiento del recasado en frío ══════════════════════════════
  -- Se desengancha el primer hijo del combo U622 con el disparador DESARMADO,
  -- se rearma y se simula el commit. Si el evento se hubiera encolado, el hijo
  -- dejaría de descontar y E4 enseñaría «sobran».
  select sl.id, sl.menu_item_id into v_hijo, v_menu from public.sale_line sl
   where sl.sale_id = v_u622 and sl.line_type = 'combo_item' and sl.menu_item_id is not null
   order by sl.id limit 1;
  v_a := pg_temp.dif(v_u622);
  execute 'alter table public.sale_line disable trigger trg_sale_line_consumption';
  update public.sale_line set menu_item_id = null where id = v_hijo;
  execute 'alter table public.sale_line enable trigger trg_sale_line_consumption';
  set constraints all immediate;
  set constraints all deferred;
  select count(*) into v_n from public.stock_movement sm
   where sm.source_type='sale' and sm.movement_type='consumo' and sm.source_id=v_u622;
  v_out := v_out || format(E'\n[U622] E4 desarmado: %s movs (antes %s)', v_n, split_part(v_a,' ',1));
  -- y el contraste: armado, el mismo cambio SÍ recalcula
  update public.sale_line set menu_item_id = v_menu where id = v_hijo;
  set constraints all immediate;
  set constraints all deferred;
  v_out := v_out || format(E'\n[U622] E4 rearmado y devuelto: %s', pg_temp.dif(v_u622));

  -- ══ E5 · el cierre sobre lo ya asentado ══════════════════════════════════
  select md5(string_agg(sm.id::text, ',' order by sm.id)) into v_a
    from public.stock_movement sm where sm.source_type='sale' and sm.movement_type='consumo' and sm.source_id=v_u093;
  perform public.generate_sale_consumption(v_u093);
  select md5(string_agg(sm.id::text, ',' order by sm.id)) into v_b
    from public.stock_movement sm where sm.source_type='sale' and sm.movement_type='consumo' and sm.source_id=v_u093;
  v_out := v_out || format(E'\n[U093] E5 cierre: mismos identificadores de movimiento = %s', v_a = v_b);

  raise exception 'ENSAYO (revertido): %', v_out;
end
$ensayo$;
