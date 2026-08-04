-- ============================================================================
-- Folvy · CURSO "La estación: pedidos, cocina y disponibilidad"
-- Molde: docs/folvy_formacion_guia_contenido.md · Catálogo v2 Bloque C
-- ----------------------------------------------------------------------------
-- Cuarto y último curso de delivery. Es DISTINTO a los demás: no enseña un
-- concepto, enseña LA HERRAMIENTA. Es el manual de la tablet que tienen en el
-- pase, convertido en formación con evidencia.
--
-- RECON hecho contra el repo (03/08) — el curso describe la app REAL:
--   · Estación en tablet: 3 pestañas fijas — Pedidos · Cocina · Disponibilidad
--     (src/modules/tablet/TabletStationRoute.tsx), acceso por token de dispositivo.
--   · Pedidos: filtros nuevos / en curso / listos-reparto / incidencias,
--     los nuevos suben arriba, polling cada 10 s (OrdersFeed.tsx).
--   · Cocina: tablero KDS por estación, bump, Cook Mode (kds_recipe).
--   · Disponibilidad: agotar/reactivar producto (el "86") con alcance.
-- ⚠️ Si la app cambia, ESTE CURSO HAY QUE ACTUALIZARLO y subir version.
--    Es la contrapartida de enseñar la herramienta: envejece con ella.
--
-- TAXONOMÍA: category='delivery' · business_types={dark_kitchen,delivery,restaurante}
--            level='base' · requires_practical=true (manejar la tablet de verdad)
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — status 'draft'.
--
-- Correctas del test: c a d b a c b d c b (verificado)
-- DEPENDE DE: 20260806T1500_formacion_c1.sql · IDEMPOTENTE · Aplicada:
-- ============================================================================

do $guard$
begin
  if to_regclass('public.course') is null or to_regclass('public.course_section') is null
     or to_regclass('public.course_question') is null or to_regclass('public.course_option') is null then
    raise exception 'Faltan tablas de Formación C1.';
  end if;
end
$guard$;

do $seed$
declare
  v_course_id uuid;
  v_q uuid;
