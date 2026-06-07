# Investigación de competidores — Foodint
**Fecha**: 16 de mayo de 2026
**Autor**: Claude (sesión con Julio Gascón, CEO Foodint)
**Tipo**: Análisis estratégico de mercado para decidir posicionamiento

---

## Nota metodológica

Este documento está construido con dos tipos de información, marcados explícitamente:

- **(D)** = **Dato verificado** vía búsquedas web del 16-may-2026, principalmente en sitios oficiales de los productos, agregadores G2/Capterra/GetApp y análisis terceros (POSUSA, CheckThat.ai, Sonary, Tramitapp).
- **(I)** = **Interpretación analítica** de Claude. Es opinión razonada, no hecho. Puede equivocarse.

Cuando un dato es opaco (precios sin publicar, features detrás de demo), lo digo. No invento.

Dos aclaraciones de ámbito antes de empezar:

1. **"Cookbook"** — no encontré ningún producto independiente con ese nombre. Lo más parecido es la *feature Cookbook* de Marketman, que es un módulo de fichas de recetas dentro de su plataforma. Si te referías a otro producto (¿Cookkeeper? ¿Cookin?), dímelo y lo añado en una segunda pasada.
2. **"Combatte"** — tampoco apareció ningún SaaS de hostelería con ese nombre exacto. Conjeturo que puedes referirte a **Combo** (combohr.com), software francés de gestión de personal muy popular en hostelería en España. Lo analizo bajo esa hipótesis y, si te referías a otro, lo cambiamos.

---

## 1. Apicbase

**Categoría / qué hace bien** — (D) Plataforma cloud belga de **gestión back-of-house para restauración multi-local**: motor central de recetas/escandallos, inventario en tiempo real, compras, planificación de producción, planificación de menús, HACCP, analytics de ventas, contabilidad, *internal ordering* (pedidos entre central de producción y outlets) y, más recientemente, *carbon tracking* (huella de carbono por plato). 9 módulos. Presencia en >1.000 locales. Clientes objetivo: cadenas multi-unidad, hoteles, ghost kitchens, catering a gran escala.

**Modelo de cobro y precios** — (D) **Modular**: pago por módulos + por número de outlets. **Precio público no transparente**: el sitio oficial requiere "Get a quote". G2 cita "starting at $149/month"; SoftwareSuggest cita $160/mes para el "Single Outlet Bundle". Reseñas mencionan "un poco caro para empresa pequeña". Mi interpretación: **precio elevado, claramente enfocado a operadores medianos-grandes**, no a un bar independiente. Free trial disponible.

**Diferenciador principal** — (D) Es el competidor que **más se parece a la visión Foodint** en su rama de operaciones (sin TPV, sin marketing, sin tienda online): la columna vertebral es la receta/escandallo como dato único, conectada a inventario, compras, producción, menú y ventas, con multi-local nativo. API robusta. 100+ integraciones con POS y proveedores europeos (Lightspeed, Deliverect, Square, Sage, Xero, Untill, Trivec, Vectron).

**Qué hace bien que Foodint pueda aprender** — (I)
- **Arquitectura modular real**: el usuario contrata lo que necesita y crece sin migrar. Tu modelo de cobro modular ya apunta a esto, así que el referente es bueno.
- **API-first**: las integraciones se documentan y se venden. No es una integración por adapter ad-hoc; es contrato público.
- **Single source of truth de F&B**: una sola base de datos de recetas/ingredientes para toda la cadena. Es justo la idea que describiste de "Stock = corazón productivo".
- **Internal ordering**: gestión del flujo central→local. Si Llorente29 o un cliente similar tiene cocina central, esto vale dinero.
- **Carbon tracking**: feature relativamente nueva, pero el dato vale para clientes con preocupaciones ESG.

