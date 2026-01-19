const express = require("express");
const axios = require("axios");
const { createCanvas } = require("canvas");
const cors = require('cors');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// --- CONFIGURACIÓN DE APIS ---
const API_BASE_URL = process.env.API_BASE_URL || "https://gdni-imagen-v2.fly.dev";
const ARBOL_GENEALOGICO_API_URL = process.env.ARBOL_GENEALOGICO_API_URL || "https://consulta-pe-imagenes-v2.fly.dev/consultar-arbol"; 
const FONT_FAMILY = "Helvetica"; 

// ==============================================================================
//  UTILIDADES DE DIBUJO Y ESTILOS
// ==============================================================================

const COLORS = {
    PATERNA: "#3498DB", // Azul
    MATERNA: "#27AE60", // Verde
    DIRECTA: "#E67E22", // Naranja
    POLITICA: "#95A5A6", // Gris
    TEXT_DARK: "#2C3E50",
    TEXT_LIGHT: "#7F8C8D",
    WHITE: "#FFFFFF",
    BG_LIGHT: "#F8F9FA"
};

const adjustColor = (col, amt) => {
    let usePound = false;
    if (col[0] == "#") { col = col.slice(1); usePound = true; }
    let num = parseInt(col, 16);
    let r = (num >> 16) + amt;
    if (r > 255) r = 255; else if (r < 0) r = 0;
    let b = ((num >> 8) & 0x00FF) + amt;
    if (b > 255) b = 255; else if (b < 0) b = 0;
    let g = (num & 0x0000FF) + amt;
    if (g > 255) g = 255; else if (g < 0) g = 0;
    return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
};

const draw3DBar = (ctx, x, y, width, height, color) => {
    const depth = 10;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + depth, y - depth);
    ctx.lineTo(x + width + depth, y - depth);
    ctx.lineTo(x + width, y);
    ctx.closePath();
    ctx.fillStyle = adjustColor(color, 30);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + width, y);
    ctx.lineTo(x + width + depth, y - depth);
    ctx.lineTo(x + width + depth, y + height - depth);
    ctx.lineTo(x + width, y + height);
    ctx.closePath();
    ctx.fillStyle = adjustColor(color, -30);
    ctx.fill();
};

const drawPersonCard = (ctx, x, y, w, h, person, color) => {
    const radius = 10;
    ctx.save();
    
    // Sombra
    ctx.shadowColor = "rgba(0,0,0,0.1)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    
    // Fondo
    ctx.fillStyle = COLORS.WHITE;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
    
    // Borde lateral de color
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, 8, h, [radius, 0, 0, radius]);
    ctx.fill();
    
    // Textos
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.TEXT_DARK;
    ctx.font = `bold 14px ${FONT_FAMILY}`;
    const name = `${person.nom} ${person.ap} ${person.am}`.substring(0, 35);
    ctx.fillText(name, x + 20, y + 25);
    
    ctx.font = `12px ${FONT_FAMILY}`;
    ctx.fillStyle = COLORS.TEXT_LIGHT;
    ctx.fillText(`DNI: ${person.dni}-${person.dv || '?'}` , x + 20, y + 45);
    ctx.fillText(`${person.tipo || 'TITULAR'} | ${person.edad} años`, x + 20, y + 65);
    
    // Icono Sexo
    ctx.font = `14px ${FONT_FAMILY}`;
    const icon = person.ge === "MASCULINO" ? "👨" : "👩";
    ctx.fillText(icon, x + w - 30, y + 25);
    
    ctx.restore();
};

// ==============================================================================
//  LÓGICA DE CLASIFICACIÓN
// ==============================================================================

