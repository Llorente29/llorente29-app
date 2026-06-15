# Folvy — Estudio del canal propio (Folvy Shop)

**Fecha:** 16 jun 2026
**Estado:** ESTUDIO de mercado + tesis de diseño. Previo a construcción.
**Qué es:** que cada cliente venda directo a su cliente final (web/app propia) **sin comisión
de marketplace** (Glovo/Uber), con los pedidos entrando por la misma ingesta canónica.
**Conecta con:** `folvy_estrategia_delivery.md` (capa 3: directo), `folvy_ingesta_canonica_diseno.md`
(otro `external_source`), `folvy_economia_plataformas_diseno.md` (margen real), `folvy_integraciones_modulo_diseno.md` (fulfillment como conector).

---

## 0. La verdad incómoda primero (para no vender humo)

El gancho de todo el sector es **"0% comisión"**. Pero **0% comisión ≠ 0% coste**: en el canal
propio sigues pagando (1) el **reparto** (~6 €/pedido con flota propia o DaaS), (2) la **pasarela**
(~1,5 % + 0,25 €), y (3) tu **suscripción** al software. El canal propio gana porque sustituye
el ~30 % de comisión de Glovo/Uber por esos costes fijos/variables menores — pero el margen real
hay que **calcularlo**, no presuponerlo. **Y ahí está exactamente el hueco que nadie llena
(§4) y que Folvy ya tiene resuelto por dentro.**

---

## 1. Por qué el canal propio (el "por qué" comercial)

- **Margen:** sustituir ~30 % de comisión por ~coste de reparto + pasarela. En pedidos de ticket
  medio, recuperas buena parte de ese 30 %.
- **Datos y cliente propios:** en Glovo/Uber el cliente es de la plataforma. En el canal propio
  el cliente, su histórico y su email son tuyos → CRM, fidelización, marketing directo.
- **Retención (moat):** "todo en Folvy = difícil que se vaya". El canal propio es el argumento de
  venta más fuerte y el más pegajoso (su web de pedidos vive en Folvy).
