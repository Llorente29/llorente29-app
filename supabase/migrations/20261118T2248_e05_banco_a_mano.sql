-- supabase/migrations/20261118T2248_e05_banco_a_mano.sql
--
-- E05 · Bancos del núcleo: «Escribir uno a mano · si no viene en el extracto»
-- (maqueta nucleo_6_bancos; ERP10, «Introducción de asientos por tesorería»;
-- respuesta E05 · 1, punto 3: validado al momento, como en ERP10).
--
-- Solo AÑADE una función:
--   conta_banco_a_mano(banco, fecha, cuenta, concepto, importe, quien) → jsonb
--     El asiento de tesorería de un movimiento que no ha venido en el extracto:
--     serie 3, la 572 del banco contra la cuenta elegida, con su concepto;
--     importe > 0 es un ingreso (la 572 al debe), < 0 un pago (la 572 al haber).
--     Se crea con _journal_entry_proponer y se VALIDA en la misma transacción
--     (_journal_entry_validar, con sus reglas de siempre): o queda validado, o no
--     queda nada, y la razón se dice. Devuelve su número y la frase de lo hecho.
--
-- Cómo se casa cuando llega en el extracto (no se duplica): el asiento es
-- source_type 'manual' (no 'bank'), así que sale en bank_asientos_sin_movimiento
-- con origen 'otro', y el motor de hoy (conciliacion.ts, paso 1, «un pago o cobro
-- ya apuntado») lo enlaza con el movimiento que llegue a esa cuenta por el mismo
-- importe a ±10 días, sin crear otro asiento: con la MISMA fecha, «seguro» y se
-- casa solo; con otra, lo propone (Intro). No se toca el motor (las reglas de
-- conciliación nuevas no entran). Lo prueban tests/conta/e05-bancos (el motor de
-- verdad) y la prueba de staging (que sale en bank_asientos_sin_movimiento).
--
-- Se puede pasar dos veces (create or replace, firma nueva).
-- Prueba: supabase/staging/sql/20261118_e05_banco_a_mano_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261118T2248_e05_banco_a_mano.down.sql

create or replace function public.conta_banco_a_mano(p_banco uuid, p_fecha date, p_cuenta text, p_concepto text, p_importe numeric, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  t public.treasury_account; v_572 text; v_nombre572 text; v_cta public.company_account; v_imp numeric := round(coalesce(p_importe, 0), 2);
  v_concepto text := nullif(btrim(p_concepto), ''); v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_res jsonb; v_entry uuid; v_val jsonb; v_lineas jsonb;
begin
  select * into t from public.treasury_account where id = p_banco;
  if t.id is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(t.account_id)) then
    raise exception 'Ese banco no es de tu cuenta.' using errcode = '42501';
  end if;
  -- La 572 del banco (regla 9: de su empresa y su cuenta).
  select a.code, coalesce(a.plain_name, a.name) into v_572, v_nombre572
    from public.company_account_link l join public.company_account a on a.id = l.company_account_id and a.company_id = t.company_id
   where l.account_id = t.account_id and l.company_id = t.company_id and l.entity = 'bank_account' and l.entity_id = t.id::text and l.role = 'principal'
   limit 1;
  if v_572 is null then raise exception 'Este banco no tiene su cuenta (572) en el plan: dásela en Cuentas y extractos.' using errcode = '22023'; end if;
  if p_fecha is null then raise exception 'Pon la fecha.' using errcode = '22023'; end if;
  if v_imp = 0 then raise exception 'Pon el ingreso o el pago.' using errcode = '22023'; end if;
  select * into v_cta from public.company_account a
   where a.company_id = t.company_id and a.account_id = t.account_id and a.code = btrim(coalesce(p_cuenta, ''));
  if v_cta.id is null then raise exception 'La cuenta % no está en el plan de la empresa.', coalesce(nullif(btrim(p_cuenta), ''), '(vacía)') using errcode = '22023'; end if;
  if v_cta.code = v_572 then raise exception 'La cuenta no puede ser la del propio banco (%).', v_572 using errcode = '22023'; end if;
  v_concepto := coalesce(v_concepto, coalesce(v_cta.plain_name, v_cta.name));
  -- Ingreso: el banco al debe; pago: al haber. La otra cuenta, al revés.
  v_lineas := jsonb_build_array(
    jsonb_build_object('cuenta', v_572, 'debe', case when v_imp > 0 then v_imp else 0 end, 'haber', case when v_imp > 0 then 0 else -v_imp end,
                       'concepto', v_concepto, 'comun', true),
    jsonb_build_object('cuenta', v_cta.code, 'debe', case when v_imp > 0 then 0 else -v_imp end, 'haber', case when v_imp > 0 then v_imp else 0 end,
                       'concepto', v_concepto, 'comun', true));
  v_res := public._journal_entry_proponer(t.company_id,
    jsonb_build_object('series', 3, 'fecha', p_fecha, 'concepto', v_concepto, 'source_type', 'manual', 'source_id', null,
                       'confianza', 'seguro', 'porque', format('Escrito a mano en Bancos (%s): no venía en el extracto.', coalesce(t.short_name, t.name)),
                       'razones', jsonb_build_array(jsonb_build_object('decision', 'Escrito a mano', 'porque', 'no venía en el extracto'))),
    v_lineas, null, v_quien, null);
  v_entry := nullif(v_res->>'id', '')::uuid;
  if v_entry is null then raise exception 'No ha salido su asiento (%).', v_res using errcode = 'P0001'; end if;
  -- Validado al momento, como en ERP10: con las reglas de siempre. Si no se puede, no queda nada.
  v_val := public._journal_entry_validar(v_entry, v_quien);
  return jsonb_build_object('asiento_id', v_entry, 'numero', v_val->>'numero', 'serie', v_val->>'serie',
    'texto', format('Apuntado y validado: asiento %s, %s de %s en %s (%s). Cuando llegue en el extracto, se enlaza con él: no se duplica.',
                    v_val->>'numero', case when v_imp > 0 then 'ingreso' else 'pago' end,
                    public.conta_euros_exactos(abs(v_imp)), v_cta.code, v_concepto));
end $function$;
comment on function public.conta_banco_a_mano(uuid, date, text, text, numeric, text) is
  'E05: «Escribir uno a mano» en Bancos: el asiento de tesorería (serie 3, la 572 del banco contra la cuenta) de un movimiento que no ha venido en el extracto, validado al momento. Cuando llega, el motor lo enlaza (asiento sin movimiento).';
revoke all on function public.conta_banco_a_mano(uuid, date, text, text, numeric, text) from public, anon;
grant execute on function public.conta_banco_a_mano(uuid, date, text, text, numeric, text) to authenticated, service_role;
