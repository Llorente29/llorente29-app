-- supabase/vuelta-atras/20261029T0845_s02_modelo_180.down.sql
--
-- Vuelta atrás de 20261029T0845_s02_modelo_180: quita las tres funciones del
-- 180 y la tabla del inmueble arrendado (company_lease), y devuelve el CHECK
-- de lo comprobado a sus diecisiete claves. Antes, borra lo comprobado con las
-- tres claves nuevas (si no, el CHECK de antes no entra). Los borradores del
-- 180 y sus casillas se quedan (son datos, y el CHECK de tax_return no cambia).
-- La tabla del inmueble sí se va con sus filas: solo la escribe la 0845.
-- La tabla, lo PRIMERO: soltar sus claves ajenas bloquea accounts, company y
-- supplier, y pedirlo sin tener nada más cogido evita el interbloqueo que dio
-- staging (40P01) con otra sesión escribiendo a la vez.

drop table if exists public.company_lease;
delete from public.tax_return_check where check_key in ('payees_180_nif', 'payees_180_province', 'lease_180');
drop function if exists public.conta_impuesto_180_fichero(uuid, uuid);
drop function if exists public.conta_impuesto_180_inmueble_poner(uuid, uuid, jsonb);
drop function if exists public.conta_impuesto_180_calcular(uuid, int);
alter table public.tax_return_check drop constraint if exists tax_return_check_check_key_check;
alter table public.tax_return_check add constraint tax_return_check_check_key_check
  check (check_key in ('book_vs_303', 'ledger_477_472', 'sum_303_vs_390', 'sum_111_vs_190', 'sum_115_vs_180',
                       'third_parties_347', 'mail_invoices_missing', 'out_of_period', 'file_layout', 'previous_offset',
                       'ledger_4751', 'payees_111', 'withholding_unclassified', 'base_200',
                       'payees_190_nif', 'payees_190_province', 'payroll_190'));
