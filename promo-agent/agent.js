// folvy-promo-agent v3.16 — robot de promos (Glovo)
// v3.16 (05/07/2026): POS DIRIGIDO POR LOCAL — si el job trae payload.pos_hint
//   (locations.glovo_pos_hint: 'cañaveral'/'florencio'/'camichi'), el robot restringe
//   sus objetivos SOLO a los establecimientos que casen el hint (además de la allowlist).
//   La promo del local X se publica/cancela únicamente en el POS del local X.
//   Sin pos_hint: comportamiento v3.15 (todos los POS de la allowlist).
// v3.15 (05/07/2026): acción END (cancelar promo en Glovo) sobre la LISTA GLOBAL de
//   Promociones (/promotion/vendor-deals/view-performance): matcher estricto
//   (Activo + marca + Público 'Todos' + fecha de inicio del payload + allowlist),
//   confirmación del modal 'Estás a punto de cancelar' (jamás Volver), VERIFICACIÓN
//   contra la lista (la fila deja de estar Activo) y libro de a bordo por store ID.
//   pause/resume -> NO EXISTEN en Glovo (la cancelación es irreversible): se reportan
//   como no soportados con mensaje claro. Deuda de pantalla: ocultar esos botones.
// v3.14 (05/07/2026): MULTI-LOCAL (publica en TODOS los establecimientos de la allowlist,
//   con LIBRO DE A BORDO por job en screenshots/{job.id}-done.json: un reintento reanuda
//   SOLO los pendientes, jamás duplica — lección v3.11) + DATEPICKER robusto (teclea la
//   fecha, fallback a clic de día con navegación de mes) con VERIFICACIÓN DURA del input:
//   si la fecha fin de Glovo no coincide con la esperada, la autoauditoría tumba el job
//   (fechas falsas rompen el relevo always-on y el bloqueo busy del agente).
// v2: popups eliminados · botones Editar por índice de sección · autoauditoría del resumen
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "fs";

