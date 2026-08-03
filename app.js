const SUPABASE_URL = "https://cplmxkvlrmiwunpojxke.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwbG14a3Zscm1pd3VucG9qeGtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NjMwMTYsImV4cCI6MjA4NzUzOTAxNn0.ZugTlGxz38vBv7H9Cyn6Uq_HiKc7Za9rzDmO9RU--lc";
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzY8t7Ih67FNxq20EgS87v-hPnmKVhb3ZQk1uEO_Z8qN6xnqh3uxXuFWYp9fipnz94/exec";

// Horario por defecto si el curso no tiene configuración previa en Supabase
const HORA_ENTRADA_DEFECTO = "14:00";
const TOLERANCIA_DEFECTO = 5;

let html5QrCode = new Html5Qrcode("reader");
let ultimoCodigo = null; 
let ultimaVez = 0;       
let cursoSeleccionadoGlobal = "";

const obtenerFechaLocal = () => {
    return new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' 
    }).format(new Date());
};

const obtenerHoraLocal = () => {
    return new Date().toLocaleTimeString('es-BO', {
        timeZone: 'America/La_Paz', hour12: false, hour: '2-digit', minute: '2-digit'
    });
};

const obtenerCursoSeleccionado = () => {
    return cursoSeleccionadoGlobal;
};

// Genera los botones de cada curso al cargar la aplicación
async function cargarBotonesCursos() {
    const contenedor = document.getElementById("contenedorBotonesCursos");
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes?select=curso`, {
            headers: { 
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });

        if (!res.ok) {
            throw new Error(`Error HTTP: ${res.status}`);
        }

        const data = await res.json();

        if (!Array.isArray(data)) {
            throw new Error("Respuesta inválida de Supabase.");
        }

        const cursosUnicos = [...new Set(data.map(item => item.curso).filter(Boolean))].sort();
        
        if (cursosUnicos.length === 0) {
            contenedor.innerHTML = '<p style="color:#ef4444;">No se encontraron cursos registrados en la tabla <b>estudiantes</b>.</p><button class="btn btn-sec" onclick="cargarBotonesCursos()">🔄 Reintentar</button>';
            return;
        }

        contenedor.innerHTML = "";
        cursosUnicos.forEach(curso => {
            const btn = document.createElement("button");
            btn.className = "btn-curso";
            btn.innerText = `Curso ${curso}`;
            btn.onclick = () => seleccionarCursoEIngresar(curso);
            contenedor.appendChild(btn);
        });
    } catch (e) {
        console.error("Error al cargar cursos:", e);
        contenedor.innerHTML = `
            <p style="color:#ef4444; font-size:0.9rem;">⚠️ No se pudo conectar con Supabase.</p>
            <p style="color:#64748b; font-size:0.8rem;">Verifica la tabla 'estudiantes' o los permisos RLS en Supabase.</p>
            <button class="btn btn-sec" onclick="cargarBotonesCursos()">🔄 Reintentar</button>
        `;
    }
}

// Inicia el sistema para el curso presionado
async function seleccionarCursoEIngresar(curso) {
    cursoSeleccionadoGlobal = curso;
    document.getElementById("cursoActivoTitulo").innerText = curso;
    
    document.getElementById("pantallaInicio").style.display = "none";
    document.getElementById("panelPrincipal").style.display = "block";

    actualizarStats();
    cargarListaAlumnos();
    iniciarScanner();
}

// Regresa a la pantalla inicial de botones
function volverAInicio() {
    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().then(() => {
            cursoSeleccionadoGlobal = "";
            document.getElementById("panelPrincipal").style.display = "none";
            document.getElementById("pantallaInicio").style.display = "block";
        }).catch(err => console.error("Error al detener el scanner:", err));
    } else {
        cursoSeleccionadoGlobal = "";
        document.getElementById("panelPrincipal").style.display = "none";
        document.getElementById("pantallaInicio").style.display = "block";
    }
}

// Carga la configuración directamente desde Supabase
async function obtenerConfigHorarioCurso(curso) {
    if (!curso) return { hora: HORA_ENTRADA_DEFECTO, tolerancia: TOLERANCIA_DEFECTO };
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/configuraciones_cursos?curso=eq.${encodeURIComponent(curso)}`, {
            headers: { 
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        }).then(r => r.json());

        if (res && res.length > 0) {
            return { hora: res[0].hora_entrada, tolerancia: parseInt(res[0].tolerancia) };
        }
    } catch (e) {
        console.error("Error al obtener configuración de horario:", e);
    }
    return { hora: HORA_ENTRADA_DEFECTO, tolerancia: TOLERANCIA_DEFECTO };
}

