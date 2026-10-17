-- supabase/migrations/20261120T0100_c06b_nombre_documento.sql
--
-- cambia: public.journal_entry_document · prueba: supabase/staging/sql/20261120_c06b_nombre_documento_prueba.sql
--   (el disparador nuevo toma un momento un cierre SHARE ROW EXCLUSIVE sobre
--   journal_entry_document, que no es del camino del pedido)
--
-- C06b · El nombre del PDF de un asiento lo limpia SIEMPRE la base (Julio,
-- 17/10, después del 3174).
--
-- POR QUÉ: journal_entry_document.file_name tiene un CHECK
-- ('^[A-Za-z0-9._-]+\.pdf$') y el front arma el nombre de una factura recibida
-- con el del proveedor y su número: «EUROPASTRY S.A. 24048027.pdf». Con
-- espacios no cumple, conta_documento_factura_guardar no enlaza el PDF (400,
-- 23514) y el envío a Diez no llega a intentarse. Le pasó al 3174 el 16/10 a
-- las 09:12:03 (el PDF quedó subido y sin enlazar). Medido en producción el
-- 17/10, solo lectura, con el nombre que arma el front: 0 de 7 facturas
-- recibidas de Foodint y 0 de 65 proveedores de Foodint cumplían; con la
-- limpieza de abajo, 7 de 7 y 65 de 65.
--
-- LO QUE AÑADE (nada se reemplaza ni se borra):
--   1. journal_entry_document.original_name: el nombre tal como llegó, para
--      enseñarlo. Admite nulos (las filas de antes se quedan sin él).
--   2. conta_nombre_fichero(texto): el nombre que cumple la regla. Las tildes,
--      la «ü», la «ñ» y la «ç» pasan a su letra sin marca; lo demás que no sea
--      letra, cifra, punto, guion o guion bajo pasa a «-» (seguidos, uno solo);
--      sin «-» ni «.» en las puntas; 150 caracteres como mucho; y «.pdf» al
--      final. Si no queda nada, «documento.pdf». Un nombre que ya cumple no
--      cambia.
--   3. Un disparador ANTES de insertar o de cambiar file_name en
--      journal_entry_document: guarda el original en original_name y deja en
--      file_name el limpio. Vale para los dos que escriben ahí
--      (conta_documento_guardar, el resumen de ventas, y
--      conta_documento_factura_guardar, la factura recibida) y para cualquiera
--      que venga después, sin tocar sus cuerpos.
--
-- El CHECK de file_name se queda como está: es la red si el disparador falta.

alter table public.journal_entry_document add column if not exists original_name text;
comment on column public.journal_entry_document.original_name is
  'C06b · El nombre del documento tal como llegó (con espacios, tildes…), para enseñarlo. file_name es el limpio (conta_nombre_fichero).';

create function public.conta_nombre_fichero(p_nombre text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select case when c = '' then 'documento' else c end || '.pdf'
    from (select regexp_replace(
                   left(regexp_replace(regexp_replace(
                     regexp_replace(translate(coalesce(p_nombre, ''),
                       'áàäâãåÁÀÄÂÃÅéèëêÉÈËÊíìïîÍÌÏÎóòöôõÓÒÖÔÕúùüûÚÙÜÛñÑçÇ',
                       'aaaaaaAAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUnNcC'),
                       '\.pdf\s*$', '', 'i'),
                     '[^A-Za-z0-9._-]+', '-', 'g'),
                   '-{2,}', '-', 'g'), 150),
                 '^[-.]+|[-.]+$', '', 'g') as c) x
$$;
comment on function public.conta_nombre_fichero(text) is
  'C06b · El nombre de un PDF que cumple el CHECK de journal_entry_document.file_name: sin tildes ni ñ, lo demás a «-», .pdf al final.';
revoke all on function public.conta_nombre_fichero(text) from public, anon;
grant execute on function public.conta_nombre_fichero(text) to authenticated, service_role;

create function public.journal_entry_document_nombre_limpio()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.original_name := coalesce(new.original_name, new.file_name);
  elsif new.file_name is distinct from old.file_name then
    new.original_name := new.file_name;
  end if;
  if new.file_name is null or new.file_name !~ '^[A-Za-z0-9._-]+\.pdf$' then
    new.file_name := public.conta_nombre_fichero(new.file_name);
  end if;
  return new;
end $$;
revoke all on function public.journal_entry_document_nombre_limpio() from public, anon, authenticated;

create trigger trg_journal_entry_document_nombre_limpio
  before insert or update of file_name on public.journal_entry_document
  for each row execute function public.journal_entry_document_nombre_limpio();
