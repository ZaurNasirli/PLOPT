<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/f8d975c5-8921-4049-9ed6-712e3d9d471d

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Облачная база данных (Firebase, бесплатный план)

Данные (заказы, маршруты, сценарии, улицы, водители и смены, настройки) сохраняются в Firebase Firestore
для каждого пользователя отдельно, после входа через Google. Без настроенного Firebase приложение работает
как раньше — данные хранятся только в браузере.

1. https://console.firebase.google.com → **Add project** (Google Analytics можно отключить). Тариф Spark бесплатный.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**.
3. **Authentication → Settings → Authorized domains → Add domain**: домен сайта на Vercel (например `plopt.vercel.app`).
4. **Build → Firestore Database → Create database** → регион (например `eur3`) → *Start in production mode*.
5. **Firestore → Rules**: вставьте содержимое файла [`firestore.rules`](firestore.rules) → **Publish**.
6. **Project settings → General → Your apps → `</>` (Web)** → зарегистрируйте приложение и скопируйте `firebaseConfig`.
7. **Vercel → Project → Settings → Environment Variables**: добавьте значения из `firebaseConfig`:
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.
8. **Deployments → Redeploy** (переменные попадают в сайт только при сборке).

После этого в шапке появится кнопка облака → «Войти через Google». При первом входе данные из браузера
выгружаются в облако; на других устройствах после входа тем же аккаунтом загружаются из облака.

Структура хранения: `users/{uid}/data/{ключ}__{часть}` — каждое значение хранится как JSON, разбитый на части
до 300 000 символов (лимит документа Firestore 1 МБ). Это экономит бесплатную квоту: загрузка всех данных —
несколько чтений, сохранение — одна запись на изменённую часть.

## Барьеры (закрытые дороги)

Вкладка **«Барьеры»** (значок 🚧 в левой панели):

- **Закрыть участок** — клик по улице закрывает участок дороги между перекрёстками (обе проезжие части).
  Барьер привязывается к ближайшей дороге, в списке показывается название улицы.
- **Закрыть зону** — круг радиусом 50–1500 м, закрываются все дороги внутри.
- **Закрыть улицу целиком** — улица, выделенная на вкладке «Улицы».

Как учитывается:
- **Линии маршрутов** — если линия проходит через барьер, она перестраивается в объезд
  (метка «Объезд барьера»; если объезда нет — «Через барьер»). После добавления/отключения барьера
  затронутые маршруты перестраиваются автоматически.
- **SMART-маршрутизация и «Оптимизировать все маршруты»** — в матрице расстояний пары точек, чей
  кратчайший путь идёт через барьер, получают реальное время объезда, поэтому распределение заказов
  и порядок точек меняются. Классические алгоритмы считают по прямой, на них влияет только линия.

Объезды строит бесплатный сервер Valhalla (`valhalla1.openstreetmap.de`, OpenStreetMap): публичный OSRM
не умеет избегать дорог. Ограничения сервера (10 точек на маршрут, 100 пар на матрицу, 50 точек-исключений)
учтены: длинные маршруты делятся на части, а через Valhalla пересчитываются только пары, путь которых
действительно проходит через барьер (определяется по OSRM: t(i→барьер) + t(барьер→j) ≈ t(i→j)).

## SMART-оптимизатор: скорость и качество

- **Бюджет времени** вместо фиксированного числа итераций: «быстрый» ≈ 2–6 с, «сбалансированный» ≈ 4–15 с,
  «качество» ≈ 10–40 с (зависит от числа точек). ~35% времени — стартовые решения + локальный поиск,
  затем **LNS «разрушить и восстановить»** до конца бюджета, в конце — полировка.
- **Фоновый поток (Web Worker)**: интерфейс не замирает во время расчёта.
- Локальный поиск: кэш оценок маршрутов, отсев ходов по изменению километража, межмаршрутные ходы только
  между соседними точками.

Пример (оценочная матрица, без сети): 100 заказов «быстрый» — было 54 с, стало 3 с; «сбалансированный» —
было > 4 мин, стало 6.5 с; качество решения (целевая функция) не хуже, в большинстве случаев лучше.

## Кэш дорожных расстояний и справочник магазинов

- Все реальные расстояния/время, которые программа узнала (матрица OSRM и участки построенных маршрутов),
  сохраняются: в браузере (IndexedDB) и, после входа, в облаке (`users/{uid}/roads`, один документ на точку).
  Повторная маршрутизация тех же магазинов не обращается к внешним серверам. Значения старше 120 дней
  обновляются; барьеры применяются поверх кэша и в него не записываются.
- Матрица хранится с точностью до метра/секунды; до 300 точек — 100% реальных дорог (блоки 50×50).
- **Справочник магазинов**: при импорте Excel все магазины (код, название, координаты, регион) сохраняются;
  если в новом файле нет координат или они ошибочны — подставляются из справочника.

