-- ============================================================================
-- PRUEBA (staging) · AUTOCONTEO: se aplica solo, entero, con cualquier
-- diferencia (0390 y 0400). Todo en una transacción con ROLLBACK.
--
-- Prueba los objetos que la 0400 declara en su cabecera: public.inventory_count
-- (las tres columnas nuevas), public.close_inventory_count,
-- public.apply_inventory_count, public.autoclose_daily_count y
-- public.cron_autoclose_daily_counts; y lo que añade: _close_inventory_count_core,
-- _apply_inventory_count_core, _autoconteo_aplicar, autoconteo_cierre_nocturno,
-- autoconteos_sin_aplicar y autoconteo_vigia. De la 0390, que
-- public.autoconteo_anulacion_20261021 existe y no la lee nadie de la API (en
-- staging no hay filas de Foodint que anular).
--
-- La población: artículos nuevos de la cuenta A (a7c…), cada conteo con los
-- suyos, para que el libro de cada uno sea exacto. La línea «revisar» sale
-- como sale en producción: por la puerta de contar (save_count_line), con un
-- primer número que pide recontar y un segundo que tampoco cuadra.
--
--   1. Permisos: los núcleos y el aplicador no los ejecuta la API.
--   2. LA TABLET: un autoconteo de hoy con una línea muy desviada, una
--      «revisar» y una apartada. Al terminar se aplica ENTERO (menos la
--      apartada), «al_terminar», con la diferencia guardada.
--   3. LA RED: un rezagado de ayer con una línea contada y otra no: se aplica
--      lo contado, «rezagado».
--   4. LA NOCHE: el procedimiento (en modo prueba) aplica uno de ayer, anula
--      uno sin nada contado y deja apuntado el que falla (a propósito), con su
--      aviso en system_alert_queue. La función vieja falla diciendo por qué.
--   5. Lo que avisa la pantalla, y la cuenta B no lo lee.
--   6. Lo que lee el vigía.
--   7. LO QUE NO CAMBIA: un inventario de seguridad (audit) sigue pidiendo
--      motivo, no se aplica solo, y la noche no lo toca; sin usuario,
--      apply_inventory_count sigue diciendo «sin acceso».
--   8. Regla 10: los cuatro caminos (venta, albarán, merma, recuento) con todo
--      lo de arriba puesto, y además un autoconteo de la tablet.
-- El COMMIT por conteo y el rojo de pg_cron no se pueden probar dentro de una
-- transacción: se prueban fuera, en tests/inventario/autoconteo-noche.sh.
-- ============================================================================

begin;

select set_config('request.jwt.claims', '', true);
create temp table _hechos (paso text, resultado text) on commit drop;
-- Las de abajo las escribe también el rol authenticated (las llamadas de una persona).
grant all on _hechos to authenticated;
create temp table _tablet (closed boolean, applied integer, pending_anomalies integer, final_status text) on commit drop;
grant all on _tablet to authenticated;

-- ── 0 · La 0390 en staging ─────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.autoconteo_anulacion_20261021') is null then
    raise exception 'PRUEBA autoconteo · 0: falta public.autoconteo_anulacion_20261021 (la 0390).';
  end if;
  if has_table_privilege('anon', 'public.autoconteo_anulacion_20261021', 'select')
     or has_table_privilege('authenticated', 'public.autoconteo_anulacion_20261021', 'select') then
    raise exception 'PRUEBA autoconteo · 0: la copia de la 0390 se puede leer desde la API.';
  end if;
  insert into _hechos values ('0 · la 0390', 'la copia existe, ' || (select count(*) from public.autoconteo_anulacion_20261021) || ' filas (staging no tiene a Foodint), cerrada a la API');
end $$;

-- ── 1 · Permisos ───────────────────────────────────────────────────────────
do $$
declare v_mal text := ''; f text;
begin
  foreach f in array array['public._close_inventory_count_core(uuid)', 'public._apply_inventory_count_core(uuid,uuid,text,boolean)',
                           'public._autoconteo_aplicar(uuid,text,uuid,text)', 'public.autoconteo_vigia()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      v_mal := v_mal || ' ' || f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.autoconteos_sin_aplicar(uuid)', 'execute') then v_mal := v_mal || ' autoconteos_sin_aplicar(anon)'; end if;
  if not has_function_privilege('authenticated', 'public.autoconteos_sin_aplicar(uuid)', 'execute') then v_mal := v_mal || ' autoconteos_sin_aplicar(no authenticated)'; end if;
  if v_mal <> '' then raise exception 'PRUEBA autoconteo · 1: permisos de más o de menos:%', v_mal; end if;
  insert into _hechos values ('1 · permisos', 'núcleos, aplicador y vigía cerrados a la API; la lectura de la pantalla, solo authenticated');