**Qué hace mal o no cubre** — (D + I)
- (D) **No tiene TPV**, ni reservas, ni delivery propio. Es solo back-office. El cliente debe traer su TPV.
- (D) **Integraciones europeas** sí, pero la conexión con plataformas españolas locales (Tspoon, Glovo nativo, Last.app) no la veo documentada explícitamente.
- (D) Algunos usuarios mencionan **curva de aprendizaje compleja** ("requires knowledgeable and committed restaurant team").
- (I) **Sin tienda online propia, sin fidelización, sin marketing.** Está fuera de su alcance.
- (I) Para un cliente pequeño-mediano español, **probablemente desproporcionado en precio y complejidad** (esto es opinión, no dato).

**Resumen ejecutivo** — Apicbase es el **competidor más serio en operaciones back-of-house para cadenas medianas/grandes**, modular y API-first, pero deja fuera todo el front-office y el marketing.

---

## 2. Marketman

**Categoría / qué hace bien** — (D) **SaaS cloud de inventario/compras/recetas para restaurantes**, especialmente fuerte en QSR, cafeterías, bares y operaciones multi-unidad. Integración con todos los TPV principales (Toast, Square, Revel, Lightspeed, etc.) y muchos proveedores/distribuidores. **AI features recientes**: escaneo de facturas (50 al mes en plan starter, ilimitado en Growth+), sugerencia de recetas vía foto de ingredientes, recomendación de cantidades de pedido por demanda histórica. 15.000+ locales en 55 países.

**Modelo de cobro y precios** — (D) **Precios públicos, sí transparentes**:
- Starter: **$199/mes/local**
- Growth: **$249/mes/local**
- Enterprise: custom (CheckThat cita ~$429/mes)
- Setup fees adicionales (no públicos).

El precio escala por features (no solo por número de locales). Implementación reportada en 2–6 meses según complejidad. **Atención**: múltiples reseñas en G2/Capterra denuncian un **proceso de cancelación abusivo** (60 días de notice, llamadas obligatorias, dark patterns). Es un riesgo reputacional para ellos.

**Diferenciador principal** — (D + I) **Integración masiva con TPV** y **transparencia de precios**. Es el "plug-in de inventario" más popular para restaurantes que ya tienen Toast/Square/etc. Su nicho histórico: añadir control de costes al TPV que el restaurante ya usa.

**Qué hace bien que Foodint pueda aprender** — (I)
- **Precios públicos**. En un mercado donde casi nadie publica precios, esto es un arma comercial. Tspoon, Mapal, Apicbase, Toast... ninguno los publica. Foodint puede.
- **Onboarding rápido como producto**: 2–4 semanas para un local. Si tu venta es modular y progresiva, el cliente quiere ver valor en semanas, no en meses.
- **Cookbook digital + recetas con sub-recetas**: el patrón "receta dentro de receta dentro de receta" que describiste como producto compuesto está ya validado aquí.
- **Escaneo OCR de facturas** (con IA, en 2026). Es feature relativamente nueva, pero potente. Foodint podría priorizar esto frente a la entrada manual de albaranes.

**Qué hace mal o no cubre** — (D + I)
- (D) **No es ERP completo**: no TPV, no personal, no APPCC, no marketing. Es plug-in.
- (D) **Cancelación oscura** documentada en reseñas → vulnerabilidad reputacional explotable.
- (D) Algunos usuarios mencionan que la integración con TPV es **clunky cuando se renombran ítems** (rompe históricos).
- (I) Su modelo se basa en que el cliente ya tenga TPV resuelto. Si Foodint propone TPV propio + back-office, Marketman no compite directamente.

**Resumen ejecutivo** — Marketman es **el plug-in de back-office para quien ya tiene un TPV americano**, con precios transparentes y onboarding rápido, pero sin pretensión ERP.

---

## 3. Cookbook *(no identificado como producto independiente)*

(D) No existe un producto SaaS de hostelería independiente llamado "Cookbook" que haya podido verificar. **Cookbook es la feature de fichas técnicas / recipe management de Marketman** y también un nombre genérico que usan varios productos para sus módulos de recetas (Apicbase, WISK, ifoodi, Supy, etc.).

(I) Si te referías a otro producto, dímelo. Posibles candidatos a aclarar contigo:
- **WISK** (Canadá) — gestión de recetas + inventario fuerte en bares y cocteles.
- **Supy** (Emiratos Árabes) — gestión multi-cadena con foco en recetas y data.
- **ifoodi** (Reino Unido) — fichas técnicas + alérgenos + escandallos + huella nutricional, foco UK.

