const express = require("express");
const axios = require("axios");
const { createCanvas } = require("canvas");
const cors = require('cors');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración básica
app.use(cors());

// --- CONFIGURACIÓN DE APIS ---
const API_BASE_URL = process.env.API_BASE_URL || "https://gdni-imagen-v2.fly.dev";
const ARBOL_GENEALOGICO_API_URL = process.env.ARBOL_GENEALOGICO_API_URL || "https://consulta-pe-imagenes-v2.fly.dev/consultar-arbol"; 
const FONT_FAMILY = "Helvetica"; // Cambiado a Helvetica para evitar errores de carga de fuentes externas

// ==============================================================================
//  UTILIDADES DE DIBUJO (CANVAS)
// ==============================================================================

const drawFamilyListPage = async (ctx, width, height, title, principal, familiares, side) => {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);

    const MARGIN = 40;
    let currentY = MARGIN;

    // Header Estilo
    ctx.fillStyle = "#000000";
    ctx.font = `bold 50px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.fillText("Pe", MARGIN, currentY + 40);
    
    ctx.font = `bold 25px ${FONT_FAMILY}`;
    ctx.fillText("REPORTE GENEALÓGICO", MARGIN, currentY + 70);

    ctx.textAlign = "right";
    ctx.font = `bold 20px ${FONT_FAMILY}`;
    ctx.fillText("Consulta pe apk", width - MARGIN, currentY + 40);

    // Decoración visual de fondo
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

    // --- TABLA INFORMACIÓN TITULAR ---
    ctx.textAlign = "left";
    ctx.font = `bold 22px ${FONT_FAMILY}`;
    ctx.fillStyle = "#2C3E50";
    ctx.fillText("Información del Titular", MARGIN, currentY);
    currentY += 15;

    const infoHeaders = ["DNI", "Nombres y Apellidos", "Edad", "Fec. Nac."];
    const infoValues = [
        principal.dni, 
        `${principal.nom} ${principal.ap} ${principal.am}`, 
        `${principal.edad} años`,
        principal.fn || "-"
    ];

    drawSimpleTable(ctx, MARGIN, currentY, width - (MARGIN * 2), infoHeaders, infoValues);
    currentY += 100;

    // --- TABLA DE FAMILIARES ---
    ctx.font = `bold 22px ${FONT_FAMILY}`;
    ctx.fillStyle = "#2C3E50";
    ctx.fillText(title, MARGIN, currentY);
    currentY += 15;

    const tableWidth = width - (MARGIN * 2);
    const rowHeight = 35;
    // Anchos de columna: Parentesco (20%), Nombre (45%), DNI (15%), Gen (10%), Edad (10%)
    const colWidths = [0.18, 0.42, 0.18, 0.12, 0.10]; 

    // Dibujar Cabecera de Tabla
    ctx.fillStyle = "#34495E"; 
    ctx.fillRect(MARGIN, currentY, tableWidth, rowHeight);
    
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold 14px ${FONT_FAMILY}`;
    let currentX = MARGIN;
    
    const headers = ["Parentesco", "Nombre Completo", "DNI", "Género", "Edad"];
    headers.forEach((h, i) => {
        ctx.fillText(h, currentX + 10, currentY + 22);
        currentX += tableWidth * colWidths[i];
    });

    currentY += rowHeight;
    ctx.font = "13px Helvetica";
    
    familiares.forEach((fam, index) => {
        if (currentY > height - 100) return; // Evitar que se salga de la página (Canvas estático)

        // Color intercalado para filas
        ctx.fillStyle = index % 2 === 0 ? "#FFFFFF" : "#F9F9F9";
        ctx.fillRect(MARGIN, currentY, tableWidth, rowHeight);
        
        ctx.strokeStyle = "#DDDDDD";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(MARGIN, currentY, tableWidth, rowHeight);

        ctx.fillStyle = "#000000";
        let tempX = MARGIN;

        const rowData = [
            (fam.tipo || "Familiar").substring(0, 20),
            (`${fam.nom} ${fam.ap} ${fam.am}`).substring(0, 45),
            fam.dni || "-",
            fam.ge === "MASCULINO" ? "Masc." : "Fem.",
            `${fam.edad || "-"} años`
        ];

        rowData.forEach((text, i) => {
            ctx.fillText(text, tempX + 10, currentY + 22);
            tempX += tableWidth * colWidths[i];
        });

        currentY += rowHeight;
    });

    if (familiares.length === 0) {
        ctx.fillStyle = "#666666";
        ctx.textAlign = "center";
        ctx.fillText("No se encontraron registros en esta rama.", width / 2, currentY + 30);
    }
};

