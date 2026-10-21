-- supabase/vuelta-atras/20261129T0360_compras_preguntas_foodint.down.sql
--
-- Vuelta atrás de la 0360 (solo Foodint): las 5 recepciones consumidas que
-- recalculó vuelven a la pregunta que tenían, tal como se midió en producción
-- el 21/10 antes de aplicar: «ficha_sin_forma», con la ficha vacía, el tipo de
-- su documento y la forma sugerida «con cada entrega». Por su id y dentro de
-- la cuenta (regla 9). Si alguna ya tiene la pregunta cerrada por alguien, se
-- deja como está: cerrarla es trabajo hecho.
--
-- sin prueba con datos: solo actúa sobre Foodint (cuenta 51ad1792…), que no
-- está en staging; su prueba con datos es el ENSAYO de la tanda en producción
-- (todo en una transacción y rollback), que la ejecuta tras la 0360.
--
-- Es devolver una pregunta que ya no es verdad: solo tiene sentido si la
-- comprobación de después de la tanda falla y hay que dejarlo todo como
-- estaba.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'Compras 0360 (vuelta atrás): esta base no tiene a Foodint: nada que deshacer.';
    return;
  end if;
  update public.goods_receipt_path p
     set question = 'ficha_sin_forma',
         question_detail = jsonb_build_object('ficha', null, 'papel', p.doc_type, 'sugerida', 'per_delivery',
                                              'ficha_dice', null, 'sugerida_dice', 'con cada entrega')
   where p.account_id = v_acc and p.consumed_at is not null and p.question_closed is null
     and p.goods_receipt_id in ('37da1375-d4f7-4889-9215-e33e6bb4af8e',   -- ALB-00195
                                'c36b6ef9-2f81-44e9-a898-ba458982cf86',   -- ALB-00198
                                'c3736feb-4109-4442-aca5-8a0213a07405',   -- ALB-00203
                                'f8b5e189-6782-4736-be5a-943617fb230c',   -- ALB-00206
                                '6fbb2943-db4a-4bd7-a4b6-ed75ecf124e4');  -- ALB-00218
  get diagnostics v_n = row_count;
  raise notice 'Compras 0360 (vuelta atrás): % recepciones devueltas a «la ficha no dice cómo factura».', v_n;
end $$;
