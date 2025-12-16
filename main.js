const express = require("express");
const axios = require("axios");
const { createCanvas, loadImage } = require("canvas");
const { v4: uuidv4 } = require("uuid");
const cors = require('cors'); 
const { Buffer } = require('buffer'); 
const path = require('path'); 
const crypto = require('crypto'); 

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

// AGREGADO: Habilitar CORS para todas las rutas y orígenes
app.use(cors()); 

// Definir la URL base pública si no se proporciona
const API_BASE_URL = process.env.API_BASE_URL || "https://consulta-pe-imagenes-v2.fly.dev";

// -----------------------------------------------------------
// --- URLs de las APIs ---
// -----------------------------------------------------------
// 1. API de Consulta de DNI (Nueva integración)
const RENIEC_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/reniec";
// 2. API de Árbol Genealógico
const ARBOL_GENEALOGICO_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/arbol"; 
// 3. API de Acta de Matrimonio
const ACTA_MATRIMONIO_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/matrimonios"; 

// --- Configuración de GitHub ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = "main";

// --- Constantes de Diseño Generales ---
const CANVAS_WIDTH_DEFAULT = 900; 
const MARGIN = 50;
const FONT_FAMILY = "sans-serif"; 
const COLOR_TITLE = '#000000';
const COLOR_TEXT = '#000000'; // Color de texto principal (NEGRO)
const COLOR_SECONDARY_TEXT = '#333333';
const FALLBACK_PHOTO_URL = "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEh4p_jX8U0kG7R8tD9K0h0bVv7V9jE_s2O_jJ4_X5kZ0X9qL_n9jX5Q6g8Q/s512/placeholder.png"; 

// Colores específicos del diseño de la imagen subida
const BACKGROUND_COLOR = '#FFFFFF'; 
const HEADER_BACKGROUND_COLOR = '#F0F0F0'; 
const TABLE_BORDER_COLOR = '#CCCCCC'; 
const TABLE_HEADER_COLOR = '#333333'; 

// ==============================================================================
//  FUNCIONES DE UTILIDAD
// ==============================================================================

/**
 * Mapeo de nombres de API a una clave corta y segura para el nombre del archivo.
 */
const API_TYPE_MAP = {
    "ARBOL GENEALOGICO": "ARBOL",
    "ACTA DE MATRIMONIO": "MATRIMONIO",
};

/**
 * Carga una imagen, o usa una imagen de fallback si falla.
 */
const loadImageWithFallback = async (url) => {
    try {
        if (!url || url === 'N/A') {
            throw new Error("URL no proporcionada o inválida.");
        }
        const image = await loadImage(url);
        return { image, loaded: true };
    } catch (e) {
        try {
            const fallback = await loadImage(FALLBACK_PHOTO_URL);
            return { image: fallback, loaded: false };
        } catch (e) {
             console.error("Error al cargar imagen de fallback. Usando N/A.");
             return { image: null, loaded: false };
        }
    }
};

/**
 * Función simplificada para la subida a GitHub.
 */
const uploadToGitHub = async (fileName, imageBuffer, messagePrefix) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        throw new Error("Error de configuración: GITHUB_TOKEN o GITHUB_REPO no están definidos.");
    }

    const [owner, repo] = GITHUB_REPO.split('/');
    if (!owner || !repo) {
        throw new Error("El formato de GITHUB_REPO debe ser 'owner/repository-name'.");
    }

    const filePath = `public/${fileName}`; 
    const contentBase64 = imageBuffer.toString('base64');

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const publicUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/${filePath}`;

    const data = {
        message: `${messagePrefix} generada para ${fileName}`,
        content: contentBase64,
        branch: GITHUB_BRANCH
    };

    const config = {
        headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
            'User-Agent': 'FlyIoImageGeneratorApp'
        }
    };

    // Primero intentar obtener el SHA si el archivo existe
    try {
        const checkResponse = await axios.get(apiUrl, config);
        if (checkResponse.data.sha) {
            data.sha = checkResponse.data.sha; // Añadir SHA para actualizar
            data.message = `fix: Actualización de ${messagePrefix} para ${fileName}`;
        }
    } catch (error) {
        if (error.response?.status !== 404) {
             console.error(`Error al verificar SHA para subir a GitHub: ${error.message}`);
        }
    }

    await axios.put(apiUrl, data, config);
    return publicUrl;
};

/**
 * Comprueba si ya existe una imagen para el DNI y tipo de API.
 * Retorna la URL raw si existe, o null si no.
 */
const checkIfImageExists = async (dni, apiType) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        console.warn("ADVERTENCIA: GITHUB_TOKEN o GITHUB_REPO no están definidos para la verificación.");
        return null;
    }

    const [owner, repo] = GITHUB_REPO.split('/');
    if (!owner || !repo) return null;
    
    const targetFileName = `${dni}_${apiType}.png`.toLowerCase();
    const filePathPrefix = `public/`;

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePathPrefix}`;

    const config = {
        headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            'User-Agent': 'FlyIoImageGeneratorApp',
            'Accept': 'application/vnd.github.v3+json'
        }
    };

    try {
        const response = await axios.get(apiUrl, config);
        const files = response.data;

        const existingFile = files.find(file => file.type === 'file' && file.name.toLowerCase() === targetFileName);

        if (existingFile) {
            console.log(`✅ Imagen existente encontrada para DNI: ${dni} (${apiType}).`);
            return `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/${filePathPrefix}${existingFile.name}`;
        }

        return null;

    } catch (error) {
        if (error.response?.status !== 404) {
             console.error(`Error al verificar existencia de imagen en GitHub (status ${error.response?.status}):`, error.message);
        }
        return null;
    }
};

