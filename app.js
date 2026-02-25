const SUPABASE_URL = "https://cplmxkvlrmiwunpojxke.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwbG14a3Zscm1pd3VucG9qeGtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NjMwMTYsImV4cCI6MjA4NzUzOTAxNn0.ZugTlGxz38vBv7H9Cyn6Uq_HiKc7Za9rzDmO9RU--lc";
const HORA_ENTRADA = "08:00"; 

// --- CONFIGURACIÓN GOOGLE SHEETS ---
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzY8t7Ih67FNxq20EgS87v-hPnmKVhb3ZQk1uEO_Z8qN6xnqh3uxXuFWYp9fipnz94/exec";

let html5QrCode = new Html5Qrcode("reader");
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// --- AUDIO ---
function playNote(freq, type, duration, vol = 0.1) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + duration);
}
const soundCoin = () => { playNote(987.77, 'sine', 0.1); setTimeout(() => playNote(1318.51, 'sine', 0.4), 100); };
const soundError = () => { playNote(392, 'square', 0.1); setTimeout(() => playNote(261, 'square', 0.4), 300); };

// --- FECHA Y HORA ---
const obtenerFechaLocal = () => new Date().toISOString().split('T')[0];
const obtenerHoraLocal = () => new Date().toLocaleTimeString('es-BO', {hour12:false, hour:'2-digit', minute:'2-digit'});

// --- ENVÍO DUAL ---
async function enviarASupabase(datos) {
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

    await fetch(url, {
        method: metodo,
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(datos)
    });

    if (GOOGLE_SCRIPT_URL !== "TU_URL_DE_APPS_SCRIPT_AQUÍ") {
        fetch(GOOGLE_SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(datos) });
    }
}

// --- REGISTRO QR ---
async function registrarAsistencia(codigo) {
    try {
        const resAlu = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes?codigo_qr=eq.${codigo}`, {
            headers: { 'apikey': SUPABASE_KEY }
        }).then(r => r.json());
        
        if (!resAlu.length) { 
            soundError(); 
            Swal.fire('Error', 'QR Desconocido', 'error'); 
            reiniciarScanner(); 
            return; 
        }
        
        const alumno = resAlu[0];
        const ahora = new Date();
        const [hE, mE] = HORA_ENTRADA.split(":").map(Number);
        const estado = (ahora.getHours() * 60 + ahora.getMinutes() <= hE * 60 + mE + 5) ? "P" : "A";

        await enviarASupabase({ 
            estudiante_id: alumno.id, nombre_estudiante: alumno.nombre, 
            fecha: obtenerFechaLocal(), hora: obtenerHoraLocal(), estado: estado 
        });

        soundCoin();
        mostrarResultado(alumno.nombre, estado);
        actualizarStats();
    } catch (e) { 
        soundError(); 
        Swal.fire('Error', e.message, 'error'); 
        reiniciarScanner(); 
    }
}

// --- FINALIZAR DÍA CON SWEETALERT (PRO) ---
async function finalizarDia() {
    const fechaHoy = obtenerFechaLocal();
    const alus = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    const asis = await fetch(`${SUPABASE_URL}/rest/v1/asistencias?fecha=eq.${fechaHoy}`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    const idsConAsistencia = asis.map(a => a.estudiante_id);
    const ausentes = alus.filter(al => !idsConAsistencia.includes(al.id));

    if (ausentes.length === 0) {
        Swal.fire('¡Todo listo!', 'Todos los alumnos marcaron hoy.', 'success');
        return;
    }

    // Ventana inicial
    Swal.fire({
        title: 'Cierre de Jornada',
        text: `Hay ${ausentes.length} alumnos sin registro. ¿Quieres procesarlos uno por uno?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, empezar',
        cancelButtonText: 'Ahora no'
    }).then(async (result) => {
        if (result.isConfirmed) {
            for (let al of ausentes) {
                // Ventana individual por alumno
                const { isConfirmed } = await Swal.fire({
                    title: al.nombre,
                    text: "¿Asignar falta (F) a este estudiante?",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#d33',
                    cancelButtonColor: '#3085d6',
                    confirmButtonText: 'Sí, poner Falta',
                    cancelButtonText: 'Omitir'
                });

                if (isConfirmed) {
                    await enviarASupabase({
                        estudiante_id: al.id, nombre_estudiante: al.nombre,
                        fecha: fechaHoy, hora: "00:00", estado: "F"
                    });
                    await new Promise(r => setTimeout(r, 400)); // Pausa para Sheets
                }
            }
            Swal.fire('¡Hecho!', 'Se terminaron de procesar los ausentes.', 'success');
            actualizarStats();
        }
    });
}

// --- RESTO DE FUNCIONES (Manual, Stats, etc.) ---
async function registrarManual() {
    const sel = document.getElementById("licNombre");
    if(!sel.value) return;
    await enviarASupabase({ 
        estudiante_id: parseInt(sel.value), 
        nombre_estudiante: sel.options[sel.selectedIndex].dataset.nombre,
        fecha: obtenerFechaLocal(), hora: obtenerHoraLocal(), 
        estado: document.getElementById("licEstado").value 
    });
    Swal.fire('Éxito', 'Registro actualizado', 'success');
    actualizarStats();
}

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
    s.innerHTML = '<option value="">-- Seleccionar Alumno --</option>';
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

function mostrarResultado(n, e) {
    document.getElementById("reader").style.display = "none";
    document.getElementById("panelResultado").style.display = "block";
    document.getElementById("resNombre").innerText = n;
    document.getElementById("resEmoji").innerText = e === 'P' ? '✅' : '🕒';
}

function reiniciarScanner() {
    document.getElementById("panelResultado").style.display = "none";
    document.getElementById("reader").style.display = "block";
    iniciarScanner();
}

function iniciarScanner() {
    html5QrCode.start({ facingMode: "environment" }, { fps: 20, qrbox: 250 }, registrarAsistencia);
}

window.onload = () => {
    document.getElementById('displayFecha').innerText = new Date().toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'});
    document.getElementById('busFecha').value = obtenerFechaLocal();
    actualizarStats(); cargarListaAlumnos(); iniciarScanner();
};