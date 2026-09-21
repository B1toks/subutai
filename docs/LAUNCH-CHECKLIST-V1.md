# V1 launch checklist (гілка `release/v1-neon`)

Стан на 2026-09-18. Все, що позначено ✅, перевірено в цій гілці живцем
(dev-сервер + production-збірка з CSP). Все, що ⬜, робиться руками
власника перед/після деплою і не може бути зроблене з агентської сесії.

## A. Вже зроблено і перевірено ✅

- ✅ `npx tsc -b` чистий, `eslint .` — 0 помилок (7 попередніх warnings
  `exhaustive-deps`, не нових).
- ✅ `npx tsx scripts/test-engine-defects.ts` — ALL PASS (960/960
  розстановок, EP чиститься на ротації).
- ✅ `npx tsx scripts/test-mp-draws.ts` — ALL PASS.
- ✅ `npm run build` проходить; `dist/index.html` містить CSP-meta.
- ✅ Production-збірка (`npm run preview`, `:4173/subutai/`): нуль
  console-помилок при завантаженні; анонімна auth + модалка імені
  працюють; Spotify-embed вантажиться під CSP; Deezer-BPM віддає значення;
  Twitch IRC підключається, 7TV-емоджі рендеряться; service worker
  реєструється; шрифти перемикаються без inline-скрипта.
- ✅ Dev: соло-гра Normal-ботом, хід + відповідь бота; тайм-контроль 1 хв
  → «White ran out of time. Black wins», підсумок з поміткою practice-гри,
  збереження в `/games` (кнопка Share з'явилась = docId є).
- ✅ Game Review: прогрес-лічильник рухається рівномірно і доходить до кінця
  (DEF-6 закрито), середній CPL і accuracy адекватні навіть коли в партії є
  хід, що дозволив мат, Turning point клікабельний (перемикає дошку на ту
  позицію), у списку ходів замість «−99999 cp» читається «allows mate»
  (у рулетці «hangs the king»).
- ✅ Рулетка vs Casual-бот: автоматична партія до захоплення короля (22 ходи),
  тости-віхи на 10 і 20 ходах спрацювали; Game Review показує Turning point
  (з переходом на позицію), бари по фазах, середній CPL більше не вибухає
  від мат-оцінок (кап 1200 cp на хід).
- ✅ Лейаут: рейл фіксований на всю висоту (desktop ≥ 721px), топ-бар з
  Leaderboard + чипом імені, GAME SETUP з Opponent / Mode / Bot strength /
  Time control; мобільний в'юпорт 375px без горизонтального скролу;
  wood-тема з новим лейаутом виглядає узгоджено.

## B. Перед деплоєм ⬜ (власник)

1. ⬜ **Деплой rules** — блокер:
   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules
   ```
   Потім пройти чек-лист §5 у `docs/SECURITY-AUDIT-2026-09.md`
   (соло Strong, соло Casual, PvP-матч, quick match, feedback).
2. ⬜ Обмежити Firebase Web API key за HTTP-referrer у GCP Console
   (Credentials → Browser key → Website restrictions:
   `https://b1toks.github.io/*`, `https://subutai.honchar.dev/*`,
   `http://localhost:*` для розробки).
3. ⬜ Візуальний вердикт по neon як дефолту (тема перемикається одним
   кліком у треї рейла; збережений вибір користувачів не чіпається).
4. ⬜ Прочитати `README.md` (оновлений) і `docs/DATA-PLAN-BOT-PROGRESS-REVIEW.md`.
5. ⬜ Merge `release/v1-neon` → `main` (fast-forward неможливий лише якщо
   main рушив; гілка створена від 28085b9).

## C. Деплой ⬜

- Поточний шлях: `npm run deploy` (gh-pages). За рішенням у пам'яті проєкту
  фінальний дім — `subutai.honchar.dev` (Vercel); коли перемикатись —
  оновити `base` у `vite.config.ts` (`/subutai/` → `/`), canonical/og-URL в
  `index.html`, `scope` service worker (`BASE_URL` підхопить автоматично).
- CSP `frame-src` містить `subutai-chess.firebaseapp.com` — потрібно лише
  якщо колись увімкнеться Google-sign-in; для анонімної auth не
  використовується, можна лишити.

## D. Після деплою ⬜ (перші 48 годин)

- ⬜ Перевірити в DevTools Console на проді, що немає
  `Content-Security-Policy` порушень при: старті гри, музиці (Spotify +
  локальний файл + Tab audio), Twitch, лідерборді, review, share-лінку.
  Якщо з'явиться — додати origin у `CSP` у `vite.config.ts` (один рядок)
  і передеплоїти.
- ⬜ Подивитись `/games`: нові доки з `botLevel`, practice-ігри з
  `counted: false`.
- ⬜ Через ~2 тижні: `node scripts/dump-training-games.mjs game_starts` →
  воронка «почав / дограв» (T2 у `docs/R15-NEXT-PLAN.md`).

## E. Відомі обмеження, що НЕ блокують запуск

- Легальність ходів у PvP досі довіряється клієнту (rules закривають
  off-turn append і переписування логу, але не шахову легальність) —
  потрібна Cloud Function; див. S3 в аудиті.
- `App.tsx` монолітний; рефакторинг — після релізу.
- Немає автотестів крім двох скриптів — Vitest після релізу.
- Spotify-embed без логіну грає 30-секундні прев'ю — обмеження Spotify,
  у доці є підказка.
- Анонімні акаунти: очищення сховища браузера втрачає ім'я/статистику.