Si quieres que profundice en alguno, lo dejamos apuntado para próxima sesión.

---

## 4. Tspoon

**Categoría / qué hace bien** — (D, del contexto + búsqueda complementaria) Plataforma española de **back-office para hostelería**: marcas, productos, escandallos, integraciones con plataformas de delivery, contabilidad. Es el sistema que Llorente29 usa actualmente y del que Foodint quiere migrar.

**Modelo de cobro y precios** — (I) Información pública limitada. No hay tarifas transparentes en su web. Modelo de licencia mensual por local + módulos. Hay que pedirles.

**Diferenciador principal** — (I) **Producto español, conocido en el sector y con clientes reales**. Tiene presencia y comunidad. Es la incumbente local en la categoría back-office.

**Qué hace bien que Foodint pueda aprender** — (I, basado en lo que comentaste en sesiones previas y en la imagen que pasaste)
- **Modelo mental del operador español**: terminología, flujos, integraciones con proveedores y plataformas locales (Glovo, Last.app, etc.). Tspoon "habla el idioma".
- **Agrupar marcas en categorías personalizables por el cliente** (Delivery, Delivery MP, etc.) — patrón que ya identificaste y que tu modelo de tabla `brand_category` separada va a manejar mejor.
- Conexión real con realidad de Llorente29: Foodint ya **sabe qué falla** en Tspoon por experiencia directa.

**Qué hace mal o no cubre** — (I, basado en tu propio análisis registrado en el contexto)
- **Modelo de datos monolítico**: meten ~40 campos en una sola entidad "cliente" mezclando facturación, integración, configuración, contactos. Es lo que tú identificaste como "patrón a NO replicar" y para lo que decidiste separar tablas (`brand_billing`, `brand_settings`, `brand_integration`, `brand_category`). **Esta decisión arquitectónica de Foodint es ya una ventaja competitiva real, no teórica.**
- **No es un sistema operativo completo**: enfocado a back-office. Falta personal, APPCC integrado, fidelización, tienda online.
- **UX y modernidad**: opinión del usuario en sesión previa fue que la interfaz es densa y costosa de mantener.
- **Datos exportables a Excel manualmente**, no API moderna documentada (al menos no ampliamente).

**Resumen ejecutivo** — Tspoon es **la incumbente española en back-office** que Foodint debe superar **no por precio, sino por arquitectura, integración real (Personal+APPCC+Cocina) y modernidad**.

---

## 5. Combatte → asumido como **Combo** *(si no era esto, pídeme rehacer)*

**Categoría / qué hace bien** — (D) **SaaS francés de gestión de personal especializado en hostelería**: planificación de turnos, fichaje, control horario, gestión de convenios, nóminas variables, comunicación equipo. Adaptación específica a hostelería (turnos rotativos, alta estacionalidad, convenios complejos). Presencia creciente en España.

**Modelo de cobro y precios** — (D) Precios opacos en web pública española. (I) En su mercado francés se posicionan en gama media (~€3–8 por empleado/mes según fuentes terceras), pero confirmar requiere demo.

**Diferenciador principal** — (D + I) **Especialización vertical en personal de hostelería**. No es Factorial genérico ni Personio: está hecho para turnos rotativos, picos y convenios sectoriales.

**Qué hace bien que Foodint pueda aprender** — (I)
- **Comunicación con el equipo en la propia app** (no email). Tus módulos de Personal podrían incorporarlo.
- **Detección automática de incumplimientos de convenio** al planificar turnos. Es un value-add real para el operador español.
- **App móvil del empleado** muy cuidada — el empleado de hostelería vive en el móvil.

**Qué hace mal o no cubre** — (I)
- **Solo personal**. No es plataforma integral. Compite con tu módulo Personal, no con todo Foodint.
- En España compite con **Skello** (también francés), **Sesame HR**, **Factorial**, **Bizneo**, **Mapal Workforce** y otros. Mercado fragmentado.