// Guarda o actualiza la configuración en Supabase
async function configurarHorarioCurso() {
    const cursoActual = obtenerCursoSeleccionado();
    if (!cursoActual) {
        return Swal.fire('Atención', 'Por favor selecciona primero un curso.', 'warning');
    }

    const configActual = await obtenerConfigHorarioCurso(cursoActual);

    const { value: formValues } = await Swal.fire({
        title: `Configurar Horario - ${cursoActual}`,
        html: `
            <div style="text-align: left; font-size: 14px;">
                <label style="display:block; margin-bottom: 5px;"><b>Hora de Entrada (HH:MM):</b></label>
                <input id="swal-hora" type="time" class="swal2-input" value="${configActual.hora}" style="margin-top:0; width: 80%;">
                
                <label style="display:block; margin-top: 15px; margin-bottom: 5px;"><b>Tolerancia en minutos:</b></label>
                <input id="swal-tolerancia" type="number" class="swal2-input" value="${configActual.tolerancia}" min="0" style="margin-top:0; width: 80%;">
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const hora = document.getElementById('swal-hora').value;
            const tolerancia = document.getElementById('swal-tolerancia').value;
            if (!hora) {
                Swal.showValidationMessage('Debes ingresar una hora de entrada válida');
                return false;
            }
            return { hora: hora, tolerancia: parseInt(tolerancia) || 0 };
        }
    });

    if (formValues) {
        try {
            const resExistente = await fetch(`${SUPABASE_URL}/rest/v1/configuraciones_cursos?curso=eq.${encodeURIComponent(cursoActual)}`, {
                headers: { 
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`
                }
            }).then(r => r.json());

            let url = `${SUPABASE_URL}/rest/v1/configuraciones_cursos`;
            let metodo = 'POST';

            if (resExistente && resExistente.length > 0) {
                metodo = 'PATCH';
                url += `?id=eq.${resExistente[0].id}`;
            }

            const bodyData = {
                curso: cursoActual,
                hora_entrada: formValues.hora,
                tolerancia: formValues.tolerancia
            };

            const res = await fetch(url, {
                method: metodo,
                headers: { 
                    'apikey': SUPABASE_KEY, 
                    'Authorization': `Bearer ${SUPABASE_KEY}`, 
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify(bodyData)
            });

            if (res.ok) {
                Swal.fire('Guardado', `Horario para ${cursoActual} guardado en Supabase: ${formValues.hora} (+${formValues.tolerancia} min tolerancia)`, 'success');
            } else {
                Swal.fire('Error', 'No se pudo guardar la configuración.', 'error');
            }
        } catch (e) {
            console.error(e);
            Swal.fire('Error', 'Ocurrió un fallo en la conexión.', 'error');
        }
    }
}

async function enviarDatosDuales(datos) {
    const resBusqueda = await fetch(`${SUPABASE_URL}/rest/v1/asistencias?estudiante_id=eq.${datos.estudiante_id}&fecha=eq.${datos.fecha}`, {
        headers: { 
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        }
    });
    const existente = await resBusqueda.json();

    let url = `${SUPABASE_URL}/rest/v1/asistencias`;
    let metodo = 'POST';

    if (existente && existente.length > 0) {
        metodo = 'PATCH';
        url += `?id=eq.${existente[0].id}`;
    }

    const res = await fetch(url, {
        method: metodo,
        headers: { 
            'apikey': SUPABASE_KEY, 
            'Authorization': `Bearer ${SUPABASE_KEY}`, 
            'Content-Type': 'application/json' 
        },
        body: JSON.stringify(datos)
    });

    if (res.ok && GOOGLE_SCRIPT_URL !== "") {
        fetch(GOOGLE_SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(datos) });
    }
    return res.ok;
}

