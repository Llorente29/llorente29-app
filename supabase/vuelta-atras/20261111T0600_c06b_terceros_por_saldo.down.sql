-- supabase/vuelta-atras/20261111T0600_c06b_terceros_por_saldo.down.sql
-- GENERADA por scripts/conta/cuentas-anuales.mjs. Vuelta atrás de la 0600: fuera
-- las filas del otro signo y las del modelo vuelven a ir sin signo, como en la C05.
-- Solo filas de serie (company_id null). Toca exactamente las suyas o para.

do $$
declare n int;
begin
  delete from public.annual_accounts_mapping m using (values
      ('normal', 'PNP.C.V.3', '430', 'acreedor'),
      ('normal', 'PNP.C.V.3', '431', 'acreedor'),
      ('normal', 'PNP.C.V.3', '432', 'acreedor'),
      ('normal', 'PNP.C.V.3', '435', 'acreedor'),
      ('normal', 'PNP.C.V.3', '436', 'acreedor'),
      ('normal', 'PNP.C.V.3', '433', 'acreedor'),
      ('normal', 'PNP.C.V.3', '434', 'acreedor'),
      ('normal', 'PNP.C.V.3', '44', 'acreedor'),
      ('normal', 'ACT.B.III.3', '400', 'deudor'),
      ('normal', 'ACT.B.III.3', '401', 'deudor'),
      ('normal', 'ACT.B.III.3', '405', 'deudor'),
      ('normal', 'ACT.B.III.3', '403', 'deudor'),
      ('normal', 'ACT.B.III.3', '404', 'deudor'),
      ('normal', 'ACT.B.III.3', '41', 'deudor'),
      ('abreviado', 'PNP.C.V.2', '430', 'acreedor'),
      ('abreviado', 'PNP.C.V.2', '431', 'acreedor'),
      ('abreviado', 'PNP.C.V.2', '432', 'acreedor'),
      ('abreviado', 'PNP.C.V.2', '433', 'acreedor'),
      ('abreviado', 'PNP.C.V.2', '434', 'acreedor'),
      ('abreviado', 'PNP.C.V.2', '435', 'acreedor'),
      ('abreviado', 'PNP.C.V.2', '436', 'acreedor'),
      ('abreviado', 'PNP.C.V.2', '44', 'acreedor'),
      ('abreviado', 'ACT.B.III.3', '400', 'deudor'),
      ('abreviado', 'ACT.B.III.3', '401', 'deudor'),
      ('abreviado', 'ACT.B.III.3', '403', 'deudor'),
      ('abreviado', 'ACT.B.III.3', '404', 'deudor'),
      ('abreviado', 'ACT.B.III.3', '405', 'deudor'),
      ('abreviado', 'ACT.B.III.3', '41', 'deudor'),
      ('pymes', 'PNP.C.IV.2', '430', 'acreedor'),
      ('pymes', 'PNP.C.IV.2', '431', 'acreedor'),
      ('pymes', 'PNP.C.IV.2', '432', 'acreedor'),
      ('pymes', 'PNP.C.IV.2', '433', 'acreedor'),
      ('pymes', 'PNP.C.IV.2', '434', 'acreedor'),
      ('pymes', 'PNP.C.IV.2', '435', 'acreedor'),
      ('pymes', 'PNP.C.IV.2', '436', 'acreedor'),
      ('pymes', 'PNP.C.IV.2', '44', 'acreedor'),
      ('pymes', 'ACT.B.II.3', '400', 'deudor'),
      ('pymes', 'ACT.B.II.3', '401', 'deudor'),
      ('pymes', 'ACT.B.II.3', '403', 'deudor'),
      ('pymes', 'ACT.B.II.3', '404', 'deudor'),
      ('pymes', 'ACT.B.II.3', '405', 'deudor'),
      ('pymes', 'ACT.B.II.3', '41', 'deudor')
    ) x(model, line_code, prefijo, lado)
   where m.company_id is null and m.account_id is null and m.statement = 'balance' and m.model = x.model
     and m.line_code = x.line_code and m.account_prefix = x.prefijo and m.by_balance = x.lado;
  get diagnostics n = row_count;
  if n <> 42 then raise exception 'Vuelta atrás de la 0600: esperaba quitar 42 filas y serían %. No se toca nada.', n; end if;
  update public.annual_accounts_mapping m set by_balance = null from (values
      ('normal', 'ACT.B.III.1', '430', 'deudor'),
      ('normal', 'ACT.B.III.1', '431', 'deudor'),
      ('normal', 'ACT.B.III.1', '432', 'deudor'),
      ('normal', 'ACT.B.III.1', '435', 'deudor'),
      ('normal', 'ACT.B.III.1', '436', 'deudor'),
      ('normal', 'ACT.B.III.2', '433', 'deudor'),
      ('normal', 'ACT.B.III.2', '434', 'deudor'),
      ('normal', 'ACT.B.III.3', '44', 'deudor'),
      ('normal', 'PNP.C.V.1', '400', 'acreedor'),
      ('normal', 'PNP.C.V.1', '401', 'acreedor'),
      ('normal', 'PNP.C.V.1', '405', 'acreedor'),
      ('normal', 'PNP.C.V.2', '403', 'acreedor'),
      ('normal', 'PNP.C.V.2', '404', 'acreedor'),
      ('normal', 'PNP.C.V.3', '41', 'acreedor'),
      ('abreviado', 'ACT.B.III.1', '430', 'deudor'),
      ('abreviado', 'ACT.B.III.1', '431', 'deudor'),
      ('abreviado', 'ACT.B.III.1', '432', 'deudor'),
      ('abreviado', 'ACT.B.III.1', '433', 'deudor'),
      ('abreviado', 'ACT.B.III.1', '434', 'deudor'),
      ('abreviado', 'ACT.B.III.1', '435', 'deudor'),
      ('abreviado', 'ACT.B.III.1', '436', 'deudor'),
      ('abreviado', 'ACT.B.III.3', '44', 'deudor'),
      ('abreviado', 'PNP.C.V.1', '400', 'acreedor'),
      ('abreviado', 'PNP.C.V.1', '401', 'acreedor'),
      ('abreviado', 'PNP.C.V.1', '403', 'acreedor'),
      ('abreviado', 'PNP.C.V.1', '404', 'acreedor'),
      ('abreviado', 'PNP.C.V.1', '405', 'acreedor'),
      ('abreviado', 'PNP.C.V.2', '41', 'acreedor'),
      ('pymes', 'ACT.B.II.1', '430', 'deudor'),
      ('pymes', 'ACT.B.II.1', '431', 'deudor'),
      ('pymes', 'ACT.B.II.1', '432', 'deudor'),
      ('pymes', 'ACT.B.II.1', '433', 'deudor'),
      ('pymes', 'ACT.B.II.1', '434', 'deudor'),
      ('pymes', 'ACT.B.II.1', '435', 'deudor'),
      ('pymes', 'ACT.B.II.1', '436', 'deudor'),
      ('pymes', 'ACT.B.II.3', '44', 'deudor'),
      ('pymes', 'PNP.C.IV.1', '400', 'acreedor'),
      ('pymes', 'PNP.C.IV.1', '401', 'acreedor'),
      ('pymes', 'PNP.C.IV.1', '403', 'acreedor'),
      ('pymes', 'PNP.C.IV.1', '404', 'acreedor'),
      ('pymes', 'PNP.C.IV.1', '405', 'acreedor'),
      ('pymes', 'PNP.C.IV.2', '41', 'acreedor')
    ) x(model, line_code, prefijo, lado)
   where m.company_id is null and m.account_id is null and m.statement = 'balance' and m.model = x.model
     and m.line_code = x.line_code and m.account_prefix = x.prefijo and m.by_balance = x.lado and m.origin = 'boe';
  get diagnostics n = row_count;
  if n <> 42 then raise exception 'Vuelta atrás de la 0600: esperaba devolver 42 filas a sin signo y serían %. No se toca nada.', n; end if;
end $$;
