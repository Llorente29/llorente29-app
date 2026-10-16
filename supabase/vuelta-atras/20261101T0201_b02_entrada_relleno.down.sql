-- Vuelta atrás de B02 · 0201: vacía la contraparte y el tipo de los movimientos
-- del Excel de BBVA. No se pierde nada: salen del texto del banco (bank_concept,
-- que no se toca) y se vuelven a sacar igual aplicando la 0201 otra vez. Lo
-- importado después con la 0200 lleva los mismos valores y también se vacía.
update public.bank_movement m
   set movement_type = null, counterparty = null
  from public.bank_statement s
 where s.id = m.statement_id and s.format = 'csv:bbva' and (m.movement_type is not null or m.counterparty is not null);
