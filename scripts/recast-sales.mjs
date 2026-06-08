#!/usr/bin/env node
// scripts/recast-sales.mjs
//
// Ejecuta recast_lastapp_sales(p_account_id) CON SESIÓN DE USUARIO REAL.
//
// Por qué con login y NO con service_role:
//   recast_lastapp_sales es SECURITY DEFINER y su guard llama a
//   current_user_is_admin() / current_user_is_admin_or_manager_of(account),
//   que leen auth.uid(). Con service_role (o en el SQL Editor) auth.uid() es
//   NULL → el guard lanza excepción. Hace falta una sesión de usuario válida
//   (signInWithPassword), que es el patrón fijado para probar SECURITY DEFINER.
//
// Qué hace, en orden:
//   1) Login con el usuario que se le pase (debe ser admin de plataforma o
//      admin/manager de la cuenta objetivo). Imprime con qué email entró.
//   2) Snapshot ANTES (distribución de map_source / unmapped_reason en las
//      líneas de ventas lastapp de la cuenta), leído bajo RLS con esa sesión.
//   3) Si --dry-run: para aquí (no llama al RPC, no escribe nada).
//   4) Si no: llama a recast_lastapp_sales(account). El propio RPC devuelve el
//      DESPUÉS (recuento real tras el update). Lo imprime y lo compara con lo
//      esperado por diseño (~214 casadas / 56 no_recipe / ~104 no_menu_item /
//      0 no_brand / 0 ambiguous). Las desviaciones se marcan, no se asume nada.
//
// Credenciales:
//   URL + anon key: se leen de ../.env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY),
//     o de las env SUPABASE_URL / SUPABASE_ANON_KEY si están definidas (override).
//   Email + password: de las env FOLVY_EMAIL / FOLVY_PASSWORD; si faltan, se
//     piden por consola (la contraseña, oculta) y NO quedan en el historial.
//
// Uso (PowerShell, desde la raíz del repo):
//   node scripts/recast-sales.mjs --dry-run            # inspección: solo ANTES
//   node scripts/recast-sales.mjs                      # recasa la cuenta por defecto
//   node scripts/recast-sales.mjs --account <uuid>     # otra cuenta
//
// Cuenta por defecto: Folvy Interno (banco de pruebas).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import readline from "node:readline";

const FOLVY_INTERNO = "00000000-0000-0000-0000-000000000001";

// ============================================================
// CLI args
// ============================================================
function parseArgs(argv) {
  const out = { dryRun: false, account: FOLVY_INTERNO };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--account") out.account = argv[++i];
    else {
      console.error(`Argumento desconocido: ${a}`);
      process.exit(2);
    }
  }
  return out;
}
const args = parseArgs(process.argv);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(args.account)) {
  console.error(`--account no parece un UUID: ${args.account}`);
  process.exit(2);
}

// ============================================================
// Credenciales: URL + anon de .env (con override por env); login por env/consola
// ============================================================
const __dirname = dirname(fileURLToPath(import.meta.url));

function readDotEnv() {
  // Lee ../.env relativo al script (script en scripts/, .env en la raíz).
  const path = resolve(__dirname, "..", ".env");
  const out = {};
  try {
    const txt = readFileSync(path, "utf8");
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  } catch {
    /* sin .env: se usarán solo las env de proceso */
  }
  return out;
}

const dotenv = readDotEnv();
const SUPABASE_URL =
  process.env.SUPABASE_URL || dotenv.VITE_SUPABASE_URL || dotenv.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  dotenv.VITE_SUPABASE_ANON_KEY ||
  dotenv.SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  console.error("ERROR: no encuentro la URL (env SUPABASE_URL o VITE_SUPABASE_URL en .env)");
  process.exit(2);
}
if (!SUPABASE_ANON_KEY) {
  console.error("ERROR: no encuentro la anon key (env SUPABASE_ANON_KEY o VITE_SUPABASE_ANON_KEY en .env)");
  process.exit(2);
}

