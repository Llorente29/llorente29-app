-- ============================================================================
-- Folvy · CURSO "Recepción: la última frontera antes de tu cocina"
-- Molde: docs/folvy_formacion_guia_contenido.md · Catálogo v2 Bloque B (cocina)
-- ----------------------------------------------------------------------------
-- Cuarto curso del bloque cocina. Lo que entra mal, ya está dentro: la recepción
-- es el único punto donde todavía se puede decir que no. Cubre las dos caras:
-- seguridad alimentaria (temperatura, estado, caducidad) y dinero (cantidad,
-- precio, formato).
--
-- TAXONOMÍA: category='cocina' · business_types={todos} · level='base'
--            requires_practical=true (recepcionar un albarán real con el responsable)
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — status 'draft'. Describe el flujo de recepción
--    de Folvy (celda "Recibido" vacía, pendientes de meter al stock): revisar que
--    coincida con la operación antes de publicar.
--
-- Correctas del test: b d c a b a d c b a (verificado)
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
    null, 'recepcion_pedidos',
    'Recepción: la última frontera antes de tu cocina',
    'Cómo se recibe un pedido: qué se comprueba, qué se rechaza y por qué firmar un albarán sin mirar puede costar dinero y seguridad.',
    'Reglamento (CE) 852/2004 · Reg. (CE) 178/2002 (trazabilidad)',
    'folvy_imparte', 24, false, true, 20, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis,
    reeval_months = excluded.reeval_months, estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'recepcion_pedidos' and account_id is null;
  end if;

  if exists (select 1 from information_schema.columns where table_name='course' and column_name='category') then
    execute format('update public.course set category=%L, level=%L, recommended_order=%s where id=%L',
                   'cocina', 'base', 230, v_course_id);
  end if;
  if exists (select 1 from information_schema.columns where table_name='course' and column_name='business_types') then
    execute format('update public.course set business_types=%L::text[] where id=%L', '{todos}', v_course_id);
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

  (v_course_id, 1, 'Lo que entra mal, ya está dentro',
$md$La recepción dura cinco minutos y decide cosas que arrastras toda la semana.

Es **el único momento en que todavía puedes decir que no**. Una vez que la mercancía entra en tu cámara y el repartidor se ha ido, el problema pasa a ser tuyo: el producto está pagado, ocupa sitio y alguien acabará usándolo.

Y se juegan dos cosas a la vez:

**La seguridad.** Un producto que llega a temperatura incorrecta, caducado o en mal estado no se arregla dentro. Entra con el problema puesto.

**El dinero.** Si pides 10 cajas y llegan 9, y firmas sin contar, **has pagado 10**. Si el precio del albarán no es el pactado y nadie lo mira, ese sobrecoste se repite en cada pedido durante meses.

**Y hay un tercer motivo, menos evidente:** todo lo que registras aquí es lo que después hace que los números cuadren. El consumo teórico, el inventario, el coste de los platos — todo parte de lo que entró. Si la entrada es falsa, lo demás también.

**En tu cocina esto pasa así:** el reparto casi siempre llega en el peor momento — en plena preparación, con prisa, y el repartidor tiene doce paradas más. La tentación de firmar sin mirar es enorme, y es exactamente lo que el proveedor con malas prácticas espera. **Cinco minutos aquí valen más que una hora de reclamaciones después.**

> **Marco legal** — Reg. (CE) 852/2004, Anexo II: obligación de no aceptar materias primas o ingredientes que estén contaminados o alterados de forma que resulten no aptos para el consumo. Reg. (CE) 178/2002, art. 18: trazabilidad — hay que poder identificar de quién viene cada producto.$md$),

  (v_course_id, 2, 'Antes de firmar: lo que se comprueba',
$md$Cuatro cosas, en este orden, porque van de más grave a menos:

**1. La temperatura.** Es lo primero y lo más importante, porque no se puede arreglar después.
- **Refrigerado**: debe llegar entre 0 y 4 °C. Si viene templado, **se rechaza**.
- **Congelado**: a −18 °C o menos, **sin señales de descongelación** (escarcha excesiva, bloques pegados, envase deformado, cristales de hielo en el interior). Eso indica que se descongeló y se volvió a congelar. Se rechaza.
- Si tienes termómetro, **mide**; no te fíes de la mano.

**2. El estado del producto y del envase.** Envases rotos, hinchados, oxidados, mojados o con manchas → fuera. Un envase dañado deja de proteger el alimento.

**3. Las fechas.** Que no venga caducado, obviamente. Pero también: **que le quede vida suficiente** para el uso que le vas a dar. Un producto que caduca pasado mañana es casi merma garantizada — se puede rechazar.

**4. Cantidad, formato y precio.** Cuenta lo que llega contra lo que pediste. Comprueba el formato (¿caja de 6 o de 12?) y que el precio del albarán sea el acordado.

**Y por último: la limpieza del transporte.** Si el vehículo o las cajas vienen sucios, si el género va mezclado con productos de limpieza o si el repartidor manipula sin cuidado, eso también es motivo de queja formal.

**En tu cocina esto pasa así:** lo que más se salta es la **temperatura**, porque exige parar y medir. Y es justo lo único que no tiene arreglo posterior. Si solo puedes comprobar una cosa, comprueba esa.

> **Datos técnicos** — Refrigerados 0-4 °C · congelados ≤ −18 °C · la presencia de escarcha, exudado o bloques pegados indica ruptura de la cadena de frío. Un producto que ha sido descongelado y recongelado no es apto y no se detecta después por su aspecto una vez cocinado.$md$),

  (v_course_id, 3, 'Rechazar no es un conflicto: es tu trabajo',
$md$Cuesta decir que no. El repartidor tiene prisa, tú también, y parece que montas un problema por una caja.

Pero rechazar es **exactamente lo que se espera de ti**. Y hacerlo bien es sencillo:

**Si algo no está bien:**
1. **No lo metas en cámara.** Una vez dentro, ya es tuyo.
2. **Anótalo en el albarán** antes de firmar: qué producto, cuánto y por qué. *"2 cajas de pollo rechazadas: llegan a 11 °C."*
3. **Que el repartidor lo vea y lo firme también**, si es posible.
4. **Haz una foto.** Es la prueba más rápida y la que zanja cualquier discusión posterior.
5. **Avisa al responsable.**

**Y aquí está la clave: nunca firmes "conforme" si no lo está.** Firmar el albarán es decir *"he recibido esto, en estas condiciones, y estoy de acuerdo"*. Si firmas y luego reclamas, tu posición es mucho más débil — has certificado por escrito que estaba bien.

**Si el proveedor insiste** en que lo aceptes "y ya se arregla luego": no es tu decisión. Avisa al responsable y que lo hable él.

**En tu cocina esto pasa así:** el momento incómodo dura treinta segundos. La caja de producto malo que aceptaste "por no discutir" dura toda la semana en tu cámara, y acaba usándose o tirándose. **Ninguna de las dos opciones es buena.**

> **Datos técnicos** — El albarán firmado es el documento que acredita la conformidad de la entrega. Las incidencias deben constar por escrito **en el momento**; una reclamación posterior sin anotación en el albarán tiene mucho menos recorrido frente al proveedor.$md$),

  (v_course_id, 4, 'Registrar bien lo que entra',
$md$Una vez aceptado, hay que **meterlo al sistema**. Y esto es lo que más se olvida, porque la mercancía ya está en la cámara y parece que el trabajo terminó.

**Lo que se registra:**
- **El producto**, casado con el artículo correcto del sistema. Si no lo encuentras, **no inventes uno nuevo**: pregunta. Dos artículos duplicados estropean el inventario y el coste.
- **La cantidad realmente recibida**, no la pedida. Si pediste 10 y llegan 9, se anota 9.
- **El formato** (caja, unidad, kilo) que corresponda.
- **El precio** del albarán, que es el que actualiza el coste.
- **El lote y la caducidad**, si el producto los lleva. Es lo que hace posible la trazabilidad.

**🔴 Y algo importante que conviene saber:** una recepción puede quedar **confirmada pero con líneas pendientes de meter al stock** — porque falta identificar el artículo o falta el formato. **Esas líneas no han entrado al inventario**, aunque el género esté físicamente en la cámara.

Si ves el aviso de *"falta meter al stock"*, **resuélvelo**. Mientras esté ahí, el sistema cree que tienes menos producto del que hay, y todos los cálculos que dependen de eso salen mal.

**En tu cocina esto pasa así:** la primera vez que entra un artículo nuevo es la que da trabajo — hay que montar su formato, su unidad, su precio. Y siempre pasa en pleno servicio. **Ese trabajo se hace mejor antes, con calma**: cuanto más poblado esté el catálogo, menos hay que pensar en la recepción.

> **Datos técnicos** — En Folvy, una línea de recepción sin artículo o sin formato no genera movimiento de stock. El módulo avisa con un indicador de "falta meter al stock" y permite resolver cada pendiente sin salir de la pantalla.$md$),

  (v_course_id, 5, 'Después de recibir: colocarlo bien',
$md$Recibir no acaba al firmar. El género tiene que **entrar en frío cuanto antes**.

**Prioridad de colocación:**
1. **Congelado**, lo primero. Cada minuto fuera cuenta.
2. **Refrigerado**, inmediatamente después.
3. **Seco y no perecedero**, al final.

Una caja de pescado esperando media hora en el pase mientras se coloca el resto es una cadena de frío rota **después** de haberla comprobado en la puerta. Todo el trabajo de la recepción, tirado.

**Al colocar:**
- **Rotación FIFO/FEFO**: lo nuevo **detrás**, lo antiguo delante. Es el momento exacto en que se decide si algo va a caducar sin usarse.
- **Nada en el suelo.**
- **Crudo abajo, listo para consumo arriba** (lo del curso de manipulador).
- **Quita el cartón** de fuera cuando puedas: llega de almacenes y camiones, y es de lo más sucio que entra en una cocina.
- **Revisa lo que ya había**: la recepción es un buen momento para ver caducidades próximas del producto viejo.

**En tu cocina esto pasa así:** el fallo típico no es aceptar producto malo, es **dejarlo bien recibido y mal colocado**. Se comprueba la temperatura con rigor en la puerta y luego la caja pasa cuarenta minutos junto a la plancha porque nadie tuvo tiempo. El resultado es el mismo que si no se hubiera comprobado nada.

> **Datos técnicos** — Reg. (CE) 852/2004: obligación de mantener la cadena de frío sin interrupciones. El tiempo en zona de peligro es acumulativo: los minutos de la recepción suman a los del resto del proceso.$md$),

  (v_course_id, 6, 'Qué se espera de ti',
$md$Seis cosas, y caben en cinco minutos bien empleados:

**1. Comprueba la temperatura.** Es lo único sin arreglo posterior.

**2. Cuenta lo que llega.** Contra el pedido, no de memoria.

**3. Rechaza lo que no esté bien**, anotándolo en el albarán antes de firmar. Con foto si puedes.

**4. Nunca firmes "conforme" si no lo está.**

**5. Regístralo en el sistema** con cantidad real, formato, precio y lote. Y **resuelve los pendientes de meter al stock**.

**6. Colócalo rápido y bien.** Frío primero, rotación después.

**Y si algo se repite** —un proveedor que siempre trae de menos, un producto que llega siempre justo de caducidad, un transporte que viene sucio— **dilo**. Tú lo ves cada semana; nadie más tiene ese dato. Un patrón detectado a tiempo se corrige hablando con el proveedor; ignorado, se paga cada mes.

**La idea que resume el curso:**

> En la puerta todavía puedes decir que no. Dentro, ya es tuyo.

**Antes de terminar**: en la próxima recepción, comprueba la temperatura de un producto refrigerado. Si no sabes dónde está el termómetro, ahí tienes el primer problema.

> **Datos técnicos** — La recepción es el primer punto de control del sistema APPCC y el único donde puede rechazarse el peligro antes de que entre. Sus registros forman parte de la documentación exigible en inspección.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: b d c a b a d c b a

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Llega el pedido en plena preparación. El repartidor tiene prisa y te pide que firmes rápido.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Firmo y reviso el pedido cuando pueda.', false, 'Al firmar certificas que está todo bien: si luego reclamas, tu posición es débil.'),
   (v_q, 'Compruebo al menos temperatura y cantidad antes de firmar, aunque tarde unos minutos.', true, 'Correcto. Cinco minutos aquí valen más que una hora de reclamaciones después.'),
   (v_q, 'Firmo y le digo que si hay algo mal, ya llamaré.', false, 'La reclamación sin anotación en el albarán tiene mucho menos recorrido.'),
   (v_q, 'Le digo que vuelva más tarde.', false, 'El producto se queda sin entrar y el problema no se resuelve.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Un producto refrigerado llega a 11 °C. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo meto rápido en cámara: en una hora estará a 4 °C.', false, 'Enfriar después no deshace las horas que ya pasó en zona de peligro.'),
   (v_q, 'Lo acepto y lo uso hoy mismo para que no dé tiempo a que empeore.', false, 'El riesgo ya existe desde antes de llegar a tu puerta.'),
   (v_q, 'Lo acepto y lo congelo inmediatamente.', false, 'Congelar detiene la multiplicación, pero no elimina lo que ya hay.'),
   (v_q, 'Lo rechazo, lo anoto en el albarán antes de firmar y aviso al responsable.', true, 'Correcto. La temperatura es lo único que no tiene arreglo posterior.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Pediste 10 cajas y llegan 9. El albarán pone 10.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Firmo el albarán y aviso luego para que lo descuenten.', false, 'Has firmado que recibiste 10: reclamar después es mucho más difícil.'),
   (v_q, 'Acepto: seguro que la que falta llega en el próximo reparto.', false, 'Habrás pagado una caja que nunca llegó.'),
   (v_q, 'Corrijo el albarán a 9 antes de firmar, que el repartidor lo vea, y registro 9 en el sistema.', true, 'Correcto. Se anota lo realmente recibido, no lo pedido.'),
   (v_q, 'Registro 10 en el sistema y ajusto luego en el inventario.', false, 'Ensucias el stock y el descuadre aparecerá sin explicación.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'Llega producto congelado con mucha escarcha y los bloques pegados entre sí.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Se rechaza: indica que se descongeló y se volvió a congelar.', true, 'Correcto. Y una vez cocinado no se detecta por el aspecto.'),
   (v_q, 'Se acepta: la escarcha es normal en congelados.', false, 'Un poco es normal; escarcha excesiva y bloques pegados son señal de recongelación.'),
   (v_q, 'Se acepta y se usa cuanto antes.', false, 'El riesgo microbiológico ya está ahí; usarlo antes no lo reduce.'),
   (v_q, 'Se separa y se decide al día siguiente.', false, 'Para entonces ya está aceptado y dentro.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'Recibes un producto que no encuentras en el sistema al registrarlo.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Creo un artículo nuevo con el nombre que ponga el albarán.', false, 'Riesgo de duplicar un artículo que ya existe con otro nombre, y eso estropea inventario y coste.'),
   (v_q, 'Pregunto antes de crear nada: puede existir con otro nombre y duplicarlo estropea el inventario.', true, 'Correcto. El alta de artículo se hace con criterio, mejor fuera del servicio.'),
   (v_q, 'Lo dejo sin registrar y lo comento mañana.', false, 'El género entra físicamente pero no al sistema: descuadre garantizado.'),
   (v_q, 'Lo registro en el artículo más parecido que encuentre.', false, 'Falsea el consumo de dos artículos a la vez.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'Ves el aviso "falta meter al stock" en una recepción ya confirmada. ¿Qué significa?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Que hay líneas sin artículo o sin formato que NO han entrado al inventario, aunque el género esté en la cámara.', true, 'Correcto. Mientras esté así, el sistema cree que hay menos producto del que hay.'),
   (v_q, 'Que el pedido no ha llegado todavía.', false, 'La recepción está confirmada: el género está.'),
   (v_q, 'Que falta pagar la factura.', false, 'No tiene relación con el pago.'),
   (v_q, 'Que hay que hacer un inventario.', false, 'Se resuelve completando la línea, no contando.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'Ya has recibido y firmado. ¿Qué haces primero al colocar?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo seco y las conservas, que son las cajas más pesadas.', false, 'Lo no perecedero puede esperar; lo frío no.'),
   (v_q, 'Lo que quepa mejor, para despejar el paso.', false, 'El criterio no es el espacio: es la temperatura.'),
   (v_q, 'Todo a la vez, deprisa.', false, 'Deprisa y sin orden es como se queda el pescado fuera media hora.'),
   (v_q, 'Congelado primero, refrigerado después, seco al final.', true, 'Correcto. Si no, rompes la cadena de frío justo después de haberla comprobado.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'Al colocar el género nuevo en la estantería, ¿dónde va?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Delante, que es lo más accesible.', false, 'Entonces lo antiguo se queda al fondo y caduca.'),
   (v_q, 'Donde haya sitio.', false, 'Sin criterio de rotación, la merma está garantizada.'),
   (v_q, 'Detrás de lo que ya había, para gastar antes lo antiguo (FIFO/FEFO).', true, 'Correcto. La colocación es el momento en que se decide si algo caducará sin usarse.'),
   (v_q, 'Separado del resto, en su propia balda.', false, 'Duplica ubicaciones y complica el conteo.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Un proveedor trae siempre el producto justo de caducidad. Ha pasado cuatro veces este mes.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Es normal, hay que gastarlo antes y ya está.', false, 'Cuatro veces en un mes no es casualidad: es un patrón.'),
   (v_q, 'Lo comunico: es un patrón que se corrige hablando con el proveedor, y si no, se paga cada mes.', true, 'Correcto. Tú lo ves cada semana; nadie más tiene ese dato.'),
   (v_q, 'Lo rechazo siempre sin avisar a nadie.', false, 'Rechazar sin comunicar deja al local sin producto y sin solución de fondo.'),
   (v_q, 'Cambio de proveedor por mi cuenta.', false, 'Esa decisión no es individual.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, '¿Por qué se anota el lote y la caducidad al recibir?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Por trazabilidad: ante una alerta sanitaria permite identificar y retirar exactamente el producto afectado.', true, 'Correcto. Sin lote habría que retirar todo el producto de ese tipo.'),
   (v_q, 'Para reclamar al proveedor si el precio no cuadra.', false, 'El precio se comprueba en el albarán; el lote es de trazabilidad.'),
   (v_q, 'Para saber cuánto queda en el almacén.', false, 'Eso lo dice el stock, no el lote.'),
   (v_q, 'Solo hace falta en productos frescos.', false, 'La trazabilidad aplica a todo lo que entra.');

  raise notice 'Curso de recepción sembrado (draft, cocina). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status, c.category,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='recepcion_pedidos' and c.account_id is null;
-- Esperado: draft · cocina · 6 secciones · 10 preguntas · 10 correctas.
