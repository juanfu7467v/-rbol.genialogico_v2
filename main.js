const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware global
app.use(cors());
app.use(express.json());

// Importar los routers de los módulos
const arbolRouter = require("./modulos/arbol.js");
const consumosRouter = require("./modulos/consumos-sueldos.js");

// Montar los routers directamente en la raíz
// Asegúrate de que los archivos en /modulos usen express.Router()
app.use("/", arbolRouter);
app.use("/", consumosRouter);

// Ruta de estado
app.get("/status", (req, res) => {
    res.json({
        status: "ok",
        message: "Servidor unificado activo en Fly.io",
        modules: ["arbol", "consumos-sueldos"],
        timestamp: new Date().toISOString()
    });
});

app.get("/", (req, res) => {
    res.json({ message: "Servidor principal activo" });
});

// Iniciar el servidor
app.listen(PORT, "0.0.0.0", () => {
    console.log(`=========================================`);
    console.log(`SERVIDOR UNIFICADO ACTIVO EN PUERTO: ${PORT}`);
    console.log(`=========================================`);
});