end $$;

-- ── Siembra: artículos propios de la cuenta A ──────────────────────────────
create function pg_temp.articulo(p_id uuid, p_nombre text) returns uuid language sql as $$
  insert into public.recipe_item (id, account_id, type, name, base_unit_id, is_stockable, cost_strategy, fixed_cost)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', 'raw', p_nombre, 'c1b0a000-0000-4000-8000-000000000104', true, 'fixed', 1.00)
  returning id $$;
create function pg_temp.libro(p_item uuid) returns numeric language sql as $$
  select coalesce(sum(qty_base), 0) from public.stock_movement
   where recipe_item_id = p_item and location_id = 'c01a0000-0000-4000-8000-0000000000a2' $$;
-- Cuenta hasta que la línea queda sellada (un primer número raro pide recontar).
create function pg_temp.contar(p_line uuid, p_primero numeric, p_segundo numeric) returns void language plpgsql as $$
begin
  perform public.save_count_line(p_line, jsonb_build_array(jsonb_build_object('method', 'peso', 'qty', p_primero)), null, null, null);
  if (select counted_qty from public.inventory_count_line where id = p_line) is null then
    perform public.save_count_line(p_line, jsonb_build_array(jsonb_build_object('method', 'peso', 'qty', p_segundo)), null, null, null);
  end if;
  if (select counted_qty from public.inventory_count_line where id = p_line) is null then
    raise exception 'PRUEBA autoconteo: la línea % no ha quedado contada.', p_line;
  end if;
end $$;
create function pg_temp.conteo(p_id uuid, p_kind text, p_hace interval) returns uuid language sql as $$
  insert into public.inventory_count (id, account_id, location_id, status, kind, created_at, started_at)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', 'contando', p_kind,
          now() - p_hace, now() - p_hace)
  returning id $$;
create function pg_temp.linea(p_id uuid, p_count uuid, p_item uuid) returns uuid language sql as $$
  insert into public.inventory_count_line (id, account_id, inventory_count_id, recipe_item_id, system_qty)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', p_count, p_item, pg_temp.libro(p_item))
  returning id $$;

do $$
begin
  perform pg_temp.articulo('a7c00000-0000-4000-8000-000000000101', 'Prueba autoconteo · muy desviado');
  perform pg_temp.articulo('a7c00000-0000-4000-8000-000000000102', 'Prueba autoconteo · revisar');
  perform pg_temp.articulo('a7c00000-0000-4000-8000-000000000103', 'Prueba autoconteo · apartado');
  perform pg_temp.articulo('a7c00000-0000-4000-8000-000000000104', 'Prueba autoconteo · rezagado contado');
  perform pg_temp.articulo('a7c00000-0000-4000-8000-000000000105', 'Prueba autoconteo · rezagado sin contar');
  perform pg_temp.articulo('a7c00000-0000-4000-8000-000000000106', 'Prueba autoconteo · noche');
  perform pg_temp.articulo('a7c00000-0000-4000-8000-000000000107', 'Prueba autoconteo · noche vacío');
  perform pg_temp.articulo('a7c00000-0000-4000-8000-000000000108', 'Prueba autoconteo · noche roto');
  perform pg_temp.articulo('a7c00000-0000-4000-8000-000000000109', 'Prueba autoconteo · seguridad');
  -- Stock de partida (10) para los que tienen que salir desviados.
  insert into public.stock_movement (account_id, location_id, recipe_item_id, movement_type, qty_base, unit_cost, cost_provisional, source_type, occurred_at, created_by_name, notes)
  select 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', x, 'ajuste', 10, 1.00, false, 'adjustment', now() - interval '3 days', 'prueba', 'prueba autoconteo'
    from unnest(array['a7c00000-0000-4000-8000-000000000101', 'a7c00000-0000-4000-8000-000000000102', 'a7c00000-0000-4000-8000-000000000103',
                      'a7c00000-0000-4000-8000-000000000109']::uuid[]) x;
  perform public.recompute_location_stock_core(x, 'c01a0000-0000-4000-8000-0000000000a2')
     from unnest(array['a7c00000-0000-4000-8000-000000000101', 'a7c00000-0000-4000-8000-000000000102', 'a7c00000-0000-4000-8000-000000000103',
                       'a7c00000-0000-4000-8000-000000000109']::uuid[]) x;
