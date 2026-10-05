// src/modules/conta/proveedor/Contabilidad.tsx
//
// Pestaña «Contabilidad» (nunca «gestor»): su tipo de gasto (con el CÓDIGO
// COMPLETO de su cuenta, «60000000 · Compras de mercaderías»), el local
// habitual y el registro sanitario (también en Datos fiscales, respuesta 1,
// decisión 1). Debajo, desde el C02 (tarea 6, maqueta N7FichaConta), sus
// cuentas del plan y su saldo: SusCuentas.tsx, que lee los enlaces del plan
// (company_account_link) y ya no supplier.ledger_account_code. Solo con el
// interruptor `conta`; sin él (cuenta B) el bloque sale PLEGADO y todo lo
// demás de la ficha funciona igual (encargo §7 del C01).
//
// Los tipos de gasto son los de serie que la empresa no ha ocultado, con los
// más usados en la cuenta primero; el ya elegido sale siempre aunque esté
// oculto (regla 30). Qué tipos usa el negocio también se elige desde aquí.

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { Campo, SeGuarda } from '@/modules/conta/proveedor/piezas'
import { useGuardarAlSalir } from '@/modules/conta/proveedor/useGuardarAlSalir'
import { SusCuentas } from '@/modules/conta/proveedor/SusCuentas'
import { cuentaEnLaFicha } from '@/modules/conta/lib/opcionesFicha'
import { porUso } from '@/modules/conta/lib/masUsados'
import { ocultarTipoGasto } from '@/modules/conta/services/fichaTablasService'
import { rutaAltaEmpresa } from '@/config/navegacion'

export default function Contabilidad() {
  const { datos } = useFicha()
  // Sin el módulo de contabilidad, plegado (y se abre si se quiere).
  if (!datos.conta) {
    return (
      <details className="cxp-plegable">
        <summary><span className="cx-tarjeta-titulo">Contabilidad</span><span className="cx-ayuda">Tu cuenta no lleva la contabilidad en Folvy</span></summary>
        <Formulario />
      </details>
    )
  }
  return <Formulario />
}

function Formulario() {
  const { datos, actor, recargar } = useFicha()
  const f = datos.ficha
  const g = useGuardarAlSalir()
  const [rgseaa, setRgseaa] = useState(f.healthRegistryNo ?? '')
  const [verLista, setVerLista] = useState(false)
  const [cambioLista, setCambioLista] = useState<string | null>(null)
  const empresaId = datos.opciones.empresa?.id ?? null

  const opciones = porUso(
    datos.tiposGasto.filter((t) => !t.oculto || t.id === f.expenseCategoryId),
    (t) => t.id, datos.otros.map((o) => o.expenseCategoryId),
  )
  const elegido = datos.tiposGasto.find((t) => t.id === f.expenseCategoryId) ?? null
  const cuenta = (pgc: string) => cuentaEnLaFicha(datos.opciones, pgc)

  let contenido: ReactNode = null
  if (verLista) {
    contenido = (
      <div className="cx-tarjeta" style={{ padding: '14px 18px' }}>
        {/* Se ocultan en los ajustes de la EMPRESA (general_row_setting, C00). Sin
            empresa no hay dónde: se dice, en vez de casillas que no harían nada (regla 8). */}
        {!empresaId ? (
          <p className="cx-ayuda" style={{ margin: 0 }}>
            Para elegir qué tipos de gasto usa tu negocio, primero <Link to={rutaAltaEmpresa()}>da de alta tu empresa</Link> en contabilidad.
          </p>
        ) : <p className="cx-ayuda" style={{ margin: 0 }}>Los que quites no saldrán al elegir. Afecta a todos los proveedores de tu cuenta.</p>}
        {empresaId && (
          <div className="cx-casillas" style={{ flexDirection: 'column', gap: 0 }}>
            {datos.tiposGasto.map((t) => (
              <label key={t.id} className="cx-casilla">
                <input type="checkbox" checked={!t.oculto} onChange={async (e) => {
                  // Se lee UNA vez y antes de esperar: tras el primer await la
                  // casilla (controlada) ya ha vuelto a su valor (e2e del C01, T7).
                  const ocultar = !e.target.checked
                  try {
                    await ocultarTipoGasto(f.accountId, empresaId, t.id, ocultar, actor.id)
                    await recargar()
                    setCambioLista(ocultar ? `${t.name}: ya no sale al elegir.` : `${t.name}: vuelve a salir.`)
                  } catch (e2) { setCambioLista(e2 instanceof Error ? e2.message : 'No se pudo cambiar.') }
                }} />
                <span>{t.name} <span className="cx-ayuda">· {cuenta(t.pgcAccountHint)}</span></span>
              </label>
            ))}
          </div>
        )}
        {cambioLista && <div role="status" className="cxp-guardado-discreto">{cambioLista}</div>}
      </div>
    )
  }

  return (
    <div className="cx-formulario">
      {g.fallo && <div className="cx-error" role="alert">{g.fallo}</div>}
      <Campo campo="expenseCategoryId" etiqueta="Sus facturas se apuntan en"
        ayuda={elegido ? `${cuenta(elegido.pgcAccountHint)}` : 'El tipo de gasto que son casi todas sus facturas. Los que más usas, primero.'}>
        {(p) => (
          <select {...p} className="cx-input" value={f.expenseCategoryId ?? ''}
            onChange={(e) => {
              const t = datos.tiposGasto.find((x) => x.id === e.target.value)
              void g.guardar({ expenseCategoryId: e.target.value || null }, t ? `sus facturas van a ${cuenta(t.pgcAccountHint)}` : 'tipo de gasto')
            }}>
            <option value="">Sin decir</option>
            {opciones.map((t) => <option key={t.id} value={t.id}>{cuenta(t.pgcAccountHint)} · {t.name}{t.oculto ? ' (oculto en tu cuenta)' : ''}</option>)}
          </select>
        )}
      </Campo>
      <Campo campo="defaultLocationId" etiqueta="Local habitual" ayuda="El local al que suele servir. «Todos» si reparte a todos.">
        {(p) => (
          <select {...p} className="cx-input" value={f.defaultLocationId ?? ''}
            onChange={(e) => void g.guardar({ defaultLocationId: e.target.value || null }, 'local habitual')}>
            <option value="">Todos</option>
            {datos.locales.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
      </Campo>
      <Campo campo="healthRegistryNo-conta" etiqueta="Registro sanitario (RGSEAA)" ayuda="El mismo que en Datos fiscales: se cambia en cualquiera de los dos sitios.">
        {(p) => <input {...p} className="cx-input" value={rgseaa} placeholder="10.00000/M" onChange={(e) => setRgseaa(e.target.value)}
          onBlur={() => void g.guardar({ healthRegistryNo: rgseaa.trim() || null }, 'registro sanitario')} />}
      </Campo>
      <SeGuarda texto={g.texto} ocupado={g.ocupado} />
      <button type="button" className="cx-enlace" aria-expanded={verLista} onClick={() => setVerLista((v) => !v)} style={{ alignSelf: 'flex-start' }}>
        {verLista ? 'Cerrar la lista de tipos de gasto' : 'Elegir qué tipos de gasto usa tu negocio'}
      </button>
      {contenido}
      {datos.conta && <SusCuentas />}
    </div>
  )
}
