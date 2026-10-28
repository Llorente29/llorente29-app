-- supabase/migrations/20261028T0851_f01c_cola_y_pasada.sql
--
-- cambia: public.recipe_line · prueba: supabase/staging/sql/20261028_f01c_recetas_y_codigo_prueba.sql
-- cambia: public.f01_pasada_last · prueba: supabase/staging/sql/20261028_f01c_recetas_y_codigo_prueba.sql
--
-- F01 · PR 3 · Lo que hace que lo vendido se coloque solo, sin botón
-- «Recasar». Necesita la 0850 (que solo añade). Nada en el camino del pedido:
-- ningún pedido escribe recipe_line, y f01_pasada_last la llama
-- last-catalog-sync (cada hora), no el pedido.
--
--   1. Un disparador nuevo en recipe_line, por sentencia: cuando un plato de
--      Last pasa de no tener ninguna línea a tener alguna, entra en la cola
--      f01_receta_puesta. Solo apunta (una inserción, on conflict do nothing):
--      quien guarda la receta no espera a nada.
--   2. f01_pasada_last, misma firma, hace además tres cosas, cada una dicha en
--      lo que devuelve (y last-catalog-sync lo deja en su respuesta):
--      · un local con un código nuevo de una marca ya dada de alta se vincula
--        (como antes) y AHORA queda apuntado para avisar (codigo_nuevo);
--      · una marca de Last con la carta idéntica a una de Folvy se une sola y
--        se avisa (tablero 4);
--      · lo vendido de los platos que acaban de recibir receta se coloca, desde
--        el último recuento cerrado (regla 6).
--      Lo demás, como en la 1320. Se guarda antes tal cual
--      (_respaldar_funcion) y la vuelta atrás la restaura.

-- ── 1. El disparador de la cola ─────────────────────────────────────────────
drop trigger if exists trg_recipe_line_f01c_receta_puesta on public.recipe_line;
create trigger trg_recipe_line_f01c_receta_puesta
  after insert on public.recipe_line
  referencing new table as nuevas
  for each statement execute function public._f01c_receta_puesta();

-- ── 2. La pasada de cada hora ───────────────────────────────────────────────
select public._respaldar_funcion('public.f01_pasada_last(uuid)', '20261028T0851_f01c_cola_y_pasada');

create or replace function public.f01_pasada_last(p_account uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_a       record;
  v_vinc    jsonb;
  v_ventas  jsonb;
  v_salida  jsonb := '[]'::jsonb;
  v_solas   jsonb;
  v_recetas jsonb;
begin
  for v_a in select a.* from public.external_brand_alta a
               join public.brand b on b.id = a.brand_id and b.archived_at is null
              where a.account_id = p_account and a.source = 'lastapp'
  loop
    v_vinc := public._f01_vincular(p_account, v_a.brand_id, v_a.external_org_id, v_a.external_brand_name, false, 'F01 · pasada de Last');
    if (v_vinc->>'vinculos_nuevos')::integer > 0 then
      v_ventas := public._f01_recolocar(p_account, v_a.brand_id, v_a.external_org_id, v_a.external_brand_name);
      v_salida := v_salida || jsonb_build_object('marca', v_a.external_brand_name, 'vinculos_nuevos', v_vinc->'vinculos_nuevos', 'ventas', v_ventas);
      -- F01 · PR 3: la marca llega con otro código en algún local. Se ha
      -- vinculado sola; ahora, además, se avisa.
      insert into public.f01_marca_reconocida (account_id, source, external_org_id, external_brand_name, brand_id, como,
                                               ventas, locales, created_by_name)
      values (p_account, 'lastapp', v_a.external_org_id, v_a.external_brand_name, v_a.brand_id, 'codigo_nuevo',
              v_ventas || jsonb_build_object('vinculos_nuevos', v_vinc->'vinculos_nuevos'),
              coalesce(v_vinc->'locales', '[]'::jsonb), 'F01 · pasada de Last');
    end if;
  end loop;

  -- F01 · PR 3: las de carta idéntica, unidas solas; y lo vendido de las
  -- recetas recién puestas, colocado (regla 6).
  v_solas := public._f01c_reconocer_solas(p_account);
  v_recetas := public._f01c_colocar_recetas(p_account, 2000);

  return jsonb_build_object('marcas_con_vinculos_nuevos', v_salida, 'reconocidas_solas', v_solas, 'recetas', v_recetas);
end $$;
