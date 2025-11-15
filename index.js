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
// 1. Читаємо аргументи командного рядка
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

console.log('Parsed options:', options);

// ---------------------------
// 2. Підготовка кеш-директорії
// ---------------------------
async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  if (!existsSync(INVENTORY_FILE)) {
    await fs.writeFile(INVENTORY_FILE, '[]', 'utf-8');
  }
}

// ---------------------------
// 3. Робота з JSON-базою інвентаря
// ---------------------------
async function loadInventory() {
  try {
    const data = await fs.readFile(INVENTORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveInventory(inventory) {
  await fs.writeFile(INVENTORY_FILE, JSON.stringify(inventory, null, 2), 'utf-8');
}

// ---------------------------
// 4. Express додаток
// ---------------------------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------------------
// 5. Multer для фото
// ---------------------------
const upload = multer({
  dest: CACHE_DIR
});

// ---------------------------
// 6. Генерація URL фото
// ---------------------------
function buildPhotoUrl(req, id) {
  return `${req.protocol}://${req.get('host')}/inventory/${id}/photo`;
}

// ---------------------------
// 7. Маршрути HTML-форм
// ---------------------------
app.get('/RegisterForm.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'RegisterForm.html'));
});

app.get('/SearchForm.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'SearchForm.html'));
});

// ---------------------------
// 8. POST /register – реєстрація пристрою
// ---------------------------
app.post('/register', upload.single('photo'), async (req, res) => {
  const { inventory_name, description } = req.body;

  if (!inventory_name || inventory_name.trim() === '') {
    return res.status(400).json({ error: 'inventory_name is required' });
  }

  const inventory = await loadInventory();
  const id = Date.now().toString();

  const item = {
    id,
    name: inventory_name,
    description: description || '',
    photoPath: req.file ? req.file.path : null
  };

  inventory.push(item);
  await saveInventory(inventory);

  res.status(201).json({
    message: 'Created',
    id: item.id,
    name: item.name,
    description: item.description,
    photoUrl: item.photoPath ? buildPhotoUrl(req, item.id) : null
  });
});

// ---------------------------
// 9. GET /inventory – список всіх речей
// ---------------------------
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

// ---------------------------
// 10. GET /inventory/:id – інформація про одну річ
// ---------------------------
app.get('/inventory/:id', async (req, res) => {
  const { id } = req.params;
  const inventory = await loadInventory();

  const item = inventory.find(x => x.id === id);

  if (!item) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.status(200).json({
    id: item.id,
    name: item.name,
    description: item.description,
    photoUrl: item.photoPath ? buildPhotoUrl(req, item.id) : null
  });
});

// ---------------------------
// 11. PUT /inventory/:id – оновлення полів
// ---------------------------
app.put('/inventory/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  const inventory = await loadInventory();
  const item = inventory.find(x => x.id === id);

  if (!item) return res.status(404).json({ error: 'Not found' });

  if (name !== undefined) item.name = name;
  if (description !== undefined) item.description = description;

  await saveInventory(inventory);

  res.status(200).json({
    message: 'Updated',
    id: item.id,
    name: item.name,
    description: item.description
  });
});

// ---------------------------
// 12. GET /inventory/:id/photo – отримання фото
// ---------------------------
app.get('/inventory/:id/photo', async (req, res) => {
  const { id } = req.params;
  const inventory = await loadInventory();
  const item = inventory.find(x => x.id === id);

  if (!item || !item.photoPath) {
    return res.status(404).json({ error: 'Photo not found' });
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.sendFile(path.resolve(item.photoPath));
});

// ---------------------------
// 13. PUT /inventory/:id/photo – оновити фото
// ---------------------------
app.put('/inventory/:id/photo', upload.single('photo'), async (req, res) => {
  const { id } = req.params;

  const inventory = await loadInventory();
  const item = inventory.find(x => x.id === id);

  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'photo file is required' });

  item.photoPath = req.file.path;

  await saveInventory(inventory);

  res.status(200).json({
    message: 'Photo updated',
    id: item.id,
    photoUrl: buildPhotoUrl(req, item.id)
  });
});

// ---------------------------
// 14. DELETE /inventory/:id – видалити річ
// ---------------------------
app.delete('/inventory/:id', async (req, res) => {
  const { id } = req.params;

  const inventory = await loadInventory();
  const index = inventory.findIndex(x => x.id === id);

  if (index === -1) return res.status(404).json({ error: 'Not found' });

  const [removed] = inventory.splice(index, 1);
  await saveInventory(inventory);

  res.status(200).json({ message: 'Deleted', id: removed.id });
});

// ---------------------------
// 15. POST /search – пошук через HTML форму
// ---------------------------
app.post('/search', async (req, res) => {
  const { id, has_photo } = req.body;

  const inventory = await loadInventory();
  const item = inventory.find(x => x.id === id);

  if (!item) return res.status(404).send('Item not found');

  let description = item.description;

  if (has_photo && item.photoPath) {
    description += `\nPhoto: ${buildPhotoUrl(req, item.id)}`;
  }

  res.status(200).json({
    id: item.id,
    name: item.name,
    description,
    hasPhoto: !!item.photoPath
  });
});



// ---------------------------
// 17. Swagger документація
// ---------------------------
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Inventory Service API',
      version: '1.0.0'
    }
  },
  apis: []
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ---------------------------
// 16. Method Not Allowed
// ---------------------------
app.use((req, res) => {
  res.status(405).send('Method not allowed');
});



// ---------------------------
// 18. Старт сервера
// ---------------------------
async function start() {
  await ensureCacheDir();

  const server = http.createServer(app);

  server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
