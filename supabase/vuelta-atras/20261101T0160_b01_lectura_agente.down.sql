-- Vuelta atrás de B01 · lo que lee el agente «Conciliación»: quita SOLO las 8
-- tablas nuevas del B01 (las de C02 y C04 las seguía leyendo antes).
do $$
declare t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then return; end if;
  foreach t in array array['bank_agent_run', 'bank_aggregator_link', 'bank_match', 'bank_month_close', 'bank_movement', 'bank_rule', 'bank_rule_log', 'bank_statement'] loop
    if to_regclass('public.' || t) is not null then execute format('revoke select on table public.%I from conta_lectura', t); end if;
  end loop;
end $$;
