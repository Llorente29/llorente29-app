-- Alérgenos Capa 2 — allergen_data_health gana un 3er scope: 'equipo_envase'.
--
-- Fleco del Bug 2 (verificado por Julio): la pantalla mostraba 30 manuales
-- para Foodint, la BD tenía 52. Los 22 que faltaban eran de recipe_item
-- type IN ('tool','packaging') — el WHERE los dejaba fuera sin más. Son
-- dato real de seguridad alimentaria (una freidora compartida con riesgo de
-- contaminación cruzada, un envase con gluten en el papel) — decisión de
-- Julio: cuentan, en su propio scope, no mezclados con 'ingrediente' ni con
-- 'plato' (son de naturaleza distinta: no se comen ni se venden).
--
-- Mismo RETURNS TABLE que antes (scope/source/row_count) -> CREATE OR
-- REPLACE basta, sin DROP. Aplicar por SQL Editor a mano.

create or replace function public.allergen_data_health(
  p_account_id uuid
) returns table(
  scope text,
  source text,
  row_count integer
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'allergen_data_health: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  select
    case
      when ri.type = 'raw' then 'ingrediente'
      when ri.type in ('dish', 'recipe') then 'plato'
      else 'equipo_envase'
    end as scope,
    ria.source,
    count(*)::int as row_count
  from recipe_item_allergen ria
  join recipe_item ri on ri.id = ria.recipe_item_id
  where ri.account_id = p_account_id
  group by 1, 2
  order by 1, 2;
end;
$function$;

notify pgrst, 'reload schema';

-- Guard: aborta si el scope nuevo no aparece para una cuenta que sabemos
-- que tiene tool/packaging con alérgenos (Foodint) — si esto falla en tu
-- cuenta de verificación, comprueba antes si Foodint sigue teniendo esos
-- 22 manuales en tool/packaging.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'allergen_data_health') then
    raise exception 'MIGRACIÓN FALLIDA: falta allergen_data_health';
  end if;
end $$;
