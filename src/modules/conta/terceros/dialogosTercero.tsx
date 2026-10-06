// src/modules/conta/terceros/dialogosTercero.tsx
//
// C03 · Las acciones principales de la ficha, cada una en su ventana y cada
// una diciendo lo que ha pasado (regla 8):
//   · «Subir liquidación» (plataforma): el CSV que ya importa Folvy, leído en
//     la pantalla antes de guardar nada; dice lo que trae y lo que no.
//   · «Preparar liquidación de <mes>» (socio): una por LOCAL, calculada por la
//     base; nada se escribe hasta «Confirmar» (que prepara y confirma).
//   · «Nueva factura» (cliente normal): Folvy aún no emite facturas; lo dice.

import { useState } from 'react'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { Chip } from '@/modules/conta/ui/piezas'
import { useTercero, papelesDe, calculosDelMes } from '@/modules/conta/terceros/contextoTercero'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { leerLiquidaciones, FicheroNoReconocido, type LecturaLiquidaciones } from '@/modules/conta/lib/lectorLiquidaciones'
import { liquidarLocal, textoImporte } from '@/modules/conta/lib/liquidacionSocio'
import { diaMes, eurosExactos } from '@/modules/conta/lib/formato'
import { confirmarLiquidacionSocio, prepararLiquidacionSocio, subirLiquidaciones } from '@/modules/conta/services/tercerosService'

const PLATAFORMA = { glovo: 'Glovo', je: 'Just Eat', uber: 'Uber Eats' } as const

export function SubirLiquidacion({ alCerrar }: { alCerrar: () => void }) {
  const { ficha, accountId, recargar, avisar } = useTercero()
  const { rolPlataforma } = papelesDe(ficha)
  const [lectura, setLectura] = useState<(LecturaLiquidaciones & { fichero: string }) | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const canal = ficha.canales.find((c) => c.id === rolPlataforma?.channelId) ?? null

  async function leer(f: File) {
    setFallo(null); setLectura(null)
    try {
      const l = leerLiquidaciones(await f.text())
      if (l.filas.length === 0) { setFallo(`«${f.name}» no tiene ninguna liquidación.`); return }
      setLectura({ ...l, fichero: f.name })
    } catch (e) {
      setFallo(e instanceof FicheroNoReconocido ? `«${f.name}»: ${e.message}` : e instanceof Error ? e.message : 'No se pudo leer el fichero.')
    }
  }

  const fechas = lectura?.filas.map((f) => f.settlement_date).filter((x): x is string => !!x).sort() ?? []
  return (
    <Dialogo titulo="Subir liquidación" alCerrar={alCerrar}>
      <div className="cx-formulario">
        {!canal && <div className="cx-aviso" role="status">Esta plataforma aún no tiene su canal de venta: dímelo en «Cobro» para que sus liquidaciones vayan a su sitio en Ventas.</div>}
        <p className="cx-ayuda" style={{ margin: 0 }}>El fichero que ya importas de cada plataforma (CSV de Glovo, Just Eat o Uber Eats). Lo que ya estaba se actualiza, no se duplica.</p>
        <div className="cx-campo">
          <label htmlFor="liq-fichero">Fichero de liquidaciones</label>
          <input id="liq-fichero" className="cx-input" type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void leer(f) }} />
        </div>
        {fallo && <div className="cx-error" role="alert">{fallo}</div>}
        {lectura && (
          <div className="cx-aviso cx-aviso-ia" role="status">
            <strong>{lectura.filas.length === 1 ? '1 liquidación' : `${lectura.filas.length} liquidaciones`} de {PLATAFORMA[lectura.plataforma]}</strong>
            {fechas.length > 0 && <> · del {diaMes(fechas[0])} al {diaMes(fechas[fechas.length - 1])}</>}
            {lectura.noTrae.length > 0 && <div>El fichero no trae {lectura.noTrae.join(', ')}: lo verás como «para revisar» hasta que lo completes.</div>}
            {lectura.sinLeer.length > 0 && <div className="cx-ayuda">Columnas que no se leen: {lectura.sinLeer.join(', ')}.</div>}
            {canal && !canal.name.toLowerCase().replace(/\s/g, '').includes(PLATAFORMA[lectura.plataforma].toLowerCase().replace(/\s/g, '')) &&
              <div className="cx-error">Es un fichero de {PLATAFORMA[lectura.plataforma]} y esta plataforma vende por {canal.name}: ¿es el fichero bueno?</div>}
          </div>
        )}
        <div className="cx-pie">
          <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
          <button type="button" className="cx-boton" disabled={!lectura || ocupado} onClick={async () => {
            if (!lectura) return
            setOcupado(true); setFallo(null)
            try {
              const r = await subirLiquidaciones(accountId, ficha.tercero.id, canal?.id ?? null, lectura.filas)
              avisar(`Subidas de «${lectura.fichero}»: ${r.nuevas === 1 ? '1 liquidación nueva' : `${r.nuevas} liquidaciones nuevas`}${r.yaEstaban ? ` y ${r.yaEstaban} que ya estaban (actualizadas)` : ''}.`)
              recargar(); alCerrar()
            } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudieron guardar.'); setOcupado(false) }
          }}>{ocupado ? 'Subiendo…' : 'Subir'}</button>
        </div>
      </div>
    </Dialogo>
  )
}