**Resumen ejecutivo** — Combo (si es a lo que te referías) es **un competidor directo solo del módulo Personal de Foodint**, no de la plataforma completa.

---

## 6. Mapal OS

**Categoría / qué hace bien** — (D) **Suite modular española-internacional para hostelería**, posiblemente el competidor estratégicamente más cercano a la visión Foodint. 45.000+ locales en 54 países. Fundada por operadores reales de hostelería. Cliente top: Five Guys, AmRest. Módulos: **Workforce** (turnos/fichaje, antes GIRnet), **Compliance** (APPCC + calidad), **Flow Learning** (formación), **Engagement** (comunicación interna y cultura), **Reputation** (gestión de reseñas), **Easilys f&b** (inventario/compras/residuos), **Facilities** (mantenimiento), **Analytics**. Login único, "look & feel" unificado, módulos contratables independientes o juntos.

**Modelo de cobro y precios** — (D) **Modular**, precios **opacos** ("contact for demo"). Pricing público para Workforce existe en su web pero requiere clic ("planes y precios"). Reseñas indican que no es producto barato y va dirigido a cadenas medianas/grandes.

**Diferenciador principal** — (D + I) **Es ya muy parecido a lo que quieres construir**: suite modular para hostelería, multi-marca, multi-local, internacional, con APPCC + Personal + Formación + Operaciones + Calidad. La diferencia es que **están enfocados en grandes cadenas, no en operadores medianos**.

**Qué hace bien que Foodint pueda aprender** — (I, esto es el competidor más importante a estudiar)
- **Single sign-on entre módulos**, "look and feel" unificado: exactamente el problema arquitectónico que tienes que resolver (modularización top-level del UI). Mira cómo lo hacen.
- **Módulos independientes contratables**: validan tu modelo de negocio.
- **Formación + Engagement como módulos diferenciados**: ellos saben que el problema de hostelería es la rotación de personal y la cultura. Tú aún no tienes esto en el roadmap declarado, pero deberías considerarlo.
- **Reputation (gestión de reseñas)**: módulo aparentemente sencillo, alto valor percibido, fácil de vender.

**Qué hace mal o no cubre** — (D + I)
- (D) Reseñas negativas recurrentes sobre **complejidad de implantación** y **soporte tras migraciones** (han crecido por adquisiciones, lo que se nota).
- (D) **Interfaz mejorable** según G2.
- (D) **No publican precios**, dificulta evaluación rápida.
- (I) **No tienen TPV**, no tienen tienda online, no tienen integraciones nativas con plataformas de delivery como producto centralizado. Su núcleo es back-office y personal.
- (I) **Dirigido a grandes cadenas**. Operadores de 1–10 locales pueden encontrarlo sobredimensionado. Es donde Foodint puede atacar.

**Resumen ejecutivo** — Mapal OS es **el referente estratégico directo y la mayor amenaza competitiva**: ya está construido lo que tú quieres construir, pero está pensado para grandes y deja el mid-market y el TPV/marketing/delivery sin cubrir.

---

## 7. Toast

**Categoría / qué hace bien** — (D) **Gigante americano de TPV para restaurantes**. Foco principal: TPV cloud con hardware propio (terminales, comanderos, KDS), pagos integrados, online ordering, delivery, loyalty, marketing, gift cards, payroll & scheduling, inventory automation, xtraCHEF (su producto de recipe costing/AP automation tras adquisición). Es el TPV dominante en USA para restaurantes.

**Modelo de cobro y precios** — (D) **Combinación TPV + comisiones de procesado de pagos + add-ons**:
- **Starter**: $0/mes (con plan de pago de hardware multi-año)
- **Point of Sale**: $69/mes
- **Build Your Own**: desde $165/mes, escala con módulos
- Procesado: **2,49% – 2,99% + $0,15 por transacción**
- Contratos **típicamente 3 años**
- Coste real reportado: $250–$500/mes (café pequeño), $700–$2.000+/mes (restaurante medio), $3.000–$5.000+/mes (multi-local con add-ons completos)
- (D) Reseñas indican **subidas anuales de precio del 5–15%**, fees ocultos (PCI, batch, chargeback, statement), **early termination fee** ~$495 + resto de contrato.

