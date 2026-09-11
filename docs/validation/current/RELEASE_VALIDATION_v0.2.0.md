# ASTRIS v0.2.0 — Validation Summary

## Static gate

```text
ASTRIS v0.2.0 structural/map gate: 35/35 PASS
```

Перевірено:

- versions `0.2.0` у root/client/server;
- `maplibre-gl 6.9.0`;
- Vite worker `?worker&url` + `setWorkerUrl()`;
- відсутність v5 default-import і private `map.transform`;
- відсутність старого globe `easeTo` monkey patch;
- MapLibre v6 `shaderData` / `defaultProjectionData` / `projectTileFor3D` contract;
- projection shader variant cache;
- WebGL VBO ring;
- організацію CSS/assets/components/map/server/docs/tools;
- canonical ports 5174/3101;
- відсутність active imports на старі pre-reorg paths.

## Syntax

```text
JS/MJS syntax: PASS
JSX syntax: PASS (TypeScript parser)
Relative import resolution: PASS
CSS asset resolution: PASS
```

## Full npm build

У sandbox `npm install` не завершився в межах 120 секунд через registry/network timeout, тому `npm run build` тут не оголошується виконаним.

Обов'язково підтвердити на робочому ПК:

```bash
npm install
npm run check
npm run dev
```

## Live GPU acceptance

Після запуску v0.2.0 перевірити Chrome/Edge console під час:

- Globe rotate/pan/zoom/pitch;
- Globe ↔ Mercator 20+ разів;
- Labels/Grid/Terrain/Buildings;
- GNSS + Starlink;
- 3–5 хвилин безперервної роботи.

Ключовий критерій: у bundle/stack не повинно бути MapLibre v5 path

```text
_renderErrorTexture → updateErrorLoop → updateGPUdependent
```

бо `v0.2.0` використовує MapLibre GL JS `6.9.0`, де старий runtime GPU latitude correction mechanism видалений.
