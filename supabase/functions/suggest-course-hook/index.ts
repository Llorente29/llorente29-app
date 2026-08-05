// supabase/functions/suggest-course-hook/index.ts
//
// ENCARGO CODE — IA propone el gancho de WhatsApp de un curso (course.whatsapp_hook).
// Sin gancho, enqueue_training_notice deja el aviso en skip_reason='sin_gancho' y
// nunca se envía nada: esto es lo que evita que un curso nuevo nazca mudo.
//
// "IA propone, humano decide": devuelve el texto propuesto; NO escribe en la BBDD.
// El front (WhatsappHookCard / PublishHookModal en CoursesPage.tsx) lo pinta en un
// campo editable y es el admin quien guarda con coursesService.updateCourse.
//
// Patrón calcado de enrich-ingredient / suggest-item: auth JWT o x-internal-key,
// Anthropic vía ANTHROPIC_API_KEY, anti-invención (longitud/tono). corsHeaders
// inline (no import de ../_shared/cors.ts) porque el deploy vía MCP sube esta
// función de forma aislada y no resuelve imports fuera de su propia carpeta;
// mismo contenido exacto que supabase/functions/_shared/cors.ts.
//
// Guard de acceso: la lectura de `course`/`course_section` va con el JWT del
// usuario, así que la RLS existente (course_select / course_section_select —
// admin/manager de la cuenta del curso, o global + rol de oficina, o platform
// admin) es quien decide si el curso es visible. Si no lo es, la consulta
// simplemente no devuelve fila y respondemos 404 — no hace falta duplicar esa
// regla aquí.

import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// Tarea de texto corto y estructurado (no de datos), Haiku es más que suficiente
// y mucho más barato que Opus. Override por secreto HOOK_MODEL si hace falta.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const MAX_HOOK_LENGTH = 300;

interface SuggestHookRequest {
  course_id: string;
}

interface SectionForPrompt {
  title: string;
  body: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildPrompt(title: string, isMandatory: boolean, sections: SectionForPrompt[]): string {
  const sectionsBlock = sections.length > 0
    ? sections.map((s) => `### ${s.title}\n${s.body}`).join('\n\n')
    : '(sin secciones de teoría todavía — propón el gancho a partir solo del título)';
  return (
    `Eres quien redacta los avisos de WhatsApp de Folvy, una app de gestión para restaurantes.\n` +
    `Cuando a un empleado le toca un curso de formación interna, recibe un WhatsApp con un texto\n` +
    `ameno ("gancho") que le explique por qué merece la pena hacerlo. Escribe el gancho de este curso.\n\n` +
    `TÍTULO DEL CURSO: "${title}"\n` +
    `¿ES OBLIGATORIO (por ley o para toda la plantilla)?: ${isMandatory ? 'sí' : 'no'}\n\n` +
    `CONTENIDO DEL CURSO (secciones de teoría, para sacar un caso real de cocina):\n${sectionsBlock}\n\n` +
    `TONO — respétalo estrictamente:\n` +
    `- Corto: 1-2 frases, MENOS DE 300 CARACTERES en total (cabe en un WhatsApp junto al nombre y los minutos).\n` +
    `- Ameno, con un caso real de cocina que pique la curiosidad — nunca una definición de manual.\n` +
    `- Un emoji al final, relacionado con el tema del curso.\n` +
    `- Si es obligatorio, dilo explícito con *obligatorio por ley* o *obligatorio para toda la plantilla*\n` +
    `  (asterisco simple = negrita de WhatsApp; no uses ningún otro markdown ni HTML).\n\n` +
    `EJEMPLOS DEL TONO YA USADO EN FOLVY (no los copies, son solo referencia de estilo):\n` +
    `- Curso de manipulador: "Una olla caliente en la encimera \\"hasta que se enfríe sola\\"… ¿qué puede ` +
    `salir mal? Todo. Este curso es *obligatorio por ley* — y cuando lo hagas entenderás por qué. 🌡️"\n` +
    `- Curso de mermas: "Lo que tiras también lo has pagado. Cada merma es margen que se evapora. 🗑️"\n\n` +
    `Responde ÚNICAMENTE el texto del gancho. Sin comillas envolventes, sin explicaciones, sin JSON,\n` +
    `sin bloques de código, sin más markdown que *negrita* puntual.`
  );
}

/** Limpia lo que la IA pueda añadir de más (comillas, fences, prosa alrededor) y acota longitud. */
function cleanHook(raw: string): string | null {
  let text = raw.trim();
  text = text.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
  // Quita UNA comilla envolvente si la IA la puso (simples, dobles o tipográficas).
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    const pairs: Record<string, string> = { '"': '"', "'": "'", '“': '”', '«': '»' };
    if (pairs[first] === last) text = text.slice(1, -1).trim();
  }
  if (!text) return null;
  if (text.length > MAX_HOOK_LENGTH) {
    const cut = text.slice(0, MAX_HOOK_LENGTH - 1);
    const lastSpace = cut.lastIndexOf(' ');
    text = (lastSpace > MAX_HOOK_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…';
  }
  return text;
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

  let body: SuggestHookRequest;
  try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Body JSON inválido' }); }

  const { course_id } = body;
  if (!course_id) return jsonResponse(400, { error: 'Falta course_id' });

  // ── 1) Leer el curso (RLS aplica con el JWT del usuario: admin/manager de
  //      su cuenta, o global visible por rol de oficina, o platform admin) ──
  const { data: course, error: courseErr } = await sb
    .from('course')
    .select('id, title, is_mandatory')
    .eq('id', course_id)
    .maybeSingle();
  if (courseErr) return jsonResponse(500, { error: `Error leyendo el curso: ${courseErr.message}` });
  if (!course) return jsonResponse(404, { error: 'Curso no encontrado o sin acceso' });

  const { data: sectionRows, error: sectionsErr } = await sb
    .from('course_section')
    .select('title, body')
    .eq('course_id', course_id)
    .order('ord', { ascending: true });
  if (sectionsErr) return jsonResponse(500, { error: `Error leyendo las secciones: ${sectionsErr.message}` });
  const sections = (sectionRows ?? []) as SectionForPrompt[];

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return jsonResponse(500, { error: 'Servicio de IA no configurado' });
  const model = Deno.env.get('HOOK_MODEL') ?? DEFAULT_MODEL;

  // ── 2) Llamar a la IA ──
  let hook: string | null = null;
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
        max_tokens: 300,
        messages: [{ role: 'user', content: buildPrompt(course.title, course.is_mandatory, sections) }],
      }),
    });
    if (!aiResp.ok) {
      const errTxt = await aiResp.text();
      console.error('[suggest-course-hook] IA HTTP', aiResp.status, errTxt);
      return jsonResponse(502, { error: 'Error del servicio de IA' });
    }
    const raw = await aiResp.json();
    // deno-lint-ignore no-explicit-any
    const textOut = ((raw as any).content ?? [])
      // deno-lint-ignore no-explicit-any
      .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    hook = cleanHook(textOut);
  } catch (e) {
    console.error('[suggest-course-hook] error IA:', String(e));
    return jsonResponse(502, { error: 'Fallo llamando a la IA' });
  }

  if (!hook) return jsonResponse(422, { error: 'La IA no devolvió una propuesta válida' });

  return jsonResponse(200, { hook });
});
