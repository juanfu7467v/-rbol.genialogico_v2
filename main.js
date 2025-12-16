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
const HOST = "0.0.00";

// AGREGADO: Habilitar CORS para todas las rutas y orígenes
app.use(cors()); 

// Definir la URL base pública si no se proporciona
const API_BASE_URL = process.env.API_BASE_URL || "https://consulta-pe-imagenes-v2.fly.dev";

// -----------------------------------------------------------
// --- NUEVAS URLs de las APIs ---
// -----------------------------------------------------------
// 1. API de Árbol Genealógico
const ARBOL_GENEALOGICO_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/arbol"; 
// 2. API de Acta de Matrimonio
const ACTA_MATRIMONIO_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/matrimonios"; 

// --- Configuración de GitHub ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = "main";

// --- Constantes de Diseño Generales (Ajustadas para el diseño de la imagen subida) ---
const CANVAS_WIDTH_DEFAULT = 800; // Ancho más estándar para un documento
const MARGIN = 40;
const FONT_FAMILY = "sans-serif"; // Mantenemos sans-serif que se parece a la imagen
const COLOR_TITLE = '#000000';
const COLOR_TEXT = '#000000';
const COLOR_SECONDARY_TEXT = '#333333';
const FALLBACK_PHOTO_URL = "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEh4p_jX8U0kG7R8tD9K0h0bVv7V9jE_s2O_jJ4_X5kZ0X9qL_n9jX5Q6g8Q/s512/placeholder.png"; 

// Colores específicos del diseño de la imagen subida
const BACKGROUND_COLOR = '#FFFFFF';
const HEADER_BACKGROUND_COLOR = '#F0F0F0'; // Gris claro
const TABLE_BORDER_COLOR = '#CCCCCC'; // Borde claro
const TABLE_HEADER_COLOR = '#333333'; // Color de fuente oscuro para encabezados

// ==============================================================================
//  FUNCIONES DE UTILIDAD
// ==============================================================================

/**
 * Mapeo de nombres de API a una clave corta y segura para el nombre del archivo.
 * @type {Object<string, string>}
 */
const API_TYPE_MAP = {
    "ARBOL GENEALOGICO": "ARBOL",
    "ACTA DE MATRIMONIO": "MATRIMONIO", // Cambiado para reflejar el requisito
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
 * Función para generar un color de fondo para el avatar de fallback basado en el DNI.
 */
const generateColorFromDni = (dni) => {
    if (!dni) return '#333333';
    // Generar un hash SHA256 del DNI y tomar los primeros 6 caracteres para el color
    const hash = crypto.createHash('sha256').update(dni.toString()).digest('hex').substring(0, 6);
    return `#${hash}`;
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
    // Construir la URL RAW de GitHub que se usará para la descarga
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
        // Ignorar 404, significa que el archivo es nuevo
        if (error.response?.status !== 404) {
             console.error(`Error al verificar SHA para subir a GitHub: ${error.message}`);
        }
    }

    await axios.put(apiUrl, data, config);
    return publicUrl;
};

/**
 * NUEVO: Comprueba si ya existe una imagen para el DNI y tipo de API.
 * Retorna la URL raw si existe, o null si no.
 */
const checkIfImageExists = async (dni, apiType) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        console.warn("ADVERTENCIA: GITHUB_TOKEN o GITHUB_REPO no están definidos para la verificación.");
        return null;
    }

    const [owner, repo] = GITHUB_REPO.split('/');
    if (!owner || !repo) return null;
    
    // Nombre del archivo a buscar sin UUID
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

        // Buscar el archivo con el nombre exacto (sin UUID)
        const existingFile = files.find(file => file.type === 'file' && file.name.toLowerCase() === targetFileName);

        if (existingFile) {
            console.log(`✅ Imagen existente encontrada para DNI: ${dni} (${apiType}).`);
            // Devolver la URL raw para la descarga
            return `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/${filePathPrefix}${existingFile.name}`;
        }

        return null;

    } catch (error) {
        // 404 significa que la carpeta 'public' no existe o que no hay contenido, lo cual es normal.
        if (error.response?.status !== 404) {
             console.error(`Error al verificar existencia de imagen en GitHub (status ${error.response?.status}):`, error.message);
        }
        return null;
    }
};

/**
 * NUEVO: Sube la imagen si no existe, o retorna la URL de la imagen existente.
 */
const uploadOrReturnExisting = async (dni, apiName, imageBuffer) => {
    const apiTypeKey = API_TYPE_MAP[apiName] || 'DESCONOCIDO';
    const messagePrefix = apiName.includes("MATRIMONIO") ? "feat: Matrimonios" : "feat: Árbol Genealógico";
    
    // 1. Verificar si la imagen ya existe
    const existingUrl = await checkIfImageExists(dni, apiTypeKey);

    if (existingUrl) {
        // La imagen existe, retornamos la URL existente
        return { 
            url: existingUrl, 
            status: "existing" 
        };
    }

    // 2. Si no existe, generamos el nombre de archivo definitivo (sin UUID) y subimos
    const fileName = `${dni}_${apiTypeKey}.png`.toLowerCase();
    console.log(`⬆️ Subiendo nueva imagen: ${fileName}`);
    const newUrl = await uploadToGitHub(fileName, imageBuffer, messagePrefix);
    
    return { 
        url: newUrl, 
        status: "new" 
    };
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
        };
    }

    const nombres = (data.nombres || data.preNombres || '').toUpperCase().trim();
    // Intenta con ape_pat/ape_mat o apePaterno/apeMaterno
    const apellidoPaterno = (data.apellido_paterno || data.ape_pat || data.apePaterno || '').toUpperCase().trim();
    const apellidoMaterno = (data.apellido_materno || data.ape_mat || data.apeMaterno || '').toUpperCase().trim();

    return {
        dni: data.dni || data.nuDni || 'N/A',
        nombres,
        apellido_paterno: apellidoPaterno,
        apellido_materno: apellidoMaterno,
    };
};


