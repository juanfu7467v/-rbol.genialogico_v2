const express = require("express");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const QRCode = require('qrcode');
const cors = require('cors');
const { Buffer } = require('buffer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.use(cors());

// --- URLS DE LAS APIS (desde secrets) ---
const SUELDOS_API_URL = process.env.SUELDOS_API_URL || "";
const CONSUMOS_API_URL = process.env.CONSUMOS_API_URL || "";
const APK_LINK = "https://apk.e-droid.net/apk/app3790080-1f9e8a.apk?v=2";

/**
 * Genera el PDF con QR, Renuncia y Resultados Completos
 */
const generatePDF = async (dni, data, tipo) => {
    const qrDataUrl = await QRCode.toDataURL(APK_LINK);

    return new Promise((resolve) => {
        const doc = new PDFDocument({ 
            margin: 40, 
            size: 'A4',
            bufferPages: true 
        });
        
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // --- ENCABEZADO DINÁMICO ---
        const tituloReporte = tipo === 'SUELDOS' ? 'Reporte de Sueldos' : 'Reporte de Consumos';
        
        doc.fontSize(25).font('Helvetica-Bold').fillColor('#000000').text(tituloReporte, 40, 50);
        
        // Texto superior derecha
        doc.fontSize(10).font('Helvetica').text('Consulta pe apk', 450, 60, { align: 'right' });

        // --- SECCIÓN: INFORMACIÓN ---
        doc.rect(40, 110, 520, 20).fill('#f0f0f0').stroke('#000000');
        doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold').text('Información General', 45, 115);

        const infoTop = 130;
        doc.rect(40, infoTop, 130, 25).stroke();
        doc.text('DNI Consultado', 45, infoTop + 7);
        doc.rect(170, infoTop, 130, 25).stroke();
        doc.font('Helvetica').text(dni, 175, infoTop + 7);

        doc.rect(300, infoTop, 100, 25).stroke();
        doc.font('Helvetica-Bold').text('Fecha', 305, infoTop + 7);
        doc.rect(400, infoTop, 160, 25).stroke();
        doc.font('Helvetica').text(new Date().toLocaleDateString(), 405, infoTop + 7);

        // --- TABLA DE RESULTADOS COMPLETOS ---
        let currentY = 180;
        doc.rect(40, currentY, 520, 20).fill('#f0f0f0').stroke('#000000');
        doc.fillColor('#000000').font('Helvetica-Bold').text(`Detalle de ${tipo}`, 45, currentY + 5);
        
        currentY += 20;
        const col1 = 200;
        const col2 = 320;

        data.forEach((item, index) => {
            // Verificar si necesitamos nueva página
            if (currentY > 750) {
                doc.addPage();
                currentY = 50;
            }

            const isGray = index % 2 === 0;
            if (isGray) doc.rect(40, currentY, 520, 25).fill('#f9f9f9');
            
            doc.fillColor('#000000').stroke('#cccccc');
            doc.rect(40, currentY, col1, 25).stroke();
            doc.rect(40 + col1, currentY, col2, 25).stroke();

            doc.fontSize(8).font('Helvetica');
            
            if (tipo === 'SUELDOS') {
                const nombreEmpresa = (item.empresa || 'N/A').substring(0, 40);
                doc.text(nombreEmpresa, 45, currentY + 8);
                doc.text(`S/ ${item.sueldo}  |  Período: ${item.periodo}  |  Sit: ${item.situacion || '-'}`, 45 + col1, currentY + 8);
            } else {
                const razonSocial = (item.razonSocial || 'N/A').substring(0, 40);
                doc.text(razonSocial, 45, currentY + 8);
                doc.text(`S/ ${item.monto}  |  Fecha: ${item.fecha}  |  RUC: ${item.numRucEmisor}`, 45 + col1, currentY + 8);
            }
            currentY += 25;
        });

        // --- SECCIÓN FINAL (Inmediatamente después de la tabla) ---
        // Si queda muy poco espacio al final, saltamos de página
        if (currentY > 700) { 
            doc.addPage(); 
            currentY = 50; 
        } else {
            currentY += 30; // Espacio reducido después de la tabla
        }

        // Renuncia de responsabilidad
        doc.fontSize(7).font('Helvetica-Oblique').fillColor('#666666');
        const disclaimer = "Renuncia de responsabilidad: Este documento es de carácter informativo. Los datos provienen de fuentes externas públicas. La aplicación no se responsabiliza por la veracidad o actualización de los mismos ante entidades oficiales.";
        doc.text(disclaimer, 40, currentY, { width: 350, align: 'justify' });

        // QR alineado con la renuncia
        doc.image(qrDataUrl, 480, currentY - 10, { width: 70 });
        doc.fontSize(6).font('Helvetica-Bold').fillColor('#000000').text('ESCANEA PARA DESCARGAR APP', 465, currentY + 65, { width: 100, align: 'center' });

        doc.end();
    });
};

// --- ENDPOINTS ---

app.get("/consultar-sueldos", async (req, res) => {
    const { dni } = req.query;
    if (!dni) return res.status(400).json({ message: "DNI requerido" });

    try {
        const response = await axios.get(`${SUELDOS_API_URL}?dni=${dni}`);
        const result = response.data.result;
        if (!result || result.quantity === 0) throw new Error("Sin datos");

        // Generar un nombre único para el PDF
        const fileName = `SUELDO_${dni}_${Date.now()}.pdf`;
        
        // Devolver el resultado en JSON como espera la interfaz
        res.json({
            message: "found data",
            pdf_url: `${req.protocol}://${req.get('host')}/descargar-pdf?dni=${dni}&tipo=SUELDOS&filename=${fileName}`,
            quantity: result.quantity
        });
    } catch (e) {
        res.status(500).json({ message: "error", detail: e.message });
    }
});

app.get("/consultar-consumos", async (req, res) => {
    const { dni } = req.query;
    if (!dni) return res.status(400).json({ message: "DNI requerido" });

    try {
        const response = await axios.get(`${CONSUMOS_API_URL}?dni=${dni}`);
        const result = response.data.result;
        if (!result || result.quantity === 0) throw new Error("Sin datos");

        // Generar un nombre único para el PDF
        const fileName = `CONSUMO_${dni}_${Date.now()}.pdf`;
        
        // Devolver el resultado en JSON como espera la interfaz
        res.json({
            message: "found data",
            pdf_url: `${req.protocol}://${req.get('host')}/descargar-pdf?dni=${dni}&tipo=CONSUMOS&filename=${fileName}`,
            quantity: result.quantity
        });
    } catch (e) {
        res.status(500).json({ message: "error", detail: e.message });
    }
});

// Endpoint para descargar PDF directamente
app.get("/descargar-pdf", async (req, res) => {
    const { dni, tipo, filename } = req.query;
    if (!dni || !tipo) return res.status(400).json({ message: "DNI y tipo requeridos" });

    try {
        let apiUrl, pdfType;
        
        if (tipo === 'SUELDOS') {
            apiUrl = SUELDOS_API_URL;
            pdfType = "SUELDOS";
        } else if (tipo === 'CONSUMOS') {
            apiUrl = CONSUMOS_API_URL;
            pdfType = "CONSUMOS";
        } else {
            return res.status(400).json({ message: "Tipo no válido. Use SUELDOS o CONSUMOS" });
        }

        const response = await axios.get(`${apiUrl}?dni=${dni}`);
        const result = response.data.result;
        if (!result || result.quantity === 0) throw new Error("Sin datos");

        const pdfBuffer = await generatePDF(dni, result.coincidences, pdfType);
        
        // Usar el nombre proporcionado o generar uno por defecto
        const fileName = filename || `ficha_${dni}_${uuidv4()}.pdf`;
        
        // Configuración de cabeceras para asegurar que el navegador interprete la respuesta como un archivo descargable
        res.set({
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Type': 'application/pdf',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        
        res.send(pdfBuffer);
    } catch (e) {
        res.status(500).json({ message: "error", detail: e.message });
    }
});

// Endpoint de prueba
app.get("/", (req, res) => {
    res.json({
        message: "API de consultas PDF",
        endpoints: {
            consultar_sueldos: "/consultar-sueldos?dni=TU_DNI",
            consultar_consumos: "/consultar-consumos?dni=TU_DNI",
            descargar_pdf: "/descargar-pdf?dni=TU_DNI&tipo=SUELDOS_O_CONSUMOS"
        },
        config: {
            sueldos_api: SUELDOS_API_URL ? "Configurada" : "No configurada",
            consumos_api: CONSUMOS_API_URL ? "Configurada" : "No configurada"
        }
    });
});

if (require.main === module) {
    app.listen(PORT, HOST, () => {
        console.log(`Servidor PDF con QR optimizado activo en http://${HOST}:${PORT}`);
        console.log(`SUELDOS_API_URL: ${SUELDOS_API_URL ? "Configurada" : "Usando valor por defecto"}`);
        console.log(`CONSUMOS_API_URL: ${CONSUMOS_API_URL ? "Configurada" : "Usando valor por defecto"}`);
    });
}

module.exports = app;
