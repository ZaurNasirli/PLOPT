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
