-- scripts/conta/staging/g01d-huella-lectura.sql
--
-- G01d · LA HUELLA DE LO QUE GUARDA LA LECTURA ENTERA DEL CRM, para medir que
-- da exactamente lo mismo antes y después del G01d (regla 31: la misma vara a
-- los dos lados). SOLO LEE. Se pasa en staging dos veces sobre la cuenta de
-- pruebas conectada al portal de pruebas: después de una lectura entera con
-- las funciones de main y después de otra con las de la rama, sin cambiar
-- nada en el portal entre las dos. Las dos salidas tienen que ser iguales,
-- línea a línea. Las dos, sobre una cuenta ya leída antes al menos una vez
-- (si no, la línea 6 de la primera cuenta «nuevos» y la de la segunda
-- «iguales», sin que cambie nada).
--
-- Fuera de la huella solo lo que cambia en cada lectura por construcción: los
-- sellos de tiempo (leido_at, created_at) y, en las diferencias, su id y el de
-- su lectura. Todo lo demás de cada fila entra entero (to_jsonb), ordenado
-- por su clave.
--
-- Uso: psql "$STAGING_DB_URL" -X -A -t -v cuenta=<uuid de la cuenta de pruebas> -f este-fichero
select clave, valor from (
  select 1 o, 'Fichas: cuántas · huella' clave,
    (select count(*) || ' · ' || coalesce(md5(string_agg((to_jsonb(f) - array['leido_at', 'created_at'])::text, '|'
        order by f.crm, f.tipo_ficha, f.id_externo, f.de_empresa)), '—')
       from public.conta_gestoria_ficha f where f.account_id = :'cuenta'::uuid) valor union all
  select 2, 'Fichas por tipo: empresa / contacto (de ellas, personas de contacto)',
    (select concat_ws(' / ', count(*) filter (where tipo_ficha = 'empresa'), count(*) filter (where tipo_ficha = 'contacto'))
        || ' (' || count(*) filter (where tipo_ficha = 'contacto' and de_empresa <> '') || ')'
       from public.conta_gestoria_ficha where account_id = :'cuenta'::uuid) union all
  select 3, 'Clientes: cuántos · huella',
    (select count(*) || ' · ' || coalesce(md5(string_agg((to_jsonb(c) - array['leido_at', 'created_at'])::text, '|'
        order by c.crm, c.tipo_ficha, c.id_externo, c.party_id)), '—')
       from public.conta_gestoria_cliente c where c.account_id = :'cuenta'::uuid) union all
  select 4, 'Diferencias vigentes: cuántas · huella',
    (select count(*) || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '—')
       from (select to_jsonb(d) - array['id', 'lectura_id', 'created_at'] x
               from public.conta_gestoria_diferencia d where d.account_id = :'cuenta'::uuid and d.vigente) q) union all
  select 5, 'Diferencias vigentes por tipo',
    (select coalesce(string_agg(tipo || ' ' || n, ', ' order by tipo), '—')
       from (select tipo, count(*) n from public.conta_gestoria_diferencia where account_id = :'cuenta'::uuid and vigente group by tipo) q) union all
  select 6, 'Última lectura del CRM: por · estado · nuevos / cambiados / iguales / con diferencias',
    (select por || ' · ' || estado || ' · ' || concat_ws(' / ', nuevos, cambiados, iguales, con_diferencias)
       from public.conta_gestoria_lectura where account_id = :'cuenta'::uuid and origen = 'crm' order by empezada_at desc limit 1)
) q order by o;
