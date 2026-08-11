import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

const CLASE_VACIA = {
  id: null,
  nombre: '',
  categoria: 'deportiva',   // 'deportiva' | 'artistica' | 'exotica'
  disciplina: '',
  duracion_minutos: '',
  descripcion: '',
  profesor_id: '',
  activa: true,
};

export default function PanelClases() {
  const [clases, setClases] = useState([]);
  const [profesores, setProfesores] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [claseEditando, setClaseEditando] = useState(CLASE_VACIA);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    cargarTodo();
  }, []);

  async function cargarTodo() {
    setCargando(true);
    setError(null);

    const [resClases, resProfesores] = await Promise.all([
      supabase
        .from('clases')
        .select('*, profesores(nombre)')
        .order('created_at', { ascending: false }),
      supabase.from('profesores').select('*').order('nombre', { ascending: true }),
    ]);

    if (resClases.error) {
      setError('No se pudieron cargar las clases: ' + resClases.error.message);
    } else {
      setClases(resClases.data);
    }
    if (!resProfesores.error) {
      setProfesores(resProfesores.data);
    }
    setCargando(false);
  }

  function abrirFormNuevo() {
    setClaseEditando(CLASE_VACIA);
    setMostrarForm(true);
  }

  function abrirFormEditar(clase) {
    setClaseEditando({
      ...clase,
      duracion_minutos: clase.duracion_minutos ?? '',
      descripcion: clase.descripcion ?? '',
      profesor_id: clase.profesor_id ?? '',
    });
    setMostrarForm(true);
  }

  async function guardarClase(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);

    const payload = {
      nombre: claseEditando.nombre.trim(),
      categoria: claseEditando.categoria,
      disciplina: claseEditando.disciplina.trim() || null,
      duracion_minutos: Number(claseEditando.duracion_minutos),
      descripcion: claseEditando.descripcion.trim() || null,
      profesor_id: claseEditando.profesor_id || null,
      activa: claseEditando.activa,
    };

    let resultado;
    if (claseEditando.id) {
      resultado = await supabase.from('clases').update(payload).eq('id', claseEditando.id);
    } else {
      resultado = await supabase.from('clases').insert(payload);
    }

    if (resultado.error) {
      setError('No se pudo guardar la clase: ' + resultado.error.message);
    } else {
      setMostrarForm(false);
      await cargarTodo();
    }
    setGuardando(false);
  }

  async function alternarActiva(clase) {
    const { error } = await supabase
      .from('clases')
      .update({ activa: !clase.activa })
      .eq('id', clase.id);

    if (error) {
      setError('No se pudo actualizar el estado: ' + error.message);
    } else {
      await cargarTodo();
    }
  }

  return (
    <div className="panel-planes">
      <div className="panel-planes-header">
        <h2>Clases</h2>
        <button className="btn-primario" onClick={abrirFormNuevo}>
          + Crear clase
        </button>
      </div>

      {error && <p className="mensaje-error">{error}</p>}
      {!cargando && profesores.length === 0 && (
        <p className="vacio">
          Todavía no has creado ningún profesor — crea al menos uno en el
          panel de Profesores para poder asignarlo a una clase.
        </p>
      )}

      {cargando ? (
        <p>Cargando clases...</p>
      ) : clases.length === 0 ? (
        <p className="vacio">Todavía no has creado ninguna clase.</p>
      ) : (
        <div className="tabla-planes-wrap">
          <table className="tabla-planes">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Disciplina</th>
                <th>Duración</th>
                <th>Profesor</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clases.map((clase) => (
                <tr key={clase.id} className={!clase.activa ? 'fila-inactiva' : ''}>
                  <td>{clase.nombre}</td>
                  <td>{clase.categoria}</td>
                  <td>{clase.disciplina || '—'}</td>
                  <td>{clase.duracion_minutos} min</td>
                  <td>{clase.profesores?.nombre || '— sin asignar —'}</td>
                  <td>
                    <span className={clase.activa ? 'badge-activo' : 'badge-inactivo'}>
                      {clase.activa ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="acciones-planes">
                    <button onClick={() => abrirFormEditar(clase)}>Editar</button>
                    <button onClick={() => alternarActiva(clase)}>
                      {clase.activa ? 'Desactivar' : 'Activar'}
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
            onSubmit={guardarClase}
          >
            <h3>{claseEditando.id ? 'Editar clase' : 'Crear clase'}</h3>

            <label>
              Nombre
              <input
                type="text"
                required
                value={claseEditando.nombre}
                onChange={(e) =>
                  setClaseEditando({ ...claseEditando, nombre: e.target.value })
                }
              />
            </label>

            <label>
              Categoría
              <select
                value={claseEditando.categoria}
                onChange={(e) =>
                  setClaseEditando({ ...claseEditando, categoria: e.target.value })
                }
              >
                <option value="deportiva">Deportiva</option>
                <option value="artistica">Artística</option>
                <option value="exotica">Exótica</option>
              </select>
            </label>

            <label>
              Disciplina
              <input
                type="text"
                placeholder="Ej. pole sport, lira, flexibilidad..."
                value={claseEditando.disciplina}
                onChange={(e) =>
                  setClaseEditando({ ...claseEditando, disciplina: e.target.value })
                }
              />
            </label>

            <label>
              Duración (minutos)
              <input
                type="number"
                min="1"
                required
                value={claseEditando.duracion_minutos}
                onChange={(e) =>
                  setClaseEditando({ ...claseEditando, duracion_minutos: e.target.value })
                }
              />
            </label>

            <label>
              Profesor
              <select
                value={claseEditando.profesor_id}
                onChange={(e) =>
                  setClaseEditando({ ...claseEditando, profesor_id: e.target.value })
                }
              >
                <option value="">— sin asignar —</option>
                {profesores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                    {!p.activo ? ' (inactivo)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Descripción (opcional)
              <textarea
                rows={3}
                value={claseEditando.descripcion}
                onChange={(e) =>
                  setClaseEditando({ ...claseEditando, descripcion: e.target.value })
                }
              />
            </label>

            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={claseEditando.activa}
                onChange={(e) =>
                  setClaseEditando({ ...claseEditando, activa: e.target.checked })
                }
              />
              Clase activa
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