const cfg = JSON.parse(readFileSync("./config.json", "utf8"));
mkdirSync("./screenshots", { recursive: true });
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function rpc(fn, body) {
  const r = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "apikey": cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const claim  = () => rpc("claim_promo_push_jobs", { p_secret: cfg.PUSH_AGENT_SECRET, p_platform: "glovo", p_limit: 1 });
const report = (id, ok, ref, err) => rpc("report_promo_push_job",
  { p_secret: cfg.PUSH_AGENT_SECRET, p_job_id: id, p_ok: ok, p_external_ref: ref ?? null, p_error: err ?? null });

// LIBRO DE A BORDO por job: qué establecimientos ya se publicaron (anti-duplicados en reintentos)
const ledgerPath = (jobId) => `./screenshots/${jobId}-done.json`;
const readLedger = (jobId) => { try { return JSON.parse(readFileSync(ledgerPath(jobId), "utf8")); } catch { return []; } };
const addLedger  = (jobId, pos) => { const l = readLedger(jobId); if (!l.includes(pos)) l.push(pos); writeFileSync(ledgerPath(jobId), JSON.stringify(l, null, 1)); };

let ctx, page;
async function ensureBrowser() {
  if (page && !page.isClosed()) return;
  ctx = await chromium.launchPersistentContext("./glovo-profile", {
    headless: cfg.HEADLESS, viewport: { width: 1440, height: 900 },
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  page = ctx.pages()[0] ?? await ctx.newPage();
}
async function ensureLogin() {
  await page.goto("https://portal.glovoapp.com/", { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 3; i++) {
    if (!page.url().includes("/login")) return;
    log("  login necesario…");
    await page.getByRole("textbox", { name: /e-?mail/i }).fill(cfg.GLOVO_EMAIL);
    await page.getByRole("textbox", { name: /contraseña/i }).fill(cfg.GLOVO_PASSWORD);
    await page.getByTestId("login-button").click();
    await page.waitForTimeout(5000);
    // OTP de 6 dígitos (2FA de Glovo): no podemos leer el email -> humano
    const otp = page.locator('#mui-7');
    if (await otp.isVisible().catch(() => false)) {
      log("  🙋 Glovo pide CÓDIGO OTP (te llegó por email/SMS) — tecléalo TÚ en la ventana (espero 3 min)");
      await otp.waitFor({ state: "hidden", timeout: 180000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }
  }
  if (page.url().includes("/login")) throw new Error("login fallido");
}

// Anti-bot de Glovo ("Pulsar y mantener pulsado"): lo intenta el robot; si no, espera al humano
async function solveHumanCheck() {
  const btn = page.getByRole("button", { name: /pulsar y mantener/i });
  for (let i = 0; i < 2; i++) {
    if (!(await btn.isVisible().catch(() => false))) return;
    log("  🤖 anti-bot detectado: intentando press-and-hold…");
    const box = await btn.boundingBox();
    if (!box) break;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
    await page.mouse.down(); await page.waitForTimeout(4000); await page.mouse.up();
    await page.waitForTimeout(2000);
  }
  if (await btn.isVisible().catch(() => false)) {
    log("  🙋 NO PUEDO con el anti-bot — RESUÉLVELO TÚ en la ventana del robot (espero 3 min)");
    await btn.waitFor({ state: "hidden", timeout: 180000 });
    log("  ✅ anti-bot resuelto por humano, sigo");
  }
}

// Mata popups/overlays (el "¡Nuevo! Mejorar tu promoción" y similares)
async function killPopups() {
  await solveHumanCheck();
  await page.keyboard.press("Escape").catch(() => {});
  const closers = page.locator('[aria-label*="lose" i], [aria-label*="errar" i], button:has-text("✕"), button:has-text("×")');
  const n = await closers.count();
  for (let i = 0; i < n; i++) await closers.nth(i).click({ timeout: 800 }).catch(() => {});
}

// Abre el editor de una sección por su TÍTULO usando el índice del botón Editar
// Orden del asistente item-level: Detalles(0) · Puntos de venta(1) · Menú(2) · Calendario(3) · Presupuesto(4)
// Orden full-menu:               Detalles(0) · Puntos de venta(1) · Calendario(2) · Presupuesto(3)
async function openEdit(idx, tag) {
  await killPopups();
  const btns = page.getByText("Editar", { exact: true });
  const total = await btns.count();
  if (idx >= total) throw new Error(`paso '${tag}': solo hay ${total} 'Editar' visibles (esperaba índice ${idx})`);
  // Clic + VERIFICAR que el panel se abrió (si no, reintentar con clic forzado)
  const panelOpen = async () =>
    (await page.locator('[role="dialog"], aside').last().isVisible().catch(() => false));
  for (let attempt = 0; attempt < 3; attempt++) {
    await btns.nth(idx).scrollIntoViewIfNeeded();
    if (attempt === 0) await btns.nth(idx).click({ timeout: 8000 });
    else if (attempt === 1) await btns.nth(idx).click({ force: true });
    else await btns.nth(idx).locator("xpath=ancestor-or-self::button | xpath=ancestor::*[1]").first().click({ force: true });
    await page.waitForTimeout(1500);
    if (await panelOpen()) { log(`  (editor '${tag}' abierto)`); return; }
    await killPopups();
  }
  throw new Error(`paso '${tag}': el clic en Editar no abre el panel (3 intentos)`);
}
async function saveEditor(tag) {
  await killPopups();
  // El botón de guardar suele estar al FONDO del panel lateral: scrollear dentro
  const panel = page.locator('[role="dialog"], aside').last();
  if (await panel.isVisible().catch(() => false)) {
    await panel.hover().catch(() => {});
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 400);
    await page.waitForTimeout(500);
  }
  // 1º: botón con texto de guardar; 2º: cualquier botón dentro del panel lateral (el CTA verde);
  // 3º: la ✕ del panel (los editores de Glovo aplican al cerrar)
  const byText = page.getByText(/^(Guardar|Aplicar|Confirmar|Hecho|Aceptar|Continuar|Listo)$/).last();
  if (await byText.isVisible().catch(() => false)) {
    await byText.click(); await page.waitForTimeout(1200); return;
  }
  const dialogBtn = page.locator('[role="dialog"] button, aside button').last();
  if (await dialogBtn.isVisible().catch(() => false)) {
    const label = (await dialogBtn.textContent().catch(() => "")) ?? "";
    if (!/eliminar|cancelar|borrar/i.test(label)) {
      await dialogBtn.click(); await page.waitForTimeout(1200);
      log(`  (editor '${tag}' cerrado con botón: '${label.trim() || "sin texto"}')`);
      return;
    }
  }
  const closeX = page.locator('[aria-label*="lose" i], [aria-label*="errar" i]').last();
  if (await closeX.isVisible().catch(() => false)) {
    await closeX.click(); await page.waitForTimeout(1200);
    log(`  (editor '${tag}' cerrado con la ✕)`); return;
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  log(`  ⚠️ editor '${tag}' cerrado con Escape — verificar en resumen si el cambio se aplicó`);
}
async function assertEditorClosed(tag) {
  const open = await page.locator('[role="dialog"], aside').last().isVisible().catch(() => false);
  if (open) throw new Error(`paso '${tag}': el editor sigue abierto tras guardar`);
}

// Enumera los establecimientos de la marca que casan la ALLOWLIST (formato "Marca - MAD - Calle")
async function listTargets(p) {
  await page.goto("https://portal.glovoapp.com/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500); await solveHumanCheck(); await killPopups();
  await page.getByTestId("desktop-brand-view-button").click({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const esc = p.brand_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const candidates = page.getByText(new RegExp("^" + esc + "\\s+-\\s+MAD\\s+-\\s+", "i"));
  const nCand = await candidates.count();
  const allowed = (cfg.GLOVO_ALLOWED_POS ?? []).map(s => s.toLowerCase());
  const targets = [];
  for (let i = 0; i < nCand; i++) {
    const txt = ((await candidates.nth(i).textContent()) ?? "").trim();
    if (allowed.length === 0 || allowed.some(a => txt.toLowerCase().includes(a))) {
      if (!targets.includes(txt)) targets.push(txt); // dedupe: el desplegable repite el texto
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  if (targets.length === 0)
    throw new Error(`ningún establecimiento de '${p.brand_name}' casa con GLOVO_ALLOWED_POS (${nCand} candidatos)`);
  // v3.16: POS dirigido por local — el hint del payload restringe a SU establecimiento
  if (p.pos_hint) {
    const hint = String(p.pos_hint).toLowerCase();
    const hinted = targets.filter(t => t.toLowerCase().includes(hint));
    if (hinted.length === 0)
      throw new Error(`pos_hint '${p.pos_hint}': ningún establecimiento de '${p.brand_name}' lo casa (candidatos: ${targets.join(" | ")})`);
    log(`  pos_hint '${p.pos_hint}': ${hinted.length} de ${targets.length} establecimientos`);
    return hinted;
  }
  return targets;
}

// Selecciona un establecimiento en el header global (el asistente lo hereda)
async function selectPos(posName) {
  await page.goto("https://portal.glovoapp.com/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500); await solveHumanCheck(); await killPopups();
  await page.getByTestId("desktop-brand-view-button").click({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.getByText(posName, { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);
  log(`  punto de venta: ${posName}`);
}

// ORQUESTADOR multi-local: publica en TODOS los targets, con libro de a bordo anti-duplicados
async function createGlovoPromo(job) {
  const p = job.payload;
  const itemLevel = Array.isArray(p.menu_item_ids) && p.menu_item_ids.length > 0;
  const targets = await listTargets(p);
  log(`  establecimientos objetivo (${targets.length}): ${targets.join(" | ")}`);
  const done = readLedger(job.id);
  const okPos = [...done]; const failPos = []; const refs = [];
  for (let i = 0; i < targets.length; i++) {
    const posName = targets[i];
    if (done.includes(posName)) { log(`  ↷ '${posName}' ya publicada (libro de a bordo) — no se duplica`); continue; }
    await selectPos(posName);
    const r = await publishAtPos(job, p, itemLevel, posName, i + 1).catch(e => ({ ok: false, err: e.message }));
    if (cfg.DRY_RUN) return r; // en DRY_RUN se evalúa solo el primer POS pendiente (humo rápido)
    if (r.ok) { addLedger(job.id, posName); okPos.push(posName); refs.push(r.ref); log(`  ✅ publicada en '${posName}'`); }
    else failPos.push(`${posName} → ${r.err}`);
  }
  if (failPos.length === 0)
    return { ok: true, ref: refs.join(" | ") || "todas publicadas previamente (libro de a bordo)" };
  return { ok: false, err: `PARCIAL — OK en: ${okPos.join(", ") || "ninguno"} · FALLO en: ${failPos.join(" · ")} — el reintento reanudará SOLO los pendientes` };
}

// Publica UNA promo en el establecimiento ya seleccionado (el asistente completo de Glovo)
async function publishAtPos(job, p, itemLevel, posName, posIdx) {
  const shot = async (tag) => {
    const f = `./screenshots/${job.id}-pos${posIdx}-${tag}.png`;
    await page.screenshot({ path: f, fullPage: true }); log("  📸", f); return f;
  };
  const submitSection = async (tag) => {
    await page.getByTestId("form-section-submit-button").click({ timeout: 8000 })
      .catch(() => { throw new Error(`paso '${tag}': no encontré form-section-submit-button`); });
    await page.waitForTimeout(1200);
  };

  // 1) Ir al asistente
  await page.getByTestId("vendor_deals-nav-item").click({ timeout: 10000 });
  await page.waitForTimeout(1500); await killPopups();
  if (itemLevel) await page.getByTestId("item-level-card").getByTestId("vfdcard-title").click();
  else await page.getByTestId("full-menu-card").getByTestId("vfdcard-title").click()
    .catch(async () => { // fallback si el testid del full-menu difiere
      await page.getByText("Todo el menú", { exact: false }).first().click();
    });
  await page.waitForTimeout(2000); await killPopups();
  await page.getByTestId("tooltip-close").click({ timeout: 2000 }).catch(() => {});

  // 2) DETALLES: chip de % + Prime OFF + submit
  await page.getByTestId("discount-section").getByText("Editar").click({ timeout: 10000 });
  await page.waitForTimeout(1200);
  const want = Math.round(p.value);
  const chip = [60,55,50,45,40,35,30,25,20,15,10].filter(v => v <= want)[0];
  if (!chip) throw new Error(`no hay chip de Glovo para ${want}%`);
  if (chip !== want) log(`  ⚠️ % ajustado al chip: ${want}% -> ${chip}%`);
  // Dos "10%" posibles (chip del descuento y "+10%" del Prime): coger el del bloque de descuento
  const chipBtn = page.getByRole("button", { name: `${chip}%`, exact: true }).first();
  await chipBtn.click();
  const sw = page.getByRole("switch");
  if (await sw.isVisible().catch(() => false)) { await sw.uncheck().catch(() => {}); log("  Prime extra: OFF"); }
  await shot("detalles"); await submitSection("detalles");

  // 3) MENÚ (item-level): expandir acordeones y marcar por nombre
  if (itemLevel) {
    await page.getByTestId("menu-section").getByText("Editar").click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    // Flujo real de Glovo (verificado a mano): el buscador solo lleva a la categoría.
    // Correcto: EXPANDIR todas las categorías (chevron .cape-icon) y marcar dentro.
    await page.waitForTimeout(1000);
    // SCOPE: solo el drawer lateral (testid del codegen), no la página de detrás
    const drawer = page.getByTestId("custom-drawer-content").last();
    const scope = (await drawer.isVisible().catch(() => false))
      ? drawer : page.locator('[role="dialog"], aside').last();
    const chevrons = scope.locator("summary .cape-icon");
    const nc = await chevrons.count();
    log(`  categorías a desplegar: ${nc}`);
    for (let i = 0; i < nc; i++) {
      await chevrons.nth(i).scrollIntoViewIfNeeded().catch(() => {});
      await chevrons.nth(i).click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(800);
    // Verdad del estado = el contador del botón "Confirmar productos del menú (N)"
    const readCount = async () => {
      const t = (await page.getByText(/Confirmar productos del menú/i).first()
        .textContent().catch(() => "")) ?? "";
      const m = t.match(/\((\d+)\)/); return m ? parseInt(m[1]) : 0;
    };
    let found = 0;
    for (const name of (p.menu_item_names ?? [])) {
      const row = scope.getByText(name, { exact: false }).first();
      if (!(await row.isVisible().catch(() => false))) {
        log("  ⚠️ plato no encontrado en Glovo:", name); continue;
      }
      found++;
      const before = await readCount();
      const container = row.locator("xpath=ancestor::*[starts-with(@data-testid,'plnr-')][1]");
      const target = (await container.count()) > 0 ? container.first()
        : row.locator("xpath=ancestor::*[self::li or self::div][2]").first();
      // Intentos: checkbox por role -> input -> clic en la esquina izquierda de la fila
      const tries = [
        async () => target.getByRole("checkbox").first().click({ force: true, timeout: 1500 }),
        async () => target.locator('input[type="checkbox"]').first().click({ force: true, timeout: 1500 }),
        async () => { const b = await target.boundingBox(); if (b) await page.mouse.click(b.x + 18, b.y + b.height / 2); },
      ];
      let ok = false;
      for (const t of tries) {
        await t().catch(() => {});
        await page.waitForTimeout(400);
        if ((await readCount()) > before) { ok = true; break; }
      }
      if (!ok) log("  ⚠️ visible pero NO se pudo marcar:", name);
    }
    const totalMarked = await readCount();
    log(`  platos marcados (contador REAL de Glovo): ${totalMarked} de ${(p.menu_item_names ?? []).length} en el alcance`);
    if (totalMarked === 0) throw new Error("menú: ningún plato quedó marcado (contador de Glovo en 0)");
    await shot("platos");
    // El drawer del menú tiene SU botón: "Confirmar productos del menú (N)"
    const confirmBtn = page.getByText(/Confirmar productos del menú/i).first();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click(); await page.waitForTimeout(1200);
      log("  menú confirmado");
    } else {
      await submitSection("menú");
    }
  }

  // 4) CALENDARIO: fecha fin = ends_at del payload (fecha inicio: default hoy).
  //    v3.14: teclear la fecha directamente (más fiable que cazar botones de día),
  //    fallback a clic de día CON navegación de mes, y VERIFICACIÓN DURA del valor
  //    del input: si Glovo no tiene la fecha esperada, la autoauditoría tumba el job
  //    (una fecha falsa rompe el relevo always-on y el bloqueo busy del agente).
  let dateIssue = null;
  if (p.ends_at) {
    await page.getByTestId("schedule-section").getByText("Editar").click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const end = new Date(p.ends_at);
    const expected = `${String(end.getDate()).padStart(2, "0")}/${String(end.getMonth() + 1).padStart(2, "0")}/${end.getFullYear()}`;
    const endInput = page.getByRole("textbox", { name: "dd/MM/yyyy" }).nth(1);
    if (await endInput.isVisible().catch(() => false)) {
      // Camino 1: teclear la fecha en el input
      await endInput.click(); await page.waitForTimeout(300);
      await page.keyboard.press("Control+a").catch(() => {});
      await page.keyboard.type(expected, { delay: 40 }).catch(() => {});
      await page.keyboard.press("Enter").catch(() => {});
      await page.waitForTimeout(800);
      let got = (await endInput.inputValue().catch(() => "")).trim();
      if (got !== expected) {
        // Camino 2: datepicker con navegación de mes (hasta 3 saltos por si ends_at cae en otro mes)
        await endInput.click(); await page.waitForTimeout(500);
        const dayRe = new RegExp(end.toLocaleDateString("es-ES", { weekday: "long" }) + ",? ?" + end.getDate() + " de", "i");
        for (let hop = 0; hop < 3; hop++) {
          const dayBtn = page.getByRole("button", { name: dayRe }).first();
          if (await dayBtn.isVisible().catch(() => false)) { await dayBtn.click(); break; }
          const next = page.getByRole("button", { name: /siguiente|next/i }).first();
          if (!(await next.isVisible().catch(() => false))) break;
          await next.click(); await page.waitForTimeout(500);
        }
        await page.waitForTimeout(600);
        got = (await endInput.inputValue().catch(() => "")).trim();
      }
      if (got === expected) log(`  fecha fin VERIFICADA en el input: ${got}`);
      else dateIssue = `fecha fin en Glovo '${got || "?"}' ≠ esperada '${expected}'`;
    } else dateIssue = "no encontré el input de fecha fin (dd/MM/yyyy)";
    await shot("calendario"); await submitSection("calendario").catch(() => log("  ⚠️ calendario sin submit"));
  }

  // 5) RESUMEN + AUTOAUDITORÍA
  await killPopups();
  const resumen = await page.locator("main").innerText()
    .catch(() => page.innerText("body")).catch(() => "");
  const issues = [];
  if (!resumen.includes(`${chip}%`)) issues.push(`el resumen no muestra ${chip}%`);
  if (/descuento extra para prime/i.test(resumen)) issues.push("el extra Prime sigue ACTIVO");
  if (itemLevel && /la selección debe contener/i.test(resumen)) issues.push("el Menú está vacío");
  if (dateIssue) issues.push(dateIssue + " — una fecha falsa rompe el relevo del agente");
  const summaryShot = await shot("RESUMEN-FINAL");

  if (issues.length) return { ok: false, err: `Autoauditoría: ${issues.join(" · ")}. Screenshot: ${summaryShot}` };
  if (cfg.DRY_RUN) return { ok: false, err: `DRY_RUN OK — resumen VERIFICADO en '${posName}'. Screenshot: ${summaryShot}` };

  // Barra fija inferior: scroll al fondo y marcar términos (con reintento forzado)
  await page.keyboard.press("End").catch(() => {});
  await page.mouse.wheel(0, 2000); await page.waitForTimeout(600);
  const terms = page.getByRole("checkbox", { name: "drm-checkbox" });
  await terms.check({ timeout: 4000 }).catch(async () => {
    await terms.click({ force: true }).catch(() => {});
  });
  await page.waitForTimeout(600);
  // El botón REAL por role, y debe estar habilitado
  const createBtn = page.getByRole("button", { name: /crear promoción|lanzar/i }).last();
  if (!(await createBtn.isEnabled().catch(() => false)))
    throw new Error("el botón 'Crear promoción' sigue deshabilitado (¿términos sin marcar?)");
  const urlBefore = page.url();
  await createBtn.click({ timeout: 8000 });
  // GUARDIÁN ANTI-UPSELL: Glovo ofrece "mejorar" la promo con ANUNCIOS DE PAGO.
  // SIEMPRE "No, crearla tal cual". JAMÁS el botón del presupuesto.
  await page.waitForTimeout(2000);
  const noUpsell = page.getByRole("button", { name: /no,?\s*crearla tal cual/i })
    .or(page.getByText(/crearla tal cual/i)).first();
  if (await noUpsell.isVisible().catch(() => false)) {
    await noUpsell.click();
    log("  🛡️ upsell de anuncios RECHAZADO (crearla tal cual)");
  }
  // VERIFICACIÓN REAL: o salimos del asistente o aparece confirmación. Nunca ✅ de fe.
  let created = false;
  for (let i = 0; i < 20 && !created; i++) {
    await page.waitForTimeout(1000);
    const urlNow = page.url();
    if (urlNow !== urlBefore && !urlNow.includes("create-promotion")) created = true;
    else if (await page.getByText(/has lanzado una promoción|promoción creada|se ha creado|creada con éxito|enhorabuena/i).first()
      .isVisible().catch(() => false)) created = true;
  }
  await shot(created ? "CREADA" : "CLICK-SIN-CONFIRMAR");
  if (!created)
    return { ok: false, err: "clic en Crear hecho pero Glovo NO confirmó (seguimos en el asistente) — revisar screenshot CLICK-SIN-CONFIRMAR" };
  return { ok: true, ref: page.url() };
}

// ── v3.15: FINALIZAR (end) una promo en Glovo — la única acción de ciclo de vida
// que la plataforma ofrece (no hay pausar/reanudar; cancelar es irreversible).
const PROMO_LIST_URL = "https://portal.glovoapp.com/promotion/vendor-deals/view-performance";

async function endGlovoPromo(job) {
  const p = job.payload;
  const shot = async (tag) => {
    const f = `./screenshots/${job.id}-${tag}.png`;
    await page.screenshot({ path: f, fullPage: true }).catch(() => {}); log("  📸", f); return f;
  };
  const start = p.starts_at ? new Date(p.starts_at) : null;
  const startTxt = start
    ? `${String(start.getDate()).padStart(2, "0")}/${String(start.getMonth() + 1).padStart(2, "0")}/${start.getFullYear()}`
    : null;
  const want = Math.round(p.value ?? 0);
  const chip = [60,55,50,45,40,35,30,25,20,15,10].filter(v => v <= want)[0] ?? want;
  const allowed = (cfg.GLOVO_ALLOWED_POS ?? []).map(s => s.toLowerCase());

  const openList = async () => {
    await page.goto(PROMO_LIST_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500); await solveHumanCheck(); await killPopups();
    const search = page.getByPlaceholder(/buscar/i).first();
    if (await search.isVisible().catch(() => false)) {
      await search.click(); await page.keyboard.press("Control+a").catch(() => {});
      await page.keyboard.type(p.brand_name, { delay: 30 });
      await page.waitForTimeout(1500);
    }
  };
  // Candidatas: fila Activo + "Marca - MAD - " + Público Todos + fecha inicio + allowlist
  const readCandidates = async () => {
    const rows = page.locator("tr", { hasText: p.brand_name });
    const n = await rows.count();
    const cands = [];
    for (let i = 0; i < n; i++) {
      const txt = ((await rows.nth(i).innerText().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
      if (!/activo/i.test(txt)) continue;
      if (!txt.toLowerCase().includes(`${p.brand_name.toLowerCase()} - mad - `)) continue;
      if (!/todos/i.test(txt)) continue;
      if (startTxt && !txt.includes(startTxt)) continue;
      if (allowed.length > 0 && !allowed.some(a => txt.toLowerCase().includes(a))) continue;
      if (p.pos_hint && !txt.toLowerCase().includes(String(p.pos_hint).toLowerCase())) continue; // v3.16: solo SU local
      const m = txt.match(/\((\d{4,8})\)/);
      cands.push({ storeId: m ? m[1] : txt.slice(0, 60), txt });
    }
    return cands;
  };

  await openList();
  const cands = await readCandidates();
  await shot("end-lista");
  if (cands.length === 0)
    return { ok: false, err: `end: ninguna promo ACTIVA casa (marca '${p.brand_name}' + Todos + inicio ${startTxt ?? "?"}) — nada que cancelar o ya cancelada` };
  for (const c of cands) if (!c.txt.includes(`${chip}%`))
    log(`  ⚠️ end: la fila del store ${c.storeId} muestra otro % (esperado ${chip}%) — se cancela igual (marca+fecha+Todos mandan)`);
  if (cfg.DRY_RUN)
    return { ok: false, err: `DRY_RUN OK — ${cands.length} promo(s) localizadas para cancelar: ${cands.map(c => c.storeId).join(", ")}. Screenshot: end-lista` };

  const done = readLedger(job.id);
  const okStores = [...done]; const failStores = [];
  for (const c of cands) {
    if (done.includes(c.storeId)) { log(`  ↷ store ${c.storeId} ya cancelado (libro de a bordo)`); continue; }
    try {
      await openList();
      const row = page.locator("tr", { hasText: `(${c.storeId})` }).filter({ hasText: /activo/i }).first();
      if (!(await row.isVisible().catch(() => false))) throw new Error("la fila ya no aparece como Activo (¿cancelada fuera?)");
      await row.click(); await page.waitForTimeout(2000); await killPopups();
      const cancelBtn = page.getByRole("button", { name: /cancelar/i }).first();
      if (!(await cancelBtn.isVisible().catch(() => false))) throw new Error("no encontré el botón Cancelar en el detalle");
      await cancelBtn.click(); await page.waitForTimeout(1500);
      // Modal "Estás a punto de cancelar": confirmar (JAMÁS Volver/Atrás/Mantener)
      const dialog = page.locator('[role="dialog"], [data-testid="scroll-marker"]').last();
      const btns = dialog.getByRole("button");
      const nb = await btns.count();
      let clicked = false;
      for (let b = nb - 1; b >= 0; b--) {
        const label = ((await btns.nth(b).textContent().catch(() => "")) ?? "").trim();
        if (/volver|atrás|cerrar|seguir|mantener|no,/i.test(label)) continue;
        if (/cancelar|confirmar|sí/i.test(label)) {
          await shot(`end-${c.storeId}-modal`);
          log(`  end: confirmando con el botón '${label}'`);
          await btns.nth(b).click(); clicked = true; break;
        }
      }
      if (!clicked) throw new Error("no encontré el botón de confirmación del modal de cancelación");
      await page.waitForTimeout(2500);
      // VERIFICACIÓN contra la verdad de la lista: la fila de ese store ya NO está Activo
      await openList();
      let still = page.locator("tr", { hasText: `(${c.storeId})` }).filter({ hasText: /activo/i });
      if (startTxt) still = still.filter({ hasText: startTxt });
      if ((await still.count()) > 0) throw new Error("tras confirmar, la fila SIGUE Activo en la lista");
      addLedger(job.id, c.storeId);
      okStores.push(c.storeId);
      log(`  ✅ cancelada en store ${c.storeId}`);
    } catch (e) {
      failStores.push(`${c.storeId} → ${e.message}`);
      await shot(`end-${c.storeId}-ERROR`);
    }
  }
  if (failStores.length === 0) return { ok: true, ref: `canceladas: ${okStores.join(", ")}` };
  return { ok: false, err: `end PARCIAL — OK: ${okStores.join(", ") || "ninguno"} · FALLO: ${failStores.join(" · ")} — el reintento reanudará SOLO los pendientes` };
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try { await doTick(); } finally { running = false; }
}
async function doTick() {
  const jobs = await claim();
  if (!jobs?.length) return;
  await ensureBrowser(); await ensureLogin();
  for (const job of jobs) {
    log(`▶ job ${job.id} · ${job.action} · ${job.payload?.brand_name} · ${job.payload?.value}%`);
    try {
      let r;
      if (job.action === "create") r = await createGlovoPromo(job);
      else if (job.action === "end") r = await endGlovoPromo(job);
      else { await report(job.id, false, null, `Glovo no ofrece '${job.action}': pausar/reanudar no existen en la plataforma (la cancelación es irreversible; usar Finalizar)`); continue; }
      await report(job.id, r.ok, r.ref, r.err);
      log(r.ok ? "  ✅ publicada" : "  ⏸ " + r.err);
    } catch (e) {
      log("  ❌", e.message.split("\n")[0]);
      await report(job.id, false, null, e.message.slice(0, 500)).catch(() => {});
      await page.screenshot({ path: `./screenshots/${job.id}-ERROR.png`, fullPage: true }).catch(() => {});
    }
  }
}

log(`folvy-promo-agent v3.16 arrancado · DRY_RUN=${cfg.DRY_RUN} · poll ${cfg.POLL_SECONDS}s`);
await tick();
setInterval(() => tick().catch(e => log("tick error:", e.message)), cfg.POLL_SECONDS * 1000);
