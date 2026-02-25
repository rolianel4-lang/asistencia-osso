const SUPABASE_URL = "https://cplmxkvlrmiwunpojxke.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwbG14a3Zscm1pd3VucG9qeGtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NjMwMTYsImV4cCI6MjA4NzUzOTAxNn0.ZugTlGxz38vBv7H9Cyn6Uq_HiKc7Za9rzDmO9RU--lc";
const HORA_ENTRADA = "08:00"; 
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzY8t7Ih67FNxq20EgS87v-hPnmKVhb3ZQk1uEO_Z8qN6xnqh3uxXuFWYp9fipnz94/exec";

let html5QrCode = new Html5Qrcode("reader");
let ultimoCodigo = null; 
let ultimaVez = 0;       

// --- FECHA Y HORA BOLIVIA ---
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

// --- ENVÍO SEGURO ---
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

// --- REGISTRO QR ---
async function registrarAsistencia(codigo) {
    const ahora = Date.now();
    // Bloqueo de 5 segundos para evitar duplicados por ráfaga de cámara
    if (codigo === ultimoCodigo && (ahora - ultimaVez) < 5000) return; 

    ultimoCodigo = codigo;
    ultimaVez = ahora;

    try {
        const resAlu = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes?codigo_qr=eq.${codigo}`, {
            headers: { 'apikey': SUPABASE_KEY }
        }).then(r => r.json());
        
        if (!resAlu.length) {
            Swal.fire('Error', 'QR No reconocido', 'error');
            return;
        }
        
        const alumno = resAlu[0];

        const { isConfirmed } = await Swal.fire({
            title: '¿Registrar?',
            text: alumno.nombre,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí',
            cancelButtonText: 'No'
        });

        if (isConfirmed) {
            const horaBol = obtenerHoraLocal();
            const [hA, mA] = horaBol.split(":").map(Number);
            const [hE, mE] = HORA_ENTRADA.split(":").map(Number);
            const estado = (hA * 60 + mA <= hE * 60 + mE + 5) ? "P" : "A";

            await enviarDatosDuales({ 
                estudiante_id: alumno.id, nombre_estudiante: alumno.nombre, 
                fecha: obtenerFechaLocal(), hora: horaBol, estado: estado 
            });
            
            Swal.fire({ title: 'Éxito', text: 'Registrado', icon: 'success', timer: 1000, showConfirmButton: false });
            actualizarStats();
        }
    } catch (e) { console.error(e); }
}

// --- FINALIZAR DÍA ---
async function finalizarDia() {
    const fechaHoy = obtenerFechaLocal();
    const alus = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    const asis = await fetch(`${SUPABASE_URL}/rest/v1/asistencias?fecha=eq.${fechaHoy}`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    const idsConAsistencia = asis.map(a => a.estudiante_id);
    const ausentes = alus.filter(al => !idsConAsistencia.includes(al.id));

    if (ausentes.length === 0) return Swal.fire('Listo', 'No hay ausentes', 'success');

    const { isConfirmed } = await Swal.fire({
        title: 'Cerrar Jornada',
        text: `Hay ${ausentes.length} ausentes. ¿Poner FALTA?`,
        icon: 'warning',
        showCancelButton: true
    });

    if (isConfirmed) {
        for (let al of ausentes) {
            await enviarDatosDuales({
                estudiante_id: al.id, nombre_estudiante: al.nombre,
                fecha: fechaHoy, hora: "00:00", estado: "F"
            });
            await new Promise(r => setTimeout(r, 400));
        }
        Swal.fire('Éxito', 'Faltas registradas', 'success');
        actualizarStats();
    }
}

// --- MANUAL ---
async function registrarManual() {
    const sel = document.getElementById("licNombre");
    if(!sel.value) return;
    await enviarDatosDuales({ 
        estudiante_id: parseInt(sel.value), 
        nombre_estudiante: sel.options[sel.selectedIndex].dataset.nombre,
        fecha: obtenerFechaLocal(), hora: obtenerHoraLocal(), 
        estado: document.getElementById("licEstado").value 
    });
    Swal.fire('Éxito', 'Guardado', 'success');
    actualizarStats();
}

// --- STATS Y CARGA ---
async function actualizarStats() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/asistencias?fecha=eq.${obtenerFechaLocal()}`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    const c = { P: 0, A: 0, F: 0, L: 0 };
    res.forEach(a => { if(c[a.estado] !== undefined) c[a.estado]++; });
    document.getElementById("sP").innerText = c.P;
    document.getElementById("sA").innerText = c.A;
    document.getElementById("sF").innerText = c.F;
    document.getElementById("sL").innerText = c.L;
}

async function cargarListaAlumnos() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes?order=nombre.asc`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    const s = document.getElementById("licNombre");
    s.innerHTML = '<option value="">-- Seleccionar --</option>';
    res.forEach(al => {
        let opt = document.createElement("option");
        opt.value = al.id; opt.dataset.nombre = al.nombre; opt.innerText = al.nombre;
        s.appendChild(opt);
    });
}

async function buscarRegistros() {
    const f = document.getElementById("busFecha").value;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/asistencias?fecha=eq.${f}&order=nombre_estudiante.asc`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    const b = document.getElementById("bodyTabla");
    document.getElementById("contTabla").style.display = "block";
    b.innerHTML = res.map(r => `<tr><td>${r.nombre_estudiante}</td><td>${r.hora}</td><td>${r.estado}</td></tr>`).join('');
}

function iniciarScanner() {
    // Configuración para forzar silencio en la librería
    const config = { 
        fps: 5, 
        qrbox: 250, 
        rememberLastUsedCamera: true,
        aspectRatio: 1.0
    };
    
    html5QrCode.start({ facingMode: "environment" }, config, registrarAsistencia)
    .catch(err => console.error("Error cámara:", err));
}

window.onload = () => {
    document.getElementById('displayFecha').innerText = new Date().toLocaleDateString('es-BO', {
        timeZone: 'America/La_Paz', weekday:'long', day:'numeric', month:'long'
    });
    document.getElementById('busFecha').value = obtenerFechaLocal();
    actualizarStats(); cargarListaAlumnos(); iniciarScanner();
};