// ==============================================================================
//  FUNCIONES DE DIBUJO (ÁRBOL GENEALÓGICO)
// ==============================================================================

// Constantes de diseño para el árbol
const TREE_NODE_WIDTH = 250;
const TREE_NODE_HEIGHT = 100;
const HORIZONTAL_SPACING = 50; 
const VERTICAL_SPACING = 80;

/**
 * Dibuja un nodo (caja) en el Árbol Genealógico.
 */
const drawTreeNode = (ctx, data, x, y, isPrincipal, type = 'Familiar') => {
    
    // 1. Dibuja la Caja de Fondo
    const boxColor = isPrincipal ? '#D32F2F' : (type === 'Padre' || type === 'Madre' ? '#00796B' : '#1976D2'); // Rojo (Principal), Verde (Padres), Azul (Otros)
    const textColor = '#FFFFFF';
    const borderColor = '#CCCCCC';

    // Caja con bordes redondeados
    const radius = 10;
    ctx.fillStyle = boxColor;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + TREE_NODE_WIDTH - radius, y);
    ctx.arcTo(x + TREE_NODE_WIDTH, y, x + TREE_NODE_WIDTH, y + radius, radius);
    ctx.lineTo(x + TREE_NODE_WIDTH, y + TREE_NODE_HEIGHT - radius);
    ctx.arcTo(x + TREE_NODE_WIDTH, y + TREE_NODE_HEIGHT, x + TREE_NODE_WIDTH - radius, y + TREE_NODE_HEIGHT, radius);
    ctx.lineTo(x + radius, y + TREE_NODE_HEIGHT);
    ctx.arcTo(x, y + TREE_NODE_HEIGHT, x, y + TREE_NODE_HEIGHT - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
    ctx.fill();
    
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 2. Dibujar Texto
    const formattedData = getFormattedPersonData(data);
    const fullName = `${formattedData.nombres} ${formattedData.apellido_paterno} ${formattedData.apellido_materno}`.trim();
    const parentescoText = isPrincipal ? 'PRINCIPAL' : (data.parentesco || type).toUpperCase().replace('N/A', 'FAMILIAR');

    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    
    // Parentesco
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    ctx.fillText(parentescoText, x + TREE_NODE_WIDTH / 2, y + 25);
    
    // Nombre
    ctx.font = `bold 18px ${FONT_FAMILY}`;
    // Ajustar el texto si es muy largo
    const nameText = ctx.measureText(fullName).width > (TREE_NODE_WIDTH - 20) 
        ? fullName.substring(0, 18) + '...' 
        : fullName;
    ctx.fillText(nameText, x + TREE_NODE_WIDTH / 2, y + 55);
    
    // DNI
    ctx.font = `14px ${FONT_FAMILY}`;
    ctx.fillText(`DNI: ${formattedData.dni}`, x + TREE_NODE_WIDTH / 2, y + 80);
    
    // Retorna el centro del nodo para las conexiones
    return {
        centerX: x + TREE_NODE_WIDTH / 2,
        centerY: y + TREE_NODE_HEIGHT / 2,
        bottomY: y + TREE_NODE_HEIGHT,
        topY: y,
    };
};

/**
 * Genera la imagen del Árbol Genealógico.
 */
