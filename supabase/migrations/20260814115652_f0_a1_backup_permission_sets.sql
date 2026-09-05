-- ENCARGO CODE (14/08) feat/f0-responsable-de-local, A.1 — copia de seguridad
-- ANTES de dropear permission_sets/permission_set_assignments. Código muerto:
-- ni has_permission() ni get_effective_permissions() las leen (verificado por
-- MCP 14/08). Único lector real encontrado: custom_access_token_hook, paso 6
-- (solo permission_set_assignments, para un claim JWT que nadie consume) —
-- se limpia en migración aparte.
create table if not exists _backup_permission_sets_20260814 as
  select * from permission_sets;

create table if not exists _backup_permission_set_assignments_20260814 as
  select * from permission_set_assignments;

do $$
begin
  if (select count(*) from _backup_permission_sets_20260814) <> (select count(*) from permission_sets) then
    raise exception 'A.1: backup de permission_sets no coincide en filas';
  end if;
  if (select count(*) from _backup_permission_set_assignments_20260814) <> (select count(*) from permission_set_assignments) then
    raise exception 'A.1: backup de permission_set_assignments no coincide en filas';
  end if;
end $$;