import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from './supabaseClient'

const HORAS_LIMITE_CANCELACION = 48

function formatearFecha(fechaISO) {
  const f = new Date(fechaISO)
  return f.toLocaleString('es-CO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function horasHastaSesion(fechaISO) {
  const ahora = new Date()
  const fecha = new Date(fechaISO)
  return (fecha.getTime() - ahora.getTime()) / (1000 * 60 * 60)
}

// Devuelve el lunes (00:00) de la semana a la que pertenece una fecha.
// Debe coincidir con date_trunc('week', ...) de Postgres, que también usa lunes.
function inicioSemana(fechaISO) {
  const d = new Date(fechaISO)
  const dia = d.getDay() // 0 = domingo
  const diff = (dia === 0 ? -6 : 1) - dia
  const lunes = new Date(d)
  lunes.setDate(d.getDate() + diff)
  lunes.setHours(0, 0, 0, 0)
  return lunes
}

// Misma regla que fn_sesion_reservable en la base de datos:
// siempre abiertas las próximas 2 semanas, y cada semana siguiente se
// habilita 3 días antes de que empiece. Esto es solo para la UI (mostrar
// el estado correcto); el trigger en Supabase sigue siendo la validación real.
function esSesionReservable(fechaISO) {
  const ahora = new Date()
  const fecha = new Date(fechaISO)
  const limiteDosSemanas = inicioSemana(ahora)
  limiteDosSemanas.setDate(limiteDosSemanas.getDate() + 14)
  if (fecha < limiteDosSemanas) return true
  const desbloqueo = inicioSemana(fechaISO)
  desbloqueo.setDate(desbloqueo.getDate() - 3)
  return ahora >= desbloqueo
}

function fechaDesbloqueo(fechaISO) {
  const desbloqueo = inicioSemana(fechaISO)
  desbloqueo.setDate(desbloqueo.getDate() - 3)
  return desbloqueo.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

// Clave estable para agrupar sesiones por día calendario (no por hora).
function claveDia(fechaISO) {
  const f = new Date(fechaISO)
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(
    f.getDate()
  ).padStart(2, '0')}`
}

function formatearEncabezadoDia(fechaISO) {
  const f = new Date(fechaISO)
  const texto = f.toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

// Agrupa una lista de sesiones (ya ordenada por fecha_hora) en días,
// conservando el orden cronológico de los días y de las sesiones dentro
// de cada día.
function agruparPorDia(sesiones) {
  const grupos = new Map()
  for (const s of sesiones) {
    const clave = claveDia(s.fecha_hora)
    if (!grupos.has(clave)) grupos.set(clave, [])
    grupos.get(clave).push(s)
  }
  return Array.from(grupos.entries()).map(([clave, items]) => ({
    clave,
    etiqueta: formatearEncabezadoDia(items[0].fecha_hora),
    items,
  }))
}

const ERRORES_TRADUCIDOS = [
  [/invalid login credentials/i, 'El correo o la contraseña no son correctos.'],
  [/email not confirmed/i, 'Tu correo aún no está confirmado. Revisa tu bandeja de entrada.'],
  [/user already registered/i, 'Ese correo ya tiene una cuenta. Intenta iniciar sesión.'],
  [/password should be at least/i, 'La contraseña debe tener al menos 6 caracteres.'],
  [/for security purposes/i, 'Por seguridad, espera unos segundos antes de intentar de nuevo.'],
  [/unable to validate email address/i, 'Ese correo no parece válido, revísalo.'],
  [/rate limit/i, 'Vamos despacio 💜 espera un momento antes de volver a intentar.'],
]

function traducirError(mensaje) {
  if (!mensaje) return ''
  const encontrado = ERRORES_TRADUCIDOS.find(([patron]) => patron.test(mensaje))
  return encontrado ? encontrado[1] : mensaje
}

export default function App() {
  const [session, setSession] = useState(null)
  const [cargandoAuth, setCargandoAuth] = useState(true)

  // formulario de login/registro
  const [modoRegistro, setModoRegistro] = useState(false)
  const [modoRecuperar, setModoRecuperar] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [aceptaTratamientoDatos, setAceptaTratamientoDatos] = useState(false)
  const [errorAuth, setErrorAuth] = useState('')
  const [registroExitoso, setRegistroExitoso] = useState(false)
  const [recuperacionEnviada, setRecuperacionEnviada] = useState(false)
  const [enviandoAuth, setEnviandoAuth] = useState(false)
  const [enviandoRecuperacion, setEnviandoRecuperacion] = useState(false)
  const [reenviandoConfirmacion, setReenviandoConfirmacion] = useState(false)
  const [confirmacionReenviada, setConfirmacionReenviada] = useState(false)

  // recuperación de contraseña (tras hacer clic en el link del correo)
  const [esRecuperacion, setEsRecuperacion] = useState(false)
  const [nuevaContrasena, setNuevaContrasena] = useState('')
  const [nuevaContrasena2, setNuevaContrasena2] = useState('')
  const [errorNuevaContrasena, setErrorNuevaContrasena] = useState('')
  const [contrasenaActualizada, setContrasenaActualizada] = useState(false)
  const [actualizandoContrasena, setActualizandoContrasena] = useState(false)

  // acciones en curso (para deshabilitar botones y evitar dobles clics)
  const [accionesEnCurso, setAccionesEnCurso] = useState(() => new Set())

  // datos de la app
  const [miPlan, setMiPlan] = useState(null)
  const [sesiones, setSesiones] = useState([]) // [{ ...sesion, cupos }]
  const [misReservas, setMisReservas] = useState([])
  const [cargandoDatos, setCargandoDatos] = useState(false)
  const [mensaje, setMensaje] = useState(null) // { tipo: 'ok'|'error', texto }
  const [diaAbierto, setDiaAbierto] = useState(null) // clave del día expandido

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCargandoAuth(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') {
        setEsRecuperacion(true)
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const cargarDatos = useCallback(async () => {
    if (!session) return
    setCargandoDatos(true)
    setMensaje(null)

    // 1. Plan activo del usuario
    const { data: plan } = await supabase
      .from('compras_plan')
      .select('id, clases_restantes, fecha_fin, planes(nombre, tipo)')
      .eq('usuario_id', session.user.id)
      .eq('estado', 'activo')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setMiPlan(plan)

    // 2. Sesiones programadas próximas
    const { data: sesionesData } = await supabase
      .from('sesiones')
      .select('id, fecha_hora, clases(nombre, disciplina), salas(nombre)')
      .eq('estado', 'programada')
      .gte('fecha_hora', new Date().toISOString())
      .order('fecha_hora', { ascending: true })
      .limit(20)

    const conCupos = await Promise.all(
      (sesionesData || []).map(async (s) => {
        const { data: cupos } = await supabase.rpc('cupos_disponibles', {
          p_sesion_id: s.id,
        })
        return { ...s, cupos }
      })
    )
    setSesiones(conCupos)

    // 3. Mis reservas confirmadas
    const { data: reservasData } = await supabase
      .from('reservas')
      .select('id, sesion_id, sesiones(fecha_hora, clases(nombre))')
      .eq('usuario_id', session.user.id)
      .eq('estado', 'confirmada')
      .order('created_at', { ascending: false })
    setMisReservas(reservasData || [])

    setCargandoDatos(false)
  }, [session])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  const gruposPorDia = useMemo(() => agruparPorDia(sesiones), [sesiones])

  // Cuando llegan sesiones nuevas, abre por defecto el día más próximo,
  // salvo que el usuario ya haya elegido un día que sigue existiendo.
  useEffect(() => {
    if (gruposPorDia.length === 0) {
      setDiaAbierto(null)
      return
    }
    const sigueExistiendo = gruposPorDia.some((g) => g.clave === diaAbierto)
    if (!sigueExistiendo) setDiaAbierto(gruposPorDia[0].clave)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gruposPorDia])

  async function manejarAuth(e) {
    e.preventDefault()
    setErrorAuth('')

    if (modoRegistro) {
      if (password !== password2) {
        setErrorAuth('Las contraseñas no coinciden, revísalas.')
        return
      }
      if (!aceptaTratamientoDatos) {
        setErrorAuth('Necesitamos que aceptes el tratamiento de tus datos personales para crear tu cuenta.')
        return
      }
    }

    setEnviandoAuth(true)
    if (modoRegistro) {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setErrorAuth(traducirError(error.message))
      } else if (data?.user && data.user.identities?.length === 0) {
        // Supabase no manda error por seguridad, pero no crea cuenta nueva
        // ni reenvía el correo si ese email ya está registrado.
        setErrorAuth('Ese correo ya tiene una cuenta. Intenta iniciar sesión.')
      } else {
        setRegistroExitoso(true)
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setErrorAuth(traducirError(error.message))
    }
    setEnviandoAuth(false)
  }

  async function reenviarConfirmacion() {
    setErrorAuth('')
    setReenviandoConfirmacion(true)
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    if (error) {
      setErrorAuth(traducirError(error.message))
    } else {
      setConfirmacionReenviada(true)
    }
    setReenviandoConfirmacion(false)
  }

  async function cerrarSesion() {
    await supabase.auth.signOut()
  }

  async function enviarRecuperacion(e) {
    e.preventDefault()
    setErrorAuth('')
    setEnviandoRecuperacion(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    if (error) {
      setErrorAuth(traducirError(error.message))
    } else {
      setRecuperacionEnviada(true)
    }
    setEnviandoRecuperacion(false)
  }

  async function actualizarContrasena(e) {
    e.preventDefault()
    setErrorNuevaContrasena('')
    if (nuevaContrasena !== nuevaContrasena2) {
      setErrorNuevaContrasena('Las contraseñas no coinciden, revísalas.')
      return
    }
    setActualizandoContrasena(true)
    const { error } = await supabase.auth.updateUser({ password: nuevaContrasena })
    if (error) {
      setErrorNuevaContrasena(traducirError(error.message))
    } else {
      setContrasenaActualizada(true)
    }
    setActualizandoContrasena(false)
  }

  async function reservar(sesionId) {
    setMensaje(null)
    if (!miPlan) {
      setMensaje({ tipo: 'error', texto: 'No tienes un plan activo. Compra un plan antes de reservar.' })
      return
    }
    setAccionesEnCurso((prev) => new Set(prev).add(sesionId))
    const { error } = await supabase.from('reservas').insert({
      sesion_id: sesionId,
      usuario_id: session.user.id,
      estado: 'confirmada',
      compra_plan_id: miPlan.id,
    })
    if (error) {
      setMensaje({ tipo: 'error', texto: traducirError(error.message) })
    } else {
      setMensaje({ tipo: 'ok', texto: '¡Clase reservada!' })
      cargarDatos()
    }
    setAccionesEnCurso((prev) => {
      const next = new Set(prev)
      next.delete(sesionId)
      return next
    })
  }

  async function cancelar(reservaId) {
    setMensaje(null)
    setAccionesEnCurso((prev) => new Set(prev).add(reservaId))
    const { error } = await supabase.rpc('cancelar_reserva', { p_reserva_id: reservaId })
    if (error) {
      setMensaje({ tipo: 'error', texto: traducirError(error.message) })
    } else {
      setMensaje({ tipo: 'ok', texto: 'Reserva cancelada, tu clase volvió al plan.' })
      cargarDatos()
    }
    setAccionesEnCurso((prev) => {
      const next = new Set(prev)
      next.delete(reservaId)
      return next
    })
  }

  if (cargandoAuth) return null

  if (esRecuperacion) {
    return (
      <div className="app">
        <div className="encabezado">
          <div>
            <h1>Academia Coquín</h1>
            <div className="subtitulo">Nueva contraseña</div>
          </div>
        </div>
        <div className="tarjeta">
          {contrasenaActualizada ? (
            <div className="mensaje-confirmacion">
              <p>¡Listo, contraseña actualizada! 💜</p>
              <p>Ya puedes seguir agendando tus clases con nosotr@s.</p>
              <p><em>Con cariño, Gustavo</em></p>
              <div style={{ marginTop: 12 }}>
                <button
                  className="btn-primario"
                  onClick={() => {
                    setEsRecuperacion(false)
                    setContrasenaActualizada(false)
                    setPassword('')
                    setNuevaContrasena('')
                  }}
                >
                  Continuar
                </button>
              </div>
            </div>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                Elige tu nueva contraseña y listo, quedas lista para volver
                a la barra 💜
              </p>
              {errorNuevaContrasena && (
                <div className="mensaje-error">{errorNuevaContrasena}</div>
              )}
              <form className="form-auth" onSubmit={actualizarContrasena}>
                <input
                  type="password"
                  placeholder="Nueva contraseña"
                  value={nuevaContrasena}
                  onChange={(e) => setNuevaContrasena(e.target.value)}
                  required
                  minLength={6}
                />
                <input
                  type="password"
                  placeholder="Confirma tu nueva contraseña"
                  value={nuevaContrasena2}
                  onChange={(e) => setNuevaContrasena2(e.target.value)}
                  required
                  minLength={6}
                />
                <button className="btn-primario" type="submit" disabled={actualizandoContrasena}>
                  {actualizandoContrasena ? 'Guardando...' : 'Guardar nueva contraseña'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="app">
        <div className="encabezado">
          <div>
            <h1>Academia Coquín</h1>
            <div className="subtitulo">Reserva de clases</div>
          </div>
        </div>
        <div className="tarjeta">
          {registroExitoso ? (
            <div className="mensaje-confirmacion">
              <p>¡Ya casi estás dentro! 💜</p>
              <p>
                Te acabamos de enviar un correo a <strong>{email}</strong>.
                Ábrelo y dale clic al botón para confirmar tu cuenta — así ya
                quedas lista para agendar tus clases con nosotr@s.
              </p>
              <p>
                Si no lo ves en unos minutos, revisa la carpeta de spam,
                a veces se esconde por ahí 😉
              </p>
              {errorAuth && <div className="mensaje-error">{errorAuth}</div>}
              {confirmacionReenviada && (
                <div className="mensaje-ok">Te lo volvimos a enviar 💜</div>
              )}
              <p><em>Con cariño, Gustavo</em></p>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  className="enlace"
                  onClick={() => {
                    setRegistroExitoso(false)
                    setModoRegistro(false)
                    setConfirmacionReenviada(false)
                  }}
                >
                  Ya confirmé mi correo, iniciar sesión
                </button>
                <button
                  className="enlace"
                  onClick={reenviarConfirmacion}
                  disabled={reenviandoConfirmacion}
                >
                  {reenviandoConfirmacion ? 'Enviando...' : '¿No te llegó? Reenviar correo'}
                </button>
              </div>
            </div>
          ) : modoRecuperar ? (
            recuperacionEnviada ? (
              <div className="mensaje-confirmacion">
                <p>Correo en camino 💜</p>
                <p>
                  Te enviamos un correo a <strong>{email}</strong> con un
                  link para que elijas una contraseña nueva. Ábrelo y dale
                  clic al botón — te esperamos del otro lado.
                </p>
                <p>
                  Si no lo ves pronto, revisa spam, a veces se esconde
                  por ahí 😉
                </p>
                <p><em>Con cariño, Gustavo</em></p>
                <div style={{ marginTop: 12 }}>
                  <button
                    className="enlace"
                    onClick={() => {
                      setModoRecuperar(false)
                      setRecuperacionEnviada(false)
                    }}
                  >
                    Volver a iniciar sesión
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p style={{ marginTop: 0 }}>
                  Tranquila, nos pasa a todas 💜 Escribe tu correo y te
                  mandamos un link para que elijas una contraseña nueva.
                </p>
                {errorAuth && <div className="mensaje-error">{errorAuth}</div>}
                <form className="form-auth" onSubmit={enviarRecuperacion}>
                  <input
                    type="email"
                    placeholder="Correo"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                  <button className="btn-primario" type="submit" disabled={enviandoRecuperacion}>
                    {enviandoRecuperacion ? 'Enviando...' : 'Enviar link de recuperación'}
                  </button>
                </form>
                <div style={{ marginTop: 12 }}>
                  <button className="enlace" onClick={() => setModoRecuperar(false)}>
                    Volver a iniciar sesión
                  </button>
                </div>
              </>
            )
          ) : (
            <>
              {errorAuth && <div className="mensaje-error">{errorAuth}</div>}
              <form className="form-auth" onSubmit={manejarAuth}>
                <input
                  type="email"
                  placeholder="Correo"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <input
                  type="password"
                  placeholder="Contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                {modoRegistro && (
                  <input
                    type="password"
                    placeholder="Confirma tu contraseña"
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    required
                  />
                )}
                {modoRegistro && (
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={aceptaTratamientoDatos}
                      onChange={(e) => setAceptaTratamientoDatos(e.target.checked)}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      Acepto que Academia Coquín trate mis datos personales
                      para gestionar mi cuenta y mis reservas.
                    </span>
                  </label>
                )}
                <button className="btn-primario" type="submit" disabled={enviandoAuth}>
                  {enviandoAuth
                    ? 'Un momento...'
                    : modoRegistro
                    ? 'Crear cuenta'
                    : 'Iniciar sesión'}
                </button>
              </form>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  className="enlace"
                  onClick={() => {
                    setModoRegistro(!modoRegistro)
                    setPassword2('')
                    setAceptaTratamientoDatos(false)
                    setErrorAuth('')
                  }}
                >
                  {modoRegistro ? '¿Ya tienes cuenta? Inicia sesión' : '¿Nueva por aquí? Crea tu cuenta'}
                </button>
                {!modoRegistro && (
                  <button className="enlace" onClick={() => setModoRecuperar(true)}>
                    ¿Olvidaste tu contraseña?
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="encabezado">
        <div>
          <h1>Academia Coquín</h1>
          <div className="subtitulo">{session.user.email}</div>
        </div>
        <button className="btn-secundario" onClick={cerrarSesion}>
          Cerrar sesión
        </button>
      </div>

      {mensaje && (
        <div className={mensaje.tipo === 'error' ? 'mensaje-error' : 'mensaje-ok'}>
          {mensaje.texto}
        </div>
      )}

      {miPlan ? (
        <div className="plan-activo">
          <div className="etq">{miPlan.planes?.nombre}</div>
          <div className="num">
            {miPlan.clases_restantes === null ? '∞' : miPlan.clases_restantes}
          </div>
          <div className="etq">clases restantes</div>
        </div>
      ) : (
        <div className="tarjeta">
          <strong>No tienes un plan activo.</strong>
          <div className="vacio">Contacta a la academia para activar tu membresía.</div>
        </div>
      )}

      <div className="tarjeta">
        <h3 style={{ marginTop: 0 }}>Próximas clases</h3>
        {cargandoDatos && <div className="vacio">Cargando...</div>}
        {!cargandoDatos && sesiones.length === 0 && (
          <div className="vacio">No hay clases programadas por ahora.</div>
        )}
        {gruposPorDia.map((grupo) => {
          const abierto = diaAbierto === grupo.clave
          const disponibles = grupo.items.filter(
            (s) => s.cupos > 0 && esSesionReservable(s.fecha_hora)
          ).length
          return (
            <div
              key={grupo.clave}
              style={{
                borderBottom: '1px solid #eee',
                marginBottom: abierto ? 8 : 0,
              }}
            >
              <button
                type="button"
                onClick={() => setDiaAbierto(abierto ? null : grupo.clave)}
                aria-expanded={abierto}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '12px 4px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ fontWeight: 600, color: '#6b21a8' }}>{grupo.etiqueta}</span>
                <span style={{ fontSize: 13, color: '#666', flex: 1, marginLeft: 12 }}>
                  {grupo.items.length} clase{grupo.items.length === 1 ? '' : 's'}
                  {disponibles > 0 ? ` · ${disponibles} con cupo` : ''}
                </span>
                <span
                  style={{
                    display: 'inline-block',
                    transform: abierto ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s ease',
                    color: '#6b21a8',
                    fontSize: 18,
                  }}
                >
                  ›
                </span>
              </button>
              {abierto && (
                <div style={{ paddingBottom: 4 }}>
                  {grupo.items.map((s) => {
                    const llena = s.cupos <= 0
                    const reservable = esSesionReservable(s.fecha_hora)
                    return (
                      <div className="sesion-fila" key={s.id}>
                        <div className="sesion-info">
                          <div className="nombre">{s.clases?.nombre}</div>
                          <div className="meta">
                            {formatearFecha(s.fecha_hora)} · {s.salas?.nombre}
                            {s.clases?.disciplina ? ` · ${s.clases.disciplina}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            className={`cupos ${
                              !reservable ? 'proximamente' : llena ? 'lleno' : 'disponible'
                            }`}
                          >
                            {!reservable
                              ? `Se habilita el ${fechaDesbloqueo(s.fecha_hora)}`
                              : llena
                              ? 'Lleno'
                              : `${s.cupos} cupos`}
                          </span>
                          <button
                            className="btn-primario"
                            disabled={llena || !reservable || accionesEnCurso.has(s.id)}
                            title={
                              !reservable
                                ? 'Esta clase aún no está disponible para reservar'
                                : undefined
                            }
                            onClick={() => reservar(s.id)}
                          >
                            {accionesEnCurso.has(s.id) ? 'Reservando...' : 'Reservar'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="tarjeta">
        <h3 style={{ marginTop: 0 }}>Mis reservas</h3>
        {misReservas.length === 0 && <div className="vacio">Aún no tienes reservas.</div>}
        {misReservas.map((r) => {
          const horas = horasHastaSesion(r.sesiones.fecha_hora)
          const puedeCancelar = horas >= HORAS_LIMITE_CANCELACION
          return (
            <div className="sesion-fila" key={r.id}>
              <div className="sesion-info">
                <div className="nombre">{r.sesiones.clases?.nombre}</div>
                <div className="meta">{formatearFecha(r.sesiones.fecha_hora)}</div>
              </div>
              <button
                className="btn-peligro"
                disabled={!puedeCancelar || accionesEnCurso.has(r.id)}
                title={
                  puedeCancelar
                    ? 'Cancelar reserva'
                    : 'Solo se puede cancelar hasta 48h antes de la clase'
                }
                onClick={() => cancelar(r.id)}
              >
                {accionesEnCurso.has(r.id) ? 'Cancelando...' : 'Cancelar'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}