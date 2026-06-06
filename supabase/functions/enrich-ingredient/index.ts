// supabase/functions/enrich-ingredient/index.ts
//
// COPILOTO IA DE FICHA (datos) — Edge Function de TEXTO.
// Dado un ingrediente que YA EXISTE (recipe_item), propone los datos que suelen
// faltar: ALÉRGENOS (de los 14 UE), MERMA por defecto (%) y CONSERVACIÓN.
// "IA propone, humano decide": devuelve una propuesta con confianza; NO la
// aplica. La aplicación (campo a campo, lo que el cocinero acepte) la hace el
// front (recipeAiService.applyEnrichment). Cada llamada queda registrada en
// recipe_item_ai_session (kind='enrich') con coste y latencia.
//
// Patrón calcado de suggest-item / extract-recipe: _shared/cors, auth JWT o
// x-internal-key, Anthropic vía ANTHROPIC_API_KEY, extractJson, anti-invención.
//
// Densidad NO se propone aquí: recipe_item no tiene columna de densidad (va con
// el módulo de conversiones). Nutrición tampoco: sale de USDA en pieza aparte.

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// Modelo por defecto: Haiku 4.5 (identificador con fecha = estable y disponible
// en cualquier clave con acceso a la API). Tarea estructurada y simple
// (alérgenos/merma/conservación) -> Haiku es suficiente y MUCHO más barato que
// Opus. Override por secreto ENRICH_MODEL si se quiere otro.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// Vocabulario canónico (idéntico a src/modules/kitchen/lib/allergens.ts).
const ALLERGEN_CODES = [
  'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk',
  'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs',
];
const ALLERGEN_STATES = ['contains', 'may_contain', 'free'];
const CONSERVATION_TYPES = ['fridge', 'freezer', 'dry', 'hot'];
// Etiquetas de menú válidas (set curado, no campos a medida).
const MENU_TAGS = [
  'picante', 'vegano', 'vegetariano', 'sin_gluten', 'sin_lactosa', 'halal', 'ecologico',
];

interface EnrichRequest {
  recipe_item_id: string;
  account_id: string;
}

