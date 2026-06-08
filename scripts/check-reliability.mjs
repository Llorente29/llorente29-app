#!/usr/bin/env node
// scripts/check-reliability.mjs
//
// Verifica el RPC sales_mapping_reliability(account, from, to) DESDE LA APP
// (con sesión de usuario real, porque es SECURITY DEFINER y el guard lee auth.uid();
//  en SQL Editor / service_role reventaría).
//
// Llama al RPC sobre Folvy Interno con un rango amplio (cubre el histórico) y
// muestra la señal + el desglose del no-casado, comparándolo con lo esperado:
//   reliability ≈ 92,1 %  ·  status verde  ·  total ≈ 5.465,20 €  ·  casado ≈ 5.031,60 €
//   ciego desconocido (no_recipe) ≈ 284,90 € / 17 líneas
//   ciego calculable (no_menu_item) ≈ 148,70 € / 27 líneas
//
// Credenciales: igual que recast-sales.mjs (URL+anon de ../.env; email/password
// de FOLVY_EMAIL/FOLVY_PASSWORD o por consola).
//
// Uso (PowerShell):
//   $env:FOLVY_EMAIL="..."; $env:FOLVY_PASSWORD='...'; node scripts/check-reliability.mjs
//   (opcional) --account <uuid> --from 2025-01-01 --to 2027-01-01

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import readline from "node:readline";

const FOLVY_INTERNO = "00000000-0000-0000-0000-000000000001";

function parseArgs(argv) {
  // Rango por defecto amplio para cubrir todo el histórico cargado.
  const out = { account: FOLVY_INTERNO, from: "2025-01-01", to: "2027-01-01" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--account") out.account = argv[++i];
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else { console.error(`Argumento desconocido: ${a}`); process.exit(2); }
  }
  return out;
}
const args = parseArgs(process.argv);

const __dirname = dirname(fileURLToPath(import.meta.url));
function readDotEnv() {
  const path = resolve(__dirname, "..", ".env");
  const out = {};
  try {
    for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      out[key] = val;
    }
  } catch { /* sin .env */ }
  return out;
}
const dotenv = readDotEnv();
const SUPABASE_URL = process.env.SUPABASE_URL || dotenv.VITE_SUPABASE_URL || dotenv.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || dotenv.VITE_SUPABASE_ANON_KEY || dotenv.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("ERROR: falta URL o anon key (env o .env).");
  process.exit(2);
}

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}
function askHidden(q) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let first = true;
    rl._writeToOutput = (s) => { if (first) { process.stdout.write(q); first = false; } };
    rl.question(q, (a) => { rl.close(); process.stdout.write("\n"); res(a); });
  });
}
async function getCredentials() {
  let email = process.env.FOLVY_EMAIL;
  let password = process.env.FOLVY_PASSWORD;
  if (!email) email = await ask("Email: ");
  if (!password) password = await askHidden("Contraseña: ");
  if (!email || !password) { console.error("ERROR: email y contraseña obligatorios."); process.exit(2); }
  return { email, password };
}

function eur(n) { return `${Number(n ?? 0).toFixed(2)} €`; }

async function main() {
  console.log(`Verificación sales_mapping_reliability`);
  console.log(`  cuenta: ${args.account}${args.account === FOLVY_INTERNO ? "  (Folvy Interno)" : ""}`);
  console.log(`  rango:  ${args.from} → ${args.to}`);

  const { email, password } = await getCredentials();
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr || !auth?.user) {
    console.error(`\nERROR de login: ${authErr?.message ?? "sin usuario"}`);
    process.exit(1);
  }
  console.log(`\n✔ Login OK como: ${auth.user.email}`);

  const { data, error } = await sb.rpc("sales_mapping_reliability", {
    p_account_id: args.account,
    p_from: new Date(args.from + "T00:00:00Z").toISOString(),
    p_to: new Date(args.to + "T00:00:00Z").toISOString(),
  });
  if (error) {
    console.error(`\nERROR del RPC: ${error.message}`);
    await sb.auth.signOut();
    process.exit(1);
  }

  const r = Array.isArray(data) ? data[0] : data;
  if (!r) { console.error("\nEl RPC no devolvió filas."); await sb.auth.signOut(); process.exit(1); }

  const statusIcon = r.status === "verde" ? "🟢" : r.status === "ambar" ? "🟡" : "🔴";

  console.log(`\n===== SEÑAL DE FIABILIDAD =====`);
  console.log(`  ${statusIcon} fiabilidad: ${Number(r.reliability_pct).toFixed(2)} %   (umbral ${Number(r.threshold_pct).toFixed(0)} % → ${r.status})`);
  console.log(`  revenue total:    ${eur(r.revenue_total)}`);
  console.log(`  revenue casado:   ${eur(r.revenue_casado)}`);
  console.log(`  revenue sin casar:${eur(r.revenue_sin_casar)}`);
  console.log(`  líneas: ${r.lineas_casadas}/${r.lineas_total} casadas`);

  console.log(`\n===== DESGLOSE DEL DINERO CIEGO =====`);
  console.log(`  🔴 desconocido (no_recipe, coste NO estimable): ${eur(r.ciego_desconocido_eur)}  ·  ${r.ciego_desconocido_lineas} líneas`);
  console.log(`  🟡 calculable (no_menu_item, coste SÍ estimable): ${eur(r.ciego_calculable_eur)}  ·  ${r.ciego_calculable_lineas} líneas`);
  console.log(`  ⚪ otros (no_brand/ambiguous/residual):           ${eur(r.ciego_otros_eur)}  ·  ${r.ciego_otros_lineas} líneas`);

  // Comprobación blanda contra lo esperado del RECON.
  console.log(`\n===== Contraste con lo medido en el RECON =====`);
  const checks = [
    ["revenue_total ≈ 5465.20", Math.abs(Number(r.revenue_total) - 5465.20) <= 1],
    ["revenue_casado ≈ 5031.60", Math.abs(Number(r.revenue_casado) - 5031.60) <= 1],
    ["reliability ≈ 92.1 %", Math.abs(Number(r.reliability_pct) - 92.1) <= 0.5],
    ["status = verde", r.status === "verde"],
    ["no_recipe ≈ 284.90 € / 17", Math.abs(Number(r.ciego_desconocido_eur) - 284.90) <= 1 && r.ciego_desconocido_lineas === 17],
    ["no_menu_item ≈ 148.70 € / 27", Math.abs(Number(r.ciego_calculable_eur) - 148.70) <= 1 && r.ciego_calculable_lineas === 27],
  ];
  let allOk = true;
  for (const [label, ok] of checks) {
    if (!ok) allOk = false;
    console.log(`  ${ok ? "OK " : "⚠️ "}${label}`);
  }
  console.log(allOk
    ? `\n  ✅ La señal coincide con el RECON. Capa 4 verificada.`
    : `\n  ⚠️  Alguna cifra no coincide con el RECON: revisar antes de seguir.`);

  await sb.auth.signOut();
}

main().catch((e) => { console.error("FATAL:", e?.stack ?? String(e)); process.exit(1); });
