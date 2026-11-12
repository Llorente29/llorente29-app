// src/publicas/bitrixCampo.ts
//
// GBc · PRUEBA · El campo fijo «Cuota mensual (Sumied)» en la ficha de empresa
// de Bitrix24 (solo en el Bitrix24 de pruebas). Lo dibuja Bitrix24 con esta
// página (tipo de campo de la aplicación, hueco USERFIELD_TYPE), que NUNCA
// escribe en el formulario de la ficha (no llama a setValue): por eso no hay
// caja para escribir.
//   · Viendo: el importe.
//   · Editando: «150,00 € · Cambiar en Sumied», que abre Sumied (BX24.openApplication).
// Sin parpadeo: primero lo guardado en Bitrix24 y, cuando contesta Sumied, lo
// de Sumied. Si Sumied ve que en Bitrix24 pone otra cosa, lo devuelve (campo.ts).

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined
const CLAVE = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const SDK_BITRIX = 'https://api.bitrix24.com/api/v1/'

type BX = { init: (f: () => void) => void; openApplication?: (p: Record<string, unknown>, cerrar?: () => void) => void; fitWindow?: () => void }

export interface LlegadaCampo { modo: 'view' | 'edit'; guardado: string; a: string | null; p: string | null; id: string | null }

export function leerAlmohadillaCampo(hash: string): LlegadaCampo {
  const h = new URLSearchParams(hash.replace(/^#/, ''))
  return { modo: h.get('m') === 'edit' ? 'edit' : 'view', guardado: (h.get('v') ?? '').slice(0, 40), a: h.get('a'), p: h.get('p'), id: h.get('id') }
}

let bx: BX | null = null
function conBitrix(hacer: (b: BX) => void) {
  if (bx) { hacer(bx); return }
  const s = document.createElement('script')
  s.src = SDK_BITRIX
  s.async = true
  s.onload = () => {
    const b = (window as unknown as { BX24?: BX }).BX24
    b?.init(() => { bx = b; hacer(b) })
  }
  document.head.append(s)
}

function pintar(x: LlegadaCampo, valor: string) {
  const caja = document.getElementById('campo')!
  caja.replaceChildren()
  const texto = document.createElement('span')
  texto.dataset.prueba = 'valor'
  if (valor) texto.textContent = valor
  else { texto.textContent = 'Sin cuota'; texto.className = 'vacio' }
  caja.append(texto)
  if (x.modo === 'edit') {
    const enlace = document.createElement('a')
    enlace.textContent = 'Cambiar en Sumied'
    enlace.href = '#'
    enlace.addEventListener('click', (e) => {
      e.preventDefault()
      conBitrix((b) => b.openApplication?.({ ID: x.id, TIPO: 'empresa' }))
    })
    caja.append(' · ', enlace)
  }
}

async function arrancar() {
  const x = leerAlmohadillaCampo(window.location.hash)
  if (window.location.hash) history.replaceState(null, '', window.location.pathname)
  pintar(x, x.guardado)
  conBitrix((b) => b.fitWindow?.())
  if (!x.a || !x.p || !x.id || !URL_BASE) return
  try {
    const r = await fetch(`${URL_BASE}/functions/v1/conta-bitrix-pestana`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(CLAVE ? { apikey: CLAVE, Authorization: `Bearer ${CLAVE}` } : {}) },
      body: JSON.stringify({ paso: 'campo', a: x.a, p: x.p, id: x.id }),
    })
    const d = (await r.json().catch(() => ({}))) as { estado?: string; valor?: string | null }
    if (d.estado === 'ok' && typeof d.valor === 'string' && d.valor !== x.guardado) pintar(x, d.valor)
  } catch {
    // Sin Sumied, se queda lo guardado en Bitrix24.
  }
}

if (typeof document !== 'undefined' && document.getElementById('campo')) void arrancar()
