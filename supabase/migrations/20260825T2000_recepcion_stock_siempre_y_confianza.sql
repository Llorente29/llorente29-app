-- 20260825T2000_recepcion_stock_siempre_y_confianza.sql
-- APLICADA en producción el 25-08-2026.
--
-- ENCARGO Julio (25/08), tres piezas:
--   1. El stock entra SIEMPRE. `hold` deja de retener mercancía.
--   2. El contador de confianza se persiste (dejaba de calcularse al vuelo).
--   3. Y se conecta: al llegar al objetivo el local pasa solo a confirmación
--      directa; una corrección de oficina lo desactiva.
--
-- POR QUÉ (1): el modelo de retener hasta que oficina cerrase costó
-- 5 albaranes que entraron por la puerta, se escanearon, esperaron y acabaron
-- ANULADOS sin existir nunca en el sistema: ALB-00091 (1.361,20 €),
-- ALB-00092 (667,71 €), ALB-00106 (846,51 €) — los tres de CLOUDTOWN — más dos
-- de importe 0. Total 2.875,42 €. Un ajuste posterior es barato; una cocina
-- sin producto en el sistema, no.
--
-- MATIZ IMPORTANTE: esto NO rescata por sí solo a esos cinco. Sus líneas
-- llegaron con map_source='unmapped', sin artículo y sin cantidad base: no
-- había nada que postear. La causa raíz era el alta de códigos de proveedor
-- (en cuanto CLOUDTOWN los tuvo, sus albaranes mapean por 'code' y entran
-- solos). Lo que este cambio evita es que un albarán que SÍ se puede postear
-- se quede fuera del almacén solo porque la IA dudó del documento.
--
-- EL CONTADOR ES POR LOCAL, no por proveedor: mide si cocina cuenta bien, no
-- si el proveedor sirve bien. Umbral 30, en columna `goal`, ajustable por local
-- sin migración.

-- ── A · marca duradera de "recepción del asistente" ──────────────────────
-- El cálculo anterior detectaba al asistente por status='recibido', y esa señal
-- se perdía al confirmar: el propio código lo documentaba como error hacia el
-- lado seguro (contaba de menos). Con columna propia deja de perderse.
alter table public.goods_receipt
  add column if not exists via_assistant boolean not null default false;

update public.goods_receipt gr
   set via_assistant = true
 where not gr.via_assistant
   and ( gr.status = 'recibido'
         or exists (select 1 from public.goods_receipt_line l
                     where l.goods_receipt_id = gr.id and l.flagged_for_office) );

-- ── B · confianza por LOCAL ──────────────────────────────────────────────
create table if not exists public.location_receipt_trust (
  location_id            uuid primary key,
  account_id             uuid not null,
  streak                 integer not null default 0,
  goal                   integer not null default 30,
  assistant_receipts     integer not null default 0,
  corrected_receipts     integer not null default 0,
  direct_confirm_enabled boolean not null default false,
  enabled_at             timestamptz,
  last_correction_at     timestamptz,
  updated_at             timestamptz not null default now()
);
alter table public.location_receipt_trust enable row level security;
drop policy if exists location_receipt_trust_read on public.location_receipt_trust;
create policy location_receipt_trust_read on public.location_receipt_trust
  for select using (public.belongs_to_account(account_id));

