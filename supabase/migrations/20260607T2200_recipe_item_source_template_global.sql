-- 20260607T2200_recipe_item_source_template_global.sql
--
-- T1b adopción al vuelo: un recipe_item puede ahora ORIGINARSE del master
-- global (ingredient_template). Para trazar ese origen de forma distinta a
-- 'import' (Excel/OCR genérico), añadimos 'template_global' a los valores
-- permitidos de recipe_item.source.
--
-- El CHECK actual es:
--   source = ANY (ARRAY['manual','ai_recipe','ocr_invoice','import'])
-- Lo sustituimos por uno que incluye 'template_global'. Idempotente: se borra
-- el constraint si existe y se recrea. DDL puro, sin BEGIN/COMMIT (SQL Editor).
--
-- NOTA: el nombre del constraint puede variar; lo localizamos por su definición
-- (el que referencia 'source' y NO 'vat_category_source'). Para mantener la
-- migración simple y robusta, usamos el nombre canónico de Postgres para CHECK
-- de columna; si tu constraint tiene otro nombre, ver el bloque DO más abajo.

do $$
declare
  cons_name text;
begin
  -- Localiza el CHECK que restringe recipe_item.source (no el de vat_*).
  select conname into cons_name
  from pg_constraint
  where conrelid = 'public.recipe_item'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%source = ANY%'
    and pg_get_constraintdef(oid) not ilike '%vat_%'
  limit 1;

  if cons_name is not null then
    execute format('alter table recipe_item drop constraint %I', cons_name);
  end if;

  alter table recipe_item
    add constraint recipe_item_source_check
    check (source = any (array[
      'manual'::text,
      'ai_recipe'::text,
      'ocr_invoice'::text,
      'import'::text,
      'template_global'::text
    ]));
end $$;