/**
 * «Preparar liquidación de <mes>»: una por local. Enseña las tres líneas y lo
 * que falta; «Confirmar» la prepara y la confirma en el momento (la base la
 * vuelve a calcular y no la cierra si algo ha cambiado o falta una fuente).
 */
export function PrepararLiquidacion({ alCerrar }: { alCerrar: () => void }) {
  const { ficha, mesSocio, recargar, avisar } = useTercero()
  const { userName } = useCuentaConta()
  const [hechas, setHechas] = useState<Record<string, string>>({})
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  if (!mesSocio) return null
  const ya = new Map(ficha.liquidacionesSocio.filter((l) => l.formula !== 'anterior' && l.desde === mesSocio.mes.desde && l.estado !== 'borrador').map((l) => [l.localId, l]))
  const locales = calculosDelMes(mesSocio.porLocal).filter((c) => c.compras || c.aportaciones || c.marcas.some((m) => m.base) || ya.has(c.localId))

  return (
    <Dialogo titulo={`Liquidación de ${mesSocio.mes.nombre} · ${ficha.tercero.nombre}`} alCerrar={() => { if (Object.keys(hechas).length) recargar(); alCerrar() }}>
      <div className="cx-formulario">
        <p className="cx-ayuda" style={{ margin: 0 }}>Una por local: compras del local − aportaciones del socio en ese local + comisión sobre las ventas de sus marcas en ese local. Nada se guarda hasta que confirmas.</p>
        {fallo && <div className="cx-error" role="alert">{fallo}</div>}
        {locales.length === 0 && <div className="cx-aviso" role="status">Este mes aún no hay albaranes, aportaciones ni ventas de sus marcas en ningún local.</div>}
        {locales.map((c) => {
          const l = liquidarLocal(c)
          const confirmada = ya.get(c.localId)
          const hecha = hechas[c.localId]
          return (
            <section key={c.localId} className="cxt-preparar" aria-label={`Liquidación de ${c.local}`}>
              <div className="cxt-linea"><strong>{c.local}</strong>
                {confirmada ? <Chip tono="azul">Confirmada{confirmada.confirmadaPor ? ` por ${confirmada.confirmadaPor}` : ''}</Chip> : hecha ? <Chip tono="ia">Confirmada</Chip> : <Chip>Borrador</Chip>}</div>
              {l.lineas.map((x) => <div key={x.texto} className="cxt-linea"><span>{x.texto}</span><span className="cx-cifra">{eurosExactos(x.importe)}</span></div>)}
              <div className="cxt-linea cxt-linea-total"><span>= Liquidación</span><span className="cx-cifra">{textoImporte(l)}</span></div>
              {c.marcas.length > 0 && <div className="cx-ayuda">{c.marcas.map((m) => `${m.marca}: ${eurosExactos(m.base)} al ${String(m.pct).replace('.', ',')} %`).join(' · ')}</div>}
              {l.faltan.length > 0 && <div className="cx-aviso" role="status">No se puede cerrar: {l.faltan.join(' ')}</div>}
              {l.descuadreConBase != null && <div className="cx-error">La base y la pantalla no dicen lo mismo ({eurosExactos(l.descuadreConBase)}): vuelve a abrir la ficha.</div>}
              {!confirmada && !hecha && (
                <div className="cx-pie">
                  <button type="button" className="cx-boton" disabled={!l.cerrable || ocupado === c.localId} onClick={async () => {
                    setOcupado(c.localId); setFallo(null)
                    try {
                      const p = await prepararLiquidacionSocio(ficha.tercero.id, c.localId, mesSocio.mes.desde, mesSocio.mes.hasta, userName)
                      const r = await confirmarLiquidacionSocio(p.id!, p.importe, userName)
                      const t = `Confirmada la de ${c.local}: ${textoImporte({ importe: r.importe, sentido: r.importe > 0 ? 'a su favor' : r.importe < 0 ? 'a tu favor' : 'a cero' })}.`
                      setHechas((h) => ({ ...h, [c.localId]: t })); avisar(t)
                    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo confirmar.') }
                    setOcupado(null)
                  }}>{ocupado === c.localId ? 'Confirmando…' : `Confirmar ${c.local}`}</button>
                </div>
              )}
              {hecha && <div className="cx-guardado" role="status">{hecha}</div>}
            </section>
          )
        })}
        <div className="cx-pie">
          <button type="button" className="cx-boton-sec" onClick={() => { if (Object.keys(hechas).length) recargar(); alCerrar() }}>Cerrar</button>
        </div>
      </div>
    </Dialogo>
  )
}

export function NuevaFactura({ alCerrar }: { alCerrar: () => void }) {
  return (
    <Dialogo titulo="Nueva factura" alCerrar={alCerrar}>
      <p style={{ margin: 0, fontSize: 15 }}>
        Folvy aún no emite facturas: llegan con <strong>Facturación</strong>, con su numeración y Verifactu (encargo F01, después de los asientos).
        Mientras, la ficha guarda todo lo que hará falta para facturarle: sus datos fiscales, su cobro y su cuenta.
      </p>
      <div className="cx-pie"><button type="button" className="cx-boton" onClick={alCerrar}>Entendido</button></div>
    </Dialogo>
  )
}
