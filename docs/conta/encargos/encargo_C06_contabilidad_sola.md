# Encargo C06 — Contabilidad sola, con su propia marca (frente C)

> Copia de trabajo del encargo de Julio (13/10/2026), íntegra. Comprobaciones
> previas en `docs/conta/C06_comprobaciones_previas.md`. La maqueta
> `maqueta_C06.zip` (N18 «Entrar») no ha llegado a la sesión: cuando llegue va
> a `docs/conta/maquetas/c06/`.

Sesión de Code: «C · Contabilidad sola · alta y facturas emitidas». Rama: `conta/c06-sola`, sacada de `main`. Maqueta: `maqueta_C06.zip`. Contiene N18 «Entrar» con marca propia; el Inicio es el ya aprobado «Estilo nuevo · Inicio», que está en el lienzo «Folvy · Contabilidad». Una cosa cada vez: haz la tarea 1 y para a informar. Después de este encargo, en esta misma sesión, vendrá el F01 · Facturas que emites con VeriFactu y recurrentes. No lo empieces aquí.

## Para qué

Hay un cliente esperando que solo quiere la contabilidad. Es una empresa de otro sector (no hostelería), viene de Cegid Diez y quiere lo básico este año. El módulo de contabilidad tiene que funcionar como un producto propio:

* su marca;
* su dirección web;
* su pantalla de entrada;
* su menú;
* sus correos y PDF.

El cliente no tiene que ver nada de Folvy.

## Hechos de Julio (13/10/2026)

* La cuenta la crea Julio (o Folvy): da de alta la cuenta solo con Contabilidad e invita al cliente; el cliente termina el alta de su empresa. El registro por su cuenta desde la web, más adelante.
* «Independiente a la vista del cliente»: un nombre propio. El nombre aún no está decidido. Todo lo que dependa del nombre (texto, logo, dominio, remitente de correos, pie de los PDF) sale de un único sitio de configuración de marca, para que cambiarlo sea tocar un valor y no buscar por el código.
* Requisito ya escrito (01/10 y 02/10): todo lo de contabilidad funciona sin Cocina, albaranes, pedidos, TPV ni plataformas. Lo de hostelería aparece solo si la cuenta lo tiene.
* El cliente viene de Diez: su plan y su histórico se traen con lo ya hecho en el C02c (plan) y el C04b (histórico). Lo lanza Folvy como servicio, con su propio acceso a apiCON, que pedirá a Cegid.

## Lo que se construye

1. Marca del producto.
   * Configuración única: nombre, logo, favicon, dominio, remitente de correos y textos legales.
   * Cada petición sabe con qué marca se muestra por el dominio por el que entra: `app.folvy.app` → Folvy; el dominio de la marca → la marca.
   * Mientras no haya nombre, un dominio de pruebas y la marca «Contabilidad» genérica.
   * Nada de «Folvy» a la vista con esa marca: títulos de página, menús, «Volver a Folvy», avisos, correos de invitación y de contraseña, PDF, nombres de fichero exportados, mensajes de error y textos de la IA.
   * Una prueba e2e recorre las pantallas del módulo con la marca y falla si aparece la palabra "Folvy".
2. Alta de una cuenta solo de Contabilidad, por el administrador de la plataforma.
   * Formulario interno: nombre de la empresa, correo del administrador del cliente y marca.
   * Crea la cuenta con el interruptor `conta` y ningún módulo de Cocina, y manda la invitación con la marca.
   * El cliente entra, pone su contraseña y aterriza en el alta conversada del C00 (N1b), que ya existe.
   * Registro de quién creó la cuenta y cuándo.
3. Menú y entrada del módulo solo:
   * menú del módulo vendido solo (benchmark, «Menú del módulo vendido solo»), con solo lo que ya existe y funciona: nada de entradas vacías ni «muy pronto»;
   * el Inicio aprobado («Estilo nuevo · Inicio»), con las cifras que hoy se pueden calcular de verdad; lo que aún no exista no se enseña;
   * en móvil, igual.
4. Traer de Diez para otra empresa. Generaliza lo del C02c y el C04b para que no tenga nada de Foodint escrito:
   * empresa;
   * base de Diez (`nombre_bd`);
   * fecha de corte;
   * la correspondencia de analítica: vacía por defecto, que esa empresa no es hostelería.
   * Lo lanza Folvy (workflow con el id de la empresa y su propio secreto), no el cliente. Prueba en staging con una empresa inventada y el Diez simulado.
