-- ============================================================================
-- C06b · NO COMPENSACIÓN EN LOS TERCEROS: el balance va por el saldo de cada
-- cliente, deudor, proveedor y acreedor. GENERADA por scripts/conta/cuentas-anuales.mjs
-- (scripts/conta/lib/cuentasAnuales.mjs, TERCEROS_POR_SALDO): no se edita a mano.
-- ----------------------------------------------------------------------------
-- autorizo: hace falta (update sobre filas de serie que existen).
--
-- Respuesta 6 de Julio, tarea 1: «El balance se hace según la norma. No se
-- compensan saldos de distinto signo dentro de clientes ni de proveedores».
-- PGC, primera parte, Marco Conceptual, 3.º, 5. No compensación; tercera
-- parte, I, 6.ª Balance, 2 (cita literal en docs/conta/C06b_informe_respuesta_6.md).
--
-- Qué hace, solo en las filas de SERIE (company_id null; las propias de cada
-- empresa no se tocan, y hoy no hay ninguna de estos grupos):
--   1. 42 filas del modelo pasan a ir por signo (by_balance): las de los
--      clientes y deudores, para el saldo deudor; las de los proveedores y
--      acreedores, para el saldo acreedor. Las que no están así, se paran.
--   2. 42 filas nuevas para el otro signo: el cliente o deudor acreedor
--      al pasivo (con los anticipos de clientes), el proveedor o acreedor
--      deudor al activo (con los deudores varios).
--
-- Vuelta atrás: supabase/vuelta-atras/20261111T0600_c06b_terceros_por_saldo.down.sql
-- ============================================================================

do $$
declare n int;
begin
  update public.annual_accounts_mapping m set by_balance = x.lado
    from (values
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
     and m.line_code = x.line_code and m.account_prefix = x.prefijo and m.by_balance is null and m.origin = 'boe';
  get diagnostics n = row_count;
  if n <> 42 then raise exception 'C06b 0600: esperaba pasar a «por signo» 42 filas de serie y serían %. No se toca nada.', n; end if;
end $$;

insert into public.annual_accounts_mapping (model, statement, line_code, account_prefix, sign, by_balance, origin, any_sign, note, legal_ref) values
('normal', 'balance', 'PNP.C.V.3', '430', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('normal', 'balance', 'PNP.C.V.3', '431', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('normal', 'balance', 'PNP.C.V.3', '432', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('normal', 'balance', 'PNP.C.V.3', '435', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('normal', 'balance', 'PNP.C.V.3', '436', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('normal', 'balance', 'PNP.C.V.3', '433', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('normal', 'balance', 'PNP.C.V.3', '434', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('normal', 'balance', 'PNP.C.V.3', '44', 'suma', 'acreedor', 'boe', false, 'Deudor con saldo acreedor: es una deuda con él. Va al pasivo, con los acreedores; no se compensa con los demás deudores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('normal', 'balance', 'ACT.B.III.3', '400', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('normal', 'balance', 'ACT.B.III.3', '401', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('normal', 'balance', 'ACT.B.III.3', '405', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('normal', 'balance', 'ACT.B.III.3', '403', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('normal', 'balance', 'ACT.B.III.3', '404', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('normal', 'balance', 'ACT.B.III.3', '41', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'PNP.C.V.2', '430', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'PNP.C.V.2', '431', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'PNP.C.V.2', '432', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'PNP.C.V.2', '433', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'PNP.C.V.2', '434', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'PNP.C.V.2', '435', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'PNP.C.V.2', '436', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'PNP.C.V.2', '44', 'suma', 'acreedor', 'boe', false, 'Deudor con saldo acreedor: es una deuda con él. Va al pasivo, con los acreedores; no se compensa con los demás deudores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'ACT.B.III.3', '400', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'ACT.B.III.3', '401', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'ACT.B.III.3', '403', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'ACT.B.III.3', '404', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'ACT.B.III.3', '405', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('abreviado', 'balance', 'ACT.B.III.3', '41', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'PNP.C.IV.2', '430', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'PNP.C.IV.2', '431', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'PNP.C.IV.2', '432', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'PNP.C.IV.2', '433', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'PNP.C.IV.2', '434', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'PNP.C.IV.2', '435', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'PNP.C.IV.2', '436', 'suma', 'acreedor', 'boe', false, 'Cliente con saldo acreedor: es una deuda con él. Va al pasivo, con los anticipos de clientes; no se compensa con los demás clientes (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'PNP.C.IV.2', '44', 'suma', 'acreedor', 'boe', false, 'Deudor con saldo acreedor: es una deuda con él. Va al pasivo, con los acreedores; no se compensa con los demás deudores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'ACT.B.II.3', '400', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'ACT.B.II.3', '401', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'ACT.B.II.3', '403', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'ACT.B.II.3', '404', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'ACT.B.II.3', '405', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2'),
('pymes', 'balance', 'ACT.B.II.3', '41', 'suma', 'deudor', 'boe', false, 'Proveedor o acreedor con saldo deudor: es un crédito. Va al activo, con los deudores varios; no se compensa con los demás proveedores (no compensación).', 'RD 1514/2007 (y 1515/2007), primera parte, Marco Conceptual, 3.º Principios contables, 5. No compensación; tercera parte, I. Normas de elaboración, 6.ª Balance, 2')
on conflict (model, statement, line_code, account_prefix) where company_id is null do nothing;
