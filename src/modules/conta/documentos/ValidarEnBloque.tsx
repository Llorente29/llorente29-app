// src/modules/conta/documentos/ValidarEnBloque.tsx
//
// D06 · Validar en bloque (tablero 2b del lienzo): la barra azul de las
// marcadas («69 marcadas · Total … · Quitar la marca · Validar las N»), la
// confirmación con el reparto por cuenta y por local antes de validar, y lo
// que ha pasado al final (regla 8: cuántas, y cuál ha fallado y por qué).

import { Boton, Dialogo } from '@/modules/conta/diseno'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { repartoDelBloque, type ParaRepartir } from './paraValidar'
import type { ResultadoBloque } from './paraValidarService'

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`

export function BarraMarcadas({ marcadas, total, listas, validando, alQuitar, alValidar }: {
  marcadas: number
  total: number
  /** De las marcadas, las que están listas (las que se validan). */
  listas: number
  validando: { hechas: number; de: number } | null
  alQuitar: () => void
  alValidar: () => void
}) {
  return (
    <div className="s-barra-marcadas" role="region" aria-label="Facturas marcadas" data-prueba="barra-marcadas">
      <span className="s-barra-marcadas-texto">
        <strong>{plural(marcadas, 'marcada', 'marcadas')}</strong>
        {' · '}Total <span className="s-cifra">{eurosExactos(total)}</span>
        {listas !== marcadas && <>{' · '}{listas === 0 ? 'ninguna está lista' : `${plural(listas, 'lista', 'listas')} para validar`}</>}
      </span>
      {validando
        ? <span role="status">Validando {validando.hechas} de {validando.de}…</span>
        : (
          <span className="s-barra-marcadas-acciones">
            <Boton onClick={alQuitar}>Quitar la marca</Boton>
            <Boton variante="principal" icono="ok" onClick={alValidar} disabled={listas === 0}>{listas === 1 ? 'Validar la lista' : `Validar las ${listas}`}</Boton>
          </span>
        )}
    </div>
  )
}

export function ConfirmarBloque({ facturas, noListas, enviaADiez, alCancelar, alValidar }: {
  facturas: readonly ParaRepartir[]
  /** Las marcadas que no están listas: se quedan en «Por revisar» con su motivo. */
  noListas: number
  enviaADiez: boolean
  alCancelar: () => void
  alValidar: () => void
}) {
  const r = repartoDelBloque(facturas)
  const n = facturas.length
  return (
    <Dialogo titulo={`¿Validar ${plural(n, 'factura recibida', 'facturas recibidas')}?`} alCerrar={alCancelar}
      explicacion={`Se crea un asiento por factura${enviaADiez ? ' y se envían a Diez' : ''}, como al validarlas de una en una. Así quedan repartidas:`}
      acciones={<>
        <Boton onClick={alCancelar}>Cancelar</Boton>
        <Boton variante="principal" icono="ok" onClick={alValidar}>{n === 1 ? 'Validar la factura' : `Validar las ${n}`}</Boton>
      </>}>
      <table className="s-lista-tabla s-reparto-bloque" aria-label="Así quedan repartidas">
        <thead>
          <tr><th scope="col">Cuenta</th><th scope="col">Nombre</th><th scope="col" className="s-lista-cifra">Facturas</th><th scope="col" className="s-lista-cifra">Base</th><th scope="col" className="s-lista-cifra">Total</th></tr>
        </thead>
        <tbody>
          {r.cuentas.map((c) => (
            <tr key={c.codigo}>
              <td><strong className="s-cifra">{c.codigo}</strong></td><td>{c.nombre}</td>
              <td className="s-lista-cifra">{c.facturas}</td><td className="s-lista-cifra">{eurosExactos(c.base)}</td><td className="s-lista-cifra"><strong>{eurosExactos(c.total)}</strong></td>
            </tr>
          ))}
          <tr><td>Por local</td><td colSpan={4}>{r.locales.join(' · ')}</td></tr>
        </tbody>
      </table>
      <p className="s-apoyo">
        {noListas > 0 && `${noListas === 1 ? 'La que no está lista se queda' : `Las ${noListas} que no están listas se quedan`} en «Por revisar» con su motivo. `}
        Cada validada se puede deshacer desde su historial.
      </p>
    </Dialogo>
  )
}

export function ResultadoDelBloque({ r }: { r: ResultadoBloque }) {
  const todas = r.mal.length === 0
  return (
    <div className="s-aviso-lista" data-tono={todas ? 'ok' : 'duda'} role="status" data-prueba="resultado-bloque">
      <strong>{todas
        ? (r.bien.length === 1 ? 'Validada la factura: tiene su asiento.' : `Validadas las ${r.bien.length}: cada una con su asiento.`)
        : `Validadas ${r.bien.length} de ${r.bien.length + r.mal.length}. ${r.mal.length === 1 ? 'Esta no' : 'Estas no'}, y por qué:`}</strong>
      {!todas && <ul>{r.mal.map((m) => <li key={m.id}>{m.nombre}: {m.porque}</li>)}</ul>}
    </div>
  )
}
