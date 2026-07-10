// supabase/functions/payroll-extract/index.ts
//
// Extractor de NÓMINAS (Folvy Team) — gemelo de ocr-albaran, mismo estilo.
// Lee el PDF de una nómina desde Storage, saca con Claude {DNI, periodo, bruto,
// SS empresa, total, base, líquido} en JSON estricto, VALIDA por totales (triple
// comprobación), casa por DNI con el empleado y escribe el coste real en
// payroll_cost. "IA propone, humano decide": si algo no cuadra → needs_review.
//
// Doble entrada como el OCR:
//   · App (subida manual): JWT del usuario → RLS scopea la cuenta.
//   · Interna (Gmail): header x-internal-key = SUPABASE_SERVICE_ROLE_KEY.
// Deploy NORMAL (no es webhook externo; la app llama con JWT, Gmail con service key).

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_VISION_MODEL = 'claude-opus-4-8';
const BUCKET = 'employee-documents';       // mismo bucket que documentsService
const TOLERANCE = 0.015;                    // 1,5% de descuadre máximo por redondeos

interface ExtractRequest {
  account_id: string;
  file_paths: string[];                     // rutas en employee-documents/{employeeId}/...
  source?: 'nomina_upload' | 'gmail';
  document_id?: string;                     // PDF ya adjuntado a la ficha (opcional)
  email_id?: string;                        // id del correo en Resend (traza, ingesta Gmail)
}

