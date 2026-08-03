-- ============================================================================
-- Folvy · CURSO "Embolsado y montaje del pedido (delivery)"
-- Molde: docs/folvy_formacion_guia_contenido.md · Catálogo v2 Bloque C
-- ----------------------------------------------------------------------------
-- PRIMER CURSO DE OPERACIÓN (no de cumplimiento legal). Ataca el origen de la
-- mayoría de reclamaciones en delivery: el pedido mal montado.
--
-- TAXONOMÍA (guía §5.bis):
--   category        = 'delivery'
--   business_types  = {dark_kitchen, delivery, restaurante}  ← NO aplica a un bar
--                     de tapas sin reparto. (Se puede filtrar porque NO es de
--                     cumplimiento legal: esa regla solo protege a los obligatorios.)
--   level           = 'base'
--   requires_practical = true  → montar un pedido real y que el responsable lo valide
--
-- ⚠️ Los campos de taxonomía y requires_practical los crea el encargo C4
--    (ENCARGO_CODE_formacion_c4_practica_catalogo.md). Esta migración los escribe
--    SOLO SI las columnas existen — así puede aplicarse antes o después de C4 sin
--    romperse, y al aplicar C4 basta con reejecutarla para completar la clasificación.
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — status 'draft'.
--    Contenido operativo: parte del funcionamiento real de Llorente29 (Glovo,
--    Uber, JustEat, Shop propio, reparto Catcher). Julio debe ajustar lo que no
--    coincida con su operación antes de publicar.
--
-- Correctas del test: b c a d b a c b d c (verificado)
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
    null, 'embolsado_delivery',
    'Embolsado y montaje del pedido',
    'Cómo montar un pedido para que llegue caliente, completo y presentable. Es donde se generan casi todas las reclamaciones, y donde más fácil es evitarlas.',
    'Buenas prácticas de operación · Reg. (CE) 852/2004 (transporte de alimentos)',
    'folvy_imparte', 12, false, false, 15, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis, reeval_months = excluded.reeval_months,
    estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'embolsado_delivery' and account_id is null;
  end if;

  -- Taxonomía y práctica: solo si las columnas ya existen (las crea C4).
  if exists (select 1 from information_schema.columns
              where table_name='course' and column_name='category') then
    execute format(
      'update public.course set category=%L, level=%L, recommended_order=%s where id=%L',
      'delivery', 'base', 100, v_course_id);
  end if;
  if exists (select 1 from information_schema.columns
              where table_name='course' and column_name='business_types') then
    execute format(
      'update public.course set business_types=%L::text[] where id=%L',
      '{dark_kitchen,delivery,restaurante}', v_course_id);
  end if;
  if exists (select 1 from information_schema.columns
              where table_name='course' and column_name='requires_practical') then
    execute format('update public.course set requires_practical=true where id=%L', v_course_id);
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ TEORÍA ═══════════════════════════════════════════════════════════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'El plato lo has hecho bien. Ahora hay que entregarlo bien',
$md$En un local con sala, el cliente ve el plato dos minutos después de salir de cocina. En delivery pasan **treinta**, dentro de una bolsa, en una moto.

Eso significa una cosa incómoda: **puedes cocinar perfecto y que el cliente reciba algo malo**. Y para él la culpa es tuya, no de la moto.

Lo que se rompe por el camino, por orden de frecuencia:
- **Falta algo** — una bebida, una salsa, uno de los platos del combo.
- **Llega frío o blando** — las patatas al vapor dentro de una bolsa cerrada.
- **Se ha volcado** — la sopa, la salsa, la bebida.
- **Está mal presentado** — el burger aplastado, el pan empapado.

Y aquí está el dato que conviene tener en la cabeza: **cada reclamación cuesta el doble**. Se regala la comida, y encima baja la valoración del local en la plataforma — que es lo que decide cuánta gente te encuentra mañana.

**En tu turno esto pasa así:** el error casi nunca es de conocimiento. Es de **prisa en el momento del cierre de la bolsa**. Veinte pedidos a la vez, tres bolsas abiertas en el pase, y una salsa que se queda en la encimera. Por eso el embolsado necesita un método, no buena voluntad.

