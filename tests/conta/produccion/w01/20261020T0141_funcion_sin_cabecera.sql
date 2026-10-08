-- Ejemplo W01: reemplazar una función que existe, con la misma firma, declarado y con prueba.
create or replace function public.conta_reabrir_mes(p_company uuid, p_mes date, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object('ok', true);
end $$;
