-- supabase/migrations/20261118T1951_e04_pasar_sola_al_leer.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261118_e04_pasar_sola_prueba.sql
-- cambia: public.conta_recibida_pasar_a · prueba: supabase/staging/sql/20261118_e04_pasar_sola_prueba.sql
--
-- E04 · La factura de otra sociedad del grupo se pasa sola. 2 de 3: lo que
-- CAMBIA EN CALIENTE. Va detrás de la 1950 (usa _conta_pasar_sola y _conta_recibida_mover).
--
--   7. Un disparador en supplier_invoice: al leerla (insert) o al cambiar su
--      lectura, se mira si va a nombre de otra sociedad de la cuenta y, si es así,
--      se pasa sola (_conta_pasar_sola). DIFERIDO (constraint trigger, initially
--      deferred): actúa al confirmar la transacción, cuando la llegada ya está
--      enlazada con su factura (conta_factura_desde_lectura crea la factura y
--      DESPUÉS enlaza la llegada): así la llegada se va con ella y en la sociedad
--      de la que sale no queda nada.
--   8. conta_recibida_pasar_a (el «Pasarla» del E03): lo mismo de siempre, sobre
--      lo común (_conta_recibida_mover), con su respaldo.
-- «Apunta sola» no cambia: con la pregunta en pie (_conta_de_quien) ya no la
-- apunta (1835); y la que se pasa sola la apunta, después, su sociedad.
-- Se puede pasar dos veces.
-- Vuelta atrás: supabase/vuelta-atras/20261118T1951_e04_pasar_sola_al_leer.down.sql

-- 7 · Al leerla, si es de otra sociedad, se pasa sola -----------------------------------------------
create or replace function public.tg_e04_pasar_sola()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  if new.recipient_answer is null and coalesce(new.reading, '{}'::jsonb) ? 'factura' then
    perform public._conta_pasar_sola(new.id);
  end if;
  return null;
end $function$;
comment on function public.tg_e04_pasar_sola() is 'E04: al leer una recibida (o cambiar su lectura), si va a nombre de otra sociedad de la cuenta, se pasa sola (_conta_pasar_sola). Diferido: al confirmar.';
revoke all on function public.tg_e04_pasar_sola() from public, anon, authenticated;

drop trigger if exists e04_pasar_sola on public.supplier_invoice;
create constraint trigger e04_pasar_sola after insert or update of reading on public.supplier_invoice
  deferrable initially deferred for each row execute function public.tg_e04_pasar_sola();

-- 8 · «Pasarla» sobre lo común ---------------------------------------------------------------------------
select public._respaldar_funcion('public.conta_recibida_pasar_a(uuid,uuid,text)', '20261118T1951_e04_pasar_sola_al_leer');
create or replace function public.conta_recibida_pasar_a(p_invoice uuid, p_company uuid, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare v public.supplier_invoice; r jsonb;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v.account_id)) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  -- E04 · Lo de siempre, sobre lo común (también lo usa Sumied cuando la pasa sola).
  r := public._conta_recibida_mover(p_invoice, p_company, coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona'), false, null);
  return r - 'desde_id' - 'desde' - 'sola';
end $function$;
comment on function public.conta_recibida_pasar_a(uuid, uuid, text) is 'E03 (E04: sobre _conta_recibida_mover): pasa una recibida (con su llegada y su actividad) a otra sociedad de la misma cuenta, sin asiento. No si tiene asiento validado, pagos, banco, impuesto, liquidación o recepción. Lo apunta en supplier_invoice_change.';
revoke all on function public.conta_recibida_pasar_a(uuid, uuid, text) from public, anon;
grant execute on function public.conta_recibida_pasar_a(uuid, uuid, text) to authenticated, service_role;
