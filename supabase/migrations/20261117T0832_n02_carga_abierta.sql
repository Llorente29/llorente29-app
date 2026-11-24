-- supabase/migrations/20261117T0832_n02_carga_abierta.sql
-- cambia: public.import_run · prueba: supabase/staging/sql/20261117_n02_carga_prueba.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261117_n02_carga_prueba.sql
-- cambia: public.customer_invoice · prueba: supabase/staging/sql/20261117_n02_carga_prueba.sql
--
-- N02 · La carga, abierta a otros programas y en dos tiempos (encargo N02,
-- 17/11; decisiones de Julio en la respuesta al N01).
--
-- Solo AMPLÍA cinco CHECK. Ningún valor que hoy entra deja de entrar, ni una
-- fila cambia: conta_diez_importar y los workflows de Diez siguen igual.
--
--   1. import_run.program: además de «diez», «erp10» y «otro».
--   2. import_run.kind: además de los cuatro de Diez (historico, al_dia,
--      documentos, sumas_saldos), un tipo por cada fichero de la carga nueva:
--      plan_cuentas, terceros (clientes y proveedores), inmovilizado, diario,
--      recibidas, emitidas y declaraciones (los 303 presentados). «documentos»
--      (los PDF) y «sumas_saldos» ya estaban.
--   3. import_run.status: la columna de estado YA EXISTE (en_curso, hecho,
--      fallido), así que se amplía con los tres de la carga en dos tiempos:
--      en_prueba, dada_por_buena y deshecha. No hace falta ningún update: las
--      cargas que ya hay se quedan en «hecho», que se lee como «dada por buena,
--      de antes del N02» (las de Diez se validaban al traerlas). La regla de
--      import_run_check1 no cambia: solo «en_curso» va sin finished_at, así que
--      una carga en prueba, dada por buena o deshecha ya tiene su lectura
--      terminada.
--   4. supplier_invoice.source y customer_invoice.origin: además, «traida»
--      (sin tilde): la factura que entra de otro programa enlazada a su asiento
--      traído.
--
-- Cada CHECK se quita y se vuelve a poner en la misma sentencia: comprueba las
-- filas que hay (todas cumplen, porque solo se amplía).

alter table public.import_run
  drop constraint import_run_program_check,
  add constraint import_run_program_check check (program = any (array['diez', 'erp10', 'otro']::text[])),
  drop constraint import_run_kind_check,
  add constraint import_run_kind_check check (kind = any (array[
    'historico', 'al_dia', 'documentos', 'sumas_saldos',
    'plan_cuentas', 'terceros', 'inmovilizado', 'diario', 'recibidas', 'emitidas', 'declaraciones']::text[])),
  drop constraint import_run_status_check,
  add constraint import_run_status_check check (status = any (array[
    'en_curso', 'hecho', 'fallido',
    'en_prueba', 'dada_por_buena', 'deshecha']::text[]));

alter table public.supplier_invoice
  drop constraint supplier_invoice_source_check,
  add constraint supplier_invoice_source_check check (source = any (array['manual', 'ocr', 'lote', 'liquidacion', 'traida']::text[]));

alter table public.customer_invoice
  drop constraint customer_invoice_origin_check,
  add constraint customer_invoice_origin_check check (origin = any (array[
    'a_mano', 'recurrente', 'presupuesto', 'cierre_dia', 'tienda', 'automatica', 'traida']::text[]));

comment on column public.import_run.status is
  'en_curso → (hecho | fallido) en las lecturas de Diez de antes del N02; en_curso → en_prueba → (dada_por_buena | deshecha) en la carga en dos tiempos (N02). «hecho» se lee como dada por buena, de antes.';
