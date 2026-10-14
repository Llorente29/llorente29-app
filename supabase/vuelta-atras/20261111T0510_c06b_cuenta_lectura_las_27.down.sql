-- supabase/vuelta-atras/20261111T0510_c06b_cuenta_lectura_las_27.down.sql
--
-- Vuelta atrás de 20261111T0510_c06b_cuenta_lectura_las_27.sql: las subcuentas
-- «migrated» sin importación del plan vuelven a no tener la lectura escrita
-- (import_run_id null), como antes de la 0510. Solo esas: las creadas antes
-- del 14/10. La 0500 no existe en producción antes de ese día, así que una
-- subcuenta de antes solo pudo recibir su lectura de la 0510; las que dé de
-- alta el importador después la llevan desde que nacen y se quedan.
--
-- Escribe exactamente las 27 o para.

do $$
declare n int;
begin
  update public.company_account a set import_run_id = null
   where a.source = 'migrated' and a.import_id is null and a.import_run_id is not null
     and a.created_at < timestamptz '2026-10-14 00:00:00+00';
  get diagnostics n = row_count;
  if n <> 27 then
    raise exception 'Vuelta atrás de la 0510: esperaba 27 subcuentas y serían %. No se toca nada.', n;
  end if;
end $$;
