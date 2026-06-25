# Folvy Shop — Estudio de la tienda online de comida más bonita y navegable (jun 2026)

> Estudio **independiente** de la capa de diseño (distinto del benchmark de modelo de
> negocio). Premisa de Julio: el escaparate es lo que ve el cliente final y por lo que
> identifica al restaurador; si es feo o navega mal, lo de detrás da igual. Objetivo:
> **sacar la tienda más bonita del mercado = tener la imagen ganada.**
>
> Foco: tiendas de COMIDA (transaccional, mobile-first), no webs corporativas. Fuentes
> verificadas 2026; principios extraídos, no copiados.

---

## 0. Por qué la imagen se gana antes del primer pedido

Los datos del sector son brutales y unánimes: la mayoría del tráfico de hostelería es
móvil (la mitad o más), y un sitio no optimizado a móvil pierde de golpe ~61 % de los
visitantes. El 77 % mira la web/tienda antes de decidir, y ~70 % decide NO pedir por lo
que ve (o no ve). La foto manda: ~45 % mira fotos primero y el 67 % asocia foto mala con
comida mala. Y en el flujo de pedido, **cada clic extra entre llegar y pagar resta hasta
~20 % de conversión**, mientras un CTA claro sube conversión hasta ~83 %.

Traducción para Folvy: la Shop no se juega en "tener tienda" (eso lo regalan Makro/Square);
se juega en **verse premium por defecto y dejar pedir en 2-3 toques**. Ahí está la imagen.

---

## 1. El listón estético (qué hacen los mejores)

Patrones constantes en las tiendas/apps de comida top de 2026:

- **La foto es la protagonista, y CONSISTENTE.** Alta calidad, alto contraste, fondo
  neutro, el plato como héroe del encuadre, y —clave— **mismo estilo en toda la carta**.
  La consistencia comunica profesionalidad tanto como la calidad individual. *Este es el
  punto #1 de fealdad en tiendas reales: fotos dispares o ausentes.*
- **Mobile-first de verdad.** Carga rápida (foto WebP <200 KB), navegación táctil, CTA
  grande. Nada de menú en PDF (fricción de 2026).
- **Jerarquía + aire.** El whitespace da centro de escena al plato. Menos es más.
- **Paleta cálida + acento que dispara apetito; tipografía que dice la marca.** Serif
  editorial para premium, sans limpio para casual. El color refleja la cocina (mint para
  healthy, negro/naranja para burgers, cream/navy para bistró).
- **Hero con impacto** en la landing de marca: una gran foto o un loop de vídeo de 15 s
  (kitchen prep, plato emplatándose) — sube tiempo en sitio ~35 %. En el flujo de pedido,
  el hero es más sobrio para no estorbar.
- **Modo oscuro como opción premium** (hace resaltar la foto). Tendencia 2026 junto a
  vídeo-hero, personalización por IA y minimalismo.
- **CTA de pedido inconfundible y sticky** ("Pedir", "Empezar pedido"), que sigue al
  scroll.

**Referencias del "techo estético" a estudiar/superar** (de los rankings 2026): Canlis
(minimalismo fine-dining), Loro (cream + navy, serif con carácter), Forage (color-block
healthy), Kuma's Corner (negro/naranja, burgers con actitud), Q39 (vídeo-loop BBQ),
plus las plataformas design-forward (BentoBox, Popmenu, Toast Websites, plantillas Framer).

---

## 2. El listón de navegación / UX transaccional (el flujo de pedir)

Lo que separa una tienda que convierte de una que se abandona:

- **Flujo lógico con progreso visible:** carta → personalización (modificadores) → carrito
  → checkout. Indicador de paso para reducir ansiedad.
- **Descubrimiento rápido:** categorías **sticky**, "Destacados"/"Lo más pedido" arriba,
  búsqueda con autosugerencia y filtros (dietético/alérgenos) para cartas grandes.
- **"Pedir otra vez"** prominente: la gente repite de 3-5 sitios; el reorder de 1 toque y
  el pago guardado bajan el tiempo de checkout ~40 % y suben la recurrencia.
- **Ficha de plato rica:** foto grande, descripción, **alérgenos/nutrición visibles**,
  modificadores claros con **precio en vivo**, precio siempre a la vista.
- **Feedback inmediato** al añadir (animación/confirmación); carrito siempre accesible
  (botón flotante con nº + total).
- **Checkout en UNA pantalla**, mínimos pasos (4-5 máx), **guest checkout**, autorrelleno
  de dirección/pago, biometría, **Bizum + wallets + tarjeta**.
- **Transparencia TOTAL desde el principio:** precio, IVA, fee de envío, zona de reparto y
  mínimo de pedido — NUNCA esconderlo hasta el final (es el error de UX más citado).
- **Tracking en tiempo real** + notificaciones útiles (lunch/cena, reorder), no spam.

*Nota honesta:* el **carrito multi-restaurante con una entrega** ya existe (Kitchen United
lo hacía); no es invento. Y el **pedido en grupo** sigue siendo el peor flujo del sector =
oportunidad de diferenciación si algún día se aborda.

