// supabase/functions/folvy-ai/index.ts
//
// FOLVY AI — Edge Function orquestadora (v2 con streaming).
// Plataforma común para chat flotante + AICards de cada módulo.
//
// MODOS:
// - Legacy (sin stream:true en body): responde JSON al final, igual que v1.
//   Para invocaciones desde el dashboard, AICards síncronas, o tests.
// - Streaming (stream:true): responde SSE, chunk a chunk. Eventos:
//   {type:'text',content}|{type:'tool_start',name}|{type:'tool_end',name}|
//   {type:'action_proposed',action_id,tool,risk,summary,effect}|
//   {type:'done',session_id,usage}|{type:'error',message}
// - Opening (surface:'opening'): saludo proactivo, inyecta instrucción
//   especial al system prompt y manda mensaje sintético "saluda".
//
// Auth: JWT del usuario. RLS aplica al leer datos.

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2048;
const MAX_TOOL_LOOPS = 5;

// ── MARCO MULTI-AGENTE ────────────────────────────────────────────────
//
// El system prompt se compone: BASE (común a todos los agentes) + PERSONA del
// agente activo (según `module`) + contexto de pantalla + memoria.
// Añadir un agente nuevo = añadir su entrada en AGENTS (persona + tools).

const SYSTEM_PROMPT_BASE = `Eres Folvy AI, el copiloto de Folvy: la plataforma operativa para hostelería (restaurantes, bares, cadenas, cocinas, delivery).

VOZ:
- Profesional pero cercana. Tuteas. Frases cortas. Habla en español.
- Termina con una propuesta de acción cuando tiene sentido ("¿Empezamos por...?", "¿Te paso el listado?").
- No usas emojis en el cuerpo del mensaje.
- Suenas como un socio que sabe del negocio, no como un chatbot ni un consultor.
- Puedes usar markdown ligero: **negrita** para datos clave, listas numeradas. NO uses títulos (# ##).

PRINCIPIOS:
- NUNCA inventas datos. Si no tienes el dato, dilo: "No tengo ese dato".
- NUNCA actúas sin confirmación cuando la acción cambia datos de negocio. Las acciones que escriben pasan SIEMPRE por una propuesta que el usuario confirma; tú nunca das por hecha una acción que no se ha confirmado.
- Solo respondes sobre Folvy y el negocio del cliente. No eres ChatGPT general.
- Respetas los permisos del usuario: si una tool falla por permisos, NO inventas la respuesta, explicas que no tienes acceso.
- Si una tool devuelve datos vacíos o data_access='empty_or_forbidden', NO especules sobre la causa. Limítate a decir: "No veo movimientos en tu cuenta — puede ser que esté vacía o que no tenga permiso para leerla. ¿Has subido ya datos?".
- NUNCA menciones por nombre productos, integraciones, canales o funcionalidades que no aparezcan literalmente en los datos consultados o en este prompt. Si dudas de si algo existe en Folvy, pregunta al usuario en lugar de afirmarlo.

{{AGENT_PERSONA}}

CONTEXTO DE LA PANTALLA:
{{SURFACE_CONTEXT}}

MEMORIA RELEVANTE DE ESTA CUENTA:
{{MEMORY_CONTEXT}}

Cuando necesites datos del negocio, usa las tools disponibles. No respondas con datos inventados.`;

// Persona por defecto (chat global sin módulo): generalista de Folvy.
const PERSONA_DEFAULT = `Eres el copiloto general de Folvy. Ayudas al usuario a entender el estado de su negocio y le diriges al módulo adecuado.`;

// Persona del agente de Kitchen: experto en escandallo, coste y margen.
const PERSONA_KITCHEN = `Eres el copiloto de COCINA de Folvy (Folvy Kitchen). Tu especialidad es el escandallo, el coste por plato, el margen, el food cost y la salud de la carta. Tu trabajo es PROTEGER EL MARGEN del cliente. Hablas el lenguaje de un jefe de cocina que también entiende de números. Cuando detectes un plato con mal margen, un ingrediente que sube de precio, o un escandallo sin terminar, dilo con su impacto en euros y propón la acción concreta.

PUEDES ACTUAR, no solo informar. Tienes herramientas que PROPONEN cambios reales (por ejemplo, asignar el coste a un producto que se vende sin coste). Cuando el usuario acepte que hagas algo ("sí", "hazlo", "asígnalo"), usa la herramienta correspondiente: esta NO ejecuta el cambio directamente, sino que registra una propuesta que el usuario confirmará con un botón. Tras llamar a una herramienta de acción, di con naturalidad que has preparado la propuesta y que la confirme cuando quiera. NUNCA afirmes que un cambio ya se ha aplicado: solo se aplica cuando el usuario confirma.`;

// Persona del agente de Supply: experto en COMPRAS y ALMACÉN (todo el módulo).
const PERSONA_SUPPLY = `Eres el copiloto de COMPRAS Y ALMACÉN de Folvy (Folvy Supply). Tu especialidad es el aprovisionamiento (pedidos a proveedores, formatos y precios de compra), el stock y el inventario (niveles mínimo/par, bajo mínimo, mermas, teórico vs real) y la recepción. Tu trabajo es que al cliente NUNCA le falte género ni tenga dinero parado de más en cámara. Hablas como un jefe de compras que entiende de coste.

Cuando el usuario pregunte qué pedir, usa purchase_suggestion (el motor calcula cuánto pedir para cubrir la semana, redondeado al formato de compra, con su fuente: por consumo real, por histórico de pedidos, o por par fijo). Cuando pregunte cómo va el almacén o qué le falta, usa stock_health y low_stock. Para explicar una sugerencia, usa item_consumption. Da siempre la cifra concreta y, si procede, su impacto. Si el motor marca una sugerencia como "por histórico", recuerda que es un proxy (confianza media); si es "por consumo", es dato real (alta). Si un artículo no tiene señal, dilo con honestidad ("no tengo consumo ni histórico para este artículo"), no inventes una cantidad.

PUEDES ACTUAR, no solo informar. Con generate_purchase_order PREPARAS un pedido completo desde la sugerencia: la herramienta NO crea el pedido, registra una propuesta que el usuario confirma con un botón. Úsala cuando el usuario quiera generar/preparar el pedido de un proveedor. Tras llamarla, di con naturalidad que has dejado la propuesta lista para confirmar; NUNCA afirmes que el pedido ya está creado.`;

