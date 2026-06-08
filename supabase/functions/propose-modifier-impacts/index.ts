// supabase/functions/propose-modifier-impacts/index.ts
//
// PROPUESTAS DE IMPACTO DE MODIFICADOR — Edge Function (G3, Nivel 2).
//
// Para las opciones de modificador SIN impacto confirmado, propone QUÉ le hacen a
// la receta (añade/quita/sustituye un ingrediente, o multiplica). Escribe en
// modifier_recipe_impact como status='proposed', source='ai'. NUNCA 'confirmed':
// el humano siempre confirma desde la pestaña antes de que toque el coste.
//
// Tres fuentes, en orden de fiabilidad (la primera que resuelve, gana):
//  1) APRENDIZAJE CRUZADO (sin IA, barato, confianza alta): si una opción con el
//     mismo nombre normalizado YA tiene impacto confirmed en la cuenta, propone el
//     mismo (tipo + ingrediente + cantidad + unidad). Es el "aprende y no repite"
//     entre platos. Análogo a la vía exacta de map-products.
//  2) IA POR NOMBRE + CATÁLOGO (Sonnet, confianza media): manda el nombre de la
//     opción + su grupo + el catálogo de ingredientes (raw/recipe) del cliente, y
//     la IA deduce el tipo de impacto y el ingrediente. Acierta el QUÉ; la cantidad
//     la asume (el humano la ajusta).
//  3) SIN PISTA CLARA: no propone (cero invención). Mejor sin propuesta que mala.
//
// Anti-invención (principio Folvy): confianza baja -> no se escribe propuesta.
// Una propuesta mala que el humano confirma de pasada corrompe el coste; preferimos
// no proponer. El Nivel 3 (auto-confirmar) sigue dormido: aquí TODO es 'proposed'.
//
// Auth: platform_admin (JWT) o service-role interna (x-internal-key). Patrón
// calcado de map-products. Alcance: un plato (recipe_item_id) o toda la cuenta.

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Umbral para que la IA proponga. Por debajo -> no se escribe (anti-invención).
const PROPOSE_THRESHOLD = 0.55;
// Confianza fija de una propuesta por aprendizaje cruzado (copia de algo confirmado).
const LEARNED_CONFIDENCE = 0.9;
// Tope de opciones por invocación (límite de 150s del gateway).
const MAX_PER_RUN = 30;

interface FolvyClaims {
  is_platform_admin?: boolean;
}

interface ProposeRequest {
  account_id: string;
  recipe_item_id?: string;  // si se da, solo ese plato; si no, toda la cuenta
  dry_run?: boolean;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function decodeFolvyClaims(jwt: string): FolvyClaims | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(payloadB64));
    return payload.folvy ?? null;
  } catch {
    return null;
  }
}

function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ');
}

