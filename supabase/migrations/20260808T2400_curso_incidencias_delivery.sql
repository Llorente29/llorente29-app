-- ============================================================================
-- Folvy · CURSO "Incidencias en delivery: qué hacer cuando algo se tuerce"
-- Molde: docs/folvy_formacion_guia_contenido.md · Catálogo v2 Bloque C
-- ----------------------------------------------------------------------------
-- Tercer curso de delivery. Cubre lo que NO enseñan los otros dos: qué se hace
-- cuando el plan falla. Es el curso que más dinero ahorra, porque la mayoría del
-- coste de una incidencia no viene del error, sino de cómo se gestiona después.
--
-- TAXONOMÍA: category='delivery' · business_types={dark_kitchen,delivery,restaurante}
--            level='base' · requires_practical=false
--   (requires_practical FALSE: aquí no hay un gesto que observar, es criterio de
--    decisión. La verificación se hace con el test situacional.)
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — status 'draft'. Este curso menciona la
--    operación real (agotados/86, plataformas, reparto propio). Julio debe
--    ajustar los criterios de compensación y quién decide qué, que son
--    decisiones de negocio de cada cliente, no de Folvy.
--
-- Correctas del test: b d c a b c a d b c (verificado)
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
    null, 'incidencias_delivery',
    'Incidencias en delivery: qué hacer cuando algo se tuerce',
    'Producto agotado, pedido que se retrasa, cliente enfadado, reclamación por algo que faltaba. Qué se hace, en qué orden y quién decide.',
    'Buenas prácticas de operación',
    'folvy_imparte', 12, false, false, 15, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    reeval_months = excluded.reeval_months, estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'incidencias_delivery' and account_id is null;
  end if;

  if exists (select 1 from information_schema.columns where table_name='course' and column_name='category') then
    execute format('update public.course set category=%L, level=%L, recommended_order=%s where id=%L',
                   'delivery', 'base', 120, v_course_id);
  end if;
  if exists (select 1 from information_schema.columns where table_name='course' and column_name='business_types') then
    execute format('update public.course set business_types=%L::text[] where id=%L',
                   '{dark_kitchen,delivery,restaurante}', v_course_id);
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ TEORÍA ═══════════════════════════════════════════════════════════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'La incidencia no es el problema. La gestión, sí',
$md$Van a pasar cosas. Se va a agotar un producto en plena hora punta, un pedido se va a retrasar, alguien va a montar mal una bolsa. Eso es inevitable en un servicio con veinte pedidos a la vez.

Lo que **no** es inevitable es lo que viene después.

Piensa en tu propia experiencia como cliente: cuando algo te ha salido mal en un restaurante y lo han resuelto rápido y sin discutir, probablemente sigues yendo. Cuando te han hecho sentir que mentías o que molestabas, no volviste. **El error no te perdió como cliente; la gestión sí.**

En delivery esto pesa más todavía, porque no hay cara. No puedes disculparte mirando a alguien: solo tienes lo que aparece en su pantalla y lo que llega en la bolsa.

**Tres principios que valen para toda incidencia:**
1. **Avisar antes es siempre mejor que explicar después.** Un cliente al que avisas de que su producto se ha agotado casi siempre acepta un cambio. El mismo cliente que lo descubre al abrir la bolsa, reclama.
2. **La decisión no es tuya en solitario.** Compensar, rehacer o devolver dinero lo decide el responsable. Tú detectas, informas y aportas datos.
3. **Todo se registra.** Lo que no queda anotado no se puede analizar ni corregir, y desaparece.

**En tu turno esto pasa así:** el instinto en hora punta es "esto lo arreglo yo rápido y no molesto a nadie". Y casi siempre sale peor. Avisar cuesta quince segundos; una reclamación cuesta la comida, el reparto y la valoración.