interface ParsedPayslip {
  payslip: {
    dni: string | null;
    employee_name: string | null;
    company_name: string | null;
    period_year: number | null;
    period_month: number | null;            // 1-12
    is_draft: boolean;                      // true si el documento dice BORRADOR
    gross_total: number | null;             // TOTAL DEVENGADO
    deductions_total: number | null;        // TOTAL A DEDUCIR (aportación trabajador + IRPF)
    net: number | null;                     // TOTAL LÍQUIDO A PERCIBIR
    contribution_base: number | null;       // base de cotización contingencias comunes
  };
  earnings_lines: { concept: string; amount: number }[];   // percepciones
  // Aportación EMPRESA por CAMPOS CON NOMBRE (molde fijo, no lista → no se pierden filas).
  employer_ss: {
    base: number | null;        // base de cotización CC (normalmente = contribution_base)
    cc: number | null;          // Contingencias comunes
    at_ep: number | null;       // AT y EP (accidentes) — tipo variable por actividad
    desempleo: number | null;   // Desempleo
    fogasa: number | null;      // Fondo Garantía Salarial
    formacion: number | null;   // SUMA de todas las líneas de Formación Profesional empresa
    mei: number | null;         // SUMA de todas las líneas de MEI empresa
    otros: number | null;       // cualquier otra aportación empresa, o 0
  };
  confidence: number;                       // 0..1
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildPrompt(): string {
  return (
    `Eres un experto en NÓMINAS españolas (recibos de salarios). Te paso el PDF de una nómina; ` +
    `puede traer 2 copias idénticas (EJEMPLAR PARA LA EMPRESA y PARA EL TRABAJADOR): son la MISMA nómina, ` +
    `extrae los datos UNA sola vez. Devuelve SOLO JSON ESTRICTO (sin texto alrededor, sin markdown) con esta forma:\n` +
    `{\n` +
    `  "payslip": {\n` +
    `    "dni": "<NIF/DNI del TRABAJADOR tal cual (con letra), o null>",\n` +
    `    "employee_name": "<nombre y apellidos del trabajador, o null>",\n` +
    `    "company_name": "<razón social de la empresa, o null>",\n` +
    `    "period_year": <año del periodo de liquidación, número>,\n` +
    `    "period_month": <mes del periodo, número 1-12>,\n` +
    `    "is_draft": <true SOLO si el documento indica BORRADOR, si no false>,\n` +
    `    "gross_total": <TOTAL DEVENGADO, número, o null>,\n` +
    `    "deductions_total": <TOTAL A DEDUCIR, número, o null>,\n` +
    `    "net": <TOTAL LÍQUIDO A PERCIBIR, número, o null>,\n` +
    `    "contribution_base": <base de cotización por Contingencias Comunes, número, o null>\n` +
    `  },\n` +
    `  "earnings_lines": [ { "concept": "<p.ej. SALARIO / PLUS / P.P EXTRAS / PRESTACIÓN>", "amount": <número> } ],\n` +
    `  "employer_ss": {\n` +
    `    "base": <base de cotización de Contingencias Comunes, número>,\n` +
    `    "cc": <importe de Contingencias comunes de la EMPRESA, número o null>,\n` +
    `    "at_ep": <importe de AT y EP / Accidentes de la EMPRESA, número o null>,\n` +
    `    "desempleo": <importe de Desempleo de la EMPRESA, número o null>,\n` +
    `    "fogasa": <importe de Fondo de Garantía Salarial, número o null>,\n` +
    `    "formacion": <SUMA de TODAS las líneas de Formación Profesional de la EMPRESA (puede haber 2: tipos 0,6 y 0,1), número o null>,\n` +
    `    "mei": <SUMA de TODAS las líneas de Cotización adicional MEI de la EMPRESA (puede haber 2: tipos 0,15 y 0,75), número o null>,\n` +
    `    "otros": <suma de cualquier OTRA línea de aportación empresa que no encaje arriba, o 0>\n` +
    `  },\n` +
    `  "confidence": <0..1>\n` +
    `}\n\n` +
    `REGLAS CRÍTICAS:\n` +
    `- NÚMEROS con punto decimal (1530.20), sin separador de miles, sin símbolo de moneda.\n` +
    `- "employer_ss" = SOLO el bloque "APORTACIÓN EMPRESA" (lo que paga la empresa), NUNCA las deducciones ` +
    `del trabajador ni el IRPF. Rellena CADA campo por su NOMBRE; si un concepto no existe en la nómina, ponlo a null (o 0 en "otros").\n` +
    `- "formacion" y "mei" pueden tener VARIAS líneas en la nómina (distintos tipos): SÚMALAS todas en su campo. No te dejes ninguna.\n` +
    `- OJO: el TOTAL DEVENGADO (bruto real del mes, con incidencias como bajas) puede ser DISTINTO de la ` +
    `base de cotización. No los confundas: gross_total = TOTAL DEVENGADO; contribution_base = base de CC.\n` +
    `- Si un dato no aparece con claridad, ponlo a null; no lo inventes. Si la nómina es ilegible, "confidence" baja.\n`
  );
}

function extractJson(textOut: string): ParsedPayslip | null {
  try {
    const clean = textOut.replace(/```json|```/g, '').trim();
    return JSON.parse(clean) as ParsedPayslip;
  } catch {
    return null;
  }
}

function near(a: number, b: number): boolean {
  if (b === 0) return Math.abs(a) < 0.01;
  return Math.abs(a - b) / Math.abs(b) <= TOLERANCE;
}

// Tipos legales FIJOS de aportación empresa (los deterministas). AT&EP, formación
// y MEI se leen tal cual (AT&EP varía por actividad; formación/MEI son pequeños).
const RATE_CC = 0.236;        // Contingencias comunes
const RATE_FOGASA = 0.002;    // FOGASA
const RATE_DESEMPLEO_INDEF = 0.055;
const RATE_DESEMPLEO_TEMP = 0.067;

// Validación:
//   1) Σ earnings_lines ≈ gross_total (devengado tiene total limpio)
//   2) gross_total − deductions_total ≈ net (líquido también)
//   3) SS empresa = suma de los CAMPOS con nombre (no se pierden filas). ANCLA
//      DURA: CC, desempleo y FOGASA se comprueban contra base × tipo LEGAL.
function validate(p: ParsedPayslip): {
  gross: number | null; employer_ss: number | null; net: number | null;
  checks: { earnings: boolean | null; net: boolean | null; employer_ss: boolean | null };
  needs_review: boolean; reasons: string[];
} {
  const reasons: string[] = [];
  const ps = p.payslip ?? ({} as ParsedPayslip['payslip']);
  const ss = p.employer_ss ?? ({} as ParsedPayslip['employer_ss']);

  const earnLines = p.earnings_lines ?? [];
  const earnSum = earnLines.reduce((a, l) => a + (typeof l.amount === 'number' ? l.amount : 0), 0);
  const haveEarn = earnLines.length > 0;
  const gross = ps.gross_total ?? (haveEarn ? Number(earnSum.toFixed(2)) : null);
  const net = ps.net ?? null;

  // SS empresa = suma de los campos con nombre.
  const ssParts = [ss.cc, ss.at_ep, ss.desempleo, ss.fogasa, ss.formacion, ss.mei, ss.otros];
  const haveSs = ssParts.some((x) => typeof x === 'number');
  const employerSs = haveSs
    ? Number(ssParts.reduce((a, x) => a + (typeof x === 'number' ? x : 0), 0).toFixed(2))
    : null;
  const base = ss.base ?? ps.contribution_base ?? null;

  // 1) devengos
  let cEarn: boolean | null = null;
  if (ps.gross_total != null && haveEarn) {
    cEarn = near(earnSum, ps.gross_total);
    if (!cEarn) reasons.push(`Σ percepciones (${earnSum.toFixed(2)}) ≠ total devengado (${ps.gross_total.toFixed(2)})`);
  } else reasons.push('No se pudo validar devengos (faltan importes)');

  // 2) líquido
  let cNet: boolean | null = null;
  if (gross != null && ps.deductions_total != null && ps.net != null) {
    cNet = near(gross - ps.deductions_total, ps.net);
    if (!cNet) reasons.push(`Devengado − deducciones (${(gross - ps.deductions_total).toFixed(2)}) ≠ líquido (${ps.net.toFixed(2)})`);
  }

  // 3) SS empresa: ancla legal sobre la base
  let cSs: boolean | null = null;
  if (base != null && base > 0) {
    const anchors: boolean[] = [];
    if (typeof ss.cc === 'number') {
      const ok = near(ss.cc, base * RATE_CC);
      anchors.push(ok);
      if (!ok) reasons.push(`CC (${ss.cc.toFixed(2)}) ≠ base×23,6% (${(base * RATE_CC).toFixed(2)})`);
    }
    if (typeof ss.fogasa === 'number') {
      const ok = near(ss.fogasa, base * RATE_FOGASA);
      anchors.push(ok);
      if (!ok) reasons.push(`FOGASA (${ss.fogasa.toFixed(2)}) ≠ base×0,2% (${(base * RATE_FOGASA).toFixed(2)})`);
    }
    if (typeof ss.desempleo === 'number') {
      const ok = near(ss.desempleo, base * RATE_DESEMPLEO_INDEF) || near(ss.desempleo, base * RATE_DESEMPLEO_TEMP);
      anchors.push(ok);
      if (!ok) reasons.push(`Desempleo (${ss.desempleo.toFixed(2)}) ≠ base×5,5% ni ×6,7%`);
    }
    cSs = anchors.length > 0 ? anchors.every(Boolean) : null;
  } else {
    reasons.push('Sin base de cotización para anclar la SS empresa');
  }

  if (typeof p.confidence === 'number' && p.confidence < 0.6) reasons.push('Confianza de lectura baja');
  if (!ps.dni) reasons.push('Sin DNI legible');
  if (gross == null || employerSs == null || !(employerSs > 0)) reasons.push('Falta bruto o SS empresa');

  const needsReview =
    cEarn === false || cNet === false || cSs === false ||
    gross == null || employerSs == null || !(employerSs > 0) || base == null || !ps.dni ||
    (typeof p.confidence === 'number' && p.confidence < 0.6);

  return {
    gross, employer_ss: employerSs, net,
    checks: { earnings: cEarn, net: cNet, employer_ss: cSs },
    needs_review: needsReview, reasons,
  };
}

const normDni = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

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

