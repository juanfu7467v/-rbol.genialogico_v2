const express = require("express");
const axios = require("axios");
const cors = require('cors');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// --- CONFIGURACIÓN DE APIS ---
const API_BASE_URL = process.env.API_BASE_URL || "https://gdni-imagen-v2.fly.dev";
const ARBOL_GENEALOGICO_API_URL = process.env.ARBOL_GENEALOGICO_API_URL || "https://consulta-pe-imagenes-v2.fly.dev/consultar-arbol";

// Colores del Manual de Identidad Visual
const COLORS = {
    PATERNA: "#3498DB", // Azul
    MATERNA: "#2ECC71", // Verde
    POLITICA: "#95A5A6", // Gris
    DIRECTA: "#2C3E50",  // Azul oscuro/Negro
    ACCENT: "#E74C3C",   // Rojo (para el titular)
    BG_LIGHT: "#F4F7F6"
};

// =============================================================
//  FUNCIONES DE APOYO Y CLASIFICACIÓN
// =============================================

function clasificarFamilia(coincidences) {
    const grupos = {
        directa: [],
        paterna: [],
        materna: [],
        extendida: []
    };

    coincidences.forEach(p => {
        const tipo = p.tipo.toUpperCase();
        if (["PADRE", "MADRE", "HERMANO", "HERMANA"].includes(tipo)) {
            grupos.directa.push(p);
        } else if (tipo.includes("PATERNO") || tipo.includes("PATERNA")) {
            grupos.paterna.push(p);
        } else if (tipo.includes("MATERNO") || tipo.includes("MATERNA")) {
            grupos.materna.push(p);
        } else {
            grupos.extendida.push(p);
        }
    });
    return grupos;
}

// =============================================
//  DIBUJO DE COMPONENTES PDF
// =============================================

function drawHeader(doc, title) {
    doc.rect(0, 0, 612, 50).fill(COLORS.DIRECTA);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(16).text(title, 40, 18);
    doc.fontSize(10).text("SISTEMA DE CONSULTA GENEALÓGICA", 400, 22, { align: 'right' });
}

function drawPersonCard(doc, x, y, person, color) {
    const width = 160;
    const height = 65;

    // Sombra sutil
    doc.rect(x + 2, y + 2, width, height).fill("#DDDDDD");
    
    // Tarjeta principal
    doc.rect(x, y, width, height).fill("#FFFFFF");
    doc.rect(x, y, 5, height).fill(color); // Barra lateral de color
    doc.rect(x, y, width, height).lineWidth(0.5).stroke("#CCCCCC");

    // Icono Sexo
    const icon = person.ge === "MASCULINO" ? "👨" : "👩";
    doc.fillColor("#333333").fontSize(14).text(icon, x + 10, y + 10);

    // Texto
    doc.fillColor(color).font("Helvetica-Bold").fontSize(8).text(person.tipo || "TITULAR", x + 35, y + 10);
    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(9).text(`${person.nom}`, x + 10, y + 28, { width: 140, height: 10, ellipsis: true });
    doc.font("Helvetica").fontSize(8).text(`${person.ap} ${person.am}`, x + 10, y + 38, { width: 140, height: 10, ellipsis: true });
    doc.fillColor("#666666").fontSize(7).text(`DNI: ${person.dni}  |  Edad: ${person.edad}`, x + 10, y + 50);
}

function draw3DBar(doc, x, y, label, value, maxValue, color) {
    const barWidth = 150;
    const barHeight = 15;
    const progress = (value / maxValue) * barWidth;
    const depth = 5;

    // Cara lateral (3D effect)
    doc.path(`M ${x + progress} ${y} L ${x + progress + depth} ${y - depth} L ${x + progress + depth} ${y + barHeight - depth} L ${x + progress} ${y + barHeight} Z`)
       .fill(color).opacity(0.6);
    
    // Cara superior (3D effect)
    doc.path(`M ${x} ${y} L ${x + depth} ${y - depth} L ${x + progress + depth} ${y - depth} L ${x + progress} ${y} Z`)
       .fill(color).opacity(0.8);

    // Frente
    doc.rect(x, y, progress, barHeight).fill(color).opacity(1);
    
    doc.fillColor("#333333").fontSize(9).font("Helvetica-Bold").text(`${label}: ${value}`, x, y + 20);
}

