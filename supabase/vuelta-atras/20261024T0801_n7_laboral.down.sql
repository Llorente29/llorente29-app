-- Vuelta atrás de 20261024T0801_n7_laboral.sql (N7).
-- Quita fuente_nominas_mes_v1 y las dos columnas de payroll_cost.
-- PARA si alguna nómina ya tiene IRPF o SS del trabajador: quitar las columnas
-- borraría ese dato. Entonces se deja como está y se decide a mano.
-- Un solo bloque: el freno y lo que quita, juntos (si para, no quita nada).

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'payroll_cost' and column_name = 'irpf')
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'payroll_cost' and column_name = 'employee_ss') then
    if exists (select 1 from public.payroll_cost where irpf is not null or employee_ss is not null) then
      raise exception 'N7 · vuelta atrás: hay nóminas con IRPF o SS del trabajador. No se quitan las columnas.';
    end if;
  end if;
  drop function if exists public.fuente_nominas_mes_v1(uuid, date);
  alter table public.payroll_cost
    drop column if exists irpf,
    drop column if exists employee_ss;
end $$;