  let body: ExtractRequest;
  try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Body JSON inválido' }); }

  const { account_id, file_paths, source = 'nomina_upload', document_id, email_id } = body;
  if (!account_id) return jsonResponse(400, { error: 'Falta account_id' });
  if (!file_paths || file_paths.length === 0) return jsonResponse(400, { error: 'Faltan file_paths' });

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return jsonResponse(500, { error: 'Servicio de IA no configurado' });
  const model = Deno.env.get('VISION_MODEL') ?? DEFAULT_VISION_MODEL;

  // ── 1) Leer PDF(s) de Storage como base64 ──
  const contentBlocks: unknown[] = [];
  let firstFileSizeKb = 0;
  for (const path of file_paths) {
    const { data: file, error: dlErr } = await sb.storage.from(BUCKET).download(path);
    if (dlErr || !file) return jsonResponse(400, { error: `No se pudo leer ${path}: ${dlErr?.message ?? 'desconocido'}` });
    const buf = new Uint8Array(await file.arrayBuffer());
    if (firstFileSizeKb === 0) firstFileSizeKb = Math.round(buf.length / 1024);
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const b64 = btoa(binary);
    const mime = file.type || 'application/pdf';
    if (mime === 'application/pdf') {
      contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
    } else {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } });
    }
  }

  // ── 2) Llamar a Claude ──
  const t0 = Date.now();
  let parsed: ParsedPayslip | null = null;
  let rawResponse: unknown = null;
  try {
    const aiResp = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: [...contentBlocks, { type: 'text', text: buildPrompt() }] }],
      }),
    });
    if (!aiResp.ok) {
      const errTxt = await aiResp.text();
      console.error('[payroll-extract] IA HTTP', aiResp.status, errTxt);
      return jsonResponse(502, { error: 'Error del servicio de IA', detail: errTxt.slice(0, 500) });
    }
    rawResponse = await aiResp.json();
    // deno-lint-ignore no-explicit-any
    const textOut = (((rawResponse as any).content ?? []) as any[])
      .filter((b) => b.type === 'text').map((b) => b.text).join('');
    parsed = extractJson(textOut);
  } catch (e) {
    console.error('[payroll-extract] error IA:', String(e));
    return jsonResponse(502, { error: 'Fallo llamando a la IA' });
  }
  const latencyMs = Date.now() - t0;

  if (!parsed || !parsed.payslip) {
    await sb.from('payroll_inbox').upsert({
      account_id, source, email_id: email_id ?? null,
      file_path: file_paths[0] ?? null, document_id: document_id ?? null,
      status: 'error', reason: 'La IA no pudo leer la nómina',
      raw: { rawResponse } as unknown, updated_at: new Date().toISOString(),
    }, { onConflict: 'file_path' });
    return jsonResponse(422, { error: 'La IA no devolvió una nómina legible', raw: rawResponse });
  }

  // ── 3) Validación por totales ──
  const validation = validate(parsed);
  const ps = parsed.payslip;

  // ── 4) Casado por DNI dentro de la cuenta (2 queries, sin join embebido) ──
  let matchedEmployeeId: string | null = null;
  let matchReason = '';
  const target = normDni(ps.dni);
  if (target.length > 0) {
    const { data: locs, error: locErr } = await sb.from('locations').select('id').eq('account_id', account_id);
    if (locErr) console.error('[payroll-extract] locations:', locErr.message);
    const locIds = ((locs ?? []) as { id: string }[]).map((l) => l.id);
    if (locIds.length === 0) {
      matchReason = 'La cuenta no tiene locales visibles (¿permisos/RLS?)';
    } else {
      const { data: emps, error: empErr } = await sb.from('employees').select('id, dni').in('location_id', locIds);
      if (empErr) console.error('[payroll-extract] empleados:', empErr.message);
      const matches = ((emps ?? []) as { id: string; dni: string | null }[]).filter((e) => normDni(e.dni) === target);
      if (matches.length === 1) matchedEmployeeId = matches[0].id;
      else if (matches.length === 0) matchReason = 'Ningún empleado con ese DNI';
      else matchReason = 'Varios empleados con ese DNI';
    }
  } else {
    matchReason = 'Sin DNI en la nómina';
  }

  const needsReview = validation.needs_review || !matchedEmployeeId;
  const reasons = [...validation.reasons, ...(matchReason ? [matchReason] : [])];
  const totalCost = (validation.gross != null && validation.employer_ss != null)
    ? Number((validation.gross + validation.employer_ss).toFixed(2))
    : null;

  // ── 5) Escribir en payroll_cost si casa el empleado y hay periodo ──
  let payrollCostId: string | null = null;
  if (matchedEmployeeId && ps.period_year && ps.period_month) {
    const { data: pc, error: pcErr } = await sb.from('payroll_cost').upsert({
      account_id,
      employee_id: matchedEmployeeId,
      period_year: ps.period_year,
      period_month: ps.period_month,
      status: ps.is_draft ? 'borrador' : 'definitiva',
      gross: validation.gross,
      employer_ss: validation.employer_ss,
      total_cost: totalCost,
      contribution_base: ps.contribution_base,
      net: validation.net,
      source,
      document_id: document_id ?? null,
      needs_review: needsReview,
      raw: { parsed, validation } as unknown,
    }, { onConflict: 'employee_id,period_year,period_month,status' }).select('id').single();
    if (pcErr) console.error('[payroll-extract] upsert payroll_cost:', pcErr.message);
    else payrollCostId = pc?.id ?? null;
  }

  // ── 5b) Registrar SIEMPRE en payroll_inbox: nada desaparece en silencio ──
  const inboxStatus = payrollCostId ? 'matched' : 'unmatched';
  const { error: inboxErr } = await sb.from('payroll_inbox').upsert({
    account_id, source, email_id: email_id ?? null,
    file_path: file_paths[0] ?? null, document_id: document_id ?? null,
    read_dni: ps.dni, read_name: ps.employee_name,
    period_year: ps.period_year ?? null, period_month: ps.period_month ?? null,
    gross: validation.gross, employer_ss: validation.employer_ss, total_cost: totalCost,
    status: inboxStatus,
    reason: inboxStatus === 'unmatched' ? (reasons.join(' · ') || 'Sin casar') : null,
    matched_employee_id: matchedEmployeeId,
    payroll_cost_id: payrollCostId,
    raw: { parsed, validation } as unknown,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'file_path' });
  if (inboxErr) console.error('[payroll-extract] upsert payroll_inbox:', inboxErr.message);

  // ── 5c) Adjuntar el PDF a la ficha del empleado si casó y no venía ya adjunto
  //         (caso ingesta Gmail; la subida manual ya trae document_id) ──
  if (matchedEmployeeId && !document_id && file_paths[0]) {
    const fp = file_paths[0];
    const { data: existingDoc } = await sb.from('documents').select('id').eq('file_path', fp).limit(1);
    if (!existingDoc || existingDoc.length === 0) {
      const name = fp.split('/').pop() || 'nomina.pdf';
      const { error: docErr } = await sb.from('documents').insert({
        employee_id: matchedEmployeeId,
        type: 'nomina',
        name,
        file_path: fp,
        file_size_kb: firstFileSizeKb,
        uploaded_by: null,
        uploaded_role: 'gestor',
        notes: 'Ingesta automática de nómina',
      });
      if (docErr) console.error('[payroll-extract] adjuntar documento:', docErr.message);
    }
  }

  // ── 6) Devolver lo leído + validación + casado (para la pantalla de revisión) ──
  return jsonResponse(200, {
    status: needsReview ? 'needs_review' : 'ok',
    matched_employee_id: matchedEmployeeId,
    payroll_cost_id: payrollCostId,
    period: ps.period_year && ps.period_month ? { year: ps.period_year, month: ps.period_month } : null,
    is_draft: ps.is_draft,
    gross: validation.gross,
    employer_ss: validation.employer_ss,
    total_cost: totalCost,
    net: validation.net,
    checks: validation.checks,
    reasons,
    parsed,
    ai_model: model,
    ai_latency_ms: latencyMs,
  });
});
