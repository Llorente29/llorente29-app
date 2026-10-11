-- ============================================================================
-- Vuelta atrás de Compras · 4 · la forma de facturar de los que ya la tenían.
-- Deja vacía la forma de las tres fichas de Foodint que puso la 0130, solo si
-- sigue siendo la que puso (si alguien la cambió después en la ficha, se deja).
-- ============================================================================
update public.supplier set invoicing_mode = null
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and ((id in ('3048d4f8-b1eb-4352-ad2d-64583b0f4f93', '88da6412-9db6-4489-8349-d88e2a6a67fa') and invoicing_mode = 'per_delivery')
        or (id = '8d53a379-1aa6-4c49-a7aa-dcfaeb353b5e' and invoicing_mode = 'monthly_settlement'));
