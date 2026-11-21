-- supabase/vuelta-atras/20261113T1805_b01r26_conta_pdf.down.sql
-- B01r26 · vuelta atrás de la 1805: quita lo que añade (las cuatro funciones y las dos tablas).
-- Con llaves ya dadas a Diez, Diez deja de poder descargar esos PDF: se hace sabiéndolo.
drop function if exists public.conta_pdf_retirar(uuid, uuid, text);
drop function if exists public.conta_pdf_servir(text, text);
drop function if exists public.conta_pdf_llaves_del_traspaso(uuid);
drop table if exists public.conta_pdf_acceso;
drop table if exists public.conta_pdf_llave;