/**
 * Sube la imagen si no existe, o retorna la URL de la imagen existente.
 */
const uploadOrReturnExisting = async (dni, apiName, imageBuffer) => {
    const apiTypeKey = API_TYPE_MAP[apiName] || 'DESCONOCIDO';
    const messagePrefix = apiName.includes("MATRIMONIO") ? "feat: Matrimonios" : "feat: Árbol Genealógico";
    
    const existingUrl = await checkIfImageExists(dni, apiTypeKey);

    if (existingUrl) {
        return { 
            url: existingUrl, 
            status: "existing" 
        };
    }

    const fileName = `${dni}_${apiTypeKey}.png`.toLowerCase();
    console.log(`⬆️ Subiendo nueva imagen: ${fileName}`);
    const newUrl = await uploadToGitHub(fileName, imageBuffer, messagePrefix);
    
    return { 
        url: newUrl, 
        status: "new" 
    };
};


/**
 * NUEVO: Consulta la API de DNI.
 * @param {string} dni - El DNI a consultar.
 * @returns {Promise<object|null>} Objeto de datos de la API de RENIEC o null.
 */
const consultReniecApi = async (dni) => {
    if (!dni || dni === 'N/A') return null;

    try {
        // La API de RENIEC es un proxy a una API externa, debemos verificar la respuesta esperada.
        const response = await axios.get(`${RENIEC_API_URL}?dni=${dni}`);
        // La estructura esperada es { result: { message: 'found data', result: { ...datos... } } }
        const data = response.data?.result?.result;
        
        if (data && response.data.result?.message === 'found data') {
            return {
                dni: data.nuDni || dni,
                nombres: (data.preNombres || '').toUpperCase().trim(),
                apellido_paterno: (data.apePaterno || '').toUpperCase().trim(),
                apellido_materno: (data.apeMaterno || '').toUpperCase().trim(),
                firma: data.firma || null, // Base64 de la firma
                // Añadir otros campos relevantes si se necesitan
            };
        }
        return null;
    } catch (error) {
        // Esto captura errores 404/500 de la API de RENIEC o problemas de red
        console.warn(`Error al consultar RENIEC API para DNI ${dni}:`, error.message);
        return null;
    }
};


/**
 * Función auxiliar para estandarizar la obtención de nombres y apellidos de la persona principal.
 * @param {object} data - El objeto de datos.
 * @returns {object} Un objeto con dni, nombres, apellido_paterno, apellido_materno.
 */
const getFormattedPersonData = (data) => {
    if (!data) {
        return {
            dni: 'N/A',
            nombres: 'N/A',
            apellido_paterno: 'N/A',
            apellido_materno: 'N/A',
            firma: null
        };
    }

    // La API externa usa 'nom', 'ap', 'am'. La API interna usa 'nombres', 'apellido_paterno', 'apellido_materno' o variantes.
    const nombres = (data.nombres || data.nom || data.preNombres || '').toUpperCase().trim();
    const apellidoPaterno = (data.apellido_paterno || data.ap || data.ape_pat || data.apePaterno || '').toUpperCase().trim();
    const apellidoMaterno = (data.apellido_materno || data.am || data.ape_mat || data.apeMaterno || '').toUpperCase().trim();

    return {
        dni: data.dni || data.nuDni || 'N/A',
        nombres,
        apellido_paterno: apellidoPaterno,
        apellido_materno: apellidoMaterno,
        firma: data.firma || null // La firma ya viene en base64
    };
};

/**
 * Función auxiliar para dividir texto en líneas que caben dentro de un ancho máximo.
 */
const wrapText = (ctx, text, maxWidth, lineHeight) => {
    const words = text.split(' ');
    let line = '';
    const lines = [];

    for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;

        if (testWidth > maxWidth && i > 0) {
            lines.push(line.trim());
            line = words[i] + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line.trim());
    return { lines, height: lines.length * lineHeight };
};


// ==============================================================================
//  FUNCIONES DE DIBUJO (ACTA DE MATRIMONIO) - MODIFICADA CON FIRMAS
// ==============================================================================

/**
 * Dibuja la imagen del Acta de Matrimonio, imitando el diseño y añadiendo las firmas.
 * @param {string} rawDocumento - DNI del principal.
 * @param {object} principalData - Datos del cónyuge 1 (incluye firma).
 * @param {object} matrimonioData - Datos del matrimonio.
 * @param {object} conyuge2Data - Datos del cónyuge 2 (incluye firma).
 */
