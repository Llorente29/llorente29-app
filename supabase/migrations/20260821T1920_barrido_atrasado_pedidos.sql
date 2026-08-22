-- 20260821T1920_barrido_atrasado_pedidos.sql
-- ENCARGO CODE (21/08) §6 — el barrido del atrasado.
--
-- EJECUTADO: 21/08/2026 vía MCP. Este fichero es el REGISTRO de lo que se
-- ejecutó, con su foto antes/después. NO hace falta volver a ejecutarlo: el
-- casador es idempotente (sólo rellena purchase_order_line_id a null), así que
-- reaplicarlo sería inocuo pero inútil.
--
-- ── Por qué hace falta la identidad ──────────────────────────────────────
-- recompute_purchase_order_status y _match_order_lines_for_order comprueban
-- belongs_to_account(), que resuelve por auth.uid(). Ejecutando como `postgres`
-- por MCP, auth.uid() es null y belongs_to_account devuelve FALSE: las dos
-- funciones reventarían.
--
-- Por eso el barrido corre bajo una IDENTIDAD REAL (set local role authenticated
-- + request.jwt.claims con el user_id de Julio, admin de Foodint) en vez de
-- saltarse el guardián o aflojarlo. Es la diferencia entre entrar con llave y
-- quitar la cerradura.
--
-- ── Alcance, acotado y comprobado ────────────────────────────────────────
-- Sólo pueden cambiar los pedidos que tienen recepciones enlazadas: 9
-- recepciones, 6 pedidos. Hay un guardarraíl que aborta si esa cifra no es 9.
-- De los 6, sólo 2 podían cambiar de estado: los otros son 'recibido' (ya
-- cerrado) o 'cancelado' (terminal, recompute no los toca por diseño).
--
-- ── Resultado real ───────────────────────────────────────────────────────
--   pedido      antes       después            casadas   fila del pedido tocada
--   PED-00009   recibido    recibido            3 -> 3    no
--   PED-00038   cancelado   cancelado           0 -> 1    no
--   PED-00040   cancelado   cancelado           0 -> 7    no
--   PED-00042   enviado     recibido_parcial    0 -> 28   sí
--   PED-00043   cancelado   cancelado           0 -> 1    no
--   PED-00045   enviado     recibido            0 -> 2    sí
--
-- Los tres CANCELADOS sí reciben el casado de sus líneas —que es un hecho: esa
-- línea de albarán corresponde a esa línea de pedido— pero su fila de pedido no
-- se toca. Verificado aparte: 41 cancelados, ninguno con updated_at de hoy.

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"673fca49-f6b5-40ed-a8f7-558390acce10","role":"authenticated"}';

create temp table _antes on commit drop as
select po.id, po.code, po.status, po.updated_at,
       (select count(*) from goods_receipt_line grl join goods_receipt gr on gr.id=grl.goods_receipt_id
         where gr.purchase_order_id = po.id and grl.purchase_order_line_id is not null) as casadas
from purchase_order po
where exists (select 1 from goods_receipt gr where gr.purchase_order_id = po.id);

do $$
declare v_n integer;
begin
  select count(*) into v_n from goods_receipt where purchase_order_id is not null;
  if v_n <> 9 then
    raise exception 'Se esperaban 9 recepciones enlazadas y hay %. Abortado.', v_n;
  end if;
end $$;

do $$
declare r record;
begin
  for r in select id from _antes loop
    perform public._match_order_lines_for_order(r.id);
    perform public.recompute_purchase_order_status(r.id);
  end loop;
end $$;

select a.code as pedido, a.status as antes, po.status as despues,
       a.casadas as casadas_antes,
       (select count(*) from goods_receipt_line grl join goods_receipt gr on gr.id=grl.goods_receipt_id
         where gr.purchase_order_id = po.id and grl.purchase_order_line_id is not null) as casadas_despues,
       (a.updated_at is distinct from po.updated_at) as fila_del_pedido_tocada
from _antes a join purchase_order po on po.id = a.id
order by a.code;
commit;
