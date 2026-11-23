# План устранения белого экрана по опубликованной ссылке (Publish / Republish)

## 1. Причина проблемы
Поскольку по опубликованной ссылке (`Shared App URL`) сразу открывается **полностью белый экран** (даже без появления окна `RootErrorBoundary`), скрипт приложения падает или блокируется еще **на этапе загрузки / инициализации бандла до монтирования React**. Диагностика кода выявила три взаимосвязанные причины:

1. **Циклические импорты и ошибка инициализации (TDZ ReferenceError) в production-сборке (`vite build`)**:
   - `src/services/routingService.ts` статически реэкспортирует `smartLogisticsOptimizer.ts`, который в свою очередь импортирует функции из `routingService.ts`.
   - Одновременно `routingService.ts`, `routingProvider.ts` и `distanceMatrixManager.ts` образуют кольцо импортов (`calculateDistance` ↔ синглтоны `RoutingProviderService.getInstance()` / `DistanceMatrixManager.getInstance()`, вызываемые на верхнем уровне модуля).
   - При упаковке в единый минифицированный файл (`dist/assets/index-*.js`) Rollup выстраивает модули так, что обращение к константам/классам до завершения инициализации модуля вызывает `ReferenceError: Cannot access '...' before initialization` до запуска `createRoot`, оставляя пустой белый `#root`.
2. **Конфигурация путей `base: './'` в `vite.config.ts` и исключение `dist/` в `.gitignore`**:
   - Опция `base: './'` нарушает работу `vite.middlewares` при проксировании запросов и загрузке модулей.
   - Папка `dist/` указана в `.gitignore`, из-за чего при создании снапшота для публикации (`Publish` / `Republish`) готовая сборка может отсутствовать в контейнере, а сервер при отсутствии `dist/index.html` переключается на dev-middleware Vite с попыткой поднять WebSocket HMR.
3. **Незащищенные вызовы `localStorage` при первичной инициализации `App.tsx`**:
   - В `src/App.tsx` (строки 379 и 693) чтение `localStorage.getItem('autosave_timestamp_v1')` и `localStorage.getItem('routingLimits')` выполняется вне блока `try/catch`, что в режиме инкогнито или при строгих настройках безопасности браузера приводит к падению рендера.

---

## 2. Ключевые изменения

### Шаг 1. Разрыв циклических зависимостей в сервисах маршрутизации
- **Файлы**: `src/services/routingService.ts`, `src/services/routingProvider.ts`, `src/services/distanceMatrixManager.ts`, `src/services/smartLogisticsOptimizer.ts`
- Вынести базовую математическую функцию `calculateDistance` (расчет расстояния по формуле гаверсинуса) в независимый утилитарный модуль или локализовать её в `routingProvider.ts` и `distanceMatrixManager.ts`, чтобы они не импортировали `routingService.ts` по кругу.
- Убрать статический циклический реэкспорт `smartLogisticsOptimizer` из конца `routingService.ts` (в `App.tsx` он уже загружается через динамический `import('./services/smartLogisticsOptimizer')`).

### Шаг 2. Исправление конфигурации Vite и гарантированная отдача production-бандла в `server.ts`
- **Файлы**: `vite.config.ts`, `.gitignore`, `server.ts`, `package.json`
- В `vite.config.ts` установить стандартный `base: '/'`.
- Убрать `dist/` из `.gitignore`, чтобы скомпилированная папка `dist/` гарантированно попадала в снапшот при нажатии **Publish / Republish**.
- В `server.ts`:
  - Если сервер запущен в production-режиме, но `dist/index.html` по какой-либо причине отсутствует, автоматически выполнять программную сборку `const { build } = await import('vite'); await build();` перед запуском статики, чтобы опубликованная версия никогда не проваливалась в dev-режим с HMR.
  - Настроить корректную отдачу статики `express.static(distPath)` и SPA-маршрутизацию для всех путей, кроме `/api/*`.

### Шаг 3. Защита инициализации клиента и глобальный перехват ошибок до старта React
- **Файлы**: `src/App.tsx`, `src/main.tsx`, `index.html`
- Обернуть все оставшиеся вызовы `localStorage.getItem(...)` в `src/App.tsx` (строки 379 и 693) в безопасные блоки `try/catch`.
- В `index.html` и `src/main.tsx` добавить визуальный индикатор начальной загрузки внутри `#root` (который мгновенно заменяется интерфейсом при монтировании React) и глобальный обработчик `window.onerror` / `unhandledrejection`, чтобы при любой сетевой или браузерной ошибке вместо белого экрана выводилось окно диагностики с кнопкой перезапуска.

### Шаг 4. Сборка, проверка и перезапуск сервера
- Выполнить полную сборку проекта (`compile_applet`) и проверку типов (`lint_applet`).
- Перезапустить сервер приложения (`restart_dev_server`), чтобы изменения вступили в силу перед нажатием **Republish**.