const OPENING_INSTRUCTION = `\n\nMODO SALUDO DE APERTURA:
El usuario acaba de abrir el chat. Tu primer mensaje es el saludo de bienvenida.
- Llama a catalog_health para conocer el estado actual de la carta del cliente.
- Saluda al usuario por su nombre si lo conoces (te lo da el contexto).
- Resume en UNA FRASE el dato más importante de su estado.
- Termina con UNA propuesta concreta de acción.
- Sé directo, NO recites todos los datos.`;

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

interface ToolContext {
  accountId: string;
  userJwt: string;
  supabaseUrl: string;
  anonKey: string;
}

function clientWithUserJwt(ctx: ToolContext) {
  return createClient(ctx.supabaseUrl, ctx.anonKey, {
    global: { headers: { Authorization: `Bearer ${ctx.userJwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const TOOL_CATALOG_HEALTH: ToolDef = {
  name: 'catalog_health',
  description:
    'Devuelve la salud actual de la carta del cliente: porcentaje de facturación ' +
    'con economía conocida, número de productos sin coste, y los top 5 productos ' +
    'vendidos sin mapear ordenados por su impacto económico. Usa esta tool cuando ' +
    'el usuario pregunte por el estado de su carta, qué falta por mapear, o cuánto ' +
    'controla de su negocio. El campo data_access indica si los datos son observables: ' +
    "'ok' si hay actividad real en la cuenta, 'empty_or_forbidden' si todo viene vacío " +
    'y no se puede distinguir si la cuenta está vacía o el permiso es insuficiente.',
  input_schema: {
    type: 'object',
    properties: {
      brand_id: {
        type: 'string',
        description: 'Opcional. UUID de la marca para filtrar.',
      },
    },
    required: [],
  },
  handler: async (args, ctx) => {
    const sb = clientWithUserJwt(ctx);
    const brandId = (args.brand_id as string | undefined) ?? null;

    const { data: lines, error: linesErr } = await sb
      .from('sale_line')
      .select('quantity, unit_price, menu_item_id, sale:sale_id(brand_id)')
      .eq('account_id', ctx.accountId);
    if (linesErr) throw new Error(`No pude leer ventas: ${linesErr.message}`);

    const filtered = brandId
      ? (lines ?? []).filter((l: any) => l.sale?.brand_id === brandId)
      : (lines ?? []);

    let totalRevenue = 0, mappedRevenue = 0;
    for (const l of filtered as any[]) {
      const rev = Number(l.quantity ?? 0) * Number(l.unit_price ?? 0);
      totalRevenue += rev;
      if (l.menu_item_id) mappedRevenue += rev;
    }

    const { data: unmapped, error: unErr } = await sb
      .from('sale_line')
      .select('product_name, quantity, unit_price, sale:sale_id(brand_id)')
      .eq('account_id', ctx.accountId)
      .is('menu_item_id', null);
    if (unErr) throw new Error(`No pude leer ventas sin mapear: ${unErr.message}`);

    const unmappedByProduct = new Map<string, number>();
    for (const l of (unmapped ?? []) as any[]) {
      if (brandId && l.sale?.brand_id !== brandId) continue;
      const rev = Number(l.quantity ?? 0) * Number(l.unit_price ?? 0);
      unmappedByProduct.set(l.product_name, (unmappedByProduct.get(l.product_name) ?? 0) + rev);
    }
    const top5 = [...unmappedByProduct.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, revenue]) => ({ name, revenue: Math.round(revenue * 100) / 100 }));

    const { count: itemsSinCoste } = await sb
      .from('menu_item')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .is('consumption_price', null)
      .is('archived_at', null);

    const pctEconomiaConocida = totalRevenue > 0
      ? Math.round((mappedRevenue / totalRevenue) * 1000) / 10
      : 0;

    // Diagnóstico de acceso a datos: si TODO viene vacío a la vez
    // (no hay sale_line ni menu_items activos), marcamos la duda
    // para que la IA NO especule sobre causas.
    const totalSaleLines = (lines ?? []).length;
    const dataAccess = (totalSaleLines === 0 && (itemsSinCoste ?? 0) === 0)
      ? 'empty_or_forbidden'
      : 'ok';

    return {
      data_access: dataAccess,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      mapped_revenue: Math.round(mappedRevenue * 100) / 100,
      unmapped_revenue: Math.round((totalRevenue - mappedRevenue) * 100) / 100,
      pct_economia_conocida: pctEconomiaConocida,
      menu_items_sin_coste: itemsSinCoste ?? 0,
      top_5_unmapped: top5,
    };
  },
};

// ── WRITE TOOLS (contrato de ejecución: PROPONEN, no ejecutan) ─────────
// Una write tool nunca escribe el dato de negocio. Calcula el efecto, registra
// la propuesta vía propose_ai_action (status='proposed') y devuelve el sobre
// pending_confirmation. El front muestra la tarjeta; al confirmar, el front
// llama commit_ai_action(action_id), que ejecuta de verdad.

const TOOL_ASSIGN_RESALE_COST: ToolDef = {
  name: 'assign_resale_cost',
  description:
    'PROPONE asignar un coste unitario a un producto que se vende sin coste conocido ' +
    '(reventa: bebidas, postres comprados ya hechos, etc.). NO ejecuta el cambio: ' +
    'devuelve una propuesta que el usuario debe confirmar. Úsala cuando el usuario ' +
    'quiera cerrar el hueco de un producto sin mapear / sin coste (lo que aparece en ' +
    'top_5_unmapped de catalog_health). El coste unitario es lo que al cliente le ' +
    'cuesta comprar una unidad de ese producto (sin IVA). Tras confirmarse, el coste ' +
    'se propaga a todas las marcas donde se vende ese producto.',
  input_schema: {
    type: 'object',
    properties: {
      product_name: {
        type: 'string',
        description: 'Nombre exacto del producto sin mapear, tal como aparece en las ventas.',
      },
      unit_cost: {
        type: 'number',
        description: 'Coste unitario en euros (sin IVA) de una unidad del producto.',
      },
    },
    required: ['product_name', 'unit_cost'],
  },
  handler: async (args, ctx) => {
    const sb = clientWithUserJwt(ctx);
    const productName = String(args.product_name ?? '').trim();
    const unitCost = Number(args.unit_cost);
    if (!productName) throw new Error('Falta el nombre del producto.');
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error('El coste unitario no es válido.');

    // Resolver el ANCLA (recipe_item_id) por nombre del menu_item. Pasar el ancla
    // explícita hace que classify_unmapped_product entre por "Puerta 1" (directa),
    // sin adivinar por nombre — evita el callejón needs_target cuando hay variantes
    // del nombre o matrículas inconsistentes. Buscamos el menu_item activo cuyo
    // nombre coincida (case-insensitive) y que tenga recipe_item asignado.
    const { data: anchors, error: anchorErr } = await sb
      .from('menu_item')
      .select('id, name, recipe_item_id')
      .eq('account_id', ctx.accountId)
      .is('archived_at', null)
      .not('recipe_item_id', 'is', null)
      .ilike('name', productName);
    if (anchorErr) throw new Error(`No pude buscar el artículo: ${anchorErr.message}`);

    // Distintos recipe_item candidatos (puede haber varios menu_item → mismo o
    // distinto recipe_item según variantes de matrícula).
    const distinctRecipeIds = [...new Set((anchors ?? []).map((a: any) => a.recipe_item_id).filter(Boolean))];

    let recipeItemId: string | null = null;
    if (distinctRecipeIds.length === 1) {
      recipeItemId = distinctRecipeIds[0] as string;
    }
    // Si hay 0 o >1 anclas distintas, dejamos recipeItemId null: la función
    // resolverá por nombre (y devolverá needs_target con candidatos si procede).

    const summary = `Asignar coste ${unitCost.toFixed(2)}€/ud a "${productName}" (reventa) y propagarlo a sus marcas`;
    const { data: actionId, error } = await sb.rpc('propose_ai_action', {
      p_account_id: ctx.accountId,
      p_agent: 'kitchen',
      p_tool_name: 'assign_resale_cost',
      p_summary: summary,
      p_args: { product_name: productName, unit_cost: unitCost, recipe_item_id: recipeItemId },
      p_risk: 'L1',
      p_effect_preview: { kind: 'assign_resale_cost', product_name: productName, unit_cost: unitCost },
      p_rollback_hint: { note: 'Volver a dejar el producto sin coste (needs_review)' },
    });
    if (error) throw new Error(`No pude registrar la propuesta: ${error.message}`);

    return {
      status: 'pending_confirmation',
      action_id: actionId,
      risk: 'L1',
      summary,
      effect: { product_name: productName, unit_cost: unitCost },
      resolved_anchor: recipeItemId !== null,
      message: 'Propuesta registrada. El usuario debe confirmarla para que el coste se aplique.',
    };
  },
};

// ── TOOLS DE LECTURA — AGENTE SUPPLY (compras + almacén) ──────────────
// Todas usan clientWithUserJwt (RLS del usuario). Resuelven proveedor/local por
// nombre (ilike) para poder llamar a los motores por id. Si falta un dato para
// acotar, devuelven las opciones disponibles en vez de adivinar.

async function resolveSupplierId(sb: any, accountId: string, name: string | null): Promise<{ id: string | null; options: Array<{ id: string; name: string }> }> {
  const q = sb.from('supplier').select('id, name').eq('account_id', accountId).eq('is_active', true);
  const { data, error } = name ? await q.ilike('name', `%${name}%`) : await q;
  if (error) throw new Error(`No pude leer proveedores: ${error.message}`);
  const opts = (data ?? []).map((r: any) => ({ id: r.id as string, name: r.name as string }));
  return { id: opts.length === 1 ? opts[0].id : null, options: opts };
}

async function resolveLocationId(sb: any, accountId: string, name: string | null): Promise<{ id: string | null; options: Array<{ id: string; name: string }> }> {
  const q = sb.from('locations').select('id, name').eq('account_id', accountId).eq('active', true);
  const { data, error } = name ? await q.ilike('name', `%${name}%`) : await q;
  if (error) throw new Error(`No pude leer locales: ${error.message}`);
  const opts = (data ?? []).map((r: any) => ({ id: r.id as string, name: r.name as string }));
  return { id: opts.length === 1 ? opts[0].id : null, options: opts };
}

const TOOL_PURCHASE_SUGGESTION: ToolDef = {
  name: 'purchase_suggestion',
  description:
    'Devuelve QUÉ PEDIR a un proveedor para un local, calculado por el motor de repedido ' +
    '(cubre la semana, redondeado al formato de compra). Cada línea trae la cantidad sugerida ' +
    'y su fuente: "consumo" (dato real, confianza alta), "historico" (proxy por pedidos previos, ' +
    'confianza media) o "par" (nivel fijado a mano). Úsala cuando el usuario pregunte qué pedir, ' +
    'qué le falta de un proveedor, o quiera preparar un pedido. Si no se identifica el proveedor o ' +
    'el local, devuelve la lista de opciones para que preguntes cuál.',
  input_schema: {
    type: 'object',
    properties: {
      supplier_name: { type: 'string', description: 'Nombre (o parte) del proveedor. Ej: "Cloudtown".' },
      location_name: { type: 'string', description: 'Nombre (o parte) del local. Ej: "Plaza Castilla".' },
    },
    required: [],
  },
  handler: async (args, ctx) => {
    const sb = clientWithUserJwt(ctx);
    const sup = await resolveSupplierId(sb, ctx.accountId, (args.supplier_name as string | undefined)?.trim() || null);
    if (!sup.id) return { need: 'supplier', message: 'Indica el proveedor.', suppliers: sup.options.slice(0, 20) };
    const loc = await resolveLocationId(sb, ctx.accountId, (args.location_name as string | undefined)?.trim() || null);
    if (!loc.id) return { need: 'location', message: 'Indica el local.', locations: loc.options.slice(0, 20) };

    const { data: rows, error } = await sb.rpc('suggest_purchase_qty', {
      p_account: ctx.accountId, p_supplier: sup.id, p_location: loc.id,
    });
    if (error) throw new Error(`No pude calcular la sugerencia: ${error.message}`);

    const withQty = (rows ?? []).filter((r: any) => r.suggested_qty != null && Number(r.suggested_qty) > 0);
    const ids = withQty.map((r: any) => r.recipe_item_id);
    const nameById = new Map<string, string>();
    if (ids.length) {
      const { data: items } = await sb.from('recipe_item').select('id, name').in('id', ids);
      for (const it of (items ?? []) as any[]) nameById.set(it.id, it.name);
    }
    const lines = withQty
      .map((r: any) => ({
        name: nameById.get(r.recipe_item_id) ?? '(sin nombre)',
        suggested_qty: Number(r.suggested_qty),
        source: r.source, confidence: r.confidence,
      }))
      .sort((a: any, b: any) => b.suggested_qty - a.suggested_qty)
      .slice(0, 25);

    return {
      supplier: sup.options.find(o => o.id === sup.id)?.name ?? null,
      location: loc.options.find(o => o.id === loc.id)?.name ?? null,
      horizon_days: 7,
      total_lines: lines.length,
      lines,
      note: lines.length === 0 ? 'No hay nada que pedir a este proveedor para cubrir la semana (o no hay señal de consumo/histórico).' : null,
    };
  },
};

const TOOL_STOCK_HEALTH: ToolDef = {
  name: 'stock_health',
  description:
    'Resumen del estado del almacén de un local: cuántos artículos están bajo mínimo, cuántos ' +
    'tienen nivel definido, total de artículos con stock y valor aproximado del stock. Úsala cuando ' +
    'el usuario pregunte cómo va el almacén, cuánto stock tiene, o qué salud tiene el inventario. ' +
    'Si no se identifica el local, devuelve la lista para que preguntes.',
  input_schema: {
    type: 'object',
    properties: { location_name: { type: 'string', description: 'Nombre (o parte) del local.' } },
    required: [],
  },
  handler: async (args, ctx) => {
    const sb = clientWithUserJwt(ctx);
    const loc = await resolveLocationId(sb, ctx.accountId, (args.location_name as string | undefined)?.trim() || null);
    if (!loc.id) return { need: 'location', message: 'Indica el local.', locations: loc.options.slice(0, 20) };

    const { data, error } = await sb.rpc('stock_levels_overview', {
      p_account: ctx.accountId, p_location: loc.id, p_only_with_level: false,
    });
    if (error) throw new Error(`No pude leer el almacén: ${error.message}`);
    const items = ((data ?? {}).items ?? []) as any[];
    let belowMin = 0, withLevel = 0, stockValue = 0;
    for (const it of items) {
      if (it.below_min) belowMin++;
      if (it.has_level) withLevel++;
      stockValue += Number(it.qty_on_hand ?? 0) * Number(it.unit_cost ?? 0);
    }
    return {
      location: loc.options.find(o => o.id === loc.id)?.name ?? null,
      total_items: items.length,
      below_min_count: belowMin,
      with_level_count: withLevel,
      stock_value_eur: Math.round(stockValue * 100) / 100,
    };
  },
};

const TOOL_LOW_STOCK: ToolDef = {
  name: 'low_stock',
  description:
    'Lista de artículos BAJO MÍNIMO en un local (los que hay que reponer), con su stock actual, ' +
    'su mínimo, su par y cuánto falta para llegar al par. Úsala cuando el usuario pregunte qué le ' +
    'falta, qué está bajo mínimo, o qué tiene que reponer.',
  input_schema: {
    type: 'object',
    properties: { location_name: { type: 'string', description: 'Nombre (o parte) del local.' } },
    required: [],
  },
  handler: async (args, ctx) => {
    const sb = clientWithUserJwt(ctx);
    const loc = await resolveLocationId(sb, ctx.accountId, (args.location_name as string | undefined)?.trim() || null);
    if (!loc.id) return { need: 'location', message: 'Indica el local.', locations: loc.options.slice(0, 20) };

    const { data, error } = await sb.rpc('stock_levels_overview', {
      p_account: ctx.accountId, p_location: loc.id, p_only_with_level: true,
    });
    if (error) throw new Error(`No pude leer los niveles: ${error.message}`);
    const items = (((data ?? {}).items ?? []) as any[])
      .filter((it) => it.below_min)
      .map((it) => ({
        name: it.item_name ?? '(sin nombre)',
        on_hand: Number(it.qty_on_hand ?? 0),
        min: it.min_qty == null ? null : Number(it.min_qty),
        par: it.par_qty == null ? null : Number(it.par_qty),
        to_par: Number(it.to_par_qty ?? 0),
        unit: it.unit_abbr ?? null,
      }))
      .sort((a, b) => b.to_par - a.to_par)
      .slice(0, 30);
    return {
      location: loc.options.find(o => o.id === loc.id)?.name ?? null,
      below_min_count: items.length,
      items,
    };
  },
};

const TOOL_ITEM_CONSUMPTION: ToolDef = {
  name: 'item_consumption',
  description:
    'Consumo real de un artículo (salidas de stock por venta) en los últimos N días, para un local ' +
    'o para toda la cuenta. Devuelve el total y el consumo medio diario. Úsala para explicar por qué ' +
    'se sugiere una cantidad, o cuando el usuario pregunte cuánto gasta de un artículo. Si el nombre ' +
    'coincide con varios artículos, devuelve los candidatos para que preguntes cuál.',
  input_schema: {
    type: 'object',
    properties: {
      item_name: { type: 'string', description: 'Nombre (o parte) del artículo. Ej: "Milanesa Ternera".' },
      location_name: { type: 'string', description: 'Opcional. Local; si se omite, suma toda la cuenta.' },
      days: { type: 'number', description: 'Ventana en días (por defecto 30).' },
    },
    required: ['item_name'],
  },
  handler: async (args, ctx) => {
    const sb = clientWithUserJwt(ctx);
    const itemName = String(args.item_name ?? '').trim();
    if (!itemName) throw new Error('Falta el nombre del artículo.');
    const days = Number.isFinite(Number(args.days)) && Number(args.days) > 0 ? Math.floor(Number(args.days)) : 30;

    const { data: items, error: ei } = await sb
      .from('recipe_item')
      .select('id, name, kitchen_unit:base_unit_id ( abbreviation )')
      .eq('account_id', ctx.accountId).eq('is_active', true).ilike('name', `%${itemName}%`);
    if (ei) throw new Error(`No pude buscar el artículo: ${ei.message}`);
    const cand = (items ?? []) as any[];
    if (cand.length === 0) return { found: false, message: `No encuentro ningún artículo que se parezca a "${itemName}".` };
    if (cand.length > 1) return { need: 'item', message: 'Hay varios artículos con ese nombre.', candidates: cand.slice(0, 10).map((c) => c.name) };

    const item = cand[0];
    let loc: { id: string | null; options: Array<{ id: string; name: string }> } = { id: null, options: [] };
    const locName = (args.location_name as string | undefined)?.trim() || null;
    if (locName) {
      loc = await resolveLocationId(sb, ctx.accountId, locName);
      if (!loc.id) return { need: 'location', message: 'Indica el local.', locations: loc.options.slice(0, 20) };
    }

    let q = sb.from('stock_movement')
      .select('qty_base')
      .eq('account_id', ctx.accountId)
      .eq('recipe_item_id', item.id)
      .eq('movement_type', 'consumo')
      .gte('occurred_at', new Date(Date.now() - days * 86400_000).toISOString());
    if (loc.id) q = q.eq('location_id', loc.id);
    const { data: movs, error: em } = await q;
    if (em) throw new Error(`No pude leer el consumo: ${em.message}`);

    let total = 0;
    for (const m of (movs ?? []) as any[]) total += Math.abs(Number(m.qty_base ?? 0));
    const unit = item.kitchen_unit?.abbreviation ?? null;
    return {
      found: true,
      item: item.name,
      location: loc.id ? (loc.options.find(o => o.id === loc.id)?.name ?? null) : 'toda la cuenta',
      days,
      unit,
      total_consumed: Math.round(total * 100) / 100,
      daily_avg: Math.round((total / days) * 100) / 100,
    };
  },
};

// ── WRITE TOOL — AGENTE SUPPLY (contrato: PROPONE, no ejecuta) ─────────
const TOOL_GENERATE_PURCHASE_ORDER: ToolDef = {
  name: 'generate_purchase_order',
  description:
    'PROPONE crear un pedido borrador a un proveedor para un local, con las cantidades ' +
    'sugeridas por el motor de repedido (cubre la semana). NO ejecuta: registra una propuesta ' +
    'que el usuario confirma con un botón; solo al confirmar se crea el pedido. Úsala cuando el ' +
    'usuario quiera preparar/generar el pedido de un proveedor ("prepárame el pedido de Cloudtown", ' +
    '"genera el pedido de la semana"). Tras llamarla, di que has preparado la propuesta para que la ' +
    'confirme; NUNCA afirmes que el pedido ya está creado.',
  input_schema: {
    type: 'object',
    properties: {
      supplier_name: { type: 'string', description: 'Nombre (o parte) del proveedor.' },
      location_name: { type: 'string', description: 'Nombre (o parte) del local.' },
    },
    required: [],
  },
  handler: async (args, ctx) => {
    const sb = clientWithUserJwt(ctx);
    const sup = await resolveSupplierId(sb, ctx.accountId, (args.supplier_name as string | undefined)?.trim() || null);
    if (!sup.id) return { need: 'supplier', message: 'Indica el proveedor.', suppliers: sup.options.slice(0, 20) };
    const loc = await resolveLocationId(sb, ctx.accountId, (args.location_name as string | undefined)?.trim() || null);
    if (!loc.id) return { need: 'location', message: 'Indica el local.', locations: loc.options.slice(0, 20) };

    // 1) Sugerencia del motor.
    const { data: sugg, error: es } = await sb.rpc('suggest_purchase_qty', {
      p_account: ctx.accountId, p_supplier: sup.id, p_location: loc.id,
    });
    if (es) throw new Error(`No pude calcular la sugerencia: ${es.message}`);
    const withQty = (sugg ?? []).filter((r: any) => r.suggested_qty != null && Number(r.suggested_qty) > 0);
    if (withQty.length === 0) {
      return { status: 'nothing_to_order', message: 'No hay nada que pedir a este proveedor para cubrir la semana.' };
    }

    // 2) Catálogo del proveedor para precio + formato (misma lógica que el builder:
    //    €/caja = last_price × qty_in_base; línea = qty × €/caja).
    const suggIds = withQty.map((r: any) => r.recipe_item_id);
    const { data: cat, error: ec } = await sb
      .from('article_supplier')
      .select('recipe_item_id, last_price, purchase_format_id, recipe_item:recipe_item_id(name), recipe_item_purchase_format:purchase_format_id(qty_in_base)')
      .eq('account_id', ctx.accountId).eq('supplier_id', sup.id).eq('is_active', true)
      .in('recipe_item_id', suggIds);
    if (ec) throw new Error(`No pude leer el catálogo: ${ec.message}`);
    const catById = new Map<string, any>();
    for (const c of (cat ?? []) as any[]) catById.set(c.recipe_item_id, c);

    // 3) Construir líneas con precio.
    const lines: any[] = [];
    let total = 0;
    for (const r of withQty as any[]) {
      const c = catById.get(r.recipe_item_id);
      const qty = Number(r.suggested_qty);
      const lastPrice = c?.last_price != null ? Number(c.last_price) : null;
      const qtyInBase = c?.recipe_item_purchase_format?.qty_in_base != null ? Number(c.recipe_item_purchase_format.qty_in_base) : 1;
      const unitPrice = lastPrice != null ? Math.round(lastPrice * qtyInBase * 100) / 100 : null;  // €/formato
      const lineTotal = unitPrice != null ? Math.round(qty * unitPrice * 100) / 100 : null;
      if (lineTotal != null) total += lineTotal;
      lines.push({
        recipe_item_id: r.recipe_item_id,
        product_name: c?.recipe_item?.name ?? '(sin nombre)',
        qty,
        purchase_format_id: c?.purchase_format_id ?? null,
        unit_price: unitPrice,
        line_total: lineTotal,
        source: r.source,
      });
    }
    total = Math.round(total * 100) / 100;
    const supplierName = sup.options.find(o => o.id === sup.id)?.name ?? '';
    const locationName = loc.options.find(o => o.id === loc.id)?.name ?? '';
    const summary = `Crear pedido a ${supplierName} (${locationName}) con ${lines.length} ${lines.length === 1 ? 'artículo' : 'artículos'} · ~${total.toFixed(2)}€`;

    // 4) Registrar la propuesta (no ejecuta).
    const { data: actionId, error: ep } = await sb.rpc('propose_ai_action', {
      p_account_id: ctx.accountId,
      p_agent: 'supply',
      p_tool_name: 'generate_purchase_order',
      p_summary: summary,
      p_args: { supplier_id: sup.id, location_id: loc.id, est_total: total, lines },
      p_risk: 'L1',
      p_effect_preview: { kind: 'purchase_order', supplier: supplierName, location: locationName, n_lines: lines.length, total_eur: total },
      p_rollback_hint: { note: 'Archivar el pedido borrador creado (queda sin efecto)' },
    });
    if (ep) throw new Error(`No pude registrar la propuesta: ${ep.message}`);

    return {
      status: 'pending_confirmation',
      action_id: actionId,
      risk: 'L1',
      summary,
      effect: { supplier: supplierName, location: locationName, n_lines: lines.length, total_eur: total },
      message: 'Propuesta de pedido registrada. El usuario debe confirmarla para que se cree el borrador.',
    };
  },
};

// ── REGISTRY DE AGENTES ───────────────────────────────────────────────
// Cada agente declara su persona y su conjunto de tools. El backend elige el
// agente según `module`. Añadir un agente = una entrada aquí.

interface AgentDef {
  persona: string;
  tools: ToolDef[];
  // Modelo del agente. Si se omite, usa FOLVY_AI_MODEL / DEFAULT_MODEL.
  // Permite enrutar por complejidad: Haiku para tareas simples, Sonnet para razonar.
  model?: string;
}

const AGENTS: Record<string, AgentDef> = {
  // Agente de Cocina (primera implementación del marco). Razona sobre coste y
  // margen → merece Sonnet (la calidad de análisis importa). Por defecto ya es
  // Sonnet; se deja explícito para documentar la intención.
  kitchen: {
    persona: PERSONA_KITCHEN,
    tools: [TOOL_CATALOG_HEALTH, TOOL_ASSIGN_RESALE_COST],
    model: 'claude-sonnet-4-6',
  },
  // Agente de Compras y Almacén (segundo agente del marco). Razona sobre
  // reposición, stock y consumo → Sonnet.
  supply: {
    persona: PERSONA_SUPPLY,
    tools: [TOOL_PURCHASE_SUGGESTION, TOOL_STOCK_HEALTH, TOOL_LOW_STOCK, TOOL_ITEM_CONSUMPTION, TOOL_GENERATE_PURCHASE_ORDER],
    model: 'claude-sonnet-4-6',
  },
  // Agente por defecto (chat global sin módulo concreto).
  _default: {
    persona: PERSONA_DEFAULT,
    tools: [TOOL_CATALOG_HEALTH],
  },
};

/** Resuelve el agente activo a partir del módulo (fallback al generalista). */
function resolveAgent(module: string | undefined | null): AgentDef {
  if (module && AGENTS[module]) return AGENTS[module];
  return AGENTS._default;
}

function toolsForAnthropic(agent: AgentDef) {
  return agent.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function decodeJwtSub(jwt: string): { sub: string | null; name: string | null } {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return { sub: null, name: null };
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      sub: payload.sub ?? null,
      name: payload.folvy?.full_name ?? payload.user_metadata?.full_name ?? null,
    };
  } catch { return { sub: null, name: null }; }
}

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse(401, { error: 'Missing Authorization header' });
  const userJwt = authHeader.replace('Bearer ', '').trim();
  const { sub: userId, name: userName } = decodeJwtSub(userJwt);

  let body: {
    account_id: string;
    message: string;
    surface: string;
    module?: string;
    context?: unknown;
    session_id?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    stream?: boolean;
  };
  try { body = await req.json(); } catch { return jsonResponse(400, { error: 'JSON invalido' }); }
  const { account_id, surface } = body;
  let { message } = body;
  if (!account_id || !surface) {
    return jsonResponse(400, { error: 'Faltan account_id o surface' });
  }
  if (!['chat', 'aicard', 'background', 'opening'].includes(surface)) {
    return jsonResponse(400, { error: 'surface invalido' });
  }
  if (surface === 'opening' && (!message || !message.trim())) {
    message = 'Saluda al usuario y presenta el estado de su carta.';
  }
  if (!message) return jsonResponse(400, { error: 'Falta message' });

  const streamMode = body.stream === true;

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    console.error('[folvy-ai] ANTHROPIC_API_KEY no configurada');
    return jsonResponse(500, { error: 'IA no configurada' });
  }
  // Resolver el agente activo (por módulo) y su modelo. Prioridad de modelo:
  // 1) FOLVY_AI_MODEL si está puesto en el env → override global (abaratar en
  //    pruebas con Haiku, o forzar un modelo en emergencia, sin tocar código);
  // 2) el modelo del agente (enrutado por complejidad: Kitchen=Sonnet);
  // 3) DEFAULT_MODEL.
  const agent = resolveAgent(body.module);
  const model = Deno.env.get('FOLVY_AI_MODEL') ?? agent.model ?? DEFAULT_MODEL;
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const sbAdmin = createClient(supabaseUrl, serviceKey);

  const sbUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: memoryRows } = await sbUser
    .from('ai_memory')
    .select('scope, key, value')
    .eq('account_id', account_id);
  const memoryContext = (memoryRows ?? []).length === 0
    ? '(sin memoria previa para esta cuenta)'
    : (memoryRows ?? []).map(m => `- [${m.scope}] ${m.key}: ${JSON.stringify(m.value)}`).join('\n');

  const userNameLine = userName ? `Nombre del usuario: ${userName}.` : '';
  const surfaceContext = `Surface: ${surface}${body.module ? ` (modulo: ${body.module})` : ''}. ${userNameLine}` +
    (body.context ? `\nContexto adicional: ${JSON.stringify(body.context)}` : '');

  let systemPrompt = SYSTEM_PROMPT_BASE
    .replace('{{AGENT_PERSONA}}', agent.persona)
    .replace('{{SURFACE_CONTEXT}}', surfaceContext)
    .replace('{{MEMORY_CONTEXT}}', memoryContext);
  if (surface === 'opening') systemPrompt += OPENING_INSTRUCTION;

  const sessionId = body.session_id ?? crypto.randomUUID();
  const startedAt = Date.now();
  const toolCtx: ToolContext = { accountId: account_id, userJwt, supabaseUrl, anonKey };

  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    ...(body.history ?? []).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  // ── RAMA STREAMING ────────────────────────────────────────────────
  if (streamMode) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const toolsUsed: Array<{ name: string; input: unknown; output: unknown }> = [];
        let tokensIn = 0, tokensOut = 0;
        let finalText = '';

        try {
          for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
            const aiResp = await fetch(ANTHROPIC_ENDPOINT, {
              method: 'POST',
              headers: {
                'x-api-key': anthropicKey,
                'anthropic-version': ANTHROPIC_VERSION,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model, max_tokens: MAX_TOKENS,
                system: systemPrompt,
                tools: toolsForAnthropic(agent),
                messages,
                stream: true,
              }),
            });
            if (!aiResp.ok || !aiResp.body) {
              const errTxt = await aiResp.text();
              throw new Error(`IA HTTP ${aiResp.status}: ${errTxt}`);
            }

            const reader = aiResp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const assistantBlocks: any[] = [];
            let currentBlock: any = null;
            let currentText = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const json = line.slice(6).trim();
                if (!json) continue;
                let evt: any;
                try { evt = JSON.parse(json); } catch { continue; }

                if (evt.type === 'message_start') {
                  tokensIn += evt.message?.usage?.input_tokens ?? 0;
                } else if (evt.type === 'content_block_start') {
                  currentBlock = { ...evt.content_block };
                  currentText = '';
                  if (currentBlock.type === 'tool_use') {
                    currentBlock.input = currentBlock.input ?? {};
                    controller.enqueue(encoder.encode(sseEvent({ type: 'tool_start', name: currentBlock.name })));
                  }
                } else if (evt.type === 'content_block_delta') {
                  const d = evt.delta;
                  if (d.type === 'text_delta') {
                    currentText += d.text;
                    finalText += d.text;
                    controller.enqueue(encoder.encode(sseEvent({ type: 'text', content: d.text })));
                  } else if (d.type === 'input_json_delta') {
                    currentBlock._partial = (currentBlock._partial ?? '') + d.partial_json;
                  }
                } else if (evt.type === 'content_block_stop') {
                  if (currentBlock?.type === 'text') {
                    currentBlock.text = currentText;
                  } else if (currentBlock?.type === 'tool_use') {
                    try {
                      currentBlock.input = currentBlock._partial ? JSON.parse(currentBlock._partial) : {};
                    } catch { currentBlock.input = {}; }
                    delete currentBlock._partial;
                  }
                  assistantBlocks.push(currentBlock);
                  currentBlock = null;
                } else if (evt.type === 'message_delta') {
                  tokensOut += evt.usage?.output_tokens ?? 0;
                }
              }
            }

            const toolUses = assistantBlocks.filter(b => b.type === 'tool_use');
            if (toolUses.length === 0) break;

            messages.push({ role: 'assistant', content: assistantBlocks });
            const toolResults: any[] = [];
            for (const tu of toolUses) {
              const tool = agent.tools.find(t => t.name === tu.name);
              if (!tool) {
                controller.enqueue(encoder.encode(sseEvent({ type: 'tool_end', name: tu.name })));
                toolResults.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Tool desconocida: ${tu.name}` });
                continue;
              }
              try {
                const out = await tool.handler(tu.input ?? {}, toolCtx);
                toolsUsed.push({ name: tu.name, input: tu.input, output: out });
                toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
                // Si la tool propuso una acción confirmable, emite el sobre al front.
                const o = out as Record<string, unknown> | null;
                if (o && o.status === 'pending_confirmation' && o.action_id) {
                  controller.enqueue(encoder.encode(sseEvent({
                    type: 'action_proposed',
                    action_id: o.action_id,
                    tool: tu.name,
                    risk: o.risk ?? 'L1',
                    summary: o.summary ?? '',
                    effect: o.effect ?? null,
                  })));
                }
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                toolsUsed.push({ name: tu.name, input: tu.input, output: { error: msg } });
                toolResults.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: msg });
              }
              controller.enqueue(encoder.encode(sseEvent({ type: 'tool_end', name: tu.name })));
            }
            messages.push({ role: 'user', content: toolResults });
          }

          if (!finalText) finalText = '(Folvy AI no pudo formular una respuesta tras varios intentos.)';

          controller.enqueue(encoder.encode(sseEvent({
            type: 'done',
            session_id: sessionId,
            usage: { tokens_in: tokensIn, tokens_out: tokensOut, duration_ms: Date.now() - startedAt },
          })));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[folvy-ai] stream error:', msg);
          controller.enqueue(encoder.encode(sseEvent({ type: 'error', message: msg })));
        } finally {
          sbAdmin.from('ai_interaction').insert({
            account_id, user_id: userId, user_name: userName,
            surface, module: body.module ?? null, session_id: sessionId,
            request: { message, context: body.context ?? null, stream: true },
            response: { text: finalText },
            tools_used: toolsUsed,
            model, tokens_in: tokensIn, tokens_out: tokensOut,
            duration_ms: Date.now() - startedAt,
            status: 'ok',
          }).then(() => {}, () => {});
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // ── RAMA LEGACY (sin streaming, idéntica a v1) ────────────────────
  const toolsUsed: Array<{ name: string; input: unknown; output: unknown }> = [];
  let tokensIn = 0, tokensOut = 0;
  let finalText = '';
  let status: 'ok' | 'error' = 'ok';
  let errorMessage: string | null = null;

  try {
    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const aiResp = await fetch(ANTHROPIC_ENDPOINT, {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model, max_tokens: MAX_TOKENS,
          system: systemPrompt,
          tools: toolsForAnthropic(agent),
          messages,
        }),
      });
      if (!aiResp.ok) {
        const errTxt = await aiResp.text();
        throw new Error(`IA HTTP ${aiResp.status}: ${errTxt}`);
      }
      const aiData = await aiResp.json();
      tokensIn += aiData.usage?.input_tokens ?? 0;
      tokensOut += aiData.usage?.output_tokens ?? 0;
      const toolUses = (aiData.content ?? []).filter((b: any) => b.type === 'tool_use');
      const textBlocks = (aiData.content ?? []).filter((b: any) => b.type === 'text');
      if (toolUses.length === 0) {
        finalText = textBlocks.map((b: any) => b.text).join('\n').trim();
        break;
      }
      messages.push({ role: 'assistant', content: aiData.content });
      const toolResults: any[] = [];
      for (const tu of toolUses) {
        const tool = agent.tools.find(t => t.name === tu.name);
        if (!tool) {
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Tool desconocida: ${tu.name}` });
          continue;
        }
        try {
          const out = await tool.handler(tu.input ?? {}, toolCtx);
          toolsUsed.push({ name: tu.name, input: tu.input, output: out });
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          toolsUsed.push({ name: tu.name, input: tu.input, output: { error: msg } });
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: msg });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }
    if (!finalText) finalText = '(Folvy AI no pudo formular una respuesta tras varios intentos.)';
  } catch (e) {
    status = 'error';
    errorMessage = e instanceof Error ? e.message : String(e);
    console.error('[folvy-ai] error:', errorMessage);
  }

  const durationMs = Date.now() - startedAt;
  await sbAdmin.from('ai_interaction').insert({
    account_id, user_id: userId, user_name: userName,
    surface, module: body.module ?? null, session_id: sessionId,
    request: { message, context: body.context ?? null },
    response: status === 'ok' ? { text: finalText } : null,
    tools_used: toolsUsed,
    model, tokens_in: tokensIn, tokens_out: tokensOut, duration_ms: durationMs,
    status, error_message: errorMessage,
  });

  if (status === 'error') return jsonResponse(500, { error: errorMessage });
  return jsonResponse(200, {
    response: finalText,
    session_id: sessionId,
    tools_used: toolsUsed.map(t => ({ name: t.name })),
    usage: { tokens_in: tokensIn, tokens_out: tokensOut, duration_ms: durationMs },
  });
});