function clasificarFamilia(familiares) {
    const directos = [];
    const paterna = [];
    const materna = [];
    const extendida = [];
    
    familiares.forEach(fam => {
        const tipo = (fam.tipo || "").toUpperCase();
        if (tipo === "PADRE" || tipo === "MADRE" || tipo.includes("HERMANO")) {
            directos.push(fam);
        } else if (tipo.includes("PATERNO") || tipo.includes("PATERNA")) {
            paterna.push(fam);
        } else if (tipo.includes("MATERNO") || tipo.includes("MATERNA")) {
            materna.push(fam);
        } else {
            extendida.push(fam);
        }
    });
    return { directos, paterna, materna, extendida };
}

// ==============================================================================
//  PÁGINAS DEL PDF
// ==============================================================================

const drawHeader = (ctx, width, title) => {
    ctx.fillStyle = COLORS.TEXT_DARK;
    ctx.font = `bold 30px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.fillText("Pe", 40, 60);
    ctx.font = `bold 18px ${FONT_FAMILY}`;
    ctx.fillText(title.toUpperCase(), 40, 90);
    ctx.textAlign = "right";
    ctx.font = `12px ${FONT_FAMILY}`;
    ctx.fillText("Consulta pe apk - Reporte Profesional", width - 40, 60);
    ctx.beginPath();
    ctx.strokeStyle = "#EEE";
    ctx.moveTo(40, 110);
    ctx.lineTo(width - 40, 110);
    ctx.stroke();
};

const drawMainPage = async (ctx, width, height, principal, stats) => {
    ctx.fillStyle = COLORS.BG_LIGHT;
    ctx.fillRect(0, 0, width, height);
    drawHeader(ctx, width, "Resumen del Titular");
    
    // Tarjeta Principal Destacada
    const cardW = 450;
    const cardH = 180;
    const cardX = (width - cardW) / 2;
    const cardY = 150;
    
    ctx.shadowColor = "rgba(0,0,0,0.15)";
    ctx.shadowBlur = 20;
    ctx.fillStyle = COLORS.WHITE;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 15);
    ctx.fill();
    
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLORS.DIRECTA;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, 10, [15, 15, 0, 0]);
    ctx.fill();
    
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.TEXT_DARK;
    ctx.font = `bold 24px ${FONT_FAMILY}`;
    ctx.fillText(`${principal.nom} ${principal.ap} ${principal.am}`, width / 2, cardY + 50);
    
    ctx.font = `16px ${FONT_FAMILY}`;
    ctx.fillStyle = COLORS.TEXT_LIGHT;
    ctx.fillText(`DNI: ${principal.dni} - Verificador: ${principal.dv}`, width / 2, cardY + 80);
    ctx.fillText(`Nacimiento: ${principal.fn} (${principal.edad} años)`, width / 2, cardY + 110);
    ctx.fillText(`Sexo: ${principal.ge} ${principal.ge === "MASCULINO" ? "👨" : "👩"}`, width / 2, cardY + 140);

    // Mini Resumen
    const items = [
        { l: "Total Familiares", v: stats.total },
        { l: "Verificación", v: "ALTA" }
    ];
    items.forEach((item, i) => {
        const x = (width / 2) - 100 + (i * 200);
        ctx.fillStyle = COLORS.TEXT_DARK;
        ctx.font = `bold 20px ${FONT_FAMILY}`;
        ctx.fillText(item.v, x, 400);
        ctx.font = `12px ${FONT_FAMILY}`;
        ctx.fillStyle = COLORS.TEXT_LIGHT;
        ctx.fillText(item.l, x, 420);
    });
};

const drawFamilyPage = async (ctx, width, height, title, familiares, color) => {
    ctx.fillStyle = COLORS.BG_LIGHT;
    ctx.fillRect(0, 0, width, height);
    drawHeader(ctx, width, title);
    
    const MARGIN = 50;
    const CARD_W = 250;
    const CARD_H = 80;
    const GAP = 20;
    
    let currentX = MARGIN;
    let currentY = 150;
    
    if (familiares.length === 0) {
        ctx.textAlign = "center";
        ctx.fillStyle = COLORS.TEXT_LIGHT;
        ctx.fillText("No se encontraron registros en esta categoría.", width / 2, height / 2);
        return;
    }

    familiares.forEach((fam, i) => {
        if (currentY + CARD_H > height - 50) return;
        drawPersonCard(ctx, currentX, currentY, CARD_W, CARD_H, fam, color);
        
        currentX += CARD_W + GAP;
        if (currentX + CARD_W > width - MARGIN) {
            currentX = MARGIN;
            currentY += CARD_H + GAP;
        }
    });
};

const drawStatsPage = async (ctx, width, height, stats) => {
    ctx.fillStyle = COLORS.BG_LIGHT;
    ctx.fillRect(0, 0, width, height);
    drawHeader(ctx, width, "Análisis Estadístico 3D");
    
    const MARGIN = 60;
    const chartHeight = 150;
    
    // Gráfico 1: Distribución por Sexo
    ctx.fillStyle = COLORS.TEXT_DARK;
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.fillText("Distribución por Sexo", MARGIN, 180);
    
    const sexData = [
        { l: "Hombres", v: stats.hombres, c: COLORS.PATERNA },
        { l: "Mujeres", v: stats.mujeres, c: COLORS.DIRECTA }
    ];
    
    sexData.forEach((d, i) => {
        const barW = 80;
        const barH = (d.v / (stats.total || 1)) * chartHeight;
        const x = MARGIN + 50 + (i * 150);
        const y = 350 - barH;
        draw3DBar(ctx, x, y, barW, barH, d.c);
        ctx.fillStyle = COLORS.TEXT_DARK;
        ctx.textAlign = "center";
        ctx.fillText(`${d.v}`, x + barW/2, y - 20);
        ctx.font = `12px ${FONT_FAMILY}`;
        ctx.fillText(d.l, x + barW/2, 370);
    });

    // Gráfico 2: Distribución por Ramas
    ctx.textAlign = "left";
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    ctx.fillText("Distribución por Ramas Familiares", MARGIN, 450);
    
    const branchData = [
        { l: "Directa", v: stats.directos, c: COLORS.DIRECTA },
        { l: "Paterna", v: stats.paterna, c: COLORS.PATERNA },
        { l: "Materna", v: stats.materna, c: COLORS.MATERNA },
        { l: "Política", v: stats.extendida, c: COLORS.POLITICA }
    ];
    
    branchData.forEach((d, i) => {
        const barW = 60;
        const barH = (d.v / (stats.total || 1)) * chartHeight;
        const x = MARGIN + 30 + (i * 130);
        const y = 650 - barH;
        draw3DBar(ctx, x, y, barW, barH, d.c);
        ctx.fillStyle = COLORS.TEXT_DARK;
        ctx.textAlign = "center";
        ctx.fillText(`${d.v}`, x + barW/2, y - 20);
        ctx.font = `10px ${FONT_FAMILY}`;
        ctx.fillText(d.l, x + barW/2, 670);
    });
};

const drawLegendPage = async (ctx, width, height) => {
    ctx.fillStyle = COLORS.BG_LIGHT;
    ctx.fillRect(0, 0, width, height);
    drawHeader(ctx, width, "Leyenda y Responsabilidad");
    
    const MARGIN = 60;
    let y = 180;
    
    // Leyenda
    ctx.fillStyle = COLORS.TEXT_DARK;
    ctx.font = `bold 18px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.fillText("Guía Visual", MARGIN, y);
    y += 40;
    
    const legend = [
        { l: "Familia Paterna", c: COLORS.PATERNA },
        { l: "Familia Materna", c: COLORS.MATERNA },
        { l: "Familia Directa", c: COLORS.DIRECTA },
        { l: "Familia Política / Extendida", c: COLORS.POLITICA }
    ];
    
    legend.forEach(item => {
        ctx.fillStyle = item.c;
        ctx.beginPath();
        ctx.roundRect(MARGIN, y - 15, 20, 20, 5);
        ctx.fill();
        ctx.fillStyle = COLORS.TEXT_DARK;
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText(item.l, MARGIN + 40, y);
        y += 35;
    });

    // Disclaimer
    y += 50;
    const discW = width - (MARGIN * 2);
    const discH = 200;
    ctx.fillStyle = COLORS.WHITE;
    ctx.shadowColor = "rgba(0,0,0,0.05)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(MARGIN, y, discW, discH, 10);
    ctx.fill();
    
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#E74C3C";
    ctx.fillRect(MARGIN, y, 5, discH);
    
    ctx.fillStyle = COLORS.TEXT_DARK;
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    ctx.fillText("RENUNCIA DE RESPONSABILIDAD", MARGIN + 25, y + 40);
    
    ctx.font = `13px ${FONT_FAMILY}`;
    ctx.fillStyle = COLORS.TEXT_LIGHT;
    const lines = [
        "• Esta plataforma actúa únicamente como intermediario tecnológico.",
        "• La información proviene íntegramente de una API externa de terceros.",
        "• Los datos no han sido modificados ni alterados por nuestro sistema.",
        "• Este reporte es posible gracias a nuestra infraestructura de procesamiento.",
        "• La información es de carácter referencial y no tiene validez legal.",
        "• No nos responsabilizamos por errores en la fuente original de los datos."
    ];
    lines.forEach((line, i) => {
        ctx.fillText(line, MARGIN + 25, y + 75 + (i * 22));
    });
};