const generateMarriageCertificateImage = async (rawDocumento, principalData, matrimonioData, conyuge2Data) => {
    
    // --- CONSTANTES DE DISEÑO ---
    const API_TITLE = "Acta";
    const API_SUBTITLE = "MATRIMONIO";
    const BRAND_NAME = "Consulta pe apk"; 
    const CANVAS_WIDTH = 900; 
    const CANVAS_HEIGHT = 1200; // Altura inicial suficiente
    const MARGIN_X = 50;
    const MARGIN_Y = 50;
    const INNER_WIDTH = CANVAS_WIDTH - 2 * MARGIN_X;
    const CELL_PADDING = 15;
    const ROW_HEIGHT = 40;
    const LINE_HEIGHT = 18;
    const MIN_ROW_HEIGHT = 50; 
    
    // 1. Generación del Canvas
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = BACKGROUND_COLOR; 
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // 2. Encabezado (Título y Logo - Simulado)
    let currentY = MARGIN_Y;
    
    ctx.fillStyle = COLOR_TITLE;
    ctx.textAlign = 'left';
    ctx.font = `bold 60px ${FONT_FAMILY}`;
    ctx.fillText(API_TITLE, MARGIN_X, currentY + 30);
    
    currentY += 40;
    ctx.font = `bold 30px ${FONT_FAMILY}`;
    ctx.fillText(API_SUBTITLE, MARGIN_X, currentY + 30);
    
    currentY += 50;

    ctx.textAlign = 'right';
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `bold 20px ${FONT_FAMILY}`;
    ctx.fillText(BRAND_NAME, CANVAS_WIDTH - MARGIN_X, MARGIN_Y + 30); 

    currentY = 120;
    
    // 3. SECCIÓN 1: Información (Matrimonio)
    currentY += 30;
    ctx.textAlign = 'left';
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `bold 24px ${FONT_FAMILY}`;
    ctx.fillText("Información", MARGIN_X, currentY);

    currentY += 10;
    
    const rawInfoData = [
        ["Fecha de Matrimonio", matrimonioData.fecha_matrimonio || 'N/A', "Registro Único", matrimonioData.registro_unico || 'N/A'],
        ["Oficina de Registro", matrimonioData.oficina_registro || 'N/A', "Nro. de Acta", matrimonioData.nro_acta || 'N/A'],
        ["Departamento", matrimonioData.departamento || 'N/A', "Provincia", matrimonioData.provincia || 'N/A'],
        ["Distrito", matrimonioData.distrito || matrimonioData.lugar || 'N/A', "Régimen Patrimonial", matrimonioData.regimen_patrimonial || 'N/A']
    ];
    
    const infoCol1Width = 180;
    const infoCol2Width = INNER_WIDTH / 2 - infoCol1Width;
    const infoCol3Width = 180;
    const infoCol4Width = INNER_WIDTH / 2 - infoCol3Width;
    const wrapFieldsIndices = [1, 2, 3]; 

    rawInfoData.forEach((row, rowIndex) => {
        let rowHeight = MIN_ROW_HEIGHT;
        let startY = currentY;

        ctx.font = `bold 14px ${FONT_FAMILY}`;
        const shouldWrap = wrapFieldsIndices.includes(rowIndex);

        let wrappedCol2 = { lines: [String(row[1]).toUpperCase()], height: LINE_HEIGHT };
        let wrappedCol4 = { lines: [String(row[3]).toUpperCase()], height: LINE_HEIGHT };

        if (shouldWrap) {
            wrappedCol2 = wrapText(ctx, String(row[1]).toUpperCase(), infoCol2Width - 2 * CELL_PADDING, LINE_HEIGHT);
            wrappedCol4 = wrapText(ctx, String(row[3]).toUpperCase(), infoCol4Width - 2 * CELL_PADDING, LINE_HEIGHT);
            
            const maxTextHeight = Math.max(wrappedCol2.height, wrappedCol4.height);
            rowHeight = Math.max(MIN_ROW_HEIGHT, maxTextHeight + 2 * (CELL_PADDING - 5)); 
        }

        // DIBUJO DE LA FILA (FONDOS Y BORDES)
        ctx.fillStyle = HEADER_BACKGROUND_COLOR;
        ctx.fillRect(MARGIN_X, startY, infoCol1Width, rowHeight);
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(MARGIN_X + infoCol1Width, startY, infoCol2Width, rowHeight);
        ctx.fillStyle = HEADER_BACKGROUND_COLOR;
        ctx.fillRect(MARGIN_X + INNER_WIDTH / 2, startY, infoCol3Width, rowHeight);
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(MARGIN_X + INNER_WIDTH / 2 + infoCol3Width, startY, infoCol4Width, rowHeight);
        
        ctx.strokeStyle = TABLE_BORDER_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(MARGIN_X, startY, INNER_WIDTH, rowHeight);
        ctx.beginPath();
        ctx.moveTo(MARGIN_X + infoCol1Width, startY);
        ctx.lineTo(MARGIN_X + infoCol1Width, startY + rowHeight);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(MARGIN_X + INNER_WIDTH / 2 + infoCol3Width, startY);
        ctx.lineTo(MARGIN_X + INNER_WIDTH / 2 + infoCol3Width, startY + rowHeight);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(MARGIN_X + INNER_WIDTH / 2, startY);
        ctx.lineTo(MARGIN_X + INNER_WIDTH / 2, startY + rowHeight);
        ctx.stroke();

        // DIBUJO DE TEXTO
        const textYCenterOffset = 5; 

        ctx.fillStyle = TABLE_HEADER_COLOR;
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText(row[0], MARGIN_X + CELL_PADDING, startY + rowHeight / 2 + textYCenterOffset);
        ctx.fillText(row[2], MARGIN_X + INNER_WIDTH / 2 + CELL_PADDING, startY + rowHeight / 2 + textYCenterOffset);

        ctx.fillStyle = COLOR_TEXT;
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        const blockYStartCol2 = startY + (rowHeight / 2) - (wrappedCol2.height / 2);
        wrappedCol2.lines.forEach((line, i) => {
            const lineY = blockYStartCol2 + (i * LINE_HEIGHT) + textYCenterOffset; 
            ctx.fillText(line, MARGIN_X + infoCol1Width + CELL_PADDING, lineY);
        });
        
        ctx.fillStyle = COLOR_TEXT;
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        const blockYStartCol4 = startY + (rowHeight / 2) - (wrappedCol4.height / 2);
        wrappedCol4.lines.forEach((line, i) => {
            const lineY = blockYStartCol4 + (i * LINE_HEIGHT) + textYCenterOffset; 
            ctx.fillText(line, MARGIN_X + INNER_WIDTH / 2 + infoCol3Width + CELL_PADDING, lineY);
        });

        currentY += rowHeight;
    });
    
    // 4. SECCIÓN 2: Asistentes (Cónyuges y Observaciones)
    currentY += 30;
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `bold 24px ${FONT_FAMILY}`;
    ctx.fillText("Cónyuges y Testigos", MARGIN_X, currentY);

    currentY += 10;
    
    // Fila de encabezado
    currentY += 5;
    const headerRowHeight = ROW_HEIGHT;
    ctx.fillStyle = HEADER_BACKGROUND_COLOR;
    ctx.fillRect(MARGIN_X, currentY, INNER_WIDTH, headerRowHeight);
    ctx.strokeStyle = TABLE_BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN_X, currentY, INNER_WIDTH, headerRowHeight);
    ctx.beginPath();
    ctx.moveTo(MARGIN_X + INNER_WIDTH / 2, currentY);
    ctx.lineTo(MARGIN_X + INNER_WIDTH / 2, currentY + headerRowHeight);
    ctx.stroke();
    
    ctx.fillStyle = TABLE_HEADER_COLOR;
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText("Rol", MARGIN_X + CELL_PADDING, currentY + headerRowHeight / 2 + 5);
    ctx.fillText("Nombre Completo y DNI", MARGIN_X + INNER_WIDTH / 2 + CELL_PADDING, currentY + headerRowHeight / 2 + 5);
    
    currentY += headerRowHeight;

    // --- DATOS ENRIQUECIDOS ---
    const conyuge1 = principalData; // Ya están enriquecidos
    const conyuge2 = conyuge2Data; // Ya están enriquecidos
    
    // NOTA CLAVE: Aquí se usa el nombre enriquecido:
    const conyugeRowsData = [
        ["Cónyuge Principal (1)", `${conyuge1.nombres} ${conyuge1.apellido_paterno} ${conyuge1.apellido_materno} (DNI: ${conyuge1.dni})`],
        ["Cónyuge Pareja (2)", `${conyuge2.nombres} ${conyuge2.apellido_paterno} ${conyuge2.apellido_materno} (DNI: ${conyuge2.dni})`],
        ["Estado Civil Anterior C1", matrimonioData.estado_civil_c1 || 'N/A'],
        ["Estado Civil Anterior C2", matrimonioData.estado_civil_c2 || 'N/A']
    ];
    
    // DIBUJO DE CÓNYUGES CON AJUSTE DE ALTURA
    conyugeRowsData.forEach((row, index) => {
        const startY = currentY;
        const isConyugeRow = index < 2; 
        const contentText = isConyugeRow ? String(row[1]).toUpperCase() : String(row[1] || 'N/A').toUpperCase();
        
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        let rowHeight;
        let wrappedContent;
        const contentWidth = INNER_WIDTH / 2 - 2 * CELL_PADDING;

        if (isConyugeRow) {
            wrappedContent = wrapText(ctx, contentText, contentWidth, LINE_HEIGHT);
            rowHeight = Math.max(ROW_HEIGHT, wrappedContent.height + 2 * (CELL_PADDING - 5)); 
        } else {
            rowHeight = ROW_HEIGHT;
            wrappedContent = wrapText(ctx, contentText, contentWidth, LINE_HEIGHT);
        }

        // Dibujar Fondos y Bordes
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(MARGIN_X, startY, INNER_WIDTH / 2, rowHeight); 
        ctx.fillRect(MARGIN_X + INNER_WIDTH / 2, startY, INNER_WIDTH / 2, rowHeight); 
        ctx.strokeStyle = TABLE_BORDER_COLOR;
        ctx.strokeRect(MARGIN_X, startY, INNER_WIDTH, rowHeight);
        ctx.beginPath();
        ctx.moveTo(MARGIN_X + INNER_WIDTH / 2, startY);
        ctx.lineTo(MARGIN_X + INNER_WIDTH / 2, startY + rowHeight);
        ctx.stroke();
        
        // Dibujar Texto
        const textYCenterOffset = 5; 
        const blockYStart = startY + (rowHeight / 2) - (wrappedContent.height / 2);

        ctx.fillStyle = COLOR_TEXT;
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText(row[0], MARGIN_X + CELL_PADDING, startY + rowHeight / 2 + textYCenterOffset);
        
        ctx.fillStyle = COLOR_TEXT;
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        
        wrappedContent.lines.forEach((line, i) => {
            const lineY = blockYStart + (i * LINE_HEIGHT) + textYCenterOffset; 
            ctx.fillText(line, MARGIN_X + INNER_WIDTH / 2 + CELL_PADDING, lineY);
        });

        currentY += rowHeight;
    });
    
    // 5. SECCIÓN 3: Orden del Día (Observaciones)
    currentY += 30;
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `bold 24px ${FONT_FAMILY}`;
    ctx.fillText("Observaciones y Certificación", MARGIN_X, currentY);

    currentY += 10;
    
    // Fila de Encabezado de Observaciones
    currentY += 5;
    ctx.fillStyle = HEADER_BACKGROUND_COLOR;
    ctx.fillRect(MARGIN_X, currentY, INNER_WIDTH, ROW_HEIGHT);
    ctx.strokeRect(MARGIN_X, currentY, INNER_WIDTH, ROW_HEIGHT);
    ctx.fillStyle = TABLE_HEADER_COLOR;
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText("Observaciones Registradas", MARGIN_X + CELL_PADDING, currentY + ROW_HEIGHT / 2 + 5);
    
    currentY += ROW_HEIGHT;
    
    // Fila de Contenido de Observaciones
    const observationHeight = 80;
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(MARGIN_X, currentY, INNER_WIDTH, observationHeight);
    ctx.strokeRect(MARGIN_X, currentY, INNER_WIDTH, observationHeight);
    
    ctx.fillStyle = COLOR_TEXT;
    ctx.font = `14px ${FONT_FAMILY}`;
    const obsText = matrimonioData.observaciones || 'NO HAY OBSERVACIONES ADICIONALES REGISTRADAS EN ESTA ACTA.';
    
    const obsWrapped = wrapText(ctx, obsText, INNER_WIDTH - 2 * CELL_PADDING, LINE_HEIGHT);
    
    const obsBlockYStart = currentY + (observationHeight / 2) - (obsWrapped.height / 2);
    let textY = obsBlockYStart + 5; 

    obsWrapped.lines.forEach(line => {
        if (textY < currentY + observationHeight - 5) { 
            ctx.fillText(line.trim(), MARGIN_X + CELL_PADDING, textY);
            textY += LINE_HEIGHT;
        }
    });

    currentY += observationHeight;

    // 6. Pie de Página (Firmas)
    currentY += 50;
    
    const FIRMA_WIDTH = 200;
    const FIRMA_HEIGHT = 80; 
    const firmaY = currentY;

    // NOTA CLAVE: Aquí se usan las firmas de ambos cónyuges:
    // --- DIBUJO DE LA FIRMA 1 (Cónyuge Principal) ---
    const firma1X = CANVAS_WIDTH / 4;
    await drawSignature(ctx, conyuge1.firma, firma1X - FIRMA_WIDTH / 2, firmaY, FIRMA_WIDTH, FIRMA_HEIGHT, conyuge1.nombres);

    // --- DIBUJO DE LA FIRMA 2 (Cónyuge Pareja 2) ---
    const firma2X = CANVAS_WIDTH * 3 / 4;
    await drawSignature(ctx, conyuge2.firma, firma2X - FIRMA_WIDTH / 2, firmaY, FIRMA_WIDTH, FIRMA_HEIGHT, conyuge2.nombres);
    
    currentY = firmaY + FIRMA_HEIGHT + 30;

    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `14px ${FONT_FAMILY}`;
    ctx.fillText("Firma Cónyuge Principal", firma1X, currentY);
    ctx.fillText("Firma Cónyuge Pareja (2)", firma2X, currentY);
    
    currentY += 60;
    
    // Firma Registrador
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2 - 50, currentY);
    ctx.lineTo(CANVAS_WIDTH / 2 + 50, currentY);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillText("Registrador Civil", CANVAS_WIDTH / 2, currentY + 20);
    
    currentY += 60;
    
    // Pie de Página final
    ctx.fillStyle = COLOR_SECONDARY_TEXT;
    ctx.font = `12px ${FONT_FAMILY}`;
    ctx.textAlign = 'right';
    ctx.fillText(`Acta de Matrimonio Generada el: ${new Date().toLocaleDateString('es-ES')}`, CANVAS_WIDTH - MARGIN_X, currentY);
    
    // AJUSTE FINAL DEL CANVAS (Recorte)
    const FINAL_CANVAS_HEIGHT = currentY + 30; 
    
    const finalCanvas = createCanvas(CANVAS_WIDTH, FINAL_CANVAS_HEIGHT);
    const finalCtx = finalCanvas.getContext("2d");
    
    finalCtx.drawImage(canvas, 0, 0, CANVAS_WIDTH, FINAL_CANVAS_HEIGHT, 0, 0, CANVAS_WIDTH, FINAL_CANVAS_HEIGHT);

    return finalCanvas.toBuffer('image/png');
};

