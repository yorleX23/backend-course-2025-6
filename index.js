const http = require('http');
const path = require('path');
const fs = require('fs').promises;
const { existsSync } = require('fs');
const express = require('express');
const multer = require('multer');
const { program } = require('commander');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

// ---------------------------
// CLI ARGUMENTS
// ---------------------------
program
  .requiredOption('-H, --host <host>', 'server host')
  .requiredOption('-P, --port <port>', 'server port')
  .requiredOption('-C, --cache <cacheDir>', 'cache directory');

program.parse(process.argv);
const options = program.opts();

const HOST = options.host;
const PORT = options.port;
const CACHE_DIR = path.resolve(process.cwd(), options.cache);
const INVENTORY_FILE = path.join(CACHE_DIR, 'inventory.json');

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  if (!existsSync(INVENTORY_FILE)) {
    await fs.writeFile(INVENTORY_FILE, "[]", "utf-8");
  }
}

async function loadInventory() {
  try {
    const data = await fs.readFile(INVENTORY_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveInventory(inventory) {
  await fs.writeFile(INVENTORY_FILE, JSON.stringify(inventory, null, 2), "utf-8");
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: CACHE_DIR });

function buildPhotoUrl(req, id) {
  return `${req.protocol}://${req.get("host")}/inventory/${id}/photo`;
}

// ---------------------------
// STATIC HTML FORMS
// ---------------------------
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------
// 🔥 SWAGGER DOCS (JSDoc comments)
// ---------------------------

/**
 * @openapi
 * /register:
 *   post:
 *     summary: Реєстрація нового пристрою
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *               description:
 *                 type: string
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Пристрій створено
 */

/**
 * @openapi
 * /inventory:
 *   get:
 *     summary: Отримати список всіх речей
 *     responses:
 *       200:
 *         description: Список отримано
 */

/**
 * @openapi
 * /inventory/{id}:
 *   get:
 *     summary: Отримати інформацію про річ
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *     responses:
 *       200:
 *         description: Дані знайдено
 *       404:
 *         description: Не знайдено
 */

/**
 * @openapi
 * /inventory/{id}/photo:
 *   get:
 *     summary: Отримати фото речі
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *     responses:
 *       200:
 *         description: Фото знайдено
 *       404:
 *         description: Не знайдено
 */

/**
 * @openapi
 * /inventory/{id}:
 *   put:
 *     summary: Оновити інформацію про річ
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Оновлено
 *       404:
 *         description: Не знайдено
 */

/**
 * @openapi
 * /inventory/{id}/photo:
 *   put:
 *     summary: Оновити фото
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Фото оновлено
 *       404:
 *         description: Не знайдено
 */

/**
 * @openapi
 * /inventory/{id}:
 *   delete:
 *     summary: Видалити річ
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *     responses:
 *       200:
 *         description: Видалено
 *       404:
 *         description: Не знайдено
 */

/**
 * @openapi
 * /search:
 *   post:
 *     summary: Пошук речі
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               has_photo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Знайдено
 *       404:
 *         description: Не знайдено
 */

// ---------------------------
// ROUTES
// ---------------------------

app.post('/register', upload.single("photo"), async (req, res) => {
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

app.get('/inventory', async (req, res) => {
  const inventory = await loadInventory();
  const result = inventory.map(item => ({
    id: item.id,
    name: item.name,
    description: item.description,
    photoUrl: item.photoPath ? buildPhotoUrl(req, item.id) : null
  }));

  res.status(200).json(result);
});

app.get('/inventory/:id', async (req, res) => {
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

app.get("/inventory/:id/photo", async (req, res) => {
  const inventory = await loadInventory();
  const item = inventory.find(x => x.id === req.params.id);

  if (!item || !item.photoPath) {
    return res.status(404).json({ error: "Photo not found" });
  }

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Content-Disposition", "inline");

  const data = await fs.readFile(item.photoPath);
  res.end(data);
});

app.put('/inventory/:id', async (req, res) => {
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

app.put('/inventory/:id/photo', upload.single("photo"), async (req, res) => {
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

app.delete('/inventory/:id', async (req, res) => {
  const inventory = await loadInventory();
  const index = inventory.findIndex(x => x.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: "Not found" });
  }

  const [removed] = inventory.splice(index, 1);
  await saveInventory(inventory);

  res.status(200).json({ message: "Deleted", id: removed.id });
});

app.post('/search', async (req, res) => {
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

// ---------------------------
// SWAGGER INIT
// ---------------------------

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: { title: "Inventory API", version: "1.0.0" }
  },
  apis: ['./index.js']
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ---------------------------
// METHOD NOT ALLOWED
// ---------------------------
app.use((req, res) => {
  res.status(405).send("Method not allowed");
});

// ---------------------------
// START SERVER
// ---------------------------

async function start() {
  await ensureCacheDir();
  http.createServer(app).listen(PORT, HOST, () => {
    console.log(`SERVER RUNNING AT http://${HOST}:${PORT}`);
  });
}

start();