// ==============================================================================
//  ENDPOINTS
// ==============================================================================

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
            "apellidos": `${data.ap} ${data.am}`.trim(),
            "nombres": data.nom,
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
        const { directos, paterna, materna, extendida } = clasificarFamilia(familiares);
        
        const stats = {
            total: familiares.length,
            hombres: familiares.filter(f => f.ge === "MASCULINO").length,
            mujeres: familiares.filter(f => f.ge === "FEMENINO").length,
            directos: directos.length,
            paterna: paterna.length,
            materna: materna.length,
            extendida: extendida.length
        };

        const doc = new PDFDocument({ autoFirstPage: false });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Arbol_Genealogico_${dni}.pdf`);
        doc.pipe(res);

        const A4_W = 595.28;
        const A4_H = 841.89;
        const SCALE = 2;
        const C_W = A4_W * SCALE;
        const C_H = A4_H * SCALE;

        const pages = [
            { title: "Principal", fn: (ctx) => drawMainPage(ctx, C_W, C_H, principal, stats) },
            { title: "Familia Directa", fn: (ctx) => drawFamilyPage(ctx, C_W, C_H, "Familia Directa", directos, COLORS.DIRECTA) },
            { title: "Rama Paterna", fn: (ctx) => drawFamilyPage(ctx, C_W, C_H, "Rama Paterna", paterna, COLORS.PATERNA) },
            { title: "Rama Materna", fn: (ctx) => drawFamilyPage(ctx, C_W, C_H, "Rama Materna", materna, COLORS.MATERNA) },
            { title: "Familia Extendida", fn: (ctx) => drawFamilyPage(ctx, C_W, C_H, "Familia Extendida y Política", extendida, COLORS.POLITICA) },
            { title: "Estadísticas", fn: (ctx) => drawStatsPage(ctx, C_W, C_H, stats) },
            { title: "Leyenda", fn: (ctx) => drawLegendPage(ctx, C_W, C_H) }
        ];

        for (const page of pages) {
            const canvas = createCanvas(C_W, C_H);
            await page.fn(canvas.getContext("2d"));
            doc.addPage({ size: 'A4' });
            doc.image(canvas.toBuffer(), 0, 0, { width: A4_W, height: A4_H });
        }

        doc.end();
    } catch (error) {
        console.error(error);
        res.status(500).send("Error al generar PDF");
    }
});

app.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));
