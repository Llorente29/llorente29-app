-- 20260902T2320_retirar_list_costless_sold_products.sql
-- APLICADA y verificada el 02/09. Frente 15, decidido por Julio: retirar.
--
-- ── POR QUÉ SE VA UNA FUNCIÓN QUE SE LLAMA IGUAL QUE EL PROBLEMA ───────────
-- `list_costless_sold_products` devolvía **CERO filas** para Foodint habiendo
-- 118 productos y 11.522 € vendidos sin poder costearlos. No fallaba: aprobaba.
--
-- Exige `recipe_item.computed_cost IS NULL AND fixed_cost IS NULL`, y hoy todo
-- `recipe_item` enlazado que se vende tiene coste. El agujero real está un paso
-- antes —productos de carta SIN escandallo enlazado— y su
-- `JOIN recipe_item ON ri.id = mi.recipe_item_id` los excluye por construcción.
--
-- La pregunta la contesta `home_vendido_sin_coste` desde el 02/09, con el
-- criterio correcto (`sale_line.computed_cost`, lo que el motor deja escrito en
-- la línea, que ya resuelve combos y modificadores). Dos fuentes para la misma
-- pregunta es como nace la siguiente discrepancia — regla 10. Se queda una.
--
-- ── QUIÉN LA USABA, MEDIDO ANTES DE BORRAR ─────────────────────────────────
--   · Objetos de la base: NINGUNO. Cero funciones, vistas, vistas
--     materializadas y `cron.job` la nombran.
--   · Código: UN solo consumidor, la sección «Casado pero sin coste» de
--     `SalesExceptionsPage`, que se retira en el mismo commit.
--   · `pg_stat_statements`: **1 llamada en toda la vida de la base.** Esa
--     sección se abrió una vez, y lo que vio fue una lista vacía.
--   · Grants: `anon` PODÍA ejecutarla (se llevaba un «sin acceso» por la guarda
--     interna, pero el grant sobraba). Al borrarla se va también.
--
-- ── QUÉ SE PIERDE, Y QUÉ NO ────────────────────────────────────────────────
-- Con la sección se va su fila `CostlessRow`, que tenía un flujo de resolución
-- de tres acciones (reventa / plato / combo). **La maquinaria NO se pierde:**
-- `classifyUnmappedProduct` la siguen usando las otras dos secciones de la
-- misma pantalla. Lo que desaparece es una fila que no tenía a nadie a quien
-- enseñar.
--
-- ── LA DEFINICIÓN ORIGINAL, POR SI ALGUIEN LA NECESITA ─────────────────────
-- Se guarda entera aquí a propósito: borrar algo sin dejar cómo era es borrar
-- dos veces.
--
--   CREATE OR REPLACE FUNCTION public.list_costless_sold_products(
--     p_account_id uuid,
--     p_from timestamptz DEFAULT (now() - '90 days'::interval),
--     p_to   timestamptz DEFAULT now())
--   RETURNS TABLE(recipe_item_id uuid, product_name text, recipe_type text,
--                 has_recipe_lines boolean, is_purchasable boolean,
--                 ventas integer, importe numeric)
--   LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
--   BEGIN
--     IF NOT (public.current_user_is_admin()
--             OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
--       RAISE EXCEPTION 'list_costless_sold_products: sin acceso a la cuenta %', p_account_id;
--     END IF;
--     RETURN QUERY
--     SELECT ri.id, max(ri.name), max(ri.type), (count(rl.id) > 0),
--            bool_or(ri.is_purchasable), count(DISTINCT sl.id)::integer,
--            ROUND(SUM(COALESCE(sl.line_total, sl.unit_price * sl.quantity)), 2)
--     FROM sale_line sl
--     JOIN sale s         ON s.id = sl.sale_id
--     JOIN menu_item mi   ON mi.id = sl.menu_item_id
--     JOIN recipe_item ri ON ri.id = mi.recipe_item_id
--     LEFT JOIN recipe_line rl ON rl.parent_item_id = ri.id
--     WHERE sl.account_id = p_account_id
--       AND s.source = 'lastapp' AND s.is_active = true
--       AND COALESCE(sl.line_type, 'product') = 'product'
--       AND s.sold_at >= p_from AND s.sold_at < p_to
--       AND ri.computed_cost IS NULL AND ri.fixed_cost IS NULL
--     GROUP BY ri.id
--     HAVING count(DISTINCT sl.id) > 0
--     ORDER BY importe DESC NULLS LAST;
--   END; $$;
--
-- (De paso queda registrado un segundo defecto suyo, por si vuelve: filtraba
-- `s.source = 'lastapp'`, así que las ventas importadas por CSV de plataforma
-- nunca entraban.)

-- Guarda: no borrar si alguien la nombra desde la base.
do $guarda$
declare n int;
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname not in ('pg_catalog','information_schema')
    and p.proname <> 'list_costless_sold_products'
    and p.prosrc ilike '%list_costless_sold_products%';
  if n > 0 then
    raise exception 'No se borra: % funciones la nombran', n;
  end if;

  select count(*) into n from cron.job where command ilike '%list_costless_sold_products%';
  if n > 0 then
    raise exception 'No se borra: % crons la nombran', n;
  end if;
end
$guarda$;

drop function if exists public.list_costless_sold_products(uuid, timestamptz, timestamptz);

-- Verificación: cero firmas.
do $verif$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'list_costless_sold_products') then
    raise exception 'La funcion sigue existiendo';
  end if;
end
$verif$;