**Diferenciador principal** — (D) **TPV vertical de restaurantes con todo integrado y escala USA enorme**. Capital, R&D y network effects que ningún competidor europeo iguala.

**Qué hace bien que Foodint pueda aprender** — (I)
- **Suite end-to-end** front + back desde un solo proveedor. Modelo de "todo bajo una factura" que el operador valora.
- **xtraCHEF** (su recipe costing) demuestra que adquirir un buen back-office y plugarlo al TPV es ruta válida. Foodint hace el camino inverso: back-office potente, integrar TPV después.
- **KDS, comandero, online ordering nativos**: la propuesta integral aspiracional.

**Qué hace mal o no cubre** — (D + I)
- (D) **No opera en España** como producto local. Mercado americano y algunos otros mercados anglosajones.
- (D) **Modelo de coste opaco real**: lo que ves no es lo que pagas. Es un dolor de cliente recurrente.
- (D) **Contratos de 3 años** con cláusulas de subida — fricción comercial.
- (I) **Inadaptado a Verifactu/TicketBAI** y a la operativa fiscal/contable española. Para entrar en España necesitaría tropicalización seria.

**Resumen ejecutivo** — Toast es **referente mundial de TPV + back-office integrado**, pero **no opera en España**, así que su amenaza directa es **inspiracional, no competitiva**. Foodint puede aprender mucho sin temer su entrada inmediata.

---

## 8. Square for Restaurants