interface ParsedEnrich {
  allergens: { code: string; state: string }[];
  default_waste_pct: number | null;
  conservation_type: string | null;
  shelf_life_days: number | null;
  menu_tags: string[];
  nutrition: Record<string, number | null> | null;
  confidence: number;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildPrompt(name: string, familyName: string | null): string {
  return (
    `Eres un experto en seguridad alimentaria y producción de cocina en España.\n` +
    `Te doy un ingrediente de la despensa de un restaurante. Propón sus datos de ficha.\n\n` +
    `INGREDIENTE: "${name}"\n` +
    (familyName ? `FAMILIA: "${familyName}"\n` : '') +
    `\nDevuelve JSON ESTRICTO (sin texto adicional, sin markdown) con esta forma EXACTA:\n` +
    `{\n` +
    `  "allergens": [{"code": "<uno de la lista>", "state": "contains|may_contain"}],\n` +
    `  "default_waste_pct": <merma típica en cocina, 0 a 95, o null si no aplica/no se sabe>,\n` +
    `  "conservation_type": "<fridge|freezer|dry|hot, o null>",\n` +
    `  "shelf_life_days": <vida útil orientativa en días del producto sin abrir/fresco, o null>,\n` +
    `  "menu_tags": [<etiquetas de menú de la lista, las que apliquen>],\n` +
    `  "nutrition": {\n` +
    `    "energy_kcal": <kcal por 100 g o null>,\n` +
    `    "fat_g": <g por 100 g o null>,\n` +
    `    "saturated_fat_g": <g por 100 g o null>,\n` +
    `    "carbs_g": <g por 100 g o null>,\n` +
    `    "sugars_g": <g por 100 g o null>,\n` +
    `    "fiber_g": <g por 100 g o null>,\n` +
    `    "protein_g": <g por 100 g o null>,\n` +
    `    "salt_g": <g por 100 g o null>\n` +
    `  },\n` +
    `  "confidence": <0 a 1>\n` +
    `}\n\n` +
    `LISTA DE ALÉRGENOS VÁLIDOS (códigos UE, usa SOLO estos):\n` +
    `  gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery,\n` +
    `  mustard, sesame, sulphites, lupin, molluscs\n\n` +
    `REGLAS CRÍTICAS (anti-invención):\n` +
    `- "allergens": incluye SOLO los que el ingrediente contiene de forma inherente\n` +
    `  y SEGURA (leche->milk, harina de trigo->gluten, gamba->crustaceans). Usa\n` +
    `  "contains" para lo seguro; "may_contain" SOLO si hay riesgo real de trazas.\n` +
    `  Si el ingrediente no tiene alérgenos (ej. agua, sal, tomate), devuelve [].\n` +
    `  NUNCA un código fuera de la lista. Ante la duda, NO lo incluyas.\n` +
    `- "default_waste_pct": merma de MANIPULACIÓN típica (pelar, deshuesar, limpiar).\n` +
    `  Aceite/sal/harina -> 0. Cebolla/patata -> ~8-12. Pescado entero -> ~40.\n` +
    `  Si no estás razonablemente seguro, null. No inventes una cifra precisa.\n` +
    `- "conservation_type": cómo se guarda. Fresco perecedero -> fridge; congelado ->\n` +
    `  freezer; seco/ambiente (harina, sal, conservas) -> dry; servicio en caliente -> hot.\n` +
    `- "shelf_life_days": vida útil ORIENTATIVA en días (aceite ~540, conserva ~730,\n` +
    `  pescado fresco ~2, verdura ~7). Si no estás seguro, null.\n` +
    `- "menu_tags": etiquetas de carta que apliquen al ingrediente, SOLO de esta lista:\n` +
    `  picante, vegano, vegetariano, sin_gluten, sin_lactosa, halal, ecologico.\n` +
    `  Inclúyelas cuando el ingrediente claramente lo cumple (tomate -> vegano,\n` +
    `  vegetariano, sin_gluten, sin_lactosa; guindilla -> + picante; cerdo -> ninguna\n` +
    `  de vegano/vegetariano/halal). NO marques 'ecologico' salvo que el nombre lo\n` +
    `  indique. Ante la duda, no la incluyas. NUNCA una etiqueta fuera de la lista.\n` +
    `- "nutrition": valores de referencia ORIENTATIVOS por 100 g del ingrediente\n` +
    `  genérico (los típicos de tablas de composición). Son aproximados, no de\n` +
    `  laboratorio. Si no estás razonablemente seguro de un valor, ese campo null.\n` +
    `  Si el ingrediente no aporta nutrición relevante (agua, sal), pon los que\n` +
    `  apliquen y el resto null.\n` +
    `- "confidence": tu confianza global en la propuesta.\n` +
    `- Responde ÚNICAMENTE el JSON.`
  );
}

function extractJson(textOut: string): ParsedEnrich | null {
  try {
    const clean = textOut.replace(/```json|```/g, '').trim();
    return JSON.parse(clean) as ParsedEnrich;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse(401, { error: 'Missing Authorization header' });

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internalKey = req.headers.get('x-internal-key') ?? '';
  const isInternalCall = serviceKey.length > 0 && internalKey === serviceKey;
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const sb = isInternalCall
    ? createClient(supabaseUrl, serviceKey)
    : createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: authHeader } },
      });

  let body: EnrichRequest;
  try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Body JSON inválido' }); }

  const { recipe_item_id, account_id } = body;
  if (!recipe_item_id || !account_id) {
    return jsonResponse(400, { error: 'Faltan recipe_item_id o account_id' });
  }

  // ── 1) Leer el ingrediente (RLS aplica con el JWT del usuario) ──
  const { data: item, error: itemErr } = await sb
    .from('recipe_item')
    .select('id, name, family_id, account_id')
    .eq('id', recipe_item_id)
    .maybeSingle();
  if (itemErr) return jsonResponse(500, { error: `Error leyendo ingrediente: ${itemErr.message}` });
  if (!item) return jsonResponse(404, { error: 'Ingrediente no encontrado' });

  // Nombre de la familia (contexto para la IA), si tiene.
  let familyName: string | null = null;
  if (item.family_id) {
    const { data: fam } = await sb
      .from('recipe_family')
      .select('name')
      .eq('id', item.family_id)
      .maybeSingle();
    familyName = fam?.name ?? null;
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return jsonResponse(500, { error: 'Servicio de IA no configurado' });
  const model = Deno.env.get('ENRICH_MODEL') ?? Deno.env.get('VISION_MODEL') ?? DEFAULT_MODEL;

  // ── 2) Llamar a la IA ──
  const t0 = Date.now();
  let parsed: ParsedEnrich | null = null;
  let rawResponse: unknown = null;
  try {
    const aiResp = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: buildPrompt(item.name, familyName) }],
      }),
    });
    if (!aiResp.ok) {
      const errTxt = await aiResp.text();
      console.error('[enrich-ingredient] IA HTTP', aiResp.status, errTxt);
      return jsonResponse(502, { error: 'Error del servicio de IA' });
    }
    rawResponse = await aiResp.json();
    const textOut = ((rawResponse as any).content ?? [])
      .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    parsed = extractJson(textOut);
  } catch (e) {
    console.error('[enrich-ingredient] error IA:', String(e));
    return jsonResponse(502, { error: 'Fallo llamando a la IA' });
  }
  const latencyMs = Date.now() - t0;

  if (!parsed) return jsonResponse(422, { error: 'La IA no devolvió una propuesta válida' });

  // ── 3) SANEAMIENTO anti-invención ──
  const allergens = Array.isArray(parsed.allergens)
    ? parsed.allergens
        .filter((a) => a && ALLERGEN_CODES.includes(a.code))
        .map((a) => ({
          code: a.code,
          state: ALLERGEN_STATES.includes(a.state) ? a.state : 'contains',
        }))
        // dedup por código
        .filter((a, i, arr) => arr.findIndex((x) => x.code === a.code) === i)
    : [];

  let waste: number | null = null;
  if (typeof parsed.default_waste_pct === 'number' &&
      parsed.default_waste_pct >= 0 && parsed.default_waste_pct <= 95) {
    waste = Math.round(parsed.default_waste_pct * 100) / 100;
  }

  const conservation = CONSERVATION_TYPES.includes(parsed.conservation_type as string)
    ? parsed.conservation_type : null;

  let shelfLife: number | null = null;
  if (typeof parsed.shelf_life_days === 'number' &&
      parsed.shelf_life_days >= 0 && parsed.shelf_life_days <= 3650) {
    shelfLife = Math.round(parsed.shelf_life_days);
  }

  const menuTags = Array.isArray(parsed.menu_tags)
    ? parsed.menu_tags
        .filter((t) => MENU_TAGS.includes(t))
        .filter((t, i, arr) => arr.indexOf(t) === i)
    : [];

  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence)) : null;

  // Nutrición: solo claves conocidas, numéricas y en rango sano (por 100 g).
  // energy hasta 900 kcal/100g (grasa pura ~900); el resto hasta 100 g/100g.
  const NUTRITION_KEYS: Record<string, number> = {
    energy_kcal: 900,
    fat_g: 100,
    saturated_fat_g: 100,
    carbs_g: 100,
    sugars_g: 100,
    fiber_g: 100,
    protein_g: 100,
    salt_g: 100,
  };
  let nutrition: Record<string, number> | null = null;
  if (parsed.nutrition && typeof parsed.nutrition === 'object') {
    const clean: Record<string, number> = {};
    for (const [key, max] of Object.entries(NUTRITION_KEYS)) {
      const v = parsed.nutrition[key];
      if (typeof v === 'number' && v >= 0 && v <= max) {
        clean[key] = Math.round(v * 100) / 100;
      }
    }
    if (Object.keys(clean).length > 0) nutrition = clean;
  }

  const cleanProposal = {
    allergens,
    default_waste_pct: waste,
    conservation_type: conservation,
    shelf_life_days: shelfLife,
    menu_tags: menuTags,
    nutrition,
    confidence,
  };

  // ── 4) Registrar la sesión (kind='enrich', pending_review) ──
  const { data: session, error: sessErr } = await sb
    .from('recipe_item_ai_session')
    .insert({
      recipe_item_id,
      account_id,
      kind: 'enrich',
      raw_response: rawResponse as unknown,
      parsed_result: cleanProposal as unknown,
      ai_model: model,
      ai_latency_ms: latencyMs,
      status: 'pending_review',
    })
    .select('id')
    .single();
  if (sessErr) {
    console.error('[enrich-ingredient] insert sesión:', sessErr.message);
    // No es fatal para el usuario: devolvemos la propuesta igualmente (solo
    // perderíamos la traza/telemetría). Pero lo marcamos.
    return jsonResponse(200, {
      session_id: null,
      proposal: cleanProposal,
      ai_model: model,
      ai_latency_ms: latencyMs,
      warning: 'No se pudo registrar la sesión IA',
    });
  }

  return jsonResponse(200, {
    session_id: session.id,
    proposal: cleanProposal,
    ai_model: model,
    ai_latency_ms: latencyMs,
  });
});
