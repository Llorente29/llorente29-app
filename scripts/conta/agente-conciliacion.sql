-- scripts/conta/agente-conciliacion.sql
--
-- Agente «Conciliación» (B01, encargo §4 y respuesta 4), la parte de cada
-- noche. SOLO LEE: corre con default_transaction_read_only=on, en
-- staging-conta y en producción (rol conta_lectura, 20261101T0160). Devuelve
-- un JSON con lo contado y, por comprobación, las filas que fallan; lo revisa
-- scripts/conta/lib/conciliacion.mjs. La otra parte del agente —casar— corre
-- en la app después de cada extracto y una vez al día (bank_agent_run).
--
-- Regla 9: cada fila lleva su account_id y su company_id. Sin conceptos ni
-- nombres: el informe va al resumen de Actions de un repositorio público.
--
-- Lo que se mira:
--   1. casado_dos_veces     · ningún movimiento con dos casados vivos, ni un
--                             asiento casado con dos movimientos (salvo un traspaso).
--   2. asiento_sin_movimiento · ningún asiento hecho por Bancos (origen «bank»)
--                             vivo sin su movimiento casado detrás.
--   3. mes_cerrado          · un mes de un banco cerrado sigue cuadrando: el
--                             saldo de contabilidad de hoy a esa fecha es el del
--                             cierre (si cambió, algo se casó o deshizo después).
--                             Los cerrados «a sabiendas», en ámbar con su fecha.
--   4. regla_sin_registro   · ninguna regla sin su registro, ni encendida o
--                             apagada sin que su último apunte lo diga.
--   5. extracto             · ningún extracto que no cuadre (balanced false) ni
--                             con sus cuentas mal (movimientos ≠ nuevos + repetidos);
--                             los que dejan un hueco con el anterior, en ámbar.
--   6. consentimiento       · ningún permiso del agregador caducado y activo;
--                             los que caducan en 7 días, en ámbar.
--   7. sin_pasada           · ninguna empresa con movimientos sin mirar y sin
--                             una pasada del agente en 48 h (ámbar).

with vivos as (
  select m.* from public.bank_match m where m.status = 'vivo'
),
cerrados as (
  select c.*, (select coalesce(sum(jl.debit - jl.credit), 0)
                 from public.company_account_link l
                 join public.journal_line jl on jl.company_account_id = l.company_account_id
                 join public.journal_entry je on je.id = jl.entry_id
                where l.entity = 'bank_account' and l.entity_id = c.treasury_account_id::text and l.role = 'principal'
                  and je.status in ('validado', 'anulado', 'propuesto') and je.source_type <> 'closing'
                  and je.entry_date <= (c.month + interval '1 month - 1 day')::date) as libro_hoy
    from public.bank_month_close c where c.status = 'cerrado'
),
ultimo_log as (
  select distinct on (rule_id) rule_id, action, after from public.bank_rule_log order by rule_id, created_at desc
)
select json_build_object(
  'contado', json_build_object(
    'empresas', (select count(distinct company_id) from public.bank_movement),
    'movimientos', (select count(*) from public.bank_movement),
    'casados', (select count(*) from vivos),
    'sin_mirar', (select count(*) from public.bank_movement where status in ('pendiente', 'propuesto', 'por_aclarar', 'posible_repetido')),
    'reglas', (select count(*) from public.bank_rule),
    'extractos', (select count(*) from public.bank_statement),
    'meses_cerrados', (select count(*) from public.bank_month_close where status = 'cerrado'),
    'pasadas_48h', (select count(*) from public.bank_agent_run where ran_at > now() - interval '48 hours')),
  'casado_dos_veces', coalesce((
    select json_agg(x) from (
      select v.account_id, v.company_id, v.movement_id as id, 'movimiento' as que, count(*) as n
        from vivos v group by v.account_id, v.company_id, v.movement_id having count(*) > 1
      union all
      select v.account_id, v.company_id, v.journal_entry_id, 'asiento', count(*)
        from vivos v where v.journal_entry_id is not null and v.kind <> 'traspaso'
       group by v.account_id, v.company_id, v.journal_entry_id having count(*) > 1) x), '[]'),
  'asiento_sin_movimiento', coalesce((
    select json_agg(x) from (
      select e.account_id, e.company_id, e.id, e.entry_date as fecha, e.status as estado
        from public.journal_entry e
       where e.source_type = 'bank' and e.status in ('propuesto', 'borrador', 'validado')
         and not exists (select 1 from vivos v where v.journal_entry_id = e.id)) x), '[]'),
  'mes_cerrado', coalesce((
    select json_agg(x) from (
      select c.account_id, c.company_id, c.treasury_account_id as banco, to_char(c.month, 'YYYY-MM') as mes, c.knowingly as a_sabiendas,
             c.book_balance as libro_al_cerrar, c.libro_hoy, c.difference as diferencia, c.loose_count as sueltos
        from cerrados c where c.knowingly or c.libro_hoy <> c.book_balance) x), '[]'),
  'regla_sin_registro', coalesce((
    select json_agg(x) from (
      select r.account_id, r.company_id, r.id, r.status as estado, coalesce(u.action, 'ninguno') as ultimo
        from public.bank_rule r left join ultimo_log u on u.rule_id = r.id
       where u.rule_id is null
          or (r.status = 'apagada' and u.action not in ('apagada', 'cambiada', 'usada'))
          or (r.status = 'activa' and u.action = 'apagada')) x), '[]'),
  'extracto', coalesce((
    select json_agg(x) from (
      select s.account_id, s.company_id, s.id, s.treasury_account_id as banco, s.period_from as desde, s.period_to as hasta,
             case when s.balanced is false then 'no cuadra'
                  when s.movements_count <> s.new_count + s.repeated_count then 'sus cuentas no cuadran'
                  else 'hueco' end as motivo, s.continuity_gap as hueco
        from public.bank_statement s
       where s.balanced is false or s.movements_count <> s.new_count + s.repeated_count or s.continuity = 'hueco') x), '[]'),
  'consentimiento', coalesce((
    select json_agg(x) from (
      select l.account_id, l.company_id, l.id, l.provider as proveedor, l.consent_valid_until::date as caduca,
             (l.consent_valid_until::date - current_date) as dias
        from public.bank_aggregator_link l
       where l.status = 'activo' and l.consent_valid_until < now() + interval '7 days') x), '[]'),
  'sin_pasada', coalesce((
    select json_agg(x) from (
      select m.account_id, m.company_id, count(*) as sin_mirar,
             (select max(r.ran_at) from public.bank_agent_run r where r.company_id = m.company_id) as ultima
        from public.bank_movement m
       where m.status = 'pendiente'
       group by m.account_id, m.company_id
      having not exists (select 1 from public.bank_agent_run r where r.company_id = m.company_id and r.ran_at > now() - interval '48 hours')) x), '[]')
);
