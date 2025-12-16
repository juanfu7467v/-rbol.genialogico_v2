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
const COLOR_TEXT = '#000000'; // Color de texto principal (NEGRO)
const COLOR_SECONDARY_TEXT = '#333333';
const FALLBACK_PHOTO_URL = "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEh4p_jX8U0kG7R8tD9K0h0bVv7V9jE_s2O_jJ4_X5kZ0X9qL_n9jX5Q6g8Q/s512/placeholder.png"; 

// Colores específicos del diseño de la imagen subida
const BACKGROUND_COLOR = '#FFFFFF'; // Color de fondo principal (BLANCO)
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

    // La API externa usa 'nom', 'ap', 'am'. La API interna usa 'nombres', 'apellido_paterno', 'apellido_materno' o variantes.
    const nombres = (data.nombres || data.nom || data.preNombres || '').toUpperCase().trim();
    const apellidoPaterno = (data.apellido_paterno || data.ap || data.ape_pat || data.apePaterno || '').toUpperCase().trim();
    const apellidoMaterno = (data.apellido_materno || data.am || data.ape_mat || data.apeMaterno || '').toUpperCase().trim();

    return {
        dni: data.dni || data.nuDni || 'N/A',
        nombres,
        apellido_paterno: apellidoPaterno,
        apellido_materno: apellidoMaterno,
    };
};


// ==============================================================================
//  FUNCIONES DE DIBUJO (ÁRBOL GENEALÓGICO) - MODIFICADAS PARA ALTURA DINÁMICA
// ==============================================================================

// Constantes de diseño para el árbol - Ajustadas para 3 columnas
const CANVAS_WIDTH_ARBOL = 900; // Ancho fijo para 3 columnas cómodas
const MAX_COLUMNS = 3;
const MARGIN_X = 50;
const INNER_WIDTH = CANVAS_WIDTH_ARBOL - 2 * MARGIN_X;
// Calcular el ancho del nodo para que quepan 3
const HORIZONTAL_SPACING = 30; 
const TREE_NODE_WIDTH = (INNER_WIDTH - (MAX_COLUMNS - 1) * HORIZONTAL_SPACING) / MAX_COLUMNS; 
const TREE_NODE_HEIGHT = 120; // Aumentamos la altura para acomodar 4 líneas de texto
const VERTICAL_SPACING = 100; 
const ROW_TITLE_HEIGHT = 30; // Altura para el título de la capa (ej: "Padres")


/**
 * Obtiene el color de fondo de la caja basado en el parentesco (imitando el diseño de la imagen).
 */
const getBoxColorByParentesco = (parentescoText, isPrincipal) => {
    if (isPrincipal) {
        return '#00B8D4'; // Cyan - PRINCIPAL
    } 
    
    parentescoText = (parentescoText || '').toUpperCase();
    
    // Padres y Madres: Ámbar
    if (parentescoText.includes('PADRE') || parentescoText.includes('MADRE')) {
        return '#FFAB00'; // Ámbar - PADRES 
    } 
    // Hermanos y Hermanas: Verde Lima
    else if (parentescoText.includes('HERMANO') || parentescoText.includes('HERMANA')) {
        return '#64DD17'; // Verde Lima - HERMANOS
    } 
    // Descendientes (Hijos, Hijas): Azul Oscuro
    else if (parentescoText.includes('HIJO') || parentescoText.includes('HIJA')) {
        // MODIFICACIÓN: Color diferente para Hijos y Sobrinos para diferenciarlos.
        return '#3F51B5'; // Azul Oscuro - HIJOS
    } 
    // Sobrinos: Púrpura (diferente al de Hijos)
    else if (parentescoText.includes('SOBRINO') || parentescoText.includes('SOBRINA')) {
        return '#7B1FA2'; // Púrpura Oscuro - SOBRINOS
    } 
    // Tíos/Primos: Rojo Ladrillo (diferente al de Sobrinos)
    else if (parentescoText.includes('TIO') || parentescoText.includes('TIA') || parentescoText.includes('PRIMO') || parentescoText.includes('PRIMA')) {
         return '#D32F2F'; // Rojo Ladrillo - Tíos/Primos
    }
    // Otros: Gris
    else {
        return '#9E9E9E'; // Gris - OTROS
    }
};


/**
 * Dibuja un nodo (caja) en el Árbol Genealógico, imitando el estilo de la imagen subida.
 */