const generateGenealogyTreeImage = async (rawDocumento, principal, familiares) => {
    
    const API_NAME = "ÁRBOL GENEALÓGICO";
    const HEADER_HEIGHT = 80;
    const FOOTER_HEIGHT = 50;

    // --- 1. PROCESAMIENTO Y AGRUPAMIENTO DE NODOS ---
    const nodes = {
        principal: principal,
        padres: familiares.filter(f => f.parentesco?.toUpperCase().includes('PADRE') || f.parentesco?.toUpperCase().includes('MADRE')),
        hermanos: familiares.filter(f => f.parentesco?.toUpperCase().includes('HERMANO') || f.parentesco?.toUpperCase().includes('HERMANA')),
        hijos: familiares.filter(f => f.parentesco?.toUpperCase().includes('HIJO') || f.parentesco?.toUpperCase().includes('HIJA')),
        otros: familiares.filter(f => !f.parentesco?.toUpperCase().includes('PADRE') && !f.parentesco?.toUpperCase().includes('MADRE') && !f.parentesco?.toUpperCase().includes('HERMANO') && !f.parentesco?.toUpperCase().includes('HERMANA') && !f.parentesco?.toUpperCase().includes('HIJO') && !f.parentesco?.toUpperCase().includes('HIJA')),
    };
    
    // Determinar la altura de cada capa
    const maxNodesInRow = Math.max(nodes.padres.length, nodes.hermanos.length, nodes.hijos.length, nodes.otros.length, 2);
    const numRows = (nodes.padres.length > 0 ? 1 : 0) + 1 + (nodes.hermanos.length > 0 ? 1 : 0) + (nodes.hijos.length > 0 ? 1 : 0) + (nodes.otros.length > 0 ? 1 : 0);
    
    // Calculo dinámico de Ancho
    const totalNodeWidth = maxNodesInRow * TREE_NODE_WIDTH;
    const totalSpacing = (maxNodesInRow - 1) * HORIZONTAL_SPACING;
    const canvasContentWidth = totalNodeWidth + totalSpacing;
    const CANVAS_WIDTH = Math.max(canvasContentWidth + MARGIN * 2, CANVAS_WIDTH_DEFAULT); // Asegurar ancho mínimo
    
    // Calculo dinámico de Altura
    const rowsHeight = numRows * TREE_NODE_HEIGHT;
    const rowsSpacing = (numRows - 1) * VERTICAL_SPACING;
    const CANVAS_HEIGHT = HEADER_HEIGHT + MARGIN * 2 + rowsHeight + rowsSpacing + FOOTER_HEIGHT;

    // --- 2. GENERACIÓN DEL CANVAS ---
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext("2d");

    // Fondo
    ctx.fillStyle = '#EFEBE9'; // Fondo claro simulando pergamino
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Título
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `bold 24px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${API_NAME} - DNI: ${rawDocumento}`, CANVAS_WIDTH / 2, MARGIN + 25);
    ctx.font = `18px ${FONT_FAMILY}`;
    ctx.fillText(`Total de Familiares Encontrados: ${familiares.length}`, CANVAS_WIDTH / 2, MARGIN + 55);
    
    let currentY = MARGIN + HEADER_HEIGHT;
    let currentCategory = 0; // 0: Padres, 1: Principal/Hermanos, 2: Hijos, 3: Otros
    
    const nodeCenters = {
        principal: null,
        padres: [],
        hermanos: [],
        hijos: [],
        otros: [],
    };
    
    const offsetX = (CANVAS_WIDTH - canvasContentWidth) / 2;
    const lineThickness = 3;

    // --- 3. DIBUJO DE NODOS POR CAPA (DE ARRIBA A ABAJO) ---
    
    // --- Capa 1: Padres (Si existen) ---
    if (nodes.padres.length > 0) {
        const rowWidth = nodes.padres.length * TREE_NODE_WIDTH + (nodes.padres.length - 1) * HORIZONTAL_SPACING;
        let startX = (CANVAS_WIDTH - rowWidth) / 2;
        
        nodes.padres.forEach(f => {
            const node = drawTreeNode(ctx, f, startX, currentY, false, f.parentesco);
            nodeCenters.padres.push(node);
            startX += TREE_NODE_WIDTH + HORIZONTAL_SPACING;
        });
        currentY += TREE_NODE_HEIGHT + VERTICAL_SPACING;
    }
    
    // --- Capa 2: Principal y Hermanos ---
    const principalAndSiblings = [principal, ...nodes.hermanos];
    const rowWidth = principalAndSiblings.length * TREE_NODE_WIDTH + (principalAndSiblings.length - 1) * HORIZONTAL_SPACING;
    let startX = (CANVAS_WIDTH - rowWidth) / 2;
    
    principalAndSiblings.forEach((p, index) => {
        const isPrincipal = index === 0;
        const type = isPrincipal ? 'Principal' : p.parentesco;
        const node = drawTreeNode(ctx, p, startX, currentY, isPrincipal, type);
        if (isPrincipal) {
            nodeCenters.principal = node;
        } else {
            nodeCenters.hermanos.push(node);
        }
        startX += TREE_NODE_WIDTH + HORIZONTAL_SPACING;
    });
    
    const principalRowCenterY = nodeCenters.principal.centerY;
    
    // --- Conexión: Padres -> Principal/Hermanos ---
    if (nodeCenters.padres.length > 0) {
        // Línea vertical que baja desde el punto medio de los padres
        const parentMiddleX = nodeCenters.padres[0].centerX + (nodeCenters.padres[nodeCenters.padres.length - 1].centerX - nodeCenters.padres[0].centerX) / 2;
        const principalMiddleX = nodeCenters.principal.centerX; // Usamos el centro del principal como punto de referencia
        
        ctx.strokeStyle = '#6D4C41'; // Marrón oscuro para el tronco
        ctx.lineWidth = lineThickness;
        
        // Conexión Horizontal de Padres
        ctx.beginPath();
        nodeCenters.padres.forEach((p, index) => {
            // Conexión vertical de cada padre a la línea horizontal
            ctx.moveTo(p.centerX, p.bottomY);
            ctx.lineTo(p.centerX, p.bottomY + VERTICAL_SPACING / 2 - 10);
            
            // Punto de intersección
            ctx.arc(p.centerX, p.bottomY + VERTICAL_SPACING / 2 - 10, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#6D4C41';
            ctx.fill();
        });
        
        // Línea horizontal de unión (no es un tronco formal, sino una rama de unión)
        const branchY = nodeCenters.padres[0].bottomY + VERTICAL_SPACING / 2 - 10;
        ctx.moveTo(nodeCenters.padres[0].centerX, branchY);
        ctx.lineTo(nodeCenters.padres[nodeCenters.padres.length - 1].centerX, branchY);
        ctx.stroke();

        // Línea vertical principal que baja hasta el principal/hermanos
        ctx.beginPath();
        ctx.moveTo(principalMiddleX, branchY);
        ctx.lineTo(principalMiddleX, nodeCenters.principal.topY);
        ctx.stroke();

        // Conexión al nodo principal
        ctx.beginPath();
        ctx.moveTo(principalMiddleX, nodeCenters.principal.centerY);
        ctx.lineTo(nodeCenters.principal.topY, principalMiddleX, nodeCenters.principal.centerY);
    }
    
    // Conexión Horizontal entre Hermanos y Principal
    ctx.strokeStyle = '#6D4C41'; 
    ctx.lineWidth = lineThickness;
    const siblingBranchY = principalRowCenterY + TREE_NODE_HEIGHT / 2 + 10;
    
    if (nodeCenters.hermanos.length > 0) {
        const allNodes = [nodeCenters.principal, ...nodeCenters.hermanos];
        const minX = Math.min(...allNodes.map(n => n.centerX));
        const maxX = Math.max(...allNodes.map(n => n.centerX));

        // Dibuja la línea horizontal de unión de hermanos
        ctx.beginPath();
        ctx.moveTo(minX, siblingBranchY);
        ctx.lineTo(maxX, siblingBranchY);
        ctx.stroke();

        // Conexiones verticales a cada nodo (Principal y Hermanos)
        allNodes.forEach(n => {
            ctx.beginPath();
            ctx.moveTo(n.centerX, n.bottomY);
            ctx.lineTo(n.centerX, siblingBranchY);
            ctx.stroke();
            // Punto de intersección
            ctx.arc(n.centerX, siblingBranchY, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#6D4C41';
            ctx.fill();
        });
    }

    currentY += TREE_NODE_HEIGHT + VERTICAL_SPACING;

    // --- Capa 3: Hijos (Si existen) ---
    if (nodes.hijos.length > 0) {
        const rowWidth = nodes.hijos.length * TREE_NODE_WIDTH + (nodes.hijos.length - 1) * HORIZONTAL_SPACING;
        let startX = (CANVAS_WIDTH - rowWidth) / 2;
        
        // Conexión: Principal -> Hijos (Línea Vertical Troncal)
        ctx.strokeStyle = '#6D4C41'; 
        ctx.lineWidth = lineThickness;
        ctx.beginPath();
        ctx.moveTo(nodeCenters.principal.centerX, nodeCenters.principal.bottomY);
        ctx.lineTo(nodeCenters.principal.centerX, currentY); // Línea hasta la fila de hijos
        ctx.stroke();
        
        // Dibujo de nodos de Hijos
        const childrenCenters = [];
        nodes.hijos.forEach(f => {
            const node = drawTreeNode(ctx, f, startX, currentY, false, f.parentesco);
            childrenCenters.push(node);
            startX += TREE_NODE_WIDTH + HORIZONTAL_SPACING;
        });
        nodeCenters.hijos = childrenCenters;

        // Conexión Horizontal de Hijos
        if (childrenCenters.length > 0) {
            const minX = Math.min(...childrenCenters.map(n => n.centerX));
            const maxX = Math.max(...childrenCenters.map(n => n.centerX));
            
            // Línea horizontal de unión
            const childrenBranchY = currentY - 10;
            ctx.beginPath();
            ctx.moveTo(minX, childrenBranchY);
            ctx.lineTo(maxX, childrenBranchY);
            ctx.stroke();
            
            // Conexiones verticales a cada nodo hijo
            childrenCenters.forEach(n => {
                ctx.beginPath();
                ctx.moveTo(n.centerX, n.topY);
                ctx.lineTo(n.centerX, childrenBranchY);
                ctx.stroke();
                // Punto de intersección
                ctx.arc(n.centerX, childrenBranchY, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#6D4C41';
                ctx.fill();
            });
            
            // Conexión de la línea troncal a la línea horizontal
            ctx.beginPath();
            ctx.moveTo(nodeCenters.principal.centerX, childrenBranchY);
            ctx.lineTo(nodeCenters.principal.centerX, childrenBranchY);
            ctx.stroke();
        }
        
        currentY += TREE_NODE_HEIGHT + VERTICAL_SPACING;
    }
    
    // --- Capa 4: Otros (Si existen) ---
    if (nodes.otros.length > 0) {
        // DIBUJO DE LISTA SIMPLE (NO GENERA UN ÁRBOL, SINO UNA LISTA DE UN SÓLO NIVEL)
        const rowWidth = nodes.otros.length * TREE_NODE_WIDTH + (nodes.otros.length - 1) * HORIZONTAL_SPACING;
        let startX = (CANVAS_WIDTH - rowWidth) / 2;
        
        // Título de la sección
        ctx.fillStyle = COLOR_TITLE;
        ctx.font = `bold 20px ${FONT_FAMILY}`;
        ctx.fillText(`OTROS FAMILIARES RELACIONADOS (Lista)`, CANVAS_WIDTH / 2, currentY - VERTICAL_SPACING / 2);
        
        nodes.otros.forEach(f => {
            drawTreeNode(ctx, f, startX, currentY, false, f.parentesco);
            startX += TREE_NODE_WIDTH + HORIZONTAL_SPACING;
        });
        currentY += TREE_NODE_HEIGHT + VERTICAL_SPACING;
    }

    // Pie de Página
    const footerY = CANVAS_HEIGHT - FOOTER_HEIGHT + 20;
    ctx.fillStyle = COLOR_SECONDARY_TEXT;
    ctx.font = `14px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText(`Fuente: ${API_NAME}`, MARGIN, footerY);
    ctx.textAlign = 'right';
    ctx.fillText(`Generado el: ${new Date().toLocaleDateString('es-ES')}`, CANVAS_WIDTH - MARGIN, footerY);

    return canvas.toBuffer('image/png');
};

/**
 * Función auxiliar para dividir texto en líneas que caben dentro de un ancho máximo.
 * @param {CanvasRenderingContext2D} ctx - Contexto del canvas.
 * @param {string} text - Texto a envolver.
 * @param {number} maxWidth - Ancho máximo permitido para el texto.
 * @param {number} lineHeight - Altura de línea.
 * @returns {Array<{text: string, height: number}>} Lista de líneas con la altura total.
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
//  FUNCIONES DE DIBUJO (ACTA DE MATRIMONIO) - MODIFICADA
// ==============================================================================

/**
 * Dibuja la imagen del Acta de Matrimonio, imitando el diseño de la imagen subida.
 */
const generateMarriageCertificateImage = async (rawDocumento, principal, data) => {
    
    // --- CONSTANTES DE DISEÑO BASADAS EN LA IMAGEN SUBIDA ---
    const API_TITLE = "Acta";
    const API_SUBTITLE = "MATRIMONIO";
    const BRAND_NAME = "Consulta pe apk"; // MODIFICACIÓN: Nuevo texto de marca
    const CANVAS_WIDTH = 900; // Ajustado para un diseño de documento
    const CANVAS_HEIGHT = 1000;
    const MARGIN_X = 50;
    const MARGIN_Y = 50;
    const INNER_WIDTH = CANVAS_WIDTH - 2 * MARGIN_X;
    const CELL_PADDING = 15;
    const ROW_HEIGHT = 40;
    const LINE_HEIGHT = 18; // Altura base para el salto de línea
    const MIN_ROW_HEIGHT = 50; // Altura mínima de la fila para la tabla principal
    
    // 1. Generación del Canvas
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext("2d");

    // Fondo Blanco Puro
    ctx.fillStyle = BACKGROUND_COLOR; 
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // 2. Encabezado (Título y Logo - Simulado)
    let currentY = MARGIN_Y;
    
    // Título Principal
    ctx.fillStyle = COLOR_TITLE;
    ctx.textAlign = 'left';
    ctx.font = `bold 60px ${FONT_FAMILY}`;
    ctx.fillText(API_TITLE, MARGIN_X, currentY + 30);
    
    currentY += 40;
    ctx.font = `bold 30px ${FONT_FAMILY}`;
    ctx.fillText(API_SUBTITLE, MARGIN_X, currentY + 30);
    
    currentY += 50;

    // Logo (Texto a la derecha)
    ctx.textAlign = 'right';
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `bold 20px ${FONT_FAMILY}`;
    // MODIFICACIÓN: Reemplazo del logo y texto por "Consulta pe apk"
    ctx.fillText(BRAND_NAME, CANVAS_WIDTH - MARGIN_X, MARGIN_Y + 30); 

    // Línea separadora
    currentY = 120;
    
    // 3. SECCIÓN 1: Información (Matrimonio)
    currentY += 30;
    ctx.textAlign = 'left';
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `bold 24px ${FONT_FAMILY}`;
    ctx.fillText("Información", MARGIN_X, currentY);

    currentY += 10;
    
    // Datos de la sección Información
    const rawInfoData = [
        ["Fecha de Matrimonio", data.fecha_matrimonio || 'N/A', "Registro Único", data.registro_unico || 'N/A'],
        // Campos con posible salto de línea
        ["Oficina de Registro", data.oficina_registro || 'N/A', "Nro. de Acta", data.nro_acta || 'N/A'],
        ["Departamento", data.departamento || 'N/A', "Provincia", data.provincia || 'N/A'],
        ["Distrito", data.distrito || data.lugar || 'N/A', "Régimen Patrimonial", data.regimen_patrimonial || 'N/A']
    ];
    
    const infoCol1Width = 180;
    const infoCol2Width = INNER_WIDTH / 2 - infoCol1Width;
    const infoCol3Width = 180;
    const infoCol4Width = INNER_WIDTH / 2 - infoCol3Width;

    // Campos a los que se aplica el ajuste de texto y estiramiento de fila
    const wrapFieldsIndices = [1, 2, 3]; // Índice de las filas con texto largo: Oficina, Departamento, Distrito

    rawInfoData.forEach((row, rowIndex) => {
        let rowHeight = MIN_ROW_HEIGHT;
        let startY = currentY;

        // --- 1. PREPARACIÓN Y CÁLCULO DE ALTURA DE FILA ---
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        const shouldWrap = wrapFieldsIndices.includes(rowIndex);

        let wrappedCol2 = { lines: [String(row[1]).toUpperCase()], height: MIN_ROW_HEIGHT };
        let wrappedCol4 = { lines: [String(row[3]).toUpperCase()], height: MIN_ROW_HEIGHT };

        if (shouldWrap) {
            // Columna 2: Oficina de Registro, Departamento
            wrappedCol2 = wrapText(ctx, String(row[1]).toUpperCase(), infoCol2Width - 2 * CELL_PADDING, LINE_HEIGHT);
            // Columna 4: Nro. de Acta, Provincia
            wrappedCol4 = wrapText(ctx, String(row[3]).toUpperCase(), infoCol4Width - 2 * CELL_PADDING, LINE_HEIGHT);
            
            // La altura de la fila es determinada por el texto más largo + un padding de celda.
            const maxTextHeight = Math.max(wrappedCol2.height, wrappedCol4.height);
            rowHeight = Math.max(MIN_ROW_HEIGHT, maxTextHeight + 2 * (CELL_PADDING - 5));
        }

        // --- 2. DIBUJO DE LA FILA (FONDOS Y BORDES) ---
        
        // FONDOS
        // Columna 1 (Etiqueta 1)
        ctx.fillStyle = HEADER_BACKGROUND_COLOR;
        ctx.fillRect(MARGIN_X, startY, infoCol1Width, rowHeight);
        // Columna 2 (Valor 1)
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(MARGIN_X + infoCol1Width, startY, infoCol2Width, rowHeight);
        // Columna 3 (Etiqueta 2)
        ctx.fillStyle = HEADER_BACKGROUND_COLOR;
        ctx.fillRect(MARGIN_X + INNER_WIDTH / 2, startY, infoCol3Width, rowHeight);
        // Columna 4 (Valor 2)
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(MARGIN_X + INNER_WIDTH / 2 + infoCol3Width, startY, infoCol4Width, rowHeight);
        
        // BORDES
        ctx.strokeStyle = TABLE_BORDER_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(MARGIN_X, startY, INNER_WIDTH, rowHeight);
        // Bordes internos verticales
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

        // --- 3. DIBUJO DE TEXTO ---
        const textYCenterOffset = rowHeight / 2 + 5; // Centro vertical para texto de una línea

        // Columna 1 (Etiqueta 1)
        ctx.fillStyle = TABLE_HEADER_COLOR;
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText(row[0], MARGIN_X + CELL_PADDING, startY + textYCenterOffset);
        
        // Columna 3 (Etiqueta 2)
        ctx.fillStyle = TABLE_HEADER_COLOR;
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText(row[2], MARGIN_X + INNER_WIDTH / 2 + CELL_PADDING, startY + textYCenterOffset);

        // Columna 2 (Valor 1 - Ajuste de Texto)
        ctx.fillStyle = COLOR_TEXT;
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        let textY = startY + CELL_PADDING + 5;
        if (shouldWrap) {
            wrappedCol2.lines.forEach((line, i) => {
                ctx.fillText(line, MARGIN_X + infoCol1Width + CELL_PADDING, startY + (rowHeight / 2) - (wrappedCol2.height / 2) + (i * LINE_HEIGHT) + (LINE_HEIGHT/2) + 5);
            });
        } else {
            ctx.fillText(wrappedCol2.lines[0], MARGIN_X + infoCol1Width + CELL_PADDING, startY + textYCenterOffset);
        }
        
        // Columna 4 (Valor 2 - Ajuste de Texto)
        ctx.fillStyle = COLOR_TEXT;
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        if (shouldWrap) {
            wrappedCol4.lines.forEach((line, i) => {
                ctx.fillText(line, MARGIN_X + INNER_WIDTH / 2 + infoCol3Width + CELL_PADDING, startY + (rowHeight / 2) - (wrappedCol4.height / 2) + (i * LINE_HEIGHT) + (LINE_HEIGHT/2) + 5);
            });
        } else {
            ctx.fillText(wrappedCol4.lines[0], MARGIN_X + INNER_WIDTH / 2 + infoCol3Width + CELL_PADDING, startY + textYCenterOffset);
        }

        currentY += rowHeight;
    });
    
    // 4. SECCIÓN 2: Asistentes (Cónyuges y Observaciones)
    currentY += 30;
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `bold 24px ${FONT_FAMILY}`;
    ctx.fillText("Cónyuges y Testigos", MARGIN_X, currentY);

    currentY += 10;
    
    // Datos de los Cónyuges
    const conyuge1 = getFormattedPersonData(principal);
    const conyuge2 = getFormattedPersonData(data.conyuge || {});
    
    // Fila de encabezado
    currentY += 5;
    ctx.fillStyle = HEADER_BACKGROUND_COLOR;
    ctx.fillRect(MARGIN_X, currentY, INNER_WIDTH, ROW_HEIGHT);
    ctx.strokeStyle = TABLE_BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN_X, currentY, INNER_WIDTH, ROW_HEIGHT);
    ctx.beginPath();
    ctx.moveTo(MARGIN_X + INNER_WIDTH / 2, currentY);
    ctx.lineTo(MARGIN_X + INNER_WIDTH / 2, currentY + ROW_HEIGHT);
    ctx.stroke();
    
    ctx.fillStyle = TABLE_HEADER_COLOR;
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText("Rol", MARGIN_X + CELL_PADDING, currentY + ROW_HEIGHT / 2 + 5);
    ctx.fillText("Nombre Completo y DNI", MARGIN_X + INNER_WIDTH / 2 + CELL_PADDING, currentY + ROW_HEIGHT / 2 + 5);
    
    currentY += ROW_HEIGHT;

    const conyugeRows = [
        ["Cónyuge Principal (1)", `${conyuge1.nombres} ${conyuge1.apellido_paterno} ${conyuge1.apellido_materno} (DNI: ${conyuge1.dni})`],
        ["Cónyuge Pareja (2)", `${conyuge2.nombres} ${conyuge2.apellido_paterno} ${conyuge2.apellido_materno} (DNI: ${conyuge2.dni})`],
        ["Estado Civil Anterior C1", data.estado_civil_c1 || 'N/A'],
        ["Estado Civil Anterior C2", data.estado_civil_c2 || 'N/A']
    ];
    
    conyugeRows.forEach((row, index) => {
        const startY = currentY + index * ROW_HEIGHT;
        
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(MARGIN_X, startY, INNER_WIDTH / 2, ROW_HEIGHT);
        ctx.fillRect(MARGIN_X + INNER_WIDTH / 2, startY, INNER_WIDTH / 2, ROW_HEIGHT);
        ctx.strokeRect(MARGIN_X, startY, INNER_WIDTH, ROW_HEIGHT);
        ctx.beginPath();
        ctx.moveTo(MARGIN_X + INNER_WIDTH / 2, startY);
        ctx.lineTo(MARGIN_X + INNER_WIDTH / 2, startY + ROW_HEIGHT);
        ctx.stroke();
        
        ctx.fillStyle = COLOR_TEXT;
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText(row[0], MARGIN_X + CELL_PADDING, startY + ROW_HEIGHT / 2 + 5);
        ctx.fillText(String(row[1]).toUpperCase(), MARGIN_X + INNER_WIDTH / 2 + CELL_PADDING, startY + ROW_HEIGHT / 2 + 5);
    });

    currentY += conyugeRows.length * ROW_HEIGHT;
    
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
    
    // Fila de Contenido de Observaciones (Más alta para que quepa más texto)
    const observationHeight = 80;
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(MARGIN_X, currentY, INNER_WIDTH, observationHeight);
    ctx.strokeRect(MARGIN_X, currentY, INNER_WIDTH, observationHeight);
    
    ctx.fillStyle = COLOR_TEXT;
    ctx.font = `14px ${FONT_FAMILY}`;
    const obsText = data.observaciones || 'NO HAY OBSERVACIONES ADICIONALES REGISTRADAS EN ESTA ACTA.';
    
    // Wrap text para las observaciones
    const words = obsText.split(' ');
    let line = '';
    let textY = currentY + CELL_PADDING + 5;
    
    for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + ' ';
        if (ctx.measureText(testLine).width > INNER_WIDTH - 2 * CELL_PADDING && i > 0) {
            ctx.fillText(line.trim(), MARGIN_X + CELL_PADDING, textY);
            line = words[i] + ' ';
            textY += LINE_HEIGHT;
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line.trim(), MARGIN_X + CELL_PADDING, textY);
    
    currentY += observationHeight;

    // 6. Pie de Página (Simulación de Firmas)
    currentY += 50;
    
    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `14px ${FONT_FAMILY}`;

    // Firma 1
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 4, currentY);
    ctx.lineTo(CANVAS_WIDTH / 4, currentY + 30);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillText("_________________________", CANVAS_WIDTH / 4, currentY + 45);
    ctx.fillText("Firma Cónyuge 1", CANVAS_WIDTH / 4, currentY + 65);
    
    // Firma 2
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH * 3 / 4, currentY);
    ctx.lineTo(CANVAS_WIDTH * 3 / 4, currentY + 30);
    ctx.stroke();
    ctx.fillText("_________________________", CANVAS_WIDTH * 3 / 4, currentY + 45);
    ctx.fillText("Firma Cónyuge 2", CANVAS_WIDTH * 3 / 4, currentY + 65);
    
    currentY += 100;
    
    // Firma Registrador
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2, currentY);
    ctx.lineTo(CANVAS_WIDTH / 2, currentY + 30);
    ctx.stroke();
    ctx.fillText("_________________________", CANVAS_WIDTH / 2, currentY + 45);
    ctx.fillText("Registrador Civil", CANVAS_WIDTH / 2, currentY + 65);
    
    // Pie de Página final
    ctx.fillStyle = COLOR_SECONDARY_TEXT;
    ctx.font = `12px ${FONT_FAMILY}`;
    ctx.textAlign = 'right';
    ctx.fillText(`Acta de Matrimonio Generada el: ${new Date().toLocaleDateString('es-ES')}`, CANVAS_WIDTH - MARGIN_X, CANVAS_HEIGHT - 20);

    return canvas.toBuffer('image/png');
};


// ==============================================================================
// --- ENDPOINT 1: Nueva API de Árbol Genealógico ---
// ==============================================================================
app.get("/consultar-arbol", async (req, res) => {
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
        
        // --- ADAPTACIÓN DE RESPUESTA ---
        const dataArbol = resArbol.data?.result;

        // Comprobación de que la API externa devolvió la estructura esperada:
        // Se espera que la data ya esté en el formato { principal: {}, familiares: [] }
        if (resArbol.data?.message !== "found data" || !dataArbol?.principal || !Array.isArray(dataArbol?.familiares)) {
             throw new Error(`La API de Árbol Genealógico no devolvió datos válidos (faltan 'principal' o 'familiares') para el DNI: ${rawDocumento}.`);
        }
        // --- FIN ADAPTACIÓN ---
        
        const principal = dataArbol.principal;
        let familiares = dataArbol.familiares;
        
        // Filtrar duplicados por DNI (puede ocurrir si un padre aparece dos veces)
        familiares = familiares.filter((v, i, a) => a.findIndex(t => (t.dni === v.dni)) === i);
        
        // 2. Generar el buffer de la imagen
        const imagenBuffer = await generateGenealogyTreeImage(rawDocumento, principal, familiares);
        
        // 3. Subir imagen si no existe o obtener la URL de la imagen existente
        const { url: githubRawUrl, status } = await uploadOrReturnExisting(rawDocumento, API_NAME, imagenBuffer);

        // 4. Crear la URL final de descarga a través del proxy
        const finalImageUrl = `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(githubRawUrl)}`;

        // 5. Obtener datos de la persona principal formateados
        const personaDataFormatted = getFormattedPersonData(principal);

        // 6. Respuesta JSON
        const messageDetail = status === "existing" 
            ? `Imagen ${API_NAME} existente recuperada con éxito.`
            : `Imagen ${API_NAME} generada y subida con éxito.`;

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
        console.error(`Error en el proceso ${API_NAME}:`, error.message); // Imprimir solo el mensaje de error para logs más limpios
        const status = error.response?.status || 500;
        res.status(status).json({ 
            "message": "error", 
            "error": `Error al generar la Imagen ${API_NAME}`, 
            "detalle": error.message 
        }); 
    } 
});


// ==============================================================================
// --- ENDPOINT 2: Nueva API de Acta de Matrimonio ---
// ==============================================================================
app.get("/consultar-matrimonio", async (req, res) => {
    const rawDocumento = req.query.dni;
    const API_NAME = "ACTA DE MATRIMONIO"; // Se mantiene el nombre de la API para la URL de consulta
    
    if (!rawDocumento || rawDocumento.length !== 8 || !/^\d+$/.test(rawDocumento)) {
        return res.status(400).json({ 
            "message": "error",
            "error": "Parámetro de consulta inválido",
            "detalle": "Debe proporcionar el parámetro 'dni' con exactamente 8 dígitos (solo DNI)."
        });
    }

    try { 
        // 1. CONSULTA API DE ACTA DE MATRIMONIO
        const resActa = await axios.get(`${ACTA_MATRIMONIO_API_URL}?dni=${rawDocumento}`);
        
        // --- ADAPTACIÓN DE RESPUESTA (Corrección aquí) ---
        // La API externa de matrimonio devuelve: {"message":"found data","result":{"quantity":1,"coincidences":[{"...datos de matrimonio...","doc":"40910936",...}]}}
        const rawResult = resActa.data?.result;
        
        if (resActa.data?.message !== "found data" || !rawResult?.coincidences || rawResult.coincidences.length === 0) {
             throw new Error(`La API de Acta de Matrimonio no devolvió datos válidos para el DNI: ${rawDocumento}.`);
        }

        // Asumimos que la API externa trae los datos del principal y el matrimonio en las coincidencias.
        // Dado el ejemplo que mostraste: {"message":"found data","result":{"quantity":1,"coincidences":[{"apellido_paterno":"CHUNG",...}]}}
        
        const matrimonioDataRaw = rawResult.coincidences[0];
        
        // Creamos la estructura esperada: { principal: {}, matrimonio: {} }
        // Se asume que el DNI del principal es el que se consulta y que los datos del principal
        // están mezclados con los datos del matrimonio en `matrimonioDataRaw`.
        
        // Mapeo forzado para alimentar la función de dibujo, ajustando los campos:
        const principal = {
            dni: rawDocumento, // Usamos el DNI consultado como principal
            // Intentamos extraer el nombre del principal de la respuesta (esto es una conjetura sin el formato completo de la API)
            nombres: matrimonioDataRaw.nombres || 'N/A', 
            apellido_paterno: matrimonioDataRaw.apellido_paterno || 'N/A',
            apellido_materno: matrimonioDataRaw.apellido_materno || 'N/A',
            fecha_nacimiento: matrimonioDataRaw.fecha_nacimiento_principal || 'N/A', // Campo tentativo
        };

        const matrimonioData = {
            registro_unico: matrimonioDataRaw.registro_unico || 'N/A',
            nro_acta: matrimonioDataRaw.nro_acta || 'N/A',
            fecha_matrimonio: matrimonioDataRaw.fecha || 'N/A', // Usamos el campo 'fecha' que viste en el ejemplo
            departamento: matrimonioDataRaw.departamento || 'N/A',
            provincia: matrimonioDataRaw.provincia || 'N/A',
            distrito: matrimonioDataRaw.distrito || matrimonioDataRaw.lugar || 'N/A', // Usamos 'lugar' como fallback de distrito/lugar
            oficina_registro: matrimonioDataRaw.oficina_registro || 'N/A',
            estado_civil_c1: matrimonioDataRaw.estado_civil_c1 || 'N/A',
            estado_civil_c2: matrimonioDataRaw.estado_civil_c2 || 'N/A',
            regimen_patrimonial: matrimonioDataRaw.regimen_patrimonial || 'N/A',
            observaciones: matrimonioDataRaw.observaciones || 'N/A',
            // Datos del Cónyuge 2 (Pareja) - Suponiendo que vienen con un prefijo 'conyuge'
            conyuge: {
                dni: matrimonioDataRaw.doc || 'N/A', // Usamos 'doc' como DNI del cónyuge 2
                nombres: matrimonioDataRaw.nombres_conyuge || 'N/A',
                apellido_paterno: matrimonioDataRaw.apellido_paterno_conyuge || 'N/A',
                apellido_materno: matrimonioDataRaw.apellido_materno_conyuge || 'N/A',
                fecha_nacimiento: matrimonioDataRaw.fecha_nacimiento_conyuge || 'N/A',
            }
        };

        // 2. Generar el buffer de la imagen
        // generateMarriageCertificateImage se ha modificado para incluir la tabla y el fondo
        const imagenBuffer = await generateMarriageCertificateImage(rawDocumento, principal, matrimonioData);
        
        // 3. Subir imagen si no existe o obtener la URL de la imagen existente
        const { url: githubRawUrl, status } = await uploadOrReturnExisting(rawDocumento, API_NAME, imagenBuffer);

        // 4. Crear la URL final de descarga a través del proxy
        const finalImageUrl = `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(githubRawUrl)}`;

        // 5. Obtener datos de la persona principal formateados
        const personaDataFormatted = getFormattedPersonData(principal);

        // 6. Respuesta JSON
        const messageDetail = status === "existing" 
            ? `Matrimonios existente recuperada con éxito.`
            : `Matrimonios generada y subida con éxito.`;

        res.json({
            "message": "found data",
            "result": {
                "persona": {
                    "dni": personaDataFormatted.dni,
                    "nombres": personaDataFormatted.nombres,
                    "apellido_paterno": personaDataFormatted.apellido_paterno,
                    "apellido_materno": personaDataFormatted.apellido_materno
                },
                "quantity": 1, // Solo una acta por persona (en el contexto de esta API)
                "coincidences": [
                  {"message": messageDetail, "url": finalImageUrl}
                ]
            }
        });

    } catch (error) { 
        console.error(`Error en el proceso ${API_NAME}:`, error.message); // Imprimir solo el mensaje de error para logs más limpios
        const status = error.response?.status || 500;
        res.status(status).json({ 
            "message": "error", 
            "error": `Error al generar el Matrimonios`, 
            "detalle": error.message 
        }); 
    } 
});


// ==============================================================================
// --- RUTAS OBSOLETAS/MEZCLADAS (Actualizadas a 410 Gone) ---
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
