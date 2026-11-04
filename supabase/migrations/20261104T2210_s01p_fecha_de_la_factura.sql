-- supabase/migrations/20261104T2210_s01p_fecha_de_la_factura.sql
--
-- S01p · 4 · La factura recibida se contabiliza con SU FECHA (Julio, S01p·1,
-- decisión 3, y S01p·9, 04/11). Sustituye a la regla V04 del 27/10 («nunca
-- antes del día en que entró»):
--
--   · va con su fecha de factura;
--   · salvo que su trimestre ya tenga el 303 presentado (o su día no esté
--     abierto: el corte con Diez, un ejercicio cerrado): entonces, al primer
--     día abierto y con el IVA sin presentar (conta_primer_dia_iva_abierto);
--   · un mes cerrado por una persona no frena: el asiento entra con la marca
--     «entró después del cierre» (1120, conta_mes_cambio).
--
-- Por qué: con la V04, las 22 facturas de octubre de Foodint que entraron del
-- 01/11 al 03/11 se asentaron en noviembre, y las 9 de los repartidores (31/10,
-- entradas el 04/11) iban a ir al 04/11: octubre se quedaba sin ellas. El IVA
-- sigue en el libro el día que entró (o el del asiento si es después): una
-- factura del 30/09 que entra el 01/10 va al 30/09 si el 303 del 3T no está
-- presentado, y su IVA al 01/10; si ya está presentado, al primer día abierto.
--
-- cambia: public._conta_recibida_no_antes_de_entrar · prueba: supabase/staging/sql/20261104_s01p_facturas_a_su_mes_prueba.sql
--
-- Misma firma, con respaldo. La llama _journal_entry_proponer (no cambia). Lo ya
-- asentado no se toca aquí (las 22 van en la 2211). Nada en el camino del pedido.

select public._respaldar_funcion('public._conta_recibida_no_antes_de_entrar(uuid,jsonb)', '20261104T2210_s01p_fecha_de_la_factura');

create or replace function public._conta_recibida_no_antes_de_entrar(p_company uuid, p_entry jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_fecha date := (p_entry->>'fecha')::date; v_nueva date; v_p jsonb; v_aviso text;
begin
  if p_entry->>'source_type' is distinct from 'supplier_invoice' or v_fecha is null then return p_entry; end if;
  -- S01p·4: su fecha, salvo que no esté abierta (303 presentado, corte con Diez, ejercicio cerrado).
  v_nueva := public.conta_primer_dia_iva_abierto(p_company, v_fecha);
  if v_nueva is null or v_nueva = v_fecha then return p_entry; end if;
  v_p := public.conta_iva_presentado(p_company, v_fecha);
  v_aviso := case when v_p is not null
                  then format('El IVA del %s de %s ya está presentado: esta factura del %s se contabiliza el %s, el primer día abierto.',
                              v_p->>'periodo', v_p->>'ejercicio', to_char(v_fecha, 'DD/MM/YYYY'), to_char(v_nueva, 'DD/MM/YYYY'))
                  else format('El %s no está abierto en el libro: esta factura se contabiliza el %s, el primer día abierto.',
                              to_char(v_fecha, 'DD/MM/YYYY'), to_char(v_nueva, 'DD/MM/YYYY')) end;
  return p_entry || jsonb_build_object('fecha', v_nueva, 'aviso', v_aviso,
    'razones', coalesce(p_entry->'razones', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'decision', v_aviso,
      'porque', 'Una factura recibida se contabiliza con su fecha, salvo que su trimestre tenga el 303 presentado o su día no esté abierto: entonces, el primer día abierto. Su fecha de factura no cambia.')));
end $$;
revoke all on function public._conta_recibida_no_antes_de_entrar(uuid, jsonb) from public, anon, authenticated;
comment on function public._conta_recibida_no_antes_de_entrar(uuid, jsonb) is
  'S01p·4 (2210; antes V04, 1350). La propuesta de una factura recibida va con su fecha de factura, salvo que su trimestre tenga el 303 presentado o su día no esté abierto: entonces, al primer día abierto (conta_primer_dia_iva_abierto), con su aviso y su razón. Un mes cerrado por una persona no frena. La usa _journal_entry_proponer.';
