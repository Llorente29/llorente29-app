// supabase/functions/propose-count-reasons/index.ts
//
// INSPECTOR DE REVISIÓN DEL CONTEO — Edge Function.
//
// Para las líneas de un conteo que salen FUERA DE TOLERANCIA, propone el MOTIVO
// (reason_code) más probable de la diferencia, con confianza y una explicación
// didáctica. La IA NO conoce la causa real: propone la causa TÍPICA del patrón
// de variación para ayudar al responsable a decidir. "IA propone, humano decide".
//
// Anti-invención: devuelve confianza; el front decide cómo mostrarla y NUNCA
// auto-aplica (el responsable da un clic para usar la sugerencia). Si el patrón
// no es claro, confianza baja (y normalmente 'otro').
//
// No toca BBDD: recibe en el body las líneas ya cargadas por el cliente (bajo su
// RLS) y devuelve solo texto. Auth: JWT válido (gateway verify_jwt + getUser).
// Calcado de propose-modifier-impacts (Anthropic, parseo JSON, CORS).

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'jsr:@supabase/supabase-js@^2';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
// Tope de líneas por invocación (coste/latencia acotados).
const MAX_LINES = 40;

// Códigos válidos = REASON_CODES de inventoryCountService.ts. Debe coincidir.
const VALID_REASONS = [
  'merma', 'caducado', 'rotura', 'robo_desconocido',
  'error_escandallo', 'error_recepcion', 'traspaso', 'otro',
];

interface LineIn {
  id: string;
  itemName: string;
  familyName?: string | null;
  abcClass?: string | null;
  varianceQty?: number | null;
  variancePct?: number | null;
  varianceValue?: number | null;
  unitAbbr?: string | null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return '?';
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(v);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse(401, { error: 'Falta cabecera Authorization' });
  }
  const jwt = authHeader.replace('Bearer ', '').trim();

  // Validar usuario autenticado (regla: getUser, no decode manual).
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const sb = createClient(supabaseUrl, serviceKey);
  const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonResponse(401, { error: 'Sesión no válida' });
  }

  let body: { lines?: LineIn[] };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Body JSON inválido' });
  }
  const allLines = Array.isArray(body.lines) ? body.lines : [];
  if (allLines.length === 0) {
    return jsonResponse(200, { suggestions: [] });
  }
  const lines = allLines.slice(0, MAX_LINES);

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    return jsonResponse(500, { error: 'Servicio de IA no configurado' });
  }
  const model = Deno.env.get('MAPPING_MODEL') ?? DEFAULT_MODEL;

  const lineBlock = lines
    .map((l, n) => {
      const v = fmtNum(l.varianceQty);
      const pct = l.variancePct !== null && l.variancePct !== undefined
        ? `${l.variancePct > 0 ? '+' : ''}${l.variancePct.toFixed(1)}%` : '?';
      const eur = l.varianceValue !== null && l.varianceValue !== undefined
        ? `${l.varianceValue > 0 ? '+' : ''}${fmtNum(l.varianceValue)} €` : '?';
      const sign = (l.varianceQty ?? 0) < 0 ? 'NEGATIVA (falta)' : (l.varianceQty ?? 0) > 0 ? 'POSITIVA (sobra)' : '0';
      return `${n + 1}. id=${l.id} | ${l.itemName} | familia: ${l.familyName ?? '—'} | ABC: ${l.abcClass ?? '—'} | ` +
        `variación: ${v} ${l.unitAbbr ?? ''} (${pct}, ${eur}) — ${sign}`;
    })
    .join('\n');

  const prompt =
    `Eres un experto en control de inventario de cocina (food cost). Te doy líneas de un ` +
    `conteo que han salido FUERA DE TOLERANCIA (lo contado no cuadra con lo teórico). ` +
    `Para cada una, propón el MOTIVO más probable de la diferencia.\n\n` +
    `NO conoces la causa real: propones la causa TÍPICA para ese patrón, para AYUDAR al ` +
    `responsable a decidir (él confirma). Si el patrón no es claro, usa confianza baja.\n\n` +
    `Motivos válidos (usa EXACTAMENTE uno de estos códigos):\n` +
    `- merma: producto estropeado o desperdiciado en uso normal.\n` +
    `- caducado: pasó de fecha.\n` +
    `- rotura: se rompió o derramó.\n` +
    `- robo_desconocido: falta sin explicación (posible robo o error grave).\n` +
    `- error_escandallo: la receta consume distinto de lo real (suele dar variación constante).\n` +
    `- error_recepcion: se recibió distinto de lo apuntado.\n` +
    `- traspaso: se movió a otro local sin registrar.\n` +
    `- otro: nada de lo anterior encaja.\n\n` +
    `Pistas orientativas (no reglas absolutas):\n` +
    `- Variación NEGATIVA en perecedero o alta rotación (ABC A) → suele ser merma.\n` +
    `- Variación NEGATIVA grande y puntual en producto caro → revisar robo/rotura/traspaso.\n` +
    `- Variación POSITIVA (sobra) → suele ser error_recepcion o error_escandallo.\n` +
    `- Variación pequeña → puede ser error_escandallo o merma normal.\n\n` +
    `LÍNEAS:\n${lineBlock}\n\n` +
    `Devuelve SOLO un JSON (sin markdown), un array con un objeto por línea, en el MISMO orden:\n` +
    `[{"id":"<id>","reason_code":"<código válido>","confidence":<0..1>,"explanation":"<breve, en español, empezando por 'Suele' o 'Puede', explicando el porqué del patrón>"}]`;

  let parsed: Array<{ id?: string; reason_code?: string; confidence?: number; explanation?: string }> = [];
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
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!aiResp.ok) {
      console.error('[propose-count-reasons] IA HTTP', aiResp.status);
      return jsonResponse(502, { error: 'La IA no respondió' });
    }
    const aiData = await aiResp.json();
    const textOut = (aiData.content ?? [])
      .filter((b: { type?: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text ?? '')
      .join('');
    parsed = JSON.parse(textOut.replace(/```json|```/g, '').trim());
    if (!Array.isArray(parsed)) parsed = [];
  } catch (e) {
    console.error('[propose-count-reasons] error IA/parse:', String(e));
    return jsonResponse(502, { error: 'No se pudo interpretar la respuesta de la IA' });
  }

  // Validar y normalizar: solo ids conocidos, código válido, confianza 0..1.
  const knownIds = new Set(lines.map((l) => l.id));
  const suggestions = parsed
    .filter((s) => s.id && knownIds.has(s.id))
    .map((s) => {
      const code = VALID_REASONS.includes(s.reason_code ?? '') ? s.reason_code! : 'otro';
      let conf = typeof s.confidence === 'number' ? s.confidence : 0;
      if (conf < 0) conf = 0;
      if (conf > 1) conf = 1;
      return {
        id: s.id,
        reasonCode: code,
        confidence: conf,
        explanation: (s.explanation ?? '').toString().slice(0, 240),
      };
    });

  console.log(`[propose-count-reasons] ${suggestions.length}/${lines.length} sugerencias`);
  return jsonResponse(200, { suggestions });
});
