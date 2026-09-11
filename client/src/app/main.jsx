import { createRoot } from 'react-dom/client';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/globals.css';
import '../styles/entry-loader.css';
import '../styles/map-parity.css';
import App from './App.jsx';

setWorkerUrl(workerUrl);

createRoot(document.getElementById('root')).render(<App />);
