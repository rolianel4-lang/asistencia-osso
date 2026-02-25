const SUPABASE_URL = "https://cplmxkvlrmiwunpojxke.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwbG14a3Zscm1pd3VucG9qeGtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NjMwMTYsImV4cCI6MjA4NzUzOTAxNn0.ZugTlGxz38vBv7H9Cyn6Uq_HiKc7Za9rzDmO9RU--lc";
const HORA_ENTRADA = "08:00"; 

// PEGA AQUÍ LA URL QUE COPIASTE DE GOOGLE APPS SCRIPT
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzvA5OimyumTGVMHviQrsKS7xu3dgiPhuNzregcZPWoJS6-lbrQWrO3zfpp--1gmw/exec";

let html5QrCode = new Html5Qrcode("reader");
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// --- UTILIDADES ---
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

const obtenerFechaLocal = () => {
    const d = new Date();
    const offset = d.getTimezoneOffset() * 60000;
    const local = new Date(d.getTime() - offset);
    return local.toISOString().split('T')[0];
};

const obtenerHoraLocal = () => {
    return new Date().toLocaleTimeString('es-BO', {hour12:false, hour:'2-digit', minute:'2-digit'});
};

// --- FUNCIÓN DE ENVÍO DUAL (Supabase + Google Sheets) ---
async function enviarASupabase(datos) {
    // 1. Verificamos si ya existe registro hoy
    const resBusqueda = await fetch(`${SUPABASE_URL}/rest/v1/asistencias?estudiante_id=eq.${datos.estudiante_id}&fecha=eq.${datos.fecha}`, {
        headers: { 'apikey': SUPABASE_KEY }
    });
    const existente = await resBusqueda.json();

    let url = `${SUPABASE_URL}/rest/v1/asistencias`;
    let metodo = 'POST';

    if (existente && existente.length > 0) {
        metodo = 'PATCH';
        url += `?id=eq.${existente[0].id}`;
        if (datos.hora === "00:00" || datos.hora === "--:--") {
            datos.hora = obtenerHoraLocal();
        }
    }

    // A. Envío a Supabase
    const res = await fetch(url, {
        method: metodo,
        headers: { 
            'apikey': SUPABASE_KEY, 
            'Authorization': `Bearer ${SUPABASE_KEY}`, 
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal' 
        },
        body: JSON.stringify(datos)
    });

    // B. Envío a Google Sheets (en segundo plano)
    if (GOOGLE_SCRIPT_URL !== "TU_URL_DE_EXEC_AQUÍ") {
        fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify(datos)
        }).catch(e => console.log("Error Sheets:", e));
    }

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message);
    }
    return res;
}

// ... EL RESTO DEL CÓDIGO (registrarAsistencia, registrarManual, etc.) SE MANTIENE IGUAL ...
// (Para no hacer la respuesta eterna, pega aquí las funciones que ya teníamos abajo)