end $$;

-- Como el administrador de A, que es como cuenta la tablet en staging.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

-- ── 2 · La tablet ──────────────────────────────────────────────────────────
do $$
declare
  c_t constant uuid := 'a7c00000-0000-4000-8000-000000000201';
  v record; v_mal text := ''; v_l record;
begin
  perform pg_temp.conteo(c_t, 'cycle', interval '1 hour');
  perform pg_temp.linea('a7c00000-0000-4000-8000-000000000211', c_t, 'a7c00000-0000-4000-8000-000000000101');
  perform pg_temp.linea('a7c00000-0000-4000-8000-000000000212', c_t, 'a7c00000-0000-4000-8000-000000000102');
  perform pg_temp.linea('a7c00000-0000-4000-8000-000000000213', c_t, 'a7c00000-0000-4000-8000-000000000103');
  perform pg_temp.contar('a7c00000-0000-4000-8000-000000000211', 2, 2);     -- de 10 a 2: −80 %
  perform pg_temp.contar('a7c00000-0000-4000-8000-000000000212', 60, 30);   -- recontar y no cuadra: «revisar»
  perform pg_temp.contar('a7c00000-0000-4000-8000-000000000213', 1, 1);
  perform public.set_count_line_excluded('a7c00000-0000-4000-8000-000000000213', 'prueba: apartada a mano', true);
end $$;

-- La tablet llama como una persona: rol authenticated, con su sesión.
set local role authenticated;
insert into _tablet select * from public.autoclose_daily_count('a7c00000-0000-4000-8000-000000000201');
reset role;

do $$
declare
  c_t constant uuid := 'a7c00000-0000-4000-8000-000000000201';
  v record; v_mal text := ''; v_l record;
begin
  select * into v from _tablet;
  select * into v_l from public.inventory_count where id = c_t;
  if v.final_status <> 'aprobado' or v_l.status <> 'aprobado' then v_mal := v_mal || format(' estado %s/%s;', v.final_status, v_l.status); end if;
  if v_l.auto_applied_via is distinct from 'al_terminar' then v_mal := v_mal || format(' forma %s;', v_l.auto_applied_via); end if;
  if v.pending_anomalies <> 0 then v_mal := v_mal || format(' deja %s pendientes;', v.pending_anomalies); end if;
  if v_l.approved_by is distinct from 'c01a0000-0000-4000-8000-0000000000a1'::uuid or v_l.approved_by_name is null then
    v_mal := v_mal || format(' aprobado por %s/%s;', v_l.approved_by, v_l.approved_by_name);
  end if;
  if pg_temp.libro('a7c00000-0000-4000-8000-000000000101') <> 2 then v_mal := v_mal || ' el muy desviado no ha quedado en 2;'; end if;
  if pg_temp.libro('a7c00000-0000-4000-8000-000000000102') <> (select counted_qty from public.inventory_count_line where id = 'a7c00000-0000-4000-8000-000000000212') then
    v_mal := v_mal || ' el «revisar» no ha quedado en lo contado;';
  end if;
  if pg_temp.libro('a7c00000-0000-4000-8000-000000000103') <> 10 then v_mal := v_mal || ' la apartada SE HA APLICADO;'; end if;
  if (select variance_qty from public.inventory_count_line where id = 'a7c00000-0000-4000-8000-000000000211') is distinct from -8 then
    v_mal := v_mal || format(' la diferencia no se ha guardado (%s);', (select variance_qty from public.inventory_count_line where id = 'a7c00000-0000-4000-8000-000000000211'));
  end if;
  if not (select needs_review from public.inventory_count_line where id = 'a7c00000-0000-4000-8000-000000000212') then
    v_mal := v_mal || ' la línea «revisar» no ha salido como revisar (la población no es la que se quería);';
  end if;
  if v_mal <> '' then raise exception 'PRUEBA autoconteo · 2 (tablet):%', v_mal; end if;
  insert into _hechos values ('2 · tablet', format('aplicado al terminar por %s: %s ajustes; −80 %% y «revisar» aplicados, la apartada no; diferencia guardada −8',
                                                     v_l.approved_by_name, v.applied));