> **Dato de operación** — El coste real de una incidencia se compone del producto perdido, el reparto perdido, el tiempo de gestión y el impacto en la valoración de la plataforma, que condiciona la visibilidad futura del local. El producto es lo más barato de los cuatro.$md$),

  (v_course_id, 2, 'Se ha agotado un producto',
$md$Es la incidencia más frecuente y la que peor se gestiona.

**Lo primero, y no es negociable: márcalo como agotado en el sistema.** Si no lo haces, se sigue vendiendo y en diez minutos tendrás tres pedidos más con el mismo problema. Una incidencia se convierte en cinco.

**Después, para el pedido que ya está en marcha:**
- **Avisa al responsable inmediatamente**, antes de que salga nada.
- **No sustituyas por tu cuenta.** Aunque el producto sea "casi igual", puede haber una alergia, una preferencia o un motivo religioso. Y el cliente pidió lo que pidió.
- Si hay que ofrecer alternativa, se le pregunta al cliente por el canal que corresponda.

**Y cuando vuelva a haber producto: acuérdate de reactivarlo.** Un producto que se queda apagado por olvido es dinero que dejas de ingresar sin enterarte, a veces durante días.

**Lo que nunca se hace:**
- Mandar el pedido incompleto sin avisar.
- Sustituir por algo "parecido" y esperar que no lo note.
- Apagar el producto y no volver a mirarlo en una semana.

**En tu turno esto pasa así:** lo más caro no es el pedido concreto: es **no apagar el producto**. Cinco pedidos más entran con ese plato, cinco clientes reclaman, y todos ellos tenían razón. Marcarlo cuesta diez segundos.

> **Dato de operación** — En Folvy, la disponibilidad (el "86") se gestiona por producto y se propaga a los canales. Apagar y reactivar es una acción del día a día, no una excepción: forma parte del trabajo de servicio.$md$),

  (v_course_id, 3, 'El pedido se retrasa',
$md$El retraso es la primera causa de valoración baja en delivery, por delante de la calidad de la comida.

**Y hay un motivo psicológico que conviene entender:** al cliente le molesta menos esperar 45 minutos sabiéndolo que esperar 30 creyendo que serían 20. Lo que enfada no es el tiempo: **es la incertidumbre**.

**Qué hacer:**
- **Detéctalo pronto.** Si ves que un pedido lleva demasiado en cola o el rider no llega, no esperes a que sea evidente.
- **Avisa al responsable** para que se pueda informar al cliente o a la plataforma.
- **No montes el pedido hasta que vaya a salir**, si el retraso es en cocina. Montarlo y dejarlo esperando empeora lo que llega.
- **Si el retraso es grande**, mejor rehacer lo que peor aguanta (fritos, cosas crujientes) que mandar algo que llegará mal.

**En pedidos de plataforma** (Glovo, Uber, JustEat) hay un factor extra: los tiempos que ves y los que ve el cliente pueden no coincidir, y un pedido "listo" puede quedarse esperando a un rider que no aparece. **Eso también es una incidencia que hay que comunicar**, aunque la culpa no sea del local: es información útil.

**En tu turno esto pasa así:** el retraso se acumula en trocitos que nadie considera problema — cinco minutos aquí, otros cinco allá — hasta que de repente lleva media hora. **El momento de avisar es cuando lo ves venir, no cuando ya es un desastre.**

> **Dato de operación** — Folvy registra los tiempos del pedido (aceptado, listo, recogido, entregado). Esos datos permiten distinguir si el retraso está en cocina, en la espera del rider o en la ruta — y cada uno se arregla de forma distinta.$md$),

  (v_course_id, 4, 'El cliente reclama',
$md$Que faltaba algo, que llegó frío, que no era lo que pidió. Aquí es donde más fácil es empeorarlo.

**Lo que funciona:**
- **Escucha primero, entera.** No interrumpas para explicar. Mucha gente solo necesita sentirse escuchada.
- **No discutas ni des a entender que miente.** Aunque tengas dudas.
- **Discúlpate por la experiencia**, sin necesidad de asignar culpas en ese momento: *"Siento que te haya llegado así"* funciona siempre y no admite responsabilidad de nada concreto.
- **Recoge los datos**: número de pedido, qué falta o qué pasó, y una foto si el canal lo permite.
- **Pásalo al responsable.** La compensación (rehacer, devolver, descuento) la decide él.

**Lo que lo empeora:**
- *"Pues aquí sale que se envió todo."* — Aunque sea verdad, es una acusación.
- *"Eso será cosa del repartidor."* — Al cliente le da igual de quién sea la culpa: compró en tu local.
- Prometer una compensación que no puedes garantizar.
- Tardar. Una reclamación sin respuesta se convierte en una reseña pública.

**Y algo importante:** si la reclamación es que **faltaba un producto**, es información valiosa, no solo un coste. Si se repite con el mismo plato o el mismo turno, hay un problema de proceso que arreglar.

**En tu turno esto pasa así:** cuando alguien reclama, el impulso natural es defenderse — "yo lo monté bien". Es humano y es el peor movimiento posible. **La conversación no va de quién tiene razón: va de si ese cliente vuelve a pedir.**

> **Dato de operación** — Una reclamación bien gestionada tiene mayor tasa de recompra que un pedido que salió bien sin incidencias. Es contraintuitivo y está bien documentado en atención al cliente.$md$),

  (v_course_id, 5, 'Casos especiales que hay que saber',
$md$**Reclamación por alergia o reacción.** 🔴 Prioridad máxima. Se avisa al responsable **de inmediato**, se **conservan** el plato, los envases y los registros, y no se tira nada. Si la persona tiene síntomas graves, **112**. Esto no se gestiona como una queja normal: es un asunto de seguridad.

**El pedido llegó a la dirección equivocada.** Aviso inmediato. Lo que ya se entregó no se recupera ni se reutiliza. Se rehace el correcto.

**El cliente dice que no ha recibido nada.** No es una acusación: puede haber pasado de verdad. Se comprueba lo registrado (entrega, foto si la hay, hora) y lo decide el responsable con los datos delante.

**Cliente agresivo o que falta al respeto.** No tienes que aguantarlo. Mantén el tono, no entres al trapo, y pasa la conversación a tu responsable. **La educación no incluye tragar insultos**, ni por teléfono ni en la puerta.

**Un producto llega en mal estado (olor, aspecto raro).** No se sirve ni se manda, aunque genere retraso. Se separa, se avisa y se registra. Esto no es una incidencia comercial: es seguridad alimentaria.

**Un error tuyo.** Dilo. Un error avisado a tiempo se arregla; uno escondido se convierte en reclamación. Y un equipo donde se pueden decir los errores tiene muchísimos menos.

**En tu turno esto pasa así:** los casos raros son justo donde más se improvisa, porque no hay costumbre. Por eso conviene tener claro **a quién se avisa** antes de que ocurra, no durante.

> **Dato de operación** — Ante cualquier sospecha de reacción alérgica, la conservación de muestras y registros es lo que permite investigar qué pasó y, llegado el caso, defender al establecimiento. Tirar el plato destruye la única prueba disponible.$md$),

  (v_course_id, 6, 'Registrar es lo que hace que no se repita',
$md$Una incidencia resuelta y no registrada **vuelve a pasar**. Siempre.

Registrar no es burocracia: es lo único que convierte un mal día en información útil. Sin registro, cada incidente parece mala suerte aislada. Con registro, aparecen los patrones:

- *"Las patatas llegan frías sobre todo los viernes"* → problema de hora punta, no de producto.
- *"Este plato genera reclamaciones de cantidad"* → el escandallo o el envase no cuadran.
- *"Faltan productos en los combos"* → hay que revisar cómo se montan.
- *"Los pedidos a esta zona llegan tarde"* → problema de ruta o de reparto.

**Qué debe quedar anotado:** qué pasó, en qué pedido, cuándo, y qué se hizo. Con eso basta.

**Y una cosa que conviene decir claramente:** registrar un fallo **no es delatar a nadie**. Si el equipo entiende el registro como una forma de buscar culpables, deja de registrarse y se pierde la información. El objetivo es arreglar el proceso, no señalar personas.

**Las cinco cosas que hay que recordar de este curso:**
1. Avisar antes es mejor que explicar después.
2. Si se agota algo, **márcalo en el sistema** — o serán cinco incidencias en vez de una.
3. Nunca sustituyas un producto por tu cuenta.
4. Ante una reclamación: escucha, discúlpate por la experiencia, recoge datos, pásalo.
5. Alergia o reacción: aviso inmediato, **conservar todo**, no tirar nada.

**Antes de terminar**, pregunta a tu responsable: **a quién se avisa en tu local cuando hay una incidencia, y dónde se registra.** Si no lo sabes, este curso no habrá servido del todo.

> **Dato de operación** — En Folvy las incidencias quedan asociadas al pedido, con sus tiempos y su estado de reparto. Esa trazabilidad es lo que permite distinguir un fallo puntual de un patrón, que son dos problemas completamente distintos.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: b d c a b c a d b c

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Se agota la carne de un plato en plena hora punta. ¿Qué es lo PRIMERO que haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Aviso al responsable del pedido que está en marcha.', false, 'Hay que hacerlo, pero antes hay algo aún más urgente.'),
   (v_q, 'Marcarlo como agotado en el sistema, para que no entren más pedidos con ese plato.', true, 'Correcto. Si no, en diez minutos tienes cinco incidencias en vez de una.'),
   (v_q, 'Sustituirlo por el corte más parecido que tengamos.', false, 'Nunca se sustituye por cuenta propia: puede haber alergia o preferencia.'),
   (v_q, 'Terminar el servicio y avisar al cierre.', false, 'Para entonces habrán entrado muchos pedidos imposibles de servir.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Un cliente llama diciendo que su pedido llegó frío. Tú lo montaste y sabes que salió caliente.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Le explico que aquí salió caliente y que será cosa del repartidor.', false, 'Al cliente le da igual de quién sea la culpa: compró en tu local.'),
   (v_q, 'Le digo que en el sistema consta que todo se envió correctamente.', false, 'Aunque sea verdad, suena a acusación y cierra la conversación.'),
   (v_q, 'Le ofrezco yo mismo un descuento para zanjarlo rápido.', false, 'La compensación la decide el responsable, no tú.'),
   (v_q, 'Le escucho entero, me disculpo por la experiencia, recojo los datos y lo paso al responsable.', true, 'Correcto. La conversación no va de quién tiene razón: va de si vuelve a pedir.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Un cliente comunica que ha tenido una reacción alérgica tras comer vuestro pedido.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Le pido disculpas y le ofrezco un pedido gratis para compensar.', false, 'No es una queja comercial: es un asunto de seguridad.'),
   (v_q, 'Recojo la queja y la paso al final del turno con las demás.', false, 'Esperar puede impedir investigar y agravar la situación.'),
   (v_q, 'Aviso al responsable de inmediato, conservo plato, envases y registros, y no tiro nada. Si hay síntomas graves, 112.', true, 'Correcto. Tirar el plato destruye la única prueba de lo que ocurrió.'),
   (v_q, 'Le digo que revise si el alérgeno lo declaró al pedir.', false, 'Poner la carga en el cliente en ese momento es lo peor posible.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'El pedido va a tardar 20 minutos más de lo previsto. ¿Cuándo se avisa?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'En cuanto se ve venir el retraso, para poder informar al cliente.', true, 'Correcto. Al cliente le molesta menos esperar sabiéndolo que la incertidumbre.'),
   (v_q, 'Cuando ya se ha pasado la hora prevista.', false, 'Para entonces el cliente ya está enfadado y con razón.'),
   (v_q, 'No se avisa: se intenta recuperar el tiempo.', false, 'Correr suele generar más errores, y el cliente sigue sin saber nada.'),
   (v_q, 'Solo si el cliente llama a preguntar.', false, 'Reaccionar en vez de anticipar es lo que produce las malas valoraciones.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'Ya hay producto otra vez del plato que apagaste hace dos horas. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Nada: mejor dejarlo apagado hasta mañana por seguridad.', false, 'Cada hora apagado es venta que se pierde sin motivo.'),
   (v_q, 'Reactivarlo en el sistema en cuanto hay producto disponible.', true, 'Correcto. Un plato apagado por olvido es dinero perdido sin enterarte.'),
   (v_q, 'Avisar solo a los compañeros de que ya hay.', false, 'Los canales de venta siguen mostrándolo como agotado.'),
   (v_q, 'Esperar al cambio de turno para no tocar el sistema en servicio.', false, 'La disponibilidad es una acción normal del servicio, no una excepción.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'Un cliente empieza a insultarte por teléfono por un retraso.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Le respondo en el mismo tono para que se dé cuenta.', false, 'Entrar al trapo escala el conflicto y te deja sin razón.'),
   (v_q, 'Aguanto lo que haga falta: el cliente siempre tiene razón.', false, 'Tiene razón sobre el pedido, no derecho a insultarte.'),
   (v_q, 'Mantengo el tono, no entro al trapo y paso la conversación a mi responsable.', true, 'Correcto. La educación no incluye tragar insultos.'),
   (v_q, 'Le cuelgo sin más.', false, 'Deja la incidencia sin resolver y empeora la reclamación.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'Un producto que ibas a usar tiene un olor raro, pero el pedido ya va con retraso.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No se usa: se separa, se avisa y se registra, aunque genere más retraso.', true, 'Correcto. Esto no es una incidencia comercial: es seguridad alimentaria.'),
   (v_q, 'Lo uso: con la salsa y el cocinado no se notará.', false, 'Cocinar no elimina el riesgo, y puede haber toxinas ya formadas.'),
   (v_q, 'Lo huelo otra vez y decido según me parezca.', false, 'Los sentidos no detectan la mayoría de patógenos.'),
   (v_q, 'Lo aparto y lo uso para la comida del personal.', false, 'La seguridad es la misma para el equipo que para el cliente.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, '¿Por qué hay que registrar las incidencias aunque ya se hayan resuelto?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Para saber a quién echar la culpa si se repite.', false, 'Si se usa para buscar culpables, la gente deja de registrar.'),
   (v_q, 'Por exigencia de las plataformas de delivery.', false, 'No es la razón: es una necesidad propia del local.'),
   (v_q, 'No hace falta si ya está resuelta con el cliente.', false, 'Resuelta y no registrada significa que volverá a pasar.'),
   (v_q, 'Porque sin registro no se ven los patrones, y un fallo puntual y un problema de proceso se arreglan de forma distinta.', true, 'Correcto. "Las patatas llegan frías los viernes" solo se descubre registrando.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Te das cuenta de que has puesto mal un modificador en un pedido que aún no ha salido.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo dejo pasar: es un detalle pequeño y vamos con retraso.', false, 'Para el cliente que lo pidió no es un detalle, y puede haber un motivo dietético.'),
   (v_q, 'Lo digo en el momento y lo corrijo antes de que salga.', true, 'Correcto. Un error avisado se arregla en dos minutos; uno escondido es una reclamación.'),
   (v_q, 'Espero a ver si el cliente reclama.', false, 'Sabiendo que está mal, dejar que salga garantiza el problema.'),
   (v_q, 'Lo anoto para comentarlo al final del turno.', false, 'Para entonces el pedido ya está en casa del cliente.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, 'Un cliente reclama que faltaba una salsa. Es la tercera vez esta semana con el mismo combo.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Mala suerte: los combos son complicados de montar.', false, 'Tres veces en una semana no es mala suerte: es un patrón.'),
   (v_q, 'Hay que tener más cuidado y ya está.', false, '"Más cuidado" no es una medida: no cambia el proceso.'),
   (v_q, 'Lo registro y lo comunico: si se repite con el mismo combo, hay un problema de proceso que arreglar, no de una persona.', true, 'Correcto. Los patrones se arreglan cambiando el proceso, no pidiendo atención.'),
   (v_q, 'Compenso al cliente y no le doy más vueltas.', false, 'Resuelves el caso pero garantizas que vuelva a ocurrir.');

  raise notice 'Curso de incidencias en delivery sembrado (draft). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='incidencias_delivery' and c.account_id is null;
-- Esperado: draft · 6 secciones · 10 preguntas · 10 correctas.
