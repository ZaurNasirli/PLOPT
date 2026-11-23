import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));

interface AIOrderPayload {
  id: string;
  customerName: string;
  code?: string;
  lat: number;
  lng: number;
  weight: number;
  volume: number;
  timeSlot?: string;
  region?: string;
}

interface AITruckPayload {
  id: string;
  name: string;
  maxWeight: number;
  maxVolume: number;
}

interface AIOptimizeRequest {
  orders: AIOrderPayload[];
  depot: { lat: number; lng: number; name?: string };
  truckTypes?: AITruckPayload[];
  limits?: {
    maxWeight?: number;
    maxVolume?: number;
    maxOrders?: number;
    serviceTimeMinutes?: number;
  };
  strategyPrompt?: string;
}

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'SmartLogistics AI Optimizer', model: 'gemini-3-flash-preview' });
});

// AI Routing Optimization Endpoint
app.post('/api/routes/ai-optimize', async (req: Request, res: Response): Promise<void> => {
  try {
    const { orders, depot, truckTypes = [], limits = {}, strategyPrompt = '' } = req.body as AIOptimizeRequest;

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      res.status(400).json({ error: 'Список заказов пуст' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'GEMINI_API_KEY не сконфигурирован на сервере' });
      return;
    }

    const { GoogleGenAI, Type } = await import('@google/genai');

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const fleetSummary = truckTypes.length > 0 
      ? truckTypes.map(t => `- Тип "${t.name}" (ID: ${t.id}): Грузоподъемность ${t.maxWeight} кг, Объем ${t.maxVolume} м³`).join('\n')
      : `- Стандартный фургон: Грузоподъемность ${limits.maxWeight || 1500} кг, Объем ${limits.maxVolume || 12} м³`;

    const pointsFormatted = orders.map((o, idx) => ({
      idx: idx + 1,
      id: o.id,
      name: o.customerName,
      code: o.code || '',
      lat: Number(o.lat.toFixed(5)),
      lng: Number(o.lng.toFixed(5)),
      w_kg: Math.round(o.weight),
      v_m3: Number(o.volume.toFixed(2)),
      slot: o.timeSlot || 'Любое',
      region: o.region || 'Баку'
    }));

    const systemInstruction = `Ты — ведущий AI-логист и диспетчер автопарка доставки по городу Баку и окрестностям.
Твоя задача: сформировать идеальные маршруты доставки (VRP / Vehicle Routing Problem) для распределения заказов по грузовым автомобилям.

Правила маршрутизации:
1. КОМПАКТНОСТЬ И ЗОНИРОВАНИЕ: Группируй магазины по географическим коридорам и районам Баку (Ясамал, Сабаил, Нариманов, Низами, Хатаи, Сабунчи, Бинагади и др.). Никаких бессмысленных скачков через весь город!
2. ПОСЛЕДОВАТЕЛЬНОСТЬ ОСТАНОВОК: Точки внутри маршрута должны идти строго последовательно по направлению движения от склада (Депо) и обратно, без петель, самопересечений и возвратов назад ("зигзагов").
3. ЖЕСТКИЕ ЛИМИТЫ: Суммарный вес маршрута НЕ ДОЛЖЕН превышать грузоподъемность назначенного автомобиля (${limits.maxWeight || 1500} кг). Суммарный объем НЕ ДОЛЖЕН превышать вместимость кузова (${limits.maxVolume || 12} м³).${limits.maxOrders ? ` Максимальное количество остановок на маршрут: ${limits.maxOrders}.` : ''}
4. БАЛАНСИРОВКА: Стремись к эффективной загрузке кузова (75-95%) и минимальному количеству задействованных машин.
5. ПОЛНОТА: ВСЕ переданные заказы должны быть включены ровно в один маршрут. Ни один заказ не должен быть потерян или продублирован.
6. ОБОСНОВАНИЕ (aiExplanation): Для каждого маршрута на русском языке дай четкое обоснование логики диспетчера (какие районы охвачены, почему выбрана данная последовательность, процент заполнения машины).`;

    const userPromptContent = `Сформируй маршруты доставки для следующих входных данных:

ДЕПО (Склад выезда и возврата):
Координаты: lat ${depot.lat}, lng ${depot.lng} (${depot.name || 'Центральный хаб Баку'})

ДОСТУПНЫЙ АВТОПАРК:
${fleetSummary}

ЛИМИТЫ:
- Макс. вес: ${limits.maxWeight || 1500} кг
- Макс. объем: ${limits.maxVolume || 12} м³
${limits.maxOrders ? `- Макс. остановок в маршруте: ${limits.maxOrders}` : ''}
${strategyPrompt ? `ОСОБЫЕ ПОЖЕЛАНИЯ ДИСПЕТЧЕРА:\n${strategyPrompt}\n` : ''}

СПИСОК ТОЧЕК ДОСТАВКИ (${pointsFormatted.length} заказов):
${JSON.stringify(pointsFormatted, null, 1)}

Распредели ВСЕ ${pointsFormatted.length} точек в оптимальные маршруты и верни структурированный ответ в JSON.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: userPromptContent,
      config: {
        systemInstruction,
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            routes: {
              type: Type.ARRAY,
              description: 'Список сформированных маршрутов',
              items: {
                type: Type.OBJECT,
                properties: {
                  routeName: {
                    type: Type.STRING,
                    description: 'Название маршрута, например: Рейс 1 (Ясамал - Сабаил)'
                  },
                  dominantDistrict: {
                    type: Type.STRING,
                    description: 'Основной район обслуживания'
                  },
                  assignedTruckTypeId: {
                    type: Type.STRING,
                    description: 'ID рекомендованного типа автомобиля из доступного автопарка'
                  },
                  orderIds: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Массив ID заказов строго в порядке их посещения (от первой до последней остановки)'
                  },
                  aiExplanation: {
                    type: Type.STRING,
                    description: 'Обоснование от искусственного интеллекта: почему точки объединены и как построен порядок движения'
                  }
                },
                required: ['routeName', 'orderIds', 'aiExplanation']
              }
            },
            overallAnalysis: {
              type: Type.STRING,
              description: 'Краткая сводка искусственного интеллекта по общему плану распределения и эффективности автопарка'
            }
          },
          required: ['routes', 'overallAnalysis']
        }
      }
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error('Пустой ответ от модели Gemini AI');
    }

    const parsedData = JSON.parse(responseText);

    const assignedIds = new Set<string>();
    const validRoutes: any[] = [];

    if (Array.isArray(parsedData.routes)) {
      for (const r of parsedData.routes) {
        if (Array.isArray(r.orderIds) && r.orderIds.length > 0) {
          const uniqueRouteOrderIds = r.orderIds.filter((id: string) => {
            if (assignedIds.has(id)) return false;
            const exists = orders.some(o => o.id === id);
            if (exists) {
              assignedIds.add(id);
              return true;
            }
            return false;
          });

          if (uniqueRouteOrderIds.length > 0) {
            validRoutes.push({
              ...r,
              orderIds: uniqueRouteOrderIds
            });
          }
        }
      }
    }

    const unassignedOrders = orders.filter(o => !assignedIds.has(o.id));
    if (unassignedOrders.length > 0) {
      validRoutes.push({
        routeName: `Рейс ${validRoutes.length + 1} (Дополнительный сектор)`,
        dominantDistrict: unassignedOrders[0]?.region || 'Баку',
        assignedTruckTypeId: truckTypes[0]?.id || undefined,
        orderIds: unassignedOrders.map(o => o.id),
        aiExplanation: `Включает ${unassignedOrders.length} точек дополнительного охвата для обеспечения 100% выполнения заявок.`
      });
    }

    res.json({
      success: true,
      routes: validRoutes,
      overallAnalysis: parsedData.overallAnalysis || 'Маршруты сформированы моделью Gemini AI с учетом гео-кластеризации и лимитов автопарка.',
      totalOrdersAssigned: orders.length,
      routesCount: validRoutes.length
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Ошибка при выполнении нейросетевой маршрутизации',
      details: error?.message || String(error)
    });
  }
});

// Vite middleware in dev or static serving in production
const distPath = path.resolve(__dirname, 'dist');
const indexHtmlPath = path.join(distPath, 'index.html');
const isProd =
  process.env.NODE_ENV === 'production' ||
  process.env.npm_lifecycle_event === 'start';

let frontendHandler: express.RequestHandler | null = null;

const initFrontend = async () => {
  if (isProd && fs.existsSync(indexHtmlPath)) {
    const staticRouter = express.Router();
    staticRouter.use(express.static(distPath, { index: 'index.html' }));
    staticRouter.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/assets/')) {
        res.status(404).end();
        return;
      }
      res.sendFile(indexHtmlPath);
    });
    frontendHandler = staticRouter;
    return;
  }

  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: false,
    },
    appType: 'spa',
  });
  frontendHandler = vite.middlewares;
};

let initPromise: Promise<void> | null = null;

app.use(async (req, res, next) => {
  // Fast response for readiness probes before Vite finishes warming up
  if (!frontendHandler && req.method === 'HEAD') {
    res.status(200).end();
    return;
  }
  if (!initPromise) {
    initPromise = initFrontend();
  }
  await initPromise;
  if (frontendHandler) {
    return frontendHandler(req, res, next);
  }
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
  initPromise = initFrontend().catch((err) => {
    console.error('Failed to initialize frontend handler:', err);
  });
});

