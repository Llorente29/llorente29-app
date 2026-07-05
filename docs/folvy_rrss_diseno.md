# Folvy — SISTEMA RRSS (agente de contenido) · Diseño formal aprobado
**v1 · 05/07/2026 · Estado: APROBADO por Julio, TR1 en construcción.**
Frente declarado 05/07. Laboratorio: Llorente29 con **UN perfil paraguas FOODINT** (IG + TikTok, "food hall virtual" que rota las marcas propias). Producto: **extra para TODOS los clientes de Folvy** — el núcleo es marca-agnóstico y red-agnóstico.

## Objetivo estratégico (Julio, innegociable)
**Tráfico al SHOP propio y captura de datos de cliente** — la estrategia para sobrevivir a las plataformas. Cada post lleva enlace al Shop con UTM → pedido → cliente identificado en el CRM → **margen real por publicación** (la frase que ningún gestor de RRSS del mundo puede escribir; el escandallo debajo lo hace posible).

## Decisiones de experto selladas (05/07)
- **Meta Shops (pestaña Tienda de FB/IG): NO en v1.** Diseñado para producto físico enviable; en Europa sin checkout nativo. El camino correcto para comida ya existe: **botón de acción "Pedir comida" del perfil → Shop**, link-in-bio, stickers de enlace en stories. El **catálogo de Meta** se reevalúa en la fase de Ads (anuncios con producto etiquetado) — RECON anotado, ni descartado ni prometido.
- **Fábrica de imágenes = escalera de 3 niveles con regla de oro: el PLATO es SIEMPRE la foto real** (verdad comercial: lo que se enseña es lo que llega; combustible verificado 05/07: 207/209 productos propios con foto, 99%):
  - **N1 (v1):** foto real + composición de marca (banda Foodint, precio/promo, 4:5 y 9:16). Render en casa (canvas+fuentes del agente residente, coste 0).
  - **N2 (v2, punto dulce):** IA que VISTE la foto — plato real como héroe, ambiente generado (fondo urbano, luz, neón). El "aire urbano fresco" sin plato falso. Proveedor de generación externo, SIEMPRE previsualización+confirmación, jamás autopublicado.
  - **N3 (experimento v3, nunca default):** personas. La IA-con-gente-comiendo cae en valle inquietante y Meta etiqueta contenido IA → la persona real comiendo la Scandal se consigue mejor con **UGC de bajo coste** (móvil, empleados, 10 min); IA-personas solo como experimento con A/B medido.
- **Cedidas JAMÁS en RRSS** (identidad del cedente). Solo marcas propias bajo el paraguas Foodint.

## Arquitectura (calcada del patrón que ya funciona en ofertas)
```
AGENTE social-agent (Edge + pg_cron diario, determinista y auditable)
  R1 anunciar promo activa del offers-agent ("30% en Meraki este finde" + foto de su
     estrella) — el post que se escribe solo; sinergia que nadie tiene
  R2 plato estrella rotando marcas (más vendido 7d de la marca con más días sin salir
     — rotación justa del food hall)
  R3 eventos (local_event: calor 37,7° → "día de no cocinar"; partido → plan sofá)
  Cupo 1 post/día/red · voz Foodint definida una vez (urbana, fresca, cero corporativa)
        │ propone (payload: copy + hashtags + imagen + enlace Shop con UTM + PORQUÉ)
        ▼
PANTALLA "Social" (Code): cola de propuestas con preview real → APRUEBAS 1 clic
  (editar copy/descartar; el porqué visible con mini-chips, patrón dashboard ofertas)
        │ aprobada → payload INMUTABLE (patrón promo_push_job)
        ▼
BRAZOS por red (colas claim/report):
  · Instagram Graph API (requiere app Meta aprobada — reloj externo)
  · TikTok Content Posting API (ídem)
  · MIENTRAS TANTO: "publicación asistida" — botón copiar copy + descargar imagen
    en cada propuesta aprobada = publicar a mano en 30 segundos. VALOR DESDE EL DÍA 1.
        ▼
MEDICIÓN: UTM → pedido en Shop → cliente en CRM → margen real por post
```

## Modelo BD (TR1, migración 20260705T2400)
- **social_account**: cuenta Folvy × red (network: instagram|tiktok|facebook) + handle + estado del enlace (unlinked|linked|error) + config jsonb (tokens SIEMPRE en Vault, jamás en tabla) + is_active. Multi-tenant por account_id, RLS de la casa.
- **social_post**: estado draft(propuesta del agente)|approved|scheduled|published|discarded|error · payload jsonb INMUTABLE al aprobar (copy, hashtags, image_url, link con UTM, brand_id protagonista) · reason (el porqué del agente, auditable) · network target · scheduled_at/published_at · external_ref (id del post en la red) · attempts/last_error (patrón cola).
- Índices de rotación justa (última publicación por marca) y de cupo (posts/día/red).

## Tramos
| Tramo | Qué | Estado |
|---|---|---|
| TR1 | Núcleo BD + agente social-agent + cron diario | EN CONSTRUCCIÓN (05/07) |
| TR1b | Pantalla "Social" (encargo Code) con publicación asistida | tras TR1 |
| TR2 | Brazo Instagram (Graph API) | bloqueado por app Meta (deberes Julio: FB page Foodint + IG profesional; luego trámite instagram_content_publish) |
| TR3 | Brazo TikTok (Content Posting) | bloqueado por TikTok Business + app |
| TR4 | Imágenes N1 (composición de marca en casa) | tras TR1b |
| TR5 | Medición UTM→Shop→margen por post | tras primer post real |
| v2 | Imágenes N2 (IA viste la foto) + catálogo Meta para Ads | diseñados, no comprometidos |

## Guardarraíles
- Modo b SIEMPRE en v1: nada se publica sin aprobación humana (ni con brazos API vivos, hasta que Julio suba la autonomía).
- Anti-invención: el agente solo habla de lo que existe (promos reales, platos reales, precios reales del catálogo).
- Regla de oro de imagen: el plato mostrado = foto real del plato vendido.
- Cedidas jamás. Tokens en Vault. Cupo duro por día.
