-- K13 · vuelta atrás de 20261124T0001: quita la función y la tabla de los tramos del reparto analítico. Lo que se
-- hubiera repartido desde la tanda se pierde con la tabla (la propuesta vuelve a dar una línea por gasto).
drop function if exists public.conta_recibida_reparto_linea(uuid, int, jsonb, text);
drop table if exists public.supplier_invoice_expense_tramo;
