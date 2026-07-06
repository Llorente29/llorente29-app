-- 20260706T2100_n2_budget.sql
-- Módulo Social · N2 (Gemini viste el fondo) · Capa 0 — cimientos
--
-- N2 = edición de imagen con Gemini 2.5 Flash Image: se le pasa la foto REAL y se le pide
-- cambiar solo el entorno (plato intocable). La clave vive en el Vault (google_ai_key), la
-- llamada la hace un Edge, y el TOPE DE GASTO se controla aquí, server-side (a prueba de
-- manipulación del worker local).
--
-- N2 nace apagado por cuenta (n2_enabled=false); se enciende desde Ajustes. Si N2 falla o se
-- alcanza el tope diario → el worker cae a N1 automático (nunca sin imagen).

begin;

alter table public.social_config
  add column if not exists n2_enabled   boolean not null default false,
  add column if not exists n2_daily_cap int     not null default 30;

create table if not exists public.social_n2_usage (
  account_id uuid not null references accounts(id) on delete cascade,
  day        date not null default (now() at time zone 'utc')::date,
  count      int  not null default 0,
  primary key (account_id, day)
);

-- ¿queda presupuesto de N2 hoy? Si sí, incrementa y devuelve true. Atómico:
-- el UPDATE condicional (count < cap) + RETURNING garantiza que no se pase del tope.
create or replace function public.claim_n2_budget(p_account_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_cap int; v_enabled boolean; v_day date := (now() at time zone 'utc')::date; v_new int;
begin
  select n2_enabled, n2_daily_cap into v_enabled, v_cap from social_config where account_id = p_account_id;
  if not coalesce(v_enabled, false) then return false; end if;
  insert into social_n2_usage(account_id, day, count) values (p_account_id, v_day, 0)
    on conflict (account_id, day) do nothing;
  update social_n2_usage set count = count + 1
    where account_id = p_account_id and day = v_day and count < coalesce(v_cap, 0)
    returning count into v_new;
  return v_new is not null;   -- null = tope alcanzado
end $$;

revoke all on function public.claim_n2_budget(uuid) from public, anon, authenticated;
grant  execute on function public.claim_n2_budget(uuid) to service_role;

commit;
