import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

const PROFESOR_VACIO = {
  id: null,
  nombre: '',
  activo: true,
};

export default function PanelProfesores() {
  const [profesores, setProfesores] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [profesorEditando, setProfesorEditando] = useState(PROFESOR_VACIO);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    cargarProfesores();
  }, []);

  async function cargarProfesores() {
    setCargando(true);
    setError(null);
    const { data, error } = await supabase
      .from('profesores')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setError('No se pudieron cargar los profesores: ' + error.message);
    } else {
      setProfesores(data);
    }
    setCargando(false);
  }

  function abrirFormNuevo() {
    setProfesorEditando(PROFESOR_VACIO);
    setMostrarForm(true);
  }

  function abrirFormEditar(profesor) {
    setProfesorEditando(profesor);
    setMostrarForm(true);
  }

  async function guardarProfesor(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);

    const payload = {
      nombre: profesorEditando.nombre.trim(),
      activo: profesorEditando.activo,
    };

    let resultado;
    if (profesorEditando.id) {
      resultado = await supabase.from('profesores').update(payload).eq('id', profesorEditando.id);
    } else {
      resultado = await supabase.from('profesores').insert(payload);
    }

    if (resultado.error) {
      setError('No se pudo guardar el profesor: ' + resultado.error.message);
    } else {
      setMostrarForm(false);
      await cargarProfesores();
    }
    setGuardando(false);
  }

  async function alternarActivo(profesor) {
    const { error } = await supabase
      .from('profesores')
      .update({ activo: !profesor.activo })
      .eq('id', profesor.id);

    if (error) {
      setError('No se pudo actualizar el estado: ' + error.message);
    } else {
      await cargarProfesores();
    }
  }

  return (
    <div className="panel-planes">
      <div className="panel-planes-header">
        <h2>Profesores</h2>
        <button className="btn-primario" onClick={abrirFormNuevo}>
          + Crear profesor
        </button>
      </div>

      {error && <p className="mensaje-error">{error}</p>}

      {cargando ? (
        <p>Cargando profesores...</p>
      ) : profesores.length === 0 ? (
        <p className="vacio">Todavía no has creado ningún profesor.</p>
      ) : (
        <div className="tabla-planes-wrap">
          <table className="tabla-planes">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {profesores.map((profesor) => (
                <tr key={profesor.id} className={!profesor.activo ? 'fila-inactiva' : ''}>
                  <td>{profesor.nombre}</td>
                  <td>
                    <span className={profesor.activo ? 'badge-activo' : 'badge-inactivo'}>
                      {profesor.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="acciones-planes">
                    <button onClick={() => abrirFormEditar(profesor)}>Editar</button>
                    <button onClick={() => alternarActivo(profesor)}>
                      {profesor.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mostrarForm && (
        <div className="modal-overlay" onClick={() => setMostrarForm(false)}>
          <form
            className="modal-form"
            onClick={(e) => e.stopPropagation()}
            onSubmit={guardarProfesor}
          >
            <h3>{profesorEditando.id ? 'Editar profesor' : 'Crear profesor'}</h3>

            <label>
              Nombre
              <input
                type="text"
                required
                value={profesorEditando.nombre}
                onChange={(e) =>
                  setProfesorEditando({ ...profesorEditando, nombre: e.target.value })
                }
              />
            </label>

            <div className="modal-acciones">
              <button type="button" onClick={() => setMostrarForm(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn-primario" disabled={guardando}>
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