async function registrarAsistencia(codigo) {
    try {
        const fechaHoy = obtenerFechaLocal();
        const horaTexto = obtenerHoraLocal();
        const resAlu = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes?codigo_qr=eq.${codigo}`, {
            headers: { 'apikey': SUPABASE_KEY }
        }).then(r => r.json());
        if (!resAlu.length) { soundError(); alert("🚫 QR Desconocido"); reiniciarScanner(); return; }
        const alumno = resAlu[0];
        const ahora = new Date();
        const [hE, mE] = HORA_ENTRADA.split(":").map(Number);
        const estado = (ahora.getHours() * 60 + ahora.getMinutes() <= hE * 60 + mE + 5) ? "P" : "A";
        await enviarASupabase({ 
            estudiante_id: alumno.id, 
            nombre_estudiante: alumno.nombre, 
            fecha: fechaHoy, 
            hora: horaTexto, 
            estado: estado 
        });
        soundCoin();
        mostrarResultado(alumno.nombre, estado);
        actualizarStats();
    } catch (e) { soundError(); alert("Error: " + e.message); reiniciarScanner(); }
}

async function registrarManual() {
    const select = document.getElementById("licNombre");
    const idAlu = select.value;
    const nombreAlu = select.options[select.selectedIndex]?.getAttribute('data-nombre');
    const estado = document.getElementById("licEstado").value;
    const fechaHoy = obtenerFechaLocal();
    if(!idAlu) return alert("Selecciona alumno");
    try {
        await enviarASupabase({ 
            estudiante_id: parseInt(idAlu), 
            nombre_estudiante: nombreAlu, 
            fecha: fechaHoy, 
            hora: obtenerHoraLocal(), 
            estado: estado 
        });
        soundCoin(); alert("✅ Guardado"); actualizarStats();
    } catch (e) { soundError(); alert("Error: " + e.message); }
}

async function actualizarStats() {
    try {
        const fechaHoy = obtenerFechaLocal();
        const res = await fetch(`${SUPABASE_URL}/rest/v1/asistencias?fecha=eq.${fechaHoy}`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
        const counts = { P: 0, A: 0, F: 0, L: 0 };
        res.forEach(a => { if(counts[a.estado] !== undefined) counts[a.estado]++; });
        document.getElementById("sP").innerText = counts.P;
        document.getElementById("sA").innerText = counts.A;
        document.getElementById("sF").innerText = counts.F;
        document.getElementById("sL").innerText = counts.L;
    } catch(e) {}
}

async function cargarListaAlumnos() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes?select=id,nombre&order=nombre.asc`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
        const select = document.getElementById("licNombre");
        select.innerHTML = '<option value="">-- Seleccionar Alumno --</option>';
        res.forEach(al => {
            let opt = document.createElement("option");
            opt.value = al.id; opt.setAttribute('data-nombre', al.nombre); opt.innerText = al.nombre;
            select.appendChild(opt);
        });
    } catch(e) {}
}

async function buscarRegistros() {
    const fecha = document.getElementById("busFecha").value;
    const body = document.getElementById("bodyTabla");
    body.innerHTML = "<tr><td colspan='3'>Buscando...</td></tr>";
    document.getElementById("contTabla").style.display = "block";
    const data = await fetch(`${SUPABASE_URL}/rest/v1/asistencias?fecha=eq.${fecha}&order=nombre_estudiante.asc`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    body.innerHTML = data.length ? "" : "<tr><td colspan='3'>Sin registros</td></tr>";
    data.forEach(r => {
        const color = r.estado === 'P' ? 'var(--success)' : (r.estado === 'A' ? 'var(--warning)' : (r.estado === 'F' ? 'var(--danger)' : 'var(--info)'));
        body.innerHTML += `<tr><td>${r.nombre_estudiante}</td><td>${r.hora}</td><td><span class="badge" style="background:${color}">${r.estado}</span></td></tr>`;
    });
}

async function finalizarDia() {
    if(!confirm("¿Asignar falta a ausentes?")) return;
    const fechaHoy = obtenerFechaLocal();
    const alus = await fetch(`${SUPABASE_URL}/rest/v1/estudiantes`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    const asis = await fetch(`${SUPABASE_URL}/rest/v1/asistencias?fecha=eq.${fechaHoy}`, { headers: { 'apikey': SUPABASE_KEY } }).then(r => r.json());
    const idsConAsistencia = asis.map(a => a.estudiante_id);
    const faltas = alus.filter(al => !idsConAsistencia.includes(al.id)).map(al => ({
        estudiante_id: al.id, nombre_estudiante: al.nombre, fecha: fechaHoy, hora: "00:00", estado: "F"
    }));
    if(faltas.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/asistencias`, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(faltas)
        });
        // También enviamos las faltas a Sheets una por una
        faltas.forEach(f => {
            fetch(GOOGLE_SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(f) });
        });
    }
    alert("Faltas procesadas correctamente");
    actualizarStats();
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
    html5QrCode.start({ facingMode: "environment" }, { fps: 20, qrbox: 250 }, (codigo) => {
        html5QrCode.stop();
        registrarAsistencia(codigo);
    }).catch(err => console.log(err));
}

window.onload = () => {
    document.getElementById('displayFecha').innerText = new Date().toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'});
    document.getElementById('busFecha').value = obtenerFechaLocal();
    actualizarStats();
    cargarListaAlumnos();
    iniciarScanner();
};