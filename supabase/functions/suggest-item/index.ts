// supabase/functions/suggest-item/index.ts
//
// COPILOTO DE ALTA (C2.2.b.6) — Edge Function de TEXTO (no visión).
// Dada una línea de albarán (texto del proveedor) y la lista REAL de familias de
// la cuenta, propone: nombre interno limpio, familia (id EXACTO de la lista o null)
// y unidad base (unit|weight|volume). "IA propone, humano decide": la respuesta
// prerellena el alta y es editable. NO inventa familias: solo elige de las dadas.
//
// Auth: usuario autenticado (JWT) o llamada interna (x-internal-key). Patrón
// calcado de ocr-albaran, pero sin Storage ni visión. Modelo oculto vía env.

import { corsHeaders } from '../_shared/cors.ts';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-opus-4-8';

interface SuggestRequest {
  raw_text: string;
  supplier_name?: string | null;
  families: { id: string; name: string }[];
}

interface Suggestion {
  name: string | null;
  family_id: string | null;
  base_unit: 'unit' | 'weight' | 'volume' | null;
  confidence: number;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildPrompt(rawText: string, supplierName: string | null, families: { id: string; name: string }[]): string {
  const famList = families.map(f => `  - ${f.id} :: ${f.name}`).join('\n');
  return (
    `Eres un asistente de aprovisionamiento de hostelería en España. Te doy el texto de\n` +
    `un artículo tal como aparece en el albarán de un proveedor, y la lista de FAMILIAS\n` +
    `disponibles de este restaurante. Propón cómo dar de alta el artículo en su cocina.\n\n` +
    `TEXTO DEL ALBARÁN: "${rawText}"\n` +
    (supplierName ? `PROVEEDOR: "${supplierName}"\n` : '') +
    `\nFAMILIAS DISPONIBLES (id :: nombre):\n${famList}\n\n` +
    `Devuelve JSON ESTRICTO (sin texto adicional, sin markdown) con esta forma EXACTA:\n` +
    `{\n` +
    `  "name": "<nombre interno CORTO y limpio del artículo, en español; quita marca comercial,\n` +
    `            formato y coletillas. Ej: 'METRO Chef queso grana padano DOP cuña 10 meses Italia'\n` +
    `            -> 'Queso grana padano'>",\n` +
    `  "family_id": "<el id EXACTO de la familia que mejor encaje, COPIADO de la lista de arriba,\n` +
    `                 o null si ninguna encaja con seguridad>",\n` +
    `  "base_unit": "<unit|weight|volume: cómo se mide este artículo en cocina. 'unit' si se cuenta\n` +
    `                 por piezas/unidades; 'weight' si por peso (kg/g); 'volume' si por volumen (l/ml)>",\n` +
    `  "confidence": <0 a 1: tu confianza en la propuesta>\n` +
    `}\n\n` +
    `REGLAS CRÍTICAS:\n` +
    `- NO inventes familias. "family_id" DEBE ser uno de los id de la lista, o null. Nunca un id que\n` +
    `  no esté en la lista. Si dudas entre varias o ninguna encaja claramente, usa null.\n` +
    `- "name" en español, claro, sin marca ni formato ni cantidad. Si no sabes acortarlo, deja el texto tal cual.\n` +
    `- "base_unit": piensa cómo se usa en cocina, no cómo se vende. Un queso en cuña -> weight; huevos -> unit;\n` +
    `  aceite -> volume; tarrina de hummus que se usa por peso -> weight.\n` +
    `- Responde ÚNICAMENTE el JSON.`
  );
}

function extractJson(textOut: string): Suggestion | null {
  try {
    const clean = textOut.replace(/```json|```/g, '').trim();
    return JSON.parse(clean) as Suggestion;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse(401, { error: 'Missing Authorization header' });

  let body: SuggestRequest;
  try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Body JSON inválido' }); }

  const rawText = (body.raw_text ?? '').trim();
  const families = Array.isArray(body.families) ? body.families : [];
  if (!rawText) return jsonResponse(400, { error: 'Falta raw_text' });

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return jsonResponse(500, { error: 'Servicio de IA no configurado' });
  const model = Deno.env.get('VISION_MODEL') ?? DEFAULT_MODEL;

  let suggestion: Suggestion | null = null;
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
        max_tokens: 512,
        messages: [{ role: 'user', content: buildPrompt(rawText, body.supplier_name ?? null, families) }],
      }),
    });
    if (!aiResp.ok) {
      const errTxt = await aiResp.text();
      console.error('[suggest-item] IA HTTP', aiResp.status, errTxt);
      return jsonResponse(502, { error: 'Error del servicio de IA' });
    }
    const rawResponse = await aiResp.json();
    const textOut = ((rawResponse as any).content ?? [])
      .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    suggestion = extractJson(textOut);
  } catch (e) {
    console.error('[suggest-item] error IA:', String(e));
    return jsonResponse(502, { error: 'Fallo llamando a la IA' });
  }

  if (!suggestion) return jsonResponse(422, { error: 'La IA no devolvió una sugerencia válida' });

  // Saneamiento anti-invención: family_id debe ser uno de los dados, o null.
  const validFamily = suggestion.family_id && families.some(f => f.id === suggestion!.family_id)
    ? suggestion.family_id : null;
  const baseUnit = ['unit', 'weight', 'volume'].includes(suggestion.base_unit as string)
    ? suggestion.base_unit : null;

  return jsonResponse(200, {
    name: suggestion.name && suggestion.name.trim() !== '' ? suggestion.name.trim() : null,
    family_id: validFamily,
    base_unit: baseUnit,
    confidence: typeof suggestion.confidence === 'number' ? suggestion.confidence : null,
  });
});
