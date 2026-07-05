# ENCARGO_CODE — Pantalla de Ofertas: honestidad de acciones por canal + badge del agente
**Fecha:** 05/07/2026 · **Origen:** sesión Chat (frente motor de ofertas) · **Prioridad:** media (deuda de pantalla, no bloquea nada)

## Contexto (verificado hoy contra la plataforma real)
1. **Glovo NO tiene pausar/reanudar.** El detalle de una promo en el panel de Glovo solo ofrece "✕ Cancelar", y su modal avisa textual: *"Tras la cancelación, no será posible la reactivación."* El robot v3.15 ya reporta `pause`/`resume` como no soportados con mensaje claro — pero **la pantalla sigue ofreciendo los botones**, y encolar un job imposible es mentir al usuario.
2. Las campañas creadas por el agente (`coupon.origin='agent'`, `active=false`) se muestran hoy con el chip **"Borrador"** — indistinguibles de un borrador humano. Deben verse como **"Propuesta del agente"**, con su razonamiento a un clic (vive en `coupon.omnibus_ref_note`, formato `"Agente YYYY-MM-DD: <razón>"`).

## Ficheros a tocar (leer los ORIGINALES antes; nunca regenerar `database.ts` — casts puntuales como hasta ahora)
- `src/modules/kitchen/pages/PlatformOffersPage.tsx`
- `src/modules/kitchen/services/platformOffersService.ts` (solo si la pieza 3 lo requiere)

## Pieza 1 — Ocultar Pausar/Reanudar cuando el canal es Glovo
En la tabla de campañas (bloque de acciones, ~L355-375: los botones `pauseCampaign`/`resumeCampaign` con iconos `Pause`/`Play`):
- Si la campaña tiene canal **glovo** (`c.channel === 'glovo'` o equivalente del tipo de fila): **NO renderizar** Pausar ni Reanudar. Solo Finalizar.
- Si el canal es **uber**: dejarlos como están (la API de Uber v1 del brazo tampoco los soporta aún, pero la plataforma sí permite reconstruirlos vía revoke+create → se decidirá aparte; NO tocar Uber en este encargo).
- El estado `pausada` en una campaña glovo no debería poder existir tras esto; no hace falta migrar datos (no hay ninguna pausada de glovo en producción — verificado hoy).

## Pieza 2 — Finalizar en Glovo = confirmación con la verdad
El botón **Finalizar** de una campaña glovo debe pedir confirmación con `ConfirmDialog` de Folvy (**NUNCA `window.confirm`** — regla de la casa) con este copy exacto o muy cercano:
> **Finalizar campaña en Glovo**
> Glovo cancelará la promoción en todos los establecimientos. **Esta acción es irreversible: Glovo no permite reactivar una promoción cancelada.** Para volver a ofrecerla habrá que crear una campaña nueva.
Para Uber, Finalizar puede mantener el comportamiento actual (o el mismo diálogo con copy genérico, a criterio).

## Pieza 3 — Chip "Propuesta del agente"
En `STATUS_META` / derivación de estado (~L54-60):
- Nueva variante visual para `origin === 'agent' && status === 'borrador'` → label **"Propuesta del agente"**, con estilo propio distinguible (sugerencia: fondo `bg-accent/10 text-accent border-accent/30` o el token equivalente del sistema — que se vea que lo propuso la máquina).
- Al lado del chip (o en tooltip/`title`), el **porqué**: parsear `omnibus_ref_note` quitando el prefijo `"Agente YYYY-MM-DD: "` y mostrar la razón (ej. *"RECUPERACIÓN: 2.3 ped/día = 76% del pico…"*). Si la nota no casa el formato, mostrarla tal cual. El razonamiento auditable a la vista es parte del contrato del agente (§4 del informe comercial).
- Los borradores humanos (`origin !== 'agent'`) siguen como "Borrador".

## Qué NO tocar
- El motor (`place_shop_order`, cupones, `promo_push_job`): este encargo es SOLO de presentación y confirmación.
- `endCampaign`/`pauseCampaign` del servicio: siguen igual (la pieza 1 es de render).
- Nada de Uber más allá de lo dicho.

## Verificación (antes de dar por cerrado)
1. `npm run build` verde.
2. En la pantalla, una campaña glovo publicada muestra SOLO Finalizar; una de uber muestra las tres.
3. Finalizar en glovo abre el ConfirmDialog con el aviso de irreversibilidad; confirmar encola el job `end` (verificar en BD: fila nueva en `promo_push_job` action='end' platform='glovo'... **ojo: el CHECK de platform es 'glovo'/'ubereats'**).
4. Una propuesta del agente (hay ejemplos vivos en la cuenta Foodint `51ad1792-...`) muestra el chip "Propuesta del agente" + su razón; un borrador humano sigue diciendo "Borrador".
5. Commit con mensaje descriptivo + push (rev-list 0 0).
