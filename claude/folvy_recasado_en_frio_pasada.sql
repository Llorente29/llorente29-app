-- ============================================================================
-- LA PASADA del recasado en frio — el script que se ejecuta a mano
-- ----------------------------------------------------------------------------
-- 22/09/2026. Cuenta Foodint 51ad1792-6629-4ef7-833a-b57b09a86710.
-- Requiere `supabase/migrations/20260923T0130_recasado_en_frio.sql` aplicada.
--
-- CORRIDA el 23/09/2026 a las 00:08 (Madrid) — Julio: «pasa el recasado ahora
-- en frio». Hueco medido: 0 pedidos en 20 min, el ultimo a las 23:16. Pasada
-- en seco primero (463 casadas, C1/C2/C3 en verde), luego con commit, y
-- verificado sobre lo vivo. 463 lineas / 5.457,01 EUR, CERO movimientos de
-- stock. Si se vuelve a correr, no repite: `on conflict (sale_line_id)`.
--
-- ESTO NO ES UNA MIGRACION: es una OPERACION, y se ejecuta con alguien
-- delante. Va fuera de servicio (nunca entre 12:15 y 23:45) y con hueco
-- medido, por dos motivos distintos:
--   1. `ALTER TABLE ... DISABLE TRIGGER` toma SHARE ROW EXCLUSIVE sobre
--      `sale_line`: un pedido que entrase ESPERA a que acabe.
--   2. Mientras dura, el disparador esta desarmado PARA TODAS LAS SESIONES.
--      Medido: el consumo al cerrar vive en `sale` (trg_sale_consumption_on_
--      complete), no en `sale_line`, y `generate_sale_consumption` borra y
--      regenera, asi que es idempotente. Un pedido que se colase se REPARA
--      SOLO en su siguiente cambio de estado. La exposicion real es un pedido
--      cuyas lineas entren en la ventana y cuyo estado no cambie nunca mas.
--      Por eso se mide el hueco igual, pero el riesgo no es catastrofico.
--
-- EL FALLO QUE HAY QUE TEMER: que esto se commitee con el disparador
-- desarmado. Folvy dejaria de descontar PARA SIEMPRE y en silencio — no
-- fallaria nada, simplemente el almacen no se moveria. Por eso el bloque
-- final comprueba `tgenabled = 'O'` y ABORTA la transaccion entera si no lo
-- esta, y por eso hay una comprobacion mas DESPUES del commit, que no se
-- salta con el color del resultado (leccion del 16/09).
-- ============================================================================

-- ── PASO 0 · ANTES de abrir nada: medir el hueco ──────────────────────────
-- Se ejecuta SOLO y se mira con los ojos. Si no sale limpio, se para aqui.
select to_char(now() at time zone 'Europe/Madrid','DD/MM HH24:MI') as madrid,
       (select count(*) from public.sale
         where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
           and sold_at >= now() - interval '20 minutes')            as pedidos_20min,
       to_char((select max(sold_at) from public.sale
                 where account_id='51ad1792-6629-4ef7-833a-b57b09a86710')
               at time zone 'Europe/Madrid','HH24:MI')              as ultimo_pedido,
       (select count(*) from public.sale
         where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
           and coalesce(order_status,'') not in ('completed','cancelled','rejected')
           and sold_at >= now() - interval '6 hours')               as pedidos_sin_cerrar;
-- Exigido: hora >= 23:45 Madrid y pedidos_20min = 0.
-- `pedidos_sin_cerrar` es INFORMATIVO, no un veto: el 22/09 a las 23:49 habia
-- 13 en `awaiting_collection` esperando rider, que es normal a esa hora y no
-- se van a cero. Exigir cero aqui era una guarda que nunca se podria cumplir,
-- y una guarda que no se cumple nunca acaba saltandose a mano. Lo que importa
-- es que no ENTREN pedidos nuevos, y eso lo mide `pedidos_20min`.
-- Si alguno lleva horas sin moverse, eso es otro problema (el del 10/09) y se
-- mira antes de seguir.

-- ── PASO 1 · EN SECO, con el disparador ARMADO ────────────────────────────
-- No escribe nada. Da las cifras que tienen que cuadrar con el paso 3.
select * from public.recasar_lastapp_en_frio(
  '51ad1792-6629-4ef7-833a-b57b09a86710', true, 30);