const VALID_TYPES = ['add_item', 'remove_item', 'replace_item', 'multiply', 'bundle', 'none'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse(401, { error: 'Missing Authorization header' });
  }
  const bearer = authHeader.replace('Bearer ', '').trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internalKey = req.headers.get('x-internal-key') ?? '';
  const isInternalCall = serviceKey.length > 0 && internalKey === serviceKey;

  if (!isInternalCall) {
    const folvy = decodeFolvyClaims(bearer);
    if (!folvy || folvy.is_platform_admin !== true) {
      return jsonResponse(403, { error: 'Solo platform admins pueden lanzar propuestas' });
    }
  }

  let body: ProposeRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Body JSON invalido' });
  }
  const { account_id, recipe_item_id } = body;
  const dryRun = body.dry_run === true;
  if (!account_id) {
    return jsonResponse(400, { error: 'Falta account_id' });
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    return jsonResponse(500, { error: 'Servicio de IA no configurado' });
  }
  const model = Deno.env.get('MAPPING_MODEL') ?? DEFAULT_MODEL;
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const sb = createClient(supabaseUrl, serviceKey);

  // ── Opciones candidatas: las de los grupos del/los plato(s), sin impacto activo ──
  // 1) resolver menu_item(s) del alcance
  let miQuery = sb
    .from('menu_item')
    .select('id, recipe_item_id')
    .eq('account_id', account_id)
    .is('archived_at', null);
  if (recipe_item_id) miQuery = miQuery.eq('recipe_item_id', recipe_item_id);
  const { data: menuItems, error: miErr } = await miQuery;
  if (miErr) {
    console.error('[propose-mod] error menu_item:', miErr.message);
    return jsonResponse(500, { error: 'Error leyendo platos' });
  }
  const menuIds = (menuItems ?? []).map((m: any) => m.id);
  if (menuIds.length === 0) {
    return jsonResponse(200, { procesados: 0, propuestos: 0, aprendidos: 0, sin_propuesta: 0, nota: 'Sin platos en el alcance' });
  }

  // 2) grupos asignados -> opciones
  const { data: assigns, error: aErr } = await sb
    .from('modifier_group_assignment')
    .select('modifier_group_id')
    .in('menu_item_id', menuIds);
  if (aErr) {
    console.error('[propose-mod] error assignments:', aErr.message);
    return jsonResponse(500, { error: 'Error leyendo grupos' });
  }
  const groupIds = Array.from(new Set((assigns ?? []).map((a: any) => a.modifier_group_id)));
  if (groupIds.length === 0) {
    return jsonResponse(200, { procesados: 0, propuestos: 0, aprendidos: 0, sin_propuesta: 0, nota: 'Sin grupos de modificador' });
  }

  const { data: options, error: oErr } = await sb
    .from('modifier_option')
    .select('id, name, price_impact, modifier_group_id, modifier_group:modifier_group_id ( name )')
    .eq('account_id', account_id)
    .in('modifier_group_id', groupIds);
  if (oErr) {
    console.error('[propose-mod] error opciones:', oErr.message);
    return jsonResponse(500, { error: 'Error leyendo opciones' });
  }

  // 3) excluir las que ya tienen impacto confirmed o proposed (no repetir)
  const optionIds = (options ?? []).map((o: any) => o.id);
  const { data: existing, error: eErr } = await sb
    .from('modifier_recipe_impact')
    .select('modifier_option_id, status, impact_type, target_recipe_item_id, quantity, unit_id')
    .in('modifier_option_id', optionIds);
  if (eErr) {
    console.error('[propose-mod] error impactos previos:', eErr.message);
    return jsonResponse(500, { error: 'Error leyendo impactos previos' });
  }
  const hasActive = new Set(
    (existing ?? [])
      .filter((i: any) => i.status === 'confirmed' || i.status === 'proposed')
      .map((i: any) => i.modifier_option_id),
  );

  // Banco de aprendizaje: opciones CONFIRMADAS, indexadas por nombre normalizado.
  const learned = new Map<string, any>();
  const confirmedOptIds = (existing ?? [])
    .filter((i: any) => i.status === 'confirmed')
    .map((i: any) => i.modifier_option_id);
  if (confirmedOptIds.length > 0) {
    const { data: confOpts } = await sb
      .from('modifier_option')
      .select('id, name')
      .in('id', confirmedOptIds);
    const nameById = new Map((confOpts ?? []).map((o: any) => [o.id, o.name]));
    for (const imp of existing ?? []) {
      if (imp.status !== 'confirmed') continue;
      const nm = nameById.get(imp.modifier_option_id);
      if (nm) learned.set(normalize(nm), imp);
    }
  }

  const pending = (options ?? []).filter((o: any) => !hasActive.has(o.id)).slice(0, MAX_PER_RUN);

  // Catálogo de ingredientes del cliente (para que la IA elija de lo que existe).
  const { data: ingredients, error: ingErr } = await sb
    .from('recipe_item')
    .select('id, name')
    .eq('account_id', account_id)
    .in('type', ['raw', 'recipe'])
    .eq('is_active', true)
    .order('name');
  if (ingErr) {
    console.error('[propose-mod] error ingredientes:', ingErr.message);
    return jsonResponse(500, { error: 'Error leyendo ingredientes' });
  }
  const ingById = new Map((ingredients ?? []).map((i: any) => [i.id, i.name]));

  const result = { procesados: 0, propuestos: 0, aprendidos: 0, sin_propuesta: 0, dry_run: dryRun };

  for (const opt of pending) {
    result.procesados++;
    const optName = opt.name as string;
    const groupName = (opt as any).modifier_group?.name ?? '';

    // ── Fuente 1: aprendizaje cruzado ──
    const learnedImpact = learned.get(normalize(optName));
    if (learnedImpact) {
      result.aprendidos++;
      if (!dryRun) {
        await sb.from('modifier_recipe_impact').insert({
          account_id,
          modifier_option_id: opt.id,
          impact_type: learnedImpact.impact_type,
          target_recipe_item_id: learnedImpact.target_recipe_item_id,
          quantity: learnedImpact.quantity,
          unit_id: learnedImpact.unit_id,
          status: 'proposed',
          confidence: LEARNED_CONFIDENCE,
          source: 'ai',
          rationale: `Ya confirmaste esta misma opción ("${optName}") en otro plato. Propongo el mismo efecto.`,
        });
      }
      continue;
    }

    // ── Fuente 2: IA por nombre + catálogo ──
    const ingList = (ingredients ?? [])
      .slice(0, 200)
      .map((i: any, n: number) => `${n + 1}. id=${i.id} | ${i.name}`)
      .join('\n');
    const prompt =
      `Eres un experto en escandallos de cocina. Una opción de modificador de un plato ` +
      `cambia su receta. Deduce QUÉ le hace a la receta.\n\n` +
      `Grupo de modificador: "${groupName}"\n` +
      `Opción: "${optName}"\n\n` +
      `INGREDIENTES disponibles del cliente (elige por id, solo de esta lista):\n${ingList}\n\n` +
      `Tipos de efecto posibles:\n` +
      `- replace_item: sustituye el ingrediente base por otro (ej. "Base Ternera" en un grupo de proteína cambia la proteína).\n` +
      `- add_item: añade un ingrediente (ej. "Extra queso", "Con bacon").\n` +
      `- remove_item: quita un ingrediente (ej. "Sin cebolla").\n` +
      `- multiply: multiplica la receta entera (ej. "Doble" = x2).\n` +
      `- none: no cambia el coste (ej. "Punto de la carne").\n\n` +
      `Devuelve SOLO un JSON (sin markdown): {"impact_type":"<tipo>","target_id":"<id de ingrediente o null>",` +
      `"quantity":<número o null>,"confidence":<0..1>,"reason":"<motivo breve en español>"}\n` +
      `REGLAS: si no encuentras un ingrediente claro en la lista para add/remove/replace, ` +
      `confidence 0 (NO lo fuerces). Para multiply, target_id null y quantity el factor. ` +
      `Para none, target_id null. La cantidad es orientativa (el humano la ajusta).`;

    let parsed: { impact_type?: string; target_id?: string | null; quantity?: number | null; confidence?: number; reason?: string } = {};
    try {
      const aiResp = await fetch(ANTHROPIC_ENDPOINT, {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model, max_tokens: 512,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!aiResp.ok) {
        console.error('[propose-mod] IA HTTP', aiResp.status);
        result.sin_propuesta++;
        continue;
      }
      const aiData = await aiResp.json();
      const textOut = (aiData.content ?? [])
        .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      parsed = JSON.parse(textOut.replace(/```json|```/g, '').trim());
    } catch (e) {
      console.error('[propose-mod] error IA/parse:', String(e));
      result.sin_propuesta++;
      continue;
    }

    const impactType = VALID_TYPES.includes(parsed.impact_type ?? '') ? parsed.impact_type! : 'none';
    const conf = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    const needsIngredient = impactType === 'add_item' || impactType === 'remove_item' || impactType === 'replace_item' || impactType === 'bundle';
    const targetId = parsed.target_id && ingById.has(parsed.target_id) ? parsed.target_id : null;

    // Anti-invención: si necesita ingrediente y no lo resolvió, o confianza baja -> no propone.
    if (conf < PROPOSE_THRESHOLD || (needsIngredient && !targetId)) {
      result.sin_propuesta++;
      continue;
    }

    result.propuestos++;
    if (!dryRun) {
      await sb.from('modifier_recipe_impact').insert({
        account_id,
        modifier_option_id: opt.id,
        impact_type: impactType,
        target_recipe_item_id: targetId,
        quantity: typeof parsed.quantity === 'number' ? parsed.quantity : null,
        unit_id: null,  // la unidad la fija el humano al confirmar/ajustar
        status: 'proposed',
        confidence: conf,
        source: 'ai',
        rationale: parsed.reason ?? '',
      });
    }
  }

  result.sin_propuesta = result.procesados - result.propuestos - result.aprendidos;
  console.log('[propose-mod] resultado:', JSON.stringify(result));
  return jsonResponse(200, result);
});
