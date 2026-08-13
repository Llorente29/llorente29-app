-- 20260813T1500_orders_feed_by_token_ventana_6h_a_2h.sql
-- fix/sondeo-adaptativo-tablet (Encargo B, Tarea B3).
-- Causa raíz: docs/claude_folvy_incidente_20260813_conexiones_causa_raiz.md §2 —
-- orders_feed_by_token es "la devoradora" (166 ms de CPU/llamada, 13x más cara que
-- claim_print_jobs). De madrugada, con la cocina cerrada, la ventana de 6h mantenía
-- vivo el servicio de la noche entera (el de más volumen) y lo reprocesaba en cada
-- poll para tres pantallas que nadie mira.
--
-- QUÉ CAMBIA: solo el umbral de la ventana que decide hasta cuándo un pedido YA
-- CERRADO (completed/rejected/cancelled/delivery_failed) sigue apareciendo en el
-- feed de la tablet, de 6 horas a 2. NO afecta a los pedidos ACTIVOS: esos entran
-- siempre por la rama `order_status not in (...)` del WHERE, sin mirar el reloj —
-- verificado leyendo el cuerpo VIVO de la función (no el snapshot del repo, que
-- había quedado desincronizado — ver más abajo) y confirmado con datos reales por
-- MCP (0 pedidos activos y 0 terminales en la franja 2h-6h en el momento de
-- escribir esto, sin servicio en curso).
--
-- APLICADA: 2026-08-13 por MCP, aprobada por Julio ("B3 APROBADA, ventana de 2
-- horas... el pase es operativo — lo cerrado hace más de 2h ya se entregó, y
-- para consultar histórico hay otras pantallas"). Verificado tras aplicar: la
-- definición viva ya no contiene 'interval ''6 hours''' (0 ocurrencias
-- residuales) y la RPC sigue ejecutando sin error contra un token real.
--
-- CÓMO: sustitución quirúrgica sobre la definición VIVA (pg_get_functiondef), NO
-- reescritura del cuerpo entero — es la función de las 3 tablets del pase y la que
-- tumbó Carabanchel el 11/08. Guarda de ocurrencia única: si el texto exacto
-- `interval '6 hours'` no aparece EXACTAMENTE una vez en la definición viva (p.ej.
-- porque alguien la tocó entre medias), aborta sin tocar nada.
--
-- DRIFT CONFIRMADO (13/08, por MCP): el fichero supabase/migrations/orders_feed_by_token.sql
-- del repo (sin marca de tiempo, snapshot antiguo) NO coincide con la función viva
-- en Supabase — le faltan el guardarraíl de pago, los campos de reparto/rider, los
-- hitos de tiempo y el fix de kds_heartbeat (20260816T0901, que quitó el UPDATE
-- last_seen_at de aquí). Esta migración opera sobre la función VIVA vía
-- pg_get_functiondef, no sobre ese snapshot — no lo toca ni lo sustituye.

do $mig$
declare
  v_src text;
  v_new text;
  v_occurrences int;
begin
  select pg_get_functiondef('public.orders_feed_by_token(text)'::regprocedure) into v_src;
  if v_src is null then
    raise exception 'orders_feed_by_token_ventana_6h_a_2h: no se encontró public.orders_feed_by_token(text) — abortar';
  end if;

  v_occurrences := (length(v_src) - length(replace(v_src, $$interval '6 hours'$$, '')))
                    / length($$interval '6 hours'$$);
  if v_occurrences <> 1 then
    raise exception 'orders_feed_by_token_ventana_6h_a_2h: se esperaba EXACTAMENTE 1 ocurrencia de '
      'interval ''6 hours'' en la definición viva, encontradas % — la función cambió desde el RECON, '
      'abortar en vez de reescribir a ciegas', v_occurrences;
  end if;

  v_new := replace(v_src, $$interval '6 hours'$$, $$interval '2 hours'$$);
  execute v_new;

  raise notice 'orders_feed_by_token: ventana de pedidos cerrados 6h -> 2h aplicada (1 ocurrencia sustituida)';
end;
$mig$;
