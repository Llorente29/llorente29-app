-- 20260820T1700 · B) receive_goods_receipt gana p_hold.
-- p_hold = "la IA pidió revisión": el albarán queda en 'recibido' (para que la
-- oficina lo pueda abrir y corregir) pero NO postea NADA. Y deja de PISAR un
-- needs_review que venga puesto de antes.
create or replace function public.receive_goods_receipt(
  p_receipt_id uuid,
  p_hold boolean default false
)
 returns table(posted_lines integer, skipped_lines integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_receipt goods_receipt%rowtype;
  v_posted  integer := 0;
  v_skipped integer := 0;
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

  if p_hold then
    -- ENCARGO CODE (20/08) §3(B) — NADA entra al almacén. El stock entra
    -- cuando un humano cierre el albarán en la pantalla de oficina.
    select count(*) into v_skipped
      from goods_receipt_line
     where goods_receipt_id = p_receipt_id and not not_goods;
  else
    select p.posted_lines, p.skipped_lines into v_posted, v_skipped
      from public._post_goods_receipt_lines(p_receipt_id) p;
  end if;

  update goods_receipt
    set status = 'recibido', received_at = coalesce(received_at, now()),
        needs_review = (p_hold or v_skipped > 0 or coalesce(needs_review, false)),
        updated_at = now()
    where id = p_receipt_id;

  if v_receipt.purchase_order_id is null then
    v_receipt.purchase_order_id := public.auto_link_goods_receipt_to_order(p_receipt_id);
  end if;

  if v_receipt.purchase_order_id is not null then
    perform recompute_purchase_order_status(v_receipt.purchase_order_id);
  end if;

  posted_lines := v_posted; skipped_lines := v_skipped;
  return next;
end;
$function$;

drop function if exists public.receive_goods_receipt(uuid);
grant execute on function public.receive_goods_receipt(uuid, boolean) to authenticated;

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'receive_goods_receipt') <> 1 then
    raise exception 'B: debería quedar EXACTAMENTE una receive_goods_receipt';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'receive_goods_receipt'
      and p.pronargs = 2 and p.pronargdefaults = 1
  ) then
    raise exception 'B: no quedó con (uuid, boolean default)';
  end if;
end $$;