async function registrarAsistencia(codigo) {
    const cursoSeleccionado = obtenerCursoSeleccionado();
    if (!cursoSeleccionado) return;

    const ahora = Date.now();
    if (codigo === ultimoCodigo && (ahora - ultimaVez) < 5000) return; 

    ultimoCodigo = codigo;
    ultimaVez = ahora;

    try {
        const resAlu = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes?codigo_qr=eq.${codigo}&curso=eq.${encodeURIComponent(cursoSeleccionado)}`, {
            headers: { 
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        }).then(r => r.json());
        
        if (!resAlu.length) {
            Swal.fire('Error', `QR no reconocido en el curso ${cursoSeleccionado}`, 'error');
            return;
        }
        
        const alumno = resAlu[0];

        const { isConfirmed } = await Swal.fire({
            title: '¿Registrar?',
            text: `${alumno.nombre} (${cursoSeleccionado})`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí',
            cancelButtonText: 'No'
        });

        if (isConfirmed) {
            const horaBol = obtenerHoraLocal();
            const [hA, mA] = horaBol.split(":").map(Number);
            
            const configHorario = await obtenerConfigHorarioCurso(cursoSeleccionado);
            const [hE, mE] = configHorario.hora.split(":").map(Number);
            const tolerancia = configHorario.tolerancia;

            const estado = (hA * 60 + mA <= hE * 60 + mE + tolerancia) ? "P" : "A";

            await enviarDatosDuales({ 
                estudiante_id: alumno.id, 
                nombre_estudiante: alumno.nombre, 
                curso: cursoSeleccionado,
                fecha: obtenerFechaLocal(), 
                hora: horaBol, 
                estado: estado 
            });
            
            Swal.fire({ title: 'Éxito', text: 'Registrado', icon: 'success', timer: 1000, showConfirmButton: false });
            actualizarStats();
        }
    } catch (e) { console.error(e); }
}

async function finalizarDia() {
    const cursoSeleccionado = obtenerCursoSeleccionado();
    if (!cursoSeleccionado) return;

    const fechaHoy = obtenerFechaLocal();
    const headers = { 
        'apikey': SUPABASE_KEY, 
        'Authorization': `Bearer ${SUPABASE_KEY}` 
    };

    const alus = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes?curso=eq.${encodeURIComponent(cursoSeleccionado)}`, { headers }).then(r => r.json());
    const asis = await fetch(`${SUPABASE_URL}/rest/v1/asistencias?fecha=eq.${fechaHoy}&curso=eq.${encodeURIComponent(cursoSeleccionado)}`, { headers }).then(r => r.json());
    
    const idsConAsistencia = asis.map(a => a.estudiante_id);
    const ausentes = alus.filter(al => !idsConAsistencia.includes(al.id));

    if (ausentes.length === 0) return Swal.fire('Listo', `No hay ausentes en ${cursoSeleccionado}`, 'success');

    const { isConfirmed } = await Swal.fire({
        title: `Cerrar Jornada (${cursoSeleccionado})`,
        text: `Hay ${ausentes.length} ausentes. ¿Poner FALTA?`,
        icon: 'warning',
        showCancelButton: true
    });

    if (isConfirmed) {
        for (let al of ausentes) {
            await enviarDatosDuales({
                estudiante_id: al.id, 
                nombre_estudiante: al.nombre,
                curso: cursoSeleccionado,
                fecha: fechaHoy, 
                hora: "00:00", 
                estado: "F"
            });
            await new Promise(r => setTimeout(r, 400));
        }
        Swal.fire('Éxito', 'Faltas registradas', 'success');
        actualizarStats();
    }
}

