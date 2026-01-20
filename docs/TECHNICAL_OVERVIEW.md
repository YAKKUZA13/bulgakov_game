# Техническое описание системы (MR Game Demo)

Этот документ предназначен для передачи контекста другим AI‑агентам и продолжения разработки на другом ПК.

## Коротко о проекте
Проект — web‑MR демо на Vite + Three.js, с depth‑estimation (Depth Anything), простым mapping поверхностей и физикой (cannon‑es). Есть 3 механики:
1) **Runner** — кубик бежит и прыгает по поверхности.
2) **Angry** — метание примитивов по конструкциям на поверхности.
3) **Treasure** — поиск виртуальных предметов по позе камеры и направлению взгляда.

Цель — **непрерывный трекинг позы в браузере** без ARCore/ARKit, с живым миром (объекты остаются на месте при движении телефона).

## Планы, цели и задачи
- **Цель**: MR‑игра с 3 механиками на реальных поверхностях без ARCore/ARKit.
- **План**: исходный план работ лежит в `.cursor/plans/mr-game-3-mechanics_ae6ff5c1.plan.md` (не редактировать).
- **Текущие задачи (обновлять по мере работы)**:
  1) Реально подключить AlvaAR (`public/vendor/alva_ar.js` + wasm).
  2) Стабилизировать поверхности/карту (clustering, таймауты, сглаживание).
  3) Улучшить detection нескольких плоскостей.
  4) Привязать Runner к плоскости (касательная, нормаль для прыжка).
  5) Перенести depth‑инференс в Worker, keyframe‑политика.

## Архитектура и основные модули
- `src/app/app.ts` — главный bootstrap, state machine режимов, цикл рендера.
- `src/mr/tracking/tracker.ts` — адаптер трекинга: пытается загрузить **AlvaAR** из `/vendor/alva_ar.js` с автопоиском wasm через `Module.locateFile`, иначе fallback на device sensors.
- `src/mr/mapping/plane-mapper.ts` — depth keyframes → 3D точки → RANSAC плоскость (доминирующая).
- `src/physics/world.ts` — обёртка над `cannon-es`: мир, шаг, синхронизация мешей.
- `src/game/runner/runner.ts` — кубик‑runner как физический body.
- `src/game/angry/angry.ts` — примитивы + метание снарядов.
- `src/game/treasure/treasure.ts` — предметы + проверка видимости/дистанции.
- `src/ui/layout.ts` + `src/ui/joystick.ts` — UI и джойстик.
- `src/depth/*` — depth estimation и построение depth‑mesh.

## Поток данных (упрощённо)
1. Камера → видео → трекер (AlvaAR или fallback).
2. Поза камеры → Three.Camera (position+quaternion).
3. Раз в ~1.5с depth‑кадр → PlaneMapper → доминирующая плоскость.
4. **SLAM‑плоскость** (AlvaAR `findPlane`) — первичный источник поверхности (если доступна).
5. Плоскость → debug mesh + physics plane.
5. Игровой режим → взаимодействует с physics/scene.

## Интеграция AlvaAR (важно)
В AlvaAR примерах используется `alva_ar.js` + `alva_ar_three.js`. Мы реализуем ту же математику преобразования позы, что и `AlvaARConnectorTHREE`:
```javascript
const r = new THREE.Quaternion().setFromRotationMatrix(matrix);
const t = new THREE.Vector3(pose[12], pose[13], pose[14]);
camera.quaternion.set(-r.x, r.y, r.z, r.w);
camera.position.set(t.x, -t.y, -t.z);
```
Это уже применено в `src/mr/tracking/tracker.ts`.

### Как подключить AlvaAR
1) Скачать **`alva_ar.js`** (и `.wasm`, если он отдельный) из репозитория AlvaAR `examples/public/assets/`.
2) Положить в `public/vendor/`:
```
public/vendor/alva_ar.js
public/vendor/alva_ar.wasm (если нужен)
```
3) Приложение автоподхватит: `import('/vendor/alva_ar.js')` и подставит wasm путь через `Module.locateFile`.

Если `alva_ar.js` пытается загрузить wasm по относительному пути, это будет работать, если wasm лежит в том же `public/vendor`.

**Лицензия:** AlvaAR — GPLv3, значит проект становится GPL‑совместимым при включении.

## Диагностика SLAM
В UI есть чекбокс **SLAM points** — рисует `getFramePoints()` на overlay для отладки трекинга.

## Калибровка масштаба
В `UI` есть `Scale` + кнопка `Calibrate`. Это умножает глубину в `PlaneMapper` и влияет на размеры мира/физики.

## Известные упрощения/ограничения
- Mapping: сейчас берётся **доминирующая плоскость** из depth keyframes или SLAM‑плоскость, без устойчивого SLAM‑мэпа.
- Depth: относительный (Depth Anything) → масштаб вручную.
- Runner: движение в мировых осях, не “приклеено” к наклонной поверхности.
- Treasure: окклюзия упрощена (raycast по debug‑плоскостям).
- AlvaAR: нет persistence карты, reset только кнопкой.

## Как запускать
```
npm install
npm run dev
```
Открыть на телефоне через LAN (Vite с HTTPS уже настроен). Нужен доступ к камере.

## Дальнейшие шаги (приоритетно)
1) Реально подключить AlvaAR (положить `alva_ar.js` + wasm).
2) Добавить стабильное хранение карты/поверхностей (сглаживание и таймауты).
3) Улучшить plane detection (кластеризация, несколько плоскостей).
4) Привязать Runner к поверхности (касательное движение + нормаль).
5) Оптимизация: depth‑инференс в worker, keyframe‑политика.

## Где искать логику
- Трекинг: `src/mr/tracking/tracker.ts`
- Mapping: `src/mr/mapping/plane-mapper.ts`
- Физика: `src/physics/world.ts`
- Режимы: `src/game/*`
- UI/контролы: `src/ui/*`

## Примечания для других агентов
Главный вход — `src/main.ts` → `startApp()` в `src/app/app.ts`.
Вся логика живёт там, дальше можно дробить на ещё более мелкие системы.
Доп. документы:
- `docs/vendor/AlvaAR_README.md` — копия README AlvaAR.