const drawSimpleTable = (ctx, x, y, width, headers, values) => {
    const rowHeight = 50;
    const colWidth = width / headers.length;
    
    ctx.strokeStyle = "#BDC3C7";
    ctx.lineWidth = 1;

    headers.forEach((h, i) => {
        let cx = x + (i * colWidth);
        // Caja de encabezado
        ctx.fillStyle = "#ECF0F1";
        ctx.fillRect(cx, y, colWidth, rowHeight / 2);
        ctx.strokeRect(cx, y, colWidth, rowHeight / 2);
        
        // Caja de valor
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(cx, y + (rowHeight/2), colWidth, rowHeight / 2);
        ctx.strokeRect(cx, y + (rowHeight/2), colWidth, rowHeight / 2);

        // Texto
        ctx.fillStyle = "#7F8C8D";
        ctx.font = `bold 12px ${FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.fillText(h.toUpperCase(), cx + (colWidth / 2), y + 17);

        ctx.fillStyle = "#2C3E50";
        ctx.font = `bold 13px ${FONT_FAMILY}`;
        ctx.fillText(values[i] || "-", cx + (colWidth / 2), y + 17 + (rowHeight/2));
    });
    ctx.textAlign = "left"; // Reset
};

const drawStatsPage = async (ctx, width, height, stats) => {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    const MARGIN = 40;
    
    ctx.fillStyle = "#2C3E50";
    ctx.textAlign = "center";
    ctx.font = `bold 40px ${FONT_FAMILY}`;
    ctx.fillText("RESUMEN ESTADÍSTICO", width / 2, 100);

    // Tarjetas de datos
    const cards = [
        { label: "PATERNA", val: stats.paternaCount, color: "#3498DB" },
        { label: "MATERNA", val: stats.maternaCount, color: "#1ABC9C" },
        { label: "HOMBRES", val: stats.hombres, color: "#2980B9" },
        { label: "MUJERES", val: stats.mujeres, color: "#E67E22" }
    ];

    cards.forEach((card, i) => {
        const x = MARGIN + (i * ((width - (MARGIN * 2)) / 4));
        const w = (width - (MARGIN * 2)) / 4 - 10;
        
        ctx.fillStyle = card.color;
        ctx.fillRect(x, 200, w, 100);
        
        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold 30px ${FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.fillText(card.val.toString(), x + w/2, 250);
        
        ctx.font = `bold 12px ${FONT_FAMILY}`;
        ctx.fillText(card.label, x + w/2, 280);
    });

    // Disclaimer
    ctx.fillStyle = "#95A5A6";
    ctx.font = `italic 12px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.fillText("Este documento es generado automáticamente y tiene fines informativos.", width / 2, height - 50);
};

// ==============================================================================
//  LÓGICA DE DATOS Y ENDPOINTS
// ==============================================================================

function clasificarFamilia(principal, familiares) {
    const paterna = [];
    const materna = [];
    const hijos = [];
    
    familiares.forEach(fam => {
        const tipo = (fam.tipo || "").toUpperCase();
        if (tipo.includes("PADRE") || tipo.includes("PATERNO") || tipo.includes("HERMANO")) {
            paterna.push(fam);
        } else if (tipo.includes("MADRE") || tipo.includes("MATERNA")) {
            materna.push(fam);
        } else if (tipo.includes("HIJO")) {
            hijos.push(fam);
        } else {
            // Si no se puede clasificar claramente, lo enviamos a una rama por defecto
            materna.push(fam);
        }
    });
    return { paterna, materna, hijos };
}

app.get("/consultar-arbol", async (req, res) => {
    const dni = req.query.dni;
    if (!dni || dni.length !== 8) return res.status(400).json({ error: "DNI inválido" });
    try {
        const response = await axios.get(`${ARBOL_GENEALOGICO_API_URL}?dni=${dni}`);
        const data = response.data?.result?.person;
        if (!data) return res.status(404).json({ error: "Datos no encontrados" });
        const finalUrl = `${API_BASE_URL}/descargar-arbol-pdf?dni=${dni}`;
        res.json({
            "dni": data.dni,
            "apellidos": `${data.ap || data.apellido_paterno} ${data.am || data.apellido_materno}`.trim(),
            "nombres": data.nom || data.nombres,
            "estado": "FICHA GENERADA",
            "archivo": { "tipo": "PDF", "url": finalUrl }
        });
    } catch (error) {
        res.status(500).json({ error: "Error al obtener la información" });
    }
});

app.get("/descargar-arbol-pdf", async (req, res) => {
    const dni = req.query.dni;
    try {
        const response = await axios.get(`${ARBOL_GENEALOGICO_API_URL}?dni=${dni}`);
        const data = response.data?.result;
        if (!data) return res.status(404).send("No se encontraron datos.");

        const principal = data.person;
        const familiares = data.coincidences || [];

        const { paterna, materna, hijos } = clasificarFamilia(principal, familiares);
        
        const stats = {
            paternaCount: paterna.length,
            maternaCount: materna.length,
            hombres: familiares.filter(f => f.ge === "MASCULINO").length,
            mujeres: familiares.filter(f => f.ge === "FEMENINO").length
        };

        const doc = new PDFDocument({ autoFirstPage: false });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Genealogia_${dni}.pdf`);
        doc.pipe(res);

        const A4_WIDTH = 595.28;
        const A4_HEIGHT = 841.89;
        const SCALE = 2; // Para mayor calidad
        const C_W = A4_WIDTH * SCALE;
        const C_H = A4_HEIGHT * SCALE;

        // Página 1: Rama Paterna
        const canvas1 = createCanvas(C_W, C_H);
        await drawFamilyListPage(canvas1.getContext("2d"), C_W, C_H, "FAMILIA PATERNA Y HERMANOS", principal, paterna, "Rama Paterna");
        doc.addPage({ size: 'A4' });
        doc.image(canvas1.toBuffer(), 0, 0, { width: A4_WIDTH, height: A4_HEIGHT });

        // Página 2: Rama Materna y otros
        const canvas2 = createCanvas(C_W, C_H);
        await drawFamilyListPage(canvas2.getContext("2d"), C_W, C_H, "FAMILIA MATERNA Y OTROS", principal, materna, "Rama Materna");
        doc.addPage({ size: 'A4' });
        doc.image(canvas2.toBuffer(), 0, 0, { width: A4_WIDTH, height: A4_HEIGHT });

        // Página 3: Estadísticas
        const canvas3 = createCanvas(C_W, C_H);
        await drawStatsPage(canvas3.getContext("2d"), C_W, C_H, stats);
        doc.addPage({ size: 'A4' });
        doc.image(canvas3.toBuffer(), 0, 0, { width: A4_WIDTH, height: A4_HEIGHT });

        doc.end();
    } catch (error) {
        console.error(error);
        res.status(500).send("Error al generar PDF");
    }
});

app.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));
