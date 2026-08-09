-- 20260809T1520_break_policy_contract_tolerance.sql
-- Aplicada: NO — propuesta, pendiente de que Julio la ejecute y verifique.
--
-- ENCARGO CODE F10 — Bloque A.3. Tolerancia sobre contrato, configurable por
-- cuenta/local. generate_week_schedule filtra hoy "ya + v_dur <= ctr" SIN
-- margen: Natacha real llega a 43,5 h sobre 40 (+8,75 %) y el motor SQL no
-- puede reproducirlo. Default 0 % = comportamiento actual exacto, sin
-- sorpresas para ninguna otra cuenta que use este motor.

alter table public.break_policy
  add column if not exists contract_tolerance_pct numeric not null default 0;

comment on column public.break_policy.contract_tolerance_pct is
  'Margen permitido por ENCIMA de contracted_hours_week al proponer cuadrante (no cambia el limite legal de horas extra, solo lo que el generador puede PROPONER). 0 = no rebasar nunca (default, comportamiento previo). ENCARGO F10 Bloque A.3, 09/08/2026.';

-- NOTA: se deja en 0 (default) para Llorente29 — el default de la columna ya
-- cubre las filas existentes, no hace falta UPDATE. El valor real (p.ej. 10
-- para igualar el margen que ya usa el generador cliente scheduleGenerator.ts)
-- lo fija Julio con un UPDATE aparte cuando decida la cifra — no se adivina aquí.

-- Guard: aborta si la columna no quedó creada.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='break_policy'
       and column_name='contract_tolerance_pct'
  ) then
    raise exception 'FALLO: contract_tolerance_pct no se creo';
  end if;
end $$;
