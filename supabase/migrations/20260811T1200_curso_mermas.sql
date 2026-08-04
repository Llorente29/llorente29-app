-- ============================================================================
-- Folvy · CURSO "Mermas: lo que se tira también se ha pagado"
-- Molde: docs/folvy_formacion_guia_contenido.md · Catálogo v2 Bloque B (cocina)
-- ----------------------------------------------------------------------------
-- Segundo curso del bloque cocina. Pareja natural del curso del escandallo:
-- aquel enseña a NO poner de más; este enseña a NO tirar de más y, sobre todo,
-- a REGISTRAR lo que se tira — que es lo que hace que el AvT signifique algo.
--
-- TAXONOMÍA: category='cocina' · business_types={todos} · level='base'
--            requires_practical=true (registrar una merma real en el sistema)
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — status 'draft'.
--
-- Correctas del test: b d a c b a d b c a (verificado)
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
    null, 'mermas_aprovechamiento',
    'Mermas: lo que se tira también se ha pagado',
    'Qué es la merma, cuál es inevitable y cuál no, cómo se aprovecha lo que hoy va a la basura, y por qué registrarla es lo que hace que los números signifiquen algo.',
    'Buenas prácticas de gestión · Ley 1/2025 de prevención del desperdicio alimentario',
    'folvy_imparte', 24, false, false, 20, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis,
    reeval_months = excluded.reeval_months, estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'mermas_aprovechamiento' and account_id is null;
  end if;

  if exists (select 1 from information_schema.columns where table_name='course' and column_name='category') then
    execute format('update public.course set category=%L, level=%L, recommended_order=%s where id=%L',
                   'cocina', 'base', 210, v_course_id);
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

  (v_course_id, 1, 'La basura de una cocina cuesta dinero de verdad',
$md$Todo lo que acaba en el cubo se ha comprado, se ha transportado, se ha guardado en frío y muchas veces se ha manipulado. **Ya está pagado.** Cuando se tira, no se tira comida: se tira dinero que el negocio ya desembolsó.

Y en hostelería no es poca cosa. Entre lo que se estropea, lo que se pasa de punto, lo que sobra de una preparación y lo que el cliente deja en el plato, un local puede estar tirando entre un **4% y un 10% de todo lo que compra**.

Puesto en euros: si compras 20.000 € de género al mes y tiras un 6%, **son 1.200 € al mes a la basura**. Más de 14.000 € al año.

**Pero cuidado, y esto es lo primero que hay que entender: no toda la merma es un fallo.**

- **Merma inevitable**: la piel de la cebolla, la espina del pescado, la grasa que se recorta. Está en la naturaleza del producto y **ya se cuenta en el escandallo** (por eso el coste se calcula sobre la cantidad bruta).
- **Merma evitable**: lo que caduca sin usarse, lo que se quema, lo que se cae, lo que se prepara de más y nadie se come.

**El objetivo de este curso no es que no se tire nada** — eso es imposible. Es reducir la evitable y, sobre todo, **saber cuánta hay**.

**En tu cocina esto pasa así:** la merma no se nota porque nunca sale de golpe. Son doscientos gramos aquí, media bandeja allá, un producto olvidado al fondo de la cámara. Nadie ve nunca "1.200 € tirados": se ven cubos.

> **Dato de gestión** — La merma inevitable ya está contemplada en el escandallo a través de la diferencia entre cantidad bruta y neta. La evitable NO está en ningún cálculo: aparece como diferencia entre el consumo teórico y el real, sin explicación.$md$),

  (v_course_id, 2, 'De dónde sale la merma evitable',
$md$Casi siempre de los mismos sitios. Reconocerlos es medio trabajo hecho:

**1. Caducidad y rotación.** El producto que se queda al fondo y aparece pasado. Se corrige con **FIFO/FEFO** —lo primero que entra o lo primero que caduca, sale primero— y colocando lo nuevo detrás, no delante.

**2. Preparar de más.** Se hace mise en place para un sábado y es un martes. Lo que sobra de producto preparado aguanta mucho menos que el producto en crudo.

**3. Conservación mal hecha.** Producto sin tapar, sin etiquetar o a temperatura incorrecta. Se estropea antes de tiempo.

**4. Errores de elaboración.** Se quema, se pasa de punto, se sala de más. Cuesta el doble: el producto perdido más el que hay que usar para rehacerlo.

**5. Cortes mal hechos.** Del mismo lomo, un despiece cuidadoso saca más raciones que uno con prisa. Aquí la diferencia entre un cocinero y otro se ve en euros.

**6. El plato que vuelve.** Si el cliente deja la mitad de la guarnición todos los días, no es que no le guste: **es que la ración es demasiado grande**. Eso es merma, y además es dinero que podrías no estar gastando.

**En tu cocina esto pasa así:** la causa número uno no es el descuido, es **preparar pensando en el mejor día de la semana**. Un martes con producción de sábado garantiza que algo se tire. Por eso la previsión de demanda importa tanto: producir para lo que va a venir, no para lo que podría venir.

> **Dato de gestión** — Folvy calcula la previsión de demanda por día de la semana con el histórico real del local. Producir contra esa previsión, en vez de "lo de siempre", es la palanca que más reduce la merma por sobreproducción.$md$),

  (v_course_id, 3, 'Aprovechar sin poner en riesgo a nadie',
$md$Mucha de la merma evitable no hay que tirarla: hay que **usarla bien**. Pero con una regla que no se negocia: **el aprovechamiento nunca puede comprometer la seguridad alimentaria.**

**Lo que sí se aprovecha:**
- **Recortes y desperdicios de corte** → fondos, caldos, rellenos, picadas. Un fondo hecho con huesos y recortes tiene coste casi cero y sube la calidad del plato.
- **Verdura de segunda categoría** (fea pero sana) → cremas, salsas, guarniciones trituradas.
- **Pan del día anterior** → picatostes, pan rallado, torrijas.
- **Producto cerca de caducar** → adelantarlo en la carta, sugerencia del día, comida del personal si está en condiciones.

**Lo que NO se aprovecha nunca:**
- Producto que ha estado **fuera de temperatura** el tiempo suficiente.
- Lo que ha salido a sala y **ha vuelto**. Aunque no lo hayan tocado.
- Lo que ya está **caducado** (fecha de caducidad, no de consumo preferente).
- Cualquier cosa con **olor, color o textura raros**. Ante la duda, se tira.

**Y una idea que ahorra mucho dinero: la merma se planifica.** Si sabes que el jueves te sobrará caldo, el viernes hay una sugerencia que lo usa. Eso no es improvisar con las sobras: es diseñar la carta sabiendo lo que produce tu propia cocina.

**En tu cocina esto pasa así:** el aprovechamiento se convierte en un problema cuando se hace **sin etiquetar y sin fecha**. Un fondo aprovechado es un acierto; un táper sin identificar al fondo de la cámara es merma futura y un riesgo sanitario.

> **Dato de gestión** — La Ley 1/2025 de prevención de las pérdidas y el desperdicio alimentario obliga a los establecimientos a disponer de un plan de prevención y a priorizar la donación de excedentes aptos antes que su destrucción. Aprovechar bien ya no es solo economía: es una obligación creciente.$md$),

  (v_course_id, 4, 'Registrar: lo que convierte el dato en información',
$md$Esta es la parte que menos gusta y la que más vale.

**Una merma no registrada no desaparece: se convierte en un descuadre sin explicación.** El sistema ve que faltan 3 kg de carne y no sabe si es porque se puso de más en los platos, porque se tiró una bandeja o porque alguien contó mal el inventario. Y **cada una de esas tres cosas se arregla de forma completamente distinta.**

**Qué se registra:**
- **Qué producto** y **cuánto** (en peso o unidades, no "un poco").
- **Por qué**: caducado, quemado, caído, roto, devuelto, error de elaboración.
- **Cuándo**. En el momento, no al cierre de memoria.

**Y esto es lo importante de verdad, y va en serio:**

> **Registrar una merma no te delata. Te defiende.**

Cuando a fin de mes falta producto y nadie ha registrado nada, la conclusión que queda es la peor posible: que se ha ido sin saber cómo. Cuando está registrado, la conversación cambia: *"se tiraron 3 kg el día 12 porque falló la cámara"* es un problema técnico, no una sospecha sobre nadie.

**Los tres errores típicos:**
1. **No registrar lo pequeño.** Doscientos gramos al día son seis kilos al mes.
2. **Registrar al cierre, de memoria.** Se olvida la mitad y las cantidades salen inventadas.
3. **Registrar sin motivo.** "Merma: 2 kg" no sirve para corregir nada. El porqué es lo que permite arreglarlo.

**En tu cocina esto pasa así:** la gente no registra por miedo a que parezca que lo ha hecho mal. Es exactamente al revés: **el equipo que registra es el que puede demostrar qué pasó.** Y un local donde nadie registra es un local donde no se puede mejorar nada, porque no se sabe dónde está el problema.

> **Dato de gestión** — En Folvy, la merma registrada entra en el libro de movimientos de almacén y se descuenta del stock. Es lo que permite que el "Teórico vs Real" distinga entre gramaje, merma y error de conteo.$md$),

  (v_course_id, 5, 'Cómo se reduce, en la práctica',
$md$Cinco cosas concretas, por orden de impacto:

**1. Producir según la previsión, no según la costumbre.** Es la palanca más grande. Un martes no necesita la producción de un sábado.

**2. Rotación disciplinada.** FIFO/FEFO de verdad: lo nuevo detrás, revisar fechas al colocar, y una pasada rápida de caducidades al empezar el turno.

**3. Etiquetar todo.** Todo lo que se prepara o se trasvasa, con qué es y de qué día. Un táper sin identificar acaba en la basura sí o sí.

**4. Porcionar bien.** Si medio plato vuelve cada día, la ración está mal calculada. Decirlo es una mejora, no una queja.

**5. Cuidar el corte.** Un despiece hecho con tiempo saca más raciones. Merece la pena hacerlo en calma, no en pleno servicio.

**Y lo que hace que todo lo anterior funcione: mirar el dato.** Si nadie revisa qué se está tirando y por qué, todo esto se olvida en dos semanas. Con el registro se ve el patrón — *"casi toda nuestra merma es de un producto concreto"*— y ahí es donde se arregla de raíz: cambiando el pedido, la ración o la elaboración.

**En tu cocina esto pasa así:** la merma baja cuando el equipo **ve el número**. Mientras es un concepto abstracto, no cambia nada. Cuando alguien dice *"este mes hemos tirado 400 € de verdura, casi todo pimiento"*, todo el mundo entiende qué hay que hacer.

> **Dato de gestión** — El módulo de Almacén de Folvy agrupa la merma por artículo, familia, almacén y local. Ese desglose es lo que convierte "tiramos mucho" en "tiramos pimiento los lunes", que ya es un problema con solución.$md$),

  (v_course_id, 6, 'Qué se espera de ti',
$md$Cuatro cosas, y ninguna cuesta tiempo:

**1. Registra lo que tires. Siempre.** Con producto, cantidad y motivo, en el momento. Aunque sea poco. Aunque haya sido culpa tuya.

**2. Rota y etiqueta.** Lo nuevo detrás, todo identificado y con fecha.

**3. Avisa de lo que se repite.** Si un producto se estropea siempre, si una ración vuelve siempre a medias, si algo se pide de más cada semana: **dilo**. Tú lo ves antes que nadie, y eso es información que nadie más tiene.

**4. Aprovecha con cabeza.** Recortes a fondos, verdura fea a cremas, pan de ayer a picatostes. Pero **nunca** producto fuera de temperatura, devuelto de sala o caducado. Ante la duda, se tira: un plato tirado cuesta euros, una intoxicación cuesta el negocio.

**Y para cerrar, la idea que resume el curso:**

> La merma no se elimina. Se **conoce**, se **reduce** y se **aprovecha**.

Una cocina que sabe cuánto tira puede mejorar. Una que no lo sabe, solo puede sorprenderse a fin de mes.

**Antes de terminar**: piensa en lo último que has tirado hoy. ¿Se registró? Si la respuesta es no, ahí tienes por dónde empezar.

> **Dato de gestión** — Merma registrada y consumo teórico son las dos piezas que hacen posible el control de coste real. Sin la primera, la segunda no significa nada.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: b d a c b a d b c a

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Se te cae al suelo media bandeja de producto ya preparado. Vais con lío. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo tiro y sigo: ya está hecho, no hay tiempo para papeleo.', false, 'Esa merma reaparecerá a fin de mes como un descuadre sin explicación.'),
   (v_q, 'Lo tiro y lo registro con producto, cantidad y motivo, aunque sea rápido.', true, 'Correcto. Registrar no te delata: te defiende. Es lo que convierte un descuadre en un hecho explicado.'),
   (v_q, 'Aprovecho lo que no ha tocado el suelo.', false, 'Producto caído al suelo no se recupera, aunque parezca que solo tocó una parte.'),
   (v_q, 'Lo apunto en un papel y lo paso al final de la semana.', false, 'De memoria se pierde la mitad y las cantidades acaban inventadas.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, '¿Cuál de estas mermas ya está contemplada en el coste del plato?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Un producto que caducó sin usarse.', false, 'Eso es merma evitable: no está en ningún cálculo.'),
   (v_q, 'Una bandeja que se quemó.', false, 'Error de elaboración: merma evitable.'),
   (v_q, 'La comida que el cliente deja en el plato.', false, 'Es merma, pero no está contemplada en el escandallo.'),
   (v_q, 'La piel de la cebolla y los recortes de limpieza del producto.', true, 'Correcto. Es merma inevitable, ya recogida en la diferencia entre cantidad bruta y neta.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Sobra caldo de un producto que ha estado correctamente refrigerado y en fecha. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo aprovecho para un fondo o una sugerencia, etiquetado y con fecha.', true, 'Correcto. Aprovechar bien es economía y además obligación creciente por la Ley 1/2025.'),
   (v_q, 'Lo tiro: lo que sobra siempre es riesgo.', false, 'Producto en fecha y en frío es perfectamente aprovechable.'),
   (v_q, 'Lo guardo en un táper sin etiquetar para usarlo mañana.', false, 'Un táper sin identificar acaba en la basura: es merma futura y riesgo sanitario.'),
   (v_q, 'Lo dejo en la cámara y ya se verá.', false, 'Sin etiqueta ni fecha, nadie se atreverá a usarlo.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'Un plato vuelve de sala con la mitad de la guarnición sin tocar. Y pasa todos los días.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Es normal, cada cliente come lo que quiere.', false, 'Si pasa TODOS los días no es preferencia del cliente: es un patrón.'),
   (v_q, 'Se aprovecha la guarnición que no han tocado para otro plato.', false, 'Lo que ha salido a sala y vuelve NO se reutiliza, aunque parezca intacto.'),
   (v_q, 'Es un patrón: la ración probablemente es demasiado grande y conviene decirlo.', true, 'Correcto. Es merma y además coste innecesario. Tú lo ves antes que nadie.'),
   (v_q, 'Hay que cambiar la guarnición por otra que guste más.', false, 'Puede ser, pero primero hay que revisar la cantidad: es la causa más probable.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, '¿Cuál es la causa más frecuente de merma evitable en una cocina?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'El descuido del personal.', false, 'Rara vez es descuido: suele ser un problema de planificación.'),
   (v_q, 'Preparar pensando en el mejor día de la semana: producir un martes como si fuera sábado.', true, 'Correcto. Producir contra la previsión real es la palanca que más merma reduce.'),
   (v_q, 'Los proveedores que traen producto de mala calidad.', false, 'Ocurre, pero no es la causa principal.'),
   (v_q, 'Las cámaras que no enfrían bien.', false, 'Es una causa puntual, no la más frecuente.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'Falta producto a fin de mes y no hay ninguna merma registrada. ¿Qué problema genera eso?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Que no se puede saber si fue gramaje, merma o error de conteo — y cada uno se arregla distinto.', true, 'Correcto. Sin registro, la única conclusión que queda es la peor: que se fue sin saber cómo.'),
   (v_q, 'Ninguno: el producto igualmente se ha gastado.', false, 'El problema no es el producto: es no poder explicar qué pasó.'),
   (v_q, 'Que hay que hacer otro inventario.', false, 'Otro inventario no explica lo ocurrido en el periodo anterior.'),
   (v_q, 'Que hay que subir el precio de los platos.', false, 'Subir precios sin saber la causa no arregla la pérdida.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'Encuentras en la cámara producto en fecha pero que caduca mañana. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo tiro para no arriesgar.', false, 'Está en fecha: tirarlo es merma evitable pura.'),
   (v_q, 'Lo dejo donde está: aún no ha caducado.', false, 'Mañana estará caducado y habrá que tirarlo igual.'),
   (v_q, 'Lo congelo sin más para alargarlo.', false, 'Congelar producto ya elaborado o cerca de caducar no siempre es válido; depende del producto y del proceso.'),
   (v_q, 'Lo pongo delante para gastarlo primero y aviso para adelantarlo en la carta o en la sugerencia.', true, 'Correcto. FEFO: lo que antes caduca, primero sale.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'Al registrar una merma, ¿qué información hace falta?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Solo la cantidad: el resto se deduce.', false, 'Sin el motivo no se puede corregir la causa.'),
   (v_q, 'Producto, cantidad y motivo, en el momento en que ocurre.', true, 'Correcto. "Merma: 2 kg" sin porqué no permite arreglar nada.'),
   (v_q, 'Producto y quién lo tiró, para saber a quién avisar.', false, 'No se trata de buscar responsables: se trata de corregir el proceso.'),
   (v_q, 'Basta con avisar de palabra al encargado.', false, 'De palabra no queda registro y a fin de mes nadie lo recuerda.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Un cliente devuelve un plato sin haberlo tocado, dice que se ha equivocado al pedir. ¿Se aprovecha?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí, si se ve que no lo ha tocado.', false, 'No se puede saber qué contacto ha tenido en la mesa.'),
   (v_q, 'Sí, para la comida del personal.', false, 'La seguridad alimentaria es la misma para el equipo que para el cliente.'),
   (v_q, 'No: lo que sale a sala y vuelve no se reutiliza. Se desecha y se registra como merma.', true, 'Correcto. Y registrarlo permite ver si las devoluciones son un patrón.'),
   (v_q, 'Sí, si se recalienta bien antes.', false, 'Recalentar no elimina el riesgo de contaminación en sala.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, '¿Cuál es el objetivo realista respecto a la merma?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Conocerla, reducir la evitable y aprovechar lo que se pueda con seguridad.', true, 'Correcto. Una cocina que sabe cuánto tira puede mejorar; la que no, solo se sorprende a fin de mes.'),
   (v_q, 'Llegar a cero merma.', false, 'Imposible: la merma inevitable existe siempre por la naturaleza del producto.'),
   (v_q, 'Aprovecharlo absolutamente todo.', false, 'Hay producto que NUNCA se aprovecha: fuera de temperatura, devuelto o caducado.'),
   (v_q, 'Comprar menos cantidad para que no sobre.', false, 'Comprar corto genera roturas de stock y ventas perdidas.');

  raise notice 'Curso de mermas sembrado (draft, cocina). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status, c.category,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='mermas_aprovechamiento' and c.account_id is null;
-- Esperado: draft · cocina · 6 secciones · 10 preguntas · 10 correctas.
