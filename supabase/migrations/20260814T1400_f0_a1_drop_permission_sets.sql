-- 20260814T1400_f0_a1_drop_permission_sets.sql
-- ENCARGO CODE (14/08) feat/f0-responsable-de-local, Tramo A.1
-- Aplicada: 14/08/2026 vía MCP, verificada con queries independientes.
--
-- Elimina permission_sets y permission_set_assignments: código muerto que
-- MIENTE — declaran ~40 claves que no son columna de manager_permissions;
-- si alguien los cableara, esas claves darían deny en silencio (el peor
-- fallo posible en permisos). Verificado por MCP (14/08) que ni
-- has_permission() ni get_effective_permissions() las leen. El único lector
-- real encontrado fue custom_access_token_hook (paso 6, solo
-- permission_set_assignments, para un claim JWT — folvy.permission_set_id —
-- que ningún consumidor del cliente usa); se limpia en la migración
-- siguiente de este mismo lote.
--
-- git grep de "permission_set" en el repo (14/08) antes de este drop: los
-- únicos hits en src/ son comentarios descriptivos y el campo de tipo
-- FolvyClaims.permission_set_id (espejo del claim JWT, no una query propia
-- a las tablas) — ninguna pantalla ni servicio hace SELECT/INSERT sobre
-- permission_sets/permission_set_assignments.

-- ── 1) Copia de seguridad (reversible) ────────────────────────────────────
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

-- ── 2) Drop, uno por uno, verificado ──────────────────────────────────────
drop table permission_set_assignments;

do $$
begin
  if to_regclass('public.permission_set_assignments') is not null then
    raise exception 'A.1: permission_set_assignments sigue existiendo';
  end if;
end $$;

drop table permission_sets;

do $$
begin
  if to_regclass('public.permission_sets') is not null then
    raise exception 'A.1: permission_sets sigue existiendo';
  end if;
end $$;

-- ── 3) Preview de lo borrado (para el PR) ─────────────────────────────────
-- permission_sets (4 filas): gerente_total, encargado_sala, encargado_appcc,
--   gestor_rrhh — los 4 "system" con account_id=NULL, ~130 claves jsonb
--   totales, ninguna coincide 1:1 con columnas reales de manager_permissions.
-- permission_set_assignments (2 filas): ambas apuntando a gerente_total,
--   asignadas por el admin e298629b-9d34-4d62-9a00-ff7c3fa29a1a (Julio) el
--   22/05 y 18/06/2026 — inocuas, nunca leídas por ninguna función real.
