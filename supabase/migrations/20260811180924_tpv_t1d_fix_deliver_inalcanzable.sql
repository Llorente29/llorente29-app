-- FIX T1.d (11/08, detectado por Julio en verificación en vivo): 'deliver' era
-- INALCANZABLE — el guard "la cuenta ya esta cerrada (status=closed)" saltaba
-- antes de llegar a la rama de deliver, que exige precisamente status='closed'.
-- Consecuencia: ninguna venta TPV podía pasar a order_status='completed' y el
-- stock no se descontaba jamás. Sustitución quirúrgica sobre la definición
-- viva: la rama deliver valida cobro, marca completed y retorna ANTES de la
-- reescritura de líneas/totales (que no debe tocar una venta cerrada).

do $$
declare
  v_def text;
  v_new text;
  v_cnt int;
  v_frag text := 'if v_result\.status <> ''open'' then\s*raise exception ''upsert_pos_sale: la cuenta ya esta cerrada \(status=%\)'', v_result\.status;\s*end if;';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='upsert_pos_sale';

  if v_def is null then
    raise exception 'fix_deliver: no existe upsert_pos_sale — parar';
  end if;

  select count(*) into v_cnt from regexp_matches(v_def, v_frag, 'g');
  if v_cnt <> 1 then
    raise exception 'fix_deliver: el fragmento aparece % veces (se esperaba 1) — parar', v_cnt;
  end if;

  v_new := regexp_replace(v_def, v_frag,
    'if p_action = ''deliver'' then
      if v_result.status <> ''closed'' then
        raise exception ''upsert_pos_sale: no se puede marcar Entregado sin cobrar antes'';
      end if;
      update sale set order_status = ''completed'' where id = v_sale_id;
      select * into v_result from sale where id = v_sale_id;
      return jsonb_build_object(''saleId'', v_result.id, ''posShortCode'', v_result.pos_short_code, ''status'', v_result.status, ''orderStatus'', v_result.order_status, ''paymentStatus'', v_result.payment_status, ''total'', v_result.total, ''taxableBase'', v_result.taxable_base, ''tax'', v_result.tax);
    end if;
    if v_result.status <> ''open'' then raise exception ''upsert_pos_sale: la cuenta ya esta cerrada (status=%)'', v_result.status; end if;');

  if length(v_new) <= length(v_def) then
    raise exception 'fix_deliver: la sustitución no creció la definición — parar';
  end if;

  execute v_new;
end $$;

notify pgrst, 'reload schema';