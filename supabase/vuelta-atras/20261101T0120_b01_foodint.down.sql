-- Vuelta atrás de B01 · 3: quita la fila de ajustes del banco de Foodint (la tabla la quita la de 0100).
delete from public.bank_settings where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';