---

## 3. Anatomía de la tienda ganadora (pantalla a pantalla)

1. **Entrada / hero de marca** — logo, identidad, una foto que dispara apetito, CTA "Pedir".
2. **Modo + zona** — recoger / a domicilio arriba, con dirección, fee y mínimo transparentes.
3. **Carta** — categorías sticky + "Destacados"/"Lo más pedido" + búsqueda + filtros;
   tarjetas foto-forward.
4. **Ficha / modificadores** — foto grande, descripción, alérgenos, modificadores con
   precio en vivo, "Añadir".
5. **Carrito** — resumen claro, editar línea, upsell sutil, totales transparentes.
6. **Checkout** — una pantalla, datos mínimos, Stripe/Bizum, confirmación.
7. **Confirmación + tracking + "Pedir otra vez".**
8. **(Hub multimarca)** — conmutador de marcas + carrito cruzado + UNA entrega.

---

## 4. El sistema Folvy: "bonito por defecto" (cómo lo garantizamos)

El error de Owner.com es sacrificar control por conversión (todas sus tiendas se parecen).
El acierto de Shopify/Square es **tokens + plantillas probadas**: el cliente personaliza
sin poder romperlo. Folvy adopta lo segundo y lo lleva más lejos para hostelería:

- **Plantillas probadas** (Clásica / Escaparate / Minimal) = layouts que ya convierten;
  el cliente elige, no diseña desde cero.
- **Tokens curados** (paleta, tipografía, radios, densidad de foto, claro/oscuro) con
  **contraste AA garantizado**: no se pueden elegir combinaciones ilegibles ni feas.
- **Foto consistente forzada por el sistema:** mismo aspect-ratio y encuadre en toda la
  carta; placeholder elegante si falta; y la **IA de ficha rellena la foto que falta**
  (idea ya registrada) → la carta se ve premium **aunque el restaurador no tenga fotos
  buenas**. Esto ataca directamente el punto #1 de fealdad del mercado.
- **Custom opcional** (logo, hero, secciones) para quien quiera ir más allá, sobre raíles.

> Principio: en Folvy es **imposible montar una tienda fea**. El sistema garantiza el suelo
> estético; el cliente solo elige sabor.

---

## 5. La trampa a evitar

- **Genérico templated** (todas iguales, sosas): se evita con 3 plantillas con carácter +
  tokens de marca reales + foto propia.
- **Carta sin fotos o con fotos dispares:** se evita con foto forzada por sistema + IA de
  relleno. Sin esto, ninguna plantilla salva la tienda.
- **Checkout largo / costes ocultos:** se evita con una pantalla + transparencia total.
- **Lento en móvil:** se evita con WebP, lazy-load, render del catálogo canónico cacheado.
- **Elegir "todo configurable" sin raíles:** lleva al desastre estético. Raíles siempre.

---

## 6. Dónde Folvy golea en IMAGEN (lo que el resto no hace)

1. **Foto premium garantizada por sistema + IA de relleno** → la carta nunca se ve casera,
   ni en un SMB sin fotógrafo. Nadie del campo español lo da.
2. **Ficha de plato con alérgenos/modificadores nativos desde el escandallo** (no texto
   muerto) → más rica y fiable que cualquier DTC.
3. **Multimarca con identidad propia por marca + coherencia de sistema + carrito cruzado**
   (una entrega) → imposible hoy en ES.
4. **Margen real detrás** (invisible al cliente) → permite ofertas/precio con guardarraíl
   sin romper la estética ni el margen.

---

## 7. Criterios de aceptación visual (cómo medimos "es la más bonita")

Gate antes de dar por buena la capa de diseño:

- **Test de 5 segundos** en móvil: se ve premium y se entiende qué es y cómo pedir.
- **Foto consistente en el 100 % de la carta** (cero huecos feos).
- **De landing a "añadido al carrito" en ≤2 toques** para un destacado.
- **Checkout en ≤1 pantalla** con pago guardado.
- **Rendimiento móvil**: LCP bajo, carga rápida, sin PDF.
- **Contraste AA** garantizado en todas las paletas preset.
- **Comparativa lado a lado** con Lymon / Umappi / storefront de Glovo / Flipdish:
  que en "¿cuál pedirías?" gane el nuestro. Si solo empata, no está terminado (deuda-0).

---

## 8. Pendiente RECON / siguiente paso

Antes de fijar el sistema de diseño en datos:
- Confirmar fuente y estado de las fotos (`menu_item`/`menu_item_override` `photo_url`):
  ¿qué cobertura hay hoy en Llorente29?, ¿aspect-ratios?
- Cerrar el **set de salida**: 3 plantillas + 4-6 paletas preset + 3 tipografías
  (las del mockup como punto de partida).
- Adoptar los **criterios de aceptación visual** (§7) como gate del frente.
- Decidir alcance del MVP visual: storefront de marca + ficha + carrito + checkout pickup
  (el hub multimarca como segunda capa).

Destino: que la primera demo de la Shop, en móvil, gane el "¿cuál pedirías?" contra el
mejor del mercado español. Esa es la imagen ganada.
