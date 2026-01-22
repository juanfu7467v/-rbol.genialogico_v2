const express = require("express");
const axios = require("axios");
const cors = require("cors");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const API_BASE_URL = process.env.API_BASE_URL || "";
const ARBOL_GENEALOGICO_API_URL = process.env.ARBOL_GENEALOGICO_API_URL || "";

// Colores del sistema original
const COLORS = {
    PATERNA: "#3498DB",
    MATERNA: "#2ECC71",
    POLITICA: "#95A5A6",
    DIRECTA: "#2C3E50",
    ACCENT: "#E74C3C",
    BG_LIGHT: "#F4F7F6"
};

// Colores extraídos del diseño de "Datos y Estadísticas" (Imagen)
const DASH_COLORS = {
    BG_MAIN: "#D6EAF8",      // Azul muy claro de fondo general
    TITLE: "#2E4053",        // Azul oscuro para títulos
    TEXT_GRAY: "#566573",    // Gris para textos descriptivos
    TEAL: "#1ABC9C",         // Verde azulado (Donas y barras)
    BLUE_LIGHT: "#5DADE2",   // Azul claro (Barras y áreas)
    BLUE_DARK: "#2874A6",    // Azul intermedio
    WHITE: "#FFFFFF",
    CARD_SHADOW: "#BDC3C7"
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

function drawHeader(doc, title) {
    doc.rect(0, 0, 612, 50).fill(COLORS.DIRECTA);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(16).text(title, 40, 18);
    doc.fontSize(10).text("SISTEMA DE CONSULTA", 400, 22, { align: "right" });
}

// Función mejorada para evitar desbordes y ajustar texto
function drawPersonCard(doc, x, y, person, color) {
    const width = 160;
    const height = 75; // Aumentado ligeramente para permitir 2 líneas de nombre

    // Sombra simple
    doc.rect(x + 2, y + 2, width, height).fill("#DDDDDD");
    
    // Tarjeta base
    doc.rect(x, y, width, height).fill("#FFFFFF");
    doc.rect(x, y, 5, height).fill(color);
    doc.rect(x, y, width, height).lineWidth(0.5).stroke("#CCCCCC");

    const icon = person.ge === "MASCULINO" ? "M" : "F";
    doc.fillColor("#333333").fontSize(14).text(icon, x + 10, y + 10);

    doc.fillColor(color).font("Helvetica-Bold").fontSize(8).text(person.tipo || "TITULAR", x + 35, y + 12);
    
    // Nombre: Ajuste automático de línea (sin ellipsis forzado en height pequeño)
    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(9);
    doc.text(`${person.nom}`, x + 10, y + 30, { 
        width: 140, 
        align: 'left',
        lineGap: 1
    });

    // Apellidos (calculamos posición Y basada en si el nombre ocupó 1 o 2 líneas)
    // Simulación simple: forzamos posición fija inferior para limpieza, o ajustamos.
    // Para mantener consistencia visual, usamos una posición fija segura.
    doc.font("Helvetica").fontSize(8).fillColor("#333333");
    doc.text(`${person.ap} ${person.am}`, x + 10, y + 48, { 
        width: 140, 
        align: 'left',
        height: 10,
        ellipsis: true
    });

    doc.fillColor("#666666").fontSize(7).text(`DNI: ${person.dni}  |  Edad: ${person.edad}`, x + 10, y + 60);
}

// --- NUEVAS FUNCIONES DE DIBUJO PARA EL DASHBOARD (Estilo Imagen) ---

function drawDonutChart(doc, x, y, radius, percentage, label, color) {
    // Fondo gris del donut
    doc.lineWidth(5).strokeColor("#E5E7E9");
    doc.circle(x, y, radius).stroke();

    // Arco de progreso
    if (percentage > 0) {
        const startAngle = -Math.PI / 2; // Arriba
        const endAngle = startAngle + (Math.PI * 2 * (percentage / 100));
        
        doc.lineWidth(5).strokeColor(color);
        doc.path(`M ${x + radius * Math.cos(startAngle)} ${y + radius * Math.sin(startAngle)} A ${radius} ${radius} 0 ${percentage > 50 ? 1 : 0} 1 ${x + radius * Math.cos(endAngle)} ${y + radius * Math.sin(endAngle)}`).stroke();
    }

    // Texto central
    doc.fillColor("#333").font("Helvetica-Bold").fontSize(10).text(`${percentage}%`, x - 10, y - 5);
    // Etiqueta inferior
    doc.fillColor("#555").font("Helvetica").fontSize(9).text(label, x - 20, y + radius + 10, { width: 40, align: "center" });
}

function drawPeopleIcons(doc, x, y, count) {
    // Dibujamos iconos estilizados de personas (máximo 10 visualmente)
    const visualCount = Math.min(count, 10); 
    const iconWidth = 10;
    const gap = 5;
    
    doc.fillColor(DASH_COLORS.TEAL);
    for (let i = 0; i < visualCount; i++) {
        let cx = x + (i * (iconWidth + gap));
        // Cabeza
        doc.circle(cx + 5, y, 3).fill();
        // Cuerpo (Trapezoide simple)
        doc.path(`M ${cx + 2} ${y + 4} L ${cx + 8} ${y + 4} L ${cx + 10} ${y + 15} L ${cx} ${y + 15} Z`).fill();
    }
}

function drawProgressBar(doc, x, y, percentage, label) {
    const width = 120;
    const height = 12;

    // Fondo barra
    doc.roundedRect(x, y, width, height, 6).fill("#D7DBDD");
    // Progreso
    const progressWidth = (percentage / 100) * width;
    if (progressWidth > 0) {
        doc.roundedRect(x, y, progressWidth, height, 6).fill(DASH_COLORS.TEAL);
    }
    
    doc.fillColor("#333").fontSize(10).text(`${percentage}%`, x + width + 10, y + 2);
    
    // Texto descriptivo debajo (Lorem ipsum style en imagen)
    doc.fillColor(DASH_COLORS.TEXT_GRAY).fontSize(8).font("Helvetica")
       .text(label, x, y + 20, { width: width + 40, align: "left" });
}

function drawAreaChart(doc, x, y, width, height, data) {
    // Ejes
    doc.lineWidth(0.5).strokeColor("#BDC3C7");
    // Líneas horizontales de fondo
    for(let i=0; i<=4; i++) {
        let ly = y + height - (height * (i/4));
        doc.moveTo(x, ly).lineTo(x + width, ly).stroke();
        doc.fillColor("#7F8C8D").fontSize(6).text(Math.round((Math.max(...data)/4)*i), x - 15, ly - 3);
    }

    // Dibujar el área
    if (data.length > 0) {
        const step = width / (data.length - 1);
        const maxVal = Math.max(...data, 1); // Evitar div por 0
        
        doc.save();
        // Definir camino
        doc.moveTo(x, y + height);
        data.forEach((val, i) => {
            let px = x + (i * step);
            let py = y + height - ((val / maxVal) * height);
            doc.lineTo(px, py);
        });
        doc.lineTo(x + width, y + height);
        doc.closePath();
        
        // Rellenar con opacidad
        doc.fillColor(DASH_COLORS.BLUE_LIGHT).fillOpacity(0.4).fill();
        doc.restore();

        // Dibujar línea superior sólida
        doc.strokeColor(DASH_COLORS.BLUE_DARK).lineWidth(2).strokeOpacity(1);
        doc.moveTo(x, y + height - ((data[0]/maxVal)*height));
        data.forEach((val, i) => {
            let px = x + (i * step);
            let py = y + height - ((val / maxVal) * height);
            doc.lineTo(px, py);
        });
        doc.stroke();
    }
    
    // Etiquetas Eje X (Simuladas como Elemento 1, 2...)
    doc.fillColor("#7F8C8D").fontSize(6);
    const labels = ["Directa", "Paterna", "Materna", "Politica"];
    labels.forEach((l, i) => {
        if(i < data.length) {
             doc.save();
             doc.translate(x + (i * (width/(data.length-1))), y + height + 10);
             doc.rotate(-45);
             doc.text(l, 0, 0);
             doc.restore();
        }
    });
}

function drawBarChart(doc, x, y, width, height, data1, data2) {
    // data1: Serie 1 (Verde/Teal), data2: Serie 2 (Azul)
    // Usaremos data1 para Hombres por edad, data2 para Mujeres por edad
    
    doc.lineWidth(0.5).strokeColor("#BDC3C7");
    // Líneas fondo
    for(let i=0; i<=4; i++) {
        let ly = y + height - (height * (i/4));
        doc.moveTo(x, ly).lineTo(x + width, ly).stroke();
    }

    const groups = 3; // Menores, Adultos, Mayores
    const barWidth = 15;
    const gap = 30;
    const maxVal = Math.max(...data1, ...data2, 1);

    const labels = ["Menores", "Adultos", "Mayores"];

    for(let i=0; i<groups; i++) {
        let startX = x + 20 + (i * ((width-40)/groups));
        
        // Barra 1
        let h1 = (data1[i] / maxVal) * height;
        doc.rect(startX, y + height - h1, barWidth, h1).fill(DASH_COLORS.TEAL);
        
        // Barra 2
        let h2 = (data2[i] / maxVal) * height;
        doc.rect(startX + barWidth + 2, y + height - h2, barWidth, h2).fill(DASH_COLORS.BLUE_LIGHT);

        // Label
        doc.fillColor("#555").fontSize(7).text(labels[i], startX, y + height + 5);
    }

    // Leyenda arriba
    doc.circle(x + width - 80, y - 15, 3).fill(DASH_COLORS.TEAL);
    doc.text("Masc.", x + width - 72, y - 18);
    doc.circle(x + width - 30, y - 15, 3).fill(DASH_COLORS.BLUE_LIGHT);
    doc.text("Fem.", x + width - 22, y - 18);
}


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

        drawHeader(doc, "REPORTE GENEALOGICO PROFESIONAL");
        
        doc.rect(40, 80, 532, 120).fill(COLORS.BG_LIGHT).stroke(COLORS.DIRECTA);
        doc.fillColor(COLORS.DIRECTA).font("Helvetica-Bold").fontSize(18).text("PERSONA CONSULTADA", 60, 100);
        doc.fontSize(22).text(`${p.nom} ${p.ap} ${p.am}`, 60, 125, { width: 490 }); // Agregado width para evitar desborde
        doc.fontSize(12).fillColor("#444444").text(`DNI: ${p.dni}-${p.dv}  |  Sexo: ${p.ge}  |  Nacimiento: ${p.fn}  |  Edad: ${p.edad} años`, 60, 155);

        doc.rect(40, 220, 532, 60).lineWidth(1).stroke("#EEE");
        doc.fontSize(10).fillColor("#333").text("LEYENDA VISUAL:", 55, 230);
        
        const leyendas = [
            { c: COLORS.DIRECTA, t: "Familia Directa" },
            { c: COLORS.PATERNA, t: "Familia Paterna" },
            { c: COLORS.MATERNA, t: "Familia Materna" },
            { c: COLORS.POLITICA, t: "Familia Extendida/Politica" }
        ];
        leyendas.forEach((l, i) => {
            doc.rect(55 + (i * 130), 250, 10, 10).fill(l.c);
            doc.fillColor("#555").text(l.t, 70 + (i * 130), 251);
        });

        doc.fillColor(COLORS.DIRECTA).fontSize(14).font("Helvetica-Bold").text("FAMILIA DIRECTA", 40, 310);
        let currentY = 330;
        let currentX = 40;
        grupos.directa.forEach((fam, i) => {
            // Ajuste: si i>0 y es múltiplo de 3, bajar línea.
            // Se aumenta el salto de línea a 85 para acomodar tarjetas más altas
            if(i > 0 && i % 3 === 0) { currentX = 40; currentY += 85; }
            drawPersonCard(doc, currentX, currentY, fam, COLORS.DIRECTA);
            currentX += 180;
        });

        doc.addPage();
        drawHeader(doc, "RAMA GENEALOGICA PATERNA");
        currentY = 80; currentX = 40;
        grupos.paterna.forEach((fam, i) => {
            if(i > 0 && i % 3 === 0) { currentX = 40; currentY += 85; }
            if(currentY > 680) { doc.addPage(); drawHeader(doc, "RAMA PATERNA (Cont.)"); currentY = 80; }
            drawPersonCard(doc, currentX, currentY, fam, COLORS.PATERNA);
            currentX += 180;
        });

        doc.addPage();
        drawHeader(doc, "RAMA GENEALOGICA MATERNA");
        currentY = 80; currentX = 40;
        grupos.materna.forEach((fam, i) => {
            if(i > 0 && i % 3 === 0) { currentX = 40; currentY += 85; }
            if(currentY > 680) { doc.addPage(); drawHeader(doc, "RAMA MATERNA (Cont.)"); currentY = 80; }
            drawPersonCard(doc, currentX, currentY, fam, COLORS.MATERNA);
            currentX += 180;
        });

        // --- SECCIÓN REDISEÑADA: DATOS Y ESTADÍSTICAS ---
        doc.addPage();
        // Fondo azul claro para toda la página de estadísticas (estilo imagen)
        doc.rect(0, 0, 612, 792).fill(DASH_COLORS.BG_MAIN);
        
        // Cabecera de la sección
        doc.rect(40, 40, 532, 100).fill(DASH_COLORS.WHITE); // Caja blanca título
        doc.fillColor(DASH_COLORS.TITLE).font("Helvetica-Bold").fontSize(28).text("Datos y Estadísticas", 60, 60);
        
        doc.fillColor(DASH_COLORS.TEXT_GRAY).fontSize(10).font("Helvetica")
           .text("Resumen analítico de la composición familiar basado en los registros procesados. Esta información permite visualizar rápidamente la distribución por género, edad y líneas de parentesco.", 
           60, 95, { width: 490, align: "left" });

        // Preparar Datos Reales
        const total = data.quantity || 1;
        const hombres = data.coincidences.filter(f => f.ge === "MASCULINO").length;
        const mujeres = data.coincidences.filter(f => f.ge === "FEMENINO").length;
        const pctHombres = Math.round((hombres / total) * 100);
        const pctMujeres = Math.round((mujeres / total) * 100);

        const menores = data.coincidences.filter(f => f.edad < 18).length;
        const adultos = data.coincidences.filter(f => f.edad >= 18 && f.edad < 60).length;
        const mayores = data.coincidences.filter(f => f.edad >= 60).length;
        
        // Datos para Gráfico de Barras (Desglose por Sexo y Edad simple)
        // Serie 1 (Masc): [MenoresH, AdultosH, MayoresH]
        const mMenores = data.coincidences.filter(f => f.ge === "MASCULINO" && f.edad < 18).length;
        const mAdultos = data.coincidences.filter(f => f.ge === "MASCULINO" && f.edad >= 18 && f.edad < 60).length;
        const mMayores = data.coincidences.filter(f => f.ge === "MASCULINO" && f.edad >= 60).length;
        
        const fMenores = data.coincidences.filter(f => f.ge === "FEMENINO" && f.edad < 18).length;
        const fAdultos = data.coincidences.filter(f => f.ge === "FEMENINO" && f.edad >= 18 && f.edad < 60).length;
        const fMayores = data.coincidences.filter(f => f.ge === "FEMENINO" && f.edad >= 60).length;

        // --- FILA 1: TARJETAS SUPERIORES ---
        const row1Y = 160;
        
        // Tarjeta Donas (Izquierda)
        doc.rect(40, row1Y, 200, 150).fill(DASH_COLORS.WHITE);
        drawDonutChart(doc, 90, row1Y + 60, 30, pctHombres, "Hombres", DASH_COLORS.TEAL);
        drawDonutChart(doc, 190, row1Y + 60, 30, pctMujeres, "Mujeres", DASH_COLORS.BLUE_LIGHT);

        // Tarjeta Iconos (Centro)
        doc.rect(260, row1Y, 150, 150).fill(DASH_COLORS.WHITE);
        doc.fillColor(DASH_COLORS.TITLE).fontSize(12).text(`${total} Familiares`, 275, row1Y + 20);
        drawPeopleIcons(doc, 275, row1Y + 50, total);
        doc.fillColor(DASH_COLORS.TEXT_GRAY).fontSize(8).text("Total de registros identificados en el árbol genealógico.", 275, row1Y + 80, { width: 120 });

        // Tarjeta Progreso (Derecha)
        doc.rect(430, row1Y, 142, 150).fill(DASH_COLORS.WHITE);
        // Usamos % de adultos como métrica de "Fuerza laboral" o similar, o simplemente % verificado.
        // Dado el contexto, usaremos % de Datos Completos (simulado alto) o % Adultos.
        const pctAdultos = Math.round((adultos / total) * 100);
        drawProgressBar(doc, 440, row1Y + 40, pctAdultos, "Porcentaje de familiares en edad adulta (18-60 años) registrados.");

        // --- FILA 2: GRÁFICOS INFERIORES ---
        const row2Y = 330;
        const chartHeight = 150;

        // Tarjeta Gráfico Área (Izquierda)
        doc.rect(40, row2Y, 250, 200).fill(DASH_COLORS.WHITE);
        // Datos para curva: Cantidad en Directa, Paterna, Materna, Extendida
        const areaData = [grupos.directa.length, grupos.paterna.length, grupos.materna.length, grupos.extendida.length];
        drawAreaChart(doc, 60, row2Y + 20, 210, 130, areaData);
        doc.fillColor(DASH_COLORS.TITLE).fontSize(10).text("Distribución por Ramas", 60, row2Y + 170);

        // Tarjeta Gráfico Barras (Derecha)
        doc.rect(310, row2Y, 262, 200).fill(DASH_COLORS.WHITE);
        drawBarChart(doc, 330, row2Y + 20, 220, 130, [mMenores, mAdultos, mMayores], [fMenores, fAdultos, fMayores]);
        doc.fillColor(DASH_COLORS.TITLE).fontSize(10).text("Rango de Edades por Género", 330, row2Y + 170);


        // Footer Disclaimer (Mantenido del original, ajustado visualmente)
        doc.rect(40, 560, 532, 80).fill("#F2F3F4");
        doc.fillColor("#7F8C8D").fontSize(8).font("Helvetica-Oblique");
        const disclaimer = [
            "NOTA LEGAL:",
            "1. La información estadística presentada es generada dinámicamente basada en la consulta actual.",
            "2. Los porcentajes son aproximados y redondeados.",
            "3. Este reporte visual replica la estructura de análisis profesional solicitada.",
            "4. Los datos provienen de fuentes externas y no han sido alterados."
        ];
        doc.text(disclaimer.join("\n"), 50, 570, { width: 512, align: "justify" });

        doc.end();
    } catch (e) { 
        console.error(e);
        res.status(500).send("Error generando PDF"); 
    }
});

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
