-- ============================================================================
-- Vuelta atrás de B01 · 6 · alias, reglas que se apagan solas, cierre del mes,
-- agente y agregador. PARA si hay meses cerrados o cuentas conectadas: son
-- registros de lo que hizo una persona (o un consentimiento firmado), no se
-- tiran sin mirarlos.
-- ============================================================================
do $$
begin
  if exists (select 1 from public.bank_month_close) then
    raise exception 'Hay meses de bancos cerrados: guárdalos antes de quitar el cierre.';
  end if;
  if exists (select 1 from public.bank_aggregator_link) then
    raise exception 'Hay cuentas conectadas por el agregador: revócalas antes.';
  end if;
  if exists (select 1 from public.bank_activity_log where action in ('cierre', 'reabierto', 'agente')) then
    raise exception '«Lo que ha hecho Folvy» tiene apuntes del cierre o del agente: el CHECK de antes no los admite. Guárdalos antes.';
  end if;
end $$;
drop function if exists public.bank_consentimientos_por_caducar(uuid, integer);
drop table if exists public.bank_aggregator_link;
drop function if exists public.bank_agente_toca_hoy(uuid);
drop function if exists public.bank_agente_registrar(uuid, text, jsonb);
drop table if exists public.bank_agent_run;
drop function if exists public.bank_meses_estado(uuid, date);
drop function if exists public.bank_mes_reabrir(uuid, text);
drop function if exists public.bank_mes_cerrar(uuid, date, boolean, text);
drop function if exists public._bank_mes_estado(uuid, date);
drop table if exists public.bank_month_close;
alter table public.bank_activity_log drop constraint if exists bank_activity_log_action_check;
alter table public.bank_activity_log add constraint bank_activity_log_action_check
  check (action in ('importado', 'casado', 'enlazado', 'propuesto', 'por_aclarar', 'validado', 'deshecho', 'ignorado', 'regla'));
-- bank_casar llama a _bank_regla_corregida: antes de quitarla, la 0110 de antes de la respuesta 4.
drop function if exists public._bank_regla_corregida(uuid, uuid);
alter table public.bank_rule drop column if exists corrections;
drop function if exists public.bank_cuenta_alias(uuid, text);
alter table public.treasury_account drop column if exists short_name;
