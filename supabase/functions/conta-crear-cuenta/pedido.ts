// ============================================================
// conta-crear-cuenta / pedido.ts  (C06)
// Lo que se decide sin red: si el formulario está bien, el slug de la cuenta
// y si la marca se puede invitar desde aquí. Puro: lo prueban las unitarias.
// ============================================================

import { MARCAS, esIdMarca, urlBaseDeMarca, type Marca } from '../_shared/marcas.ts';

export interface PedidoAlta {
  empresa: string;
  correo: string;
  nombre: string | null;
  marca: Marca;
  motivo: string;
}

export function leerPedido(b: Record<string, unknown> | null): { ok: true; pedido: PedidoAlta } | { ok: false; error: string } {
  if (!b) return { ok: false, error: 'Body JSON inválido.' };
  const empresa = String(b.empresa ?? '').trim();
  const correo = String(b.correo ?? '').trim().toLowerCase();
  const nombre = String(b.nombre ?? '').trim() || null;
  const motivo = String(b.motivo ?? '').trim();
  if (empresa.length < 2) return { ok: false, error: 'Falta el nombre de la empresa.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return { ok: false, error: 'El correo del administrador del cliente no es válido.' };
  if (!esIdMarca(b.marca) || !MARCAS[b.marca].soloContabilidad) return { ok: false, error: 'Elige una marca de solo contabilidad.' };
  if (motivo.length < 3) return { ok: false, error: 'Falta por qué se da de alta: queda en el registro.' };
  return { ok: true, pedido: { empresa, correo, nombre, marca: MARCAS[b.marca], motivo } };
}

/** «Empresa de Prueba, S.L.» → «empresa-de-prueba-sl-4f2a»: cumple accounts_slug_format. */
export function slugDe(empresa: string, sufijo: string): string {
  const base = empresa.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/g, '');
  return `${base || 'empresa'}-${sufijo.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)}`;
}

/**
 * ¿Se puede invitar con esta marca desde este proyecto? En producción solo con
 * dominio propio (sin él, el enlace caería en app.folvy.app y el cliente vería
 * Folvy). Fuera de producción, con su dominio o con la base de pruebas.
 */
export function baseDelEnlace(m: Marca, esProduccion: boolean, basePruebas: string | null): { ok: true; base: string | null } | { ok: false; error: string } {
  if (urlBaseDeMarca(m)) return { ok: true, base: null };
  if (esProduccion) return { ok: false, error: `La marca «${m.nombre}» aún no tiene dominio: en producción no se puede invitar con ella (el cliente entraría por app.folvy.app).` };
  if (!basePruebas) return { ok: false, error: `La marca «${m.nombre}» no tiene dominio y falta APP_BASE_URL_PRUEBAS en este proyecto.` };
  return { ok: true, base: basePruebas };
}

/**
 * La base de pruebas, fuera de producción: APP_BASE_URL_PRUEBAS si está; si
 * no, el ORIGEN de quien pide el alta (la app de pruebas que la pidió: el
 * despliegue de vista previa o el servidor de las e2e). Solo http(s), sin
 * ruta. En producción no se usa nunca (baseDelEnlace exige dominio propio).
 */
export function basePruebas(env: string | null | undefined, origen: string | null | undefined): string | null {
  for (const v of [env, origen]) {
    const t = String(v ?? '').trim();
    if (!t) continue;
    try {
      const u = new URL(t);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
    } catch { /* no es una URL: la siguiente */ }
  }
  return null;
}