-- ── PASO 2 · LA PASADA, primero con ROLLBACK ──────────────────────────────
begin;

  -- Guarda dentro de la transaccion: si ha entrado un pedido desde el paso 0,
  -- aborta. El hueco se mide DOS veces a proposito.
  do $$
  declare v_n integer; v_h text;
  begin
    select count(*) into v_n from public.sale
     where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
       and sold_at >= now() - interval '20 minutes';
    v_h := to_char(now() at time zone 'Europe/Madrid','HH24:MI');
    if v_n > 0 then
      raise exception 'ABORTA: % pedidos en los ultimos 20 min (son las % en Madrid). '
                      'Desarmar el consumo con el servicio vivo cierra pedidos sin descontar.', v_n, v_h;
    end if;
    if v_h < '23:45' and v_h > '12:15' then
      raise exception 'ABORTA: son las % en Madrid, dentro de la banda de servicio.', v_h;
    end if;
  end $$;

  -- La huella de ANTES. Regla 31: la misma vara a los dos lados.
  create temporary table _antes on commit drop as
  select (select count(*) from public.stock_movement)                              as movimientos,
         (select count(*) from public.sale_line sl join public.sale s on s.id=sl.sale_id
           where sl.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
             and s.source='lastapp' and sl.map_source='unmapped')                  as sin_casar,
         (select count(*) from public.sale_line_recast_frio
           where account_id='51ad1792-6629-4ef7-833a-b57b09a86710')                as en_el_registro;

  alter table public.sale_line disable trigger trg_sale_line_consumption;

  select * from public.recasar_lastapp_en_frio(
    '51ad1792-6629-4ef7-833a-b57b09a86710', false, 30);

  alter table public.sale_line enable trigger trg_sale_line_consumption;

  -- ── LAS TRES COMPROBACIONES, y cualquiera de ellas aborta ───────────────
  do $$
  declare v_a record; v_mov integer; v_sin integer; v_reg integer; v_arm "char";
  begin
    select * into v_a from _antes;
    select count(*) into v_mov from public.stock_movement;
    select count(*) into v_sin from public.sale_line sl join public.sale s on s.id=sl.sale_id
      where sl.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
        and s.source='lastapp' and sl.map_source='unmapped';
    select count(*) into v_reg from public.sale_line_recast_frio
      where account_id='51ad1792-6629-4ef7-833a-b57b09a86710';
    select t.tgenabled into v_arm from pg_trigger t
      join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='sale_line' and t.tgname='trg_sale_line_consumption';

    -- C1 · EL STOCK NO SE HA MOVIDO. Es el motivo entero de esta pieza.
    if v_mov <> v_a.movimientos then
      raise exception 'C1 FALLA: stock_movement paso de % a %. Esto tenia que ser EN FRIO.',
        v_a.movimientos, v_mov;
    end if;

    -- C2 · cada linea recasada dejo constancia. Sin registro, el vigia del
    --      100 % las contaria como rotas y este arreglo le meteria ruido.
    if (v_a.sin_casar - v_sin) <> (v_reg - v_a.en_el_registro) then
      raise exception 'C2 FALLA: se casaron % lineas pero el registro crecio en %.',
        v_a.sin_casar - v_sin, v_reg - v_a.en_el_registro;
    end if;

    -- C3 · EL DISPARADOR ESTA ARMADO OTRA VEZ. El fallo caro.
    if v_arm <> 'O' then
      raise exception 'C3 FALLA: trg_sale_line_consumption quedo en %. NO SE COMMITEA.', v_arm;
    end if;

    raise notice 'C1 ok (stock quieto en %) · C2 ok (% lineas, % en registro) · C3 ok (armado)',
      v_mov, v_a.sin_casar - v_sin, v_reg - v_a.en_el_registro;
  end $$;

rollback;
-- Se lee la salida. Si C1, C2 y C3 dan ok, se repite el PASO 2 con `commit`.

-- ── PASO 3 · DESPUES DEL COMMIT, sobre lo vivo ────────────────────────────
-- No se da por bueno con el color del resultado (16/09). Se mira la base.
select (select tgenabled from pg_trigger t
         join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname='sale_line'
          and t.tgname='trg_sale_line_consumption')                  as disparador_debe_ser_O,
       (select count(*) from public.sale_line_recast_frio
         where account_id='51ad1792-6629-4ef7-833a-b57b09a86710')    as lineas_recasadas,
       (select round(sum(line_total),2) from public.sale_line_recast_frio
         where account_id='51ad1792-6629-4ef7-833a-b57b09a86710')    as euros_recuperados,
       (select count(*) from public.sale_line sl join public.sale s on s.id=sl.sale_id
         where sl.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
           and s.source='lastapp' and sl.map_source='unmapped')      as siguen_sin_casar;

-- Y la prueba de que el consumo VUELVE a funcionar: el primer pedido que entre
-- tiene que generar movimientos. Esto se mira al abrir, no se supone.
select s.pos_short_code,
       to_char(s.sold_at at time zone 'Europe/Madrid','DD/MM HH24:MI') as cuando,
       (select count(*) from public.stock_movement sm where sm.source_id = s.id) as movimientos
from public.sale s
where s.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
  and s.sold_at > now()
order by s.sold_at limit 5;
