-- supabase/migrations/20261206T0510_d03_recibida_pdf_datos.sql
--
-- D03 · DATOS: las dos recibidas de Foodint que nacieron sin su documento
-- (Julio, 23/10). Las subió «Subir una factura» (Compras), sin recepción, y la
-- 0140 solo ponía el documento de la recepción: el PDF estaba subido en
-- receipt-uploads y apuntado en su lectura, y la factura no lo tenía.
--
--   · FAC-00098 · S11/0177416578 · 19/10 · 9a87fa22-fbc7-471b-bf1d-a88c856259ea
--     (lectura 92c53abd-d369-40e2-9beb-9a05adf5c80c, un PDF de 39.475 bytes)
--   · FAC-00101 · COHELDI P26 4.980 · 21/10 · d6913598-9f52-4d43-8860-eddff2a6d436
--     (lectura d155b941-2c47-4f1f-bca9-067129cfcd77, un PDF de 152.508 bytes;
--     casada después con ALB-00215, cuyo documento es la foto del ALBARÁN, no
--     la factura: por eso no se coge el de la recepción)
--
-- Les pone como raw_document_url el primer fichero de su lectura, que es lo
-- que pone la 0500 desde ahora a las que entren igual. Nada más: ni
-- updated_at (la vuelta atrás las deja exactamente como estaban), ni estado,
-- ni importes. Ningún disparador de supplier_invoice mira raw_document_url.
-- Siguen «en revisión» y sin asiento: no sale nada a Diez por esto. Cuando
-- se validen, el D02 (conta-recibida-pdf) enlazará este PDF a su asiento y,
-- si su envío esperaba por el documento, lo despertará.
--
-- Medido en producción el 23/10, solo lectura, TODAS las cuentas: recibidas
-- de origen «ocr» sin documento cuyo fichero está en su lectura, 2, estas dos
-- (solo Foodint tiene recibidas). Las 8 de origen «liquidacion» sin documento
-- NO se tocan: nacen del resumen de Uber que llega en el cuerpo del correo
-- (channel_settlement, las 8 con su correo), no hay PDF que enlazar, por
-- diseño (D01, 0100 de liquidaciones).
--
-- Anclado por cuenta, factura y lectura (regla 9). PARA, sin cambiar nada:
-- si las que están así no son exactamente estas dos (en cualquier cuenta: si
-- ha entrado otra antes de la 0500, se vuelve a medir); si alguna ya tiene
-- documento o no es la de su lectura; si su fichero no está en receipt-uploads.
-- En una base sin Foodint (staging), no hace nada y lo dice.
-- No toca el camino del pedido, ni coste ni stock.
-- Vuelta atrás: supabase/vuelta-atras/20261206T0510_d03_recibida_pdf_datos.down.sql
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_fac constant uuid[] := array['9a87fa22-fbc7-471b-bf1d-a88c856259ea', 'd6913598-9f52-4d43-8860-eddff2a6d436']::uuid[];
  v_lec constant uuid[] := array['92c53abd-d369-40e2-9beb-9a05adf5c80c', 'd155b941-2c47-4f1f-bca9-067129cfcd77']::uuid[];
  v_todas uuid[];
  v_bien int;
  v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'D03 0510: esta base no tiene la cuenta de Foodint (staging): no hay nada que enlazar.';
    return;
  end if;

  -- Las que están así, en TODAS las cuentas: tienen que ser estas dos.
  select coalesce(array_agg(i.id order by i.id), '{}') into v_todas
    from public.supplier_invoice i
    join public.goods_receipt_ai_session a on a.id = i.ai_session_id and a.account_id = i.account_id
   where i.source = 'ocr' and i.raw_document_url is null
     and jsonb_typeof(a.input_files) = 'array' and nullif(btrim(a.input_files -> 0 ->> 'path'), '') is not null;
  if v_todas is distinct from (select array_agg(x order by x) from unnest(v_fac) x) then
    raise exception 'D03 0510: las recibidas «ocr» sin documento con fichero en su lectura (todas las cuentas) no son las dos medidas el 23/10: son % (%). No se cambia nada: vuelve a medir.',
      cardinality(v_todas), v_todas;
  end if;

  -- Cada una: de Foodint, de su lectura, sin documento, y su fichero subido.
  select count(*) into v_bien
    from public.supplier_invoice i
    join unnest(v_fac, v_lec) as m(fac, lec) on m.fac = i.id
    join public.goods_receipt_ai_session a on a.id = m.lec and a.account_id = v_acc
   where i.account_id = v_acc and i.source = 'ocr' and i.ai_session_id = m.lec and i.raw_document_url is null
     and coalesce(a.input_files -> 0 ->> 'bucket', 'receipt-uploads') = 'receipt-uploads'
     and left(a.input_files -> 0 ->> 'path', 37) = v_acc::text || '/'
     and exists (select 1 from storage.objects o where o.bucket_id = 'receipt-uploads' and o.name = a.input_files -> 0 ->> 'path');
  if v_bien <> 2 then
    raise exception 'D03 0510: de las dos recibidas, % están como se midieron (de Foodint, de su lectura, sin documento y con su fichero en receipt-uploads). No se cambia nada.', v_bien;
  end if;

  update public.supplier_invoice i
     set raw_document_url = a.input_files -> 0 ->> 'path'
    from unnest(v_fac, v_lec) as m(fac, lec), public.goods_receipt_ai_session a
   where i.id = m.fac and i.account_id = v_acc and i.ai_session_id = m.lec and i.raw_document_url is null
     and a.id = m.lec and a.account_id = v_acc;
  get diagnostics v_n = row_count;
  if v_n <> 2 then
    raise exception 'D03 0510: esperaba enlazar DOS documentos y han sido %.', v_n;
  end if;
  raise notice 'D03 0510: FAC-00098 y FAC-00101 de Foodint, con el PDF de su lectura (2).';
end $$;