end $$;

-- ── 3 · La red: un rezagado de ayer ────────────────────────────────────────
do $$
declare c_r constant uuid := 'a7c00000-0000-4000-8000-000000000301';
begin
  perform pg_temp.conteo(c_r, 'cycle', interval '30 hours');
  perform pg_temp.linea('a7c00000-0000-4000-8000-000000000311', c_r, 'a7c00000-0000-4000-8000-000000000104');
  perform pg_temp.linea('a7c00000-0000-4000-8000-000000000312', c_r, 'a7c00000-0000-4000-8000-000000000105');
  perform pg_temp.contar('a7c00000-0000-4000-8000-000000000311', 7, 7);
end $$;
set local role authenticated;
select public.autoclose_daily_count('a7c00000-0000-4000-8000-000000000301');
reset role;
do $$
declare c_r constant uuid := 'a7c00000-0000-4000-8000-000000000301'; v_l record;
begin
  select * into v_l from public.inventory_count where id = c_r;
  if v_l.status <> 'aprobado' or v_l.auto_applied_via is distinct from 'rezagado' or pg_temp.libro('a7c00000-0000-4000-8000-000000000104') <> 7
     or exists (select 1 from public.stock_movement where source_id = c_r and recipe_item_id = 'a7c00000-0000-4000-8000-000000000105') then
    raise exception 'PRUEBA autoconteo · 3 (rezagado): %/% libro %', v_l.status, v_l.auto_applied_via, pg_temp.libro('a7c00000-0000-4000-8000-000000000104');
  end if;
  insert into _hechos values ('3 · rezagado', 'aplicado lo contado (1 de 2), «rezagado»; lo no contado no se toca');
end $$;

-- ── 4 · La noche ───────────────────────────────────────────────────────────
do $$
begin
  perform pg_temp.conteo('a7c00000-0000-4000-8000-000000000401', 'cycle', interval '30 hours');
  perform pg_temp.linea('a7c00000-0000-4000-8000-000000000411', 'a7c00000-0000-4000-8000-000000000401', 'a7c00000-0000-4000-8000-000000000106');
  perform pg_temp.contar('a7c00000-0000-4000-8000-000000000411', 4, 4);
  perform pg_temp.conteo('a7c00000-0000-4000-8000-000000000402', 'cycle', interval '30 hours');
  perform pg_temp.linea('a7c00000-0000-4000-8000-000000000412', 'a7c00000-0000-4000-8000-000000000402', 'a7c00000-0000-4000-8000-000000000107');
  perform pg_temp.conteo('a7c00000-0000-4000-8000-000000000403', 'cycle', interval '30 hours');
  perform pg_temp.linea('a7c00000-0000-4000-8000-000000000413', 'a7c00000-0000-4000-8000-000000000403', 'a7c00000-0000-4000-8000-000000000108');
  perform pg_temp.contar('a7c00000-0000-4000-8000-000000000413', 3, 3);
  -- Un inventario de seguridad abierto de ayer: la noche no lo tiene que tocar.
  perform pg_temp.conteo('a7c00000-0000-4000-8000-000000000404', 'audit', interval '30 hours');
end $$;

-- El roto, a propósito: rebase_count_system_qty falla para ESE conteo (dentro
-- de esta transacción, que acaba en ROLLBACK).
alter function public.rebase_count_system_qty(uuid) rename to _rebase_prueba_orig;
create function public.rebase_count_system_qty(p_count_id uuid) returns void language plpgsql as $$
begin
  if p_count_id = 'a7c00000-0000-4000-8000-000000000403' then raise exception 'roto a propósito por la prueba'; end if;
  perform public._rebase_prueba_orig(p_count_id);
end $$;

-- La noche corre como postgres y sin usuario: es como la llama pg_cron.
select set_config('request.jwt.claims', '', true);   -- la noche no tiene usuario
call public.autoconteo_cierre_nocturno(true);

drop function public.rebase_count_system_qty(uuid);
alter function public._rebase_prueba_orig(uuid) rename to rebase_count_system_qty;

