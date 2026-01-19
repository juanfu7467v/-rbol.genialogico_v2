const express = require("express");
const axios = require("axios");
const { createCanvas } = require("canvas");
const cors = require('cors');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// --- CONFIGURACIÓN ---
const API_BASE_URL = process.env.API_BASE_URL || "https://gdni-imagen-v2.fly.dev";
const ARBOL_GENEALOGICO_API_URL = process.env.ARBOL_GENEALOGICO_API_URL || "https://consulta-pe-imagenes-v2.fly.dev/consultar-arbol"; 
const FONT_FAMILY = "sans-serif";

// ==============================================================================
//  DIBUJO DE TABLAS DINÁMICAS (CON SOPORTE PARA MUCHOS DATOS)
// ==============================================================================

const drawFamilyHeader = (ctx, width, title, principal, side, MARGIN) => {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, 250);

    ctx.fillStyle = "#000000";
    ctx.font = `bold 50px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.fillText("Pe", MARGIN, 80);
    
    ctx.font = `bold 25px ${FONT_FAMILY}`;
    ctx.fillText("RESULTADO COMPLETO", MARGIN, 110);

    ctx.textAlign = "right";
    ctx.font = `bold 20px ${FONT_FAMILY}`;
    ctx.fillText("Consulta Familiar Pro", width - MARGIN, 80);

    // Info del titular
    ctx.textAlign = "left";
    ctx.font = `bold 18px ${FONT_FAMILY}`;
    ctx.fillText(`Titular: ${principal.nom} ${principal.ap} ${principal.am} (${principal.edad} años)`, MARGIN, 160);
    ctx.font = `14px ${FONT_FAMILY}`;
    ctx.fillText(`DNI: ${principal.dni}  |  Rama: ${side}  |  Sexo: ${principal.ge}`, MARGIN, 185);

    ctx.font = `bold 20px ${FONT_FAMILY}`;
    ctx.fillText(title, MARGIN, 230);
    
    return 240; // Retorna donde termina el header
};

const drawTableRows = (ctx, familiares, startY, width, height, MARGIN) => {
    const tableWidth = width - (MARGIN * 2);
    const rowHeight = 40;
    // Columnas: Parentesco (20%), Nombre (40%), DNI (15%), Edad (10%), Verif (15%)
    const colW = [0.18, 0.42, 0.15, 0.10, 0.15]; 
    const headers = ["Parentesco", "Nombre Completo", "DNI", "Edad", "Relación"];

    // Dibujar Header de Tabla
    ctx.fillStyle = "#333333";
    ctx.fillRect(MARGIN, startY, tableWidth, rowHeight);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold 14px ${FONT_FAMILY}`;
    
    let currentX = MARGIN;
    headers.forEach((h, i) => {
        ctx.fillText(h, currentX + 8, startY + 25);
        currentX += tableWidth * colW[i];
    });

    let currentY = startY + rowHeight;

    familiares.forEach((fam, index) => {
        // Alternar color de filas
        ctx.fillStyle = index % 2 === 0 ? "#FFFFFF" : "#F9F9F9";
        ctx.fillRect(MARGIN, currentY, tableWidth, rowHeight);
        ctx.strokeStyle = "#DDDDDD";
        ctx.strokeRect(MARGIN, currentY, tableWidth, rowHeight);

        ctx.fillStyle = "#000000";
        ctx.font = `12px ${FONT_FAMILY}`;

        const rowData = [
            (fam.tipo || "Familiar").substring(0, 18),
            `${fam.nom} ${fam.ap} ${fam.am}`.substring(0, 35),
            fam.dni || "N/A",
            `${fam.edad || ""}`,
            fam.verificacion_relacion || "ALTA"
        ];

        let rowX = MARGIN;
        rowData.forEach((text, i) => {
            ctx.fillText(text, rowX + 8, currentY + 25);
            rowX += tableWidth * colW[i];
        });

        currentY += rowHeight;
    });
};

// ==============================================================================
//  HOJA DE ESTADÍSTICAS (MEJORADA)
// ==============================================================================

const drawStatsPage = async (ctx, width, height, stats) => {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    const MARGIN = 60;

    ctx.fillStyle = "#1A237E";
    ctx.font = `bold 45px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.fillText("RESUMEN ANALÍTICO", MARGIN, 100);

    // Cajas de estadísticas
    const boxW = 220;
    const boxH = 120;
    const data = [
        { label: "Total Registros", val: stats.total, color: "#E8EAF6" },
        { label: "Hombres", val: stats.hombres, color: "#E3F2FD" },
        { label: "Mujeres", val: stats.mujeres, color: "#FCE4EC" },
        { label: "Rama Paterna", val: stats.paternaCount, color: "#E8F5E9" }
    ];

    data.forEach((item, i) => {
        const x = MARGIN + (i % 2) * (boxW + 40);
        const y = 180 + Math.floor(i / 2) * (boxH + 40);
        ctx.fillStyle = item.color;
        ctx.roundRect ? ctx.roundRect(x, y, boxW, boxH, 10) : ctx.fillRect(x, y, boxW, boxH);
        ctx.fill();
        ctx.fillStyle = "#000000";
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText(item.label, x + 20, y + 40);
        ctx.font = `bold 35px ${FONT_FAMILY}`;
        ctx.fillText(item.val, x + 20, y + 90);
    });

    // Disclaimer
    ctx.fillStyle = "#999999";
    ctx.font = `italic 12px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.fillText("Este reporte incluye la totalidad de coincidencias encontradas en la base de datos.", width/2, height - 60);
};

