# Folvy — Estrategia de capa de delivery (ingesta de pedidos + publicación de catálogo)

**Fecha:** 10 jun 2026
**Estado:** DECISIÓN estratégica + research de mercado a fondo. Correo de partnership a Otter ENVIADO. NADA construido aún.
**Conecta con:** `folvy_ingesta_canonica_diseno.md` (cualquier proveedor entra como adaptador `external_source` sobre el núcleo canónico) y `folvy_economia_plataformas_diseno.md` (liquidación/márgenes del canal).

---

## 0. Por qué esto es URGENTE (no a medio plazo) — corrección de enfoque del 10/06

Durante toda la vida del proyecto se trató "integrar Glovo/Uber directo" como visión lejana. **Julio lo corrigió con razón:** ya se está pagando el coste de NO tenerlo.

- **Llorente29 quiere dejar Last.** Last es caro (>600 € solo por la capa de integración, encima de Folvy). El cliente rechaza esa dependencia.
- **Riesgo competitivo existencial:** si Folvy depende de Last para el delivery, un competidor que ofrezca "delivery integrado incluido en el precio" tiene un argumento directo para llevarse a Llorente29. El flanco está abierto justo por donde más duele.
- **Es el reverso de la tesis de retención:** "todo en Folvy = difícil que se vaya" implica que "el delivery en Last = fácil que se vaya". La integración propia de delivery es **defensa a corto plazo + argumento de venta + retención (moat)**.
- **Glovo es INNEGOCIABLE:** >50% de los pedidos en España pasan por Glovo. Una solución sin Glovo no es solución.
- **Demanda inmediata:** Llorente29 migraría mañana mismo; hay un 2º cliente ya en Otter; más operadores multimarca en cartera.

**Las tres capas, en orden (decisión Julio):**
1. **Vía TPV (Last) — AHORA.** Lo inmediato; Glovo entra hoy vía Last (imperfecto pero funciona). No se abandona hasta tener sustituto.
2. **Delivery propio de Folvy vía marca blanca — el frente.** Que el cliente vea solo Folvy; por debajo, un integrador. Resuelve coste + independencia de Last + retención.
3. **Directo con plataforma (Glovo/Uber) → TPV propio — el destino.** Máxima independencia, a largo plazo.

---

## 1. El research: el mapa real del mercado (España, jun 2026)

**El patrón descubierto (y verificado):** en España, quien tiene **Glovo funcionando hoy** tiende a ser un **competidor de gestión** de Folvy; quien es **infraestructura limpia que no compite** **no tiene Glovo España**. Razón estructural: desde que Delivery Hero compró Glovo, **Glovo cobra por su API** — coste que solo los grandes (plataformas de gestión) han amortizado, y para ellos el delivery es el gancho para venderte TODO su sistema (que compite contigo).

| Proveedor | Glovo ES hoy | Modelo | ¿Compite con Folvy? | Veredicto |
|---|---|---|---|---|
| **Otter** | ✅ (verificado, pantalla de conexión real) | gestor de DELIVERY (pedidos+menús+analítica) + API de partner | **NO** (Otter=delivery; Folvy=cocina/coste/MRP) | **🟢 LÍDER** |
| **HubRise** | ❌ (Italia/Marruecos sí; ES en negociación, sin fecha; coste API Glovo 5-15€/conexión que ellos mismos dudan) | infraestructura pura, white-label/reseller (−28,6% desde 6ª cuenta, hasta 10€/location) | NO | 🟡 limpio pero sin Glovo |
| **Deliverect** | ✅ | plataforma grande, hace gestión | **Sí, en parte** | 🟠 caro + solapa |
| **GrubTech** | ✅ | plataforma gestión dark-kitchen (previsión, inventario, KDS) | **Sí, directo** | 🔴 rival |
| **Ordatic** | ✅ (era español, delivery-focused) | **aliado/absorbido por GrubTech** (jul 2025) | sí (vía GrubTech) | 🔴 ya no neutral |
| **KitchenHub** | ❌ (no se ve Glovo) | white-label resellers, "una API", barato | NO | 🟡 sin Glovo |
| **GetOrder** | ⚠️ (lo lista, pero web autogenerada: "no garantiza disponibilidad") | API "conecta cualquier cosa a tu POS" | NO | ⚪ sin verificar |
| **Glovo directo (DH API)** | ⏳ en cola | el ideal: integrador directo, sin margen de intermediario | — | 🟢 destino, sin fecha |

---

## 2. Otter — el candidato líder (verificado con cuenta real de cliente)

**Qué hace en España (NO es competidor de Folvy):** Order Manager (consolida pedidos de Glovo/Uber/JustEat en una tablet) + Business Manager (analítica de ventas por marca/canal) + gestión de menús en plataformas + marcas virtuales. **NO hace** escandallo, coste por ingrediente, inventario perpetuo, MRP, compras, APPCC — el núcleo de Folvy. **Son complementarios:** Otter mira el delivery desde fuera; Folvy la cocina desde dentro.