do $$
declare v_mal text := ''; a record; b record; c record; q record; v_err text;
begin
  select * into a from public.inventory_count where id = 'a7c00000-0000-4000-8000-000000000401';
  select * into b from public.inventory_count where id = 'a7c00000-0000-4000-8000-000000000402';
  select * into c from public.inventory_count where id = 'a7c00000-0000-4000-8000-000000000403';
  select * into q from public.inventory_count where id = 'a7c00000-0000-4000-8000-000000000404';
  if a.status <> 'aprobado' or a.auto_applied_via is distinct from 'cron' or a.approved_by_name is distinct from 'Folvy (autocierre)'
     or pg_temp.libro('a7c00000-0000-4000-8000-000000000106') <> 4 then
    v_mal := v_mal || format(' el de ayer: %s/%s/%s;', a.status, a.auto_applied_via, a.approved_by_name);
  end if;
  if b.status <> 'anulado' or b.auto_applied_via is distinct from 'cron' or b.notes not like '%nadie contó nada%' then
    v_mal := v_mal || format(' el vacío: %s/%s;', b.status, b.auto_applied_via);
  end if;
  if c.status not in ('contando', 'en_revision') or c.auto_apply_error not like '%roto a propósito%' or c.auto_apply_failed_at is null
     or pg_temp.libro('a7c00000-0000-4000-8000-000000000108') <> 0 then
    v_mal := v_mal || format(' el roto: %s / %s;', c.status, c.auto_apply_error);
  end if;
  if not exists (select 1 from public.system_alert_queue where debounce_kind = 'autoconteo_cierre_nocturno' and subject like '%' || c.code || '%') then
    v_mal := v_mal || ' el roto no ha dejado aviso en system_alert_queue;';
  end if;
  if q.status <> 'contando' or q.auto_applied_via is not null then v_mal := v_mal || ' la noche ha tocado el de seguridad;'; end if;
  begin
    perform public.cron_autoclose_daily_counts();
    v_mal := v_mal || ' cron_autoclose_daily_counts no falla;';
  exception when others then v_err := sqlerrm;
  end;
  if v_err not like '%autoconteo_cierre_nocturno%' then v_mal := v_mal || ' la vieja no dice por qué;'; end if;
  if v_mal <> '' then raise exception 'PRUEBA autoconteo · 4 (noche):%', v_mal; end if;
  insert into _hechos values ('4 · noche', format('aplicado %s; anulado el vacío; el roto apuntado («%s») con su aviso; el de seguridad intacto; la vieja dice que está retirada',
                                                  a.code, left(c.auto_apply_error, 40)));
  -- El cron, si en staging hay pg_cron y el trabajo.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    insert into _hechos select '4 · cron', coalesce((select command from cron.job where jobname = 'autoinventory-autoclose'), 'staging no tiene el trabajo autoinventory-autoclose');
  else
    insert into _hechos values ('4 · cron', 'staging sin pg_cron: la orden del trabajo se mira en producción');
  end if;
end $$;

-- ── 5 · Lo que avisa la pantalla ───────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;   -- la pantalla la lee una persona
do $$
declare r record; v_n int;
begin
  select * into r from public.autoconteos_sin_aplicar('c01a0000-0000-4000-8000-00000000000a') where count_id = 'a7c00000-0000-4000-8000-000000000403';
  if r.count_id is null or r.error not like '%roto a propósito%' or r.counted_lines <> 1 then
    raise exception 'PRUEBA autoconteo · 5: la pantalla no avisa del roto (%).', r;
  end if;
  select count(*) into v_n from public.autoconteos_sin_aplicar('c01a0000-0000-4000-8000-00000000000a')
   where count_id in ('a7c00000-0000-4000-8000-000000000201', 'a7c00000-0000-4000-8000-000000000301', 'a7c00000-0000-4000-8000-000000000401', 'a7c00000-0000-4000-8000-000000000402');
  if v_n <> 0 then raise exception 'PRUEBA autoconteo · 5: avisa de % ya aplicados o anulados.', v_n; end if;
  insert into _hechos values ('5 · pantalla', format('avisa del roto (%s, %s contada) y de ninguno de los aplicados', r.code, r.counted_lines));
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare v_err text;
begin
  begin
    perform * from public.autoconteos_sin_aplicar('c01a0000-0000-4000-8000-00000000000a');
  exception when others then v_err := sqlerrm;
  end;
  if v_err is null or v_err not like '%sin acceso%' then raise exception 'PRUEBA autoconteo · 5: la cuenta B lee lo de A.'; end if;
  begin
    perform public.autoclose_daily_count('a7c00000-0000-4000-8000-000000000403');
    raise exception 'PRUEBA autoconteo · 5: la cuenta B aplica un autoconteo de A.';
  exception when others then
    if sqlerrm not like '%sin acceso%' then raise; end if;
  end;
  insert into _hechos values ('5 · cuenta B', 'no lee lo de A ni le aplica un autoconteo');
