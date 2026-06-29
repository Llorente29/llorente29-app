# B3 — Contrato de ejecución del agente (diseño técnico)

> La pieza que convierte el agente de "informa" a "actúa y ejecuta". Patrón
> **propose → confirm → execute** con autonomía graduada (L0/L1/L2). Es del MARCO:
> todas las write tools de todos los agentes lo usan.
>
> Hallazgos del RECON que lo simplifican:
> - `menu_item.ai_suggested_price` ya existe → el agente propone sin tocar el PVP real.
> - `computeEngineering` ya calcula el upside `(newMargin−currentMargin)×unitsSold` →
>   el "efecto" de la tarjeta es real, el mismo de Ingeniería de menús.
> - `classify_unmapped_product` con `needs_target` + `modifier_recipe_impact` con
>   `proposed→confirmed` son patrones de confirmación ya probados a calcar.
>
> Para aprobar antes de tocar BBDD.

---

## 1. Tabla `ai_action` — el libro mayor de lo que el agente hace

Por cuenta, con ciclo de vida y rollback. Calca RLS de `ai_interaction`.

```sql
create table ai_action (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id),
  agent           text not null,              -- 'kitchen' | 'team' | ...
  tool_name       text not null,              -- 'reprice_menu_item' | ...
  risk            text not null check (risk in ('L0','L1','L2')),
  status          text not null default 'proposed'
                  check (status in ('proposed','confirmed','executed','rejected','failed','rolled_back')),
  summary         text not null,              -- "Subir PVP de Birria de 8,50 a 9,90"
  target_table    text,                       -- 'menu_item'
  target_id       uuid,                       -- id del objeto afectado
  args            jsonb not null,             -- args de ejecución
  effect_preview  jsonb,                      -- {margin_before, margin_after, upside_month}
  result          jsonb,                      -- lo que devolvió la ejecución
  rollback_hint   jsonb,                      -- cómo revertir (p.ej. {price: 8.50})
  proposed_by     uuid,                       -- user_id que abrió el chat
  confirmed_by    uuid,                       -- user_id que pulsó Confirmar
  session_id      uuid,                       -- liga al turno de ai_interaction
  created_at      timestamptz default now(),
  confirmed_at    timestamptz,
  executed_at     timestamptz
);

-- RLS calcada de ai_interaction: lectura miembros de la cuenta, escritura admins.
alter table ai_action enable row level security;
create policy ai_action_read on ai_action for select
  using (is_member_of_account(account_id));     -- (helper existente)
-- escritura solo vía RPC SECURITY DEFINER (no INSERT directo del cliente).
```

---

## 2. El ciclo propose → confirm → execute

**Paso 1 — PROPONER (el agente, dentro del edge).**
Una write tool NO escribe el dato de negocio. Calcula el efecto, inserta una fila en
`ai_action` con `status='proposed'`, y devuelve al modelo el sobre:
```json
{ "status": "pending_confirmation", "action_id": "...", "risk": "L1",
  "summary": "Subir PVP de 'Birria' de 8,50€ a 9,90€",
  "effect": { "margin_before": 1.20, "margin_after": 2.60, "upside_month": 340 },
  "editable": { "price": 9.90 }, "rollback": "Volver a 8,50€" }
```
El modelo lo verbaliza + el front renderiza la **tarjeta de acción**.

**Paso 2 — CONFIRMAR (el humano, en el front).**
La tarjeta muestra efecto + [Confirmar] [Ajustar] [Cancelar].
- **Ajustar**: el usuario cambia el precio → se recalcula el efecto en vivo (llamada
  de preview, sin escribir).
- **Cancelar**: `ai_action.status='rejected'`.
- **Confirmar**: llama la RPC `commit_ai_action(action_id, edited_args?)`.

**Paso 3 — EJECUTAR (RPC `commit_ai_action`, SECURITY DEFINER).**
- Verifica que la acción existe, es `proposed`, y es de la cuenta del usuario.
- Aplica `edited_args` si los hay (Return of Control).
- Ejecuta la escritura real (UPDATE menu_item, o la RPC correspondiente) **con la
  identidad del usuario** (la RPC corre con auth.uid() del que confirma → RLS/permiso).
