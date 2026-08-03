-- Alérgenos Capa 2 — auditoría en recipe_item_allergen (updated_at + updated_by).
--
-- No repara contaminación pasada (no se puede, ver conversación del
-- fill-only) — es para que la PRÓXIMA duda de este tipo se responda con
-- datos, no con deducciones sobre created_at. Ante una inspección, "quién
-- declaró esto y cuándo" es exactamente lo que preguntan; en una tabla de
-- seguridad alimentaria no es opcional (decisión de Julio, 06/08).
--
-- updated_at: se pone en CADA insert/update vía trigger, nunca depende de
-- que el código cliente se acuerde de mandarlo — la garantía vive en BBDD,
-- mismo espíritu que el fill-only del motor de herencia.
--
-- updated_by: SOLO se rellena cuando la fila es una declaración humana
-- (source='manual'). Un 'inherited'/'ai_enrich'/'automatic' no lo declaró
-- nadie, lo calculó el motor — atribuírselo a quien disparó el recálculo
-- (p.ej. alguien que añadió una guarnición sin relación con el alérgeno en
-- cuestión) sería engañoso, no auditoría real. auth.uid() es NULL cuando no
-- hay sesión (SQL Editor, backfill) — queda así, honesto.
--
-- Filas EXISTENTES: updated_at/updated_by quedan NULL. No se reconstruye el
-- pasado (pedido explícito de Julio) — created_at ya es una pista parcial y
-- ambigua para las filas viejas (ver conversación), no hace falta fingir
-- certeza en una columna que promete ser fiable desde HOY en adelante.
--
-- Aplicar por SQL Editor a mano. Verificar con un UPDATE real aparte (no
-- fiarse del "Success").

alter table public.recipe_item_allergen
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references auth.users(id);

create or replace function public.recipe_item_allergen_set_audit()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at := now();
  if new.source = 'manual' then
    new.updated_by := auth.uid();
  else
    new.updated_by := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_recipe_item_allergen_audit on public.recipe_item_allergen;
create trigger trg_recipe_item_allergen_audit
  before insert or update on public.recipe_item_allergen
  for each row execute function public.recipe_item_allergen_set_audit();

notify pgrst, 'reload schema';

-- Guard: aborta si columnas o trigger no quedaron.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recipe_item_allergen' and column_name = 'updated_at'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta updated_at';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recipe_item_allergen' and column_name = 'updated_by'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta updated_by';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_recipe_item_allergen_audit') then
    raise exception 'MIGRACIÓN FALLIDA: falta el trigger de auditoría';
  end if;
end $$;
