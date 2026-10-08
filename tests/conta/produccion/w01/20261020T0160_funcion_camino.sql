-- cambia: public.kds_board · prueba: supabase/staging/sql/20261020_prueba_kds_board.sql
-- Ejemplo W01: reemplazar una función del camino del pedido (misma firma), declarado.
create or replace function public.kds_board(p_location uuid, p_token text)
returns jsonb language plpgsql as $$
begin
  return '[]'::jsonb;
end $$;