async function registrarManual() {
    const cursoSeleccionado = obtenerCursoSeleccionado();
    const sel = document.getElementById("licNombre");
    if(!sel.value) return;

    await enviarDatosDuales({ 
        estudiante_id: parseInt(sel.value), 
        nombre_estudiante: sel.options[sel.selectedIndex].dataset.nombre,
        curso: cursoSeleccionado,
        fecha: obtenerFechaLocal(), 
        hora: obtenerHoraLocal(), 
        estado: document.getElementById("licEstado").value 
    });
    Swal.fire('Éxito', 'Guardado', 'success');
    actualizarStats();
}

async function actualizarStats() {
    const cursoSeleccionado = obtenerCursoSeleccionado();
    if (!cursoSeleccionado) return;

    let url = `${SUPABASE_URL}/rest/v1/asistencias?fecha=eq.${obtenerFechaLocal()}&curso=eq.${encodeURIComponent(cursoSeleccionado)}`;

    const res = await fetch(url, { 
        headers: { 
            'apikey': SUPABASE_KEY, 
            'Authorization': `Bearer ${SUPABASE_KEY}` 
        } 
    }).then(r => r.json());

    const c = { P: 0, A: 0, F: 0, L: 0 };
    if (Array.isArray(res)) {
        res.forEach(a => { if(c[a.estado] !== undefined) c[a.estado]++; });
    }
    
    if (document.getElementById("sP")) document.getElementById("sP").innerText = c.P;
    if (document.getElementById("sA")) document.getElementById("sA").innerText = c.A;
    if (document.getElementById("sF")) document.getElementById("sF").innerText = c.F;
    if (document.getElementById("sL")) document.getElementById("sL").innerText = c.L;
}

async function cargarListaAlumnos() {
    const cursoSeleccionado = obtenerCursoSeleccionado();
    const s = document.getElementById("licNombre");
    if (!s || !cursoSeleccionado) return;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes?curso=eq.${encodeURIComponent(cursoSeleccionado)}&order=nombre.asc`, { 
        headers: { 
            'apikey': SUPABASE_KEY, 
            'Authorization': `Bearer ${SUPABASE_KEY}` 
        } 
    }).then(r => r.json());

    s.innerHTML = '<option value="">-- Seleccionar --</option>';
    if (Array.isArray(res)) {
        res.forEach(al => {
            let opt = document.createElement("option");
            opt.value = al.id; 
            opt.dataset.nombre = al.nombre; 
            opt.innerText = al.nombre;
            s.appendChild(opt);
        });
    }
}

async function buscarRegistros() {
    const f = document.getElementById("busFecha").value;
    const cursoSeleccionado = obtenerCursoSeleccionado();
    if (!cursoSeleccionado) return;

    let url = `${SUPABASE_URL}/rest/v1/asistencias?fecha=eq.${f}&curso=eq.${encodeURIComponent(cursoSeleccionado)}&order=nombre_estudiante.asc`;

    const res = await fetch(url, { 
        headers: { 
            'apikey': SUPABASE_KEY, 
            'Authorization': `Bearer ${SUPABASE_KEY}` 
        } 
    }).then(r => r.json());

    const b = document.getElementById("bodyTabla");
    document.getElementById("contTabla").style.display = "block";
    if (Array.isArray(res)) {
        b.innerHTML = res.map(r => `<tr><td>${r.nombre_estudiante}</td><td>${r.hora}</td><td>${r.estado}</td></tr>`).join('');
    }
}

function iniciarScanner() {
    html5QrCode.start({ facingMode: "environment" }, { fps: 5, qrbox: 250 }, registrarAsistencia)
    .catch(err => console.error(err));
}

window.onload = async () => {
    if (document.getElementById('displayFecha')) {
        document.getElementById('displayFecha').innerText = new Date().toLocaleDateString('es-BO', {
            timeZone: 'America/La_Paz', weekday:'long', day:'numeric', month:'long'
        });
    }
    if (document.getElementById('busFecha')) {
        document.getElementById('busFecha').value = obtenerFechaLocal();
    }
    
    await cargarBotonesCursos();
};