const drawTreeNode = (ctx, data, x, y, isPrincipal, parentesco) => {
    
    // 1. Determinar Colores y Texto
    const parentescoText = (isPrincipal ? 'PRINCIPAL' : (parentesco || 'FAMILIAR')).toUpperCase().replace('N/A', 'FAMILIAR');
    const boxColor = getBoxColorByParentesco(parentesco, isPrincipal); // Color para el BORDE
    
    // MODIFICACIÓN CLAVE: Fondo BLANCO y Texto NEGRO
    const backgroundColor = BACKGROUND_COLOR; // Fondo Blanco
    const textColor = COLOR_TEXT; // Texto Negro

    // 2. Dibuja la Caja de Fondo (Rectángulo plano)
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(x, y, TREE_NODE_WIDTH, TREE_NODE_HEIGHT);
    
    // 3. Dibuja el Borde (con el color de parentesco)
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 4; // Un borde más grueso para que destaque
    ctx.strokeRect(x, y, TREE_NODE_WIDTH, TREE_NODE_HEIGHT);
    
    // 4. Dibujar Texto (Simulando la estructura interna de la caja)
    const formattedData = getFormattedPersonData(data);
    
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    
    // --- Fila 1: Parentesco (Título Principal) ---
    ctx.font = `bold 16px ${FONT_FAMILY}`; // Tamaño ajustado
    ctx.textAlign = 'center'; // Centrado en la caja
    ctx.fillText(parentescoText, x + TREE_NODE_WIDTH / 2, y + 20); // Y más arriba para dejar espacio
    
    // Línea separadora sutil (Gris oscuro)
    ctx.strokeStyle = '#CCCCCC'; 
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 28);
    ctx.lineTo(x + TREE_NODE_WIDTH - 5, y + 28);
    ctx.stroke();
    
    ctx.textAlign = 'left'; // Reset a la izquierda para los datos
    const PADDING = 10;
    const LABEL_WIDTH = 70; // Ancho para las etiquetas
    const VALUE_WIDTH = TREE_NODE_WIDTH - LABEL_WIDTH - 2 * PADDING;
    let textY = y + 45; // Comienzo de los datos
    
    // ----------------------------------------------------------------------------------
    // MODIFICACIÓN DE ORDEN: Nombre, Apellidos, DNI, Tipo
    // ----------------------------------------------------------------------------------
    
    // Helper para dibujar una fila de etiqueta-valor
    const drawLine = (label, value) => {
        // Etiqueta (bold, gris)
        ctx.font = `bold 12px ${FONT_FAMILY}`;
        ctx.fillStyle = COLOR_SECONDARY_TEXT; 
        ctx.fillText(label, x + PADDING, textY); 
        
        // Valor (normal, negro)
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillStyle = textColor; 
        // Usamos una versión recortada si es muy larga
        let displayValue = value.length > 25 ? value.substring(0, 22) + '...' : value; 
        ctx.fillText(displayValue, x + PADDING + LABEL_WIDTH, textY, VALUE_WIDTH); 
        
        textY += 20; // Incremento de línea
    };
    
    // Fila 2: Nombre
    drawLine("Nombre:", formattedData.nombres);

    // Fila 3: Apellidos
    drawLine("Apellidos:", `${formattedData.apellido_paterno} ${formattedData.apellido_materno}`);
    
    // Fila 4: DNI
    drawLine("DNI:", formattedData.dni);
    
    // Fila 5: Tipo (M/P) - Solo para ilustración. El parentesco es más relevante.
    const tipo = (parentesco || '').toUpperCase().includes('PADRE') || (parentesco || '').toUpperCase().includes('HERMANO') || (parentesco || '').toUpperCase().includes('TIO') || (parentesco || '').toUpperCase().includes('HIJO') || (parentesco || '').toUpperCase().includes('SOBRINO') || (parentesco || '').toUpperCase().includes('PRIMO') ? 'Paterno' : 
                 (parentesco || '').toUpperCase().includes('MADRE') || (parentesco || '').toUpperCase().includes('HERMANA') || (parentesco || '').toUpperCase().includes('TIA') || (parentesco || '').toUpperCase().includes('HIJA') || (parentesco || '').toUpperCase().includes('SOBRINA') || (parentesco || '').toUpperCase().includes('PRIMA') ? 'Materno' : 'N/A';
    
    drawLine("Sexo/Lado:", tipo);
    // ----------------------------------------------------------------------------------


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
    
    const API_NAME = "ARBOL GENEALOGICO";
    const HEADER_HEIGHT = 100;
    // const FOOTER_HEIGHT = 200; // ELIMINADO: Se calculará dinámicamente
    const LEGEND_LINE_HEIGHT = 25; // Altura de cada línea de la leyenda

    // --- 1. PROCESAMIENTO Y AGRUPAMIENTO DE NODOS (Ordenado por Parentesco) ---
    
    // Aseguramos que la persona principal tenga el tipo de parentesco correcto para su capa
    const principalNode = { ...principal, tipo: 'PRINCIPAL', parentesco: 'PRINCIPAL' };
    
    // Agrupación y Ordenamiento dentro de grupos
    const nodes = {
        // Padres: Siempre se ordenan (Padre, Madre) para la conexión
        padres: familiares.filter(f => f.tipo?.toUpperCase().includes('PADRE') || f.tipo?.toUpperCase().includes('MADRE')).sort((a, b) => {
            if (a.tipo?.toUpperCase().includes('MADRE') && b.tipo?.toUpperCase().includes('PADRE')) return 1;
            if (a.tipo?.toUpperCase().includes('PADRE') && b.tipo?.toUpperCase().includes('MADRE')) return -1;
            return 0;
        }), 
        // Hermanos: Se incluyen en la misma capa que el principal
        hermanos: familiares.filter(f => f.tipo?.toUpperCase().includes('HERMANO') || f.tipo?.toUpperCase().includes('HERMANA')).sort((a, b) => a.tipo?.toUpperCase().includes('HERMANA') ? 1 : -1),
        // Hijos
        hijos: familiares.filter(f => f.tipo?.toUpperCase().includes('HIJO') || f.tipo?.toUpperCase().includes('HIJA')).sort((a, b) => a.tipo?.toUpperCase().includes('HIJA') ? 1 : -1),
        // Tíos
        tios: familiares.filter(f => f.tipo?.toUpperCase().includes('TIO') || f.tipo?.toUpperCase().includes('TIA')).sort((a, b) => a.tipo?.toUpperCase().includes('TIA') ? 1 : -1),
        // Sobrinos
        sobrinos: familiares.filter(f => f.tipo?.toUpperCase().includes('SOBRINO') || f.tipo?.toUpperCase().includes('SOBRINA')).sort((a, b) => a.tipo?.toUpperCase().includes('SOBRINA') ? 1 : -1),
        // Primos
        primos: familiares.filter(f => f.tipo?.toUpperCase().includes('PRIMO') || f.tipo?.toUpperCase().includes('PRIMA')).sort((a, b) => a.tipo?.toUpperCase().includes('PRIMA') ? 1 : -1),
        // Cuñados
        cunyados: familiares.filter(f => f.tipo?.toUpperCase().includes('CUÑADO') || f.tipo?.toUpperCase().includes('CUÑADA')),
        // Otros
        otros: familiares.filter(f => !f.tipo?.toUpperCase().includes('PADRE') && !f.tipo?.toUpperCase().includes('MADRE') && !f.tipo?.toUpperCase().includes('HERMANO') && !f.tipo?.toUpperCase().includes('HERMANA') && !f.tipo?.toUpperCase().includes('HIJO') && !f.tipo?.toUpperCase().includes('HIJA') && !f.tipo?.toUpperCase().includes('TIO') && !f.tipo?.toUpperCase().includes('TIA') && !f.tipo?.toUpperCase().includes('SOBRINO') && !f.tipo?.toUpperCase().includes('SOBRINA') && !f.tipo?.toUpperCase().includes('PRIMO') && !f.tipo?.toUpperCase().includes('PRIMA') && !f.tipo?.toUpperCase().includes('CUÑADO') && !f.tipo?.toUpperCase().includes('CUÑADA')),
    };
    
    // Orden de las capas jerárquicas (IMPORTANTE PARA EL FLUJO)
    let layers = [
        { name: 'PADRES', nodes: nodes.padres },
        { name: 'TÍOS', nodes: nodes.tios },
        // La capa de principal siempre existe, y se filtra para no duplicar al principal si estaba en 'familiares'
        { name: 'PRINCIPAL Y HERMANOS', nodes: [principalNode, ...nodes.hermanos].filter((v, i, a) => a.findIndex(t => (t.dni === v.dni)) === i) },
        { name: 'HIJOS', nodes: nodes.hijos },
        { name: 'SOBRINOS', nodes: nodes.sobrinos },
        { name: 'PRIMOS', nodes: nodes.primos },
        { name: 'OTROS Y CUÑADOS', nodes: [...nodes.cunyados, ...nodes.otros] },
    ].filter(layer => layer.nodes.length > 0); 

    // --- 2. CÁLCULO PRELIMINAR DEL ALTO DEL CANVAS (Solo para dibujar, no el final) ---
    // Usaremos un canvas grande para dibujar y luego recortaremos al tamaño exacto.
    const TEMP_MAX_HEIGHT = 5000; 
    
    const canvas = createCanvas(CANVAS_WIDTH_ARBOL, TEMP_MAX_HEIGHT);
    const ctx = canvas.getContext("2d");

    // Fondo Blanco Puro
    ctx.fillStyle = BACKGROUND_COLOR; 
    ctx.fillRect(0, 0, CANVAS_WIDTH_ARBOL, TEMP_MAX_HEIGHT);
    
    // 3. Título
    const titleY = MARGIN + 25;
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `bold 30px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`ÁRBOL GENEALÓGICO`, CANVAS_WIDTH_ARBOL / 2, titleY);
    ctx.font = `20px ${FONT_FAMILY}`;
    ctx.fillText(`DNI: ${rawDocumento} - Total de Familiares: ${familiares.length}`, CANVAS_WIDTH_ARBOL / 2, titleY + 35);
    
    // Línea separadora
    ctx.strokeStyle = '#9E9E9E'; // Gris
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MARGIN, titleY + 50);
    ctx.lineTo(CANVAS_WIDTH_ARBOL - MARGIN, titleY + 50);
    ctx.stroke();
    
    let currentY = MARGIN + HEADER_HEIGHT; // Posición Y donde empieza el dibujo de la primera capa
    
    const nodeCenters = {
        principal: null,
        padres: [],
        tios: [],
        hermanos: [],
        hijos: [],
        sobrinos: [],
        primos: [],
        otros: [],
        cunyados: []
    };
    
    let previousLayerNodesCenters = [];
    const lineThickness = 3;

    // --- 4. DIBUJO DE NODOS POR CAPA (DE ARRIBA A ABAJO) ---
    layers.forEach((layer, layerIndex) => {
        
        // 4.1. Dibujar Título de la Capa
        currentY += VERTICAL_SPACING / 2; // Espacio vertical entre capas
        ctx.fillStyle = '#444444';
        ctx.font = `bold 18px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.fillText(`— ${layer.name} —`, MARGIN_X, currentY);
        currentY += ROW_TITLE_HEIGHT;

        let currentLayerNodesCenters = [];
        const currentLayerNodes = layer.nodes;
        
        // 4.2. Dibujar los Nodos de la Capa (Envolviendo en filas de 3)
        const numNodes = currentLayerNodes.length;
        
        let rowYStart = currentY;

        for (let i = 0; i < numNodes; i++) {
            const row = Math.floor(i / MAX_COLUMNS);
            const col = i % MAX_COLUMNS;
            
            // La Y inicial de la fila
            let nodeY = rowYStart + row * (TREE_NODE_HEIGHT + VERTICAL_SPACING / 2);
            
            // Calcular el X, siempre centrado
            const nodesInCurrentRow = Math.min(MAX_COLUMNS, numNodes - row * MAX_COLUMNS);
            const rowWidth = nodesInCurrentRow * TREE_NODE_WIDTH + (nodesInCurrentRow - 1) * HORIZONTAL_SPACING;
            const startX = (CANVAS_WIDTH_ARBOL - rowWidth) / 2;
            
            let nodeX = startX + col * (TREE_NODE_WIDTH + HORIZONTAL_SPACING);
            
            const p = currentLayerNodes[i];
            const isPrincipal = p.dni === rawDocumento;
            const parentesco = p.tipo || p.parentesco;
            const node = drawTreeNode(ctx, p, nodeX, nodeY, isPrincipal, parentesco);
            currentLayerNodesCenters.push(node);
            
            // Asignar al mapa de centros (para la conexión)
            if (isPrincipal) {
                nodeCenters.principal = node;
            } else if (p.tipo?.toUpperCase().includes('PADRE') || p.tipo?.toUpperCase().includes('MADRE')) {
                nodeCenters.padres.push(node);
            } else if (p.tipo?.toUpperCase().includes('HERMANO') || p.tipo?.toUpperCase().includes('HERMANA')) {
                nodeCenters.hermanos.push(node);
            } else if (p.tipo?.toUpperCase().includes('TIO') || p.tipo?.toUpperCase().includes('TIA')) {
                nodeCenters.tios.push(node);
            } else if (p.tipo?.toUpperCase().includes('HIJO') || p.tipo?.toUpperCase().includes('HIJA')) {
                nodeCenters.hijos.push(node);
            } else if (p.tipo?.toUpperCase().includes('SOBRINO') || p.tipo?.toUpperCase().includes('SOBRINA')) {
                nodeCenters.sobrinos.push(node);
            } else if (p.tipo?.toUpperCase().includes('PRIMO') || p.tipo?.toUpperCase().includes('PRIMA')) {
                nodeCenters.primos.push(node);
            } else if (p.tipo?.toUpperCase().includes('CUÑADO') || p.tipo?.toUpperCase().includes('CUÑADA')) {
                nodeCenters.cunyados.push(node);
            } else {
                 nodeCenters.otros.push(node);
            }
        }
        
        // 4.3. Conexiones entre capas (Solo para relaciones Padre/Hijo)
        ctx.strokeStyle = '#795548'; // Marrón oscuro para las líneas de conexión
        ctx.lineWidth = lineThickness;
        
        if (layerIndex > 0) {
            const previousLayerName = layers[layerIndex - 1].name;
            const currentLayerName = layer.name;
            
            // -----------------------------------------------------------
            // --- CONEXIÓN 1: Padres (Arriba) -> Principal/Hermanos (Abajo) ---
            // -----------------------------------------------------------
            if (previousLayerName.includes('PADRES') && currentLayerName.includes('PRINCIPAL')) {
                if (nodeCenters.padres.length > 0 && nodeCenters.principal) {
                    const principalNodes = [nodeCenters.principal, ...nodeCenters.hermanos].filter(n => n);
                    // Usamos todos los nodos de esta capa (Principal y Hermanos) para el cálculo de la línea horizontal
                    const siblingNodesForLine = principalNodes.length > 0 ? principalNodes : [nodeCenters.principal];

                    if (siblingNodesForLine.length > 0) {
                        const minX = Math.min(...siblingNodesForLine.map(n => n.centerX));
                        const maxX = Math.max(...siblingNodesForLine.map(n => n.centerX));
                        
                        // Y de la línea horizontal de unión de Padres (a mitad del espacio vertical)
                        const parentBranchY = previousLayerNodesCenters.map(n => n.bottomY).sort((a, b) => b - a)[0] + VERTICAL_SPACING / 2;
                        
                        // 1. Línea horizontal de unión de Padres (si hay más de 1 padre)
                        if (nodeCenters.padres.length > 1) {
                            const minParentX = Math.min(...nodeCenters.padres.map(n => n.centerX));
                            const maxParentX = Math.max(...nodeCenters.padres.map(n => n.centerX));
                            ctx.beginPath();
                            ctx.moveTo(minParentX, parentBranchY);
                            ctx.lineTo(maxParentX, parentBranchY);
                            ctx.stroke();
                        } else if (nodeCenters.padres.length === 1) {
                            // Si solo hay un padre, la línea horizontal de padres es solo el centro del nodo
                             // Nada que dibujar, el tronco principal se encargará de esto
                        }
                        
                        // 2. Conexiones verticales a cada Padre, conectando el nodo al punto de ramificación
                        nodeCenters.padres.forEach(p => {
                            ctx.beginPath();
                            ctx.moveTo(p.centerX, p.bottomY);
                            ctx.lineTo(p.centerX, parentBranchY);
                            ctx.stroke();
                        });

                        // 3. Tronco Principal de Padres a Principal (descendiendo)
                        // El tronco debe bajar desde el centro de la línea de Padres hasta la línea de Hermanos
                        const siblingBranchY = nodeCenters.principal.topY - VERTICAL_SPACING / 2;
                        const trunkX = nodeCenters.principal.centerX; // Usamos el centro del principal
                        
                        ctx.beginPath();
                        ctx.moveTo(trunkX, parentBranchY);
                        ctx.lineTo(trunkX, siblingBranchY);
                        ctx.stroke();
                        
                        // 4. Conexión de Hermanos (Línea horizontal que cruza a la mitad de la zona de espaciado)
                        ctx.beginPath();
                        ctx.moveTo(minX, siblingBranchY);
                        ctx.lineTo(maxX, siblingBranchY);
                        ctx.stroke();
                        
                        // 5. Conexiones verticales a cada Principal/Hermano
                        siblingNodesForLine.forEach(n => {
                            ctx.beginPath();
                            ctx.moveTo(n.centerX, n.topY);
                            ctx.lineTo(n.centerX, siblingBranchY);
                            ctx.stroke();
                        });
                    }
                }
            }
            
            // -----------------------------------------------------------
            // --- CONEXIÓN 2: Principal (Arriba) -> Hijos (Abajo) ---
            // -----------------------------------------------------------
            
            if (previousLayerName.includes('PRINCIPAL') && currentLayerName.includes('HIJOS')) {
                 if (nodeCenters.principal && nodeCenters.hijos.length > 0) {
                    const minX = Math.min(...nodeCenters.hijos.map(n => n.centerX));
                    const maxX = Math.max(...nodeCenters.hijos.map(n => n.centerX));
                    
                    // Y de la línea horizontal de unión de Hijos
                    const childrenBranchY = nodeCenters.principal.bottomY + VERTICAL_SPACING / 2;
                    
                    // 1. Tronco Principal de Principal (saliendo por abajo)
                    ctx.beginPath();
                    ctx.moveTo(nodeCenters.principal.centerX, nodeCenters.principal.bottomY);
                    ctx.lineTo(nodeCenters.principal.centerX, childrenBranchY);
                    ctx.stroke();

                    // 2. Línea horizontal de unión de Hijos
                    ctx.beginPath();
                    ctx.moveTo(minX, childrenBranchY);
                    ctx.lineTo(maxX, childrenBranchY);
                    ctx.stroke();

                    // 3. Conexiones verticales a cada Hijo
                    nodeCenters.hijos.forEach(c => {
                        ctx.beginPath();
                        ctx.moveTo(c.centerX, c.topY);
                        ctx.lineTo(c.centerX, childrenBranchY);
                        ctx.stroke();
                    });
                }
            }
            
            // Para otras capas (Tíos, Primos, Sobrinos, Otros), NO se dibujan conexiones jerárquicas directas.
        }

        // Mover Y al final de la última caja de la capa para el siguiente cálculo.
        // Si no hay nodos, no movemos la Y base de la capa.
        const layerBottomY = currentLayerNodesCenters.map(n => n.bottomY).sort((a, b) => b - a)[0];
        if (layerBottomY) {
            currentY = layerBottomY;
        } else {
             currentY += TREE_NODE_HEIGHT; // Caso de capa vacía que se filtró (aunque debería ser rara)
        }
        previousLayerNodesCenters = currentLayerNodesCenters;
    });
    
    // --- 5. ESPECIFICACIÓN DE COLORES (LEYENDA) ---
    currentY += VERTICAL_SPACING / 2; // Espacio final después del último nodo
    
    // MODIFICACIÓN: Leyenda con los nuevos colores y separando Hijos y Sobrinos
    const legendData = [
        { color: '#00B8D4', text: 'PRINCIPAL (DNI consultado)' },
        { color: '#FFAB00', text: 'PADRES / MADRES' },
        { color: '#64DD17', text: 'HERMANOS / HERMANAS' },
        { color: '#D32F2F', text: 'TÍOS / TÍAS / PRIMOS / PRIMAS' }, // Rojo Ladrillo
        { color: '#3F51B5', text: 'HIJOS / HIJAS' }, // Azul Oscuro
        { color: '#7B1FA2', text: 'SOBRINOS / SOBRINAS' }, // Púrpura Oscuro
        { color: '#9E9E9E', text: 'OTROS FAMILIARES / CUÑADOS' }
    ];
    
    const legendX = MARGIN;
    let legendY = currentY + 10; 
    const LEGEND_BOX_SIZE = 18;
    
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `bold 18px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText("Leyenda de Parentesco:", legendX, legendY);
    legendY += 10;
    
    ctx.font = `14px ${FONT_FAMILY}`;
    
    // Distribución de la leyenda en 2 columnas
    const LEGEND_COL_WIDTH = CANVAS_WIDTH_ARBOL / 2 - MARGIN;
    const LEGEND_ROWS = Math.ceil(legendData.length / 2);
    
    legendData.forEach((item, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        
        let itemX = legendX + col * LEGEND_COL_WIDTH;
        // Ajuste para tener 4 filas en total (0, 1, 2, 3)
        let itemY = legendY + (row + 1) * LEGEND_LINE_HEIGHT; 

        // Dibujar el cuadro de color (Borde de color sobre fondo blanco)
        ctx.fillStyle = BACKGROUND_COLOR; // Fondo blanco para la caja
        ctx.fillRect(itemX, itemY - LEGEND_BOX_SIZE / 2, LEGEND_BOX_SIZE, LEGEND_BOX_SIZE);
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 4;
        ctx.strokeRect(itemX, itemY - LEGEND_BOX_SIZE / 2, LEGEND_BOX_SIZE, LEGEND_BOX_SIZE);
        
        // Dibujar el texto
        ctx.fillStyle = COLOR_TEXT;
        ctx.fillText(item.text, itemX + LEGEND_BOX_SIZE + 10, itemY + 5);
    });

    // Mover currentY al final de la leyenda
    currentY = legendY + (LEGEND_ROWS + 1) * LEGEND_LINE_HEIGHT;
    
    // 6. Pie de Página
    const FOOTER_LINE_HEIGHT = 20;
    const footerY = currentY + FOOTER_LINE_HEIGHT; // Espacio de 20px después de la leyenda

    ctx.fillStyle = COLOR_SECONDARY_TEXT;
    ctx.font = `14px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText(`Fuente: ${API_NAME}`, MARGIN, footerY);
    ctx.textAlign = 'right';
    ctx.fillText(`Generado el: ${new Date().toLocaleDateString('es-ES')}`, CANVAS_WIDTH_ARBOL - MARGIN, footerY);
    
    // Mover currentY al final del pie de página más un margen final
    currentY = footerY + MARGIN / 2; 

    // --- 7. AJUSTE FINAL DEL CANVAS ---
    // La nueva altura final del canvas es la posición Y actual.
    const FINAL_CANVAS_HEIGHT = currentY; 
    
    // Crear un nuevo canvas con la altura ajustada y copiar la imagen (esto recorta el exceso)
    const finalCanvas = createCanvas(CANVAS_WIDTH_ARBOL, FINAL_CANVAS_HEIGHT);
    const finalCtx = finalCanvas.getContext("2d");
    
    // Copiar el contenido dibujado del canvas temporal al final
    finalCtx.drawImage(canvas, 0, 0, CANVAS_WIDTH_ARBOL, FINAL_CANVAS_HEIGHT, 0, 0, CANVAS_WIDTH_ARBOL, FINAL_CANVAS_HEIGHT);
    
    return finalCanvas.toBuffer('image/png');
};

