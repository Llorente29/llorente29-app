-- ============================================================================
-- Folvy · CURSO "Temperatura y transporte en ruta"
-- Molde: docs/folvy_formacion_guia_contenido.md · Catálogo v2 Bloque C
-- ----------------------------------------------------------------------------
-- Segundo curso de delivery. Cubre el tramo que la mayoría de locales NO vigila:
-- desde que la bolsa sale del pase hasta que el cliente abre la puerta.
--
-- MARCO: Reg. (CE) 852/2004, Anexo II Cap. IV (transporte de alimentos) —
-- los receptáculos y vehículos deben mantener los alimentos a temperatura
-- adecuada y permitir su control. Aplica también al reparto de última milla.
--
-- TAXONOMÍA: category='delivery' · business_types={dark_kitchen,delivery,restaurante}
--            level='base' · requires_practical=true (montaje real de la mochila)
--   (Los campos se escriben solo si existen — los crea el encargo C4.)
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — status 'draft'. Ajustar a la operación real
--    (Catcher, reparto propio, riders de plataforma) antes de publicar.
--
-- Correctas del test: c b d a c a b d b c (verificado)
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
    null, 'temperatura_ruta_delivery',
    'Temperatura y transporte en ruta',
    'Cómo se mantiene la comida caliente, fría y segura desde que sale el pedido hasta que el cliente abre la puerta. El tramo que casi nadie vigila.',
    'Reglamento (CE) 852/2004, Anexo II Cap. IV (transporte)',
    'folvy_imparte', 12, false, true, 15, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis, reeval_months = excluded.reeval_months,
    estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'temperatura_ruta_delivery' and account_id is null;
  end if;

  if exists (select 1 from information_schema.columns where table_name='course' and column_name='category') then
    execute format('update public.course set category=%L, level=%L, recommended_order=%s where id=%L',
                   'delivery', 'base', 110, v_course_id);
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

  (v_course_id, 1, 'El tramo que nadie mira',
$md$En una cocina se controla todo: temperatura de cámara, de cocinado, de mantenimiento. Y luego el pedido sale por la puerta y **durante treinta minutos no lo controla nadie**.

Ese tramo también es tuyo. La ley lo dice sin rodeos: los recipientes y vehículos de transporte deben mantener los alimentos a la temperatura adecuada. La normativa no distingue entre un camión frigorífico y una mochila de moto.

Y hay dos cosas distintas en juego, conviene no confundirlas:

- **La calidad**: que la hamburguesa llegue caliente y las patatas crujientes. Si falla, pierdes al cliente.
- **La seguridad**: que la comida no pase por la zona de peligro (5-65 °C) el tiempo suficiente para que crezcan bacterias. Si falla, alguien puede enfermar.

Lo primero cuesta una reseña. Lo segundo puede costar el negocio.

**En tu turno esto pasa así:** casi todo el mundo piensa en la temperatura como "que no se enfríe". Pero el riesgo real es al revés: **un guiso que sale a 70 °C y va perdiendo calor despacio entra en la zona de peligro por arriba**, y si el reparto se alarga, llega en la franja donde las bacterias se multiplican. Sale caliente, llega templado: eso es lo peligroso.

> **Marco legal** — Reglamento (CE) 852/2004, Anexo II, Cap. IV: los receptáculos de vehículos o contenedores utilizados para transportar productos alimenticios deben mantenerse limpios y en buen estado, y permitir mantener los alimentos a la temperatura adecuada, con posibilidad de controlarla.$md$),

  (v_course_id, 2, 'La mochila es un termo, no un bolso',
$md$Una mochila isotérmica **no genera frío ni calor**. Solo conserva lo que le metes. Eso tiene tres consecuencias prácticas que se olvidan constantemente:

**1. Si metes algo templado, sigue templado.** La mochila no lo va a calentar. Por eso el producto debe salir **a su temperatura correcta**: lo caliente por encima de 65 °C, lo frío por debajo de 5 °C.

**2. Si la dejas abierta, pierde todo.** Cada vez que se abre entra aire ambiente. En una ruta con varios pedidos, abrir y cerrar constantemente es lo que arruina la temperatura del último.

**3. Si mezclas caliente y frío dentro, se estropean los dos.** El helado enfría la hamburguesa y la hamburguesa derrite el helado. **Cuando el pedido lleva ambos, van en compartimentos separados** — y si la mochila no los tiene, en bolsas térmicas distintas.

**Cómo se coloca bien:**
- **Lo caliente abajo**, que el calor sube y se queda dentro.
- **Lo frío arriba**, o en su compartimento.
- **Todo de pie** y encajado, sin huecos donde bailen las cosas.
- **Cerrada siempre**, aunque solo sean dos minutos.

**En tu turno esto pasa así:** el fallo más común es la mochila abierta esperando en la puerta del local mientras el rider mira el móvil. Dos minutos de mochila abierta en enero pierden más temperatura que veinte minutos de ruta con ella cerrada.

> **Datos técnicos** — Los contenedores isotérmicos reducen la velocidad de transferencia térmica, pero no aportan energía. La temperatura de salida del producto y el número de aperturas son los dos factores que más determinan la temperatura de llegada.$md$),

  (v_course_id, 3, 'El reloj corre desde que sale',
$md$El tiempo es la variable que más pesa, y la que más se subestima.

**La regla práctica**: cuanto más tarde el pedido, más se acerca a la zona de peligro. No hay una cifra mágica que valga para todo, pero sí un principio: **si un pedido lleva más de una hora desde que se cocinó hasta que se entrega, hay que preguntarse si debe salir.**

**Lo que alarga el tiempo sin que nadie lo note:**
- Pedido montado antes de tiempo, esperando en la estantería.
- Rider que acumula **varios pedidos** en la misma ruta: el último puede llevar 40 minutos dentro.
- Direcciones mal puestas, portales sin número, clientes que no contestan.
- Tráfico y hora punta.

**Lo que sí puedes controlar tú desde el local:**
- **No montar antes de tiempo** (lo vimos en el curso de embolsado).
- **Avisar si un pedido lleva demasiado esperando**: mejor rehacer que mandar algo que llegará mal.
- **Comprobar la dirección** antes de que salga si tiene pinta rara.

**Y una cosa importante sobre los pedidos agrupados:** si un rider lleva tres pedidos, el orden de entrega importa. Lo que peor aguanta (fritos, helados) debería salir primero. Si tienes voz en eso, úsala.

**En tu turno esto pasa así:** el pedido que llega mal casi nunca es el que tuvo un problema gordo. Es el que sumó cinco minutos de espera en el pase, diez de ruta compartida y siete buscando el portal. Nadie hizo nada mal del todo, y el cliente recibe la comida fría.

> **Datos técnicos** — El tiempo total en zona de peligro es acumulativo a lo largo de todo el proceso: enfriamiento, espera, transporte y entrega suman. No se "reinicia" en cada etapa.$md$),

  (v_course_id, 4, 'Higiene: la mochila también se lava',
$md$Esta es la parte que más se olvida, porque la mochila no parece "cocina". Pero dentro va comida.

**La mochila se limpia. Por dentro y con frecuencia.** Restos de salsa derramada, líquido de una bebida volcada, migas de la semana pasada. Una mochila sucia es un foco de bacterias que toca directamente los envases que el cliente va a abrir en su casa.

- **Limpieza y desinfección** del interior de forma regular, y **siempre** después de un derrame.
- **Secado completo** antes de volver a usarla: la humedad encerrada es un cultivo perfecto.
- Si tiene bolsas o separadores interiores, se lavan también.

**Y la higiene del rider cuenta igual que la de cocina.** Manos limpias, y ojo con lo que se toca por el camino: el móvil, el casco, la moto, el dinero, los timbres. Después de todo eso se manipulan bolsas de comida.

**Nunca se transporta comida junto a:**
- Productos de limpieza o químicos.
- Objetos personales sucios, ropa, casco.
- Otro pedido ya entregado o devuelto.

**En tu turno esto pasa así:** una bebida que se vuelca en la mochila y se limpia "por encima" con una servilleta. El azúcar queda ahí, atrae, huele y contamina el resto de la semana. Un derrame se limpia **a fondo y en el momento**, aunque haya prisa.

> **Datos técnicos** — Reg. (CE) 852/2004, Anexo II, Cap. IV: los receptáculos utilizados para el transporte deben mantenerse limpios y en buen estado para proteger los alimentos de la contaminación, y deben poder limpiarse y desinfectarse eficazmente.$md$),

  (v_course_id, 5, 'La entrega: el último metro',
$md$Todo el trabajo puede arruinarse en los últimos treinta segundos.

**Al entregar:**
- **Comprueba que es el pedido correcto.** Código, nombre o número. Entregar la bolsa equivocada estropea dos pedidos a la vez y obliga a rehacer los dos.
- **Entrega en mano cuando se pueda**, y si el cliente pide dejarlo en la puerta, **en un sitio limpio, seco y a la sombra** — nunca en el suelo de un rellano sucio ni al sol en agosto.
- **No abras la bolsa.** El precinto es la garantía del cliente. Si hay una duda, se resuelve por teléfono, no abriendo.
- **Si el cliente no está**, sigue el protocolo del local o de la plataforma: llamar, esperar el tiempo indicado, y avisar. **No dejes comida sin más en cualquier sitio.**

**Y una regla de sentido común pero importante:** un pedido que ha estado dando vueltas porque el cliente no aparecía **no se reutiliza para otro cliente**. Ha estado fuera de control de temperatura y ya no es seguro.

**En tu turno esto pasa así:** la tentación con un pedido rechazado o no entregado es "aprovecharlo" para el personal o dejarlo en la nevera. Si ha estado más de una hora en ruta, **no está en condiciones**. Se registra y se desecha. Duele, y es lo correcto.

> **Datos técnicos** — Un alimento que ha salido del control de la empresa y ha estado en condiciones desconocidas de temperatura no puede reintroducirse en la cadena. Reg. (CE) 178/2002: no se comercializa un alimento cuando hay dudas razonables sobre su seguridad.$md$),

  (v_course_id, 6, 'Cuando algo va mal en ruta',
$md$**El pedido se ha volcado dentro de la mochila.** Avisa al local de inmediato. No lo entregues "como está a ver si cuela": la reclamación es segura y además queda peor. Se rehace.

**El pedido lleva mucho más tiempo del previsto.** Avisa antes de entregarlo. Puede que la decisión sea entregarlo igual, pero **esa decisión no es tuya en solitario**: el responsable tiene que saberlo.

**El cliente dice que llegó frío.** No discutas en la puerta. Recoge la queja, avisa al local, y que se gestione desde allí. Y si es un patrón que se repite con ciertos platos o ciertas zonas, **dilo**: eso es información valiosa para arreglar el proceso.

**Se ha estropeado la mochila** (cremallera rota, aislamiento roto, no cierra). **Comunícalo.** Una mochila que no cierra no conserva nada, y seguir usándola es garantizar pedidos malos.

**Y la parte que más cuesta:** si tú sabes que un pedido va a llegar mal, **dilo antes de entregarlo**, no después. Un aviso a tiempo permite avisar al cliente, rehacerlo o compensarlo. Un pedido que llega mal por sorpresa es una reseña de una estrella.

**En tu turno esto pasa así:** el reparto es un trabajo solitario y hay tentación de resolverlo todo por cuenta propia para no molestar. Es justo al revés: **la información de ruta es lo que permite arreglar el proceso**. Si nadie dice que los pedidos a cierta zona llegan siempre fríos, nadie lo va a arreglar.

> **Dato de operación** — En Folvy, las incidencias de reparto quedan registradas junto al pedido (estado de entrega, tiempos, rider). Comunicarlas no es "quejarse": es lo que permite detectar patrones y corregirlos.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: c b d a c a b d b c

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Un pedido lleva una hamburguesa caliente y un helado. ¿Cómo van en la mochila?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Juntos: la mochila mantiene cada cosa a su temperatura.', false, 'La mochila conserva, no genera frío ni calor. Dentro se igualan entre sí.'),
   (v_q, 'Juntos pero con el helado envuelto en papel.', false, 'El papel no aísla lo suficiente frente a un producto caliente al lado.'),
   (v_q, 'En compartimentos separados, o en bolsas térmicas distintas.', true, 'Correcto. Juntos, el helado enfría la hamburguesa y la hamburguesa derrite el helado.'),
   (v_q, 'Juntos, entregando primero el helado.', false, 'Durante el trayecto ya se habrán estropeado los dos.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Esperas al pedido en la puerta del local con la mochila abierta, mirando el móvil. ¿Importa?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No, si son solo un par de minutos.', false, 'Dos minutos abierta en invierno pierden más que veinte de ruta cerrada.'),
   (v_q, 'Sí: cada apertura mete aire ambiente y es de lo que más temperatura hace perder.', true, 'Correcto. La mochila solo conserva mientras está cerrada.'),
   (v_q, 'No, mientras no llueva.', false, 'El problema es el intercambio de aire, no el agua.'),
   (v_q, 'Solo importa si ya hay pedidos dentro.', false, 'También enfría el interior de cara al siguiente pedido.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, '¿Qué es lo más peligroso desde el punto de vista de seguridad alimentaria?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Que la comida llegue demasiado caliente y queme al cliente.', false, 'Es un problema, pero no de seguridad microbiológica.'),
   (v_q, 'Que las patatas lleguen blandas.', false, 'Eso es calidad, no seguridad.'),
   (v_q, 'Que la bolsa se arrugue.', false, 'Afecta a la presentación, no a la seguridad.'),
   (v_q, 'Que un producto caliente vaya perdiendo calor despacio y llegue templado, dentro de la zona de peligro.', true, 'Correcto. Sale caliente, llega templado: ahí es donde crecen las bacterias.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'Se vuelca una bebida dentro de la mochila en plena ruta. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Limpio a fondo y desinfecto en cuanto pueda, y aviso; el pedido afectado se rehace.', true, 'Correcto. Un derrame limpiado "por encima" contamina el resto de la semana.'),
   (v_q, 'Lo seco con una servilleta y sigo la ruta.', false, 'El azúcar y los restos quedan dentro: foco de bacterias y olor.'),
   (v_q, 'Entrego igual y no digo nada: el envase estaba cerrado.', false, 'El envase mojado llega al cliente, y la mochila queda sucia.'),
   (v_q, 'Lo limpio al final del turno.', false, 'Durante horas la mochila sigue transportando comida sobre el derrame.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'Un cliente no aparece. Tras el protocolo de espera, el pedido vuelve al local con una hora de ruta.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Se guarda en la cámara por si el cliente lo reclama.', false, 'Ha estado fuera de control de temperatura: no se reintroduce.'),
   (v_q, 'Se aprovecha para la comida del personal.', false, 'La seguridad alimentaria es la misma para el equipo que para el cliente.'),
   (v_q, 'Se registra la incidencia y se desecha: ha estado fuera de control de temperatura.', true, 'Correcto. Duele, cuesta dinero, y es lo correcto.'),
   (v_q, 'Se recalienta y se usa para otro pedido.', false, 'Recalentar no elimina las toxinas ni justifica reutilizar el pedido.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'La mochila cierra mal desde hace unos días, pero se puede usar. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo comunico: una mochila que no cierra no conserva nada.', true, 'Correcto. Seguir usándola es garantizar pedidos malos cada día.'),
   (v_q, 'La uso igual y meto los pedidos más apretados.', false, 'Apretar no compensa la pérdida de aislamiento.'),
   (v_q, 'La uso solo para trayectos cortos.', false, 'Todos los trayectos se alargan cuando menos lo esperas.'),
   (v_q, 'Le pongo cinta adhesiva y sigo.', false, 'Un apaño no restituye el aislamiento y además dificulta la limpieza.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'El cliente pide que le dejes el pedido en la puerta. ¿Dónde lo dejas?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'En el suelo del rellano, que es lo normal.', false, 'El suelo es la superficie más sucia del portal.'),
   (v_q, 'En un sitio limpio, seco y a la sombra, y aviso al cliente de que ya está.', true, 'Correcto. Y siempre avisando, para que no se quede fuera media hora.'),
   (v_q, 'Donde sea, si ya lo ha pedido él.', false, 'Que lo pida no exime de dejarlo en condiciones.'),
   (v_q, 'Colgado del pomo aunque quede al sol.', false, 'En verano, al sol, la temperatura sube muy rápido.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'Llevas tres pedidos en la misma ruta. ¿Qué criterio sigues para el orden de entrega?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'El que más propina suela dar, primero.', false, 'No es un criterio de calidad ni de seguridad.'),
   (v_q, 'El más lejano primero, para quitármelo de encima.', false, 'Deja al resto más tiempo dentro sin necesidad.'),
   (v_q, 'Da igual: dentro de la mochila aguantan todos igual.', false, 'No aguantan igual: los fritos y los helados se degradan mucho antes.'),
   (v_q, 'Lo que peor aguanta (fritos, helados) primero, y avisar si el reparto se alarga demasiado.', true, 'Correcto. Y si tienes voz en el orden de ruta, úsala.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Sabes que el pedido va a llegar frío porque la ruta se ha complicado. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo entrego y espero que el cliente no diga nada.', false, 'Un pedido malo por sorpresa es una reseña de una estrella casi segura.'),
   (v_q, 'Aviso al local antes de entregarlo, para que decidan avisar, rehacer o compensar.', true, 'Correcto. Un aviso a tiempo permite arreglarlo; después ya no.'),
   (v_q, 'Se lo explico al cliente en la puerta y que él decida.', false, 'Le trasladas un problema sin poder ofrecerle solución.'),
   (v_q, 'Lo devuelvo al local sin entregarlo.', false, 'La decisión no es unilateral: hay que consultarla.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, '¿Por qué la mochila se lava por dentro con regularidad?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Por imagen ante el cliente.', false, 'El cliente casi nunca ve el interior; la razón es otra.'),
   (v_q, 'Para que no huela mal en la moto.', false, 'El olor es la consecuencia, no el motivo.'),
   (v_q, 'Porque dentro va comida y la ley exige que los receptáculos de transporte estén limpios y desinfectables.', true, 'Correcto. Una mochila sucia contamina los envases que el cliente abrirá en su casa.'),
   (v_q, 'Solo hace falta si se ha transportado pescado.', false, 'Aplica a cualquier alimento transportado.');

  raise notice 'Curso de temperatura en ruta sembrado (draft, delivery). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='temperatura_ruta_delivery' and c.account_id is null;
-- Esperado: draft · 6 secciones · 10 preguntas · 10 correctas.
