-- Vuelta atrás de «C04b · T2 — lo que leerá el agente Con Diez».
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then return; end if;
  revoke select on table public.import_run, public.external_send, public.external_entry_snapshot,
    public.external_compare_day, public.external_document, public.external_balance_witness,
    public.account_connector from conta_lectura;
end $$;
