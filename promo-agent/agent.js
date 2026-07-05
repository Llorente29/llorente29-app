// folvy-promo-agent v3.13 — robot de promos (Glovo)
// v2: popups eliminados · botones Editar por índice de sección · autoauditoría del resumen
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";

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

async function createGlovoPromo(job) {
  const p = job.payload;
  const itemLevel = Array.isArray(p.menu_item_ids) && p.menu_item_ids.length > 0;
  const shot = async (tag) => {
    const f = `./screenshots/${job.id}-${tag}.png`;
    await page.screenshot({ path: f, fullPage: true }); log("  📸", f); return f;
  };
  const submitSection = async (tag) => {
    await page.getByTestId("form-section-submit-button").click({ timeout: 8000 })
      .catch(() => { throw new Error(`paso '${tag}': no encontré form-section-submit-button`); });
    await page.waitForTimeout(1200);
  };

  // 0) ESTABLECIMIENTO en el header global (descubrimiento del codegen):
  //    el asistente hereda el punto de venta elegido arriba.
  await page.goto("https://portal.glovoapp.com/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500); await solveHumanCheck(); await killPopups();
  await page.getByTestId("desktop-brand-view-button").click({ timeout: 15000 });
  await page.waitForTimeout(1200);
  // Establecimientos de la marca: TODOS los que casen la ALLOWLIST (una promo por local).
  // Formato exigido: "Marca - MAD - Calle" (excluye entradas de formato viejo).
  const esc = p.brand_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const candidates = page.getByText(new RegExp("^" + esc + "\\s+-\\s+MAD\\s+-\\s+", "i"));
  const nCand = await candidates.count();
  const allowed = (cfg.GLOVO_ALLOWED_POS ?? []).map(s => s.toLowerCase());
  const targets = [];
  for (let i = 0; i < nCand; i++) {
    const txt = ((await candidates.nth(i).textContent()) ?? "").trim();
    if (allowed.length === 0 || allowed.some(a => txt.toLowerCase().includes(a))) targets.push(txt);
  }
  if (targets.length === 0)
    throw new Error(`ningún establecimiento de '${p.brand_name}' casa con GLOVO_ALLOWED_POS (${nCand} candidatos)`);
  log(`  establecimientos objetivo (${targets.length}): ${targets.join(" | ")}`);
  const posName = targets[0];
  await page.getByText(posName, { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);
  log(`  punto de venta: ${posName}${targets.length > 1 ? ` (quedan ${targets.length - 1} — se iteran al publicar en real)` : ""}`);

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

  // 4) CALENDARIO: fecha fin = ends_at del payload (fecha inicio: default hoy)
  if (p.ends_at) {
    await page.getByTestId("schedule-section").getByText("Editar").click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const end = new Date(p.ends_at);
    const dayName = end.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
    // el botón del datepicker se llama "lunes, 6 de julio de"
    const endInput = page.getByRole("textbox", { name: "dd/MM/yyyy" }).nth(1);
    if (await endInput.isVisible().catch(() => false)) {
      await endInput.click();
      const dayBtn = page.getByRole("button", { name: new RegExp(dayName.split(",")[0] + ",? ?" + end.getDate() + " de", "i") }).first();
      if (await dayBtn.isVisible().catch(() => false)) await dayBtn.click();
      else log("  ⚠️ no encontré el día en el datepicker — calendario queda por defecto");
    }
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
      if (job.action !== "create") { await report(job.id, false, null, `acción '${job.action}' aún no soportada (v1.1)`); continue; }
      const r = await createGlovoPromo(job);
      await report(job.id, r.ok, r.ref, r.err);
      log(r.ok ? "  ✅ publicada" : "  ⏸ " + r.err);
    } catch (e) {
      log("  ❌", e.message.split("\n")[0]);
      await report(job.id, false, null, e.message.slice(0, 500)).catch(() => {});
      await page.screenshot({ path: `./screenshots/${job.id}-ERROR.png`, fullPage: true }).catch(() => {});
    }
  }
}

log(`folvy-promo-agent v3.13 arrancado · DRY_RUN=${cfg.DRY_RUN} · poll ${cfg.POLL_SECONDS}s`);
await tick();
setInterval(() => tick().catch(e => log("tick error:", e.message)), cfg.POLL_SECONDS * 1000);
