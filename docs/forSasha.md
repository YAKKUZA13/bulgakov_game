[1 tool called]

Ниже — краткая карта проекта для нового разработчика: какие модули участвуют в сборке, где что лежит и за что отвечает.

## Сборка и инфраструктура
- **Vite** — сборщик и dev‑сервер. Конфиг: `vite.config.ts` (HTTPS, порт 5173, host 0.0.0.0).
- **TypeScript** — компиляция. Конфиг: `tsconfig.json` (strict, ES2022, ESNext).
- **Скрипты**: `package.json`  
  - `dev` — локальный HTTPS dev‑сервер (нужен для камеры)  
  - `build` — `tsc` + `vite build`  
  - `preview` — просмотр прод‑сборки  
  - `download:depth-model` — загрузка модели глубины

## Входные точки и основной поток
- **`index.html`** — точка входа, подхватывает `/src/main.ts`
- **`src/main.ts`** — старт приложения, вызывает `startApp()`
- **`src/app/app.ts`** — главный оркестратор:
  - инициализация систем (камера, трекинг, сцена, физика, UI)
  - управление режимами игры (runner/angry/treasure)
  - основной рендер‑цикл
  - обработка событий

## Ключевые модули внутри `src/`
### Графика и сцена
- **`src/scene/scene.ts`** — настройка Three.js:
  - renderer, camera, свет, raycaster

### Камера
- **`src/camera.ts`** — работа с MediaStream (запуск/остановка камеры, ошибки, разрешения)

### Трекинг и MR
- **`src/mr/tracking/tracker.ts`**
  - если доступен `alva_ar.js`, использует визуальный SLAM
  - иначе — fallback на ориентацию/движение устройства
  - возвращает позу камеры и статус трекинга

- **`src/mr/mapping/plane-mapper.ts`**
  - построение плоскостей по глубине (RANSAC)
  - используется для «поверхностей» в мире

### Глубина
- **`src/depth/depth.ts`**
  - ML‑оценка глубины через `@xenova/transformers`
  - модель лежит в `public/models/...`
- **`src/depth/depth-mesh.ts`** — построение меша по глубине (если включается)
- **`src/depth/colormap.ts`** — визуализация карт глубины

### Физика
- **`src/physics/world.ts`** — обёртка над `cannon-es`, синхронизация тел с Three.js

### Игровые режимы
- **`src/game/runner/runner.ts`** — бегун
- **`src/game/angry/angry.ts`** — «Angry Birds» стиль
- **`src/game/treasure/treasure.ts`** — поиск объектов
- **`src/game/player.ts`, `src/game/anchors.ts`** — общие сущности

### UI
- **`src/ui/layout.ts`** — DOM‑разметка и кнопки управления
- **`src/ui/joystick.ts`** — виртуальный джойстик

### Окклюзия
- **`src/occlusion/mask.ts`** и **`src/occlusion/draw-ui.ts`** — маски и overlay (если используется)

### PWA
- **`src/pwa.ts`** — регистрация service worker

### Стили
- **`src/style.css`** — глобальные стили

## Публичные ассеты (`public/`)
- **`public/sw.js`** — service worker (минимальный кеш)
- **`public/manifest.webmanifest`**, иконки — PWA
- **`public/models/Xenova/depth-anything-small-hf/`** — ML‑модель глубины (локально)
- **`public/vendor/alva_ar.js`** — библиотека SLAM (опционально, GPLv3)

## Документация
- **`docs/TECHNICAL_OVERVIEW.md`** — архитектура
- **`docs/chek.md`, `docs/feture.md`** — фичи/чеклисты
- **`docs/vendor/AlvaAR_README.md`** — интеграция AlvaAR

---

Если нужно, могу добавить **графический архитектурный обзор** или **короткий onboarding‑гайд** с первыми задачами и запуском проекта.