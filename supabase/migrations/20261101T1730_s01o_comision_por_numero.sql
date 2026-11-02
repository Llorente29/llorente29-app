-- supabase/migrations/20261101T1730_s01o_comision_por_numero.sql
-- cambia: public._conta_comision_buscar · prueba: supabase/staging/sql/20261101_s01o_apunta_solo_prueba.sql
--
-- S01o · El enlace seguro entre una factura de comisión y su liquidación es el
-- NÚMERO de la factura, no el importe (Julio, 01/11, decisión 2). El Excel de
-- Glovo nombra su factura (raw->factura->numero) y Just Eat su referencia
-- (settlement_ref); el importe no vale para ligar: la factura de Glovo lleva la
-- «Tarifa recurrente por utilizar la plataforma» que el Excel no cuenta.
-- Medido en Foodint el 01/11 (solo lectura): 15 facturas de Glovo ligadas por
-- la regla del S01i a la liquidación de OTRA factura, y 8 sin ligar teniendo
-- una liquidación con su número.
--
--   1. _conta_comision_de_su_numero(factura): la liquidación de la misma cuenta
--      y la misma plataforma que lleva su número; solo si es una.
--   2. _conta_comision_buscar (misma firma): primero por el número. Si la hay,
--      la liga a ella (y la desliga de la que no era); si no, lo de siempre.
--      Así no vuelve a pasar con las que lleguen (corre al llegar la factura).
-- Parte del cuerpo de producción del 01/11 (md5 8b533b94…, el del S01i).

select public._respaldar_funcion('public._conta_comision_buscar(uuid)', '20261101T1730_s01o_comision_por_numero');

create or replace function public._conta_comision_de_su_numero(p_invoice uuid)
returns uuid language plpgsql stable security definer set search_path to 'public' as $$
declare v public.supplier_invoice; v_num text; v_canal uuid; v_ids uuid[];
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  v_num := upper(regexp_replace(coalesce(v.invoice_number, ''), '[^A-Za-z0-9]', '', 'g'));
  if v.id is null or length(v_num) < 5 then return null; end if;
  v_canal := (public._conta_comision_datos(v.id)->>'canal')::uuid;
  if v_canal is null then return null; end if;
  select array_agg(cs.id) into v_ids
    from public.channel_settlement cs
   where cs.account_id = v.account_id and cs.channel_id = v_canal
     and v_num in (upper(regexp_replace(coalesce(cs.raw->'factura'->>'numero', ''), '[^A-Za-z0-9]', '', 'g')),
                   upper(regexp_replace(coalesce(cs.settlement_ref, ''), '[^A-Za-z0-9]', '', 'g')));
  return case when coalesce(array_length(v_ids, 1), 0) = 1 then v_ids[1] end;
end $$;
revoke all on function public._conta_comision_de_su_numero(uuid) from public, anon, authenticated;

create or replace function public._conta_comision_buscar(p_invoice uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r jsonb; v public.supplier_invoice; v_suya uuid;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null or v.status in ('anulada', 'descartada') then return null; end if;
  -- S01o · Primero, por su número: la liquidación que nombra esta factura es la suya.
  v_suya := public._conta_comision_de_su_numero(v.id);
  if v_suya is not null then
    if not exists (select 1 from public.channel_settlement_invoice k where k.supplier_invoice_id = v.id and k.settlement_id = v_suya) then
      update public.channel_settlement set commission_invoice_id = null, updated_at = now()
       where account_id = v.account_id and commission_invoice_id = v.id and id <> v_suya;
      perform public._conta_comision_ligar(v.id, v_suya, 'sumied', 'Sumied (por su número)');
    end if;
    return 'ligada';
  end if;
  r := public._conta_comision_estado(v.id);
  if r->>'estado' = 'no' then return 'no'; end if;
  update public.supplier_invoice set payment_method = 'compensation', updated_at = now() where id = v.id and payment_method is distinct from 'compensation';
  if r->>'estado' = 'una' then
    perform public._conta_comision_ligar(v.id, (r->>'liquidacion')::uuid, 'sumied', 'Sumied');
  elsif r->>'estado' = 'fuera' then
    perform public._conta_comision_pagar(v.id, true);
  elsif r->>'estado' = 'ligada' then
    perform public._conta_comision_pagar(v.id);
  end if;
  return r->>'estado';
end $function$;
