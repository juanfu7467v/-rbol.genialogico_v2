const express = require("express");
const axios = require("axios");
const { createCanvas, loadImage } = require("canvas");
const cors = require('cors');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración básica
app.use(cors());

// -----------------------------------------------------------
// --- CONFIGURACIÓN DE APIS Y ENTORNOS ---
// -----------------------------------------------------------
const API_BASE_URL = process.env.API_BASE_URL || "https://gdni-imagen-v2.fly.dev";
const ARBOL_GENEALOGICO_API_URL = process.env.ARBOL_GENEALOGICO_API_URL || "https://consulta-pe-imagenes-v2.fly.dev/consultar-arbol"; 
const FONT_FAMILY = "sans-serif";

// ==============================================================================
//  UTILIDADES DE DIBUJO (CANVAS)
// ==============================================================================

const drawFamilyListPage = async (ctx, width, height, title, principal, familiares, side) => {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);

    const MARGIN = 40;
    let currentY = MARGIN;

    ctx.fillStyle = "#000000";
    ctx.font = `bold 50px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.fillText("Pe", MARGIN, currentY + 40);
    
    ctx.font = `bold 25px ${FONT_FAMILY}`;
    ctx.fillText("RESULTADO", MARGIN, currentY + 70);

    ctx.textAlign = "right";
    ctx.font = `bold 20px ${FONT_FAMILY}`;
    ctx.fillText("Consulta pe apk", width - MARGIN, currentY + 40);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(250, 0);
    ctx.lineTo(200, 130);
    ctx.lineTo(0, 130);
    ctx.closePath();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = "#000000";
    ctx.fill();
    ctx.globalAlpha = 1.0;

    currentY += 100;

    ctx.textAlign = "left";
    ctx.font = `bold 20px ${FONT_FAMILY}`;
    ctx.fillStyle = "#000000";
    ctx.fillText("Información del Titular", MARGIN, currentY);
    currentY += 15;

    const infoHeaders = ["DNI", "Nombres", "Apellidos", "Lado Consultado"];
    const infoValues = [
        principal.dni, 
        principal.nombres, 
        `${principal.apellido_paterno} ${principal.apellido_materno}`, 
        side
    ];

    drawSimpleTable(ctx, MARGIN, currentY, width - (MARGIN * 2), infoHeaders, infoValues);
    currentY += 80;

    ctx.font = `bold 20px ${FONT_FAMILY}`;
    ctx.fillStyle = "#000000";
    ctx.fillText(title, MARGIN, currentY);
    currentY += 15;

    const tableWidth = width - (MARGIN * 2);
    const rowHeight = 35;
    const colWidths = [0.25, 0.55, 0.20]; 

    ctx.fillStyle = "#F0F0F0"; 
    ctx.fillRect(MARGIN, currentY, tableWidth, rowHeight);
    ctx.strokeStyle = "#CCCCCC";
    ctx.strokeRect(MARGIN, currentY, tableWidth, rowHeight);
    
    ctx.fillStyle = "#333333";
    ctx.font = `bold 14px ${FONT_FAMILY}`;
    ctx.fillText("Parentesco", MARGIN + 10, currentY + 22);
    ctx.fillText("Nombre Completo", MARGIN + (tableWidth * colWidths[0]) + 10, currentY + 22);
    ctx.fillText("DNI", MARGIN + (tableWidth * (colWidths[0] + colWidths[1])) + 10, currentY + 22);

    currentY += rowHeight;
    ctx.font = `13px ${FONT_FAMILY}`;
    
    familiares.forEach((fam) => {
        if (currentY > height - MARGIN) return;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(MARGIN, currentY, tableWidth, rowHeight);
        ctx.strokeStyle = "#CCCCCC"; 
        ctx.strokeRect(MARGIN, currentY, tableWidth, rowHeight);
        ctx.beginPath();
        ctx.moveTo(MARGIN + (tableWidth * colWidths[0]), currentY);
        ctx.lineTo(MARGIN + (tableWidth * colWidths[0]), currentY + rowHeight);
        ctx.moveTo(MARGIN + (tableWidth * (colWidths[0] + colWidths[1])), currentY);
        ctx.lineTo(MARGIN + (tableWidth * (colWidths[0] + colWidths[1])), currentY + rowHeight);
        ctx.stroke();
        ctx.fillStyle = "#000000";
        let parentesco = fam.tipo || fam.parentesco || "Familiar";
        let nombre = `${fam.nombres || fam.nom} ${fam.apellido_paterno || fam.ap} ${fam.apellido_materno || fam.am}`;
        let dni = fam.dni || fam.numDoc || "N/A";
        ctx.fillText(parentesco.substring(0, 25), MARGIN + 10, currentY + 22);
        ctx.fillText(nombre.substring(0, 45), MARGIN + (tableWidth * colWidths[0]) + 10, currentY + 22);
        ctx.fillText(dni, MARGIN + (tableWidth * (colWidths[0] + colWidths[1])) + 10, currentY + 22);
        currentY += rowHeight;
    });

    if (familiares.length === 0) {
        ctx.fillStyle = "#666666";
        ctx.textAlign = "center";
        ctx.fillText("No se encontraron registros directos para esta rama familiar.", width / 2, currentY + 30);
    }
};

const drawSimpleTable = (ctx, x, y, width, headers, values) => {
    const rowHeight = 40;
    const colWidth = width / headers.length;
    ctx.fillStyle = "#F0F0F0";
    ctx.fillRect(x, y, width, rowHeight / 2);
    ctx.strokeStyle = "#CCCCCC";
    ctx.strokeRect(x, y, width, rowHeight / 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y + (rowHeight/2), width, rowHeight / 2);
    ctx.strokeRect(x, y + (rowHeight/2), width, rowHeight / 2);
    headers.forEach((h, i) => {
        let cx = x + (i * colWidth);
        ctx.fillStyle = "#333333";
        ctx.font = `12px ${FONT_FAMILY}`;
        ctx.fillText(h, cx + 10, y + 14);
        ctx.fillStyle = "#000000";
        ctx.font = `bold 12px ${FONT_FAMILY}`;
        ctx.fillText(values[i] || "-", cx + 10, y + 14 + (rowHeight/2));
        if (i > 0) {
            ctx.beginPath();
            ctx.moveTo(cx, y);
            ctx.lineTo(cx, y + rowHeight);
            ctx.stroke();
        }
    });
};

/**
 * HOJA 3: DISEÑO COMPACTO Y RENUNCIA DE RESPONSABILIDAD
 */
const drawStatsPage = async (ctx, width, height, stats) => {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    
    const MARGIN = 40;
    
    // Título
    ctx.fillStyle = "#222222";
    ctx.textAlign = "right";
    ctx.font = `bold 60px ${FONT_FAMILY}`;
    ctx.fillText("GRÁFICOS", width - MARGIN, 100);
    ctx.fillText("VISUALES", width - MARGIN, 160);

    // Indicadores de la izquierda
    let startY = 100;
    const items = [
        { id: "01", text: "Total de Familiares encontrados.", color: "#FFF9C4" },
        { id: "02", text: `Rama Paterna: ${stats.paternaCount} integrantes.`, color: "#DCEDC8" },
        { id: "03", text: `Rama Materna: ${stats.maternaCount} integrantes.`, color: "#B2DFDB" },
        { id: "04", text: `Hombres: ${stats.hombres} | Mujeres: ${stats.mujeres}`, color: "#4DB6AC" }
    ];

    items.forEach((item, index) => {
        const yPos = startY + (index * 100);
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.moveTo(MARGIN + 50, yPos);
        ctx.lineTo(width / 2 - 20, yPos);
        ctx.lineTo(width / 2 + 10, yPos + 35); 
        ctx.lineTo(width / 2 - 20, yPos + 70);    
        ctx.lineTo(MARGIN + 50, yPos + 70);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(MARGIN + 50, yPos + 35, 30, 0, 2 * Math.PI);
        ctx.fillStyle = item.color;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#000000";
        ctx.stroke();

        ctx.fillStyle = "#000000";
        ctx.textAlign = "center";
        ctx.font = `bold 20px ${FONT_FAMILY}`;
        ctx.fillText(item.id, MARGIN + 50, yPos + 42);

        ctx.textAlign = "left";
        ctx.font = `13px ${FONT_FAMILY}`;
        ctx.fillText(item.text, MARGIN + 90, yPos + 40);
    });

    // Gráfico de Barras
    const chartX = width / 2 + 50;
    const chartY = 220;
    const chartW = (width / 2) - MARGIN - 50;
    const chartH = 220;

    ctx.lineWidth = 1;
    ctx.strokeStyle = "#E0E0E0";
    for(let i=0; i<=5; i++) {
        let ly = chartY + (i * (chartH/5));
        ctx.beginPath();
        ctx.moveTo(chartX, ly);
        ctx.lineTo(chartX + chartW, ly);
        ctx.stroke();
    }

    const maxVal = Math.max(stats.paternaCount, stats.maternaCount, stats.hijosCount || 1);
    const scale = chartH / (maxVal * 1.2); 
    const barData = [
        { label: "Pat.", val: stats.paternaCount, color: "#AED581" },
        { label: "Mat.", val: stats.maternaCount, color: "#4DB6AC" },
        { label: "Hijos", val: stats.hijosCount, color: "#00897B" }
    ];
    const barWidth = chartW / barData.length - 20;

    barData.forEach((bar, i) => {
        let bx = chartX + 10 + (i * (barWidth + 20));
        let bh = bar.val * scale;
        let by = chartY + chartH - bh;
        ctx.fillStyle = bar.color;
        ctx.fillRect(bx, by, barWidth, bh);
        ctx.fillStyle = "#000000";
        ctx.textAlign = "center";
        ctx.font = `bold 11px ${FONT_FAMILY}`;
        ctx.fillText(bar.label, bx + barWidth/2, chartY + chartH + 15);
    });

    // --- SECCIÓN DE DONAS (Subidas para reducir espacio) ---
    const donutsY = 600; // Posición más arriba
    const donutRadius = 50;
    const total = (stats.paternaCount + stats.maternaCount + stats.hijosCount) || 1;
    
    const donuts = [
        { p: Math.round((stats.paternaCount/total)*100), label: "% Paterno", color: "#FFF59D" },
        { p: Math.round((stats.maternaCount/total)*100), label: "% Materno", color: "#AED581" },
        { p: Math.round((stats.hombres/(stats.hombres+stats.mujeres))*100), label: "% Hombres", color: "#4DB6AC" },
        { p: Math.round((stats.mujeres/(stats.hombres+stats.mujeres))*100), label: "% Mujeres", color: "#00897B" }
    ];

    const donutSpacing = width / 4;
    donuts.forEach((d, i) => {
        let cx = (donutSpacing * i) + (donutSpacing/2);
        ctx.beginPath();
        ctx.arc(cx, donutsY, donutRadius, 0, 2*Math.PI);
        ctx.fillStyle = "#F0F0F0";
        ctx.fill();

        let startAngle = -0.5 * Math.PI;
        let endAngle = ((d.p / 100) * 2 * Math.PI) + startAngle;
        ctx.beginPath();
        ctx.arc(cx, donutsY, donutRadius, startAngle, endAngle);
        ctx.lineWidth = 12;
        ctx.strokeStyle = d.color;
        ctx.stroke();

        ctx.fillStyle = "#000000";
        ctx.textAlign = "center";
        ctx.font = `bold 18px ${FONT_FAMILY}`;
        ctx.fillText(`${d.p}%`, cx, donutsY + 7);
        ctx.font = `11px ${FONT_FAMILY}`;
        ctx.fillText(d.label, cx, donutsY + donutRadius + 20);
    });

    // --- RENUNCIA DE RESPONSABILIDAD (Pie de página) ---
    const footerY = height - 100;
    ctx.strokeStyle = "#EEEEEE";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN, footerY - 20);
    ctx.lineTo(width - MARGIN, footerY - 20);
    ctx.stroke();

    ctx.fillStyle = "#777777";
    ctx.textAlign = "center";
    ctx.font = `italic 12px ${FONT_FAMILY}`;
    const disclaimer = [
        "Este documento es de carácter informativo y ha sido generado automáticamente basándose en registros públicos disponibles.",
        "La exactitud de las relaciones de parentesco depende de la fuente de datos original. El sistema no garantiza la veracidad absoluta.",
        "Queda prohibido el uso de esta información para fines ilícitos o de acoso. El usuario asume toda la responsabilidad por su uso."
    ];
    disclaimer.forEach((line, idx) => {
        ctx.fillText(line, width / 2, footerY + (idx * 18));
    });
};

// ==============================================================================
//  LÓGICA DE DATOS Y ENDPOINTS
// ==============================================================================

function clasificarFamilia(principal, familiares) {
    const paterna = [];
    const materna = [];
    const hijos = [];
    const otros = [];
    const apePatPrincipal = (principal.apellido_paterno || '').trim().toUpperCase();
    const apeMatPrincipal = (principal.apellido_materno || '').trim().toUpperCase();

    familiares.forEach(fam => {
        const tipo = (fam.tipo || fam.parentesco || '').toUpperCase();
        const apePatFam = (fam.apellido_paterno || fam.ap || '').trim().toUpperCase();
        const apeMatFam = (fam.apellido_materno || fam.am || '').trim().toUpperCase();
        if (tipo.includes("PADRE") || tipo.includes("ABUELO") || tipo.includes("TIO")) {
            if (tipo.includes("MATERN")) materna.push(fam); else paterna.push(fam);
        } else if (tipo.includes("MADRE") || tipo.includes("ABUELA") || tipo.includes("TIA")) {
             if (tipo.includes("PATERN")) paterna.push(fam); else materna.push(fam);
        } else if (tipo.includes("HIJO") || tipo.includes("HIJA")) {
            hijos.push(fam); paterna.push(fam); 
        } else if (tipo.includes("HERMANO") || tipo.includes("HERMANA")) {
            paterna.push(fam);
        } else {
            if (apePatFam === apePatPrincipal || apeMatFam === apePatPrincipal) {
                paterna.push(fam);
            } else if (apePatFam === apeMatPrincipal || apeMatFam === apeMatPrincipal) {
                materna.push(fam);
            } else { otros.push(fam); }
        }
    });
    otros.forEach(o => materna.push(o));
    return { paterna, materna, hijos };
}

app.get("/consultar-arbol", async (req, res) => {
    const dni = req.query.dni;
    if (!dni || dni.length !== 8) return res.status(400).json({ error: "DNI inválido" });
    try {
        const response = await axios.get(`${ARBOL_GENEALOGICO_API_URL}?dni=${dni}`);
        const data = response.data?.result?.person;
        if (!data) return res.status(404).json({ error: "Datos no encontrados" });
        const pdfDirectUrl = `${API_BASE_URL}/descargar-arbol-pdf?dni=${dni}`;
        const finalUrl = `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(pdfDirectUrl)}`;
        res.json({
            "dni": data.dni,
            "apellidos": `${data.apellido_paterno} ${data.apellido_materno}`.trim(),
            "nombres": data.nombres,
            "estado": "FICHA GENERADA EXITOSAMENTE",
            "archivo": { "tipo": "PDF", "url": finalUrl }
        });
    } catch (error) {
        res.status(500).json({ error: "Error al obtener la información" });
    }
});

app.get("/descargar-ficha", async (req, res) => {
    const fileUrl = req.query.url;
    if (!fileUrl) return res.status(400).send("Falta el parámetro URL");
    res.redirect(fileUrl);
});

app.get("/descargar-arbol-pdf", async (req, res) => {
    const dni = req.query.dni;
    if (!dni || dni.length !== 8) return res.status(400).send("DNI inválido.");
    try {
        const response = await axios.get(`${ARBOL_GENEALOGICO_API_URL}?dni=${dni}`);
        const data = response.data?.result;
        if (!data || !data.person) return res.status(404).send("No se encontraron datos.");
        const principal = data.person;
        const familiares = (data.coincidences || []).map(f => ({
            ...f,
            nombres: f.nombres || f.nom,
            apellido_paterno: f.apellido_paterno || f.ap,
            apellido_materno: f.apellido_materno || f.am,
            dni: f.dni || f.numDoc,
            tipo: f.tipo || f.parentesco
        }));

        const { paterna, materna, hijos } = clasificarFamilia(principal, familiares);
        const stats = {
            paternaCount: paterna.length,
            maternaCount: materna.length,
            hijosCount: hijos.length,
            otrosCount: familiares.length - (paterna.length + materna.length),
            hombres: familiares.filter(f => (f.sexo || '').toUpperCase() === 'M' || (f.tipo || '').endsWith('O')).length, 
            mujeres: familiares.filter(f => (f.sexo || '').toUpperCase() === 'F' || (f.tipo || '').endsWith('A')).length
        };
        
        const doc = new PDFDocument({ autoFirstPage: false });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Arbol_Genealogico_${dni}.pdf`);
        doc.pipe(res);

        const A4_WIDTH = 595.28;
        const A4_HEIGHT = 841.89;
        const SCALE = 2; 
        const C_W = A4_WIDTH * SCALE;
        const C_H = A4_HEIGHT * SCALE;

        const canvas1 = createCanvas(C_W, C_H);
        await drawFamilyListPage(canvas1.getContext("2d"), C_W, C_H, "FAMILIA PATERNA", principal, paterna, "Rama Paterna");
        doc.addPage({ size: 'A4' });
        doc.image(canvas1.toBuffer(), 0, 0, { width: A4_WIDTH, height: A4_HEIGHT });

        const canvas2 = createCanvas(C_W, C_H);
        await drawFamilyListPage(canvas2.getContext("2d"), C_W, C_H, "FAMILIA MATERNA", principal, materna, "Rama Materna");
        doc.addPage({ size: 'A4' });
        doc.image(canvas2.toBuffer(), 0, 0, { width: A4_WIDTH, height: A4_HEIGHT });

        const canvas3 = createCanvas(C_W, C_H);
        await drawStatsPage(canvas3.getContext("2d"), C_W, C_H, stats);
        doc.addPage({ size: 'A4' });
        doc.image(canvas3.toBuffer(), 0, 0, { width: A4_WIDTH, height: A4_HEIGHT });

        doc.end();
    } catch (error) {
        if (!res.headersSent) res.status(500).send("Error interno.");
    }
});

app.listen(PORT, () => console.log(`Iniciado en ${PORT}`));
