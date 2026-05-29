#!/usr/bin/env node
/**
 * tspoon-extract-puente.mjs
 * -------------------------------------------------------------------------
 * Extrae de la API de tSpoonLab el PUENTE entre:
 *    nombre/id de plato (component)  <->  plu (código del producto en la TPV = organization_product_id de Last)
 * más el coste y % food cost que tspoon ya calcula.
 *
 * Objetivo: poder casar los escandallos (Platos.xlsx) con los dish de Folvy
 * de forma DETERMINISTA vía: nombre_tspoon -> plu -> lastapp_product_map -> recipe_item_id.
 *
 * NO escribe en ninguna BBDD. Solo lee de tspoon y genera un CSV local.
 *
 * USO (PowerShell):
 *   $env:TSPOON_USER="tu_usuario"
 *   $env:TSPOON_PASS="tu_password"
 *   node scripts/tspoon-extract-puente.mjs
 *
 * Genera: tspoon_puente.csv  (columnas: customer, idCustomer, component, idComponent, plu, costComponent, percentCost, cost, iva, idMenu, menu)
 *
 * Si algo falla, imprime el detalle del error y el cuerpo de la respuesta
 * para poder diagnosticar (la doc de la API es de hace ~3 años).
 * -------------------------------------------------------------------------
 */

import { writeFileSync } from "node:fs";

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
const USER = process.env.TSPOON_USER;
const PASS = process.env.TSPOON_PASS;

if (!USER || !PASS) {
  console.error("ERROR: define las variables de entorno TSPOON_USER y TSPOON_PASS.");
  console.error('PowerShell:  $env:TSPOON_USER="..."  ;  $env:TSPOON_PASS="..."');
  process.exit(1);
}

// La doc usa www.tspoonlab.com/recipes/api. Dejamos base configurable por si es app.tspoonlab.com.
const BASE = process.env.TSPOON_BASE || "https://www.tspoonlab.com/recipes/api";

const PAGE_ROWS = 200;     // filas por página en los listados paginados
const SLEEP_MS = 250;      // cortesía entre llamadas

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------------------
// 1. LOGIN  ->  token "rememberme"
//    La doc: POST form-urlencoded username/password a /login, devuelve el token
//    que luego va en el header "rememberme:<token>".
// ----------------------------------------------------------------------------
async function login() {
  const body = new URLSearchParams({ username: USER, password: PASS }).toString();
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Login falló: HTTP ${res.status}\n${text.slice(0, 500)}`);
  }
  // El token puede venir en el cuerpo o en una cabecera. Probamos ambos.
  let token = text.trim();
  // A veces el cuerpo es solo el token; a veces viene con prefijo. Limpiamos comillas.
  token = token.replace(/^["']|["']$/g, "").trim();
  if (!token || token.length < 8) {
    // probar cabecera set-cookie / authorization
    const hdr = res.headers.get("set-cookie") || res.headers.get("authorization") || "";
    console.error("Aviso: el cuerpo del login no parece un token claro. Cuerpo:", JSON.stringify(text.slice(0, 200)));
    console.error("Cabeceras relevantes:", hdr.slice(0, 200));
    if (hdr) token = hdr;
  }
  return token;
}

// Construye los headers comunes. order = idOrderCenter (centro de coste), opcional.
function headers(token, order) {
  const h = { "rememberme": token };
  if (order) h["order"] = order;
  return h;
}

// GET genérico con manejo de error y parseo JSON tolerante.
async function apiGet(path, token, order, params) {
  await sleep(SLEEP_MS);
  const url = new URL(`${BASE}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: headers(token, order) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${path} -> HTTP ${res.status}\n${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    console.error(`Aviso: respuesta de ${path} no es JSON. Primeros 300 chars:\n${text.slice(0, 300)}`);
    return null;
  }
}

// ----------------------------------------------------------------------------
// 2. CENTROS DE COSTE
//    Doc: el id de centro es idOrderCenter de UserOrderCenter.
//    El endpoint exacto de listado no está en este artículo; probamos el habitual.
// ----------------------------------------------------------------------------
async function listCenters(token) {
  // Intentos posibles según la doc de "obtener lista de centros de coste"
  const candidates = ["/listOrderCenters", "/orderCenters", "/listUserOrderCenters", "/user/orderCenters"];
  for (const path of candidates) {
    try {
      const data = await apiGet(path, token);
      if (data) {
        console.log(`✓ Centros obtenidos vía ${path}`);
        return data;
      }
    } catch (e) {
      console.error(`  (probado ${path}: ${e.message.split("\n")[0]})`);
    }
  }
  throw new Error("No se pudo listar centros de coste con los endpoints probados. Revisa la doc o pásame el nombre exacto del endpoint.");
}