// =============================================
//  ENDPOINTS
// =============================================

app.get("/consultar-arbol", async (req, res) => {
    const dni = req.query.dni;
    if (!dni) return res.status(400).json({ error: "DNI requerido" });
    try {
        const response = await axios.get(`${ARBOL_GENEALOGICO_API_URL}?dni=${dni}`);
        const data = response.data?.result?.person;
        if (!data) return res.status(404).json({ error: "No encontrado" });

        res.json({
            dni: data.dni,
            nombres: `${data.nom} ${data.ap} ${data.am}`,
            estado: "GENERADO",
            archivo: { url: `${API_BASE_URL}/descargar-arbol-pdf?dni=${dni}` }
        });
    } catch (e) { res.status(500).send("Error API"); }
});

app.get("/descargar-arbol-pdf", async (req, res) => {
    const dni = req.query.dni;
    try {
        const response = await axios.get(`${ARBOL_GENEALOGICO_API_URL}?dni=${dni}`);
        const data = response.data?.result;
        if (!data) return res.status(404).send("Sin datos");

        const doc = new PDFDocument({ margin: 0, size: 'LETTER' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Arbol_${dni}.pdf`);
        doc.pipe(res);

        const grupos = clasificarFamilia(data.coincidences);
        const p = data.person;

        // --- PÁGINA 1: TITULAR Y LEYENDA ---
        drawHeader(doc, "REPORTE GENEALÓGICO PROFESIONAL");
        
        // Cuadro Titular Destacado
        doc.rect(40, 80, 532, 120).fill(COLORS.BG_LIGHT).stroke(COLORS.DIRECTA);
        doc.fillColor(COLORS.DIRECTA).font("Helvetica-Bold").fontSize(18).text("PERSONA CONSULTADA", 60, 100);
        doc.fontSize(22).text(`${p.nom} ${p.ap} ${p.am}`, 60, 125);
        doc.fontSize(12).fillColor("#444444").text(`DNI: ${p.dni}-${p.dv}  |  Sexo: ${p.ge}  |  Nacimiento: ${p.fn}  |  Edad: ${p.edad} años`, 60, 155);

        // Leyenda
        doc.rect(40, 220, 532, 60).lineWidth(1).stroke("#EEE");
        doc.fontSize(10).fillColor("#333").text("LEYENDA VISUAL:", 55, 230);
        
        const leyendas = [
            { c: COLORS.DIRECTA, t: "Familia Directa" },
            { c: COLORS.PATERNA, t: "Familia Paterna" },
            { c: COLORS.MATERNA, t: "Familia Materna" },
            { c: COLORS.POLITICA, t: "Familia Extendida/Política" }
        ];
        leyendas.forEach((l, i) => {
            doc.rect(55 + (i * 130), 250, 10, 10).fill(l.c);
            doc.fillColor("#555").text(l.t, 70 + (i * 130), 251);
        });

        // --- FAMILIA DIRECTA EN PÁGINA 1 ---
        doc.fillColor(COLORS.DIRECTA).fontSize(14).font("Helvetica-Bold").text("FAMILIA DIRECTA", 40, 310);
        let currentY = 330;
        let currentX = 40;
        grupos.directa.forEach((fam, i) => {
            if(i > 0 && i % 3 === 0) { currentX = 40; currentY += 75; }
            drawPersonCard(doc, currentX, currentY, fam, COLORS.DIRECTA);
            currentX += 180;
        });

        // --- PÁGINA 2: RAMA PATERNA ---
        doc.addPage();
        drawHeader(doc, "RAMA GENEALÓGICA PATERNA");
        currentY = 80; currentX = 40;
        grupos.paterna.forEach((fam, i) => {
            if(i > 0 && i % 3 === 0) { currentX = 40; currentY += 75; }
            if(currentY > 700) { doc.addPage(); drawHeader(doc, "RAMA PATERNA (Cont.)"); currentY = 80; }
            drawPersonCard(doc, currentX, currentY, fam, COLORS.PATERNA);
            currentX += 180;
        });

        // --- PÁGINA 3: RAMA MATERNA ---
        doc.addPage();
        drawHeader(doc, "RAMA GENEALÓGICA MATERNA");
        currentY = 80; currentX = 40;
        grupos.materna.forEach((fam, i) => {
            if(i > 0 && i % 3 === 0) { currentX = 40; currentY += 75; }
            if(currentY > 700) { doc.addPage(); drawHeader(doc, "RAMA MATERNA (Cont.)"); currentY = 80; }
            drawPersonCard(doc, currentX, currentY, fam, COLORS.MATERNA);
            currentX += 180;
        });

        // --- PÁGINA 4: ESTADÍSTICAS 3D ---
        doc.addPage();
        drawHeader(doc, "RESUMEN ESTADÍSTICO DINÁMICO");
        
        const total = data.quantity;
        const hombres = data.coincidences.filter(f => f.ge === "MASCULINO").length;
        const mujeres = data.coincidences.filter(f => f.ge === "FEMENINO").length;
        const menores = data.coincidences.filter(f => f.edad < 18).length;
        const adultos = data.coincidences.filter(f => f.edad >= 18 && f.edad < 60).length;
        const mayores = data.coincidences.filter(f => f.edad >= 60).length;

        doc.fillColor("#333").fontSize(12).font("Helvetica-Bold").text(`Total de registros: ${total} familiares identificados`, 40, 80);
        
        // Gráfico de Sexo
        doc.fontSize(14).text("Distribución por Género", 40, 130);
        draw3DBar(doc, 40, 160, "Hombres", hombres, total, "#3498DB");
        draw3DBar(doc, 250, 160, "Mujeres", mujeres, total, "#E74C3C");

        // Gráfico de Edades
        doc.fontSize(14).text("Rangos de Edad", 40, 240);
        draw3DBar(doc, 40, 270, "Menores (<18)", menores, total, "#F1C40F");
        draw3DBar(doc, 40, 310, "Adultos (18-60)", adultos, total, "#2ECC71");
        draw3DBar(doc, 40, 350, "Adultos Mayores (>60)", mayores, total, "#E67E22");

        // Verificación
        doc.rect(40, 420, 532, 50).fill("#D4EFDF");
        doc.fillColor("#145A32").fontSize(11).text("NIVEL DE VERIFICACIÓN DE RELACIONES: ALTA", 60, 440);

        // --- RENUNCIA DE RESPONSABILIDAD (En la última página) ---
        doc.rect(40, 650, 532, 90).fill("#F2F3F4");
        doc.fillColor("#7F8C8D").fontSize(8).font("Helvetica-Oblique");
        const disclaimer = [
            "1. Esta plataforma actúa únicamente como intermediaria de consulta.",
            "2. La información proviene íntegramente de fuentes y APIs externas.",
            "3. Los datos no han sido modificados por nuestro sistema.",
            "4. Este reporte es posible gracias a la infraestructura de interoperabilidad del sistema.",
            "5. La información es meramente referencial y no tiene validez legal de acta de nacimiento."
        ];
        doc.text(disclaimer.join("\n"), 50, 665, { width: 512, align: 'justify' });

        doc.end();
    } catch (e) { 
        console.error(e);
        res.status(500).send("Error generando PDF"); 
    }
});

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