-- ── C · recálculo de la racha (misma regla que tenía el cliente) ─────────
-- Recalcula desde la verdad en vez de incrementar: no puede desincronizarse.
--   candidata  = recepción del asistente, 'recibido' o 'confirmado'
--   corregida  = alguna línea SIN marcar por cocina que oficina corrigió
--                (discrepancy_reason con el prefijo 'cambio oficina: ')
-- Una línea que cocina marcó ⚑ y oficina corrige NO rompe la racha: cocina ya
-- avisó de que no estaba segura.
CREATE OR REPLACE FUNCTION public.refresh_location_receipt_trust(p_location_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_goal       integer;
  v_streak     integer := 0;
  v_total      integer := 0;
  v_corr       integer := 0;
  v_last_corr  timestamptz;
  v_enabled    boolean;
  v_was        boolean;
  r            record;
BEGIN
  IF p_location_id IS NULL THEN RETURN; END IF;
  SELECT account_id INTO v_account_id FROM public.locations WHERE id = p_location_id;
  IF v_account_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(goal, 30), COALESCE(direct_confirm_enabled, false)
    INTO v_goal, v_was
    FROM public.location_receipt_trust WHERE location_id = p_location_id;
  v_goal := COALESCE(v_goal, 30);
  v_was  := COALESCE(v_was, false);

  FOR r IN
    SELECT gr.id, gr.received_at, gr.receipt_date, gr.created_at,
           EXISTS (SELECT 1 FROM public.goods_receipt_line l
                    WHERE l.goods_receipt_id = gr.id
                      AND l.discrepancy_reason LIKE 'cambio oficina: %'
                      AND NOT COALESCE(l.flagged_for_office, false)) AS corregida
      FROM public.goods_receipt gr
     WHERE gr.location_id = p_location_id
       AND gr.via_assistant
       AND gr.status IN ('recibido', 'confirmado')
     ORDER BY gr.receipt_date DESC, gr.created_at DESC
     LIMIT 200
  LOOP
    v_total := v_total + 1;
    IF r.corregida THEN
      v_corr := v_corr + 1;
      IF v_last_corr IS NULL THEN
        v_last_corr := COALESCE(r.received_at, r.created_at);
      END IF;
    END IF;
    IF v_corr = 0 THEN
      v_streak := v_streak + 1;
    END IF;
  END LOOP;

  IF v_streak > v_goal THEN v_streak := v_goal; END IF;
  v_enabled := v_streak >= v_goal;

  INSERT INTO public.location_receipt_trust AS t (
    location_id, account_id, streak, goal, assistant_receipts, corrected_receipts,
    direct_confirm_enabled, enabled_at, last_correction_at, updated_at)
  VALUES (
    p_location_id, v_account_id, v_streak, v_goal, v_total, v_corr,
    v_enabled, CASE WHEN v_enabled THEN now() END, v_last_corr, now())
  ON CONFLICT (location_id) DO UPDATE
    SET streak = EXCLUDED.streak,
        assistant_receipts = EXCLUDED.assistant_receipts,
        corrected_receipts = EXCLUDED.corrected_receipts,
        direct_confirm_enabled = EXCLUDED.direct_confirm_enabled,
        enabled_at = CASE WHEN EXCLUDED.direct_confirm_enabled
                          THEN COALESCE(t.enabled_at, now()) END,
        last_correction_at = EXCLUDED.last_correction_at,
        account_id = EXCLUDED.account_id,
        updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_location_receipt_trust(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_location_receipt_trust(uuid) FROM anon, authenticated;

-- ── D · una corrección de oficina recalcula (y puede apagar la confianza) ─
CREATE OR REPLACE FUNCTION public.tg_goods_receipt_line_trust()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_loc uuid;
BEGIN
  IF NEW.discrepancy_reason IS NOT DISTINCT FROM OLD.discrepancy_reason THEN
    RETURN NEW;
  END IF;
  SELECT location_id INTO v_loc FROM public.goods_receipt WHERE id = NEW.goods_receipt_id;
  IF v_loc IS NOT NULL THEN
    PERFORM public.refresh_location_receipt_trust(v_loc);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_goods_receipt_line_trust ON public.goods_receipt_line;
CREATE TRIGGER trg_goods_receipt_line_trust
  AFTER UPDATE OF discrepancy_reason ON public.goods_receipt_line
  FOR EACH ROW EXECUTE FUNCTION public.tg_goods_receipt_line_trust();

-- ── E · EL STOCK ENTRA SIEMPRE ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.receive_goods_receipt(p_receipt_id uuid, p_hold boolean DEFAULT false)
 RETURNS TABLE(posted_lines integer, skipped_lines integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_receipt goods_receipt%rowtype;
  v_posted  integer := 0;
  v_skipped integer := 0;
  v_needs   boolean;
  v_direct  boolean := false;
begin
  select * into v_receipt from goods_receipt where id = p_receipt_id;
  if not found then
    raise exception 'receive_goods_receipt: albarán % no existe', p_receipt_id;
  end if;
  if not belongs_to_account(v_receipt.account_id) then
    raise exception 'receive_goods_receipt: sin acceso al albarán %', p_receipt_id;
  end if;
  if v_receipt.status <> 'borrador' then
    raise exception 'receive_goods_receipt: el albarán % no está en borrador (está %)',
      p_receipt_id, v_receipt.status;
  end if;

  -- El stock entra SIEMPRE, dude o no la IA. Lo que no se puede postear (línea
  -- sin artículo o sin cantidad base) sale como skipped y deja needs_review.
  select p.posted_lines, p.skipped_lines into v_posted, v_skipped
    from public._post_goods_receipt_lines(p_receipt_id) p;

  v_needs := p_hold or v_skipped > 0 or coalesce(v_receipt.needs_review, false);

  update goods_receipt
    set status = 'recibido', received_at = coalesce(received_at, now()),
        needs_review = v_needs, via_assistant = true, updated_at = now()
    where id = p_receipt_id;

  if v_receipt.purchase_order_id is null then
    v_receipt.purchase_order_id := public.auto_link_goods_receipt_to_order(p_receipt_id);
  end if;
  if v_receipt.purchase_order_id is not null then
    perform public._match_order_lines_for_order(v_receipt.purchase_order_id);
    perform recompute_purchase_order_status(v_receipt.purchase_order_id);
  end if;

  -- Confianza ganada: el albarán se cierra solo, sin pasar por oficina. Solo si
  -- no hay nada dudoso. Si confirm_goods_receipt no puede cerrarlo (falta nº de
  -- albarán, proveedor o alguna línea sin decidir) se queda en 'recibido': la
  -- recepción NUNCA falla por esto.
  select coalesce(t.direct_confirm_enabled, false) into v_direct
    from public.location_receipt_trust t where t.location_id = v_receipt.location_id;

  if coalesce(v_direct, false) and not v_needs then
    begin
      perform public.confirm_goods_receipt(p_receipt_id);
    exception when others then
      raise warning 'receive_goods_receipt: confirmación directa no pudo cerrar %: %',
        coalesce(v_receipt.code, p_receipt_id::text), sqlerrm;
    end;
  end if;

  perform public.refresh_location_receipt_trust(v_receipt.location_id);

  posted_lines := v_posted; skipped_lines := v_skipped;
  return next;
end;
$function$;

-- ── F · sembrar la confianza de los locales que ya tienen recepciones ─────
do $$
declare r record;
begin
  for r in select distinct location_id from public.goods_receipt where location_id is not null loop
    perform public.refresh_location_receipt_trust(r.location_id);
  end loop;
end $$;

notify pgrst, 'reload schema';

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name='goods_receipt' and column_name='via_assistant') then
    raise exception 'Falta goods_receipt.via_assistant';
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_goods_receipt_line_trust') then
    raise exception 'Falta trg_goods_receipt_line_trust';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='receive_goods_receipt'
                   and pg_get_functiondef(p.oid) like '%El stock entra SIEMPRE%') then
    raise exception 'receive_goods_receipt no postea siempre';
  end if;
end $$;

-- VERIFICADO tras aplicar:
--   · receive_goods_receipt ya no contiene la rama `if p_hold then` que saltaba
--     el posteo; siempre llama a _post_goods_receipt_lines.
--   · Siembra: Alcalá 4 de 30 (0 correcciones) — mismo número que mostraba la
--     pantalla calculándolo al vuelo. Los demás locales, 0.
--   · Trigger probado en vivo sobre una línea de un albarán ANULADO y revertido:
--     disparó el recálculo del local correcto y dejó la racha intacta (los
--     anulados no son candidatos).
