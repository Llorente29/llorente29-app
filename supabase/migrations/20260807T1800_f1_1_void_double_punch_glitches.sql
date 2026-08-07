-- Aplicada: 2026-08-07 por MCP. Verificado: 34 filas voided + 34 audit 'void'; 0 pares <30s restantes.
-- F1.1 · Saneado retroactivo de dobles fichajes glitch (salida->entrada del mismo empleado en <30s).
-- Parten una jornada real en dos (ej. Natacha: 11h36 aparecía como 7h05 + 4h34). Se anula (voided=true,
-- NO borrado) el par salida+entrada espurio -> la jornada se re-une. Reversible; el trigger
-- clock_entry_audit deja rastro (before/after, motivo, actor).
-- Todos los pares tratados verificados como "sándwich" (entrada real antes, salida real después).
-- EXCLUIDO a propósito: 1 par de Pamela a 49.3s (fronterizo) -> decisión manual.
-- Pendiente (Code): guard anti-doble-fichaje en la ESCRITURA para que no vuelva a ocurrir.

select set_config('app.clock_edit_reason',
  'Saneado F1.1: doble fichaje glitch (<30s) que parte una jornada real. Anulado el par salida+entrada espurio. Reversible (voided).', true);
select set_config('app.clock_edit_actor', 'Sistema — saneado F1.1 (2026-08-07)', true);

with ordered as (
  select id, employee_id, type, coalesce(real_datetime,datetime) as t,
    row_number() over w as rn
  from clock_entries where not voided
  window w as (partition by employee_id order by coalesce(real_datetime,datetime))
),
glitch_ids as (
  select o1.id from ordered o1 join ordered o2
      on o2.employee_id=o1.employee_id and o2.rn=o1.rn+1
    where o1.type='salida' and o2.type='entrada' and o2.t - o1.t < interval '30 seconds'
  union
  select o2.id from ordered o1 join ordered o2
      on o2.employee_id=o1.employee_id and o2.rn=o1.rn+1
    where o1.type='salida' and o2.type='entrada' and o2.t - o1.t < interval '30 seconds'
)
update clock_entries set voided = true
where id in (select id from glitch_ids);
