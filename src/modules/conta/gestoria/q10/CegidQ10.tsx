// src/modules/conta/gestoria/q10/CegidQ10.tsx
//
// Q10 · respuesta 1 · Lo de la facturación de Cegid en «Las facturas del mes», solo leyendo. Pinta, no lee nada:
//   · si la empresa está conectada (y si no, dónde se conecta: Ajustes › Ejercicio › Facturación de Cegid);
//   · «Leer de Cegid»: los clientes con sus conceptos fijos, los conceptos y las facturas del año, con lo que va
//     leyendo y, al acabar, lo leído (regla 8); no escribe nada en Cegid;
//   · el código de cliente de Cegid de cada ficha (por su 430 o por su NIF), en una frase;
//   · la TABLA DE EQUIVALENCIAS: cada concepto de GoCardless con el concepto de Cegid que propone lo que ya pasó, sus
//     pruebas, la serie y si lleva retención. Julio la confirma antes de mandar nada (respuesta 1, punto 3).

import { Link } from 'react-router-dom'
import { eurQ10 } from './facturasDelMes'
import type { FilaEquivalencia } from './equivalencias'
import type { PropuestaAtado } from '../../../../../supabase/functions/_shared/cegidMandar'

export interface PropsCegidQ10 {
  conectada: boolean
  rutaConectar: string
  /** Mientras se lee, por dónde va; al acabar, lo leído; si falla, el porqué. null: nada que decir. */
  lectura: { estado: 'leyendo' | 'leido' | 'fallo'; frase: string } | null
  /** Cuándo se leyó lo guardado (ISO) o null si nunca. */
  leidoAt: string | null
  alLeer: () => void
  codigos: string | null
  /** Las fichas con cobros este mes que no tienen código de Cegid, con su NIF, para que Julio las mire. */
  sinCodigo: { partyId: string; nombre: string; nif: string | null; cuenta430: string | null; porque: string; propuestas: PropuestaAtado[] }[] | null
  /** Respuesta 4 · «Atar al N» y su frase: la guarda la página (atada, la ficha sale de esta lista). */
  alAtar?: (partyId: string, codigo: number, como: 'correo' | 'nombre') => void
  atado?: { estado: 'trabajando' | 'bien' | 'mal'; frase: string } | null
  tabla: FilaEquivalencia[] | null
}

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function textoRetencion(r: FilaEquivalencia['retencion']): string {
  if (!r) return '—'
  if ('si' in r) return r.si === 0 ? `No (0 de ${r.de} líneas)` : r.si === r.de ? `Sí (${r.de} de ${r.de} líneas)` : `A veces (${r.si} de ${r.de} líneas)`
  return r.delConcepto === null ? 'No se sabe' : r.delConcepto ? 'Sí (lo dice el concepto)' : 'No (lo dice el concepto)'
}