## Ritm (module «Rota» in the code): shipment days and parties of stores

The **Ritm** page plans on which weekdays and in which shipment party every store is shipped.
Everything lives in `src/rota/`:

- `data/` — store file import (column auto-detection, check dialog), demo data;
- `rules/` — rule sets, rules Excel file (import in ru/az/en/tr, export, empty template), rules check;
- `engine/` — the optimizer (port of the Python reference): model, cost, simulated annealing,
  exact group repair, report; runs in Web Workers (`engine.worker.ts`), seeds of a phase in parallel;
- `components/` — the tabs; `i18n/` — texts in ru/az/en/tr; `store/` — workspace (IndexedDB + cloud key `rota`).

There are **no default rules**: every party, penalty and algorithm phase comes from the user
(by hand on the Rules tab or from the rules Excel file).

Tabs:

- **Analytics** — day balance, before/after chart, heat maps day × party / day × region, "N or 0" matrix,
  truck load; Excel export in the layout of the reference file (formulas recalculate in Excel) and PDF.
- **Kanban** — one card per store-day, party lanes, drag to move a day (Alt/Shift or "Add day" adds it),
  bulk actions, conflicts panel, store card with locks and exceptions. Hard rules refuse a change with the
  reason; soft rules only warn. Every change is one undo step (Ctrl+Z / Ctrl+Y).
- **Map** — clusters, colour by days / party / segment, lasso selection, seven day mini maps with the store list.
- **Rules** — rule sets, seven tables, Excel import (ru/az/en/tr) with a preview, export, empty template, check.
- **Scenarios** — original / current / saved plans (an applied optimization is saved automatically),
  comparison, roll back, JSON export/import of all Rota data.
- **Report** — store changes with reasons (copy / Excel), chain moves, remaining "N or 0" violations with reasons.

The optimizer runs in Web Workers ("Exact" or "Fast" mode, scope, balance ↔ fewer changes, N-or-0 strictness,
seed); "Stop" returns the best plan found so far.

Two looks are available (Rota → «Стиль»): PL/OPT and LogistikPro. They differ only in CSS variables
(`src/rota/rota-theme.css`), so either can be made the default without touching components.

Tests: `npm test` (vitest). Acceptance run on the reference data (files in the git-ignored `_rota_import/`):

```bash
npx tsx scripts/rota-acceptance.ts                # exact mode, fixed seed
npx tsx scripts/rota-acceptance.ts --fast --seed 7
npx tsx scripts/rota-acceptance.ts --w Wreg=900,Wparty=800   # try other penalties without editing the file
```
npx tsx scripts/rota-acceptance.ts --fast --rhythm orders.xlsx   # split the volumes by the real rhythm of an orders file
```

### Week split: even or by the real rhythm

Ritm splits a store's weekly volume over its shipment days. **Even** (default): 20 m³ and 2 days → 10 + 10,
exactly as the reference. **By rhythm**: each shipment carries the consumption of the days it covers until the
next shipment, by the weekday pattern Proqnoz learned from real orders (`src/rota/core/rhythm.ts`), e.g.
Mon + Thu → 7.4 + 12.6. The switch is next to the balance; it is available once Proqnoz has sent a rhythm.
The optimizer, the balance, Kanban, Map, analytics and the reference Excel export (share columns + formulas)
all use the same split.

## Proqnoz: next week's orders from real orders

`src/forecast/`. Load an Excel of real orders of 2–4 weeks: one row = one store order for a date (the order
date, even when the truck leaves after midnight); columns are found by their headers (ru/az/en/tr) and can be
changed by hand. Store names / regions / formats go through the store directory ("which one is main?").

- Per store forecast for the next Monday–Sunday week in every measure of the file (m³, kg, pcs) with an 80% range;
  the method (weighted average, average, median, last week, trend) is chosen by a backtest on the past weeks.
- **Openings**: a store with no orders in the first N weeks of the data (setting, 1 by default) and orders later
  is new; openings per week and the expected openings of next week (Poisson range).
- **Closures**: no orders for 15 days (setting) = closed, no forecast.
- **Real rhythm**: the chain's daily consumption pattern and every store's own pattern, learned from how its
  week is split between its order days (the direction "order covers the days after / before it" is chosen by fit).
- **Send to Ritm**: forecast volumes replace Ritm's weekly volumes (the store file values are kept —
  «Вернуть объёмы из файла»), the rhythm switches Ritm's split to "by rhythm"; new stores not in Ritm can be
  downloaded in the Ritm store file layout.
- Excel export (stores, weeks, openings/closures, rhythm); data stays in this browser.
