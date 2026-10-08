-- Ejemplo W01: create or replace con OTRA firma de una que existe = sobrecarga (regla 2 de CLAUDE.md).
create or replace function public.conta_reabrir_mes(p_company uuid, p_mes date)
returns jsonb language sql as $$ select '{}'::jsonb $$;