begin
  insert into public.course (
    account_id, code, title, summary, legal_basis, delivery_mode,
    reeval_months, is_mandatory, appcc_prerequisite, estimated_minutes,
    pass_threshold_pct, version, status
  ) values (
    null, 'estacion_kds',
    'La estación: pedidos, cocina y disponibilidad',
    'Cómo se usa la tablet del pase: aceptar pedidos, llevar el tablero de cocina y agotar un producto. La herramienta con la que trabajas cada servicio.',
    'Manual de operación de Folvy',
    'folvy_imparte', 12, false, false, 15, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    reeval_months = excluded.reeval_months, estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'estacion_kds' and account_id is null;
  end if;

  if exists (select 1 from information_schema.columns where table_name='course' and column_name='category') then
    execute format('update public.course set category=%L, level=%L, recommended_order=%s where id=%L',
                   'delivery', 'base', 130, v_course_id);
  end if;
  if exists (select 1 from information_schema.columns where table_name='course' and column_name='business_types') then
    execute format('update public.course set business_types=%L::text[] where id=%L',
                   '{dark_kitchen,delivery,restaurante}', v_course_id);
  end if;
  if exists (select 1 from information_schema.columns where table_name='course' and column_name='requires_practical') then
    execute format('update public.course set requires_practical=true where id=%L', v_course_id);
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ TEORÍA ═══════════════════════════════════════════════════════════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'Tres pestañas y ya está',
$md$La tablet del pase tiene **tres pestañas**, siempre visibles, y no hay más. Todo lo que necesitas durante un servicio está ahí:

- **Pedidos** — lo que entra: aceptar, ver qué han pedido, marcar cuando está listo.
- **Cocina** — el tablero de producción: qué se está haciendo y en qué estación.
- **Disponibilidad** — agotar o reactivar un producto (lo que se llama "el 86").

**No hace falta usuario ni contraseña.** La tablet ya está vinculada al local: se enciende y funciona. Eso es a propósito — en cocina, con las manos ocupadas y prisa, un login es un obstáculo.

**Y lo que eso implica:** cualquiera que toque esa tablet está actuando en nombre del local. Trátala como la caja: no se lleva a la calle, no se presta, y si desaparece **se avisa** para que se pueda revocar.

**En tu turno esto pasa así:** el error más común no es de manejo, es de atención. La tablet **se queda apagada, boca abajo o tapada con un paño** en pleno servicio, y los pedidos entran sin que nadie los vea. La estación solo sirve si está encendida y a la vista.

> **Dato de operación** — La estación se conecta por un token del propio dispositivo, no por una cuenta de persona. Si una tablet se pierde o se estropea, el responsable puede revocar su acceso desde configuración sin afectar al resto.$md$),

  (v_course_id, 2, 'Pedidos: lo que entra',
$md$Es la pestaña con la que más vas a trabajar. Se abre sola al encender.

**Los pedidos nuevos suben arriba del todo.** No hay que buscarlos: si hay algo nuevo, está lo primero.

**Los filtros de la parte de arriba** te dejan ver solo lo que te interesa:
- **Nuevos** — han entrado y aún no se han aceptado.
- **En curso** — aceptados, en preparación.
- **Listos / reparto** — terminados, esperando recogida o ya en ruta.
- **Incidencias** — los que tienen algún problema.

**El flujo normal de un pedido:**
1. **Entra** y aparece arriba como nuevo.
2. **Aceptar** — confirmas que lo vas a hacer. A partir de ahí el cliente y la plataforma saben que está en marcha.
3. Se prepara (eso se ve en la pestaña Cocina).
4. **Listo** — cuando está montado y precintado. Ese toque avisa de que puede recogerse.

**Dos cosas importantes sobre "Aceptar":**
- **Acepta en cuanto puedas hacerlo**, no cuando termines. Aceptar no significa "está hecho": significa "lo tengo y lo estoy haciendo". Un pedido sin aceptar deja al cliente sin saber nada.
- Pero **no aceptes lo que no puedes hacer**. Si falta producto o vais desbordados, eso se comunica, no se acepta y se resuelve luego.

**La pantalla se actualiza sola cada pocos segundos.** No hace falta recargar ni tocar nada para que aparezcan los pedidos nuevos.

**En tu turno esto pasa así:** el fallo típico en hora punta es aceptar todo de golpe "para quitar los avisos" y luego no saber por dónde vas. Los estados sirven para que el equipo entero sepa qué está pasando: si todo está "aceptado" pero nada avanza, la pantalla deja de contar la verdad.

> **Dato de operación** — El estado del pedido se empuja automáticamente al canal (Glovo, Uber, JustEat o tienda propia). Lo que marcas en la tablet es lo que ve el cliente en su móvil: por eso importa que refleje la realidad.$md$),

  (v_course_id, 3, 'Cocina: el tablero de producción',
$md$Esta pestaña es el **KDS**: el tablero donde se ve qué hay que producir.

Cada ticket muestra los platos de un pedido, **repartidos por estación** (plancha, freidora, montaje…). Cada puesto ve lo suyo, no todo mezclado.

**Cómo se trabaja:**
- **Marca los platos según los vas terminando.** No al final: sobre la marcha. Así el resto del equipo ve en tiempo real qué queda.
- **Si te equivocas, se puede desmarcar.** Marcar no es irreversible: no hay que tener miedo a tocar.
- Cuando todos los platos del ticket están hechos, el ticket **se cierra** (bump) y desaparece del tablero.

**Los colores del semáforo** indican cuánto tiempo lleva un ticket esperando. Un ticket que cambia de color no es un reproche: es información para reordenar y para pedir ayuda antes de que se acumule.

**Cook Mode**: si un plato lleva receta cargada, puedes abrirla desde el propio ticket y ver los pasos. Muy útil con platos que no haces todos los días o cuando entra gente nueva.

**En tu turno esto pasa así:** lo que rompe el tablero es **marcar todo de golpe al final**. Durante quince minutos nadie sabe por dónde va el pedido, y luego aparece todo hecho de golpe. El KDS solo funciona si refleja lo que está pasando **mientras** pasa.

> **Dato de operación** — El tablero registra los tiempos de cada hito del pedido. Esos datos alimentan los indicadores de cocina: cuánto se tarda de aceptado a listo, dónde se atasca el pase. Marcar a tiempo no es burocracia: es lo que hace que esos números sirvan.$md$),

  (v_course_id, 4, 'Disponibilidad: agotar y reactivar (el 86)',
$md$Cuando se acaba un producto, **se apaga desde aquí**. Es de las acciones más importantes del servicio y de las que más se olvidan.

**Por qué importa tanto:** si no lo apagas, se sigue vendiendo. En diez minutos tienes tres pedidos más con ese plato, tres clientes esperando algo que no existe y tres reclamaciones. **Una incidencia se convierte en cinco por no tocar un botón.**

**Cómo se hace:**
- Busca el producto, y **agótalo**. Puedes indicar el alcance: solo aquí, o donde corresponda.
- Deja de venderse **en todos los canales**, sin que tengas que entrar en Glovo, Uber o JustEat por separado.

**Y lo que más se olvida: reactivarlo.** En cuanto vuelva a haber producto, se enciende otra vez. Un plato apagado por olvido es **dinero que dejas de ingresar sin enterarte**, a veces durante días — y nadie lo nota hasta que alguien pregunta por qué no se vende.

**Buena costumbre:** revisar los agotados **al empezar y al cerrar el turno**. Treinta segundos que evitan pérdidas invisibles.

**En tu turno esto pasa así:** apagar se hace casi siempre, porque el problema aprieta en ese momento. Encender se olvida casi siempre, porque cuando llega el producto ya no duele nada. Por eso conviene mirarlo al cambio de turno.

> **Dato de operación** — La disponibilidad se gestiona por producto y se propaga a los canales conectados. Un producto agotado en Folvy deja de ofrecerse en las plataformas sin entrar en cada panel por separado.$md$),

  (v_course_id, 5, 'Cuando la tablet falla',
$md$Pasa, y conviene saber qué hacer sin ponerse nervioso.

**No entran pedidos y llevas rato sin ver nada.** Puede ser que no haya pedidos, o que algo esté fallando. Comprueba en este orden:
1. ¿La tablet tiene **wifi**?
2. ¿La pantalla está **despierta** y en la pestaña correcta?
3. Prueba a **recargar** la página.
4. Si sigue sin nada, **avisa al responsable**. No te quedes esperando media hora "por si acaso".

**La tablet se apaga o se queda sin batería.** Que esté **siempre enchufada**. Una tablet apagada en el pase es un servicio a ciegas.

**Se ha caído o se ha roto la pantalla.** Avisa: hay que revocar su acceso y reemplazarla.

**La pantalla dice algo que no cuadra con la realidad** (un pedido que ya saliste, un plato que no es). No lo ignores ni lo arregles a mano por tu cuenta: **avísalo**. Que la pantalla y la cocina no coincidan es el principio de un lío gordo.

**Regla general:** la estación es una herramienta de trabajo, como la plancha. Si algo no funciona, **se comunica en el momento**, no al final del turno. Media hora de pedidos sin ver puede significar varios pedidos cancelados.

**En tu turno esto pasa así:** ante una duda técnica, mucha gente prefiere apañarse antes que "molestar". En una cocina eso significa **servicio a ciegas**. Preguntar cuesta un minuto; un servicio sin visibilidad cuesta pedidos y clientes.

> **Dato de operación** — Existe un vigilante automático que detecta silencios anómalos de pedidos en horario de servicio y avisa. Pero no sustituye a que alguien diga que la tablet no va: cuanto antes se sepa, menos pedidos se pierden.$md$),

  (v_course_id, 6, 'Por qué esto importa más de lo que parece',
$md$Todo lo que tocas en la tablet **sale de esa pantalla**.

- El **estado que marcas** es lo que ve el cliente en su móvil.
- Los **tiempos** que se registran son los que dicen si vais bien o si el pase se atasca.
- La **disponibilidad** que apagas decide lo que se vende en todas las plataformas.
- Y todo eso alimenta los **datos con los que se toman decisiones**: cuánta gente poner un miércoles, qué platos se retrasan siempre, dónde se pierde el margen.

**Dicho de otra forma: si la pantalla miente, las decisiones se toman con datos falsos.** Un pedido marcado como listo cuando aún no lo está, o un agotado que nadie reactivó, ensucian todo lo que viene después.

**No es una pantalla de control sobre ti.** Es la memoria del servicio. Sin ella, lo único que queda es lo que cada uno recuerde de una noche con ochenta pedidos, que es exactamente nada.

**Las cinco cosas que hay que recordar:**
1. La tablet, **encendida, enchufada y a la vista**. Siempre.
2. **Acepta** en cuanto puedas hacer el pedido, no cuando termines.
3. Marca los platos **según los haces**, no todos al final.
4. Si se agota algo, **apágalo al momento** — y **reactívalo** cuando vuelva.
5. Si algo no cuadra o no funciona, **avisa ya**, no al cierre.

**Antes de terminar**, comprueba con tu responsable **a quién se avisa si la tablet falla en pleno servicio**. Es lo que peor se improvisa.

> **Dato de operación** — Los hitos que se registran en la estación (aceptado, listo, recogido, entregado) son los que permiten distinguir si un retraso está en cocina, en la espera del repartidor o en la ruta. Cada uno se arregla de forma distinta, y sin datos no se sabe cuál es.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: c a d b a c b d c b

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Se acaba de agotar un producto en plena hora punta. ¿Qué haces en la estación?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Aviso de viva voz al equipo y sigo con el servicio.', false, 'El equipo se entera, pero los canales siguen vendiéndolo.'),
   (v_q, 'Lo apunto en un papel para apagarlo al cerrar.', false, 'Durante horas seguirán entrando pedidos imposibles de servir.'),
   (v_q, 'Entro en Disponibilidad y lo agoto en el momento: deja de venderse en todos los canales.', true, 'Correcto. Si no, una incidencia se convierte en cinco.'),
   (v_q, 'Entro en Glovo, Uber y JustEat a apagarlo uno por uno.', false, 'No hace falta: desde Folvy se propaga a los canales conectados.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, '¿Cuándo se pulsa "Aceptar" en un pedido?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'En cuanto sabes que lo puedes hacer: aceptar significa "lo tengo y lo estoy haciendo".', true, 'Correcto. Un pedido sin aceptar deja al cliente sin información.'),
   (v_q, 'Cuando el pedido ya está terminado y montado.', false, 'Para entonces el cliente lleva mucho rato sin saber nada.'),
   (v_q, 'Cuando llega el repartidor.', false, 'Aún más tarde: el estado deja de reflejar la realidad.'),
   (v_q, 'Todos de golpe al empezar el turno, para quitar los avisos.', false, 'Si todo está aceptado pero nada avanza, la pantalla miente.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Estás en el tablero de cocina y vas terminando platos de un ticket. ¿Cuándo los marcas?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Todos juntos al final, para no estar tocando la pantalla.', false, 'Durante ese rato nadie sabe por dónde va el pedido.'),
   (v_q, 'Solo si alguien pregunta por ese pedido.', false, 'El tablero deja de servir como información compartida.'),
   (v_q, 'Al cerrar el turno, repasando lo hecho.', false, 'Los tiempos registrados serían falsos y no servirían para nada.'),
   (v_q, 'Según los voy terminando: así el equipo ve en tiempo real qué queda.', true, 'Correcto. Y si te equivocas, se puede desmarcar: no hay que tener miedo a tocar.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'Llevas 40 minutos sin ver entrar ningún pedido y es viernes noche. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Nada: habrá poca gente pidiendo hoy.', false, 'Un viernes noche sin pedidos es señal de alarma, no de calma.'),
   (v_q, 'Compruebo wifi, que la pantalla esté despierta y recargo; si sigue sin nada, aviso al responsable.', true, 'Correcto. Media hora a ciegas puede costar varios pedidos cancelados.'),
   (v_q, 'Reinicio la tablet varias veces hasta que funcione.', false, 'Reiniciar sin avisar deja el servicio ciego más tiempo.'),
   (v_q, 'Espero al cierre y lo comento entonces.', false, 'Para entonces los pedidos perdidos ya no se recuperan.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'Ya hay producto otra vez de un plato que agotaste hace tres horas.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo reactivo en Disponibilidad en cuanto hay producto.', true, 'Correcto. Un plato apagado por olvido es venta perdida que nadie nota.'),
   (v_q, 'Lo dejo apagado hasta mañana, por si acaso.', false, 'Cada hora apagado sin motivo es dinero que no entra.'),
   (v_q, 'Aviso al equipo de que ya hay, y ya está.', false, 'Los canales lo siguen mostrando como agotado.'),
   (v_q, 'Lo reactivo cuando lo pida un cliente.', false, 'No puede pedirlo: no le aparece disponible.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, '¿Por qué la estación no pide usuario y contraseña?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Porque es una pantalla sin datos importantes.', false, 'Lleva pedidos, clientes y disponibilidad: son datos del negocio.'),
   (v_q, 'Porque todos los trabajadores comparten la misma cuenta.', false, 'No es una cuenta de persona: el acceso es del dispositivo.'),
   (v_q, 'Porque la tablet está vinculada al local por un token del dispositivo: en cocina, con prisa y manos ocupadas, un login es un obstáculo.', true, 'Correcto. Por eso también hay que avisar si se pierde: se le revoca el acceso.'),
   (v_q, 'Porque solo funciona dentro del local.', false, 'La vinculación es del dispositivo, no de la ubicación.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'La pantalla muestra como pendiente un pedido que tú ya entregaste hace rato.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo ignoro: yo sé que ya salió.', false, 'Que la pantalla y la cocina no coincidan es el principio de un lío.'),
   (v_q, 'Lo aviso: si la pantalla y la realidad no coinciden, hay que corregirlo antes de que crezca.', true, 'Correcto. Los datos falsos ensucian todo lo que viene después.'),
   (v_q, 'Lo dejo para que lo vea el turno siguiente.', false, 'Trasladas un problema sin contexto a quien no sabe qué pasó.'),
   (v_q, 'Cancelo el pedido para que desaparezca.', false, 'Cancelar un pedido entregado genera un problema mayor.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, '¿Dónde debe estar la tablet durante el servicio?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Guardada para que no se manche, y se consulta de vez en cuando.', false, 'Guardada significa pedidos que entran sin que nadie los vea.'),
   (v_q, 'En la oficina, que es donde está el responsable.', false, 'El pedido se trabaja en el pase, no en la oficina.'),
   (v_q, 'Da igual mientras alguien la mire cada cierto tiempo.', false, '"Cada cierto tiempo" en hora punta son quince minutos de retraso.'),
   (v_q, 'Encendida, enchufada y a la vista en el pase.', true, 'Correcto. La estación solo sirve si está visible y despierta.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Vais desbordados y entra un pedido que ahora mismo no podéis asumir.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo acepto igual y ya se verá.', false, 'Aceptar lo que no puedes hacer garantiza un retraso y una mala valoración.'),
   (v_q, 'Lo dejo sin tocar y que se cancele solo.', false, 'El cliente se queda esperando sin ninguna información.'),
   (v_q, 'Lo comunico al responsable para decidir: aceptar sin poder hacerlo es peor que avisar.', true, 'Correcto. La decisión de rechazar o pausar no es individual.'),
   (v_q, 'Lo acepto y marco listo para que no moleste en pantalla.', false, 'Eso es directamente falsear el estado: el cliente creerá que va en camino.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, '¿Para qué sirven los tiempos que registra la estación?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Para controlar lo que tarda cada trabajador.', false, 'No es una herramienta de control individual: mide el proceso.'),
   (v_q, 'Para saber si un retraso está en cocina, en la espera del repartidor o en la ruta: cada uno se arregla distinto.', true, 'Correcto. Sin esos datos no se sabe qué hay que arreglar.'),
   (v_q, 'Para justificarse ante las plataformas.', false, 'Sirven sobre todo para uso interno del local.'),
   (v_q, 'Para nada práctico: son estadísticas de oficina.', false, 'Deciden plantilla, producción y dónde está el cuello de botella.');

  raise notice 'Curso de estación/KDS sembrado (draft, delivery). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='estacion_kds' and c.account_id is null;
-- Esperado: draft · 6 secciones · 10 preguntas · 10 correctas.
--
-- Y el bloque delivery completo (4 cursos):
-- select code, status from course where account_id is null
--   and code in ('embolsado_delivery','temperatura_ruta_delivery',
--                'incidencias_delivery','estacion_kds') order by code;