**Categoría / qué hace bien** — (D) **TPV para restaurantes del ecosistema Square**: TPV cloud, hardware (terminal táctil, TPV portátil, KDS), pagos integrados, online ordering propio sin comisiones, kiosks de autoservicio, loyalty, programa de pagos. Sí opera en España. Ya hay cadenas españolas usándolo (ej. Pink's en Madrid, según testimonios públicos en su web).

**Modelo de cobro y precios** — (D) **Más transparente que Toast**:
- **Free**: $0/mes (1 local, features básicos)
- **Plus**: $49–60/mes (multi-local, features completos)
- **Premium**: $149/mes
- Procesado en USA: 2,4–2,9% + $0,15 según plan
- (D) En España tarifas algo diferentes; Square tiene presencia local con web en español.

**Diferenciador principal** — (D + I) **Simplicidad + plan gratuito real + ecosistema Square completo** (pagos, gestión de equipo, marketing, web/eCommerce de Square Online). El operador pequeño puede empezar gratis.

**Qué hace bien que Foodint pueda aprender** — (I)
- **Plan freemium real**. Modelo de adquisición por bottom-up que ningún ERP español usa. Genera funnel.
- **Hardware bonito y barato** — sale aspiracional al pequeño operador.
- **Marketplace de apps**: integración con muchos verticales (reservas, contabilidad, etc.).

**Qué hace mal o no cubre** — (I)
- (I) **Back-office débil en escandallos y multi-local**. Suficiente para 1–3 locales, escaso para cadenas.
- (I) Producto **horizontal con vertical de restaurantes encima**, no nacido en hostelería. Se nota.
- (I) Su enfoque es **el comercio individual o pequeña cadena**, no el operador profesional con cocinas centrales, marcas múltiples y necesidades complejas.

**Resumen ejecutivo** — Square es **TPV freemium accesible para pequeños operadores**, válido como punto de entrada al pequeño negocio pero **insuficiente como ERP profesional**.

---

## 9. Lightspeed Restaurant

**Categoría / qué hace bien** — (D) **TPV cloud canadiense para restaurantes**, originalmente Belgian POSIOS, integrado en suite Lightspeed (también tienen retail y golf). iPad-only. Features: gestión de mesas, plano de sala, online ordering, contactless, loyalty, KDS, integraciones con Uber Eats / Deliveroo, reservas. Comparado con Toast: menos potente en ecosistema pero **mejor estructura de precios** y menos opaco.

**Modelo de cobro y precios** — (D):
- **Starter**: $69/mes
- **Essential**: $189/mes
- **Premium**: $399/mes
- **Enterprise**: custom
- Contrato anual.
- Procesado: 2,6% + 10¢ con Lightspeed Payments (USA/Canadá). Procesado restaurante en Europa varía.
- KDS: **+$30/pantalla extra** (no incluido).
- Real-world: $300–$1.000+/mes según features y volumen.

**Diferenciador principal** — (D + I) **TPV restaurante consolidado, iPad-based, con escala mid-market**. Compite cara a cara con Toast.

**Qué hace bien que Foodint pueda aprender** — (I)
- **Soporte 24/7 telefónico** incluido en todos los planes — valorado por reseñas. En España, soporte serio es diferenciador.
- **40% fewer clicks** para acciones core (afirmación propia, no verificable, pero indicativa de obsesión por UX).
- **Tres planes claros** con features delimitadas: no requiere conversación de ventas para arrancar.

**Qué hace mal o no cubre** — (D + I)
- (D) **iPad-only**: barrera de entrada para clientes con Android o Windows.
- (D) **Contrato anual obligatorio**, reseñas mencionan dificultad para salir.
- (D) **Add-ons que escalan el precio rápido** (KDS, advanced inventory, online ordering en planes bajos).
- (I) En España tiene presencia limitada comparada con Cegid Revo, Hosteltáctil, Hiopos, Cuiner.

**Resumen ejecutivo** — Lightspeed Restaurant es **alternativa a Toast con precios más claros**, pero **iPad-only y débil presencia en España**.

---

## Otros actores españoles que NO me pediste pero que son competencia real

Mención breve, sin profundizar. Si quieres detalle, próxima sesión.

- **Cegid Revo (antes Revo)** — TPV español muy fuerte, gestión integral, multi-país, alta presencia. Verifactu y TicketBAI cubiertos.
- **Hosteltáctil** — TPV español de referencia, especialista hostelería, hardware propio.
- **Hiopos / Hippos** — TPV cloud español.
- **Cuiner** — TPV especializado hostelería en grupo Imàtica.
- **MyChefTool** — TPV sin comisiones, Verifactu, 300+ restaurantes.
- **Camarero10** — TPV con módulos y demo gratis, ~40€/mes.
- **Qamarero** — TPV + carta digital + KDS, "la startup mejor valorada en Google España según ellos", 580+ reseñas.
- **Gstock** — Software gestión de stocks/escandallos para hoteles, restaurantes y cadenas, español, foco F&B hotelero. **Competidor directo del módulo Cocina de Foodint en España.**
- **Gerentino** — Suite española con módulos APPCC, personal, cocina, administración. **Modelo modular muy parecido al tuyo**, foco operadores pequeños-medianos.
- **Skello** — competidor directo en Personal (rival de Combo).
- **Foodeo, Gestor de Cocina, Chef Control** — pequeños actores españoles en escandallos.

(I) **Gerentino y Gstock son los dos competidores españoles que más se parecen al posicionamiento que Foodint puede tomar**. Merecen análisis específico en sesión futura.

---

## Cuadro resumen — visión rápida

| Producto | Categoría | Precio público | Diferenciador | Amenaza para Foodint |
|---|---|---|---|---|
| Apicbase | Back-office BoH multilocal | Opaco, desde ~$149/mes | Modular API-first, recetas como SSoT | **Alta** (rama operaciones) |
| Marketman | Inventario + recetas plug-in TPV | $199–$429/mes/local | Transparencia + AI invoice scan | Media (no es ERP) |
| Cookbook | *No identificado como producto* | — | — | — |
| Tspoon | Back-office España | Opaco | Incumbente local | **Crítica** (cliente actual) |
| Combo (?) | Personal hostelería | Opaco | Especialización vertical | Solo módulo Personal |
| **Mapal OS** | Suite hostelería modular | Opaco | **Casi lo que tú quieres ser** | **Máxima** |
| Toast | TPV USA all-in | $0–$5.000+/mes | Escala USA, end-to-end | Inspiración, no compite ES |
| Square Restaurants | TPV freemium | $0–$149/mes | Freemium real, simplicidad | Baja (back-office débil) |
| Lightspeed Restaurant | TPV mid-market | $69–$399/mes | UX cuidada, iPad-only | Media (poca presencia ES) |

---

## Recomendación de posicionamiento para Foodint

(I) Toda esta sección es interpretación. Es la opinión más honesta que puedo dar con la información disponible.

### El espacio competitivo está claro

Hay tres bloques de competencia, y **ninguno está ocupando el centro**:

1. **Suite modular hostelería gama alta**: Mapal OS, Apicbase. Caros, opacos, dirigidos a grandes cadenas. Su debilidad es que **el operador mid-market español (3–30 locales) se siente sobredimensionado**.

2. **TPV con back-office integrado**: Toast, Square, Lightspeed, y los TPV españoles (Revo, Hosteltáctil, Hiopos). Su debilidad es que **el back-office es flojo** o requiere plug-ins externos (xtraCHEF, Marketman, Apicbase).

3. **Verticales puntuales**: Combo/Skello (personal), Gstock (stocks), MyChefTool (TPV freemium), Marketman (inventario). El operador tiene que **encadenar 4–6 herramientas y rezar para que se integren**.

### Foodint puede ocupar un sitio que hoy nadie ocupa con claridad en España

**"Operating System modular de hostelería para el operador profesional español de 1–30 locales"**.

Es decir:

- **Modular como Mapal pero accesible**: cliente pequeño puede arrancar con 1 módulo y crecer.
- **Profundidad operativa de Apicbase** en la rama de cocina/escandallos/multi-marca/multi-local.
- **Adaptado a la realidad española**: Verifactu, integraciones nativas Glovo/Uber Eats/Last, convenios laborales, APPCC con plantillas en español.
- **APPCC + Personal + Cocina + (TPV vía integración) ya conectados**, no como herramientas separadas.
- **Precios públicos modulares**, contra la opacidad del 80% del mercado.

### Qué te diferencia del producto que más se parece (Mapal)

Tres cosas:

1. **Tamaño objetivo**: Mapal va a Five Guys, AmRest. Foodint va al **grupo restaurador profesional español de 1–30 locales** que hoy combina Tspoon + Excel + Holded + Sesame + WhatsApp. Es un mercado enorme y mal servido.
2. **Profundidad del módulo Cocina**: Mapal compró Easilys, no nació con un modelo de datos potente para producto compuesto/intermedio/escandallo profundo. Tu modelo (artículo → intermedio → final con packaging/herramientas/MO) es **más ambicioso técnicamente**. Si lo ejecutas bien, ganas en ese módulo.
3. **Precio público + onboarding rápido + sin contratos abusivos**. Frente a Toast/Mapal/Marketman, esto es comercializable per se.

### Riesgos del camino que llevas

(I) Aviso honesto, te lo prometí.

1. **Quieres construir Toast + Mapal + Apicbase + Square + Shopify + Mailchimp + Glovo + un CRM en uno solo, tú solo con Claude como herramienta**. **Esto no es realista en 3–5 años.** Toast tiene 5.000+ empleados. Mapal tiene cientos. Apicbase tiene >100. Aunque seas brutalmente productivo, hay un techo físico.
2. **La amenaza real no es construir mal el producto, es construir mucho mal**. Si abres 8 módulos en paralelo, ninguno será mejor que la versión especializada de la competencia. **Profundidad en pocos módulos > superficie en muchos.**
3. **El sistema de routing + modularización top-level del UI es deuda técnica que llevas arrastrando**, y tú mismo lo registraste en el contexto. Sin esto no se vende. Cualquier otro plan estratégico es secundario a desbloquear esto.
4. **Cliente 2 puede arrancar con Personal + APPCC YA**. No esperar al módulo Cocina. Te lo dije en sesión anterior y lo reitero aquí: vender Personal + APPCC al cliente 2 mientras se construye Cocina es **el único movimiento financieramente sensato**.
5. **Hardcoded `CURRENT_ACCOUNT_ID`** caduca al segundo cliente. Es un cartucho que se gasta. Tienes que matarlo antes de firmar el cliente 2.

### Qué módulos priorizar (en orden)

Mi recomendación:

1. **Refactor de arquitectura primero (routing + modularización top-level)**. No es módulo, es infraestructura. Bloquea todo lo demás. **2–4 sesiones de trabajo.**
2. **Eliminación de `CURRENT_ACCOUNT_ID` hardcoded** + multi-cuenta real. Bloquea cliente 2. **1–2 sesiones.**
3. **Módulo Cocina (nombre nuevo) — fase 1**: marca, escandallo simple, almacén, artículo. **Lo mínimo demostrable.** El producto compuesto profundo (intermedios + packaging + herramientas + MO) viene en fase 2.
4. **Integración nativa con Glovo / Uber Eats / Last.app** vía adapters (ya tienes la decisión arquitectónica tomada). Este es **el diferenciador comercial inmediato** en España.
5. **Mejora del módulo Personal** existente (turnos, fichaje, convenios) — ya lo tienes, pulir es más barato que construir nuevo.
6. **APPCC** — ya lo tienes, igual.

### Qué módulos NO replicar — integrar mejor

(I) Tres categorías donde **no vale la pena construir** lo que ya hace muy bien la competencia:

1. **TPV propio**. Cegid Revo, Hosteltáctil, Toast, Square, Lightspeed, MyChefTool... el mercado está saturado. **Integra con 2–3 TPV vía API**, no construyas el tuyo. Tu valor está en lo que pasa antes (catálogo, escandallos, marca, precios) y después (analytics, marketing) del TPV.
2. **Pasarela de pagos**. Stripe, Redsys, Adyen. No tiene sentido.
3. **Tienda online genérica con marketplace**. Shopify lleva 15 años en esto. Lo que sí tiene sentido es **una capa de configuración de menús/marcas que se exporte a Shopify / WooCommerce / un canal Glovo** desde tu single source of truth. **No competir con Shopify, alimentar a Shopify.**
4. **Fidelización pura**. Hay decenas de productos especializados. **Integra**.
5. **Redes sociales** — Hootsuite, Buffer existen. Posible integración futura, pero baja prioridad.

### El módulo más infravalorado del mercado y que Foodint podría ganar fácil

(I) **Integración nativa de delivery (Glovo + Uber Eats + Last)** + **gestión inteligente de menús diferenciados por marca y canal**, desde una sola interfaz de catálogo conectada al escandallo.

Razones:

- Nadie lo hace bien hoy. Los TPV españoles tienen integraciones parciales y los back-office (Tspoon, Mapal) no son competidores en este campo.
- Es el dolor número 1 del operador con ghost kitchens y marcas múltiples como Llorente29.
- Es el lazo que une "Stock" + "TPV" + "marcas" + "precios variables por marca" — exactamente lo que describiste como tu visión.
- Es **demostrable en una demo de 15 minutos** con cualquier cliente del pipeline.

---

## Lo último — tu pregunta implícita

(I) **¿Esto vale la pena?** Sí, pero con disciplina:

- No vas a ser Toast + Mapal + Apicbase + Shopify. Vas a ser **el OS modular del operador profesional español mid-market** y eso ya es un negocio enorme.
- Tu ventaja no es presupuesto ni equipo. Es **velocidad de iteración + conocimiento real del operador (Llorente29) + arquitectura limpia desde día uno**. Esa ventaja se evapora si pierdes tiempo en cosas que la competencia ya hace bien.
- Vende lo que ya tienes (Personal + APPCC) al cliente 2 mientras construyes Cocina. Cualquier mes que no facture es un mes que tu pista de despegue se acorta.

---

## Tareas técnicas surgidas durante la investigación

(Para apuntar como deuda técnica de futura sesión, no de hoy)

- **Decisión nombre del módulo Cocina** — sin urgencia, pero conviene cerrarlo antes de la siguiente sesión arquitectónica.
- **Mapear los adapters de integración necesarios**: Glovo, Uber Eats, Last.app, Deliveroo (mínimo para España). Diseñar la capa `src/services/integrations/` cuando llegue el momento.
- **Documento de pricing público modular** — borrador para discutir en futura sesión comercial.
- **Decidir si TPV será integración o módulo propio** — apunto que recomiendo integración. Tema abierto.
