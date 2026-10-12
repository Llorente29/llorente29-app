-- Vuelta atrás de 20261019T0140_diez_linea_negativa.sql.
--
-- Quita la marca. Si ya hay líneas traídas de Diez con ella, se pierde en qué
-- lado iba el negativo (el importe y el saldo no cambian). El front que la lee
-- tiene que haberse retirado antes.

alter table public.journal_line drop constraint if exists journal_line_external_negative_side_check;
alter table public.journal_line drop column if exists external_negative_side;