**Verificado con capturas de una cuenta de cliente real (no Llorente29):**
- Pedidos reales entrando de Uber Eats con marca, canal, tienda, subtotal, descuentos, **descuento de plataforma**, tarifa de servicio, e **"Injection Status"** (inyección a sistema externo).
- Menús por marca con "Menu sync status" (sincronización con plataformas).
- **Pantalla de conexión a Glovo** ("Conectando a Otter con Glovo", pide credenciales de Glovo Partners) → **Glovo España confirmado, funcionando.**
- Modelo de conexión por credenciales del cliente (como Last).

**API de partner (developer-guides.tryotter.com) — dominios:** Orders (consumer + provider, ciclo de vida completo), Menus + Menus Manager (publicar, disponibilidad, horarios, sync bidireccional), Finance (transacciones), Reports (pedidos, items, payouts, ratings), Storefront (disponibilidad, pausar), Reviews, Direct Order, Organization/Store/Account Pairing. OpenAPI Reference formal disponible. Todo bajo "Partner Resource Center / About Partnership Program".

**Hasta dónde llega (la clave para "camuflar bajo Folvy"):** con esa API, Folvy podría recibir todos los pedidos (Glovo incl.), publicar/mantener catálogo, tirar finanzas/reports/reviews y controlar disponibilidad — **sin que el usuario vea Otter jamás**. Otter como motor invisible, Folvy como única cara. Técnicamente viable y profundo.

**Por qué gana a los demás:** único que junta Glovo España ✅ + no compite ✅ + API de partner completa ✅ + camuflable ✅. HubRise no tiene Glovo; GrubTech/Deliverect/Ordatic compiten.

**Pendiente de confirmar (solo hablando con Otter — correo enviado):**
1. ¿Modelo reseller white-label TOTAL (Folvy crea/gestiona cuentas, cliente no ve Otter)?
2. ¿La API de partner permite operar cuentas de cliente por completo de forma invisible?
3. Economía del partner (por location/marca/pedido/revenue share) — decide si es sano para el cliente.
4. Cobertura confirmada Glovo+Uber+JustEat ES (ingesta + push de catálogo).
5. Migración sin disrupción desde otro POS.

**NOTA sobre la vía "atacar la API directamente":** descartada. La API de partner exige onboarding de aplicación (no se accede con credenciales del cliente a pelo); hacerlo por vías no oficiales violaría términos, sería frágil y quemaría el partnership antes de empezar. El cliente ya-en-Otter es la **carta de tracción** dentro del programa oficial, no un atajo.

---

## 3. Decisión y plan por capas

- **Cimiento (ya diseñado hoy):** ingesta canónica — cualquier proveedor es un adaptador `external_source` sobre el núcleo. Esto hace que la elección de proveedor NO ate la arquitectura: Otter, HubRise, Glovo directo o TPV propio entran igual.
- **Movimiento inmediato:** esperar respuesta de Otter al correo de partnership. Si encaja → estudiar su OpenAPI Reference y construir el adaptador `otter` (resuelve Glovo + las 3 plataformas + camuflado). 
- **Si Otter no encaja** (economía o white-label insuficiente): HubRise para Uber+JustEat (limpio) + presionar/esperar Glovo directo (DH API). Mixto sano solo si NO apila dos márgenes de pago para el cliente.
- **Destino:** Glovo directo (ya en cola de la DH API; requisitos: partner activo + CC a su Account Manager + revisar doc DH API) → TPV propio. Cada uno, un adaptador más.

**Regla económica innegociable (Julio):** no repercutir al cliente dos suscripciones apiladas (marca blanca + un segundo solo-Glovo) — eso mata la competitividad. Un proveedor que cubra las 3 plataformas (Otter) o el directo sin intermediario son las vías sanas; "marca blanca + solo-Glovo aparte" NO.

---

## 4. Estado de Glovo directo (DH API) — para retomar

Glovo respondió a la solicitud de integración directa (Gabriela Vega, Glovo Integrations):
- Glovo está migrando de su API legacy a la **DH API** (Delivery Hero); pausan nuevos inicios en la legacy.
- Recomiendan desarrollar directo contra la **DH API** (`integration-middleware.stg.restaurant-partners.com/apidocs/pos-middleware-api`) para feature-parity y no rehacer.
- **Requisitos para entrar al backlog:** (1) lista de partners y países; (2) confirmar que se ha revisado la doc DH API; (3) **CC al Account Manager de Glovo del partner activo** (requiere coordinar con el cliente — p. ej. Llorente29 y su AM — con su permiso).
- Sin fecha oficial de lanzamiento. Estado: "esperando cliente".

---

## 5. Resumen para decisión rápida

**El problema:** dar Glovo (>50%) a clientes de Folvy sin depender de Last (caro, cliente quiere salir) ni de un competidor, de forma camuflada (cliente ve solo Folvy).

**La respuesta:** **Otter** es el mejor candidato (Glovo ES + no compite + API camuflable). Correo enviado. Si su partnership encaja en economía y white-label, es la vía. Plan B: HubRise (sin Glovo) + Glovo directo (en cola). Todo entra como adaptador sobre la ingesta canónica ya diseñada.

*Documento de estrategia. Research de mercado a fondo, verificado con fuentes y capturas reales. Próximo paso: respuesta de Otter.*
