-- ============================================================================
-- Folvy · Reconciliación — triggers de auto-print (UPDATE + INSERT)
-- Frente onboarding de impresión.
--
-- Julio aplicó DIRECTO a la BBDD la migración `autoprint_al_entrar_el_pedido`
-- (en el historial de Supabase, NO en el repo), que creó el trigger
-- `trg_auto_print_on_insert` (AFTER INSERT). El repo (F1) solo creaba el de
-- UPDATE; las migraciones posteriores solo re-crean la FUNCIÓN, no los triggers.
-- Sin este fichero, un `supabase db reset` desde el repo NO reproduciría el
-- disparo en INSERT (pedidos de plataforma que nacen order_status='accepted').
--
-- Aquí se versionan AMBOS triggers, idempotentes. La FUNCIÓN
-- tg_auto_print_on_accept() ya la definen F1 (…T1200) y copies (…T2200) — su
-- cuerpo distingue TG_OP INSERT/UPDATE y deduplica por source='auto', así que un
-- mismo cuerpo sirve a los dos triggers. Aplicar en vivo es NO-OP funcional
-- (drop if exists + create, resultado idéntico a lo ya existente).
-- ============================================================================

-- AFTER UPDATE → accepted (transición de estado del pedido).
drop trigger if exists trg_auto_print_on_accept on public.sale;
create trigger trg_auto_print_on_accept
  after update on public.sale
  for each row execute function public.tg_auto_print_on_accept();

-- AFTER INSERT → pedido que NACE 'accepted' (plataformas). Imprime al instante.
drop trigger if exists trg_auto_print_on_insert on public.sale;
create trigger trg_auto_print_on_insert
  after insert on public.sale
  for each row execute function public.tg_auto_print_on_accept();
