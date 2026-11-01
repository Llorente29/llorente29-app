-- supabase/migrations/20261101T2154_n1b_campo_del_fichero.sql
--
-- cambia: public._lab_campo · prueba: supabase/staging/sql/20261101_n1b_campo_del_fichero_prueba.sql
--
-- N1 · Respuesta 2 de Julio (01/11/2026, con el paquete de verdad en
-- producción): en la hoja Empresa, el CCC no se llama «CCC» sino «Código
-- cuenta de cotización (CCC)». lab_volcar_lote (1938) lo busca como
-- _lab_campo(lote, 'empresa', 'CCC') y, con el fichero real, lo habría dejado
-- vacío en cada contrato sin decir nada.
--
-- _lab_campo encuentra el campo por su nombre (sin mayúsculas, tildes ni
-- signos, como antes) o, si no, por el código entre paréntesis que lleva el
-- nombre del fichero: «CCC» encuentra «Código cuenta de cotización (CCC)». El
-- nombre exacto gana siempre. Misma firma; nada en el camino del pedido.
-- Ningún otro campo de Empresa se lee por su nombre (los bancos y los centros
-- de trabajo, no; los centros salen de Trabajadores y Contratos).
--
-- Respaldo con _respaldar_funcion; la vuelta atrás la restaura de él.
--
-- Vuelta atrás: supabase/vuelta-atras/20261101T2154_n1b_campo_del_fichero.down.sql

select public._respaldar_funcion('public._lab_campo(uuid,text,text)', '20261101T2154_n1b_campo_del_fichero');

create or replace function public._lab_campo(p_lote uuid, p_hoja text, p_campo text)
returns text language sql stable as $$
  select public._lab_txt(f.datos, 'valor')
    from public.lab_import_fila f
   where f.lote_id = p_lote and f.hoja = p_hoja
     and (public._lab_norm(f.datos ->> 'campo') = public._lab_norm(p_campo)
          or position('(' || lower(btrim(p_campo)) || ')' in lower(coalesce(f.datos ->> 'campo', ''))) > 0)
   order by (public._lab_norm(f.datos ->> 'campo') = public._lab_norm(p_campo)) desc, f.fila_n
   limit 1
$$;
revoke all on function public._lab_campo(uuid, text, text) from public, anon, authenticated;
