// src/modules/conta/proveedor/Contabilidad.tsx
//
// Pestaña «Contabilidad» (nunca «gestor»): SOLO la maqueta N7 (respuesta 3 del
// C02): «Sus cuentas» y «Saldo y movimientos» a todo el ancho, con «Ver
// extracto». Nada de formulario: cada línea se cambia desde su tarjeta.
//   · «Sus facturas se apuntan en» (su tipo de gasto o una cuenta para él):
//     «Cambiar» en la tarjeta, con buscador.
//   · El registro sanitario se edita en Datos fiscales; aquí solo se enseña.
//   · «Local habitual» no es contabilidad: va en el bloque de Cocina.
//   · Qué tipos de gasto usa el negocio, en Ajustes › Tablas generales (enlace
//     al pie de «Sus cuentas»).
// Sin el interruptor `conta` (cuenta B) la pestaña sale PLEGADA y todo lo
// demás de la ficha funciona igual (encargo §7 del C01).

import { useFicha } from '@/modules/conta/proveedor/contexto'
import { SusCuentas } from '@/modules/conta/proveedor/SusCuentas'
import { MARCA } from '../cuenta/marca'
import { useState } from 'react'
import { textoEntregaMercancia } from '@/modules/conta/lib/apuntaSolo'

/**
 * S01o·2 · Cómo le compras: si entrega mercancía (sus facturas esperan su
 * albarán) y su local por defecto (el de sus facturas de servicios, que no
 * tienen recepción). Guardar confirma o falla en pantalla (regla 8).
 */
function ComoLeCompras() {
  const { datos, guardar } = useFicha()
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  if (!datos) return null
  const f = datos.ficha
  async function cambiar(c: Parameters<typeof guardar>[0], texto: string) {
    setHecho(null); setFallo(null)
    try {
      const r = await guardar(c)
      const mal = r.errores[0]
      if (mal) setFallo(mal.mensaje); else setHecho(texto)
    } catch (e) { setFallo(e instanceof Error ? e.message : String(e)) }
  }
  const local = datos.locales.find((l) => l.id === f.defaultLocationId)
  return (
    <div className="cx-tarjeta" data-prueba="como-le-compras">
      <span className="cx-tarjeta-titulo">Cómo le compras</span>
      <label className="cx-campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" role="switch" checked={f.deliversGoods ?? false} data-prueba="entrega-mercancia"
          onChange={(e) => void cambiar({ deliversGoods: e.target.checked }, e.target.checked ? 'Guardado: sus facturas esperan su albarán.' : 'Guardado: es de servicios, sus facturas no esperan albarán.')} />
        <span className="cx-etiqueta" style={{ margin: 0 }}>Entrega mercancía</span>
      </label>
      <p className="cx-ayuda" style={{ margin: 0 }}>{textoEntregaMercancia(f.deliversGoods)}</p>
      <label className="cx-campo">
        <span className="cx-etiqueta">Local por defecto</span>
        <select value={f.defaultLocationId ?? ''} data-prueba="local-por-defecto"
          onChange={(e) => void cambiar({ defaultLocationId: e.target.value || null }, e.target.value ? `Guardado: sus facturas sin recepción van a ${datos.locales.find((l) => l.id === e.target.value)?.name ?? 'ese local'}.` : 'Guardado: sin local por defecto.')}>
          <option value="">Ninguno</option>
          {datos.locales.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <p className="cx-ayuda" style={{ margin: 0 }}>{local ? `Sus facturas de servicios (sin recepción) se apuntan en ${local.name}.` : 'Sin él, una factura suya de servicios no se apunta sola: «Falta su local».'}</p>
      <div role="status" aria-live="polite">{hecho && <div className="cx-guardado">{hecho}</div>}</div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
    </div>
  )
}

export default function Contabilidad() {
  const { datos } = useFicha()
  if (!datos.conta) {
    return (
      // La clase va DENTRO: con ella (display:flex) en el propio <details>, la
      // e2e del 05/10 encontró su contenido maquetado con el bloque cerrado (cuenta B).
      <details className="cxp-plegable">
        <summary><span className="cx-tarjeta-titulo">Contabilidad</span><span className="cx-ayuda">Tu cuenta no lleva la contabilidad en {MARCA.nombre}</span></summary>
        <div className="cxp-cuentas"><SusCuentas /></div>
      </details>
    )
  }
  return <div className="cxp-cuentas"><SusCuentas /><ComoLeCompras /></div>
}