export function CegidQ10(p: PropsCegidQ10) {
  const leyendo = p.lectura?.estado === 'leyendo'
  const atando = p.atado ?? null
  return (
    <section className="g4-bloque q10-cegid" aria-labelledby="q10-cegid" data-prueba="cegid">
      <h2 id="q10-cegid" className="g4-bloque-titulo">La facturación de Cegid</h2>
      {/* El botón, siempre a la vista; sin la conexión, apagado y diciendo por qué y dónde se conecta (Julio, 25/11: no lo encontraba). */}
      <div><button type="button" className="g4-boton" data-tipo="primario" disabled={leyendo || !p.conectada} onClick={p.alLeer}
        title={p.conectada ? undefined : 'Faltan las claves o el código de empresa de Cegid'}>{leyendo ? 'Leyendo de Cegid…' : p.leidoAt ? 'Volver a leer de Cegid' : 'Leer de Cegid'}</button></div>
      {!p.conectada ? (
        <p className="q10-linea" data-prueba="sin-conexion">Para leer, esta empresa tiene que estar conectada con la facturación de Cegid: faltan las claves o el código de empresa. <Link to={p.rutaConectar}>Ponlos en Ajustes › Ejercicio › Facturación de Cegid →</Link></p>
      ) : (
        <p className="q10-linea">{p.leidoAt ? `Leído de Cegid el ${fechaHora(p.leidoAt)}.` : 'Aún no se ha leído nada de Cegid.'} Solo se lee: no se escribe nada en Cegid.</p>
      )}
      {p.lectura && <p className="q10-linea" data-prueba="lectura" data-tono={p.lectura.estado === 'fallo' ? 'mal' : p.lectura.estado === 'leido' ? 'bien' : undefined}
        role={p.lectura.estado === 'fallo' ? 'alert' : 'status'}>{p.lectura.frase}</p>}
      {p.codigos && <p className="q10-linea" data-prueba="codigos">{p.codigos}</p>}
      {/* La frase va fuera de la lista y la guarda la página: atada, la ficha sale de la lista, y la última se lleva la lista entera (regla 8). */}
      {atando && <p className="q10-linea" data-prueba="atado" data-tono={atando.estado === 'bien' ? 'bien' : atando.estado === 'mal' ? 'mal' : undefined} role={atando.estado === 'mal' ? 'alert' : 'status'}>{atando.frase}</p>}
      {p.sinCodigo && p.sinCodigo.length > 0 && (
        <details className="q10-sin-codigo" data-prueba="sin-codigo">
          <summary>Las {p.sinCodigo.length} fichas sin código de Cegid, con su NIF y lo que se propone</summary>
          <p className="q10-linea">Lo propuesto sale de su correo de GoCardless o de su nombre en Cegid. Mira que es el cliente bueno antes de atarlo: queda apuntado quién lo ató.</p>
          <div className="q10-tabla-caja">
            <table className="q10-tabla" aria-label="Fichas sin código de Cegid">
              <thead><tr><th>Ficha</th><th>NIF</th><th>Su 430 en Sumied</th><th>Por qué</th><th>En Cegid parece</th></tr></thead>
              <tbody>
                {p.sinCodigo.map((x) => (
                  <tr key={x.partyId} data-party={x.partyId}><td className="q10-cliente">{x.nombre}</td><td>{x.nif ?? 'Sin NIF'}</td><td>{x.cuenta430 ?? '—'}</td><td>{x.porque}</td>
                    <td>{x.propuestas.length === 0 ? <span className="g4-pequeno">Ninguno por correo ni por nombre</span> : x.propuestas.map((k) => (
                      <div key={k.codigo}><button type="button" className="g4-boton" disabled={!p.alAtar || atando?.estado === 'trabajando'} onClick={() => p.alAtar?.(x.partyId, k.codigo, k.por)}>
                        Atar al {k.codigo}</button> <span className="g4-pequeno">{k.nombre ?? ''} · por su {k.por}</span></div>))}
</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {p.tabla && p.tabla.length > 0 && (
        <>
          <h3 className="q10-subtitulo">Qué concepto de Cegid lleva cada cobro de GoCardless</h3>
          <p className="q10-linea">Lo propone lo que ya se ha facturado en Cegid este año a esos mismos clientes. Antes de mandar nada a Cegid, lo confirma Julio.</p>
          <div className="q10-tabla-caja">
            <table className="q10-tabla" aria-label="Tabla de equivalencias" data-prueba="equivalencias">
              <thead><tr><th>En GoCardless</th><th className="q10-num">Cobrado</th><th>Concepto de Cegid</th><th>Pruebas</th><th>Serie</th><th>Retención</th></tr></thead>
              <tbody>
                {p.tabla.map((f) => (
                  <tr key={f.familia} data-familia={f.familia}>
                    <td><div className="q10-cliente">{f.familia}</div>{f.ejemplos.length > 1 && <div className="g4-pequeno">{f.ejemplos.slice(0, 2).join(' · ')}</div>}</td>
                    <td className="q10-num">{f.cobros} · {eurQ10(f.importeCent)}</td>
                    <td>{f.propuesta ? <><strong>{f.propuesta.codigo}</strong> {f.propuesta.descripcion ?? ''}</> : <span data-tono="mal">Sin propuesta</span>}
                      {f.otros.length > 0 && <div className="g4-pequeno">También: {f.otros.map((o) => `${o.codigo} (${o.votos})`).join(', ')}</div>}</td>
                    <td>{f.propuesta ? `${f.propuesta.votos} de ${f.clientes} clientes` : f.clientes ? `Ninguna en ${f.clientes} clientes` : 'Sin cliente de Cegid'}</td>
                    <td>{f.serie ? `${f.serie.serie}${f.serie.veces < f.serie.de ? ` (${f.serie.veces} de ${f.serie.de})` : ''}` : '—'}</td>
                    <td>{textoRetencion(f.retencion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