> **Dato de operación** — El embolsado es el último punto de control antes de que el pedido salga de tu alcance. Después ya no se puede corregir nada: lo que sale mal, llega mal.$md$),

  (v_course_id, 2, 'La regla de oro: cada cosa en su sitio',
$md$La mayoría de los problemas de temperatura y textura se resuelven con una sola idea: **lo que no se lleva bien, no viaja junto.**

**Separa siempre:**
- **Caliente con caliente, frío con frío.** Una ensalada al lado de una hamburguesa recién hecha llega templada y mustia. Si el pedido lleva ambos, **van en bolsas separadas** o con separador.
- **Lo crujiente, aparte y ventilado.** Patatas, rebozados y fritos **sudan**: si los cierras en un recipiente hermético, el vapor los ablanda. Van en su bolsa de papel o con la tapa perforada.
- **Las salsas, cerradas y de pie.** Nunca sueltas en el fondo de la bolsa.
- **Las bebidas, aparte.** Siempre. De pie y, si es posible, en su propia bolsa. Una bebida volcada arruina el pedido entero, no solo la bebida.

**Y el orden dentro de la bolsa importa:**
- Lo **pesado abajo**, lo **ligero arriba**. Un refresco de dos litros encima de una hamburguesa la deja plana.
- Lo **líquido, siempre de pie** y encajado para que no baile.
- Los **postres, arriba y sin peso encima**.

**En tu turno esto pasa así:** el clásico es meter las patatas en la misma bolsa hermética que la hamburguesa "para que no se enfríen". Llegan blandas las dos: la hamburguesa suelta vapor y las patatas lo absorben. Van juntas de temperatura, sí, pero **separadas de aire**.

> **Dato de operación** — Los fritos pierden textura por condensación, no por frío. Necesitan salida de vapor. Los productos calientes húmedos (guisos, salsas) son la principal fuente de esa condensación.$md$),

  (v_course_id, 3, 'La comprobación de 10 segundos',
$md$Antes de cerrar cualquier bolsa, **una comprobación fija. Siempre la misma, siempre en el mismo orden.** Diez segundos.

1. **Lee el ticket entero**, no de memoria. Aunque sea el pedido de siempre.
2. **Cuenta los artículos** contra el ticket. Uno a uno, señalándolos.
3. **Modificadores**: ¿sin cebolla? ¿extra de queso? ¿el punto de la carne? Esto es lo que más se salta.
4. **Salsas y extras**: son lo primero que se olvida y lo primero que reclaman.
5. **Bebidas**: ¿están? ¿de pie? ¿cerradas?
6. **Cubiertos y servilletas** según lo que haya pedido.
7. **Alergias o notas del cliente**: ¿está identificado el plato especial?
8. **Cierra y precinta.**

**Y luego pon el ticket visible por fuera.** Si hay dudas al recoger, se resuelven sin abrir la bolsa.

**El precinto no es decoración.** Es lo que le dice al cliente que nadie ha tocado su comida desde que salió de cocina, y lo que os protege si alguien reclama que faltaba algo: una bolsa precintada que llega intacta cambia por completo la conversación.

**En tu turno esto pasa así:** la trampa es el pedido conocido. "Este es el de siempre, dos smash y patatas" — y ese día llevaba una salsa extra que nadie miró. **Se lee el ticket siempre**, aunque lo hayas montado cien veces.

> **Dato de operación** — La verificación contra ticket antes del cierre es el control que más reclamaciones evita. Debe hacerla la misma persona que cierra la bolsa, no otra: cuando la responsabilidad se reparte, nadie la asume.$md$),

  (v_course_id, 4, 'Cada plato tiene su forma de viajar',
$md$Algunos productos necesitan trato específico. Son pocos y siempre los mismos:

**Hamburguesas y bocadillos.** El pan absorbe. Si la salsa va dentro y el pedido tarda, llega empapado. Envuelve bien y ajustado —lo que se mueve, se desmonta— y **nunca pongas peso encima**.

**Patatas y fritos.** Bolsa de papel o recipiente ventilado. Si el cliente pide salsa para mojar, **la salsa va aparte**, nunca por encima.

**Pizza.** Plana, sola y en horizontal. Su caja ya está diseñada para ventilar. **Nada encima de una pizza.**

**Sopas, cremas y guisos.** Envase bien cerrado, comprobado apretando la tapa, y **siempre de pie**. Si vuelca, arruina todo lo demás.

**Ensaladas y frío.** Lejos de cualquier fuente de calor y con el aliño aparte. Una ensalada aliñada 30 minutos antes llega marchita.

**Postres.** Arriba del todo, sin peso, y lejos del calor. Un helado o algo con cobertura de chocolate necesita ir con frío.

**Combos.** Revisa **todos los componentes** contra el ticket. Es donde más se olvida algo, porque el combo se monta "de memoria" y a veces lleva variantes.

**En tu turno esto pasa así:** lo más difícil es el pedido mixto — caliente, frío y bebida a la vez. La solución no es apretar más: es **usar más bolsas**. Una bolsa extra cuesta céntimos; un pedido devuelto cuesta la comida, el reparto y una mala reseña.

> **Dato de operación** — El envase y el modo de embolsado forman parte del coste del plato y del escandallo. Ahorrar en una bolsa separadora para acabar regalando el pedido es la peor economía posible.$md$),

  (v_course_id, 5, 'Que salga caliente y que salga a tiempo',
$md$De nada sirve montar perfecto si la bolsa se queda veinte minutos esperando en el pase.

**Monta el pedido cuando el repartidor esté a punto de llegar**, no en cuanto sale el primer plato. Si tienes visibilidad del tiempo de llegada, úsala: cada minuto en la estantería es temperatura perdida.

**El orden correcto es**: lo que aguanta mejor se monta primero; lo crujiente y lo frío, lo último, justo antes de cerrar.

**No apiles bolsas** unas encima de otras. Se aplasta lo de abajo.

**Si el pedido se retrasa mucho** y ya lleva rato montado: avisa al responsable. **Rehacer las patatas cuesta céntimos**; un cliente que recibe fritos blandos y fríos no vuelve, y eso cuesta mucho más.

**Al entregar al repartidor:**
- Confirma el **código o número del pedido** con él. Entregar la bolsa equivocada es de los peores errores: fastidias dos pedidos a la vez.
- Dile si lleva **algo delicado** (una bebida, una tarta) para que lo coloque bien.
- Comprueba que lo mete en la mochila **de pie** y con el aislamiento cerrado.

**En tu turno esto pasa así:** en hora punta se montan cuatro pedidos a la vez y las bolsas se parecen todas. **Etiqueta siempre en el momento**, nunca "luego lo pongo". Dos bolsas sin etiqueta en el pase acaban intercambiadas.

> **Dato de operación** — El tiempo entre el fin de cocinado y la recogida es el tramo que más afecta a la calidad percibida, y el único que depende enteramente del local. La temperatura en ruta se pierde mucho más despacio que en una estantería abierta.$md$),

  (v_course_id, 6, 'Cuando algo va mal',
$md$**Falta un producto porque está agotado.** No lo sustituyas por tu cuenta ni lo mandes sin él: avisa al responsable **antes** de que salga el pedido. El cliente puede aceptar un cambio si se lo preguntas; si se lo encuentra, reclama seguro. Y **marca el producto como agotado en el sistema** (el 86) para que no vuelva a entrar.

**El pedido se ha caído o se ha volcado.** No se manda. Se rehace. Un plato volcado y recolocado llega igualmente mal presentado y se nota.

**Un cliente reclama que faltaba algo.** No discutas ni lo des por perdido automáticamente: avisa al responsable y **mira lo que quedó registrado**. Por eso la verificación contra ticket importa — es lo que permite saber qué pasó de verdad.

**Un pedido con alergia declarada.** Va **identificado y aparte**, sin excepción. Si el cliente indicó una alergia y el pedido lleva varios platos, el suyo debe poder distinguirse sin abrir nada.

**Y lo más importante de todo esto:** si te has equivocado, **dilo en el momento**. Un error avisado se arregla en dos minutos con una llamada. Un error que sale por la puerta se convierte en una reclamación, una valoración de una estrella y una comida regalada.

**En tu turno esto pasa así:** lo que más caro sale no es equivocarse, es **callarlo por miedo a la bronca**. Un equipo donde se puede decir "me he colado, hay que rehacerlo" tiene muchísimas menos reclamaciones que uno donde se disimula.

> **Dato de operación** — Un producto agotado no marcado en el sistema sigue vendiéndose y genera una cadena de incidencias. Marcarlo es tan importante como avisar del pedido concreto.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: b c a d b a c b d c

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Un pedido lleva hamburguesa, patatas y un refresco de dos litros. ¿Cómo lo montas?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Todo junto en una bolsa grande, con el refresco encima para que no vuelque.', false, 'El peso del refresco aplasta la hamburguesa. Lo pesado va abajo.'),
   (v_q, 'Bebida aparte y de pie; patatas ventiladas separadas de la hamburguesa; lo pesado abajo.', true, 'Correcto. Una bolsa extra cuesta céntimos; un pedido devuelto cuesta muchísimo más.'),
   (v_q, 'Hamburguesa y patatas en el mismo recipiente cerrado para que no se enfríen.', false, 'La hamburguesa suelta vapor y ablanda las patatas: llegan blandas las dos.'),
   (v_q, 'Todo junto pero apretado para que no se mueva nada.', false, 'Apretar no evita el problema de peso ni el de condensación.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Es el pedido de siempre de un cliente habitual: dos smash y patatas. ¿Compruebas el ticket?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No hace falta, lo he montado cien veces.', false, 'Ese es exactamente el pedido en el que se cuela el error.'),
   (v_q, 'Solo si el cliente ha puesto alguna nota.', false, 'Las variantes no siempre vienen como nota: pueden ser modificadores.'),
   (v_q, 'Sí: se lee el ticket entero siempre, aunque sea conocido. Puede llevar una salsa o un cambio ese día.', true, 'Correcto. La trampa es precisamente el pedido conocido.'),
   (v_q, 'Sí, pero de memoria mientras cierro la bolsa.', false, 'De memoria es como se saltan los modificadores. Se lee.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Se ha agotado uno de los productos de un pedido ya en marcha. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Aviso al responsable antes de que salga el pedido, y marco el producto como agotado en el sistema.', true, 'Correcto. El cliente puede aceptar un cambio si se le pregunta; si se lo encuentra, reclama seguro.'),
   (v_q, 'Lo sustituyo por algo parecido, que total es similar.', false, 'Cambiar sin avisar genera reclamación casi siempre, y puede haber una alergia de por medio.'),
   (v_q, 'Mando el pedido sin ese producto y que reclame si quiere.', false, 'Reclamará, y con razón. Además se pierde la oportunidad de resolverlo bien.'),
   (v_q, 'Retraso el pedido hasta que haya producto.', false, 'Alargar el tiempo sin avisar empeora la situación en vez de resolverla.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, '¿Por qué se precinta la bolsa?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Para que no se abra por el movimiento de la moto.', false, 'Ayuda, pero no es la razón principal.'),
   (v_q, 'Por imagen de marca.', false, 'Aporta imagen, pero su función es otra.'),
   (v_q, 'Para que sea más fácil de transportar.', false, 'No influye en el transporte.'),
   (v_q, 'Para garantizar al cliente que nadie ha tocado su comida, y para poder defender el pedido si reclaman que faltaba algo.', true, 'Correcto. Una bolsa precintada que llega intacta cambia toda la conversación.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'El pedido está montado desde hace 20 minutos y el repartidor no ha llegado. Las patatas llevan ahí todo ese rato.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Se manda igual: ya está montado y precintado.', false, 'Llegarán blandas y frías. Ese cliente no repite.'),
   (v_q, 'Aviso al responsable: rehacer las patatas cuesta céntimos, un cliente perdido cuesta mucho más.', true, 'Correcto. Y conviene montar cuando el repartidor está por llegar, no antes.'),
   (v_q, 'Las recaliento en la freidora unos segundos.', false, 'Refritas quedan aceitosas; además se ha roto la cadena de temperatura.'),
   (v_q, 'Añado unas patatas nuevas encima de las viejas.', false, 'Mezclar producto nuevo con producto pasado no arregla nada.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'Un pedido lleva una alergia declarada y varios platos. ¿Cómo lo montas?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'El plato del alérgico va identificado y separado, de forma que se distinga sin abrir nada.', true, 'Correcto. Es la misma regla que en sala: aparte e identificado.'),
   (v_q, 'Todo junto: al final lo va a comer la misma mesa.', false, 'El contacto entre envases y el intercambio de platos es un riesgo real.'),
   (v_q, 'Añado una nota dentro de la bolsa explicándolo.', false, 'Una nota dentro no evita el contacto ni se ve al repartir en casa.'),
   (v_q, 'Aviso por teléfono al cliente y lo monto normal.', false, 'La llamada no sustituye a la separación física del plato.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'En hora punta tienes cuatro bolsas montadas y todas se parecen. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Las coloco en orden y me acuerdo de cuál es cada una.', false, 'En hora punta la memoria falla y las bolsas se intercambian.'),
   (v_q, 'Las etiqueto cuando venga el repartidor, para no perder tiempo ahora.', false, '"Luego lo pongo" es justo como se cruzan dos pedidos.'),
   (v_q, 'Etiqueto cada bolsa en el momento de cerrarla, con el ticket visible por fuera.', true, 'Correcto. Y al entregar, se confirma el código del pedido con el repartidor.'),
   (v_q, 'Las apilo por orden de llegada.', false, 'Apilar aplasta lo de abajo, y sigue sin identificarlas.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'Un pedido lleva ensalada y hamburguesa caliente. ¿Cómo viajan?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Juntas, pero con la ensalada arriba.', false, 'El calor sube: la ensalada de arriba se estropea igual.'),
   (v_q, 'En bolsas separadas o con separador: el calor marchita la ensalada.', true, 'Correcto. Y el aliño, siempre aparte.'),
   (v_q, 'Juntas, si el trayecto es corto no pasa nada.', false, 'No sabes cuánto tardará realmente; 20 minutos bastan.'),
   (v_q, 'Juntas, con la ensalada ya aliñada para ganar tiempo.', false, 'Aliñada 30 minutos antes llega marchita.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Te das cuenta de que has metido una salsa equivocada, pero la bolsa ya está precintada y el repartidor está aquí.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'La dejo: una salsa no es tan importante.', false, 'Para el cliente que la pidió, sí lo es. Y puede haber un motivo dietético detrás.'),
   (v_q, 'Dejo que salga y aviso luego si reclaman.', false, 'Sabiendo que está mal, dejar que salga garantiza la reclamación.'),
   (v_q, 'Se lo digo al repartidor para que se lo explique al cliente.', false, 'Trasladas tu error a alguien que no puede resolverlo.'),
   (v_q, 'Lo digo en el momento, abro y lo corrijo: un error avisado se arregla en dos minutos.', true, 'Correcto. Lo que más caro sale es callarlo por miedo a la bronca.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, '¿Cuándo conviene montar el pedido?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'En cuanto sale el primer plato, para ir adelantando.', false, 'Cada minuto en la estantería es temperatura y textura perdidas.'),
   (v_q, 'Nada más entrar el pedido en el sistema.', false, 'Aún más tiempo esperando: peor.'),
   (v_q, 'Cuando el repartidor está a punto de llegar, dejando lo crujiente y lo frío para el final.', true, 'Correcto. El tramo entre cocinado y recogida es el que más afecta a la calidad percibida.'),
   (v_q, 'Da igual, mientras esté precintado.', false, 'El precinto conserva la integridad, no la temperatura ni la textura.');

  raise notice 'Curso de embolsado sembrado (draft, delivery). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status, c.estimated_minutes,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='embolsado_delivery' and c.account_id is null;
-- Esperado: draft · 15 min · 6 secciones · 10 preguntas · 10 correctas.