5. Comprobación «funciona sola»: la cuenta B de staging (sin Cocina) con la marca de pruebas recorre:
   * alta;
   * plan;
   * libro;
   * libros y balances;
   * fichas;
   * Bancos (cuando el frente B lo tenga).

   Todo sin un solo error ni una sola mención a Folvy.

## Norma

* RGPD y LSSI: aviso legal y política de privacidad propios de la marca (Folvy como encargado del tratamiento de los datos contables del cliente). Code deja los textos como hueco de configuración. Los redacta y aprueba Julio; Code no inventa textos legales.
* Marca: antes de fijar el nombre hay que comprobarlo en la OEPM y en la EUIPO. Lo hace Julio; Code no.

## Contraste

Contraste con:

* Holded: producto único, sin submarcas.
* Cegid: Diez y Contasimple, varias marcas sobre el mismo grupo.
* Pennylane: una marca, entrada limpia y portal del asesor.
* Anfix: el cliente entra invitado por su asesoría.

Sobre todo, cómo resuelven la invitación y el primer día. Lo que cogemos y dónde estamos por encima.

## Diseño (sección obligatoria)

* N18 «Entrar» (en el zip):
   * a la izquierda, logo y nombre de la marca, «Entra en tu contabilidad», correo, contraseña y «Entrar» en azul #2F5BFF;
   * a la derecha, en menta, cuatro frases de lo que hay dentro;
   * pie con la dirección de la marca y los enlaces legales.
* Correo de invitación con la marca: una sola acción, «Entrar en tu contabilidad». Haz la maqueta tú, en el mismo estilo, y enséñamela antes de dejarla fija.
* Estilo nuevo de siempre: Geist, sin negro y con el azul de acción. Navegación en tres niveles donde aplique.
* Fiel a la maqueta. Si algo no se puede, para y dilo.

## Tareas

1. Comprobaciones previas, solo leyendo, y para:
   * qué hay hoy para crear cuentas;
   * cómo se resuelve el dominio en Vercel (`folvy-app`: `app.folvy.app`, `foodint.folvy.app`);
   * dónde sale escrito «Folvy» (recuento por tipo: código, plantillas de correo, PDF, edge functions, textos de la IA);
   * qué entra hoy en el menú de una cuenta sin Cocina;
   * qué del C02c y del C04b tiene escrito Foodint (ids, `C0008`, correspondencias);
   * qué cambia para que una segunda empresa traiga su Diez;
   * choques con las sesiones A y B.
2. Configuración de marca, resolución por dominio y prueba «sin Folvy a la vista».
3. Alta de cuenta por el administrador, invitación con marca y entrada (N18).
4. Menú e Inicio del módulo solo.
5. Traer de Diez generalizado, con su prueba en staging.
6. Recorrido de la cuenta B con la marca de pruebas, e2e. Informe final con capturas comparadas con las maquetas y el contraste. Tanda para producción con su analizador.

## Trabajo en paralelo (nuevo: hay tres sesiones de Code a la vez)

* A · Ventas y facturas recibidas (rama `conta/c04b-diez`) y B · Bancos (rama `conta/b01-bancos`) trabajan a la vez que tú.
* Tus migraciones van con el prefijo `20261111T` (C). A usa `20261021T…` y B usa `20261101T…`.
* Staging es compartido. Solo migraciones que añaden. No deshagas nada que no sea tuyo. Tus semillas, con nombres propios del frente C.
* Ficheros compartidos (`antes-de-subir.sh`, el analizador, los workflows, `database.ts`, el menú del módulo): el menú lo tocas tú, que es tu encargo, pero de forma que B y A puedan añadir su entrada en una línea. Dilo en tu informe.
* El importador de Diez lo ha hecho A. Si lo generalizas, que el de Foodint siga dando exactamente lo mismo (prueba antes = después).
* Producción: nunca lanzas nada. Julio lanza una tanda cada vez; yo le digo el orden.

## Reglas de siempre

* Nada real en el repositorio (público) ni en staging.
* En producción solo se lee.
* Un freno de seguridad solo se afloja con autorización explícita de Julio.
* Los hechos del negocio se preguntan, no se suponen.
* Lista de antes de subir entera antes de cada push.
* Fichero entero y como usuario en las pruebas de staging.