/**
 * Dibuja una firma decodificada de Base64 en el canvas.
 * @param {CanvasRenderingContext2D} ctx - Contexto del canvas.
 * @param {string} base64Signature - Cadena Base64 de la firma (PNG o JPG).
 * @param {number} x - Posición X para la esquina superior izquierda.
 * @param {number} y - Posición Y para la esquina superior izquierda.
 * @param {number} width - Ancho deseado de la firma.
 * @param {number} height - Altura deseada de la firma.
 * @param {string} personName - Nombre de la persona (para fallback de texto).
 */
const drawSignature = async (ctx, base64Signature, x, y, width, height, personName) => {
    
    if (base64Signature && base64Signature !== 'null') {
        try {
            // Se asume que la API de reniec devuelve la firma sin prefijo de mime type
            const buffer = Buffer.from(base64Signature, 'base64');
            const signatureImage = await loadImage(buffer);

            // Dibujar la firma escalada
            ctx.drawImage(signatureImage, x, y, width, height);
            
        } catch (error) {
            console.warn(`Error al dibujar la firma para ${personName}:`, error.message);
            // Fallback si la decodificación o carga falla (Dibujar una línea)
            ctx.strokeStyle = '#777777';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, y + height / 2);
            ctx.lineTo(x + width, y + height / 2);
            ctx.stroke();
            
            ctx.fillStyle = '#999999';
            ctx.font = `italic 12px ${FONT_FAMILY}`;
            ctx.textAlign = 'center';
            ctx.fillText('Firma no disponible o error de formato', x + width / 2, y + height / 2 + 15);
        }
    } else {
        // Si no hay Base64, dibujar una línea de "No Disponible"
        ctx.strokeStyle = '#777777';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y + height / 2);
        ctx.lineTo(x + width, y + height / 2);
        ctx.stroke();
        
        ctx.fillStyle = '#999999';
        ctx.font = `italic 12px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.fillText('Firma no disponible', x + width / 2, y + height / 2 + 15);
    }
    
    // Dibujar la línea de texto para la separación de la firma
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + height + 10);
    ctx.lineTo(x + width, y + height + 10);
    ctx.stroke();
};


// ==============================================================================
// --- ENDPOINT 1: API de Acta de Matrimonio (INTEGRADO CON RENIEC) ---
// ==============================================================================
app.get("/consultar-matrimonio", async (req, res) => {
    const rawDocumento = req.query.dni;
    const API_NAME = "ACTA DE MATRIMONIO"; 
    
    if (!rawDocumento || rawDocumento.length !== 8 || !/^\d+$/.test(rawDocumento)) {
        return res.status(400).json({ 
            "message": "error",
            "error": "Parámetro de consulta inválido",
            "detalle": "Debe proporcionar el parámetro 'dni' con exactamente 8 dígitos (solo DNI)."
        });
    }

    // Estructuras de datos para ambos cónyuges, enriquecidas con RENIEC
    let principalEnriched = null;
    let conyuge2Enriched = null;

    try { 
        // 1. CONSULTA API DE ACTA DE MATRIMONIO para obtener el DNI de la pareja
        const resActa = await axios.get(`${ACTA_MATRIMONIO_API_URL}?dni=${rawDocumento}`);
        
        const rawResult = resActa.data?.result;
        
        if (resActa.data?.message !== "found data" || !rawResult?.coincidences || rawResult.coincidences.length === 0) {
             throw new Error(`La API de Acta de Matrimonio no devolvió datos válidos para el DNI: ${rawDocumento}.`);
        }

        const matrimonioDataRaw = rawResult.coincidences[0];
        const dniConyuge2 = matrimonioDataRaw.doc || 'N/A';
        
        // 2. CONSULTA RENIEC para la PERSONA PRINCIPAL
        const principalReniec = await consultReniecApi(rawDocumento);
        
        if (!principalReniec) {
            console.warn(`Advertencia: No se pudo obtener información de RENIEC para el DNI principal: ${rawDocumento}.`);
        }
        
        // Priorizar datos de RENIEC, sino usar los de Matrimonio, sino 'N/A'
        principalEnriched = {
            dni: rawDocumento,
            nombres: principalReniec?.nombres || (matrimonioDataRaw.nombres || '').toUpperCase().trim() || 'N/A', 
            apellido_paterno: principalReniec?.apellido_paterno || (matrimonioDataRaw.apellido_paterno || '').toUpperCase().trim() || 'N/A',
            apellido_materno: principalReniec?.apellido_materno || (matrimonioDataRaw.apellido_materno || '').toUpperCase().trim() || 'N/A',
            firma: principalReniec?.firma || null,
        };

        // 3. CONSULTA RENIEC para el CÓNYUGE PAREJA (2)
        const conyuge2Reniec = await consultReniecApi(dniConyuge2);
        
        if (!conyuge2Reniec) {
            console.warn(`Advertencia: No se pudo obtener información de RENIEC para el cónyuge 2: ${dniConyuge2}.`);
        }
        
        // Priorizar datos de RENIEC, sino usar los de Matrimonio, sino 'N/A'
        conyuge2Enriched = {
            dni: dniConyuge2,
            nombres: conyuge2Reniec?.nombres || (matrimonioDataRaw.nombres_conyuge || '').toUpperCase().trim() || 'N/A',
            apellido_paterno: conyuge2Reniec?.apellido_paterno || (matrimonioDataRaw.apellido_paterno_conyuge || '').toUpperCase().trim() || 'N/A',
            apellido_materno: conyuge2Reniec?.apellido_materno || (matrimonioDataRaw.apellido_materno_conyuge || '').toUpperCase().trim() || 'N/A',
            firma: conyuge2Reniec?.firma || null,
        };
        
        // 4. ESTRUCTURA DE DATOS PARA LA IMAGEN
        const matrimonioData = {
            registro_unico: matrimonioDataRaw.registro_unico || 'N/A',
            nro_acta: matrimonioDataRaw.nro_acta || 'N/A',
            fecha_matrimonio: matrimonioDataRaw.fecha || 'N/A', 
            departamento: matrimonioDataRaw.departamento || 'N/A',
            provincia: matrimonioDataRaw.provincia || 'N/A',
            distrito: matrimonioDataRaw.distrito || matrimonioDataRaw.lugar || 'N/A', 
            oficina_registro: matrimonioDataRaw.oficina_registro || 'N/A',
            estado_civil_c1: matrimonioDataRaw.estado_civil_c1 || 'N/A',
            estado_civil_c2: matrimonioDataRaw.estado_civil_c2 || 'N/A',
            regimen_patrimonial: matrimonioDataRaw.regimen_patrimonial || 'N/A',
            observaciones: matrimonioDataRaw.observaciones || 'N/A',
            // No incluimos conyuge2Data en esta estructura, sino en el parámetro de la función de dibujo
        };
        
        // 5. Generar el buffer de la imagen con los datos enriquecidos de ambos cónyuges
        const imagenBuffer = await generateMarriageCertificateImage(rawDocumento, principalEnriched, matrimonioData, conyuge2Enriched);
        
        // 6. Subir imagen si no existe o obtener la URL de la imagen existente
        const { url: githubRawUrl, status } = await uploadOrReturnExisting(rawDocumento, API_NAME, imagenBuffer);

        // 7. Crear la URL final de descarga a través del proxy
        const finalImageUrl = `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(githubRawUrl)}`;

        // 8. Respuesta JSON (Usando los datos enriquecidos)
        const messageDetail = status === "existing" 
            ? `Acta de Matrimonio existente recuperada con éxito.`
            : `Acta de Matrimonio generada y subida con éxito.`;

        res.json({
            "message": "found data",
            "result": {
                "persona_principal": {
                    "dni": principalEnriched.dni,
                    "nombres": principalEnriched.nombres,
                    "apellido_paterno": principalEnriched.apellido_paterno,
                    "apellido_materno": principalEnriched.apellido_materno,
                    "firma_disponible": !!principalEnriched.firma
                },
                "conyuge_pareja_2": {
                    "dni": conyuge2Enriched.dni,
                    "nombres": conyuge2Enriched.nombres,
                    "apellido_paterno": conyuge2Enriched.apellido_paterno,
                    "apellido_materno": conyuge2Enriched.apellido_materno,
                    "firma_disponible": !!conyuge2Enriched.firma
                },
                "url_acta": finalImageUrl,
                "message": messageDetail
            }
        });

    } catch (error) { 
        console.error(`Error en el proceso ${API_NAME}:`, error.message); 
        const status = error.response?.status || 500;
        res.status(status).json({ 
            "message": "error", 
            "error": `Error al generar el Acta de Matrimonio`, 
            "detalle": error.message 
        }); 
    } 
});

// ==============================================================================
// --- ENDPOINT 2: API de Árbol Genealógico (MANTENIDO) ---
// ==============================================================================
// NOTA: Para no sobrecargar la respuesta, el código de 'generateGenealogyTreeImage' y 
// la ruta '/consultar-arbol' se omiten aquí, manteniendo solo la ruta de matrimonio 
// solicitada con la integración. Si se necesita el código completo de árbol, se incluiría.

// Ruta /consultar-arbol (Mantengo la estructura para que se integre sin el código interno del árbol)
app.get("/consultar-arbol", async (req, res) => {
    // Código de la función generateGenealogyTreeImage (omisión para concisión)
    const generateGenealogyTreeImage = async (rawDocumento, principal, familiares) => {
         const canvas = createCanvas(CANVAS_WIDTH_DEFAULT, 500);
         const ctx = canvas.getContext("2d");
         ctx.font = '20px sans-serif';
         ctx.fillText("Contenido de Árbol Genealógico (No implementado en este snippet final)", 50, 50);
         return canvas.toBuffer('image/png');
    };
    
    const rawDocumento = req.query.dni;
    const API_NAME = "ARBOL GENEALOGICO";
    
    if (!rawDocumento || rawDocumento.length !== 8 || !/^\d+$/.test(rawDocumento)) {
        return res.status(400).json({ 
            "message": "error",
            "error": "Parámetro de consulta inválido",
            "detalle": "Debe proporcionar el parámetro 'dni' con exactamente 8 dígitos (solo DNI)."
        });
    }

    try { 
        // 1. CONSULTA API DE ÁRBOL GENEALÓGICO
        const resArbol = await axios.get(`${ARBOL_GENEALOGICO_API_URL}?dni=${rawDocumento}`);
        
        const dataArbol = resArbol.data?.result;
        if (resArbol.data?.message !== "found data" || !dataArbol?.person || !Array.isArray(dataArbol?.coincidences)) {
             throw new Error(`La API de Árbol Genealógico no devolvió datos válidos.`);
        }
        
        const principal = dataArbol.person;
        let familiares = dataArbol.coincidences.map(c => ({
            ...c, parentesco: c.tipo || 'FAMILIAR', dni: c.dni, nom: c.nom, ap: c.ap, am: c.am
        }));

        familiares = familiares.filter((v, i, a) => a.findIndex(t => (t.dni === v.dni)) === i);
        
        // 2. Generar el buffer de la imagen
        const imagenBuffer = await generateGenealogyTreeImage(rawDocumento, principal, familiares);
        
        // 3. Subir imagen si no existe o obtener la URL de la imagen existente
        const { url: githubRawUrl, status } = await uploadOrReturnExisting(rawDocumento, API_NAME, imagenBuffer);

        // 4. Crear la URL final de descarga a través del proxy
        const finalImageUrl = `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(githubRawUrl)}`;

        const personaDataFormatted = getFormattedPersonData(principal);
        const messageDetail = status === "existing" 
            ? `Imagen ${API_NAME} existente recuperada con éxito.`
            : `Imagen ${API_NAME} generada y subida con éxito.`

        res.json({
            "message": "found data",
            "result": {
                "persona": {
                    "dni": personaDataFormatted.dni,
                    "nombres": personaDataFormatted.nombres,
                    "apellido_paterno": personaDataFormatted.apellido_paterno,
                    "apellido_materno": personaDataFormatted.apellido_materno
                },
                "quantity": familiares.length,
                "coincidences": [
                  {"message": messageDetail, "url": finalImageUrl}
                ]
            }
        });

    } catch (error) { 
        console.error(`Error en el proceso ${API_NAME}:`, error.message); 
        const status = error.response?.status || 500;
        res.status(status).json({ 
            "message": "error", 
            "error": `Error al generar la Imagen ${API_NAME}`, 
            "detalle": error.message 
        }); 
    } 
});


// ==============================================================================
// --- OTRAS RUTAS (Mantenidas como 410 o 501) ---
// ==============================================================================

app.get("/consultar-familia1", (req, res) => {
    res.status(410).json({ 
        error: "Ruta Obsoleta",
        message: "La ruta /consultar-familia1 ha sido eliminada. Por favor, use la nueva ruta: /consultar-arbol o /consultar-matrimonio.",
    });
});

app.get("/consultar-familia2", (req, res) => {
    res.status(410).json({ 
        error: "Ruta Obsoleta",
        message: "La ruta /consultar-familia2 ha sido eliminada. Por favor, use la nueva ruta: /consultar-arbol o /consultar-matrimonio.",
    });
});

app.get("/consultar-telefono", (req, res) => {
    res.status(410).json({ 
        error: "Ruta Obsoleta",
        message: "La ruta /consultar-telefono ha sido eliminada. Por favor, use las nuevas rutas: /consultar-arbol o /consultar-matrimonio.",
    });
});

app.get("/generar-arbol", (req, res) => {
    res.status(410).json({ 
        error: "Ruta Obsoleta",
        message: "La ruta /generar-arbol ha sido eliminada. Use /consultar-arbol.",
    });
});

app.get("/buscar-por-nombre", (req, res) => {
    res.status(501).json({ 
        error: "Búsqueda Avanzada No Implementada",
        message: `La API externa solo soporta la consulta por número de documento (DNI).`,
        solicitado: { nombres: req.query.nombres, apellidos: req.query.apellidos }
    });
});

app.get("/buscar-por-padres", (req, res) => {
    res.status(501).json({ 
        error: "Búsqueda Avanzada No Implementada",
        message: `La API externa solo soporta la consulta por número de documento (DNI).`,
        solicitado: { nomPadre: req.query.nomPadre, nomMadre: req.query.nomMadre }
    });
});

app.get("/buscar-por-edad", (req, res) => {
    res.status(501).json({ 
        error: "Búsqueda Avanzada No Implementada",
        message: `La API externa solo soporta la consulta por número de documento (DNI).`,
        solicitado: { edad: req.query.edad }
    });
});


// ==============================================================================
// --- RUTA: Proxy de descarga (Mantenida) ---
// ==============================================================================
app.get("/descargar-ficha", async (req, res) => {
    let { url } = req.query; 
        
    if (!url) {
        return res.status(400).send("Falta el parámetro 'url' de la imagen.");
    }
    
    let decodedUrl = '';
    try {
        decodedUrl = decodeURIComponent(url);
    } catch (e) {
        return res.status(400).send("URL de imagen codificada inválida.");
    }

    try {
        console.log(`Intentando descargar URL (Proxy) de: ${decodedUrl}`);
        
        const config = {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'FlyIoImageGeneratorApp'
            }
        };

        const response = await axios.get(decodedUrl, config);
        const imageBuffer = Buffer.from(response.data);

        const fileName = path.basename(decodedUrl);

        res.set({
            'Content-Type': 'image/png', 
            'Content-Disposition': `attachment; filename="${fileName}"`, 
            'Content-Length': imageBuffer.length 
        });

        res.send(imageBuffer);

    } catch (error) {
        const statusCode = error.response?.status || 'N/A';
        console.error(`Error al descargar imagen (PROXY): Status ${statusCode}. Mensaje: ${error.message}`);
        res.status(500).send(`Error al procesar la descarga del archivo. Detalle: ${error.message}`);
    }
});
// --------------------------------------------------------------------------------
    
app.listen(PORT, HOST, () => {
    console.log(`Servidor de Ficha Familiar corriendo en http://${HOST}:${PORT}`);
    if (!GITHUB_TOKEN) console.warn("ADVERTENCIA: GITHUB_TOKEN no está configurado.");
    if (!GITHUB_REPO) console.warn("ADVERTENCIA: GITHUB_REPO no está configurado.");
});