end $$;
reset role;

-- ── 6 · El vigía ───────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '', true);
do $$
declare v text;
begin
  select valor into v from public.autoconteo_vigia() where clave = 'sin_aplicar';
  if v is null or v not like '%' || (select code from public.inventory_count where id = 'a7c00000-0000-4000-8000-000000000403') || '%con fallo%' then
    raise exception 'PRUEBA autoconteo · 6: el vigía no ve el roto (%).', v;
  end if;
  if v like '%Prueba autoconteo%' then raise exception 'PRUEBA autoconteo · 6: el vigía saca nombres.'; end if;
  insert into _hechos select '6 · vigía', string_agg(clave || '=' || left(valor, 60), ' · ') from public.autoconteo_vigia();
end $$;

-- ── 7 · Lo que no cambia ───────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare c_q constant uuid := 'a7c00000-0000-4000-8000-000000000404'; v_err text; v_err2 text;
begin
  perform pg_temp.linea('a7c00000-0000-4000-8000-000000000414', c_q, 'a7c00000-0000-4000-8000-000000000109');
  perform pg_temp.contar('a7c00000-0000-4000-8000-000000000414', 60, 30);
  perform public.close_inventory_count(c_q);
  begin
    perform public.apply_inventory_count(c_q, 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba', false);
  exception when others then v_err := sqlerrm;
  end;
  if v_err is null or v_err not like 'Faltan motivos%' then
    raise exception 'PRUEBA autoconteo · 7: el de seguridad se ha aprobado sin motivo (%).', coalesce(v_err, 'sin error');
  end if;
  begin
    perform public._autoconteo_aplicar(c_q, 'cron', null, 'x');
  exception when others then v_err2 := sqlerrm;
  end;
  if v_err2 is null or v_err2 not like '%no es un autoconteo%' then
    raise exception 'PRUEBA autoconteo · 7: un inventario de seguridad se puede aplicar solo.';
  end if;
  if pg_temp.libro('a7c00000-0000-4000-8000-000000000109') <> 10 then raise exception 'PRUEBA autoconteo · 7: el de seguridad ha movido el stock.'; end if;
  insert into _hechos values ('7 · seguridad', 'sigue pidiendo motivo («' || left(v_err, 40) || '…») y no se aplica solo');
end $$;
select set_config('request.jwt.claims', '', true);
do $$
declare v_err text;
begin
  begin
    perform public.apply_inventory_count('a7c00000-0000-4000-8000-000000000403', null, 'x', false);
  exception when others then v_err := sqlerrm;
  end;
  if v_err is null or v_err not like '%sin acceso%' then raise exception 'PRUEBA autoconteo · 7: sin usuario, apply_inventory_count ya no dice «sin acceso».'; end if;
  insert into _hechos values ('7 · guardas', 'sin usuario, apply_inventory_count sigue diciendo «sin acceso»');
end $$;

-- ── 8 · Regla 10: los cuatro caminos con todo puesto ───────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_crudo constant uuid := '7e000000-0000-4000-8000-000000000a01';
  v_venta uuid := 'a7c00000-0000-4000-8000-000000000801';
  v_alb uuid := 'a7c00000-0000-4000-8000-000000000802';
  v_rec uuid := 'a7c00000-0000-4000-8000-000000000803';
  v_auto uuid := 'a7c00000-0000-4000-8000-000000000804';
  v_n int; v_r record;
begin
  insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, is_active)
  values (v_venta, v_acc, v_loc, '7e000000-0000-4000-8000-000000000b01', 'e0200000-0000-4000-8000-00000000a0c1', now(), 'open', 'new', 2.5, 'hubrise', true);
  insert into public.sale_line (account_id, sale_id, raw_text, product_name, menu_item_id, quantity, line_type)
  values (v_acc, v_venta, 'prueba', 'Caña', '7e000000-0000-4000-8000-000000000e01', 2, 'product');
  update public.sale set order_status = 'accepted' where id = v_venta;
  perform public.close_sale(v_venta);
  select count(*) into v_n from public.stock_movement where source_type = 'sale' and source_id = v_venta and movement_type = 'consumo';
  if v_n = 0 or (select status from public.sale where id = v_venta) <> 'closed' then
    raise exception 'PRUEBA autoconteo · 8a: cerrar una venta no ha escrito su consumo (% movimientos).', v_n;
  end if;
  insert into _hechos values ('8 · cerrar una venta', v_n || ' movimiento(s) de consumo');

  insert into public.goods_receipt (id, account_id, location_id, status) values (v_alb, v_acc, v_loc, 'borrador');
  insert into public.goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, recipe_item_id, qty_in_base, unit_cost)
  values (v_acc, v_alb, 'Barril', 30, v_crudo, 30, 0.6);
  select * into v_r from public.confirm_goods_receipt(v_alb);
  select count(*) into v_n from public.stock_movement m join public.goods_receipt_line l on l.id = m.source_id
   where m.source_type = 'goods_receipt_line' and l.goods_receipt_id = v_alb;
  if v_r.posted_lines < 1 or v_n = 0 then
    raise exception 'PRUEBA autoconteo · 8b: recibir el albarán no ha entrado en el almacén (líneas %, movimientos %).', v_r.posted_lines, v_n;
  end if;
  insert into _hechos values ('8 · recibir un albarán', v_r.posted_lines || ' línea(s), ' || v_n || ' movimiento(s)');

  select * into v_r from public.register_waste(v_acc, v_loc, v_crudo, 'caducado', 2, null, null, null, null, null, null, 'prueba', 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba');
  if v_r.waste_id is null then raise exception 'PRUEBA autoconteo · 8c: la merma no se ha apuntado.'; end if;
  insert into _hechos values ('8 · apuntar una merma', 'merma ' || v_r.waste_id || ', ' || coalesce(round(v_r.cost_eur, 2)::text, '—') || ' €');

  -- Un recuento manual, por la pantalla, con su motivo: como siempre.
  insert into public.inventory_count (id, account_id, location_id, status, kind) values (v_rec, v_acc, v_loc, 'contando', 'full');
  insert into public.inventory_count_line (id, account_id, inventory_count_id, recipe_item_id, system_qty)
  values ('a7c00000-0000-4000-8000-000000000813', v_acc, v_rec, v_crudo, pg_temp.libro(v_crudo));
  perform public.save_count_line('a7c00000-0000-4000-8000-000000000813',
          jsonb_build_array(jsonb_build_object('method', 'peso', 'qty', greatest(pg_temp.libro(v_crudo), 0))), null, null, null);
  perform public.close_inventory_count(v_rec);
  update public.inventory_count_line set reason_code = 'error_conteo', reason_note = 'prueba del autoconteo' where id = 'a7c00000-0000-4000-8000-000000000813';
  select * into v_r from public.apply_inventory_count(v_rec, 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba', false);
  if (select status from public.inventory_count where id = v_rec) <> 'aprobado' then
    raise exception 'PRUEBA autoconteo · 8d: el recuento manual no ha quedado aprobado.';
  end if;
  insert into _hechos values ('8 · aprobar un recuento', v_r.adjustments || ' ajuste(s), ' || v_r.items_recomputed || ' artículo(s) recalculados');

  -- Y un autoconteo del mismo artículo, después de los otros tres caminos.
  perform pg_temp.conteo(v_auto, 'cycle', interval '0 hours');
  perform pg_temp.linea('a7c00000-0000-4000-8000-000000000814', v_auto, v_crudo);
  perform pg_temp.contar('a7c00000-0000-4000-8000-000000000814', greatest(pg_temp.libro(v_crudo), 0), greatest(pg_temp.libro(v_crudo), 0));
  select * into v_r from public.autoclose_daily_count(v_auto);
  if v_r.final_status <> 'aprobado' then raise exception 'PRUEBA autoconteo · 8e: el autoconteo después de los caminos no se ha aplicado (%).', v_r.final_status; end if;
  insert into _hechos values ('8 · autoconteo al terminar', v_r.applied || ' ajuste(s), ' || v_r.final_status);
end $$;

do $$ begin
  raise notice 'PRUEBA autoconteo en verde: %', (select string_agg(paso || ' → ' || resultado, ' | ') from _hechos);
end $$;

rollback;
