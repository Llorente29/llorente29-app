-- Versiona el CHECK de recipe_item_allergen tal y como está VIVO hoy en
-- producción — no cambia ningún comportamiento, solo captura en git lo que ya
-- está aplicado. El repo llevaba tiempo por detrás sin ninguna migración que lo
-- reflejase (mismo patrón de "drift Supabase vs repo" ya documentado en el
-- proyecto: lo vivo puede ir por delante del git).
--
-- ORIGEN del hallazgo (03/08): al revisar el frente de "Ficha unificada de
-- plato" se encontraron 2 sitios en código que escriben valores de
-- recipe_item_allergen.source fuera del CHECK tal y como está en el repo
-- (`recipeAiService.ts` con 'ai_enrich', `ingredientAdoptionService.ts` con
-- 'template_global'). Julio verificó en vivo (queries contra
-- pg_constraint/pg_get_constraintdef y un COUNT por source):
--   · state  vivo: 'contains' | 'may_contain' | 'free' | 'unknown'
--     (el repo tenía 'may_contain_traces'/'does_not_contain' — nunca aplicado
--     así; lo vivo usa el vocabulario corto, que además coincide con
--     src/modules/kitchen/lib/allergens.ts salvo por 'unknown', que faltaba).
--   · source vivo: 'inherited' | 'manual' | 'automatic' | 'ai_enrich'
--     ('ai_enrich' SÍ está admitido en vivo, sin migración que lo capturase).
--     Conteo real: ai_enrich=716, manual=54, inherited=21.
--   · 'template_global' (ingredientAdoptionService.ts) NO aparece en el CHECK
--     vivo ni en los datos — sigue siendo una escritura que fallaría (ya
--     registrada en consola, no bloqueante). Verificado aparte con una query de
--     huérfanos (ingredientes adoptados de plantilla, con plantilla origen con
--     alérgenos, sin ninguna fila en recipe_item_allergen): 0 filas — no hay
--     pérdida de datos de alérgenos en producción, no es un problema de
--     seguridad alimentaria. 'template_global' queda fuera de esta migración a
--     propósito (solo se versiona lo que ya está vivo); es una decisión aparte
--     pendiente si se quiere admitir.
--
-- Idempotente: localiza el CHECK actual por su definición (mismo patrón que
-- 20260607T2200_recipe_item_source_template_global.sql — no asume el nombre
-- del constraint, que puede variar según cómo se aplicó el cambio en vivo), lo
-- sustituye por uno con nombre canónico y el vocabulario ya vigente. DDL puro,
-- sin BEGIN/COMMIT (SQL Editor).

do $$
declare
  cons_name text;
begin
  -- state: contains | may_contain | free | unknown (ya vivo)
  select conname into cons_name
  from pg_constraint
  where conrelid = 'public.recipe_item_allergen'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%state%'
  limit 1;

  if cons_name is not null then
    execute format('alter table recipe_item_allergen drop constraint %I', cons_name);
  end if;

  alter table recipe_item_allergen
    add constraint recipe_item_allergen_state_check
    check (state = any (array[
      'contains'::text,
      'may_contain'::text,
      'free'::text,
      'unknown'::text
    ]));

  -- source: inherited | manual | automatic | ai_enrich (ya vivo)
  select conname into cons_name
  from pg_constraint
  where conrelid = 'public.recipe_item_allergen'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%source%'
  limit 1;

  if cons_name is not null then
    execute format('alter table recipe_item_allergen drop constraint %I', cons_name);
  end if;

  alter table recipe_item_allergen
    add constraint recipe_item_allergen_source_check
    check (source = any (array[
      'inherited'::text,
      'manual'::text,
      'automatic'::text,
      'ai_enrich'::text
    ]));
end $$;

-- Guard: verifica que ambos constraints quedaron con el nombre canónico y que
-- el vocabulario vivo (confirmado por Julio) sigue admitido tras el cambio.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.recipe_item_allergen'::regclass
      and contype = 'c' and conname = 'recipe_item_allergen_state_check'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta recipe_item_allergen_state_check';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.recipe_item_allergen'::regclass
      and contype = 'c' and conname = 'recipe_item_allergen_source_check'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta recipe_item_allergen_source_check';
  end if;
end $$;
