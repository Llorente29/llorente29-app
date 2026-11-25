-- supabase/migrations/20261125T2119_x14h_dar_por_bueno_2024.sql
--
-- X14 · 2 (Julio, 25/11, urgente): «Darlo por bueno» del 2024 de QBO Integrity falló en producción a las 20:17 UTC:
-- rpc/conta_traer_dar_por_bueno dio 500 con «canceling statement due to statement timeout». Son 4.425 asientos y 2.123
-- facturas, y la llamada desde la pantalla no cabe en el tiempo máximo de la API. La carga sigue en prueba, sin cambios.
-- Mientras llega «Darlo por bueno» por tandas (otro PR), esto lo da por bueno desde «Aplicar SQL en producción», que no
-- tiene ese tiempo máximo: la misma función, sin tocarla, en una sola transacción.
--
-- Como la persona que trajo la carga (import_run.created_by), si es administradora activa de su cuenta: su usuario y su
-- cuenta activa, solo dentro de este fichero (como la P01). Si la carga ya no está en prueba, no hace nada.
-- TOCA DATOS (valida los asientos y crea las facturas emitidas de la carga), aunque el analizador lo dé por «sigue»: el cambio
-- va dentro de la función. Lo cuenta la tanda (cuentas/x14h-dar-por-bueno.sql), antes y después.
-- Sin vuelta atrás: dar por bueno lo traído no se deshace («si después ves un error, corrígelo con un asiento a mano»).
-- Nada en el camino del pedido. El real lo lanza Julio.
do $$
declare v_r public.import_run; v_claims text; v_activa text; v_res jsonb;
begin
  select * into v_r from public.import_run where id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9';
  if v_r.id is null or v_r.status <> 'en_prueba' then
    raise notice 'X14h: la carga del 2024 de QBO no está en prueba (%): no se hace nada.', coalesce(v_r.status, 'no está');
    return;
  end if;
  if not exists (select 1 from public.user_profiles where user_id = v_r.created_by and account_id = v_r.account_id and role = 'admin' and active) then
    raise exception 'X14h: quien trajo la carga ya no es administrador activo de su cuenta: no se da por buena.';
  end if;
  v_claims := current_setting('request.jwt.claims', true); v_activa := current_setting('folvy.cuenta_activa', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_r.created_by, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_r.created_by::text || ':' || v_r.account_id::text, true);
  v_res := public.conta_traer_dar_por_bueno(v_r.id, v_r.created_by_name);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  if (select status from public.import_run where id = v_r.id) <> 'dada_por_buena' then
    raise exception 'X14h: conta_traer_dar_por_bueno ha vuelto sin darla por buena: %', v_res;
  end if;
  raise notice 'X14h: %', v_res->>'texto';
end $$;