/**
 * Función auxiliar para dividir texto en líneas que caben dentro de un ancho máximo.
 * @param {CanvasRenderingContext2D} ctx - Contexto del canvas.
 * @param {string} text - Texto a envolver.
 * @param {number} maxWidth - Ancho máximo permitido para el texto.
 * @param {number} lineHeight - Altura de línea.
 * @returns {Array<{lines: string[], height: number}>} Objeto con la lista de líneas y la altura total.
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
//  FUNCIONES DE DIBUJO (ACTA DE MATRIMONIO) - MANTENIDA
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

    // Campos que tienen más probabilidades de requerir ajuste de texto y estiramiento de fila
    const wrapFieldsIndices = [1, 2, 3]; // Índice de las filas con texto largo: Oficina, Departamento, Distrito

    rawInfoData.forEach((row, rowIndex) => {
        let rowHeight = MIN_ROW_HEIGHT;
        let startY = currentY;

        // --- 1. PREPARACIÓN Y CÁLCULO DE ALTURA DE FILA (MODIFICADO) ---
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        const shouldWrap = wrapFieldsIndices.includes(rowIndex);

        let wrappedCol2 = { lines: [String(row[1]).toUpperCase()], height: LINE_HEIGHT }; // Inicializado con altura de 1 línea
        let wrappedCol4 = { lines: [String(row[3]).toUpperCase()], height: LINE_HEIGHT }; // Inicializado con altura de 1 línea

        if (shouldWrap) {
            // Columna 2: Oficina de Registro, Departamento, Distrito
            wrappedCol2 = wrapText(ctx, String(row[1]).toUpperCase(), infoCol2Width - 2 * CELL_PADDING, LINE_HEIGHT);
            // Columna 4: Nro. de Acta, Provincia, Régimen Patrimonial
            wrappedCol4 = wrapText(ctx, String(row[3]).toUpperCase(), infoCol4Width - 2 * CELL_PADDING, LINE_HEIGHT);
            
            // La altura de la fila es determinada por el texto más largo + un padding de celda.
            const maxTextHeight = Math.max(wrappedCol2.height, wrappedCol4.height);
            // El padding vertical debe ser al menos 2 * (CELL_PADDING - 5) para los textos envueltos
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
        // Offset base para centrado vertical: 5px es la mitad de la altura de la fuente (14px) + un pequeño ajuste visual
        const textYCenterOffset = 5; 

        // Columna 1 (Etiqueta 1)
        ctx.fillStyle = TABLE_HEADER_COLOR;
        ctx.font = `14px ${FONT_FAMILY}`;
        // Centrado: Altura de la fila / 2 - Altura del texto / 2 + Altura de línea de texto / 2 + ajuste
        ctx.fillText(row[0], MARGIN_X + CELL_PADDING, startY + rowHeight / 2 + textYCenterOffset);
        
        // Columna 3 (Etiqueta 2)
        ctx.fillStyle = TABLE_HEADER_COLOR;
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText(row[2], MARGIN_X + INNER_WIDTH / 2 + CELL_PADDING, startY + rowHeight / 2 + textYCenterOffset);

        // Columna 2 (Valor 1 - Ajuste de Texto)
        ctx.fillStyle = COLOR_TEXT;
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        // El punto de inicio del texto debe centrar el BLOQUE COMPLETO de texto
        const blockYStartCol2 = startY + (rowHeight / 2) - (wrappedCol2.height / 2);
        wrappedCol2.lines.forEach((line, i) => {
            const lineY = blockYStartCol2 + (i * LINE_HEIGHT) + textYCenterOffset; // +5 para centrado visual
            ctx.fillText(line, MARGIN_X + infoCol1Width + CELL_PADDING, lineY);
        });
        
        // Columna 4 (Valor 2 - Ajuste de Texto)
        ctx.fillStyle = COLOR_TEXT;
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        const blockYStartCol4 = startY + (rowHeight / 2) - (wrappedCol4.height / 2);
        wrappedCol4.lines.forEach((line, i) => {
            const lineY = blockYStartCol4 + (i * LINE_HEIGHT) + textYCenterOffset; // +5 para centrado visual
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
    
    // Datos de los Cónyuges
    const conyuge1 = getFormattedPersonData(principal);
    const conyuge2 = getFormattedPersonData(data.conyuge || {});
    
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

    const conyugeRowsData = [
        ["Cónyuge Principal (1)", `${conyuge1.nombres} ${conyuge1.apellido_paterno} ${conyuge1.apellido_materno} (DNI: ${conyuge1.dni})`],
        ["Cónyuge Pareja (2)", `${conyuge2.nombres} ${conyuge2.apellido_paterno} ${conyuge2.apellido_materno} (DNI: ${conyuge2.dni})`],
        ["Estado Civil Anterior C1", data.estado_civil_c1 || 'N/A'],
        ["Estado Civil Anterior C2", data.estado_civil_c2 || 'N/A']
    ];
    
    // --- MODIFICACIÓN CLAVE: DIBUJO DE CÓNYUGES CON AJUSTE DE ALTURA ---
    conyugeRowsData.forEach((row, index) => {
        const startY = currentY;
        const isConyugeRow = index < 2; // Solo las dos primeras filas tienen el texto largo del cónyuge
        const contentText = isConyugeRow ? String(row[1]).toUpperCase() : String(row[1] || 'N/A').toUpperCase();
        
        // 1. Calcular altura de la fila
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        let rowHeight;
        let wrappedContent;
        const contentWidth = INNER_WIDTH / 2 - 2 * CELL_PADDING;

        if (isConyugeRow) {
            wrappedContent = wrapText(ctx, contentText, contentWidth, LINE_HEIGHT);
            // Altura de la fila: Altura del texto envuelto + doble padding vertical
            rowHeight = Math.max(ROW_HEIGHT, wrappedContent.height + 2 * (CELL_PADDING - 5)); 
        } else {
            // Filas de estado civil, no deberían necesitar salto de línea, usamos altura mínima
            rowHeight = ROW_HEIGHT;
            wrappedContent = wrapText(ctx, contentText, contentWidth, LINE_HEIGHT);
             // wrappedContent = { lines: [contentText], height: LINE_HEIGHT }; 
        }

        // 2. Dibujar Fondos y Bordes
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(MARGIN_X, startY, INNER_WIDTH / 2, rowHeight); // Columna 1
        ctx.fillRect(MARGIN_X + INNER_WIDTH / 2, startY, INNER_WIDTH / 2, rowHeight); // Columna 2
        ctx.strokeStyle = TABLE_BORDER_COLOR;
        ctx.strokeRect(MARGIN_X, startY, INNER_WIDTH, rowHeight);
        ctx.beginPath();
        ctx.moveTo(MARGIN_X + INNER_WIDTH / 2, startY);
        ctx.lineTo(MARGIN_X + INNER_WIDTH / 2, startY + rowHeight);
        ctx.stroke();
        
        // 3. Dibujar Texto
        const textYCenterOffset = 5; // Offset base para centrado vertical
        const blockYStart = startY + (rowHeight / 2) - (wrappedContent.height / 2);

        // Columna 1 (Etiqueta de Rol)
        ctx.fillStyle = COLOR_TEXT;
        ctx.font = `14px ${FONT_FAMILY}`;
        ctx.fillText(row[0], MARGIN_X + CELL_PADDING, startY + rowHeight / 2 + textYCenterOffset);
        
        // Columna 2 (Contenido - Texto largo con Salto de Línea)
        ctx.fillStyle = COLOR_TEXT;
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        
        // Dibuja las líneas ajustadas
        wrappedContent.lines.forEach((line, i) => {
            // Calcular Y para centrar el bloque de texto verticalmente
            const lineY = blockYStart + (i * LINE_HEIGHT) + textYCenterOffset; // +5 para centrado visual
            ctx.fillText(line, MARGIN_X + INNER_WIDTH / 2 + CELL_PADDING, lineY);
        });

        currentY += rowHeight;
    });

    // --- FIN MODIFICACIÓN CLAVE ---
    
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
    const obsWrapped = wrapText(ctx, obsText, INNER_WIDTH - 2 * CELL_PADDING, LINE_HEIGHT);
    
    // Calcular la posición inicial Y para centrar el bloque de texto
    const obsBlockYStart = currentY + (observationHeight / 2) - (obsWrapped.height / 2);
    let textY = obsBlockYStart + 5; // +5 para ajuste visual

    obsWrapped.lines.forEach(line => {
        // Asegurarse de no exceder el espacio de la celda de observación
        if (textY < currentY + observationHeight - 5) { 
            ctx.fillText(line.trim(), MARGIN_X + CELL_PADDING, textY);
            textY += LINE_HEIGHT;
        }
    });

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
        // La API externa devuelve: {"message":"found data","result":{"person":{},"quantity":52,"coincidences":[]}}
        if (resArbol.data?.message !== "found data" || !dataArbol?.person || !Array.isArray(dataArbol?.coincidences)) {
             throw new Error(`La API de Árbol Genealógico no devolvió datos válidos (faltan 'person' o 'coincidences') para el DNI: ${rawDocumento}.`);
        }
        
        // Mapeo a la estructura interna esperada: { principal: {}, familiares: [] }
        const principal = dataArbol.person;
        // Mapear 'tipo' a 'parentesco' para la función drawTreeNode
        let familiares = dataArbol.coincidences.map(c => ({
            ...c,
            parentesco: c.tipo || 'FAMILIAR', // Usamos 'tipo' de la API externa
            dni: c.dni,
            nom: c.nom,
            ap: c.ap,
            am: c.am
        }));

        // Filtrar duplicados por DNI (puede ocurrir si un padre aparece dos veces)
        familiares = familiares.filter((v, i, a) => a.findIndex(t => (t.dni === v.dni)) === i);
        
        // 2. Generar el buffer de la imagen
        // Se pasa principal y la lista de familiares
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
