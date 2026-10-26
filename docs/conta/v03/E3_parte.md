# V03 · E3 · Corregir y cuadrar

*26/10 · rama `conta/v03-e3`.*

## Lo que está hecho

### La base: la 1750 (solo añade)

`20261026T1750_v03_verifactu_corregir_y_cuadrar.sql`. El analizador dice
«sigue»: no toca nada de lo que existe, ni datos, ni el camino del pedido.

**«Me he equivocado en…» (tablero 27).** Cada camino dice antes qué va a pasar.

- **`verifactu_previsto(factura, accion, cambios)`** solo lee. Devuelve si se
  puede, la frase de lo que va a pasar, un aviso y lo que cambia. Las dos
  funciones que lo hacen la llaman y paran con su frase si no se puede: lo que
  se dice antes es lo que se comprueba después.
- **Rectificar** es la rectificativa de la V01. No hay nada nuevo en la base:
  la pantalla abre su «Corregir».
- **`verifactu_anular_factura`**, para «no tenía que haberla emitido»:
  - Solo un administrador, con el motivo y escribiendo ANULAR.
  - Solo si la factura tiene registro en Hacienda y no tiene cobros, no tiene
    rectificativa (emitida ni preparada) y su mes está abierto. Si no, la frase
    dice que se corrige con una rectificativa.
  - La factura queda anulada. Su asiento se deshace con un contrasiento del
    mismo día, y el libro de IVA marca sus apuntes como anulados por él (como
    cualquier asiento anulado, C05).
  - Hacienda recibe un registro de anulación, encadenado tras el último del
    NIF. Lleva «sin registro previo» si Hacienda la había rechazado y no tenía
    nada aceptado.
- **`verifactu_subsanar`**, para «solo está mal lo que tiene Hacienda»:
  - Un administrador o un encargado.
  - Un alta nueva con `Subsanacion = S`, rehecha desde la factura, con otra
    descripción si se da. Lleva `RechazoPrevio = S` si la última se rechazó.
  - No se puede si nada cambia y Hacienda la tiene como correcta. Tampoco si la
    anterior aún va de camino.

**«Comprobar la cadena».** `verifactu_comprobar_cadena(empresa)` recorre, por
NIF y entorno, todos los registros en orden y comprueba cinco cosas:

- que lo que guarda cada uno es lo que entró en su huella;
- que la huella es la de sus datos;
- que cada uno sigue al anterior;
- que la hora es la de cuando se generó;
- que la cuenta de `verifactu_cadena` coincide.

Dice cuál falla y dónde. Los registros de otra empresa con el mismo NIF salen
sin su número.

**«Comprobar con Hacienda».**

- Dos tablas nuevas, `verifactu_cuadre` y `verifactu_cuadre_hacienda`. Tienen
  RLS y no se leen directamente: solo por funciones.
- Para el usuario:
  - `verifactu_cuadre_pedir` pide la consulta de un mes. Lo puede pedir la
    empresa o la asesoría que la lleva. Si ya hay una de ese mes esperando,
    devuelve esa.
  - `verifactu_cuadre_ver` devuelve el último cuadre del mes, con su resultado.
  - `verifactu_despacho_empresas` da los clientes de la asesoría con Verifactu
    encendido.
- Para `conta-verifactu` (solo la clave de servicio):
  - `verifactu_cuadre_tomar` coge el siguiente cuadre pedido. También recoge el
    que lleva más de 10 minutos «consultando», porque eso es que la función
    murió a mitad.
  - `verifactu_cuadre_pagina` guarda cada página de la respuesta. Con la
    última, `_verifactu_cuadrar` cuadra: cuántos cuadran, cuáles faltan en
    Hacienda, cuáles solo tiene Hacienda, cuáles dicen otra cosa (estado,
    huella o importe), y lo que va de camino o está rechazado.
  - `verifactu_cuadre_fallo` deja el cuadre en fallo con su motivo.
  - `verifactu_cert_abrir_cuadre` abre el certificado de la empresa para una
    consulta en real, con las mismas condiciones que para un envío.
- Un cron de cada minuto, `verifactu-cuadre`. Solo existe donde hay
  `cron_secret`, y solo llama a la función si hay un cuadre de real pedido.
  Hoy no hay ninguna empresa en real.

### La consulta a Hacienda (`conta-verifactu`)

- **`_shared/verifactu/consulta.ts`**:
  - `ConsultaFactuSistemaFacturacion` de un mes, con `ClavePaginacion` para la
    página siguiente.
  - La lectura de `RespuestaConsultaLR`: de cada factura, su huella (no la de
    la anterior, que va en el encadenamiento), su estado, su código y su
    descripción. Un Fault es una consulta rechazada con su código.
- **`_shared/verifactu/cuadre.ts`**: el bucle, página a página.
  - Falla diciéndolo si Hacienda dice que hay más y no da la clave, si devuelve
    la misma página dos veces o si pasa de 50 páginas.
  - Un fallo de una empresa no para las demás.
- **`conta-verifactu`** gana la acción `{"accion":"cuadre"}`.
  - En pruebas usa el certificado de pruebas, y tiene que ser del NIF que se
    consulta.
  - En real usa el de la empresa, si lo ha autorizado.

### Las pantallas