function ask(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(query, (a) => { rl.close(); res(a.trim()); }));
}

// Prompt de contraseña sin eco (truco _writeToOutput); no toca el historial.
function askHidden(query) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let first = true;
    rl._writeToOutput = (s) => {
      if (first) { process.stdout.write(query); first = false; return; }
      // silencia el eco de cada tecla
    };
    rl.question(query, (a) => { rl.close(); process.stdout.write("\n"); res(a); });
  });
}

async function getCredentials() {
  let email = process.env.FOLVY_EMAIL;
  let password = process.env.FOLVY_PASSWORD;
  if (!email) email = await ask("Email (usuario admin/manager de Folvy): ");
  if (!password) password = await askHidden("Contraseña: ");
  if (!email || !password) {
    console.error("ERROR: email y contraseña son obligatorios.");
    process.exit(2);
  }
  return { email, password };
}

// ============================================================
// Helpers
// ============================================================
async function loadAllPaged(sb, table, select, filters) {
  // filters: array de [col, value] para eq
  const pageSize = 1000;
  const out = [];
  let offset = 0;
  while (true) {
    let q = sb.from(table).select(select);
    for (const [col, val] of filters) q = q.eq(col, val);
    const { data, error } = await q.range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function snapshot(sb, accountId) {
  // 1) ids de ventas lastapp de la cuenta
  const sales = await loadAllPaged(sb, "sale", "id", [
    ["account_id", accountId],
    ["source", "lastapp"],
  ]);
  const saleIds = new Set(sales.map((s) => s.id));

  // 2) todas las líneas de la cuenta; nos quedamos con las de esas ventas
  const lines = await loadAllPaged(
    sb,
    "sale_line",
    "sale_id, map_source, unmapped_reason, menu_item_id",
    [["account_id", accountId]],
  );

  const tally = {
    ventas: saleIds.size,
    total: 0,
    casadas: 0, // menu_item_id no nulo
    by_map_source: {},
    by_reason: {},
  };
  for (const l of lines) {
    if (!saleIds.has(l.sale_id)) continue;
    tally.total++;
    if (l.menu_item_id) tally.casadas++;
    const ms = l.map_source ?? "(null)";
    tally.by_map_source[ms] = (tally.by_map_source[ms] ?? 0) + 1;
    const r = l.unmapped_reason ?? "(null)";
    tally.by_reason[r] = (tally.by_reason[r] ?? 0) + 1;
  }
  return tally;
}

function printTally(label, t) {
  console.log(`\n===== ${label} =====`);
  console.log(`  ventas lastapp:   ${t.ventas}`);
  console.log(`  líneas totales:   ${t.total}`);
  console.log(`  casadas (menu_item no nulo): ${t.casadas}`);
  console.log(`  por map_source:`);
  for (const k of Object.keys(t.by_map_source).sort())
    console.log(`    ${k.padEnd(12)} ${t.by_map_source[k]}`);
  console.log(`  por unmapped_reason:`);
  for (const k of Object.keys(t.by_reason).sort())
    console.log(`    ${k.padEnd(14)} ${t.by_reason[k]}`);
}

// Esperado por DISEÑO (no es una aserción dura; marca desviaciones para revisar).
const ESPERADO = {
  lineas_casadas: 214,
  lineas_no_recipe: 56,
  lineas_no_menu_item: 104,
  lineas_no_brand: 0,
  lineas_ambiguous: 0,
};
const TOLERANCIA = 5; // "~104" / "~214": holgura pequeña; fuera de esto = revisar

function compararConEsperado(row) {
  console.log(`\n===== Comparación con lo esperado (diseño) =====`);
  let alerta = false;
  for (const [k, esp] of Object.entries(ESPERADO)) {
    const real = Number(row[k] ?? 0);
    const diff = real - esp;
    const ok = Math.abs(diff) <= TOLERANCIA;
    if (!ok) alerta = true;
    const tag = ok ? "OK " : "⚠️ ";
    const signo = diff > 0 ? `+${diff}` : `${diff}`;
    console.log(`  ${tag}${k.padEnd(20)} real=${String(real).padStart(4)}  esperado≈${String(esp).padStart(4)}  (${signo})`);
  }
  if (alerta) {
    console.log(`\n  ⚠️  Hay desviaciones fuera de tolerancia (±${TOLERANCIA}).`);
    console.log(`     PARAR aquí: la lógica del recasado puede tener un fallo.`);
    console.log(`     No construir nada encima hasta entenderlo.`);
  } else {
    console.log(`\n  ✅ Recasado dentro de lo esperado. Dato limpio para construir encima.`);
  }
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log(`Recast Last.app sales`);
  console.log(`  URL:      ${SUPABASE_URL}`);
  console.log(`  cuenta:   ${args.account}${args.account === FOLVY_INTERNO ? "  (Folvy Interno)" : ""}`);
  console.log(`  modo:     ${args.dryRun ? "DRY-RUN (solo ANTES, no escribe)" : "RECASAR (escribe)"}`);

  const { email, password } = await getCredentials();

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Login
  const { data: authData, error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr || !authData?.user) {
    console.error(`\nERROR de login: ${authErr?.message ?? "sin usuario"}`);
    console.error(`  (Revisa email/contraseña. Debe ser admin de plataforma o admin/manager de la cuenta.)`);
    process.exit(1);
  }
  console.log(`\n✔ Login OK como: ${authData.user.email}  (uid ${authData.user.id})`);

  // 2) Snapshot ANTES
  const antes = await snapshot(sb, args.account);
  printTally("ANTES", antes);

  if (args.dryRun) {
    console.log(`\n(DRY-RUN: no se ha llamado al RPC. Nada se ha escrito.)`);
    console.log(`Si el ANTES tiene sentido, vuelve a ejecutar SIN --dry-run para recasar.`);
    await sb.auth.signOut();
    return;
  }

  // 3) Llamada al RPC (devuelve el DESPUÉS)
  console.log(`\nLlamando a recast_lastapp_sales('${args.account}')...`);
  const { data: rpcData, error: rpcErr } = await sb.rpc("recast_lastapp_sales", {
    p_account_id: args.account,
  });
  if (rpcErr) {
    console.error(`\nERROR del RPC: ${rpcErr.message}`);
    if (/sin acceso a la cuenta/i.test(rpcErr.message)) {
      console.error(`  El guard rechazó: este usuario no es admin de plataforma ni admin/manager de la cuenta.`);
    }
    await sb.auth.signOut();
    process.exit(1);
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!row) {
    console.error(`\nEl RPC no devolvió filas. Inesperado: revisar.`);
    await sb.auth.signOut();
    process.exit(1);
  }

  console.log(`\n===== DESPUÉS (lo devuelve el propio RPC) =====`);
  console.log(`  ventas procesadas:    ${row.ventas_procesadas}`);
  console.log(`  líneas totales:       ${row.lineas_total}`);
  console.log(`  casadas:              ${row.lineas_casadas}`);
  console.log(`  no_brand:             ${row.lineas_no_brand}`);
  console.log(`  no_recipe:            ${row.lineas_no_recipe}`);
  console.log(`  no_menu_item:         ${row.lineas_no_menu_item}`);
  console.log(`  ambiguous:            ${row.lineas_ambiguous}`);
  console.log(`  respetadas (manual/ignored/delisted): ${row.lineas_respetadas}`);

  // 4) Diff rápido casadas antes→después
  console.log(`\n  casadas: ${antes.casadas} → ${row.lineas_casadas}  (${row.lineas_casadas - antes.casadas >= 0 ? "+" : ""}${row.lineas_casadas - antes.casadas})`);

  compararConEsperado(row);

  await sb.auth.signOut();
}

main().catch((e) => {
  console.error("FATAL:", e?.stack ?? String(e));
  process.exit(1);
});
