const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware global
app.use(cors());
app.use(express.json());

// Importar los módulos (que ahora exportan su instancia de 'app')
const arbolApp = require("./modulos/arbol.js");
const consumosApp = require("./modulos/consumos-sueldos.js");

// Usar las rutas de los módulos en nuestra app principal
// Dado que ambos módulos usan 'app.get("/...")', podemos montarlos directamente
// o usar sus manejadores de rutas. 

// Para mantener la compatibilidad total con las rutas actuales:
app.use("/", arbolApp);
app.use("/", consumosApp);

// Ruta de estado para verificar que todo esté funcionando
app.get("/status", (req, res) => {
    res.json({
        status: "ok",
        message: "Servidor unificado activo en Fly.io",
        modules: ["arbol", "consumos-sueldos"],
        timestamp: new Date().toISOString()
    });
});

// Iniciar el servidor único
app.listen(PORT, "0.0.0.0", () => {
    console.log(`=========================================`);
    console.log(`SERVIDOR UNIFICADO ACTIVO`);
    console.log(`Puerto: ${PORT}`);
    console.log(`Rutas de Árbol Genealógico: Cargadas`);
    console.log(`Rutas de Consumos y Sueldos: Cargadas`);
    console.log(`=========================================`);
});