- **La factura (tablero 27), «Me he equivocado en…»**
  - Sale en cuanto la factura tiene registro en Hacienda. Ofrece tres caminos.
  - Cada uno abre su diálogo con «Lo que va a pasar» o «No se puede», y lo que
    cambia.
  - Anular pide el motivo y ANULAR. Subsanar deja cambiar la descripción y
    vuelve a preguntar qué cambia.
  - Hecho, dice lo que ha pasado con su contenido (regla 8). Por ejemplo:
    «Anulada la F-…: su asiento nº 7 queda deshecho con el nº 8 (mismo día)…».
- **Facturas › Más › «Comprobar con Hacienda»** (solo con Verifactu encendido):
  - Eliges un mes y ves lo último que se preguntó de ese mes.
  - «Preguntar a Hacienda» enseña el estado mientras espera, y si tarda más de
    5 minutos lo dice.
  - Al acabar da el resultado: cada factura que no cuadra, con qué le pasa y
    qué hacer.
- **El despacho de la asesoría:** «Comprobar con Hacienda», con un selector de
  los clientes que tienen Verifactu encendido.
- **Ajustes › Verifactu:**
  - «Comprobar la cadena», con cada problema dicho.
  - «Exportar los registros» en Excel o CSV, para una inspección: todos, en el
    orden de la cadena, con lo que entra en cada huella para poder recalcularla.

## Lo probado

- **Staging, en ROLLBACK**
  (`supabase/staging/sql/20261026_v03_e3_corregir_y_cuadrar_prueba.sql`): verde
  en el run 614, con siete facturas de la cuenta A en todos sus estados.
  1. Lo que va a pasar en cada caso, también los «no se puede».
  2. Subsanar: la correcta con otra descripción, la aceptada con errores y la
     rechazada (con `RechazoPrevio = S`).
  3. Anular:
     - se niega con cobros, sin motivo o sin ANULAR;
     - el asiento queda anulado con su contrasiento del mismo día;
     - la 477 queda a cero;
     - el libro de IVA queda con su apunte anulado por el contrasiento;
     - el registro de anulación queda encadenado;
     - la rechazada sale con «sin registro previo».
  4. La cadena entera; después, tocada con el disparador apagado, dice qué
     registro.
  5. El cuadre:
     - pedido dos veces es el mismo;
     - otra cuenta no puede pedirlo;
     - lo toma, guarda dos páginas y salen sus categorías;
     - un fallo queda dicho;
     - el atascado de 15 minutos se vuelve a tomar y el de 2, no;
     - el usuario ve su cuadre hecho;
     - los permisos son: 8 funciones solo de servicio, 7 del usuario y ninguna
       del anónimo.
  6. La vuelta atrás no deja nada de la 1750; las 11 funciones de antes siguen
     con su md5 y no hay sobrecargas.
- **Unitarias:**
  - `consultaPeriodo.test.ts`: la consulta, con y sin clave, valida contra
    `ConsultaLR.xsd`. La respuesta de ejemplo valida contra
    `RespuestaConsultaLR.xsd`, y el XSD rechaza los ejemplos rotos, así que la
    prueba no es un espejo.
  - `cuadre.test.ts`: el bucle, con sus tres formas de no quedarse dando
    vueltas.
  - `correccion.test.ts`: las frases del cuadre y la exportación.
- **e2e** (`tests/e2e/conta/v03/corregir-y-cuadrar.spec.ts`), en ordenador y
  móvil:
  - los tres caminos de «Me he equivocado en…»;
  - «Comprobar con Hacienda» en Facturas y en el despacho;
  - la cadena y el CSV exportado.

  Lo que contesta la base para Verifactu está **simulado en el navegador**:
  staging no tiene certificado y el candado no deja crear registros. Lo que
  hace la base lo prueba la prueba de staging.

## La tanda

`sumied/conta-v03-e3`: la 1750, con su cuenta (`cuentas/v03-e3.sql`) y su
vuelta atrás. **Sin autorizo.** Se lanza desde la rama, con el campo «tanda»
vacío.

Lo que tiene que cambiar en producción:

- las tablas del cuadre, de 0 a 2 de 2;
- el cron `verifactu-cuadre`, de 0 a 1.

Lo demás se queda igual: las facturas de Foodint, cero registros, cero
empresas encendidas y las cuatro funciones de la E1 y la E2 con su huella.

## Funciones a desplegar a mano

`conta-verifactu`: cambian ella y su `_shared/verifactu` (`consulta.ts` y el
nuevo `cuadre.ts`).

## Lo que queda abierto

- **El certificado de pruebas.** Sin él no se ha probado contra la AEAT de
  pruebas:
  - que la consulta paginada contesta como dice su XSD;
  - que una anulación y su alta pueden ir en el mismo envío;
  - que el periodo de la consulta es el mes de la fecha de expedición (es lo
    que se ha supuesto).
- **Exportar en el XML de la AEAT** (además de Excel y CSV) necesita los datos
  del productor del sistema (`SistemaInformatico`), que están pendientes de
  Julio.
- **Para el asesor:**
  - que anular solo con el mes abierto, sin cobros y sin rectificativa es el
    criterio que quiere;
  - que, en el resto de casos, lo que toca es la rectificativa por el total.
