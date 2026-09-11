# ASTRIS Architecture v0.1

```text
Browser
  │
  ├─ React UI
  ├─ MapLibre 2D / Globe
  └─ ASTRIS WebGL orbital layer
       │
       ▼
Node.js / Express
  │
  ├─ /api/location
  │    └─ ipapi.co → approximate observer location
  │
  └─ /api/orbits/scene
       ├─ GNSS OMM cache
       ├─ STARLINK OMM cache
       ├─ satellite.js / SGP4
       ├─ look angles relative to observer
       └─ selected full-orbit track
             │
             ▼
         CelesTrak
```

## Відокремлення від IRMAS

Перенесена саме ідея та технічні напрацювання orbital/map stack. У ASTRIS відсутні:

- ESP32-P4 / ESP32-CAM;
- фізичний GNSS-приймач;
- телеметрія робота;
- LiDAR / SLAM;
- сенсори довкілля;
- керування приводами;
- відео та MediaMTX;
- AI pipeline.

Таким чином ASTRIS має власну предметну область, API та життєвий цикл.
