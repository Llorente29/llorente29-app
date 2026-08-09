-- 20260809T1500_shift_templates_kind.sql
-- Aplicada: NO — propuesta, pendiente de que Julio la ejecute y verifique.
--
-- ENCARGO CODE F10 — Bloque A.1. Añade shift_templates.kind para distinguir:
--   demanda       — forma normal que el motor puede elegir para cubrir la curva
--   forzado       — se abre SIEMPRE que coverage_<dia> > 0, aunque el dato no lo pida
--                   (parámetro 3 "Franjas a abrir aunque el dato no las pida")
--   no_productivo — bloque fijo declarado (recepción de género, limpieza…): cuenta
--                   como horas trabajadas pero NO cubre demanda (parámetro 4)
--
-- Todas las filas existentes quedan en 'demanda' por defecto (default de la
-- columna). Regla NO DESTRUCCIÓN: las 3 plantillas duplicadas detectadas en
-- Alcalá (Mañana1, Tarde/Noche 19:45-23:45, Mañanas F/S ya inactiva) y las
-- equivalentes en Carabanchel/Plaza Castilla NO se tocan ni se reclasifican
-- aquí — decidirlo es tarea de Julio (F7.2), pendiente. generate_week_schedule
-- v3 (siguiente migración) las neutraliza en la práctica sin necesidad de
-- marcarlas: pondera cada plantilla 'demanda' por su USO HISTÓRICO real en
-- schedules.cells (semanas guardadas), así que una plantilla nunca usada
-- pierde casi siempre frente a su gemela real. Ver comentario en A.4.

alter table public.shift_templates
  add column if not exists kind text not null default 'demanda'
    check (kind in ('demanda', 'forzado', 'no_productivo'));

comment on column public.shift_templates.kind is
  'demanda = el motor la elige para cubrir la curva. forzado = se abre siempre que coverage_<dia> > 0, sin mirar demanda. no_productivo = bloque fijo (horas trabajadas, no cubre demanda). ENCARGO F10 Bloque A.1, 09/08/2026.';

-- Guard: aborta si la columna no quedó creada con el check esperado.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='shift_templates'
       and column_name='kind'
  ) then
    raise exception 'FALLO: shift_templates.kind no se creo';
  end if;
  if exists (
    select 1 from public.shift_templates where kind not in ('demanda','forzado','no_productivo')
  ) then
    raise exception 'FALLO: hay filas con kind fuera del check';
  end if;
end $$;
