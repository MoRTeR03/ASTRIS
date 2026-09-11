# Рекомендована Git-історія практичного проєкту

Не створювати фіктивні старі коміти. Починати історію з реального стану ASTRIS і далі комітити виконані зміни окремими логічними етапами.

1. `chore: initialize ASTRIS project structure`
2. `feat: add CelesTrak OMM catalog cache`
3. `feat: add SGP4 scene propagation`
4. `feat: add IP observer geolocation and manual override`
5. `feat: add MapLibre 2D and globe views`
6. `feat: add GNSS and Starlink filtering`
7. `feat: add satellite search and orbital inspector`
8. `feat: add selected satellite orbit rendering`
9. `test: add orbital catalog unit tests`
10. `docs: document ASTRIS architecture and API`

Пункти треба робити/комітити в міру фактичного виконання наступних змін. Якщо v0.1.0 уже отримано як один baseline, перший локальний commit може бути `chore: import ASTRIS v0.1.0 baseline`, а наступні етапи вести чесно від нього.
