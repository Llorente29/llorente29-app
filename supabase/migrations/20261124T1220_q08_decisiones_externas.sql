-- 20261124T1220_q08_decisiones_externas.sql
--
-- Q08 · Cargar las decisiones de QBO (el Excel «Atar clientes GoCardless» del 12/11, contestado). AÑADE dos funciones;
-- no cambia ni borra nada. Las llama el botón «Cargar decisiones de QBO» de Clientes y cuotas, fila a fila, con el
-- origen escrito («QBO, Excel del 12/11»). El Excel, con sus nombres y correos, no pasa por el repositorio (T11): lo
-- sube Julio en producción y la pantalla lo lee en el navegador.
--
--   1 · conta_gc_enlace_decision_externa: ata un cliente de GoCardless a su ficha como «Es esta» (la misma función
--       del G06, conta_gc_enlace_confirmar: los dos enlaces de antes, la decisión y la diferencia «sin ficha») y deja
--       escrito QUIÉN lo decidió: el origen (QBO), y quién lo cargó.
--   2 · conta_gc_enlace_pendiente_externo: lo que no se entiende no se adivina. Queda «propuesto», sin ficha, con el
--       texto de QBO entre comillas, para que una persona lo revise. No pisa lo que ya decidió una persona.
--
-- Necesita la 1110 del G06 (conta_gc_enlace_confirmar y el estado «sin_ficha»): va en una tanda detrás de la suya.

create or replace function public.conta_gc_enlace_decision_externa(p_company uuid, p_gc_cliente text, p_party uuid, p_origen text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_r jsonb; v_quien text := public.conta_nombre_actor(); v_cliente text; v_origen text := nullif(btrim(left(coalesce(p_origen, ''), 80)), '');
begin
  if v_origen is null then raise exception 'Falta quién lo decidió (el origen).' using errcode = '22023'; end if;
  v_r := public.conta_gc_enlace_confirmar(p_company, p_gc_cliente, p_party);
  select name into v_cliente from public.party where id = p_party;
  update public.conta_gc_enlace
     set quien_name = v_origen || coalesce(' · lo cargó ' || v_quien, ''),
         porque = format('%s: es «%s».', v_origen, v_cliente)
   where company_id = p_company and gc_cliente_id = p_gc_cliente;
  return jsonb_build_object('frase', format('Atado a «%s», como dice %s.', v_cliente, v_origen));
end $$;
comment on function public.conta_gc_enlace_decision_externa(uuid, text, uuid, text) is
  'Q08 · Ata un cliente de GoCardless a su ficha como «Es esta» (conta_gc_enlace_confirmar) y deja escrito quién lo decidió fuera de Sumied (p. ej. «QBO, Excel del 12/11») y quién lo cargó.';
revoke all on function public.conta_gc_enlace_decision_externa(uuid, text, uuid, text) from public, anon;
grant execute on function public.conta_gc_enlace_decision_externa(uuid, text, uuid, text) to authenticated;

create or replace function public.conta_gc_enlace_pendiente_externo(p_company uuid, p_gc_cliente text, p_texto text, p_origen text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company); v_gc text; v_e public.conta_gc_enlace; v_quien text := public.conta_nombre_actor();
        v_origen text := nullif(btrim(left(coalesce(p_origen, ''), 80)), ''); v_texto text := nullif(btrim(left(coalesce(p_texto, ''), 300)), '');
begin
  if v_origen is null or v_texto is null then raise exception 'Falta el texto o quién lo escribió.' using errcode = '22023'; end if;
  select coalesce(nombre, gc_id) into v_gc from public.conta_gc_cliente where company_id = p_company and gc_id = p_gc_cliente;
  if v_gc is null then raise exception 'Ese cliente no está en lo leído de GoCardless.' using errcode = 'P0002'; end if;
  select * into v_e from public.conta_gc_enlace where company_id = p_company and gc_cliente_id = p_gc_cliente for update;
  -- Lo que ya decidió una persona manda: no se pisa.
  if v_e.por = 'persona' and v_e.estado in ('atado', 'sin_ficha') then
    return jsonb_build_object('frase', format('%s ya estaba decidido; no se toca.', v_gc), 'sin_cambios', true);
  end if;
  insert into public.conta_gc_enlace (company_id, gc_cliente_id, account_id, party_id, por, estado, candidatas, porque, quien, quien_name, decidido_at, updated_at, antes)
  values (p_company, p_gc_cliente, v_cuenta, null, 'persona', 'propuesto', coalesce(v_e.candidatas, '{}'),
          format('Pendiente de revisar. %s escribió: «%s».', v_origen, v_texto), auth.uid(), v_origen || coalesce(' · lo cargó ' || v_quien, ''), now(), now(),
          jsonb_build_object('enlace', case when v_e.gc_cliente_id is null then null else to_jsonb(v_e) - 'antes' end))
  on conflict (company_id, gc_cliente_id) do update set
    party_id = null, por = 'persona', estado = 'propuesto', porque = excluded.porque,
    quien = excluded.quien, quien_name = excluded.quien_name, decidido_at = excluded.decidido_at, updated_at = excluded.updated_at, antes = excluded.antes;
  return jsonb_build_object('frase', format('%s, pendiente de revisar con lo que escribió %s.', v_gc, v_origen));
end $$;
comment on function public.conta_gc_enlace_pendiente_externo(uuid, text, text, text) is
  'Q08 · Lo que una decisión de fuera (p. ej. el Excel de QBO) no deja claro: el cliente de GoCardless queda «propuesto», sin ficha, con el texto entre comillas, para que una persona lo revise. No pisa lo que ya decidió una persona.';
revoke all on function public.conta_gc_enlace_pendiente_externo(uuid, text, text, text) from public, anon;
grant execute on function public.conta_gc_enlace_pendiente_externo(uuid, text, text, text) to authenticated;
