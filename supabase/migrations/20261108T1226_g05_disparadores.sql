-- supabase/migrations/20261108T1226_g05_disparadores.sql
--
-- G05 · Los dos disparadores del encargo, aparte de la 1225 porque van sobre
-- tablas que existen (el analizador los cuenta como «cambia»):
--
-- cambia: public.user_profiles · prueba: supabase/staging/sql/20261108_g05_entrar_en_el_cliente_prueba.sql
-- cambia: public.company_tax_presenter · prueba: supabase/staging/sql/20261108_g05_entrar_en_el_cliente_prueba.sql
--
--   _conta_bienvenida_heredada()  antes de insertar en user_profiles: una fila
--       nueva de quien ya hizo la bienvenida en otra cuenta la copia. Vale para
--       conta_despacho_entrar y para invitar-persona, sin tocar la función.
--   _conta_despacho_retirar()     después de cambiar o borrar en
--       company_tax_presenter: si la cuenta ya no tiene ninguna sociedad con
--       permiso vivo de esa asesoría, sus accesos de despacho se apagan
--       (active = false). No se borran: queda el rastro.
--
-- Va después de la 1225 (usa user_profiles.advisor_account_id). No toca
-- ninguna fila al aplicarse. Nada en el camino del pedido.
--
-- Vuelta atrás: supabase/vuelta-atras/20261108T1226_g05_disparadores.down.sql
-- Prueba: supabase/staging/sql/20261108_g05_entrar_en_el_cliente_prueba.sql

-- ── La bienvenida, de raíz ──────────────────────────────────────────────────
-- Una fila nueva de user_profiles para quien ya completó la bienvenida en otra
-- cuenta la hereda (las dos fechas juntas: user_profiles_welcome_requires_terms).
-- Vale para conta_despacho_entrar y para invitar-persona, sin tocar la función.
create or replace function public._conta_bienvenida_heredada()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_terms timestamptz; v_welcome timestamptz;
begin
  if new.welcome_completed_at is null and new.user_id is not null then
    select up.terms_accepted_at, up.welcome_completed_at into v_terms, v_welcome
      from public.user_profiles up
     where up.user_id = new.user_id and up.welcome_completed_at is not null and up.terms_accepted_at is not null
     order by up.welcome_completed_at desc
     limit 1;
    if v_welcome is not null then
      new.terms_accepted_at := v_terms;
      new.welcome_completed_at := v_welcome;
    end if;
  end if;
  return new;
end $$;
comment on function public._conta_bienvenida_heredada() is
  'G05 (08/11/2026). Disparador: una fila nueva de user_profiles de quien ya hizo la bienvenida en otra cuenta copia terms_accepted_at y welcome_completed_at. Así no vuelve a ver «Activa tu cuenta».';
revoke all on function public._conta_bienvenida_heredada() from public, anon, authenticated;
create or replace trigger user_profiles_bienvenida_heredada before insert on public.user_profiles
  for each row execute function public._conta_bienvenida_heredada();

-- ── Se retira solo ──────────────────────────────────────────────────────────
create or replace function public._conta_despacho_retirar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.advisor_account_id is null or old.account_id is null then return null; end if;
  if not exists (
    select 1 from public.company_tax_presenter t
     where t.account_id = old.account_id and t.advisor_account_id = old.advisor_account_id
       and t.mode = 'advisor' and t.consented_at is not null and t.revoked_at is null) then
    update public.user_profiles
       set active = false
     where account_id = old.account_id and advisor_account_id = old.advisor_account_id and active;
  end if;
  return null;
end $$;
comment on function public._conta_despacho_retirar() is
  'G05 (08/11/2026). Disparador de company_tax_presenter: cuando la cuenta ya no tiene ninguna sociedad con permiso vivo de esa asesoría, apaga (active = false) sus accesos de despacho en la cuenta. No los borra.';
revoke all on function public._conta_despacho_retirar() from public, anon, authenticated;
create or replace trigger company_tax_presenter_despacho_retirar after update or delete on public.company_tax_presenter
  for each row execute function public._conta_despacho_retirar();