// ==============================================================================
//  LÓGICA DE PROCESAMIENTO
// ==============================================================================

function clasificarFamilia(familiares) {
    const paterna = [];
    const materna = [];
    
    familiares.forEach(fam => {
        const tipo = (fam.tipo || "").toUpperCase();
        if (tipo.includes("PATERNO") || tipo.includes("PADRE") || tipo.includes("HERMANO")) {
            paterna.push(fam);
        } else if (tipo.includes("MATERNO") || tipo.includes("MADRE")) {
            materna.push(fam);
        } else {
            paterna.push(fam); // Por defecto
        }
    });
    return { paterna, materna };
}

// ==============================================================================
//  ENDPOINTS
// ==============================================================================

app.get("/consultar-arbol", async (req, res) => {
    const dni = req.query.dni;
    if (!dni) return res.status(400).json({ error: "DNI requerido" });

    try {
        const response = await axios.get(`${ARBOL_GENEALOGICO_API_URL}?dni=${dni}`);
        const person = response.data?.result?.person;
        if (!person) return res.status(404).json({ error: "No encontrado" });

        const pdfUrl = `${API_BASE_URL}/descargar-arbol-pdf?dni=${dni}`;
        res.json({
            "dni": person.dni,
            "apellidos": `${person.ap} ${person.am}`,
            "nombres": person.nom,
            "estado": "FICHA GENERADA EXITOSAMENTE",
            "archivo": {
                "tipo": "PDF",
                "url": `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(pdfUrl)}`
            }
        });
    } catch (e) { res.status(500).json({ error: "Error de servidor" }); }
});

app.get("/descargar-ficha", (req, res) => res.redirect(req.query.url));

app.get("/descargar-arbol-pdf", async (req, res) => {
    const dni = req.query.dni;
    try {
        const response = await axios.get(`${ARBOL_GENEALOGICO_API_URL}?dni=${dni}`);
        const result = response.data.result;
        const familiares = result.coincidences || [];
        const principal = result.person;

        const { paterna, materna } = clasificarFamilia(familiares);

        const doc = new PDFDocument({ autoFirstPage: false });
        res.setHeader('Content-Type', 'application/pdf');
        doc.pipe(res);

        const A4_W = 595.28;
        const A4_H = 841.89;
        const SCALE = 2;
        const MARGIN = 40;

        // Función para procesar listas largas en múltiples páginas
        const processList = async (lista, titulo, rama) => {
            const itemsPerPage = 15;
            for (let i = 0; i < lista.length; i += itemsPerPage) {
                const chunk = lista.slice(i, i + itemsPerPage);
                const canvas = createCanvas(A4_W * SCALE, A4_H * SCALE);
                const ctx = canvas.getContext("2d");
                ctx.scale(SCALE, SCALE);
                
                const nextY = drawFamilyHeader(ctx, A4_W, `${titulo} (Parte ${Math.floor(i/itemsPerPage)+1})`, principal, rama, MARGIN);
                drawTableRows(ctx, chunk, nextY, A4_W, A4_H, MARGIN);
                
                doc.addPage({ size: 'A4' });
                doc.image(canvas.toBuffer(), 0, 0, { width: A4_W, height: A4_H });
            }
        };

        // Página Paterna
        await processList(paterna, "RAMA PATERNA Y HERMANOS", "Paterna");
        // Página Materna
        await processList(materna, "RAMA MATERNA", "Materna");

        // Página de Estadísticas
        const statsCanvas = createCanvas(A4_W * SCALE, A4_H * SCALE);
        const statsCtx = statsCanvas.getContext("2d");
        statsCtx.scale(SCALE, SCALE);
        await drawStatsPage(statsCtx, A4_W, A4_H, {
            total: familiares.length,
            paternaCount: paterna.length,
            maternaCount: materna.length,
            hombres: familiares.filter(f => f.ge === "MASCULINO").length,
            mujeres: familiares.filter(f => f.ge === "FEMENINO").length
        });
        doc.addPage({ size: 'A4' });
        doc.image(statsCanvas.toBuffer(), 0, 0, { width: A4_W, height: A4_H });

        doc.end();
    } catch (e) { 
        console.error(e);
        res.status(500).send("Error al generar PDF"); 
    }
});

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