- Marca `status='executed'`, guarda `result`, `confirmed_by`, `executed_at`.
- Si falla → `status='failed'` + error en `result`. Nunca deja a medias.

**Autonomía graduada:**
- **L0** (marcar revisado, recostear): la write tool ejecuta directa y registra
  `ai_action` con `status='executed'` de una vez (sin tarjeta). Audita, no frena.
- **L1** (reprice, vincular, sustituir): tarjeta de confirmación. El 90% de casos.
- **L2** (86 multi-plataforma, archivar, masivo): tarjeta + confirmación reforzada
  (el usuario teclea/marca el alcance).

El nivel lo declara cada tool. Configurable por cliente después (Fase B).

---

## 3. Primera write tool: `reprice_menu_item` (L1)

La estrella, y la que valida todo el contrato. Reutiliza piezas existentes:

```
reprice_menu_item(menu_item_id, new_price)  [propose]
  1. lee economía actual (menu_item_economics): price, cost, contributionMargin, unitsSold
  2. calcula newMargin con el new_price (misma lógica que computeEngineering)
  3. upside_month = (newMargin − currentMargin) × unitsSold
  4. inserta ai_action(proposed, risk=L1, effect_preview={...}, rollback={price: old})
  5. devuelve el sobre pending_confirmation
```
Al confirmar → `commit_ai_action` hace `updateMenuItem(id, { price: new_price })`.

**Por qué esta primera:** es el caso que el agente YA propuso en vivo ("¿subimos la
birria?"), es L1 reversible (rollback = volver al precio viejo), y el efecto es real
(reutiliza el upside de Ingeniería). Una sola tool valida: propose, tarjeta, ajustar,
confirm, execute, audit, rollback. Las demás write tools son repetir el patrón.

---

## 4. Segunda write tool (para la birria concreta): `assign_resale_cost` (L1)

El agente detectó la birria sin coste. Esta tool cierra ESE hueco:
```
assign_resale_cost(product_name, unit_cost)  [propose]
  → preview: "convertir QUESATACOS DE BIRRIA en reventa con coste 2,30€/ud,
              propaga a N marcas" (lee de classify_unmapped_product dry-run si existe,
              o calcula el alcance)
  confirm → classify_unmapped_product(account, name, 'resale', unit_cost)
```
Aprovecha el `needs_target` nativo: si el producto no resuelve solo, la tarjeta
muestra los candidatos y el humano elige (Return of Control puro).

---

## 5. Orden de construcción de B3

1. **Migración `ai_action`** + RPC `commit_ai_action(action_id, edited_args)` +
   RPC `propose_ai_action(...)` (o el insert lo hace el edge). SQL.
2. **Tool `reprice_menu_item`** en el edge (propose) + cableado a `commit_ai_action`.
3. **Tarjeta de acción** en el front (componente nuevo: efecto + Confirmar/Ajustar/
   Cancelar). Conecta con el stream del agente.
4. **Probar end-to-end**: "sube la birria a 9,90€" → tarjeta → confirmar → precio
   cambiado + fila en ai_action executed.
5. **Tool `assign_resale_cost`** (repite patrón) → cerrar el hueco real de la birria.

---

## 6. Decisiones para ti

1. **¿Apruebas el esquema `ai_action`** y el ciclo propose→confirm→execute con RPC
   `commit_ai_action`?
2. **La RPC `commit_ai_action` corre como SECURITY DEFINER** pero ejecuta con la
   identidad del que confirma (para que RLS/permisos apliquen). ¿OK, o prefieres que
   la ejecución la haga el front directamente con el servicio (updateMenuItem) tras
   confirmar? — Mi recomendación: RPC, porque centraliza el audit y el rollback en un
   sitio y sirve a todos los agentes. Pero el front-directo es más simple para v1.
3. **¿Primera tool = `reprice_menu_item`** (valida el contrato entero) y luego
   `assign_resale_cost` (cierra el hueco de la birria que el agente ya detectó)? ¿O al
   revés?