// ----------------------------------------------------------------------------
// 3. CLIENTES (= marcas/canales de venta en el modelo tspoon)
// ----------------------------------------------------------------------------
async function listCustomers(token, order) {
  const out = [];
  let start = 0;
  for (;;) {
    const data = await apiGet("/listCustomersPaged", token, order, { start, rows: PAGE_ROWS });
    const rows = Array.isArray(data) ? data : (data?.rows || data?.content || []);
    if (!rows || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < PAGE_ROWS) break;
    start += PAGE_ROWS;
  }
  return out;
}

// ----------------------------------------------------------------------------
// 4. PRODUCTOS A LA VENTA de un cliente  ->  AQUÍ ESTÁ EL PLU (código TPV)
// ----------------------------------------------------------------------------
async function listComponents(token, order, idCustomer) {
  const out = [];
  let start = 0;
  for (;;) {
    const data = await apiGet(`/customer/${idCustomer}/components/paged`, token, order, { start, rows: PAGE_ROWS });
    const rows = Array.isArray(data) ? data : (data?.rows || data?.content || []);
    if (!rows || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < PAGE_ROWS) break;
    start += PAGE_ROWS;
  }
  return out;
}

// ----------------------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------------------
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  console.log("== tspoon: login ==");
  const token = await login();
  console.log("✓ token obtenido (len", token.length, ")");

  console.log("\n== centros de coste ==");
  const centers = await listCenters(token);
  console.log(JSON.stringify(centers, null, 2).slice(0, 1500));

  // Detectar el campo idOrderCenter en la respuesta (sea cual sea su forma)
  const arr = Array.isArray(centers) ? centers : (centers?.rows || centers?.content || []);
  if (!arr.length) {
    console.error("No hay centros en la respuesta. Pega arriba lo que devolvió y ajusto el script.");
    process.exit(1);
  }
  console.log(`\nCentros encontrados: ${arr.length}`);
  arr.forEach((c, i) => console.log(`  [${i}] ${c.descr || c.name || c.descrOrderCenter || "?"}  id=${c.idOrderCenter || c.id || "?"}`));

  // Recorremos TODOS los centros y juntamos todo en un único CSV.
  // (Cada centro tiene sus propios plu por marca; los necesitamos todos.)
  const puente = [];
  for (const center of arr) {
    const order = center.idOrderCenter || center.id;
    const centerName = center.descr || center.name || order;
    console.log(`\n======================================================`);
    console.log(`== CENTRO: ${centerName} (order=${order}) ==`);

    let customers;
    try {
      customers = await listCustomers(token, order);
    } catch (e) {
      console.error(`  ! no se pudieron listar clientes del centro ${centerName}: ${e.message.split("\n")[0]}`);
      continue;
    }
    console.log(`  Clientes: ${customers.length}`);

    for (const cust of customers) {
      try {
        const comps = await listComponents(token, order, cust.id);
        for (const k of comps) {
          puente.push({
            center: centerName,
            idCenter: order,
            customer: cust.descr || "",
            idCustomer: cust.id,
            component: k.component || "",
            idComponent: k.idComponent || "",
            plu: k.plu || "",
            costComponent: k.costComponent ?? "",
            percentCost: k.percentCost ?? "",
            cost: k.cost ?? "",
            iva: k.iva ?? "",
            idMenu: k.idMenu || "",
            menu: k.menu || "",
          });
        }
        console.log(`    ${cust.descr || cust.id}: ${comps.length} productos`);
      } catch (e) {
        console.error(`    ! cliente ${cust.descr || cust.id} falló: ${e.message.split("\n")[0]}`);
      }
    }
  }

  // Volcar CSV único con TODOS los centros
  const cols = ["center", "idCenter", "customer", "idCustomer", "component", "idComponent", "plu", "costComponent", "percentCost", "cost", "iva", "idMenu", "menu"];
  const lines = [cols.join(",")];
  for (const r of puente) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  writeFileSync("tspoon_puente_todos.csv", lines.join("\n"), "utf8");

  // Resumen
  const conPlu = puente.filter((r) => r.plu && r.plu.length > 0).length;
  const porCentro = {};
  for (const r of puente) porCentro[r.center] = (porCentro[r.center] || 0) + 1;
  console.log(`\n===== Resumen TOTAL (todos los centros) =====`);
  console.log(`  Filas (productos a la venta): ${puente.length}`);
  console.log(`  Con plu (código TPV):         ${conPlu}`);
  console.log(`  Sin plu:                       ${puente.length - conPlu}`);
  console.log(`  Por centro:`);
  for (const [c, n] of Object.entries(porCentro)) console.log(`    ${c}: ${n}`);
  console.log(`  CSV generado: tspoon_puente_todos.csv`);
  console.log(`\nMuestra (center | component | plu):`);
  puente.filter((r) => r.plu).slice(0, 10).forEach((r) => console.log(`  ${r.center.slice(0, 18).padEnd(18)} | ${r.component.slice(0, 30).padEnd(30)} | ${r.plu}`));
}

main().catch((e) => {
  console.error("\nERROR FATAL:\n", e.message);
  process.exit(1);
});
