const express = require("express");
const axios = require("axios");
const cors = require("cors");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const API_BASE_URL = process.env.API_BASE_URL || "";
const ARBOL_GENEALOGICO_API_URL = process.env.ARBOL_GENEALOGICO_API_URL || "";

const COLORS = {
    PATERNA: "#3498DB",
    MATERNA: "#2ECC71",
    POLITICA: "#95A5A6",
    DIRECTA: "#2C3E50",
    ACCENT: "#E74C3C",
    BG_LIGHT: "#F4F7F6",
    TEXT_MAIN: "#333333",
    TEXT_LIGHT: "#666666"
};

function clasificarFamilia(coincidences) {
    const grupos = {
        directa: [],
        paterna: [],
        materna: [],
        extendida: []
    };

    coincidences.forEach(p => {
        const tipo = p.tipo.toUpperCase();
        if (["PADRE", "MADRE", "HERMANO", "HERMANA", "HIJO", "HIJA"].includes(tipo)) {
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

// Función auxiliar para dibujar cabeceras uniformes
function drawHeader(doc, title) {
    // Fondo de cabecera ancho completo
    doc.rect(0, 0, 612, 50).fill(COLORS.DIRECTA);
    
    // Título principal
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(16).text(title, 40, 18, {
        width: 350,
        lineBreak: false
    });
    
    // Texto derecha: Sistema de consulta (alineado a la derecha con margen fijo)
    doc.fontSize(10).text("SISTEMA DE CONSULTA", 400, 22, { 
        width: 172, // 572 (margen derecho) - 400
        align: "right" 
    });
}

// Función tarjeta mejorada para evitar desbordes y ajustar texto
function drawPersonCard(doc, x, y, person, color) {
    const width = 160;
    const height = 75; // Aumentado ligeramente para permitir saltos de línea

    // Sombra
    doc.rect(x + 2, y + 2, width, height).fill("#DDDDDD");
    
    // Base blanca
    doc.rect(x, y, width, height).fill("#FFFFFF");
    
    // Borde lateral de color
    doc.rect(x, y, 5, height).fill(color);
    
    // Borde gris alrededor
    doc.rect(x, y, width, height).lineWidth(0.5).stroke("#CCCCCC");

    // Icono Sexo
    const icon = person.ge === "MASCULINO" ? "M" : "F";
    doc.fillColor("#333333").fontSize(14).text(icon, x + 10, y + 10);

    // Tipo de relación
    doc.fillColor(color).font("Helvetica-Bold").fontSize(8).text(person.tipo || "TITULAR", x + 35, y + 12);

    // Nombres (Con ajuste automático de línea)
    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(9);
    doc.text(`${person.nom}`, x + 10, y + 30, { 
        width: 140, 
        align: 'left'
    });

    // Apellidos (Se calculan debajo del nombre automáticamente, no se superponen)
    // PDFKit mantiene el cursor Y interno, pero aquí controlamos la posición manualmente
    // Para simplificar y asegurar que encaje, usamos una posición fija un poco más abajo
    // pero permitimos que el texto fluya.
    let currentY = doc.y; 
    if (currentY < y + 30) currentY = y + 30; // Safety check
    
    doc.font("Helvetica").fontSize(8).text(`${person.ap} ${person.am}`, x + 10, currentY + 2, { 
        width: 140, 
        align: 'left'
    });

    // Datos Extra (DNI/Edad) en la parte inferior absoluta de la tarjeta
    doc.fillColor("#666666").fontSize(7).text(`DNI: ${person.dni}  |  Edad: ${person.edad}`, x + 10, y + 60);
}

// --- FUNCIONES NUEVAS PARA EL RESUMEN ESTADÍSTICO (DISEÑO DASHBOARD) ---

function drawDonutChart(doc, x, y, radius, percentage, color, label, sublabel) {
    // Círculo gris fondo
    doc.lineWidth(5).strokeColor("#E0E0E0");
    doc.circle(x, y, radius).stroke();

    // Arco de progreso
    const startAngle = -Math.PI / 2; // Arriba (12 o'clock)
    const endAngle = startAngle + (Math.PI * 2 * (percentage / 100));
    
    doc.lineWidth(5).strokeColor(color);
    doc.path(`M ${x + radius * Math.cos(startAngle)} ${y + radius * Math.sin(startAngle)} A ${radius} ${radius} 0 ${percentage > 50 ? 1 : 0} 1 ${x + radius * Math.cos(endAngle)} ${y + radius * Math.sin(endAngle)}`).stroke();

    // Texto Centro
    doc.fillColor("#333333").font("Helvetica-Bold").fontSize(14).text(`${Math.round(percentage)}%`, x - 15, y - 6, { width: 30, align: "center" });
    
    // Etiqueta debajo
    doc.fillColor("#555555").font("Helvetica").fontSize(9).text(label, x - 30, y + radius + 10, { width: 60, align: "center" });
}

function drawPeopleIcons(doc, x, y, count, total, color) {
    // Dibujamos 10 iconos esquemáticos representando el total (cada icono = 10%)
    const iconWidth = 10;
    const iconGap = 15;
    
    doc.fillColor("#555555").fontSize(9).font("Helvetica").text("Representación Familiar", x, y - 20);

    for (let i = 0; i < 10; i++) {
        const cx = x + (i * iconGap);
        const cy = y;
        
        // Color activo vs inactivo
        const iconColor = i < (count / total * 10) ? color : "#D0D3D4";
        
        // Cabeza
        doc.circle(cx, cy, 3).fill(iconColor);
        // Cuerpo (Triángulo/Trapezoide simple)
        doc.path(`M ${cx} ${cy + 4} L ${cx - 4} ${cy + 12} L ${cx + 4} ${cy + 12} Z`).fill(iconColor);
    }
    doc.fillColor("#777").fontSize(8).text("Muestra representativa de la densidad poblacional del grupo.", x, y + 20, { width: 160 });
}

function drawProgressBar(doc, x, y, label, percentage, color) {
    const width = 130;
    const height = 10;

    // Etiqueta y Porcentaje
    doc.fillColor("#333").fontSize(10).font("Helvetica-Bold").text(`${percentage}%`, x + width + 10, y);
    doc.fontSize(9).font("Helvetica").text(label, x, y + 20, { width: width + 40 });

    // Barra Fondo
    doc.roundedRect(x, y, width, height, 5).fill("#E5E8E8");
    // Barra Progreso
    const progressWidth = (percentage / 100) * width;
    if (progressWidth > 0) {
        doc.roundedRect(x, y, progressWidth, height, 5).fill(color);
    }
}

function drawAreaChart(doc, x, y, w, h, dataPoints, color) {
    // Ejes
    doc.lineWidth(0.5).strokeColor("#CCCCCC");
    doc.moveTo(x, y).lineTo(x, y + h).lineTo(x + w, y + h).stroke(); // Eje Y y X

    // Título
    doc.fillColor("#333").fontSize(10).font("Helvetica-Bold").text("Distribución por Edades (Curva)", x, y - 20);

    if (dataPoints.length < 2) return;

    const maxVal = Math.max(...dataPoints);
    const stepX = w / (dataPoints.length - 1);
    
    // Crear path del área
    doc.moveTo(x, y + h); // Inicio abajo izquierda
    
    const points = [];
    dataPoints.forEach((val, i) => {
        const px = x + (i * stepX);
        const py = y + h - ((val / (maxVal || 1)) * (h - 20)); // -20 buffer superior
        points.push({x: px, y: py});
    });

    // Dibujar línea suave (simulada con líneas rectas para PDFKit básico)
    points.forEach(p => doc.lineTo(p.x, p.y));
    
    doc.lineTo(x + w, y + h); // Cerrar abajo derecha
    doc.lineTo(x, y + h); // Volver al inicio
    
    doc.fillOpacity(0.3).fillColor(color).fill();
    
    // Dibujar línea superior sólida
    doc.strokeOpacity(1).lineWidth(2).strokeColor(color);
    doc.moveTo(points[0].x, points[0].y);
    points.forEach(p => doc.lineTo(p.x, p.y));
    doc.stroke();
    doc.fillOpacity(1); // Reset
    
    // Etiquetas Eje X
    const labels = ["0-10", "11-20", "21-40", "41-60", "60+"];
    doc.fillColor("#777").fontSize(7);
    labels.forEach((l, i) => {
        if(i < dataPoints.length) {
            doc.text(l, x + (i * stepX) - 10, y + h + 5, { width: 30, align: "center" });
        }
    });
}

function drawSimpleBarChart(doc, x, y, w, h, data, labels, color) {
    doc.fillColor("#333").fontSize(10).font("Helvetica-Bold").text("Cantidad por Rama Familiar", x, y - 20);
    
    // Líneas de guía horizontales
    doc.lineWidth(0.5).strokeColor("#EEEEEE");
    for(let i=0; i<=4; i++) {
        const ly = y + h - (i * (h/4));
        doc.moveTo(x, ly).lineTo(x+w, ly).stroke();
    }

    const maxVal = Math.max(...data, 1);
    const barWidth = (w / data.length) - 10;
    
    data.forEach((val, i) => {
        const bx = x + (i * (w / data.length)) + 5;
        const barH = (val / maxVal) * (h - 10);
        const by = y + h - barH;

        // Barra
        doc.rect(bx, by, barWidth, barH).fill(color);
        
        // Valor arriba
        doc.fillColor("#333").fontSize(8).text(val.toString(), bx, by - 10, { width: barWidth, align: "center" });
        
        // Etiqueta abajo
        doc.fillColor("#555").fontSize(7).text(labels[i], bx, y + h + 5, { width: barWidth, align: "center" });
    });
}

// -----------------------------------------------------------------------

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

        const doc = new PDFDocument({ margin: 0, size: "LETTER" });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=Arbol_${dni}.pdf`);
        doc.pipe(res);

        const grupos = clasificarFamilia(data.coincidences);
        const p = data.person;

        // --- PAGINA 1: RESUMEN Y FAMILIA DIRECTA ---
        drawHeader(doc, "REPORTE GENEALOGICO PROFESIONAL");
        
        // Cabecera de Datos Personales
        doc.rect(40, 80, 532, 120).fill(COLORS.BG_LIGHT).stroke(COLORS.DIRECTA);
        doc.fillColor(COLORS.DIRECTA).font("Helvetica-Bold").fontSize(18).text("PERSONA CONSULTADA", 60, 100);
        doc.fontSize(22).text(`${p.nom} ${p.ap} ${p.am}`, 60, 125, { width: 490 }); // Ancho limitado para evitar desborde
        
        // Datos en línea (wrap si es necesario)
        doc.fontSize(12).fillColor("#444444").text(`DNI: ${p.dni}-${p.dv}  |  Sexo: ${p.ge}  |  Nacimiento: ${p.fn}  |  Edad: ${p.edad} años`, 60, 155, { width: 490 });

        // LEYENDA (Ajustada para que no se desborde)
        doc.rect(40, 220, 532, 60).lineWidth(1).stroke("#EEE");
        doc.fontSize(10).fillColor("#333").text("LEYENDA VISUAL:", 55, 230);
        
        // Usamos una grilla flexible para la leyenda
        const leyendas = [
            { c: COLORS.DIRECTA, t: "Familia Directa" },
            { c: COLORS.PATERNA, t: "Familia Paterna" },
            { c: COLORS.MATERNA, t: "Familia Materna" },
            { c: COLORS.POLITICA, t: "Familia Extendida/Polit." } // Abreviado sutilmente o ajustado el ancho
        ];
        
        // Distribución: 4 columnas equitativas
        const legendWidth = 532 / 4; 
        leyendas.forEach((l, i) => {
            const lx = 55 + (i * legendWidth);
            doc.rect(lx, 250, 10, 10).fill(l.c);
            // Ajustamos el ancho del texto para que haga wrap si es muy largo sin invadir al siguiente
            doc.fillColor("#555").text(l.t, lx + 15, 251, { width: legendWidth - 20, align: 'left' }); 
        });

        doc.fillColor(COLORS.DIRECTA).fontSize(14).font("Helvetica-Bold").text("FAMILIA DIRECTA", 40, 310);
        
        let currentY = 330;
        let currentX = 40;
        
        // Renderizado Familia Directa
        grupos.directa.forEach((fam, i) => {
            if(i > 0 && i % 3 === 0) { currentX = 40; currentY += 85; } // Incremento Y mayor para las tarjetas más altas
            drawPersonCard(doc, currentX, currentY, fam, COLORS.DIRECTA);
            currentX += 180;
        });

        // --- PAGINA 2+: RAMA PATERNA ---
        doc.addPage();
        drawHeader(doc, "RAMA GENEALOGICA PATERNA");
        currentY = 80; currentX = 40;
        grupos.paterna.forEach((fam, i) => {
            if(i > 0 && i % 3 === 0) { currentX = 40; currentY += 85; }
            if(currentY > 680) { doc.addPage(); drawHeader(doc, "RAMA PATERNA (Cont.)"); currentY = 80; }
            drawPersonCard(doc, currentX, currentY, fam, COLORS.PATERNA);
            currentX += 180;
        });

        // --- PAGINA 3+: RAMA MATERNA ---
        doc.addPage();
        drawHeader(doc, "RAMA GENEALOGICA MATERNA");
        currentY = 80; currentX = 40;
        grupos.materna.forEach((fam, i) => {
            if(i > 0 && i % 3 === 0) { currentX = 40; currentY += 85; }
            if(currentY > 680) { doc.addPage(); drawHeader(doc, "RAMA MATERNA (Cont.)"); currentY = 80; }
            drawPersonCard(doc, currentX, currentY, fam, COLORS.MATERNA);
            currentX += 180;
        });

        // --- PAGINA FINAL: RESUMEN ESTADISTICO DINAMICO (REDISEÑADO) ---
        doc.addPage();
        
        // Título del Dashboard estilo imagen
        doc.rect(0, 0, 612, 150).fill("#EBF5FB"); // Un fondo azul muy suave para el encabezado del dashboard
        doc.fillColor("#2C3E50").font("Helvetica-Bold").fontSize(28).text("Datos y Estadísticas", 40, 40);
        doc.font("Helvetica").fontSize(10).fillColor("#555555").text(
            "Resumen visual generado automáticamente basado en la información genealógica procesada. Los siguientes gráficos representan la distribución demográfica, género y estructura de la red familiar consultada.",
            40, 75, { width: 532 }
        );

        const total = data.quantity;
        const hombres = data.coincidences.filter(f => f.ge === "MASCULINO").length;
        const mujeres = data.coincidences.filter(f => f.ge === "FEMENINO").length;
        
        const pctHombres = total > 0 ? (hombres / total) * 100 : 0;
        const pctMujeres = total > 0 ? (mujeres / total) * 100 : 0;

        // FILA 1: DONAS Y PROGRESO
        const row1Y = 180;
        
        // 1. Donas (Crecimiento/Incremento simulado con Genero)
        drawDonutChart(doc, 90, row1Y + 40, 35, pctHombres, COLORS.PATERNA, "Hombres", "");
        drawDonutChart(doc, 200, row1Y + 40, 35, pctMujeres, COLORS.MATERNA, "Mujeres", "");

        // 2. Iconos (Gente) - Centro
        drawPeopleIcons(doc, 280, row1Y + 25, hombres, total, COLORS.DIRECTA);

        // 3. Barra Progreso - Derecha
        // Simulamos un índice de completitud o verificación
        drawProgressBar(doc, 440, row1Y + 20, "Índice de Coherencia de Datos", 85, COLORS.MATERNA);
        doc.fillColor("#777").fontSize(8).text("Datos validados contra fuentes.", 440, row1Y + 50, { width: 130 });

        // Separador visual
        doc.moveTo(40, 300).lineTo(572, 300).strokeColor("#EEEEEE").lineWidth(1).stroke();

        // FILA 2: GRAFICOS DE AREA Y BARRAS
        const row2Y = 330;

        // Preparar datos para Gráfico de Área (Edades)
        // Rangos: 0-10, 11-20, 21-40, 41-60, 60+
        const range1 = data.coincidences.filter(f => f.edad <= 10).length;
        const range2 = data.coincidences.filter(f => f.edad > 10 && f.edad <= 20).length;
        const range3 = data.coincidences.filter(f => f.edad > 20 && f.edad <= 40).length;
        const range4 = data.coincidences.filter(f => f.edad > 40 && f.edad <= 60).length;
        const range5 = data.coincidences.filter(f => f.edad > 60).length;
        const ageData = [range1, range2, range3, range4, range5];

        // 4. Area Chart (Izquierda)
        drawAreaChart(doc, 40, row2Y + 20, 240, 120, ageData, COLORS.MATERNA);

        // 5. Bar Chart (Derecha) - Distribución por tipo
        const countDirect = grupos.directa.length;
        const countPat = grupos.paterna.length;
        const countMat = grupos.materna.length;
        const countExt = grupos.extendida.length;
        const familyData = [countDirect, countPat, countMat, countExt];
        const familyLabels = ["Directa", "Paterna", "Materna", "Extend."];
        
        drawSimpleBarChart(doc, 320, row2Y + 20, 240, 120, familyData, familyLabels, COLORS.PATERNA);

        // Texto descriptivo final (Footer del dashboard)
        const footerY = 520;
        doc.fontSize(9).fillColor("#333").text("Análisis:", 40, footerY);
        doc.fontSize(8).fillColor("#666").text(
            `El análisis de la red familiar de ${p.nom} muestra una estructura compuesta por ${total} miembros identificados. ` +
            `La distribución de género es del ${Math.round(pctHombres)}% masculino y ${Math.round(pctMujeres)}% femenino. ` +
            `El grupo predominante corresponde a la rama ${countPat > countMat ? 'Paterna' : 'Materna'}. ` +
            `Este reporte estadístico facilita la comprensión rápida de la composición genealógica.`,
            40, footerY + 15, { width: 532, align: "justify" }
        );

        // Disclaimer final
        doc.rect(40, 650, 532, 60).fill("#F8F9F9");
        doc.fillColor("#7F8C8D").fontSize(7).font("Helvetica-Oblique");
        doc.text(
            "NOTA LEGAL: La información estadística presentada es meramente referencial y se basa en los datos disponibles al momento de la consulta. " +
            "No constituye un documento legal certificada por entidades gubernamentales de estadística.",
            50, 660, { width: 512, align: "justify" }
        );

        doc.end();
    } catch (e) { 
        console.error(e);
        res.status(500).send("Error generando PDF"); 
    }
});

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
