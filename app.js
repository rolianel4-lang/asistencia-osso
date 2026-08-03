const SUPABASE_URL = "https://cplmxkvlrmiwunpojxke.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwbG14a3Zscm1pd3VucG9qeGtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NjMwMTYsImV4cCI6MjA4NzUzOTAxNn0.ZugTlGxz38vBv7H9Cyn6Uq_HiKc7Za9rzDmO9RU--lc";
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzY8t7Ih67FNxq20EgS87v-hPnmKVhb3ZQk1uEO_Z8qN6xnqh3uxXuFWYp9fipnz94/exec";

// Valores por defecto si no se han configurado para un curso específico
const HORA_ENTRADA_DEFECTO = "14:00";
const TOLERANCIA_DEFECTO = 5;

let html5QrCode = new Html5Qrcode("reader");
let ultimoCodigo = null; 
let ultimaVez = 0;       

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
    const sel = document.getElementById("filtroCurso");
    return sel ? sel.value : "";
};

const obtenerConfigHorarioCurso = (curso) => {
    if (!curso) return { hora: HORA_ENTRADA_DEFECTO, tolerancia: TOLERANCIA_DEFECTO };
    const configGuardada = localStorage.getItem(`config_horario_${curso}`);
    if (configGuardada) {
        return JSON.parse(configGuardada);
    }
    return { hora: HORA_ENTRADA_DEFECTO, tolerancia: TOLERANCIA_DEFECTO };
};

async function configurarHorarioCurso() {
    const cursoActual = obtenerCursoSeleccionado();
    if (!cursoActual) {
        return Swal.fire('Atención', 'Por favor selecciona primero un curso.', 'warning');
    }

    const configActual = obtenerConfigHorarioCurso(cursoActual);

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
        localStorage.setItem(`config_horario_${cursoActual}`, JSON.stringify(formValues));
        Swal.fire('Guardado', `Horario para ${cursoActual} actualizado: ${formValues.hora} (+${formValues.tolerancia} min tolerancia)`, 'success');
    }
}

async function cargarCursos() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes?select=curso`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
        const cursosUnicos = [...new Set(res.map(item => item.curso).filter(Boolean))].sort();
        
        const sel = document.getElementById("filtroCurso");
        if (sel) {
            sel.innerHTML = '<option value="">-- Seleccionar Curso --</option>';
            cursosUnicos.forEach(c => {
                let opt = document.createElement("option");
                opt.value = c;
                opt.innerText = c;
                sel.appendChild(opt);
            });
        }
    } catch (e) {
        console.error("Error al cargar cursos:", e);
    }
}

async function alCambiarCurso() {
    actualizarStats();
    cargarListaAlumnos();
    if (document.getElementById("contTabla") && document.getElementById("contTabla").style.display !== "none") {
        buscarRegistros();
    }
}

async function enviarDatosDuales(datos) {
    const resBusqueda = await fetch(`${SUPABASE_URL}/rest/v1/asistencias?estudiante_id=eq.${datos.estudiante_id}&fecha=eq.${datos.fecha}`, {
        headers: { 'apikey': SUPABASE_KEY }
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
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(datos)
    });

    if (res.ok && GOOGLE_SCRIPT_URL !== "") {
        fetch(GOOGLE_SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(datos) });
    }
    return res.ok;
}

async function registrarAsistencia(codigo) {
    const cursoSeleccionado = obtenerCursoSeleccionado();
    if (!cursoSeleccionado) {
        Swal.fire('Atención', 'Por favor selecciona un curso antes de escanear', 'warning');
        return;
    }

    const ahora = Date.now();
    if (codigo === ultimoCodigo && (ahora - ultimaVez) < 5000) return; 

    ultimoCodigo = codigo;
    ultimaVez = me = ahora;

    try {
        const resAlu = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes?codigo_qr=eq.${codigo}&curso=eq.${encodeURIComponent(cursoSeleccionado)}`, {
            headers: { 'apikey': SUPABASE_KEY }
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
            
            // Obtener horario y tolerancia configurados para este curso
            const configHorario = obtenerConfigHorarioCurso(cursoSeleccionado);
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
    if (!cursoSeleccionado) {
        return Swal.fire('Atención', 'Selecciona un curso para cerrar la jornada', 'warning');
    }

    const fechaHoy = obtenerFechaLocal();
    const alus = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes?curso=eq.${encodeURIComponent(cursoSeleccionado)}`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    const asis = await fetch(`${SUPABASE_URL}/rest/v1/asistencias?fecha=eq.${fechaHoy}&curso=eq.${encodeURIComponent(cursoSeleccionado)}`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    
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
    let url = `${SUPABASE_URL}/rest/v1/asistencias?fecha=eq.${obtenerFechaLocal()}`;
    if (cursoSeleccionado) {
        url += `&curso=eq.${encodeURIComponent(cursoSeleccionado)}`;
    }

    const res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
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
    if (!s) return;

    if (!cursoSeleccionado) {
        s.innerHTML = '<option value="">-- Selecciona un curso primero --</option>';
        return;
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes?curso=eq.${encodeURIComponent(cursoSeleccionado)}&order=nombre.asc`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    s.innerHTML = '<option value="">-- Seleccionar --</option>';
    res.forEach(al => {
        let opt = document.createElement("option");
        opt.value = al.id; 
        opt.dataset.nombre = al.nombre; 
        opt.innerText = al.nombre;
        s.appendChild(opt);
    });
}

async function buscarRegistros() {
    const f = document.getElementById("busFecha").value;
    const cursoSeleccionado = obtenerCursoSeleccionado();

    let url = `${SUPABASE_URL}/rest/v1/asistencias?fecha=eq.${f}`;
    if (cursoSeleccionado) {
        url += `&curso=eq.${encodeURIComponent(cursoSeleccionado)}`;
    }
    url += `&order=nombre_estudiante.asc`;

    const res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    const b = document.getElementById("bodyTabla");
    document.getElementById("contTabla").style.display = "block";
    b.innerHTML = res.map(r => `<tr><td>${r.nombre_estudiante}</td><td>${r.hora}</td><td>${r.estado}</td></tr>`).join('');
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
    
    await cargarCursos();
    
    const selCurso = document.getElementById("filtroCurso");
    if (selCurso) {
        selCurso.addEventListener("change", alCambiarCurso);
    }

    actualizarStats(); 
    cargarListaAlumnos(); 
    iniciarScanner();
};