- **Reverso del riesgo competitivo:** si no se lo das tú, se lo da otro (Last ya tiene "tienda
  online"; ver §3). Es defensa, no solo ataque.

---

## 2. Mapa del mercado (jun 2026)

### Mundial / referentes
| Actor | Modelo | Fuerza | Hueco |
|---|---|---|---|
| **Olo** (US) | Enterprise, fulfillment+dispatch, guest engagement | El estándar de cadenas 50+ locales | Overkill y caro para SMB/dark kitchen |
| **ChowNow** (US) | Comisión 0 %, web+app "de marca", 20+ POS, "tus datos/clientes" | Posicionamiento DTC puro, ahorro de comisión medible | App "de marca" es plantilla; loyalty es add-on; **sin coste/margen ni inventario** |
| **Square / Toast Online Ordering** | DTC empaquetado con su POS, 0 % comisión | Cero fricción si ya usas su POS | Atado a su POS; no MRP/coste |
| **GloriaFood** (Oracle) | Web/app + pedidos **gratis**, sin comisión | Mass-market, gratis, setup en minutos | Básico; multimarca flojo; **sin coste/margen** |
| **UpMenu** | White-label web+app nativa, 0 % comisión, loyalty, dispatch | No-code, marca propia, 49–199 €/mes | Sin coste/margen/inventario |

### Europa
| Actor | Modelo | Fuerza | Hueco |
|---|---|---|---|
| **Flipdish** (IE, líder europeo) | Web+app+kiosko de marca, 0 % comisión, **automatización de marketing** (SMS/email/push), onboarding dedicado | El más fuerte de Europa en DTC + marketing; cuota plana | Precio no público; **sin coste/margen/inventario**; orientado a QSR/takeaway |
| **Slerp / Storekit** (UK) | DTC premium (Slerp) / low-cost (Storekit) | Estética y marca | UK-céntricos; sin coste/margen |
| **Deliverect Direct** | Webshop directo sobre su agregador | Si ya usas Deliverect | Compite contigo en gestión; sin escandallo |

### España
| Actor | Modelo | Fuerza | Hueco |
|---|---|---|---|
| **Last.app — Tienda online** | Web propia sin comisión, catálogo/horarios/disponibilidad **sincronizados con su TPV**, reparto propio o externo | **El incumbente de Llorente29**; ya lo ofrece | Es justo de lo que el cliente quiere salir (caro); sin MRP/coste profundo |
| **GloriaFood ES** (Oracle) | Web/Facebook/app gratis, app de marca, también TPV | Gratis, cero barrera | Básico; sin coste/margen |
| **Apperstreet** | Web + **CRM + QR pago en mesa + kiosko + marketing avanzado**, cuota única | Suite take-away/delivery con marketing fuerte | Sin escandallo/coste; no multimarca dark-kitchen profundo |
| **Gioeat / otros** | Web + dominio + carrito sin comisión + cupones | Barato, marca propia | Genéricos; sin operación de cocina |

### La pieza de reparto (fulfillment del canal propio)
- **Uber Direct** — DaaS de marca blanca: añade reparto a demanda a tu web/app; **paga por
  entrega, sin comisión ni mínimos**; integración por API; cliente y datos tuyos; radio ~local.
- **Glovo LAAS** — alquiler de la flota de Glovo (sandbox `laaspartners.testglovo.com`).
- **Catcher** — broker de reparto propio ya previsto en Folvy (`transportPrice` = coste real/pedido).
- **Stuart** — DaaS last-mile (ES fuerte).
- **Flota propia** — el repartidor del cliente.

> **Conclusión del mapa:** el DTC está maduro y commoditizado en lo básico (web de marca,
> 0 % comisión, app, cupones). Donde **todos** son flojos o nulos: **ligar el canal directo al
> coste real, el margen y el inventario.** Eso lo tienen los de back-of-house (R365/Apicbase),
> que a su vez **no tienen storefront**. Nadie junta las dos mitades.

---

## 3. Las dimensiones que importan (checklist de paridad)

Para no perder con el incumbente, Folvy Shop debe cubrir la base que ya es estándar:
storefront de **marca propia** (web responsive + dominio + opción app/PWA), **0 % comisión**,
**pasarela** integrada, **catálogo** sincronizado en tiempo real, **horarios/disponibilidad**,
**cupones/promos**, **CRM + marketing** (email/SMS/push), **QR pago en mesa / kiosko** (opcional),
**multimarca / multi-local**, **reparto** (propio + DaaS), **inyección a cocina (KDS)**.

La base es condición necesaria, no ventaja. La ventaja está en §4–§5.

---

## 4. El hueco que TODOS dejan (la tesis de Folvy)

Los del canal directo (ChowNow, Flipdish, Last tienda online, GloriaFood) saben tu **ingreso**
y tus **clientes**, pero **no saben tu coste ni tu margen ni tu inventario**. Su "ahorro" es
solo "no pagas comisión" — no te dicen cuánto ganas de verdad en cada plato.

Los del coste (R365, Apicbase) saben tu **coste**… pero **no tienen storefront**: no venden a tu
cliente final.

**Folvy es el único posicionado para tener las dos mitades**, porque el coste, el escandallo, el
consumo, el inventario y el catálogo canónico **ya están construidos**. Folvy Shop no es "otra
web de pedidos": es **el canal directo que conoce el margen real de cada pedido**.

---

## 5. Cómo golea Folvy (sus activos, no features nuevas)

1. **Margen real por pedido directo, en vivo.** Cada pedido del canal propio pasa por el motor de
   coste (escandallo) y la economía de plataformas: 0 % comisión − **coste real de reparto**
   (Catcher/Uber Direct `transportPrice`) − pasarela = **margen real**. Nadie en DTC lo hace.
   Mensaje de venta: *"tu canal propio, y ves lo que ganas de verdad en cada plato, frente a lo
   que te deja Glovo."*
2. **Un solo catálogo canónico.** Folvy Shop es **otro target de publicación** del MISMO
   `menu_item` que alimenta Glovo/Uber/KDS. Los demás te montan una carta aparte; aquí la carta
   es la misma, costeada, con foto y alérgenos ya cargados.
3. **El pedido entra por la ingesta canónica.** Un pedido del Shop es un `sale` más
   (`external_source='folvy_shop'`) → pega en KDS, **descuenta stock**, alimenta consumo/AvT e
   inventario. En los demás, el pedido directo es un silo que no toca tu food cost. Folvy **cierra
   el bucle**.
4. **Multimarca / multi-local nativo.** Dark kitchen DNA: el Shop sirve N marcas virtuales desde
   un local, cada una con su carta y su margen. Los DTC clásicos son mono-marca.
5. **Promos con margen y Ley Ómnibus.** Creas una oferta en el Shop, ves el **margen real
   ponderado** por mix, y cumples Ómnibus (precio sobre mínimo 30 días, técnica de artículo-espejo
   ya prevista). Nadie cierra este bucle.
6. **Reparto agnóstico con coste real.** Por el módulo de Integraciones eliges por pedido: flota
   propia / Catcher / Uber Direct / Glovo LAAS / Stuart — y el coste real entra al margen. No es
   "0 % comisión" de cartón: es economía honesta.

---

## 6. Arquitectura (encaje sin reescribir)

```
menu_item (catálogo canónico) ──publish──▶ Folvy Shop (storefront de marca, web/PWA, dominio)
                                                   │  cliente final pide + paga (pasarela)
                                                   ▼
                                   sale (external_source='folvy_shop')  ── ingesta canónica
                                                   │
                          ┌────────────────────────┼───────────────────────┐
                          ▼                         ▼                       ▼
                        KDS                 coste + consumo            fulfillment
                  (mismo tablero)        (margen real, stock)   (Integraciones: Uber Direct/
                                                                 Catcher/LAAS/Stuart/propia)
```

- **Storefront:** web/PWA de marca por cuenta×marca (dominio propio o subdominio
  `marca.folvy.shop`), responsive; reusa branding (`accounts.logo_url`, colores).
- **Catálogo:** publish del `menu_item` (ya tiene name/desc/category/photo/price/vat) → el Shop
  no mantiene carta aparte.
- **Pedido:** entra como `sale` canónico → KDS + coste + consumo + inventario (cero silo).
- **Pago:** pasarela (decisión §7).
- **Reparto:** `connector` de fulfillment (Uber Direct primero; Catcher ya en plan).

---

## 7. Pagos (decisión a cerrar)

- **Stripe** — el estándar SaaS, multi-tenant con **Connect** (cada cliente cobra en su cuenta,
  Folvy orquesta), SCA/PSD2 nativo, rápido de integrar. Recomendado para arrancar.
- **Redsys** — el de los bancos españoles, comisiones más bajas para el cliente pero integración
  más pesada y por banco. Opción "pro-cliente" a futuro.
- **Decisión propuesta:** Stripe Connect para el MVP (velocidad + multi-tenant limpio); Redsys
  como opción configurable después. **El dinero va a la cuenta del cliente, no a Folvy** (Folvy
  cobra suscripción, no se mete en el flujo de fondos salvo como facilitador).

---

## 8. Fases de construcción

- **S1 — Storefront MVP (pickup):** web/PWA de marca que lee el catálogo canónico, carrito,
  checkout con Stripe, pedido entra como `sale` `folvy_shop` → KDS. Sin reparto (solo recogida).
  **Medible:** un pedido real del Shop aparece en KDS y descuenta stock.
- **S2 — Reparto (Uber Direct):** conector de fulfillment; el pedido del Shop solicita repartidor;
  `transportPrice` al margen. **Medible:** un pedido a domicilio con coste real de reparto.
- **S3 — Margen real + promos:** panel de margen real del canal directo; cupones/ofertas con
  Ómnibus + margen ponderado.
- **S4 — CRM + marketing:** histórico de cliente, email/SMS/push, fidelización.
- **S5 — Multimarca/multi-local + dominio propio + SEO:** N marcas, dominio del cliente, SEO local.

> Cada fase = sistema usable solo. S1 ya vende (pickup) sin esperar al resto.

---

## 9. Riesgos / decisiones abiertas

- **Last ya tiene tienda online** (incumbente del cliente). Folvy no gana por "tenerla" sino por
  **el margen real + el bucle cerrado** (§5). Si solo igualamos, es empate → no vale.
- **Discoverability:** el canal propio NO trae demanda nueva como Glovo (que tiene tráfico). El
  cliente debe llevar a SU cliente (QR en local, redes, fidelización). Honesto: el Shop convierte
  clientes que YA tienes, no descubre nuevos. (Por eso CRM/marketing, S4, importa.)
- **Pasarela / flujo de fondos:** Stripe Connect (KYC del cliente, SCA). Folvy facilita, no
  custodia dinero.
- **Hosting del dominio / SEO:** subdominio `*.folvy.shop` rápido; dominio propio del cliente como
  opción (DNS).
- **Soporte al consumidor final:** un canal propio implica que el cliente del restaurante puede
  tener incidencias (pedido, pago, reparto) → definir quién atiende (el restaurante, no Folvy).

---

## 10. Scorecard (dónde estaría Folvy Shop)

| Dimensión | Mejor del mercado | Folvy Shop (objetivo) |
|---|---|---|
| Storefront de marca, 0 % comisión | ✅ (todos) | ✅ paridad |
| Datos/cliente propios + CRM | ✅ ChowNow/Flipdish | ✅ paridad |
| Marketing automation | ✅ Flipdish | 🟡 fase S4 |
| **Coste/margen real por pedido** | ❌ nadie | ✅ **golea** |
| **Catálogo único costeado (no carta aparte)** | ❌ nadie | ✅ **golea** |
| **Pedido cierra el bucle (KDS+stock+AvT)** | ❌ nadie | ✅ **golea** |
| Multimarca/dark kitchen | 🟡 parcial | ✅ nativo |
| Promo con margen + Ómnibus | ❌ nadie | ✅ **golea** |
| Reparto con coste real | 🟡 (DaaS sí, coste al margen no) | ✅ **golea** |
| Tráfico/discoverability propio | ❌ (ninguno lo da) | ❌ (honesto: lo trae el cliente) |

**Tesis:** igualamos la base, **goleamos en las 6 filas que ningún DTC tiene** porque vienen de
activos ya construidos (coste, catálogo canónico, pipeline de venta, multimarca, promos, reparto
con coste real). El canal propio de Folvy no es "otra web de pedidos": es **el único que sabe lo
que ganas**.

---

*Documento de estudio. Al aprobar el enfoque, versionar en `docs/` y abrir S1 (storefront MVP
pickup) con su RECON propio contra el catálogo canónico.*
