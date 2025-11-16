const http = require('http');
const path = require('path');
const fs = require('fs').promises;
const { existsSync } = require('fs');
const express = require('express');
const multer = require('multer');
const { program } = require('commander');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

// =====================================================================
// 1. CLI аргументи
// =====================================================================
program
  .requiredOption('-H, --host <host>', 'server host')
  .requiredOption('-P, --port <port>', 'server port')
  .requiredOption('-C, --cache <cacheDir>', 'cache directory');

program.parse(process.argv);
const opts = program.opts();

const HOST = opts.host;
const PORT = opts.port;
const CACHE_DIR = path.resolve(process.cwd(), opts.cache);
const INVENTORY_FILE = path.join(CACHE_DIR, 'inventory.json');

console.log("SERVER CONFIG:", opts);

// =====================================================================
// 2. Ініціалізація кешу
// =====================================================================
async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  if (!existsSync(INVENTORY_FILE)) {
    await fs.writeFile(INVENTORY_FILE, "[]", "utf-8");
  }
}

// =====================================================================
// 3. "База даних" JSON
// =====================================================================
async function loadInventory() {
  try {
    const raw = await fs.readFile(INVENTORY_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveInventory(inv) {
  await fs.writeFile(INVENTORY_FILE, JSON.stringify(inv, null, 2), "utf-8");
}

// =====================================================================
// 4. Створення Express
// =====================================================================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================================================
// 5. Multer (для завантаження фото)
// =====================================================================
const upload = multer({ dest: CACHE_DIR });

// =====================================================================
// 6. Формування URL фото
// =====================================================================
function buildPhotoUrl(req, id) {
  return `${req.protocol}://${req.get("host")}/inventory/${id}/photo`;
}

// =====================================================================
// 7. HTML форми
// =====================================================================
app.get("/RegisterForm.html", (req, res) => {
  res.sendFile(path.join(__dirname, "RegisterForm.html"));
});

app.get("/SearchForm.html", (req, res) => {
  res.sendFile(path.join(__dirname, "SearchForm.html"));
});

// =====================================================================
// 8. POST /register
// =====================================================================
app.post("/register", upload.single("photo"), async (req, res) => {
  const { inventory_name, description } = req.body;

  if (!inventory_name || inventory_name.trim() === "") {
    return res.status(400).json({ error: "inventory_name is required" });
  }

  const inventory = await loadInventory();
  const id = Date.now().toString();

  const item = {
    id,
    name: inventory_name,
    description: description || "",
    photoPath: req.file ? req.file.path : null
  };

  inventory.push(item);
  await saveInventory(inventory);

  res.status(201).json({
    message: "Created",
    id,
    name: item.name,
    description: item.description,
    photoUrl: item.photoPath ? buildPhotoUrl(req, id) : null
  });
});

// =====================================================================
// 9. GET /inventory
// =====================================================================
app.get("/inventory", async (req, res) => {
  const inventory = await loadInventory();
  const mapped = inventory.map(item => ({
    id: item.id,
    name: item.name,
    description: item.description,
    photoUrl: item.photoPath ? buildPhotoUrl(req, item.id) : null
  }));

  res.status(200).json(mapped);
});

// =====================================================================
// 10. GET /inventory/:id
// =====================================================================
app.get("/inventory/:id", async (req, res) => {
  const inventory = await loadInventory();
  const item = inventory.find(x => x.id === req.params.id);

  if (!item) return res.status(404).json({ error: "Not found" });

  res.status(200).json({
    id: item.id,
    name: item.name,
    description: item.description,
    photoUrl: item.photoPath ? buildPhotoUrl(req, item.id) : null
  });
});

// =====================================================================
// 11. PUT /inventory/:id
// =====================================================================
app.put("/inventory/:id", async (req, res) => {
  const inventory = await loadInventory();
  const item = inventory.find(x => x.id === req.params.id);

  if (!item) return res.status(404).json({ error: "Not found" });

  item.name = req.body.name ?? item.name;
  item.description = req.body.description ?? item.description;

  await saveInventory(inventory);

  res.status(200).json({
    message: "Updated",
    id: item.id,
    name: item.name,
    description: item.description
  });
});

// =====================================================================
// 12. GET /inventory/:id/photo  (ВИДАЧА ФОТО)
// =====================================================================
app.get("/inventory/:id/photo", async (req, res) => {
  const inventory = await loadInventory();
  const item = inventory.find(x => x.id === req.params.id);

  if (!item || !item.photoPath) {
    return res.status(404).json({ error: "Photo not found" });
  }

  try {
    const data = await fs.readFile(item.photoPath);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", "inline"); // показує фото в браузері
    res.end(data);
  } catch {
    res.status(404).json({ error: "Photo not found" });
  }
});

// =====================================================================
// 13. PUT /inventory/:id/photo (оновлення фото)
// =====================================================================
app.put("/inventory/:id/photo", upload.single("photo"), async (req, res) => {
  const inventory = await loadInventory();
  const item = inventory.find(x => x.id === req.params.id);

  if (!item) return res.status(404).json({ error: "Not found" });
  if (!req.file) return res.status(400).json({ error: "photo is required" });

  item.photoPath = req.file.path;
  await saveInventory(inventory);

  res.status(200).json({
    message: "Photo updated",
    photoUrl: buildPhotoUrl(req, item.id)
  });
});

// =====================================================================
// 14. DELETE /inventory/:id
// =====================================================================
app.delete("/inventory/:id", async (req, res) => {
  const inventory = await loadInventory();
  const index = inventory.findIndex(x => x.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: "Not found" });
  }

  const [removed] = inventory.splice(index, 1);
  await saveInventory(inventory);

  res.status(200).json({ message: "Deleted", id: removed.id });
});

// =====================================================================
// 15. POST /search
// =====================================================================
app.post("/search", async (req, res) => {
  const { id, has_photo } = req.body;
  const inventory = await loadInventory();
  const item = inventory.find(x => x.id === id);

  if (!item) return res.status(404).json({ error: "Not found" });

  let desc = item.description;

  if (has_photo && item.photoPath) {
    desc += `\nPhoto: ${buildPhotoUrl(req, id)}`;
  }

  res.status(200).json({
    id: item.id,
    name: item.name,
    description: desc,
    hasPhoto: !!item.photoPath
  });
});

// =====================================================================
// 16. Swagger документація
// =====================================================================
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: { title: "Inventory Service API", version: "1.0.0" }
  },
  apis: ['./index.js']
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// =====================================================================
// 17. 405 Method Not Allowed
// =====================================================================
app.use((req, res) => {
  res.status(405).send("Method not allowed");
});

// =====================================================================
// 18. START SERVER
// =====================================================================
async function start() {
  await ensureCacheDir();
  http.createServer(app).listen(PORT, HOST, () => {
    console.log(`SERVER RUNNING → http://${HOST}:${PORT}`);
  });
}

start();
